import "server-only";

import {
  assertCondition,
  assertFound,
  throwDatabaseError,
  WorkflowError,
} from "../errors";
import { requireLocationManagement } from "../policy";
import {
  requireAccessibleLocation,
  requireActorEmployee,
} from "../resources";
import type { WorkflowContext } from "../execute";
import type {
  ApproveTimeCorrectionInput,
  ClockInInput,
  ClockOutInput,
  EndBreakInput,
  StartBreakInput,
  RequestTimeCorrectionInput,
  RecordMissedTimeEntryInput,
} from "../schemas";
import { zonedLocalToIso } from "../read-models/shared";

function sameInstant(left: string | null, right: string | null): boolean {
  if (left === null || right === null) return left === right;
  return new Date(left).getTime() === new Date(right).getTime();
}

export async function clockIn(
  { supabase, actor }: WorkflowContext,
  input: ClockInInput,
) {
  const location = await requireAccessibleLocation(supabase, actor, input.locationId);
  const employee = await requireActorEmployee(supabase, actor, location.organizationId);

  const { data: role, error: roleError } = await supabase
    .from("job_roles")
    .select("id")
    .eq("id", input.jobRoleId)
    .eq("organization_id", location.organizationId)
    .eq("is_active", true)
    .maybeSingle();
  if (roleError) throwDatabaseError(roleError, "The job role could not be verified.");
  assertFound(role, "The job role was not found or is inactive.");

  if (input.scheduledShiftId) {
    const { data: shift, error: shiftError } = await supabase
      .from("shifts")
      .select("id, organization_id, location_id, employee_id, job_role_id, schedule_id")
      .eq("id", input.scheduledShiftId)
      .maybeSingle();
    if (shiftError) throwDatabaseError(shiftError, "The scheduled shift could not be verified.");
    const scheduled = assertFound(shift, "The scheduled shift was not found.");
    assertCondition(
      scheduled.organization_id === location.organizationId &&
        scheduled.location_id === location.id &&
        scheduled.employee_id === employee.id &&
        scheduled.job_role_id === input.jobRoleId,
      "conflict",
      "The scheduled shift does not match this employee, location, and job role.",
    );

    const { data: schedule, error: scheduleError } = await supabase
      .from("schedules")
      .select("status, location_id")
      .eq("id", scheduled.schedule_id)
      .eq("organization_id", location.organizationId)
      .maybeSingle();
    if (scheduleError) throwDatabaseError(scheduleError, "The schedule could not be verified.");
    assertCondition(
      schedule?.status === "published" && schedule.location_id === location.id,
      "conflict",
      "Clock-in requires a published shift at this location.",
    );
  }

  const { data: existingRequest, error: requestError } = await supabase
    .from("time_entries")
    .select("id, location_id, employee_id, job_role_id, scheduled_shift_id, clocked_in_at, status")
    .eq("id", input.requestId)
    .maybeSingle();
  if (requestError) throwDatabaseError(requestError, "The clock-in request could not be checked.");
  if (existingRequest) {
    assertCondition(
      existingRequest.location_id === location.id &&
        existingRequest.employee_id === employee.id &&
        existingRequest.job_role_id === input.jobRoleId &&
        existingRequest.scheduled_shift_id === (input.scheduledShiftId ?? null),
      "conflict",
      "This request ID was already used for a different clock-in.",
    );
    return {
      id: existingRequest.id as string,
      status: existingRequest.status as string,
      clockedInAt: existingRequest.clocked_in_at as string,
      alreadyApplied: true,
    };
  }

  const { data: inserted, error: insertError } = await supabase.rpc(
    "record_clock_in",
    {
      p_request_id: input.requestId,
      p_location_id: input.locationId,
      p_job_role_id: input.jobRoleId,
      p_scheduled_shift_id: input.scheduledShiftId ?? null,
    },
  );
  if (insertError) throwDatabaseError(insertError, "Clock-in could not be recorded.");
  const result = assertFound(inserted, "The recorded time entry was not returned.");

  return {
    id: result.id as string,
    status: result.status as string,
    clockedInAt: result.clocked_in_at as string,
    alreadyApplied: false,
  };
}

