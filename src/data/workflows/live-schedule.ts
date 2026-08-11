import "server-only";

import {
  assertCondition,
  assertFound,
  throwDatabaseError,
  WorkflowError,
} from "../errors";
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
  { supabase }: WorkflowContext,
  scheduleId: string,
) {
  const { data, error } = await supabase
    .from("schedules")
    .select("id, organization_id, location_id, week_start, status")
    .eq("id", scheduleId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The schedule could not be loaded.");
  const schedule = assertFound(data, "The schedule was not found.");
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
  const { data, error } = await context.supabase.rpc("create_schedule_draft", {
    p_request_id: input.requestId,
    p_location_id: input.locationId,
    p_week_start: input.weekStart,
    p_template_id: input.templateId ?? null,
  });
  if (error) throwDatabaseError(error, "The schedule could not be created atomically.");
  const result = assertFound(data, "The created schedule was not returned.");
  assertCondition(
    typeof result === "object" && !Array.isArray(result),
    "database",
    "The created schedule result was malformed.",
  );
  assertCondition(
    typeof result.id === "string" &&
      typeof result.status === "string" &&
      typeof result.version === "number" &&
      typeof result.replayed === "boolean",
    "database",
    "The created schedule result was incomplete.",
  );
  return {
    id: result.id,
    status: result.status,
    version: result.version,
    alreadyApplied: result.replayed,
  };
}

export async function saveLiveScheduleTemplate(
  context: WorkflowContext,
  input: SaveScheduleTemplateInput,
) {
  const { data, error } = await context.supabase.rpc("save_schedule_template", {
    p_request_id: input.requestId,
    p_schedule_id: input.scheduleId,
    p_name: input.name,
  });
  if (error) throwDatabaseError(error, "The reusable template could not be saved atomically.");
  const result = assertFound(data, "The saved schedule template was not returned.");
  assertCondition(
    typeof result === "object" && !Array.isArray(result),
    "database",
    "The saved schedule template result was malformed.",
  );
  assertCondition(
    typeof result.id === "string" && typeof result.replayed === "boolean",
    "database",
    "The saved schedule template result was incomplete.",
  );
  return { id: result.id, alreadyApplied: result.replayed };
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
