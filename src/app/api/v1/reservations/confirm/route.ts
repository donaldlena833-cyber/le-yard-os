import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticateBookingApiRequest,
  BookingApiError,
  bookingApiFailure,
  bookingApiResponse,
  enforceBookingRateLimit,
  readBookingJson,
  sha256,
} from "@/lib/reservations/api-auth.server";
import {
  requireReservationLinkScope,
  verifyReservationLinkToken,
} from "@/lib/reservations/link-token.server";
import { configuredReservationDeliveryAdapters } from "@/lib/reservations/delivery-readiness.server";
import { scheduleReservationMessageDelivery } from "@/lib/reservations/message-delivery-trigger.server";

const schema = z
  .object({ verificationToken: z.string().min(80).max(2_048) })
  .strict();

function isVerifiedManagementDeliveryState(
  value: unknown,
  channel: "email" | "sms",
  replayed: boolean,
) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const deliveryState = value as Record<string, unknown>;
  const keys = Object.keys(deliveryState);
  if (replayed) return keys.length === 0;
  return keys.length === 1 && deliveryState[channel] === "queued";
}

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
        "The confirmation request is too large.",
      ),
    );
    const verification = verifyReservationLinkToken(
      input.verificationToken,
      "verify",
    );
    requireReservationLinkScope(verification, client);
    await enforceBookingRateLimit(request, client, 20, 60);
    const configuredAdapters = configuredReservationDeliveryAdapters();
    if (!configuredAdapters.includes(verification.verifiedChannel))
      throw new BookingApiError(
        503,
        "verification_unavailable",
        "Reservation verification is temporarily unavailable. Please call the restaurant.",
      );
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "service_confirm_public_reservation",
      {
        p_organization_id: client.organizationId,
        p_location_id: client.locationId,
        p_booking_hold_id: verification.subjectId,
        p_confirmation_fingerprint: sha256(input.verificationToken),
        p_verified_channel: verification.verifiedChannel,
        p_available_channels: configuredAdapters,
      } as never,
    );
    if (error?.code === "23514")
      throw new BookingApiError(
        410,
        "confirmation_expired",
        "This reservation hold has expired. Choose a new time.",
      );
    if (error?.code === "55000")
      throw new BookingApiError(
        503,
        "verification_unavailable",
        "Reservation verification is temporarily unavailable. Please call the restaurant.",
      );
    if (error)
      throw new BookingApiError(
        404,
        "confirmation_unavailable",
        "The confirmation link is unavailable.",
      );
    const confirmed = data as {
      status: string;
      manageDeliveryState: unknown;
      replayed: boolean;
    };
    if (
      typeof confirmed.status !== "string" ||
      typeof confirmed.replayed !== "boolean" ||
      !isVerifiedManagementDeliveryState(
        confirmed.manageDeliveryState,
        verification.verifiedChannel,
        confirmed.replayed,
      )
    )
      throw new BookingApiError(
        503,
        "verification_unavailable",
        "Reservation verification is temporarily unavailable. Please call the restaurant.",
      );
    scheduleReservationMessageDelivery(request);
    return bookingApiResponse({
      data: {
        status: confirmed.status,
        deliveryState: confirmed.manageDeliveryState,
      },
      requestId,
    });
  } catch (error) {
    if (error instanceof z.ZodError)
      return bookingApiResponse(
        {
          error: {
            code: "invalid_request",
            message: "A valid confirmation token is required.",
            requestId,
          },
        },
        { status: 400 },
      );
    return bookingApiFailure(error, requestId);
  }
}
