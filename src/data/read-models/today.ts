import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { hasAnyCapability } from "@/lib/permissions/capabilities";
import { shiftBelongsToResolvedServiceDay } from "@/lib/service-day/business-date";
import { createClient } from "@/lib/supabase/server";
import {
  addIsoDays,
  formatLocalTime,
  localDateKey,
  readFailure,
  readSuccess,
  startOfWeekDate,
  type LiveReadResult,
} from "./shared";
import { loadLiveServiceDayContext } from "./service-day-context";

export interface LiveTodayShift {
  id: string;
  employeeId: string | null;
  employeeName: string;
  jobName: string;
  department: string | null;
  startsAt: string;
  endsAt: string;
  startLabel: string;
  endLabel: string;
  status: string;
  isOpen: boolean;
  clockedIn: boolean;
}

export interface LiveTodayTask {
  id: string;
  title: string;
  priority: string;
  status: string;
  dueAt: string | null;
  assigneeName: string | null;
}

export interface LiveTodayAnnouncement {
  id: string;
  body: string;
  authorName: string;
  createdAt: string;
}

export interface LiveTodayModel {
  date: string;
  timeZone: string;
  currencyCode: string;
  shifts: LiveTodayShift[];
  scheduledCount: number;
  openShiftCount: number;
  clockedInCount: number;
  openPunchCount: number;
  tasks: LiveTodayTask[];
  openTaskCount: number;
  announcements: LiveTodayAnnouncement[];
  closeout: {
    status: string;
    netSalesCents: number;
    covers: number;
  } | null;
  pendingInventoryCounts: number;
  configuredParLevels: number;
  operatingService?: {
    source:
      | "materialized_service_shift"
      | "reservation_service_period"
      | "published_shift"
      | "calendar";
    name: string | null;
    startsAt: string | null;
    endsAt: string | null;
    state:
      | "approved"
      | "internal"
      | "closed"
      | "schedule_only"
      | "unconfigured";
  };
  currentEmployeeId?: string | null;
}

type ShiftRow = {
  id: string;
  employee_id: string | null;
  job_role_id: string;
  starts_at: string;
  ends_at: string;
  status: string;
  is_open: boolean;
};

