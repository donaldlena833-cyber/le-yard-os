import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { BookingApiError } from "./api-auth.server";
import { reservationSmsDeliveryEnabled } from "./delivery-policy.server";
import { canonicalReservationPublicSiteOrigin } from "./public-origin.server";

export function configuredReservationDeliveryAdapters() {
  const siteUrl = canonicalReservationPublicSiteOrigin();
  const signingSecret = process.env.RESERVATION_LINK_SIGNING_SECRET?.trim();
  const deliverySecret = process.env.RESERVATION_DELIVERY_SECRET?.trim();
  const adapters = new Set<string>();
  if (
    process.env.RESEND_API_KEY?.trim() &&
    process.env.RESERVATION_EMAIL_FROM?.trim()
  )
    adapters.add("email");
  if (
    reservationSmsDeliveryEnabled() &&
    process.env.TWILIO_ACCOUNT_SID?.trim() &&
    process.env.TWILIO_AUTH_TOKEN?.trim() &&
    process.env.TWILIO_FROM_NUMBER?.trim()
  )
    adapters.add("sms");
  if (
    !siteUrl ||
    !signingSecret ||
    signingSecret.length < 32 ||
    !deliverySecret ||
    deliverySecret.length < 32 ||
    adapters.size === 0
  )
    throw new BookingApiError(
      503,
      "verification_unavailable",
      "Reservation verification is temporarily unavailable. Please call the restaurant.",
    );
  return [...adapters].sort();
}

export async function assertApprovedReservationDeliveryChannel(
  admin: ReturnType<typeof createAdminClient>,
  organizationId: string,
  locationId: string,
  adapters: string[],
) {
  const result = await admin
    .from("reservation_settings")
    .select("guest_messaging_enabled,verification_channels")
    .eq("organization_id", organizationId)
    .eq("location_id", locationId)
    .maybeSingle();
  const settings = result.data as unknown as {
    guest_messaging_enabled?: boolean;
    verification_channels?: unknown;
  } | null;
  const approved = Array.isArray(settings?.verification_channels)
    ? settings.verification_channels.filter(
        (channel): channel is string => typeof channel === "string",
      )
    : [];
  if (
    result.error ||
    !settings?.guest_messaging_enabled ||
    !approved.some((channel) => adapters.includes(channel))
  )
    throw new BookingApiError(
      503,
      "verification_unavailable",
      "Reservation verification is temporarily unavailable. Please call the restaurant.",
    );
}
