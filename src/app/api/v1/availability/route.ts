import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticateBookingApiRequest,
  bookingApiFailure,
  bookingApiResponse,
  enforceBookingRateLimit,
  sha256,
} from "@/lib/reservations/api-auth.server";
import { loadPublicAvailability } from "@/lib/reservations/public-availability.server";
import { isIsoCalendarDate } from "@/lib/reservations/availability";
import {
  assertPublicReservationInventoryEnabled,
  isPublicReservationInventoryEnabled,
} from "@/lib/reservations/public-booking-policy.server";

const querySchema = z.object({
  date: z.string().refine(isIsoCalendarDate),
  partySize: z.coerce.number().int().min(1).max(100),
});

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const publicInventoryEnabled = isPublicReservationInventoryEnabled();
    const manageToken = request.headers.get("x-booking-manage-token")?.trim();
    if (!publicInventoryEnabled && !manageToken)
      assertPublicReservationInventoryEnabled();
    const client = await authenticateBookingApiRequest(
      request,
      "availability:read",
    );
    let existingManagementSessionAuthorized = false;
    if (!publicInventoryEnabled && manageToken) {
      const { data, error } = await createAdminClient().rpc(
        "service_get_managed_reservation",
        {
          p_organization_id: client.organizationId,
          p_location_id: client.locationId,
          p_manage_token_hash: sha256(manageToken),
        } as never,
      );
      existingManagementSessionAuthorized =
        !error &&
        ["booked", "confirmed"].includes(
          (data as { status?: string } | null)?.status ?? "",
        );
      assertPublicReservationInventoryEnabled({
        existingManagementSessionAuthorized,
      });
    }
    await enforceBookingRateLimit(request, client, 120, 60);
    const url = new URL(request.url);
    const input = querySchema.parse({
      date: url.searchParams.get("date"),
      partySize: url.searchParams.get("partySize"),
    });
    return bookingApiResponse({
      data: await loadPublicAvailability(client, input.date, input.partySize, {
        existingManagementSessionAuthorized,
      }),
      requestId,
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return bookingApiResponse(
        {
          error: {
            code: "invalid_request",
            message: "Choose a valid date and party size.",
            requestId,
          },
        },
        { status: 400 },
      );
    return bookingApiFailure(error, requestId);
  }
}