export async function loadLiveToday(
  workspace: WorkspaceContextValue,
  observedAt = new Date().toISOString(),
): Promise<LiveReadResult<LiveTodayModel>> {
  try {
    const supabase = await createClient();
    const locationId = workspace.activeLocation.id;
    const organizationId = workspace.organization.id;
    const [
      { data: location, error: locationError },
      { data: organization, error: organizationError },
    ] = await Promise.all([
      supabase
        .from("locations")
        .select("timezone")
        .eq("id", locationId)
        .eq("organization_id", organizationId)
        .single(),
      supabase
        .from("organizations")
        .select("currency_code")
        .eq("id", organizationId)
        .single(),
    ]);
    if (locationError || organizationError || !location || !organization) return readFailure();

    const timeZone = location.timezone;
    const now = new Date(observedAt);
    const serviceDayResult = await loadLiveServiceDayContext(workspace, observedAt);
    if (!serviceDayResult.ok || serviceDayResult.data.timeZone !== timeZone) {
      return readFailure("The operating business date could not be resolved.");
    }
    const date = serviceDayResult.data.businessDate;
    const canReadTasksByRole = workspace.role !== "employee" && workspace.persona !== "chef";
    const canReadCloseout = hasAnyCapability(workspace.capabilities, [
      "closeout.create",
      "closeout.approve",
      "reports.financial.view",
    ]);
    const canReadInventoryCounts = hasAnyCapability(workspace.capabilities, [
      "inventory.count.create",
      "inventory.count.approve",
    ]);
    const canReadParLevels = hasAnyCapability(workspace.capabilities, [
      "inventory.par.manage",
      "inventory.count.create",
      "inventory.purchase.create",
      "prep.manage",
    ]);
    const { data: currentEmployee, error: currentEmployeeError } = await supabase
      .from("employees")
      .select("id")
      .eq("organization_id", organizationId)
      .eq("user_id", workspace.identity.userId)
      .eq("employment_status", "active")
      .maybeSingle();
    if (currentEmployeeError) return readFailure();
    const currentEmployeeId = currentEmployee?.id ?? null;
    const { data: settings, error: settingsError } = await supabase
      .from("organization_settings")
      .select("week_starts_on")
      .eq("organization_id", organizationId)
      .maybeSingle();
    if (settingsError) return readFailure();
    const weekStart = startOfWeekDate(now, timeZone, settings?.week_starts_on ?? 1);
    const scheduleWeeks = [addIsoDays(weekStart, -7), weekStart];
    const publishedScheduleResults = await Promise.all(
      scheduleWeeks.map((scheduleWeek) =>
        supabase
          .from("schedules")
          .select("id, week_start, version")
          .eq("organization_id", organizationId)
          .eq("location_id", locationId)
          .eq("week_start", scheduleWeek)
          .eq("status", "published")
          .order("version", { ascending: false })
          .order("id")
          .limit(1),
      ),
    );
    if (publishedScheduleResults.some((result) => result.error)) return readFailure();
    const publishedScheduleIds = publishedScheduleResults.flatMap((result) =>
      (result.data ?? []).map((schedule) => schedule.id),
    );
    const broadStart = new Date(now.getTime() - 36 * 60 * 60 * 1_000).toISOString();
    const broadEnd = new Date(now.getTime() + 48 * 60 * 60 * 1_000).toISOString();

    const [shiftResult, openPunchResult] = await Promise.all([
      publishedScheduleIds.length
        ? supabase
            .from("shifts")
            .select("id, employee_id, job_role_id, starts_at, ends_at, status, is_open")
            .eq("organization_id", organizationId)
            .eq("location_id", locationId)
            .in("schedule_id", publishedScheduleIds)
            .lt("starts_at", broadEnd)
            .gt("ends_at", broadStart)
            .neq("status", "cancelled")
            .order("starts_at")
        : Promise.resolve({ data: [], error: null }),
      supabase
        .from("time_entries")
        .select("id, employee_id, scheduled_shift_id")
        .eq("organization_id", organizationId)
        .eq("location_id", locationId)
        .is("clocked_out_at", null),
    ]);
    if (shiftResult.error || openPunchResult.error) return readFailure();
    const broadShifts = (shiftResult.data ?? []) as ShiftRow[];

    const [
      taskResult,
      announcementResult,
      closeoutResult,
      countResult,
      parResult,
    ] = await Promise.all([
      canReadTasksByRole
        ? supabase
            .from("tasks")
            .select("id, title, priority, status, due_at, assigned_employee_id", { count: "exact" })
            .eq("organization_id", organizationId)
            .or(`location_id.is.null,location_id.eq.${locationId}`)
            .in("status", ["open", "in_progress", "blocked"])
            .order("due_at", { ascending: true, nullsFirst: false })
            .limit(8)
        : Promise.resolve({ data: [], error: null, count: 0 }),
      supabase
        .from("chat_messages")
        .select("id, body, author_id, created_at")
        .eq("organization_id", organizationId)
        .eq("is_announcement", true)
        .is("deleted_at", null)
        .order("created_at", { ascending: false })
        .limit(3),
      canReadCloseout
        ? supabase
            .from("shift_closeouts")
            .select("status, net_sales_cents, covers, submitted_at")
            .eq("organization_id", organizationId)
            .eq("location_id", locationId)
            .eq("business_date", date)
            .order("submitted_at", { ascending: false })
            .limit(1)
        : Promise.resolve({ data: [], error: null }),
      canReadInventoryCounts
        ? supabase
            .from("inventory_counts")
            .select("id", { count: "exact", head: true })
            .eq("organization_id", organizationId)
            .eq("location_id", locationId)
            .in("status", ["pending", "in_review"])
        : Promise.resolve({ data: [], error: null, count: 0 }),
      canReadParLevels
        ? supabase
            .from("inventory_par_levels")
            .select("inventory_item_id")
            .eq("organization_id", organizationId)
            .eq("location_id", locationId)
            .lte("effective_from", date)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (
      taskResult.error ||
      announcementResult.error ||
      closeoutResult.error ||
      countResult.error ||
      parResult.error
    ) {
      return readFailure();
    }

    const visibleShifts = workspace.role === "employee"
      ? broadShifts.filter((shift) => shift.is_open || shift.employee_id === currentEmployeeId)
      : broadShifts;
    const todayShifts = visibleShifts.filter((shift) =>
      serviceDayResult.data.startsAt && serviceDayResult.data.endsAt
        ? shiftBelongsToResolvedServiceDay(
            { startsAt: shift.starts_at, endsAt: shift.ends_at },
            timeZone,
            {
              businessDate: date,
              startsAt: serviceDayResult.data.startsAt,
              endsAt: serviceDayResult.data.endsAt,
            },
          )
        : localDateKey(shift.starts_at, timeZone) === date,
    );
    const employeeIds = [
      ...new Set(
        [
          ...todayShifts.map((shift) => shift.employee_id),
          ...(taskResult.data ?? []).map((task) => task.assigned_employee_id),
        ].filter((value): value is string => Boolean(value)),
      ),
    ];
    const jobRoleIds = [...new Set(todayShifts.map((shift) => shift.job_role_id))];
    const authorIds = [
      ...new Set((announcementResult.data ?? []).map((message) => message.author_id)),
    ];

    const [employeeResult, roleResult, profileResult] = await Promise.all([
      employeeIds.length
        ? supabase
            .from("employees")
            .select("id, display_name")
            .eq("organization_id", organizationId)
            .in("id", employeeIds)
        : Promise.resolve({ data: [], error: null }),
      jobRoleIds.length
        ? supabase
            .from("job_roles")
            .select("id, name, department")
            .eq("organization_id", organizationId)
            .in("id", jobRoleIds)
        : Promise.resolve({ data: [], error: null }),
      authorIds.length
        ? supabase.from("profiles").select("id, display_name, preferred_name").in("id", authorIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    if (employeeResult.error || roleResult.error || profileResult.error) return readFailure();

    const employeeNames = new Map(
      (employeeResult.data ?? []).map((employee) => [employee.id, employee.display_name]),
    );
    const roleDetails = new Map(
      (roleResult.data ?? []).map((role) => [role.id, { name: role.name, department: role.department }]),
    );
    const profileNames = new Map(
      (profileResult.data ?? []).map((profile) => [
        profile.id,
        profile.preferred_name?.trim() || profile.display_name,
      ]),
    );
    const clockedShiftIds = new Set(
      (openPunchResult.data ?? [])
        .map((entry) => entry.scheduled_shift_id)
        .filter((value): value is string => Boolean(value)),
    );

    return readSuccess({
      date,
      timeZone,
      currencyCode: organization.currency_code,
      shifts: todayShifts.map((shift) => ({
        id: shift.id,
        employeeId: shift.employee_id,
        employeeName: shift.employee_id
          ? employeeNames.get(shift.employee_id) ?? "Assigned team member"
          : "Open shift",
        jobName: roleDetails.get(shift.job_role_id)?.name ?? "Assigned role",
        department: roleDetails.get(shift.job_role_id)?.department ?? null,
        startsAt: shift.starts_at,
        endsAt: shift.ends_at,
        startLabel: formatLocalTime(shift.starts_at, timeZone),
        endLabel: formatLocalTime(shift.ends_at, timeZone),
        status: shift.status,
        isOpen: shift.is_open,
        clockedIn: clockedShiftIds.has(shift.id),
      })),
      scheduledCount: todayShifts.length,
      openShiftCount: todayShifts.filter((shift) => shift.is_open).length,
      clockedInCount: todayShifts.filter((shift) => clockedShiftIds.has(shift.id)).length,
      openPunchCount: openPunchResult.data?.length ?? 0,
      tasks: (taskResult.data ?? []).map((task) => ({
        id: task.id,
        title: task.title,
        priority: task.priority,
        status: task.status,
        dueAt: task.due_at,
        assigneeName: task.assigned_employee_id
          ? employeeNames.get(task.assigned_employee_id) ?? "Assigned teammate"
          : null,
      })),
      openTaskCount: taskResult.count ?? taskResult.data?.length ?? 0,
      announcements: (announcementResult.data ?? []).map((message) => ({
        id: message.id,
        body: message.body,
        authorName: profileNames.get(message.author_id) ?? "Management",
        createdAt: message.created_at,
      })),
      closeout: closeoutResult.data?.[0]
        ? {
            status: closeoutResult.data[0].status,
            netSalesCents: Number(closeoutResult.data[0].net_sales_cents),
            covers: closeoutResult.data[0].covers,
          }
        : null,
      pendingInventoryCounts: countResult.count ?? countResult.data?.length ?? 0,
      configuredParLevels: new Set(
        (parResult.data ?? []).map((par) => par.inventory_item_id),
      ).size,
      operatingService: {
        source: serviceDayResult.data.source,
        name: serviceDayResult.data.serviceName,
        startsAt: serviceDayResult.data.startsAt,
        endsAt: serviceDayResult.data.endsAt,
        state: serviceDayResult.data.configurationState,
      },
      currentEmployeeId,
    });
  } catch {
    return readFailure();
  }
}
