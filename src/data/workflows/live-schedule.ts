import "server-only";

import {
  assertCondition,
  assertFound,
  throwDatabaseError,
  WorkflowError,
} from "../errors";
import { requireLocationManagement } from "../policy";
import { requireManagedLocation } from "../resources";
import type { WorkflowContext } from "../execute";
import {
  addIsoDays,
  isoDayDistance,
  localDateTimeParts,
  zonedLocalToIso,
} from "../read-models/shared";

export interface CreateScheduleInput {
  requestId: string;
  locationId: string;
  weekStart: string;
  templateId?: string | null;
}

export interface SaveScheduleTemplateInput {
  requestId: string;
  scheduleId: string;
  name: string;
}

export interface ShiftWriteInput {
  requestId: string;
  scheduleId: string;
  employeeId?: string | null;
  jobRoleId: string;
  date: string;
  startsAt: string;
  endsAt: string;
  breakMinutes: number;
  notes?: string | null;
  isOpen: boolean;
}

export interface EditShiftInput extends Omit<ShiftWriteInput, "requestId" | "scheduleId"> {
  shiftId: string;
}

export interface MoveShiftInput {
  shiftId: string;
  targetDate: string;
}

export interface ShiftIdempotentInput {
  requestId: string;
  shiftId: string;
}

export interface RequestSwapInput {
  requestId: string;
  shiftId: string;
  reason?: string | null;
}

export interface OfferSwapInput {
  requestId: string;
  swapRequestId: string;
  message?: string | null;
}

export interface DecideSwapInput {
  requestId: string;
  swapRequestId: string;
  offerId?: string | null;
  approve: boolean;
}

