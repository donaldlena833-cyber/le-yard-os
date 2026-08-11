import { addIsoDays } from "@/data/read-models/local-time";

function minutes(value: string): number {
  const [hour, minute] = value.split(":").map(Number);
  return hour * 60 + minute;
}

export function servicePeriodMinuteBounds(startsLocal: string, endsLocal: string) {
  const startsAtMinutes = minutes(startsLocal);
  const rawEndMinutes = minutes(endsLocal);
  return {
    startsAtMinutes,
    endsAtMinutes:
      rawEndMinutes <= startsAtMinutes
        ? rawEndMinutes + 24 * 60
        : rawEndMinutes,
  };
}

export function serviceSlotLocalDateTime(
  businessDate: string,
  serviceMinutes: number,
) {
  const dayOffset = Math.floor(serviceMinutes / (24 * 60));
  const localMinutes = serviceMinutes % (24 * 60);
  return {
    date: addIsoDays(businessDate, dayOffset),
    time: `${String(Math.floor(localMinutes / 60)).padStart(2, "0")}:${String(localMinutes % 60).padStart(2, "0")}`,
  };
}

export function servicePeriodAcceptsPartySize(
  partySize: number,
  minPartySize: number,
  maxPartySize: number,
) {
  return (
    Number.isInteger(partySize) &&
    partySize >= minPartySize &&
    partySize <= maxPartySize
  );
}

export function reservationDurationFitsServiceWindow(
  startsAt: string,
  durationMinutes: number,
  serviceEndsAt: string,
) {
  const start = new Date(startsAt).valueOf();
  const serviceEnd = new Date(serviceEndsAt).valueOf();
  return (
    Number.isFinite(start) &&
    Number.isInteger(durationMinutes) &&
    durationMinutes > 0 &&
    Number.isFinite(serviceEnd) &&
    start + durationMinutes * 60_000 <= serviceEnd
  );
}

export interface ServiceShiftPolicyException {
  kind: "closure" | "pacing_override" | "buffer_override";
  startsAt: string;
  endsAt: string;
  pacingIntervalMinutes: number | null;
  pacingCoverLimit: number | null;
  openingBufferMinutes: number | null;
  closingBufferMinutes: number | null;
}

export function resolveServiceShiftBookableWindow({
  startsAt,
  endsAt,
  exceptions,
}: {
  startsAt: string;
  endsAt: string;
  exceptions: readonly ServiceShiftPolicyException[];
}) {
  const buffer = exceptions.find(
    (exception) => exception.kind === "buffer_override",
  );
  return {
    startsAt:
      new Date(startsAt).valueOf() +
      (buffer?.openingBufferMinutes ?? 0) * 60_000,
    endsAt:
      new Date(endsAt).valueOf() -
      (buffer?.closingBufferMinutes ?? 0) * 60_000,
  };
}

export function resolveServiceShiftSlotPolicy({
  startsAt,
  endsAt,
  exceptions,
  pacingIntervalMinutes,
  pacingCoverLimit,
}: {
  startsAt: number;
  endsAt: number;
  exceptions: readonly ServiceShiftPolicyException[];
  pacingIntervalMinutes: number;
  pacingCoverLimit: number;
}) {
  const closure = exceptions.some(
    (exception) =>
      exception.kind === "closure" &&
      startsAt < new Date(exception.endsAt).valueOf() &&
      endsAt > new Date(exception.startsAt).valueOf(),
  );
  const pacing = exceptions.find(
    (exception) =>
      exception.kind === "pacing_override" &&
      startsAt >= new Date(exception.startsAt).valueOf() &&
      startsAt < new Date(exception.endsAt).valueOf(),
  );
  return {
    isClosed: closure,
    pacingIntervalMinutes:
      pacing?.pacingIntervalMinutes ?? pacingIntervalMinutes,
    pacingCoverLimit: pacing?.pacingCoverLimit ?? pacingCoverLimit,
  };
}
