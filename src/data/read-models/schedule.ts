import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { hasCapability } from "@/lib/permissions/capabilities";
import { createClient } from "@/lib/supabase/server";
import {
  addIsoDays,
  formatLocalTime,
  isIsoCalendarDate,
  localDateKey,
  localDateTimeParts,
  readFailure,
  readSuccess,
  startOfWeekDate,
  type LiveReadResult,
} from "./shared";

export interface LiveScheduleShift {
  id: string;
  employeeId: string | null;
  employeeName: string;
  jobRoleId: string;
  jobName: string;
  startsAt: string;
  endsAt: string;
  date: string;
  startLabel: string;
  endLabel: string;
  startLocal: string;
  endLocal: string;
  breakMinutes: number;
  status: string;
  isOpen: boolean;
  notes: string | null;
  acknowledged: boolean;
}

export interface LiveSwapOffer {
  id: string;
  employeeId: string;
  employeeName: string;
  message: string | null;
  status: string;
}

export interface LiveSwapRequest {
  id: string;
  shiftId: string;
  requestedByEmployeeId: string;
  requestedByName: string;
  reason: string | null;
  status: string;
  offers: LiveSwapOffer[];
}

export interface LiveScheduleModel {
  weekStart: string;
  previousWeek: string;
  nextWeek: string;
  weekDates: string[];
  timeZone: string;
  canManage: boolean;
  canPublish: boolean;
  selfEmployeeId: string | null;
  schedule: {
    id: string;
    status: "draft" | "published" | "archived";
    version: number;
    publishedAt: string | null;
  } | null;
  shifts: LiveScheduleShift[];
  employees: { id: string; name: string }[];
  jobRoles: { id: string; name: string; code: string }[];
  templates: { id: string; name: string; shiftCount: number }[];
  swaps: LiveSwapRequest[];
}

function validDate(value: string | undefined): value is string {
  return Boolean(value && isIsoCalendarDate(value));
}