async function loadManagedDraft(
  { supabase, actor }: WorkflowContext,
  scheduleId: string,
) {
  const { data, error } = await supabase
    .from("schedules")
    .select("id, organization_id, location_id, week_start, status")
    .eq("id", scheduleId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The schedule could not be loaded.");
  const schedule = assertFound(data, "The schedule was not found.");
  requireLocationManagement(actor, schedule.organization_id, schedule.location_id);
  assertCondition(schedule.status === "draft", "conflict", "Only draft schedules can be edited.");
  return schedule;
}

async function locationTimeZone(
  context: WorkflowContext,
  organizationId: string,
  locationId: string,
) {
  const { data, error } = await context.supabase
    .from("locations")
    .select("timezone")
    .eq("organization_id", organizationId)
    .eq("id", locationId)
    .single();
  if (error || !data) throwDatabaseError(error, "The location timezone could not be loaded.");
  return data.timezone;
}

function concreteTimes(
  date: string,
  startsAt: string,
  endsAt: string,
  timeZone: string,
) {
  const start = zonedLocalToIso(date, startsAt, timeZone);
  const endDate = endsAt <= startsAt ? addIsoDays(date, 1) : date;
  const end = zonedLocalToIso(endDate, endsAt, timeZone);
  if (!start || !end || end <= start) {
    throw new WorkflowError(
      "validation",
      "The shift time is invalid in the restaurant’s timezone, including daylight-saving time.",
    );
  }
  return { start, end };
}

export async function createLiveSchedule(
  context: WorkflowContext,
  input: CreateScheduleInput,
) {
  const { supabase, actor } = context;
  const location = await requireManagedLocation(supabase, actor, input.locationId);
  const { data: settings, error: settingsError } = await supabase
    .from("organization_settings")
    .select("week_starts_on")
    .eq("organization_id", location.organizationId)
    .maybeSingle();
  if (settingsError) throwDatabaseError(settingsError, "The scheduling settings could not be loaded.");
  const configuredWeekday = settings?.week_starts_on ?? 1;
  assertCondition(
    new Date(`${input.weekStart}T00:00:00Z`).getUTCDay() === configuredWeekday,
    "validation",
    "The schedule date must match the organization’s configured week start.",
  );
  const { data: existingById, error: existingError } = await supabase
    .from("schedules")
    .select("id, organization_id, location_id, week_start, template_id, status, version")
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError);
  if (existingById) {
    assertCondition(
      existingById.organization_id === location.organizationId &&
        existingById.location_id === location.id &&
        existingById.week_start === input.weekStart &&
        existingById.template_id === (input.templateId ?? null),
      "conflict",
      "This request ID was already used for another schedule.",
    );
    return { id: existingById.id, status: existingById.status, version: existingById.version, alreadyApplied: true };
  }

  let templateShifts: {
    weekday: number;
    starts_at: string;
    ends_at: string;
    job_role_id: string;
    employee_id: string | null;
    break_minutes: number;
    notes: string | null;
  }[] = [];
  if (input.templateId) {
    const { data: template, error: templateError } = await supabase
      .from("schedule_templates")
      .select("id, organization_id, location_id, is_active")
      .eq("id", input.templateId)
      .maybeSingle();
    if (templateError) throwDatabaseError(templateError, "The schedule template could not be loaded.");
    const templateRow = assertFound(template, "The schedule template was not found.");
    assertCondition(
      templateRow.organization_id === location.organizationId &&
        templateRow.location_id === location.id &&
        templateRow.is_active,
      "forbidden",
      "The template is not available for this location.",
    );
    const { data, error } = await supabase
      .from("schedule_template_shifts")
      .select("weekday, starts_at, ends_at, job_role_id, employee_id, break_minutes, notes")
      .eq("organization_id", location.organizationId)
      .eq("template_id", templateRow.id);
    if (error) throwDatabaseError(error, "Template shifts could not be loaded.");
    templateShifts = data ?? [];
  }

  const { data: versions, error: versionError } = await supabase
    .from("schedules")
    .select("version")
    .eq("organization_id", location.organizationId)
    .eq("location_id", location.id)
    .eq("week_start", input.weekStart)
    .order("version", { ascending: false })
    .limit(1);
  if (versionError) throwDatabaseError(versionError);
  const version = (versions?.[0]?.version ?? 0) + 1;
  const { data: inserted, error: insertError } = await supabase
    .from("schedules")
    .insert({
      id: input.requestId,
      organization_id: location.organizationId,
      location_id: location.id,
      week_start: input.weekStart,
      version,
      template_id: input.templateId ?? null,
      created_by: actor.userId,
      status: "draft",
    })
    .select("id, status, version")
    .single();
  if (insertError) throwDatabaseError(insertError, "The schedule could not be created.");

  if (templateShifts.length) {
    try {
      const timeZone = await locationTimeZone(context, location.organizationId, location.id);
      const scheduleWeekday = new Date(`${input.weekStart}T00:00:00Z`).getUTCDay();
      const rows = templateShifts.map((shift) => {
        const date = addIsoDays(input.weekStart, (shift.weekday - scheduleWeekday + 7) % 7);
        const { start, end } = concreteTimes(
          date,
          shift.starts_at.slice(0, 5),
          shift.ends_at.slice(0, 5),
          timeZone,
        );
        return {
          organization_id: location.organizationId,
          location_id: location.id,
          schedule_id: inserted.id,
          employee_id: shift.employee_id,
          job_role_id: shift.job_role_id,
          starts_at: start,
          ends_at: end,
          break_minutes: shift.break_minutes,
          status: shift.employee_id ? ("scheduled" as const) : ("open" as const),
          is_open: !shift.employee_id,
          notes: shift.notes,
        };
      });
      const { error } = await supabase.from("shifts").insert(rows);
      if (error) throw error;
    } catch (error) {
      await supabase.from("schedules").delete().eq("id", inserted.id).eq("status", "draft");
      throwDatabaseError(error, "The template could not be applied safely; the empty draft was removed.");
    }
  }

  return { id: inserted.id, status: inserted.status, version: inserted.version, alreadyApplied: false };
}

