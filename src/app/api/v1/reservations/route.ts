import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  authenticateBookingApiRequest,
  BookingApiError,
  bookingApiFailure,
  bookingApiResponse,
  enforceBookingContactRateLimit,
  enforceBookingRateLimit,
  readBookingJson,
  sha256,
} from "@/lib/reservations/api-auth.server";
import { verifyBookingSlotToken } from "@/lib/reservations/slot-token.server";
import {
  assertApprovedReservationDeliveryChannel,
  configuredReservationDeliveryAdapters,
} from "@/lib/reservations/delivery-readiness.server";

const createSchema = z
  .object({
    slotToken: z.string().min(40).max(4_000),
    partySize: z.number().int().min(1).max(100),
    firstName: z.string().trim().min(1).max(120),
    lastName: z.string().trim().min(1).max(120),
    email: z.string().trim().email().max(320),
    phone: z
      .string()
      .trim()
      .min(7)
      .max(80)
      .refine((value) => {
        const digits = value.replace(/\D/g, "");
        return digits.length >= 7 && digits.length <= 20;
      }),
    specialRequests: z.string().trim().max(5_000).nullable().optional(),
  })
  .strict();

const modifySchema = z
  .object({
    slotToken: z.string().min(40).max(4_000),
    partySize: z.number().int().min(1).max(100),
    specialRequests: z.string().trim().max(5_000).nullable().optional(),
  })
  .strict();

const cancelSchema = z
  .object({ reason: z.string().trim().min(1).max(1_000) })
  .strict();
const uuidSchema = z.string().uuid();

function idempotencyKey(request: Request) {
  const parsed = uuidSchema.safeParse(request.headers.get("idempotency-key"));
  if (!parsed.success)
    throw new BookingApiError(
      400,
      "idempotency_key_required",
      "A UUID Idempotency-Key header is required.",
    );
  return parsed.data;
}

function rpcFailure(
  error: { code?: string; message?: string } | null,
  fallback: string,
): never {
  if (error?.code === "23P01" || error?.code === "23505")
    throw new BookingApiError(
      409,
      "slot_unavailable",
      "That time was just booked. Choose another available time.",
    );
  if (error?.code === "23514")
    throw new BookingApiError(
      409,
      "booking_rule_conflict",
      fallback,
    );
  if (error?.code === "P0002")
    throw new BookingApiError(
      404,
      "reservation_not_found",
      "The reservation link is unavailable.",
    );
  throw new BookingApiError(503, "booking_unavailable", fallback);
}

export async function POST(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const client = await authenticateBookingApiRequest(
      request,
      "reservations:write",
    );
    const requestKey = idempotencyKey(request);
    const input = createSchema.parse(
      await readBookingJson(
        request,
        "The booking request is too large.",
      ),
    );
    const slot = verifyBookingSlotToken(input.slotToken, client.id);
    if (
      slot.locationId !== client.locationId ||
      slot.partySize !== input.partySize
    )
      throw new BookingApiError(
        400,
        "invalid_slot",
        "The selected time does not match this booking.",
      );
    await enforceBookingRateLimit(request, client, 6, 60);
    await enforceBookingContactRateLimit(
      request,
      client,
      input.email,
      input.phone,
    );
    const configuredAdapters = configuredReservationDeliveryAdapters();
    const admin = createAdminClient();
    await assertApprovedReservationDeliveryChannel(
      admin,
      client.organizationId,
      client.locationId,
      configuredAdapters,
    );
    const { data, error } = await admin.rpc(
      "service_create_public_reservation",
      {
        p_request_id: requestKey,
        p_organization_id: client.organizationId,
        p_location_id: client.locationId,
        p_reserved_at: slot.startsAt,
        p_duration_minutes: slot.durationMinutes,
        p_party_size: input.partySize,
        p_first_name: input.firstName,
        p_last_name: input.lastName,
        p_email: input.email,
        p_phone: input.phone,
        p_special_requests: input.specialRequests ?? null,
        p_table_ids: slot.tableIds,
        p_available_channels: configuredAdapters,
      } as never,
    );
    if (error?.code === "55000")
      throw new BookingApiError(
        503,
        "verification_unavailable",
        "Reservation verification is temporarily unavailable. Please call the restaurant.",
      );
    if (error) rpcFailure(error, "The reservation could not be held.");
    const hold = data as {
      holdId: string;
      holdExpiresAt: string;
      replayed: boolean;
      deliveryState: unknown;
    };
    return bookingApiResponse(
      {
        data: {
          holdId: hold.holdId,
          holdExpiresAt: hold.holdExpiresAt,
          deliveryState: hold.deliveryState,
        },
      },
      { status: 201 },
    );
  } catch (error) {
    if (error instanceof z.ZodError)
      return bookingApiResponse(
        {
          error: {
            code: "invalid_request",
            message: "Complete all required guest and booking details.",
            requestId,
            fields: z.flattenError(error).fieldErrors,
          },
        },
        { status: 400 },
      );
    return bookingApiFailure(error, requestId);
  }
}