export async function clockOut(
  { supabase, actor }: WorkflowContext,
  input: ClockOutInput,
) {
  const { data, error } = await supabase
    .from("time_entries")
    .select("id, organization_id, employee_id, status, clocked_out_at")
    .eq("id", input.timeEntryId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The time entry could not be loaded.");
  const entry = assertFound(data, "The time entry was not found.");
  const employee = await requireActorEmployee(supabase, actor, entry.organization_id);
  assertCondition(
    entry.employee_id === employee.id,
    "forbidden",
    "Only the employee who owns this time entry can clock out.",
  );

  if (entry.clocked_out_at !== null) {
    return {
      id: entry.id as string,
      status: entry.status as string,
      clockedOutAt: entry.clocked_out_at as string,
      alreadyApplied: true,
    };
  }
  assertCondition(entry.status === "open", "conflict", "This time entry is not open.");

  const { data: updated, error: updateError } = await supabase.rpc(
    "record_clock_out",
    { p_time_entry_id: entry.id },
  );
  if (updateError) throwDatabaseError(updateError, "Clock-out could not be recorded.");
  const result = assertFound(updated, "The recorded time entry was not returned.");

  return {
    id: result.id as string,
    status: result.status as string,
    clockedOutAt: result.clocked_out_at as string,
    alreadyApplied: false,
  };
}

export async function startBreak(
  { supabase, actor }: WorkflowContext,
  input: StartBreakInput,
) {
  const { data, error } = await supabase
    .from("time_entries")
    .select("id, organization_id, employee_id, status")
    .eq("id", input.timeEntryId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The time entry could not be loaded.");
  const entry = assertFound(data, "The time entry was not found.");
  const employee = await requireActorEmployee(supabase, actor, entry.organization_id);
  assertCondition(
    entry.employee_id === employee.id,
    "forbidden",
    "Only the employee who owns this time entry can start a break.",
  );
  assertCondition(entry.status === "open", "conflict", "Breaks require an open time entry.");

  const { data: existingRequest, error: requestError } = await supabase
    .from("time_breaks")
    .select("id, time_entry_id, is_paid, started_at, ended_at")
    .eq("id", input.requestId)
    .maybeSingle();
  if (requestError) throwDatabaseError(requestError, "The break request could not be checked.");
  if (existingRequest) {
    assertCondition(
      existingRequest.time_entry_id === entry.id && existingRequest.is_paid === input.isPaid,
      "conflict",
      "This request ID was already used for a different break.",
    );
    return {
      id: existingRequest.id as string,
      startedAt: existingRequest.started_at as string,
      endedAt: existingRequest.ended_at as string | null,
      alreadyApplied: true,
    };
  }

  const { data: inserted, error: insertError } = await supabase.rpc(
    "start_time_break",
    {
      p_request_id: input.requestId,
      p_time_entry_id: entry.id,
      p_is_paid: input.isPaid,
    },
  );
  if (insertError) throwDatabaseError(insertError, "The break could not be started.");
  const result = assertFound(inserted, "The recorded break was not returned.");

  return {
    id: result.id as string,
    startedAt: result.started_at as string,
    endedAt: result.ended_at as string | null,
    alreadyApplied: false,
  };
}

export async function endBreak(
  { supabase, actor }: WorkflowContext,
  input: EndBreakInput,
) {
  const { data, error } = await supabase
    .from("time_breaks")
    .select("id, time_entry_id, ended_at")
    .eq("id", input.breakId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The break could not be loaded.");
  const breakRow = assertFound(data, "The break was not found.");

  const { data: entry, error: entryError } = await supabase
    .from("time_entries")
    .select("id, organization_id, employee_id, status")
    .eq("id", breakRow.time_entry_id)
    .maybeSingle();
  if (entryError) throwDatabaseError(entryError, "The time entry could not be loaded.");
  const parent = assertFound(entry, "The break's time entry was not found.");
  const employee = await requireActorEmployee(supabase, actor, parent.organization_id);
  assertCondition(
    parent.employee_id === employee.id,
    "forbidden",
    "Only the employee who owns this time entry can end the break.",
  );

  if (breakRow.ended_at !== null) {
    return {
      id: breakRow.id as string,
      endedAt: breakRow.ended_at as string,
      alreadyApplied: true,
    };
  }
  assertCondition(parent.status === "open", "conflict", "The parent time entry is not open.");

  const { data: updated, error: updateError } = await supabase.rpc(
    "end_time_break",
    { p_break_id: breakRow.id },
  );
  if (updateError) throwDatabaseError(updateError, "The break could not be ended.");
  const result = assertFound(updated, "The ended break was not returned.");

  return {
    id: result.id as string,
    endedAt: result.ended_at as string,
    alreadyApplied: false,
  };
}

export async function approveTimeCorrection(
  { supabase, actor }: WorkflowContext,
  input: ApproveTimeCorrectionInput,
) {
  const { data, error } = await supabase
    .from("time_entry_corrections")
    .select("id, organization_id, location_id, time_entry_id, status, decided_at")
    .eq("id", input.correctionId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The correction could not be loaded.");
  const correction = assertFound(data, "The correction was not found.");
  requireLocationManagement(actor, correction.organization_id, correction.location_id);

  const { data: entry, error: entryError } = await supabase
    .from("time_entries")
    .select("organization_id, location_id")
    .eq("id", correction.time_entry_id)
    .maybeSingle();
  if (entryError) throwDatabaseError(entryError, "The time entry could not be verified.");
  const parent = assertFound(entry, "The correction's time entry was not found.");
  assertCondition(
    parent.organization_id === correction.organization_id &&
      parent.location_id === correction.location_id,
    "conflict",
    "The correction scope does not match its time entry.",
  );

  const requestedStatus = input.approve ? "approved" : "denied";
  if (correction.status === requestedStatus) {
    return {
      id: correction.id as string,
      status: requestedStatus,
      decidedAt: correction.decided_at as string,
      alreadyApplied: true,
    };
  }
  if (correction.status !== "pending") {
    throw new WorkflowError(
      "conflict",
      `This correction is already ${correction.status} and cannot be changed.`,
    );
  }

  const { data: decided, error: decisionError } = await supabase.rpc(
    "apply_time_entry_correction",
    {
      p_correction_id: correction.id,
      p_approve: input.approve,
      p_decision_note: input.decisionNote ?? null,
    },
  );
  if (decisionError) {
    throwDatabaseError(decisionError, "The correction decision could not be saved.");
  }
  const result = assertFound(decided, "The decided correction was not returned.");
  return {
    id: result.id as string,
    status: result.status as string,
    decidedAt: result.decided_at as string,
    alreadyApplied: false,
  };
}

export async function requestTimeCorrection(
  { supabase, actor }: WorkflowContext,
  input: RequestTimeCorrectionInput,
) {
  const { data, error } = await supabase
    .from("time_entries")
    .select(
      "id, organization_id, location_id, employee_id, job_role_id, clocked_in_at, clocked_out_at",
    )
    .eq("id", input.timeEntryId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The time entry could not be loaded.");
  const entry = assertFound(data, "The time entry was not found.");
  const employee = await requireActorEmployee(supabase, actor, entry.organization_id);
  assertCondition(
    entry.employee_id === employee.id,
    "forbidden",
    "Only the employee who owns this time entry can request a correction.",
  );

  const { data: location, error: locationError } = await supabase
    .from("locations")
    .select("timezone")
    .eq("id", entry.location_id)
    .eq("organization_id", entry.organization_id)
    .single();
  if (locationError) {
    throwDatabaseError(locationError, "The restaurant timezone could not be verified.");
  }

  const proposedClockedInAt = input.proposedClockedInLocal
    ? zonedLocalToIso(
        input.proposedClockedInLocal.slice(0, 10),
        input.proposedClockedInLocal.slice(11),
        location.timezone,
      )
    : null;
  const proposedClockedOutAt = input.proposedClockedOutLocal
    ? zonedLocalToIso(
        input.proposedClockedOutLocal.slice(0, 10),
        input.proposedClockedOutLocal.slice(11),
        location.timezone,
      )
    : null;
  assertCondition(
    !input.proposedClockedInLocal || proposedClockedInAt !== null,
    "validation",
    "The proposed clock-in is not a valid local restaurant time.",
  );
  assertCondition(
    !input.proposedClockedOutLocal || proposedClockedOutAt !== null,
    "validation",
    "The proposed clock-out is not a valid local restaurant time.",
  );

  if (input.proposedJobRoleId) {
    const { data: role, error: roleError } = await supabase
      .from("job_roles")
      .select("id")
      .eq("id", input.proposedJobRoleId)
      .eq("organization_id", entry.organization_id)
      .eq("is_active", true)
      .maybeSingle();
    if (roleError) throwDatabaseError(roleError, "The proposed job role could not be verified.");
    assertFound(role, "The proposed job role is unavailable.");
  }

  const effectiveClockIn = proposedClockedInAt ?? entry.clocked_in_at;
  const effectiveClockOut = proposedClockedOutAt ?? entry.clocked_out_at;
  assertCondition(
    effectiveClockOut === null || new Date(effectiveClockOut) > new Date(effectiveClockIn),
    "validation",
    "The corrected clock-out must be after the corrected clock-in.",
  );
  assertCondition(
    (input.proposedClockedInLocal !== null &&
      input.proposedClockedInLocal !== undefined &&
      !sameInstant(proposedClockedInAt, entry.clocked_in_at)) ||
      (input.proposedClockedOutLocal !== null &&
        input.proposedClockedOutLocal !== undefined &&
        !sameInstant(proposedClockedOutAt, entry.clocked_out_at)) ||
      (input.proposedJobRoleId !== null &&
        input.proposedJobRoleId !== undefined &&
        input.proposedJobRoleId !== entry.job_role_id),
    "validation",
    "The proposed correction matches the current time entry.",
  );

  const { data: existing, error: existingError } = await supabase
    .from("time_entry_corrections")
    .select(
      "id, time_entry_id, requested_by, proposed_clocked_in_at, proposed_clocked_out_at, proposed_job_role_id, reason, status",
    )
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) {
    throwDatabaseError(existingError, "The correction request could not be checked.");
  }
  if (existing) {
    assertCondition(
      existing.time_entry_id === entry.id &&
        existing.requested_by === actor.userId &&
        sameInstant(existing.proposed_clocked_in_at, proposedClockedInAt) &&
        sameInstant(existing.proposed_clocked_out_at, proposedClockedOutAt) &&
        existing.proposed_job_role_id === (input.proposedJobRoleId ?? null) &&
        existing.reason === input.reason,
      "conflict",
      "This correction request ID is already bound to different changes.",
    );
    return {
      id: existing.id as string,
      status: existing.status as string,
      alreadyApplied: true,
    };
  }

  const { data: inserted, error: insertError } = await supabase.rpc(
    "request_time_entry_correction",
    {
      p_request_id: input.requestId,
      p_time_entry_id: entry.id,
      p_proposed_clocked_in_at: proposedClockedInAt,
      p_proposed_clocked_out_at: proposedClockedOutAt,
      p_proposed_job_role_id: input.proposedJobRoleId ?? null,
      p_reason: input.reason,
    },
  );
  if (insertError) {
    throwDatabaseError(insertError, "The correction request could not be submitted.");
  }
  const result = assertFound(inserted, "The correction request was not returned.");
  return {
    id: result.id as string,
    status: result.status as string,
    alreadyApplied: false,
  };
}

export async function recordMissedTimeEntry(
  { supabase, actor }: WorkflowContext,
  input: RecordMissedTimeEntryInput,
) {
  const location = await requireAccessibleLocation(supabase, actor, input.locationId);
  requireLocationManagement(actor, location.organizationId, location.id);
  const { data: locationRow, error: locationError } = await supabase
    .from("locations")
    .select("timezone")
    .eq("id", location.id)
    .eq("organization_id", location.organizationId)
    .single();
  if (locationError) {
    throwDatabaseError(locationError, "The restaurant timezone could not be verified.");
  }
  const clockedInAt = zonedLocalToIso(
    input.clockedInLocal.slice(0, 10),
    input.clockedInLocal.slice(11),
    locationRow.timezone,
  );
  const clockedOutAt = zonedLocalToIso(
    input.clockedOutLocal.slice(0, 10),
    input.clockedOutLocal.slice(11),
    locationRow.timezone,
  );
  assertCondition(
    clockedInAt !== null && clockedOutAt !== null,
    "validation",
    "The missed shift times are not valid local restaurant times.",
  );
  assertCondition(
    new Date(clockedOutAt) > new Date(clockedInAt),
    "validation",
    "The missed shift clock-out must be after clock-in.",
  );

  const { data, error } = await supabase.rpc("record_missed_time_entry", {
    p_request_id: input.requestId,
    p_location_id: location.id,
    p_employee_id: input.employeeId,
    p_job_role_id: input.jobRoleId,
    p_scheduled_shift_id: input.scheduledShiftId ?? null,
    p_clocked_in_at: clockedInAt,
    p_clocked_out_at: clockedOutAt,
    p_reason: input.reason,
  });
  if (error) throwDatabaseError(error, "The missed shift could not be recorded.");
  const result = assertFound(data, "The recorded missed shift was not returned.");
  return {
    id: result.id as string,
    status: result.status as string,
    clockedInAt: result.clocked_in_at as string,
    clockedOutAt: result.clocked_out_at as string,
  };
}
