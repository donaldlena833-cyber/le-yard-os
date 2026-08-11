import { localDateKey } from "@/data/read-models/local-time";

export interface ServiceDayShiftWindow {
  startsAt: string;
  endsAt: string;
}

export interface ResolvedServiceWindow extends ServiceDayShiftWindow {
  businessDate: string;
}

/**
 * Includes both shifts that open on the business date and relief/close shifts
 * that start after midnight but overlap the DB-resolved service interval.
 */
export function shiftBelongsToResolvedServiceDay(
  shift: ServiceDayShiftWindow,
  timeZone: string,
  service: ResolvedServiceWindow,
): boolean {
  if (localDateKey(shift.startsAt, timeZone) === service.businessDate) {
    return true;
  }
  const shiftStart = new Date(shift.startsAt).valueOf();
  const shiftEnd = new Date(shift.endsAt).valueOf();
  const serviceStart = new Date(service.startsAt).valueOf();
  const serviceEnd = new Date(service.endsAt).valueOf();
  return (
    [shiftStart, shiftEnd, serviceStart, serviceEnd].every(Number.isFinite) &&
    shiftStart < serviceEnd &&
    shiftEnd > serviceStart
  );
}

/**
 * Keeps an in-progress overnight service attached to the date on which the
 * operating shift began. The database service-shift resolver remains the
 * stronger source when a configured service exists; this protects staff-only
 * service days that do not use reservation periods.
 */
export function resolveBusinessDateFromActiveShifts(
  observedAt: string,
  timeZone: string,
  fallbackDate: string,
  shifts: readonly ServiceDayShiftWindow[],
): string {
  const observedAtMs = new Date(observedAt).valueOf();
  if (!Number.isFinite(observedAtMs)) return fallbackDate;
  const active = shifts
    .filter((shift) => {
      const startsAtMs = new Date(shift.startsAt).valueOf();
      const endsAtMs = new Date(shift.endsAt).valueOf();
      return startsAtMs <= observedAtMs && endsAtMs > observedAtMs;
    })
    .sort(
      (left, right) =>
        new Date(left.startsAt).valueOf() - new Date(right.startsAt).valueOf(),
    );
  return active[0]
    ? localDateKey(active[0].startsAt, timeZone)
    : fallbackDate;
}
