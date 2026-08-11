import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import type {
  ServiceShiftExceptionKind,
  ServiceShiftExceptionSummary,
  ServiceShiftManagementModel,
  ServiceShiftSummary,
} from "@/lib/reservations/service-shift-management";
import { createClient } from "@/lib/supabase/server";
import type { Database, Json } from "@/types/database.generated";
import { readFailure, readSuccess, type LiveReadResult } from "./shared";

type ServiceShiftSnapshotRow =
  Database["public"]["Functions"]["service_reservation_shift_snapshot"]["Returns"][number];

const exceptionKinds = new Set<ServiceShiftExceptionKind>([
  "closure",
  "pacing_override",
  "buffer_override",
]);

function requiredString(value: Json | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function nullableInteger(value: Json | undefined): number | null | undefined {
  if (value === null || value === undefined) return null;
  return typeof value === "number" && Number.isInteger(value)
    ? value
    : undefined;
}

function parseException(value: Json): ServiceShiftExceptionSummary | null {
  if (!value || Array.isArray(value) || typeof value !== "object") return null;
  const id = requiredString(value.id);
  const kind = requiredString(value.kind);
  const status = requiredString(value.status);
  const startsAt = requiredString(value.startsAt);
  const endsAt = requiredString(value.endsAt);
  const reason = requiredString(value.reason);
  const pacingIntervalMinutes = nullableInteger(value.pacingIntervalMinutes);
  const pacingCoverLimit = nullableInteger(value.pacingCoverLimit);
  const openingBufferMinutes = nullableInteger(value.openingBufferMinutes);
  const closingBufferMinutes = nullableInteger(value.closingBufferMinutes);
  if (
    !id ||
    !kind ||
    !exceptionKinds.has(kind as ServiceShiftExceptionKind) ||
    status !== "active" ||
    !startsAt ||
    !endsAt ||
    !reason ||
    pacingIntervalMinutes === undefined ||
    pacingCoverLimit === undefined ||
    openingBufferMinutes === undefined ||
    closingBufferMinutes === undefined
  ) {
    return null;
  }
  return {
    id,
    kind: kind as ServiceShiftExceptionKind,
    status,
    startsAt,
    endsAt,
    pacingIntervalMinutes,
    pacingCoverLimit,
    openingBufferMinutes,
    closingBufferMinutes,
    reason,
  };
}

function parseExceptions(value: Json | null): ServiceShiftExceptionSummary[] | null {
  if (!Array.isArray(value)) return null;
  const parsed = value.map(parseException);
  return parsed.every(
    (exception): exception is ServiceShiftExceptionSummary => Boolean(exception),
  )
    ? parsed
    : null;
}

function parseShift(row: ServiceShiftSnapshotRow): ServiceShiftSummary | null {
  const exceptions = parseExceptions(row.exceptions);
  if (
    !row.shiftId ||
    !row.servicePeriodId ||
    !row.name ||
    !row.businessDate ||
    !row.startsAt ||
    !row.endsAt ||
    row.defaultDurationMinutes === null ||
    row.pacingIntervalMinutes === null ||
    row.pacingCoverLimit === null ||
    row.minPartySize === null ||
    row.maxPartySize === null ||
    row.onlineEnabled === null ||
    !row.status ||
    !row.configurationState ||
    !exceptions
  ) {
    return null;
  }
  return {
    id: row.shiftId,
    servicePeriodId: row.servicePeriodId,
    name: row.name,
    businessDate: row.businessDate,
    startsAt: row.startsAt,
    endsAt: row.endsAt,
    defaultDurationMinutes: row.defaultDurationMinutes,
    pacingIntervalMinutes: row.pacingIntervalMinutes,
    pacingCoverLimit: row.pacingCoverLimit,
    minPartySize: row.minPartySize,
    maxPartySize: row.maxPartySize,
    onlineEnabled: row.onlineEnabled,
    status: row.status,
    configurationState: row.configurationState,
    exceptions,
  };
}

export function parseServiceShiftSnapshotRows(
  rows: ServiceShiftSnapshotRow[],
): ServiceShiftSummary[] | null {
  const shifts = rows.map(parseShift);
  return shifts.every((shift): shift is ServiceShiftSummary => Boolean(shift))
    ? shifts
    : null;
}

export async function loadLiveReservationServiceShifts(
  workspace: WorkspaceContextValue,
  businessDate: string,
): Promise<LiveReadResult<ServiceShiftManagementModel>> {
  const timeZone = workspace.activeLocation.timeZone;
  if (!timeZone)
    return readFailure("The active location timezone is not configured.");
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "service_reservation_shift_snapshot",
    {
      p_organization_id: workspace.organization.id,
      p_location_id: workspace.activeLocation.id,
      p_business_date: businessDate,
    },
  );
  if (error)
    return readFailure("Service-shift controls could not be loaded.");
  const shifts = parseServiceShiftSnapshotRows(data ?? []);
  return shifts
    ? readSuccess({ businessDate, timeZone, shifts })
    : readFailure("Service-shift evidence was incomplete or invalid.");
}