export async function GET(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const client = await authenticateBookingApiRequest(
      request,
      "reservations:write",
    );
    await enforceBookingRateLimit(request, client, 60, 60);
    const manageToken = request.headers.get("x-booking-manage-token")?.trim();
    if (!manageToken)
      throw new BookingApiError(
        401,
        "manage_token_required",
        "A reservation manage token is required.",
      );
    const admin = createAdminClient();
    const { data, error } = await admin.rpc("service_get_managed_reservation", {
      p_organization_id: client.organizationId,
      p_location_id: client.locationId,
      p_manage_token_hash: sha256(manageToken),
    } as never);
    if (error) rpcFailure(error, "The reservation could not be loaded.");
    return bookingApiResponse({ data, requestId });
  } catch (error) {
    return bookingApiFailure(error, requestId);
  }
}

export async function PATCH(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const client = await authenticateBookingApiRequest(
      request,
      "reservations:write",
    );
    await enforceBookingRateLimit(request, client, 12, 60);
    const manageToken = request.headers.get("x-booking-manage-token")?.trim();
    if (!manageToken)
      throw new BookingApiError(
        401,
        "manage_token_required",
        "A reservation manage token is required.",
      );
    const input = modifySchema.parse(
      await readBookingJson(
        request,
        "The booking request is too large.",
      ),
    );
    const slot = verifyBookingSlotToken(input.slotToken, client.id);
    if (
      slot.locationId !== client.locationId ||
      slot.partySize !== input.partySize
    )
      throw new BookingApiError(
        400,
        "invalid_slot",
        "The selected time does not match this booking.",
      );
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "service_modify_public_reservation",
      {
        p_request_id: idempotencyKey(request),
        p_organization_id: client.organizationId,
        p_location_id: client.locationId,
        p_manage_token_hash: sha256(manageToken),
        p_reserved_at: slot.startsAt,
        p_duration_minutes: slot.durationMinutes,
        p_party_size: input.partySize,
        p_special_requests: input.specialRequests ?? null,
        p_table_ids: slot.tableIds,
      } as never,
    );
    if (error) rpcFailure(error, "The reservation could not be modified.");
    return bookingApiResponse({ data, requestId });
  } catch (error) {
    if (error instanceof z.ZodError)
      return bookingApiResponse(
        {
          error: {
            code: "invalid_request",
            message: "Choose a valid replacement time.",
            requestId,
          },
        },
        { status: 400 },
      );
    return bookingApiFailure(error, requestId);
  }
}

export async function DELETE(request: Request) {
  const requestId = crypto.randomUUID();
  try {
    const client = await authenticateBookingApiRequest(
      request,
      "reservations:write",
    );
    await enforceBookingRateLimit(request, client, 12, 60);
    const manageToken = request.headers.get("x-booking-manage-token")?.trim();
    if (!manageToken)
      throw new BookingApiError(
        401,
        "manage_token_required",
        "A reservation manage token is required.",
      );
    const input = cancelSchema.parse(
      await readBookingJson(
        request,
        "The booking request is too large.",
      ),
    );
    const admin = createAdminClient();
    const { data, error } = await admin.rpc(
      "service_cancel_public_reservation",
      {
        p_request_id: idempotencyKey(request),
        p_organization_id: client.organizationId,
        p_location_id: client.locationId,
        p_manage_token_hash: sha256(manageToken),
        p_reason: input.reason,
      } as never,
    );
    if (error) rpcFailure(error, "The reservation could not be cancelled.");
    return bookingApiResponse({ data, requestId });
  } catch (error) {
    if (error instanceof z.ZodError)
      return bookingApiResponse(
        {
          error: {
            code: "invalid_request",
            message: "Provide a cancellation reason.",
            requestId,
          },
        },
        { status: 400 },
      );
    return bookingApiFailure(error, requestId);
  }
}
