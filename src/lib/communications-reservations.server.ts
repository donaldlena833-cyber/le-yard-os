import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import {
  type BookingApiClientContext,
  BookingApiError,
} from "@/lib/reservations/api-auth.server";
import { loadPublicAvailability } from "@/lib/reservations/public-availability.server";
import { assertPublicReservationInventoryEnabled } from "@/lib/reservations/public-booking-policy.server";
import {
  assertPublicReleaseAllowsBusinessDate,
  loadPublicReleaseState,
} from "@/lib/reservations/public-release-control.server";
import { verifyBookingSlotToken } from "@/lib/reservations/slot-token.server";
import {
  assertApprovedReservationDeliveryChannel,
  configuredReservationDeliveryAdapters,
} from "@/lib/reservations/delivery-readiness.server";
import { scheduleReservationMessageDelivery } from "@/lib/reservations/message-delivery-trigger.server";
import { resolveLeYardTenant } from "@/lib/communications.server";

let bookingClientPromise: Promise<BookingApiClientContext> | null = null;

export function resolveCommunicationsBookingClient() {
  bookingClientPromise ??= (async () => {
    const tenant = await resolveLeYardTenant();
    const admin = createAdminClient();
    const { data, error } = await admin
      .from("booking_api_clients")
      .select("id,organization_id,location_id,name,scopes,is_active,expires_at")
      .eq("organization_id", tenant.organizationId)
      .eq("location_id", tenant.locationId)
      .eq("is_active", true)
      .contains("scopes", ["availability:read", "reservations:write"])
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    if (
      error ||
      !data ||
      !data.location_id ||
      (data.expires_at && new Date(data.expires_at) <= new Date())
    )
      throw new BookingApiError(
        503,
        "communications_booking_client_unavailable",
        "Reservation tools are temporarily unavailable.",
      );
    return {
      id: data.id,
      organizationId: data.organization_id,
      locationId: data.location_id,
      name: data.name,
      scopes: data.scopes,
      abuseIdentity: crypto.randomUUID(),
    } satisfies BookingApiClientContext;
  })();
  return bookingClientPromise;
}

export async function communicationsAvailability(input: {
  date: string;
  partySize: number;
}) {
  assertPublicReservationInventoryEnabled();
  const client = await resolveCommunicationsBookingClient();
  return loadPublicAvailability(client, input.date, input.partySize);
}

export async function communicationsCreateReservation(
  request: Request,
  input: {
    slotToken: string;
    partySize: number;
    firstName: string;
    lastName: string;
    email: string;
    phone: string;
    specialRequests?: string | null;
  },
) {
  assertPublicReservationInventoryEnabled();
  const client = await resolveCommunicationsBookingClient();
  const slot = verifyBookingSlotToken(input.slotToken, client.id);
  if (slot.locationId !== client.locationId || slot.partySize !== input.partySize)
    throw new BookingApiError(
      400,
      "invalid_slot",
      "The selected time does not match this reservation.",
    );
  const releaseState = await loadPublicReleaseState(client);
  assertPublicReleaseAllowsBusinessDate(releaseState, slot.businessDate);
  if (slot.releaseId !== releaseState.releaseId)
    throw new BookingApiError(
      409,
      "slot_release_changed",
      "Availability changed. Choose another time.",
    );

  const adapters = configuredReservationDeliveryAdapters();
  if (!adapters.includes("email"))
    throw new BookingApiError(
      503,
      "confirmation_email_unavailable",
      "Reservation confirmation email is temporarily unavailable.",
    );
  const admin = createAdminClient();
  await assertApprovedReservationDeliveryChannel(
    admin,
    client.organizationId,
    client.locationId,
    adapters,
  );
  const requestId = crypto.randomUUID();
  const { data, error } = await admin.rpc("service_book_public_reservation", {
    p_request_id: requestId,
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
    p_available_channels: adapters,
  } as never);
  if (error?.code === "23P01" || error?.code === "23505")
    throw new BookingApiError(
      409,
      "slot_unavailable",
      "That time was just booked. Choose another available time.",
    );
  if (error) {
    console.error("communications_reservation_create_rpc_error", {
      code: error.code,
      message: error.message,
    });
    throw new BookingApiError(
      503,
      "booking_unavailable",
      "The reservation could not be booked.",
    );
  }
  scheduleReservationMessageDelivery(request);
  return data as {
    reservationId: string;
    status: "confirmed";
    replayed: boolean;
    deliveryState: unknown;
  };
}
