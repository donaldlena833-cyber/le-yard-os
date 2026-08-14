import { isIsoCalendarDate, localDateKey } from "@/data/read-models/local-time";

/**
 * Reservation URLs may carry an explicit business date. Without one, the
 * authenticated location's calendar date is authoritative; the server's
 * timezone must never choose a different room's book near midnight.
 */
export function resolveSelectedReservationDate(
  requested: string | undefined,
  timeZone: string,
  observedAt = new Date(),
): string {
  return requested && isIsoCalendarDate(requested)
    ? requested
    : localDateKey(observedAt, timeZone);
}
