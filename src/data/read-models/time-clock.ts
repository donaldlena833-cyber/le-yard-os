import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/server";
import {
  formatLocalTime,
  localDateKey,
  localDateTimeParts,
  readFailure,
  readSuccess,
  type LiveReadResult,
} from "./shared";

export interface LiveTimeRole {
  id: string;
  name: string;
  code: string;
}

export interface LiveTimeBreak {
  id: string;
  startedAt: string;
  endedAt: string | null;
  isPaid: boolean;
}

export interface LiveTimeEntry {
  id: string;
  employeeId: string;
  employeeName: string;
  jobRoleId: string;
  jobName: string;
  scheduledShiftId: string | null;
  clockedInAt: string;
  clockedOutAt: string | null;
  clockedInLabel: string;
  clockedOutLabel: string | null;
  status: string;
  source: string;
  sourceProvider: string | null;
  breaks: LiveTimeBreak[];
  paidBreakMinutes: number;
  unpaidBreakMinutes: number;
  workedMinutes: number;
}

export interface LiveTimeShift {
  id: string;
  employeeId: string | null;
  employeeName: string;
  jobRoleId: string;
  jobName: string;
  startsAt: string;
  endsAt: string;
  startLabel: string;
  endLabel: string;
  status: string;
}

export interface LiveTimeCorrection {
  id: string;
  timeEntryId: string;
  employeeName: string;
  requestedByUserId: string;
  originalClockedInAt: string;
  originalClockedOutAt: string | null;
  proposedClockedInAt: string | null;
  proposedClockedOutAt: string | null;
  proposedJobRoleId: string | null;
  proposedJobName: string | null;
  reason: string;
  status: string;
  createdAt: string;
  decidedAt: string | null;
  decisionNote: string | null;
}

export interface LiveRosterRow {
  employeeId: string;
  employeeName: string;
  jobRoleId: string;
  jobName: string;
  shiftId: string | null;
  shiftStartsAt: string | null;
  shiftEndsAt: string | null;
  shiftLabel: string | null;
  status: "clocked_in" | "on_break" | "scheduled" | "exception";
  clockedInAt: string | null;
  hasPendingCorrection: boolean;
}

export interface LiveTimeClockModel {
  date: string;
  timeZone: string;
  canManage: boolean;
  employee: { id: string; displayName: string } | null;
  roles: LiveTimeRole[];
  shifts: LiveTimeShift[];
  activeEntry: LiveTimeEntry | null;
  recentEntries: LiveTimeEntry[];
  roster: LiveRosterRow[];
  corrections: LiveTimeCorrection[];
  posSource: {
    provider: "toast";
    connectionStatus: string;
    lastSyncedAt: string | null;
    lastJobStatus: string | null;
    lastJobCompletedAt: string | null;
    stale: boolean;
  };
}

type EntryRow = {
  id: string;
  employee_id: string;
  job_role_id: string;
  scheduled_shift_id: string | null;
  clocked_in_at: string;
  clocked_out_at: string | null;
  status: string;
  source: string;
  source_provider: string | null;
};

type BreakRow = {
  id: string;
  time_entry_id: string;
  started_at: string;
  ended_at: string | null;
  is_paid: boolean;
};

type ShiftRow = {
  id: string;
  employee_id: string | null;
  job_role_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
};

type CorrectionRow = {
  id: string;
  time_entry_id: string;
  requested_by: string;
  proposed_clocked_in_at: string | null;
  proposed_clocked_out_at: string | null;
  proposed_job_role_id: string | null;
  reason: string;
  status: string;
  created_at: string;
  decided_at: string | null;
  decision_note: string | null;
};

function minutesBetween(start: string, end: string | null, now: number): number {
  const startMs = new Date(start).getTime();
  const endMs = end ? new Date(end).getTime() : now;
  return Math.max(0, Math.round((endMs - startMs) / 60_000));
}

