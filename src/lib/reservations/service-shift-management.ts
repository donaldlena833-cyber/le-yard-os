import { addIsoDays, zonedLocalToIso } from "@/data/read-models/local-time";

export type ServiceShiftExceptionKind =
  | "closure"
  | "pacing_override"
  | "buffer_override";

export interface ServiceShiftExceptionSummary {
  id: string;
  kind: ServiceShiftExceptionKind;
  status: "active";
  startsAt: string;
  endsAt: string;
  pacingIntervalMinutes: number | null;
  pacingCoverLimit: number | null;
  openingBufferMinutes: number | null;
  closingBufferMinutes: number | null;
  reason: string;
}

export interface ServiceShiftSummary {
  id: string;
  servicePeriodId: string;
  name: string;
  businessDate: string;
  startsAt: string;
  endsAt: string;
  defaultDurationMinutes: number;
  pacingIntervalMinutes: number;
  pacingCoverLimit: number;
  minPartySize: number;
  maxPartySize: number;
  onlineEnabled: boolean;
  status: string;
  configurationState: string;
  exceptions: ServiceShiftExceptionSummary[];
}

export interface ServiceShiftManagementModel {
  businessDate: string;
  timeZone: string;
  shifts: ServiceShiftSummary[];
}

export interface ServiceShiftBoundaryOption {
  value: string;
  label: string;
}

const boundaryFormatterCache = new Map<string, Intl.DateTimeFormat>();

function boundaryFormatter(timeZone: string): Intl.DateTimeFormat {
  const cached = boundaryFormatterCache.get(timeZone);
  if (cached) return cached;
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "short",
    hour: "numeric",
    minute: "2-digit",
    timeZoneName: "short",
  });
  boundaryFormatterCache.set(timeZone, formatter);
  return formatter;
}

export function formatServiceShiftBoundary(
  value: string,
  timeZone: string,
): string {
  return boundaryFormatter(timeZone).format(new Date(value));
}

export function buildServiceShiftBoundaryOptions(
  shift: Pick<ServiceShiftSummary, "startsAt" | "endsAt">,
  timeZone: string,
  intervalMinutes = 15,
): ServiceShiftBoundaryOption[] {
  const startsAt = new Date(shift.startsAt).valueOf();
  const endsAt = new Date(shift.endsAt).valueOf();
  if (
    !Number.isFinite(startsAt) ||
    !Number.isFinite(endsAt) ||
    endsAt <= startsAt ||
    !Number.isInteger(intervalMinutes) ||
    intervalMinutes < 1
  ) {
    return [];
  }

  const values: number[] = [];
  const intervalMs = intervalMinutes * 60_000;
  for (let cursor = startsAt; cursor < endsAt; cursor += intervalMs) {
    values.push(cursor);
    if (values.length > 192) return [];
  }
  values.push(endsAt);

  return values.map((value) => {
    const instant = new Date(value).toISOString();
    return {
      value: instant,
      label: formatServiceShiftBoundary(instant, timeZone),
    };
  });
}

export function serviceShiftExceptionLabel(
  kind: ServiceShiftExceptionKind,
): string {
  if (kind === "pacing_override") return "Pacing override";
  if (kind === "buffer_override") return "Booking buffer override";
  return "Closure";
}

export function createDemoServiceShiftManagement(
  businessDate: string,
  timeZone: string,
): ServiceShiftManagementModel {
  const startsAt = zonedLocalToIso(businessDate, "17:00", timeZone);
  const endsAt = zonedLocalToIso(
    addIsoDays(businessDate, 1),
    "02:00",
    timeZone,
  );
  return {
    businessDate,
    timeZone,
    shifts:
      startsAt && endsAt
        ? [
            {
              id: "demo-service-shift-dinner",
              servicePeriodId: "demo-service-period-dinner",
              name: "Dinner",
              businessDate,
              startsAt,
              endsAt,
              defaultDurationMinutes: 90,
              pacingIntervalMinutes: 15,
              pacingCoverLimit: 14,
              minPartySize: 1,
              maxPartySize: 10,
              onlineEnabled: false,
              status: "scheduled",
              configurationState: "approved",
              exceptions: [],
            },
          ]
        : [],
  };
}
