import "server-only";

import { BookingApiError } from "./api-auth.server";

export function isPublicReservationInventoryEnabled(
  configured = process.env.RESERVATION_PUBLIC_BOOKING_ENABLED,
) {
  return configured === "true";
}

export function assertPublicReservationInventoryEnabled(options?: {
  existingManagementSessionAuthorized?: boolean;
}) {
  if (
    isPublicReservationInventoryEnabled() ||
    options?.existingManagementSessionAuthorized
  )
    return;

  throw new BookingApiError(
    503,
    "booking_unavailable",
    "Online reservations are temporarily unavailable. Please call the restaurant.",
  );
}