export async function loadLiveSchedule(
  workspace: WorkspaceContextValue,
  requestedWeek?: string,
): Promise<LiveReadResult<LiveScheduleModel>> {
  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const locationId = workspace.activeLocation.id;
    const [{ data: location, error: locationError }, { data: settings, error: settingsError }] = await Promise.all([
      supabase
        .from("locations")
        .select("timezone")
        .eq("organization_id", organizationId)
        .eq("id", locationId)
        .single(),
      supabase
        .from("organization_settings")
        .select("week_starts_on")
        .eq("organization_id", organizationId)
        .maybeSingle(),
    ]);
    if (locationError || settingsError || !location) return readFailure("The live schedule could not be loaded. Try again.");

    const weekStartsOn = settings?.week_starts_on ?? 1;
    const fallbackWeek = startOfWeekDate(new Date(), location.timezone, weekStartsOn);
    const candidateWeek = validDate(requestedWeek) ? requestedWeek : fallbackWeek;
    const candidateWeekday = new Date(`${candidateWeek}T00:00:00Z`).getUTCDay();
    const weekStart = addIsoDays(candidateWeek, -((candidateWeekday - weekStartsOn + 7) % 7));
    const weekDates = Array.from({ length: 7 }, (_, index) => addIsoDays(weekStart, index));
    const canManage = hasCapability(
      workspace.capabilities,
      "schedule.manage",
    );
    const canPublish = hasCapability(
      workspace.capabilities,
      "schedule.publish",
    );

    const [scheduleResult, jobRoleResult, employeeResult, templateResult, selfEmployeeResult] = await Promise.all([
      supabase
        .from("schedules")
        .select("id, status, version, published_at")
        .eq("organization_id", organizationId)
        .eq("location_id", locationId)
        .eq("week_start", weekStart)
        .order("version", { ascending: false })
        .limit(1),
      supabase
        .from("job_roles")
        .select("id, name, code")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("employees")
        .select("id, display_name, user_id")
        .eq("organization_id", organizationId)
        .in("employment_status", ["active", "invited"])
        .order("display_name"),
      supabase
        .from("schedule_templates")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("location_id", locationId)
        .eq("is_active", true)
        .order("name"),
      supabase
        .from("employees")
        .select("id")
        .eq("organization_id", organizationId)
        .eq("user_id", workspace.identity.userId)
        .eq("employment_status", "active")
        .maybeSingle(),
    ]);
    if (
      scheduleResult.error ||
      jobRoleResult.error ||
      employeeResult.error ||
      templateResult.error ||
      selfEmployeeResult.error
    ) {
      return readFailure("The live schedule could not be loaded. Try again.");
    }

    const schedule = scheduleResult.data?.[0] ?? null;
    const templateIds = (templateResult.data ?? []).map((template) => template.id);
    const [shiftResult, acknowledgementResult, templateShiftResult, swapResult] = await Promise.all([
      schedule
        ? supabase
            .from("shifts")
            .select("id, employee_id, job_role_id, starts_at, ends_at, break_minutes, status, is_open, notes")
            .eq("organization_id", organizationId)
            .eq("schedule_id", schedule.id)
            .order("starts_at")
        : Promise.resolve({ data: [], error: null }),
      schedule
        ? supabase
            .from("shift_acknowledgements")
            .select("shift_id, employee_id")
            .eq("organization_id", organizationId)
        : Promise.resolve({ data: [], error: null }),
      templateIds.length
        ? supabase
            .from("schedule_template_shifts")
            .select("template_id")
            .eq("organization_id", organizationId)
            .in("template_id", templateIds)
        : Promise.resolve({ data: [], error: null }),
      schedule
        ? supabase
            .from("shift_swap_requests")
            .select("id, shift_id, requested_by_employee_id, reason, status")
            .eq("organization_id", organizationId)
            .eq("location_id", locationId)
            .in("status", ["pending", "approved", "denied"])
            .order("created_at", { ascending: false })
            .limit(30)
        : Promise.resolve({ data: [], error: null }),
    ]);
    if (shiftResult.error || acknowledgementResult.error || templateShiftResult.error || swapResult.error) {
      return readFailure("The live schedule could not be loaded. Try again.");
    }

    const visibleShiftIds = new Set((shiftResult.data ?? []).map((shift) => shift.id));
    const currentWeekSwaps = (swapResult.data ?? []).filter((swap) =>
      visibleShiftIds.has(swap.shift_id),
    );
    const swapIds = currentWeekSwaps.map((swap) => swap.id);
    const { data: offers, error: offerError } = swapIds.length
      ? await supabase
          .from("shift_swap_offers")
          .select("id, swap_request_id, offered_by_employee_id, message, status")
          .eq("organization_id", organizationId)
          .in("swap_request_id", swapIds)
      : { data: [], error: null };
    if (offerError) return readFailure("The live schedule could not be loaded. Try again.");

    const employeeNames = new Map((employeeResult.data ?? []).map((employee) => [employee.id, employee.display_name]));
    const roleNames = new Map((jobRoleResult.data ?? []).map((role) => [role.id, role.name]));
    const acknowledgedShiftIds = new Set((acknowledgementResult.data ?? []).map((ack) => ack.shift_id));
    const templateCounts = new Map<string, number>();
    for (const shift of templateShiftResult.data ?? []) {
      templateCounts.set(shift.template_id, (templateCounts.get(shift.template_id) ?? 0) + 1);
    }

    return readSuccess({
      weekStart,
      previousWeek: addIsoDays(weekStart, -7),
      nextWeek: addIsoDays(weekStart, 7),
      weekDates,
      timeZone: location.timezone,
      canManage,
      canPublish,
      selfEmployeeId: selfEmployeeResult.data?.id ?? null,
      schedule: schedule
        ? {
            id: schedule.id,
            status: schedule.status,
            version: schedule.version,
            publishedAt: schedule.published_at,
          }
        : null,
      shifts: (shiftResult.data ?? []).map((shift) => ({
        id: shift.id,
        employeeId: shift.employee_id,
        employeeName: shift.employee_id
          ? employeeNames.get(shift.employee_id) ?? "Assigned team member"
          : "Open shift",
        jobRoleId: shift.job_role_id,
        jobName: roleNames.get(shift.job_role_id) ?? "Assigned role",
        startsAt: shift.starts_at,
        endsAt: shift.ends_at,
        date: localDateKey(shift.starts_at, location.timezone),
        startLabel: formatLocalTime(shift.starts_at, location.timezone),
        endLabel: formatLocalTime(shift.ends_at, location.timezone),
        startLocal: localDateTimeParts(shift.starts_at, location.timezone).time,
        endLocal: localDateTimeParts(shift.ends_at, location.timezone).time,
        breakMinutes: shift.break_minutes,
        status: shift.status,
        isOpen: shift.is_open,
        notes: shift.notes,
        acknowledged: acknowledgedShiftIds.has(shift.id),
      })),
      employees: (employeeResult.data ?? []).map((employee) => ({ id: employee.id, name: employee.display_name })),
      jobRoles: (jobRoleResult.data ?? []).map((role) => ({ id: role.id, name: role.name, code: role.code })),
      templates: (templateResult.data ?? []).map((template) => ({ id: template.id, name: template.name, shiftCount: templateCounts.get(template.id) ?? 0 })),
      swaps: currentWeekSwaps.map((swap) => ({
        id: swap.id,
        shiftId: swap.shift_id,
        requestedByEmployeeId: swap.requested_by_employee_id,
        requestedByName: employeeNames.get(swap.requested_by_employee_id) ?? "Team member",
        reason: swap.reason,
        status: swap.status,
        offers: (offers ?? [])
          .filter((offer) => offer.swap_request_id === swap.id)
          .map((offer) => ({
            id: offer.id,
            employeeId: offer.offered_by_employee_id,
            employeeName: employeeNames.get(offer.offered_by_employee_id) ?? "Team member",
            message: offer.message,
            status: offer.status,
          })),
      })),
    });
  } catch {
    return readFailure("The live schedule could not be loaded. Try again.");
  }
}