export async function saveLiveScheduleTemplate(
  context: WorkflowContext,
  input: SaveScheduleTemplateInput,
) {
  const { supabase, actor } = context;
  const schedule = await loadManagedDraft(context, input.scheduleId);
  const { data: existing, error: existingError } = await supabase
    .from("schedule_templates")
    .select("id, organization_id, location_id, name")
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError);
  if (existing) {
    assertCondition(
      existing.organization_id === schedule.organization_id &&
        existing.location_id === schedule.location_id &&
        existing.name === input.name,
      "conflict",
      "This request ID was already used for another template.",
    );
    return { id: existing.id, alreadyApplied: true };
  }

  const { data: shifts, error: shiftError } = await supabase
    .from("shifts")
    .select("employee_id, job_role_id, starts_at, ends_at, break_minutes, notes")
    .eq("organization_id", schedule.organization_id)
    .eq("schedule_id", schedule.id)
    .neq("status", "cancelled")
    .order("starts_at");
  if (shiftError) throwDatabaseError(shiftError, "The schedule shifts could not be loaded.");
  assertCondition(Boolean(shifts?.length), "conflict", "Add at least one shift before saving a template.");

  const { data: template, error: templateError } = await supabase
    .from("schedule_templates")
    .insert({
      id: input.requestId,
      organization_id: schedule.organization_id,
      location_id: schedule.location_id,
      name: input.name,
      description: `Saved from schedule week ${schedule.week_start}`,
      created_by: actor.userId,
      is_active: true,
    })
    .select("id")
    .single();
  if (templateError) throwDatabaseError(templateError, "The schedule template could not be created.");

  try {
    const timeZone = await locationTimeZone(context, schedule.organization_id, schedule.location_id);
    const rows = shifts!.map((shift) => {
      const start = localDateTimeParts(shift.starts_at, timeZone);
      const end = localDateTimeParts(shift.ends_at, timeZone);
      return {
        organization_id: schedule.organization_id,
        template_id: template.id,
        weekday: new Date(`${start.date}T00:00:00Z`).getUTCDay(),
        starts_at: start.time,
        ends_at: end.time,
        job_role_id: shift.job_role_id,
        employee_id: shift.employee_id,
        break_minutes: shift.break_minutes,
        notes: shift.notes,
      };
    });
    const { error } = await supabase.from("schedule_template_shifts").insert(rows);
    if (error) throw error;
  } catch (error) {
    await supabase.from("schedule_templates").delete().eq("id", template.id);
    throwDatabaseError(error, "The reusable template could not be saved.");
  }
  return { id: template.id, alreadyApplied: false };
}

export async function createLiveShift(context: WorkflowContext, input: ShiftWriteInput) {
  const { supabase } = context;
  const schedule = await loadManagedDraft(context, input.scheduleId);
  assertCondition(
    input.date >= schedule.week_start && input.date <= addIsoDays(schedule.week_start, 6),
    "validation",
    "The shift date must be inside this schedule week.",
  );
  const timeZone = await locationTimeZone(context, schedule.organization_id, schedule.location_id);
  const times = concreteTimes(input.date, input.startsAt, input.endsAt, timeZone);
  const employeeId = input.isOpen ? null : input.employeeId ?? null;
  assertCondition(input.isOpen || employeeId, "validation", "Choose an employee or mark the shift open.");

  const { data: existing, error: existingError } = await supabase
    .from("shifts")
    .select("id, schedule_id")
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError);
  if (existing) {
    assertCondition(existing.schedule_id === schedule.id, "conflict", "This request ID was already used.");
    return { id: existing.id, alreadyApplied: true };
  }

  const { data, error } = await supabase
    .from("shifts")
    .insert({
      id: input.requestId,
      organization_id: schedule.organization_id,
      location_id: schedule.location_id,
      schedule_id: schedule.id,
      employee_id: employeeId,
      job_role_id: input.jobRoleId,
      starts_at: times.start,
      ends_at: times.end,
      break_minutes: input.breakMinutes,
      status: input.isOpen ? "open" : "scheduled",
      is_open: input.isOpen,
      notes: input.notes ?? null,
    })
    .select("id")
    .single();
  if (error) throwDatabaseError(error, "The shift could not be created. Verify the employee’s active job assignment.");
  return { id: data.id, alreadyApplied: false };
}

export async function editLiveShift(context: WorkflowContext, input: EditShiftInput) {
  const { supabase } = context;
  const { data: shift, error } = await supabase
    .from("shifts")
    .select("id, schedule_id")
    .eq("id", input.shiftId)
    .maybeSingle();
  if (error) throwDatabaseError(error);
  const existing = assertFound(shift, "The shift was not found.");
  const schedule = await loadManagedDraft(context, existing.schedule_id);
  assertCondition(
    input.date >= schedule.week_start && input.date <= addIsoDays(schedule.week_start, 6),
    "validation",
    "The shift date must be inside this schedule week.",
  );
  const timeZone = await locationTimeZone(context, schedule.organization_id, schedule.location_id);
  const times = concreteTimes(input.date, input.startsAt, input.endsAt, timeZone);
  const employeeId = input.isOpen ? null : input.employeeId ?? null;
  assertCondition(input.isOpen || employeeId, "validation", "Choose an employee or mark the shift open.");
  const { data, error: updateError } = await supabase
    .from("shifts")
    .update({
      employee_id: employeeId,
      job_role_id: input.jobRoleId,
      starts_at: times.start,
      ends_at: times.end,
      break_minutes: input.breakMinutes,
      status: input.isOpen ? "open" : "scheduled",
      is_open: input.isOpen,
      notes: input.notes ?? null,
    })
    .eq("id", existing.id)
    .select("id")
    .single();
  if (updateError) throwDatabaseError(updateError, "The shift could not be updated.");
  return { id: data.id };
}

