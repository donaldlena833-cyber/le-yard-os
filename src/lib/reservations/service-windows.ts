import {
  addIsoDays,
  zonedLocalToIso,
} from "@/data/read-models/local-time";

export interface ReservationServicePeriodInput {
  id: string;
  name: string;
  daysOfWeek: readonly number[];
  startsLocal: string;
  endsLocal: string;
  pacingIntervalMinutes: number;
  pacingCoverLimit: number;
}

export interface ReservationServiceWindow
  extends ReservationServicePeriodInput {
  startsAt: string;
  endsAt: string;
}

export function buildReservationServiceWindows({
  businessDate,
  timeZone,
  periods,
}: {
  businessDate: string;
  timeZone: string;
  periods: readonly ReservationServicePeriodInput[];
}): ReservationServiceWindow[] {
  const weekday = new Date(`${businessDate}T12:00:00Z`).getUTCDay();
  return periods
    .flatMap((period) => {
      if (!period.daysOfWeek.includes(weekday)) return [];
      const endsOn =
        period.endsLocal <= period.startsLocal
          ? addIsoDays(businessDate, 1)
          : businessDate;
      const startsAt = zonedLocalToIso(
        businessDate,
        period.startsLocal,
        timeZone,
      );
      const endsAt = zonedLocalToIso(endsOn, period.endsLocal, timeZone);
      return startsAt && endsAt && new Date(endsAt) > new Date(startsAt)
        ? [{ ...period, startsAt, endsAt }]
        : [];
    })
    .sort(
      (left, right) =>
        left.startsAt.localeCompare(right.startsAt) ||
        left.id.localeCompare(right.id),
    );
}

export function reservationInstantFallsInServiceWindows(
  value: string,
  windows: readonly ReservationServiceWindow[],
): boolean {
  const instant = new Date(value).valueOf();
  return (
    Number.isFinite(instant) &&
    windows.some(
      (window) =>
        instant >= new Date(window.startsAt).valueOf() &&
        instant < new Date(window.endsAt).valueOf(),
    )
  );
}
