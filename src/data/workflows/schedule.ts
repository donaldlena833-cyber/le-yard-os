import "server-only";

import {
  assertCondition,
  assertFound,
  isUniqueViolation,
  throwDatabaseError,
  WorkflowError,
} from "../errors";
import { requireLocationManagement } from "../policy";
import { requireActorEmployee } from "../resources";
import type {
  AcknowledgeShiftInput,
  PublishScheduleInput,
} from "../schemas";
import type { WorkflowContext } from "../execute";

export async function publishSchedule(
  { supabase, actor }: WorkflowContext,
  input: PublishScheduleInput,
) {
  const { data, error } = await supabase
    .from("schedules")
    .select("id, organization_id, location_id, status, published_at")
    .eq("id", input.scheduleId)
    .maybeSingle();

  if (error) throwDatabaseError(error, "The schedule could not be loaded.");
  const schedule = assertFound(data, "The schedule was not found.");
  requireLocationManagement(actor, schedule.organization_id, schedule.location_id);

  if (schedule.status === "published") {
    return {
      id: schedule.id,
      status: "published" as const,
      publishedAt: schedule.published_at as string,
      alreadyApplied: true,
    };
  }
  if (schedule.status !== "draft") {
    throw new WorkflowError("conflict", "Only a draft schedule can be published.");
  }

  const { data: published, error: publishError } = await supabase.rpc(
    "publish_schedule",
    {
      p_schedule_id: input.scheduleId,
      p_note: input.note ?? null,
    },
  );

  if (publishError) {
    throwDatabaseError(publishError, "The schedule could not be published.");
  }
  const result = assertFound(published, "The published schedule was not returned.");

  return {
    id: result.id as string,
    status: "published" as const,
    publishedAt: result.published_at as string,
    alreadyApplied: false,
  };
}

export async function acknowledgeShift(
  { supabase, actor }: WorkflowContext,
  input: AcknowledgeShiftInput,
) {
  const { data, error } = await supabase
    .from("shifts")
    .select("id, organization_id, location_id, schedule_id, employee_id")
    .eq("id", input.shiftId)
    .maybeSingle();

  if (error) throwDatabaseError(error, "The shift could not be loaded.");
  const shift = assertFound(data, "The shift was not found.");
  const employee = await requireActorEmployee(supabase, actor, shift.organization_id);
  assertCondition(
    shift.employee_id === employee.id,
    "forbidden",
    "Only the employee assigned to this shift can acknowledge it.",
  );

  const { data: schedule, error: scheduleError } = await supabase
    .from("schedules")
    .select("status, location_id")
    .eq("id", shift.schedule_id)
    .eq("organization_id", shift.organization_id)
    .maybeSingle();
  if (scheduleError) throwDatabaseError(scheduleError, "The schedule could not be verified.");
  const parent = assertFound(schedule, "The shift's schedule was not found.");
  assertCondition(
    parent.location_id === shift.location_id,
    "conflict",
    "The shift location does not match its schedule.",
  );
  assertCondition(
    parent.status === "published",
    "conflict",
    "Only a published shift can be acknowledged.",
  );

  const { data: existing, error: existingError } = await supabase
    .from("shift_acknowledgements")
    .select("id, acknowledged_at")
    .eq("shift_id", shift.id)
    .eq("employee_id", employee.id)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError, "The acknowledgement could not be checked.");
  if (existing) {
    return {
      id: existing.id as string,
      shiftId: shift.id as string,
      acknowledgedAt: existing.acknowledged_at as string,
      alreadyApplied: true,
    };
  }

  const acknowledgementId = crypto.randomUUID();
  const { data: inserted, error: insertError } = await supabase
    .from("shift_acknowledgements")
    .insert({
      id: acknowledgementId,
      organization_id: shift.organization_id,
      shift_id: shift.id,
      employee_id: employee.id,
      note: input.note ?? null,
    })
    .select("id, acknowledged_at")
    .single();

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      const { data: raced, error: racedError } = await supabase
        .from("shift_acknowledgements")
        .select("id, acknowledged_at")
        .eq("shift_id", shift.id)
        .eq("employee_id", employee.id)
        .maybeSingle();
      if (racedError) throwDatabaseError(racedError);
      if (raced) {
        return {
          id: raced.id as string,
          shiftId: shift.id as string,
          acknowledgedAt: raced.acknowledged_at as string,
          alreadyApplied: true,
        };
      }
    }
    throwDatabaseError(insertError, "The shift could not be acknowledged.");
  }

  return {
    id: inserted.id as string,
    shiftId: shift.id as string,
    acknowledgedAt: inserted.acknowledged_at as string,
    alreadyApplied: false,
  };
}