export async function loadLiveTimeClock(
  workspace: WorkspaceContextValue,
): Promise<LiveReadResult<LiveTimeClockModel>> {
  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const locationId = workspace.activeLocation.id;
    const canManage = workspace.role !== "employee";
    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("timezone")
      .eq("id", locationId)
      .eq("organization_id", organizationId)
      .single();
    if (locationError || !location) return readFailure();

    const timeZone = location.timezone;
    const now = new Date();
    const nowMs = now.getTime();
    const date = localDateKey(now, timeZone);
    const broadStart = new Date(nowMs - 36 * 60 * 60 * 1_000).toISOString();
    const broadEnd = new Date(nowMs + 48 * 60 * 60 * 1_000).toISOString();

    const [employeeResult, scheduleResult, syncStatusResult] = await Promise.all([
      supabase
        .from("employees")
        .select("id, display_name")
        .eq("organization_id", organizationId)
        .eq("user_id", workspace.identity.userId)
        .eq("employment_status", "active")
        .maybeSingle(),
      supabase
        .from("schedules")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("location_id", locationId)
        .eq("status", "published")
        .order("week_start", { ascending: false })
        .limit(8),
      supabase.rpc("get_pos_labor_sync_status", { p_location_id: locationId }),
    ]);
    if (employeeResult.error || scheduleResult.error || syncStatusResult.error) {
      return readFailure();
    }

    const employee = employeeResult.data;
    const scheduleIds = (scheduleResult.data ?? []).map((schedule) => schedule.id);
    const emptyResult = Promise.resolve({ data: [], error: null });
    const [assignmentResult, selfEntryResult, shiftResult, locationEntryResult, correctionResult] =
      await Promise.all([
        employee
          ? supabase
              .from("employee_job_roles")
              .select("job_role_id")
              .eq("organization_id", organizationId)
              .eq("location_id", locationId)
              .eq("employee_id", employee.id)
              .lte("effective_from", date)
              .or(`effective_to.is.null,effective_to.gte.${date}`)
          : emptyResult,
        employee
          ? supabase
              .from("time_entries")
              .select(
                "id, employee_id, job_role_id, scheduled_shift_id, clocked_in_at, clocked_out_at, status, source, source_provider",
              )
              .eq("organization_id", organizationId)
              .eq("employee_id", employee.id)
              .is("source_deleted_at", null)
              .order("clocked_in_at", { ascending: false })
              .limit(16)
          : emptyResult,
        scheduleIds.length
          ? supabase
              .from("shifts")
              .select("id, employee_id, job_role_id, starts_at, ends_at, status")
              .eq("organization_id", organizationId)
              .eq("location_id", locationId)
              .in("schedule_id", scheduleIds)
              .gte("starts_at", broadStart)
              .lte("starts_at", broadEnd)
              .neq("status", "cancelled")
              .order("starts_at")
          : emptyResult,
        canManage
          ? supabase
              .from("time_entries")
              .select(
                "id, employee_id, job_role_id, scheduled_shift_id, clocked_in_at, clocked_out_at, status, source, source_provider",
              )
              .eq("organization_id", organizationId)
              .eq("location_id", locationId)
              .is("source_deleted_at", null)
              .or(`clocked_in_at.gte.${broadStart},clocked_out_at.is.null`)
              .order("clocked_in_at", { ascending: false })
              .limit(160)
          : emptyResult,
        supabase
          .from("time_entry_corrections")
          .select(
            "id, time_entry_id, requested_by, proposed_clocked_in_at, proposed_clocked_out_at, proposed_job_role_id, reason, status, created_at, decided_at, decision_note",
          )
          .eq("organization_id", organizationId)
          .eq("location_id", locationId)
          .order("created_at", { ascending: false })
          .limit(50),
      ]);

    if (
      assignmentResult.error ||
      selfEntryResult.error ||
      shiftResult.error ||
      locationEntryResult.error ||
      correctionResult.error
    ) {
      return readFailure();
    }

    const selfEntries = (selfEntryResult.data ?? []) as EntryRow[];
    const locationEntries = (locationEntryResult.data ?? []) as EntryRow[];
    const shifts = (shiftResult.data ?? []) as ShiftRow[];
    const correctionRows = (correctionResult.data ?? []) as CorrectionRow[];
    const knownEntries = new Map(
      [...selfEntries, ...locationEntries].map((entry) => [entry.id, entry]),
    );
    const missingCorrectionEntryIds = correctionRows
      .map((correction) => correction.time_entry_id)
      .filter((id) => !knownEntries.has(id));
    if (missingCorrectionEntryIds.length) {
      const { data: correctionEntries, error: correctionEntryError } = await supabase
        .from("time_entries")
        .select(
          "id, employee_id, job_role_id, scheduled_shift_id, clocked_in_at, clocked_out_at, status, source, source_provider",
        )
        .eq("organization_id", organizationId)
        .is("source_deleted_at", null)
        .in("id", missingCorrectionEntryIds);
      if (correctionEntryError) return readFailure();
      for (const entry of (correctionEntries ?? []) as EntryRow[]) {
        knownEntries.set(entry.id, entry);
      }
    }

    const entryIds = [...knownEntries.keys()];
    const roleIds = [
      ...new Set([
        ...(assignmentResult.data ?? []).map((assignment) => assignment.job_role_id),
        ...shifts.map((shift) => shift.job_role_id),
        ...[...knownEntries.values()].map((entry) => entry.job_role_id),
        ...correctionRows
          .map((correction) => correction.proposed_job_role_id)
          .filter((id): id is string => Boolean(id)),
      ]),
    ];
    const employeeIds = [
      ...new Set([
        ...shifts.map((shift) => shift.employee_id).filter((id): id is string => Boolean(id)),
        ...[...knownEntries.values()].map((entry) => entry.employee_id),
      ]),
    ];
    const [breakResult, roleResult, employeeNameResult] = await Promise.all([
      entryIds.length
        ? supabase
            .from("time_breaks")
            .select("id, time_entry_id, started_at, ended_at, is_paid")
            .eq("organization_id", organizationId)
            .is("source_deleted_at", null)
            .in("time_entry_id", entryIds)
            .order("started_at")
        : emptyResult,
      roleIds.length
        ? supabase
            .from("job_roles")
            .select("id, name, code")
            .eq("organization_id", organizationId)
            .in("id", roleIds)
        : emptyResult,
      employeeIds.length
        ? supabase
            .from("employees")
            .select("id, display_name")
            .eq("organization_id", organizationId)
            .in("id", employeeIds)
        : emptyResult,
    ]);
    if (breakResult.error || roleResult.error || employeeNameResult.error) {
      return readFailure();
    }

    const roleRows = (roleResult.data ?? []) as Array<{
      id: string;
      name: string;
      code: string;
    }>;
    const roleNames = new Map(roleRows.map((role) => [role.id, role.name]));
    const employeeNames = new Map(
      (employeeNameResult.data ?? []).map((row) => [row.id, row.display_name]),
    );
    if (employee) employeeNames.set(employee.id, employee.display_name);
    const breaks = (breakResult.data ?? []) as BreakRow[];

    function mapEntry(entry: EntryRow): LiveTimeEntry {
      const entryBreaks = breaks
        .filter((breakRow) => breakRow.time_entry_id === entry.id)
        .map((breakRow) => ({
          id: breakRow.id,
          startedAt: breakRow.started_at,
          endedAt: breakRow.ended_at,
          isPaid: breakRow.is_paid,
        }));
      const paidBreakMinutes = entryBreaks
        .filter((breakRow) => breakRow.isPaid)
        .reduce(
          (sum, breakRow) =>
            sum + minutesBetween(breakRow.startedAt, breakRow.endedAt, nowMs),
          0,
        );
      const unpaidBreakMinutes = entryBreaks
        .filter((breakRow) => !breakRow.isPaid)
        .reduce(
          (sum, breakRow) =>
            sum + minutesBetween(breakRow.startedAt, breakRow.endedAt, nowMs),
          0,
        );
      return {
        id: entry.id,
        employeeId: entry.employee_id,
        employeeName: employeeNames.get(entry.employee_id) ?? "Team member",
        jobRoleId: entry.job_role_id,
        jobName: roleNames.get(entry.job_role_id) ?? "Assigned role",
        scheduledShiftId: entry.scheduled_shift_id,
        clockedInAt: entry.clocked_in_at,
        clockedOutAt: entry.clocked_out_at,
        clockedInLabel: formatLocalTime(entry.clocked_in_at, timeZone),
        clockedOutLabel: entry.clocked_out_at
          ? formatLocalTime(entry.clocked_out_at, timeZone)
          : null,
        status: entry.status,
        source: entry.source,
        sourceProvider: entry.source_provider,
        breaks: entryBreaks,
        paidBreakMinutes,
        unpaidBreakMinutes,
        workedMinutes: Math.max(
          0,
          minutesBetween(entry.clocked_in_at, entry.clocked_out_at, nowMs) -
            unpaidBreakMinutes,
        ),
      };
    }

    const todayShifts = shifts.filter(
      (shift) => localDateKey(shift.starts_at, timeZone) === date,
    );
    const mappedSelfEntries = selfEntries.map(mapEntry);
    const activeEntry = mappedSelfEntries.find((entry) => !entry.clockedOutAt) ?? null;
    const pendingCorrectionEntryIds = new Set(
      correctionRows
        .filter((correction) => correction.status === "pending")
        .map((correction) => correction.time_entry_id),
    );
    const openEntries = locationEntries.filter((entry) => !entry.clocked_out_at);
    const openByEmployee = new Map(openEntries.map((entry) => [entry.employee_id, entry]));
    const rosterByEmployee = new Map<string, LiveRosterRow>();
    for (const shift of todayShifts) {
      if (!shift.employee_id) continue;
      const openEntry = openByEmployee.get(shift.employee_id);
      const activeBreak = openEntry
        ? breaks.find(
            (breakRow) =>
              breakRow.time_entry_id === openEntry.id && breakRow.ended_at === null,
          )
        : null;
      rosterByEmployee.set(shift.employee_id, {
        employeeId: shift.employee_id,
        employeeName: employeeNames.get(shift.employee_id) ?? "Team member",
        jobRoleId: shift.job_role_id,
        jobName: roleNames.get(shift.job_role_id) ?? "Assigned role",
        shiftId: shift.id,
        shiftStartsAt: shift.starts_at,
        shiftEndsAt: shift.ends_at,
        shiftLabel: `${formatLocalTime(shift.starts_at, timeZone)}–${formatLocalTime(shift.ends_at, timeZone)}`,
        status: activeBreak ? "on_break" : openEntry ? "clocked_in" : "scheduled",
        clockedInAt: openEntry?.clocked_in_at ?? null,
        hasPendingCorrection: openEntry
          ? pendingCorrectionEntryIds.has(openEntry.id)
          : false,
      });
    }
    for (const entry of openEntries) {
      if (rosterByEmployee.has(entry.employee_id)) continue;
      const activeBreak = breaks.find(
        (breakRow) => breakRow.time_entry_id === entry.id && breakRow.ended_at === null,
      );
      rosterByEmployee.set(entry.employee_id, {
        employeeId: entry.employee_id,
        employeeName: employeeNames.get(entry.employee_id) ?? "Team member",
        jobRoleId: entry.job_role_id,
        jobName: roleNames.get(entry.job_role_id) ?? "Assigned role",
        shiftId: null,
        shiftStartsAt: null,
        shiftEndsAt: null,
        shiftLabel: null,
        status: activeBreak ? "on_break" : "exception",
        clockedInAt: entry.clocked_in_at,
        hasPendingCorrection: pendingCorrectionEntryIds.has(entry.id),
      });
    }

    const assignedRoleIds = new Set(
      (assignmentResult.data ?? []).map((assignment) => assignment.job_role_id),
    );
    const syncStatus = syncStatusResult.data?.[0] ?? null;
    const lastSyncedAt = syncStatus?.last_synced_at ?? null;
    return readSuccess({
      date,
      timeZone,
      canManage,
      employee: employee
        ? { id: employee.id, displayName: employee.display_name }
        : null,
      roles: roleRows
        .filter((role) => assignedRoleIds.has(role.id))
        .sort((left, right) => left.name.localeCompare(right.name)),
      shifts: todayShifts
        .filter((shift) => shift.employee_id === employee?.id)
        .map((shift) => ({
          id: shift.id,
          employeeId: shift.employee_id,
          employeeName: shift.employee_id
            ? employeeNames.get(shift.employee_id) ?? "Team member"
            : "Open shift",
          jobRoleId: shift.job_role_id,
          jobName: roleNames.get(shift.job_role_id) ?? "Assigned role",
          startsAt: shift.starts_at,
          endsAt: shift.ends_at,
          startLabel: formatLocalTime(shift.starts_at, timeZone),
          endLabel: formatLocalTime(shift.ends_at, timeZone),
          status: shift.status,
        })),
      activeEntry,
      recentEntries: mappedSelfEntries,
      roster: [...rosterByEmployee.values()].sort((left, right) =>
        left.employeeName.localeCompare(right.employeeName),
      ),
      corrections: correctionRows.flatMap((correction) => {
        const entry = knownEntries.get(correction.time_entry_id);
        if (!entry) return [];
        return [
          {
            id: correction.id,
            timeEntryId: correction.time_entry_id,
            employeeName: employeeNames.get(entry.employee_id) ?? "Team member",
            requestedByUserId: correction.requested_by,
            originalClockedInAt: entry.clocked_in_at,
            originalClockedOutAt: entry.clocked_out_at,
            proposedClockedInAt: correction.proposed_clocked_in_at,
            proposedClockedOutAt: correction.proposed_clocked_out_at,
            proposedJobRoleId: correction.proposed_job_role_id,
            proposedJobName: correction.proposed_job_role_id
              ? roleNames.get(correction.proposed_job_role_id) ?? "Assigned role"
              : null,
            reason: correction.reason,
            status: correction.status,
            createdAt: correction.created_at,
            decidedAt: correction.decided_at,
            decisionNote: correction.decision_note,
          },
        ];
      }),
      posSource: {
        provider: "toast",
        connectionStatus: syncStatus?.connection_status ?? "not_configured",
        lastSyncedAt,
        lastJobStatus: syncStatus?.last_job_status ?? null,
        lastJobCompletedAt: syncStatus?.last_job_completed_at ?? null,
        stale:
          !lastSyncedAt || nowMs - new Date(lastSyncedAt).getTime() > 15 * 60_000,
      },
    });
  } catch {
    return readFailure();
  }
}

export function timeEntryLocalDefaults(entry: LiveTimeEntry, timeZone: string) {
  return {
    clockedIn: localDateTimeParts(entry.clockedInAt, timeZone),
    clockedOut: entry.clockedOutAt
      ? localDateTimeParts(entry.clockedOutAt, timeZone)
      : null,
  };
}
