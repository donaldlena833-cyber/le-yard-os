export interface ReservationCapacityEntry {
  startsAt: string;
  partySize: number;
}

export interface ReservationPacingBucket {
  startsAt: string;
  label: string;
  covers: number;
  limit: number;
}

/**
 * Projects the same rolling pacing window enforced by
 * `private.assert_reservation_pacing`: [slot - interval, slot + interval).
 */
export function deriveReservationPacingBuckets({
  serviceStartsAt,
  serviceEndsAt,
  intervalMinutes,
  coverLimit,
  capacity,
  timeZone,
}: {
  serviceStartsAt: string;
  serviceEndsAt: string;
  intervalMinutes: number;
  coverLimit: number;
  capacity: readonly ReservationCapacityEntry[];
  timeZone: string;
}): ReservationPacingBucket[] {
  const startsAtMs = new Date(serviceStartsAt).valueOf();
  const endsAtMs = new Date(serviceEndsAt).valueOf();
  const intervalMs = intervalMinutes * 60_000;
  if (
    !Number.isFinite(startsAtMs) ||
    !Number.isFinite(endsAtMs) ||
    endsAtMs <= startsAtMs ||
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes <= 0 ||
    !Number.isInteger(coverLimit) ||
    coverLimit <= 0
  ) {
    return [];
  }

  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });
  const entries = capacity.flatMap((entry) => {
    const value = new Date(entry.startsAt).valueOf();
    return Number.isFinite(value) && Number.isFinite(entry.partySize)
      ? [{ value, partySize: entry.partySize }]
      : [];
  });
  const buckets: ReservationPacingBucket[] = [];
  for (
    let cursor = startsAtMs;
    cursor < endsAtMs;
    cursor += intervalMs
  ) {
    const lower = cursor - intervalMs;
    const upper = cursor + intervalMs;
    buckets.push({
      startsAt: new Date(cursor).toISOString(),
      label: formatter.format(new Date(cursor)),
      covers: entries.reduce(
        (sum, entry) =>
          entry.value >= lower && entry.value < upper
            ? sum + entry.partySize
            : sum,
        0,
      ),
      limit: coverLimit,
    });
  }
  return buckets;
}
