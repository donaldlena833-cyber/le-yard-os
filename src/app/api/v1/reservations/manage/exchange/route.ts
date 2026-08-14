import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticateBookingApiRequest,
  BookingApiError,
  bookingApiFailure,
  bookingApiResponse,
  enforceBookingRateLimit,
  managementExchangeBrowserBindingHash,
  readBookingJson,
  sha256,
} from "@/lib/reservations/api-auth.server";
import {
  deriveReservationManagementToken,
  requireReservationLinkScope,
  verifyReservationLinkToken,
} from "@/lib/reservations/link-token.server";

const schema = z
  .object({ exchangeToken: z.string().min(80).max(2_048) })
  .strict();

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const client = await authenticateBookingApiRequest(
      request,
      "reservations:write",
    );
    const input = schema.parse(
      await readBookingJson(
        request,
        "The management request is too large.",
      ),
    );
    const exchange = verifyReservationLinkToken(
      input.exchangeToken,
      "manage_exchange",
    );
    requireReservationLinkScope(exchange, client);
    await enforceBookingRateLimit(request, client, 20, 60);
    const manageToken = deriveReservationManagementToken(input.exchangeToken);
    const admin = createAdminClient();
    const rpc = admin.rpc as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<{
      data: unknown;
      error: { code?: string } | null;
    }>;
    const { data, error } = await rpc(
      "service_exchange_reservation_management",
      {
        p_organization_id: client.organizationId,
        p_location_id: client.locationId,
        p_reservation_id: exchange.subjectId,
        p_exchange_fingerprint: sha256(input.exchangeToken),
        p_manage_token_hash: sha256(manageToken),
        p_browser_binding_hash: managementExchangeBrowserBindingHash(client),
      },
    );
    if (error?.code === "23514")
      throw new BookingApiError(
        410,
        "management_exchange_expired",
        "This reservation management link is no longer available.",
      );
    if (error)
      throw new BookingApiError(
        404,
        "management_exchange_unavailable",
        "This reservation management link is unavailable.",
      );
    const exchanged = data as {
      manageExpiresAt: string;
      replayed?: boolean;
    };
    return bookingApiResponse({
      data: { manageToken, manageExpiresAt: exchanged.manageExpiresAt },
      requestId,
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return bookingApiResponse(
        {
          error: {
            code: "invalid_request",
            message: "A valid reservation management link is required.",
            requestId,
          },
        },
        { status: 400 },
      );
    return bookingApiFailure(error, requestId);
  }
}
