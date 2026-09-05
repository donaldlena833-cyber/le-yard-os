import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { type BookingApiClientContext, BookingApiError } from "@/lib/reservations/api-auth.server";
import { loadPublicAvailability } from "@/lib/reservations/public-availability.server";
import { assertPublicReservationInventoryEnabled } from "@/lib/reservations/public-booking-policy.server";
import { assertPublicReleaseAllowsBusinessDate, loadPublicReleaseState } from "@/lib/reservations/public-release-control.server";
import { verifyBookingSlotToken } from "@/lib/reservations/slot-token.server";
import { assertApprovedReservationDeliveryChannel, configuredReservationDeliveryAdapters } from "@/lib/reservations/delivery-readiness.server";
import { scheduleReservationMessageDelivery } from "@/lib/reservations/message-delivery-trigger.server";
import { resolveLeYardTenant } from "@/lib/communications.server";

// Revalidate on each operation; do not indefinitely cache revoked/expired clients.
export async function resolveCommunicationsBookingClient(): Promise<BookingApiClientContext> {
  const tenant = await resolveLeYardTenant();
  const { data, error } = await createAdminClient().from("booking_api_clients")
    .select("id,organization_id,location_id,name,scopes,is_active,expires_at")
    .eq("organization_id", tenant.organizationId).eq("location_id", tenant.locationId)
    .eq("is_active", true).contains("scopes", ["availability:read", "reservations:write"])
    .order("created_at", { ascending: false }).limit(1).maybeSingle();
  if (error || !data || !data.location_id || (data.expires_at && new Date(data.expires_at) <= new Date()))
    throw new BookingApiError(503, "communications_booking_client_unavailable", "Reservation tools are temporarily unavailable.");
  return { id: data.id, organizationId: data.organization_id, locationId: data.location_id,
    name: data.name, scopes: data.scopes, abuseIdentity: crypto.randomUUID() };
}
export async function communicationsAvailability(input: { date: string; partySize: number }) {
  assertPublicReservationInventoryEnabled();
  return loadPublicAvailability(await resolveCommunicationsBookingClient(), input.date, input.partySize);
}

const resultSchema = z.object({ reservationId: z.string().uuid(), status: z.string().min(1).max(60),
  replayed: z.boolean().optional(), deliveryState: z.unknown().optional() });

export async function communicationsCreateReservation(request: Request, input: {
  slotToken: string; partySize: number; firstName: string; lastName: string; email: string;
  phone: string; specialRequests?: string | null;
}) {
  assertPublicReservationInventoryEnabled();
  const requestId = request.headers.get("idempotency-key")?.trim();
  if (!z.string().uuid().safeParse(requestId).success)
    throw new BookingApiError(400, "idempotency_key_required", "A stable request identifier is required.");
  const client = await resolveCommunicationsBookingClient();
  const slot = verifyBookingSlotToken(input.slotToken, client.id);
  if (slot.locationId !== client.locationId || slot.partySize !== input.partySize)
    throw new BookingApiError(400, "invalid_slot", "The selected time does not match this reservation.");
  const releaseState = await loadPublicReleaseState(client);
  assertPublicReleaseAllowsBusinessDate(releaseState, slot.businessDate);
  if (slot.releaseId !== releaseState.releaseId)
    throw new BookingApiError(409, "slot_release_changed", "Availability changed. Choose another time.");
  const adapters = configuredReservationDeliveryAdapters();
  if (!adapters.includes("email"))
    throw new BookingApiError(503, "confirmation_email_unavailable", "Reservation confirmation email is temporarily unavailable.");
  const admin = createAdminClient();
  await assertApprovedReservationDeliveryChannel(admin, client.organizationId, client.locationId, adapters);
  const { data, error } = await admin.rpc("service_book_public_reservation", {
    p_request_id: requestId, p_organization_id: client.organizationId, p_location_id: client.locationId,
    p_reserved_at: slot.startsAt, p_duration_minutes: slot.durationMinutes, p_party_size: input.partySize,
    p_first_name: input.firstName, p_last_name: input.lastName, p_email: input.email, p_phone: input.phone,
    p_special_requests: input.specialRequests ?? null, p_table_ids: slot.tableIds, p_available_channels: adapters,
  } as never);
  if (error?.code === "23P01" || error?.code === "23505")
    throw new BookingApiError(409, "slot_unavailable", "That time or request identifier is unavailable. Check the original request before retrying.");
  if (error) {
    console.error("communications_reservation_create_rpc_error", { code: error.code });
    throw new BookingApiError(503, "booking_unavailable", "The reservation result could not be verified. Escalate and retain the original request identifier.");
  }
  const parsed = resultSchema.safeParse(data);
  if (!parsed.success)
    throw new BookingApiError(503, "booking_result_unverified", "The booking result requires human verification. Do not promise confirmation or retry with a new request identifier.");
  scheduleReservationMessageDelivery(request);
  return parsed.data;
}