export async function moveLiveShift(context: WorkflowContext, input: MoveShiftInput) {
  const { supabase } = context;
  const { data: shift, error } = await supabase
    .from("shifts")
    .select("id, schedule_id, starts_at, ends_at")
    .eq("id", input.shiftId)
    .maybeSingle();
  if (error) throwDatabaseError(error);
  const existing = assertFound(shift, "The shift was not found.");
  const schedule = await loadManagedDraft(context, existing.schedule_id);
  assertCondition(
    input.targetDate >= schedule.week_start && input.targetDate <= addIsoDays(schedule.week_start, 6),
    "validation",
    "The shift can only move within this schedule week.",
  );
  const timeZone = await locationTimeZone(context, schedule.organization_id, schedule.location_id);
  const oldStart = localDateTimeParts(existing.starts_at, timeZone);
  const oldEnd = localDateTimeParts(existing.ends_at, timeZone);
  const endDate = addIsoDays(input.targetDate, Math.max(0, isoDayDistance(oldStart.date, oldEnd.date)));
  const startsAt = zonedLocalToIso(input.targetDate, oldStart.time, timeZone);
  const endsAt = zonedLocalToIso(endDate, oldEnd.time, timeZone);
  assertCondition(startsAt && endsAt && endsAt > startsAt, "validation", "The shift cannot move to that local date.");
  const { error: updateError } = await supabase
    .from("shifts")
    .update({ starts_at: startsAt, ends_at: endsAt })
    .eq("id", existing.id);
  if (updateError) throwDatabaseError(updateError, "The shift could not be moved.");
  return { id: existing.id, date: input.targetDate };
}

export async function claimLiveOpenShift(context: WorkflowContext, input: ShiftIdempotentInput) {
  const { data, error } = await context.supabase.rpc("claim_open_shift", {
    p_request_id: input.requestId,
    p_shift_id: input.shiftId,
  });
  if (error) throwDatabaseError(error, "The open shift could not be claimed.");
  const shift = assertFound(data, "The claimed shift was not returned.");
  return { id: shift.id as string, status: shift.status as string };
}

export async function reopenLiveShift(context: WorkflowContext, input: ShiftIdempotentInput) {
  const { data, error } = await context.supabase.rpc("reopen_shift", {
    p_request_id: input.requestId,
    p_shift_id: input.shiftId,
  });
  if (error) throwDatabaseError(error, "The shift could not be reopened.");
  const shift = assertFound(data, "The open shift was not returned.");
  return { id: shift.id as string, status: shift.status as string };
}

export async function requestLiveShiftSwap(context: WorkflowContext, input: RequestSwapInput) {
  const { data, error } = await context.supabase.rpc("request_shift_swap", {
    p_request_id: input.requestId,
    p_shift_id: input.shiftId,
    p_preferred_employee_id: null,
    p_reason: input.reason ?? null,
  });
  if (error) throwDatabaseError(error, "The swap request could not be created.");
  const request = assertFound(data, "The swap request was not returned.");
  return { id: request.id as string, status: request.status as string };
}

export async function offerLiveShiftSwap(context: WorkflowContext, input: OfferSwapInput) {
  const { data, error } = await context.supabase.rpc("offer_shift_swap", {
    p_request_id: input.requestId,
    p_swap_request_id: input.swapRequestId,
    p_message: input.message ?? null,
  });
  if (error) throwDatabaseError(error, "Your offer could not be saved.");
  const offer = assertFound(data, "The coverage offer was not returned.");
  return { id: offer.id as string, status: offer.status as string };
}

export async function decideLiveShiftSwap(context: WorkflowContext, input: DecideSwapInput) {
  const { data, error } = await context.supabase.rpc("decide_shift_swap", {
    p_request_id: input.requestId,
    p_swap_request_id: input.swapRequestId,
    p_offer_id: input.offerId ?? null,
    p_approve: input.approve,
  });
  if (error) throwDatabaseError(error, "The swap decision could not be saved.");
  const result = assertFound(data, "The swap decision was not returned.");
  return { id: result.id as string, status: result.status as string };
}
