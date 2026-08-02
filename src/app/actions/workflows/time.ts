"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  approveTimeCorrectionInputSchema,
  clockInInputSchema,
  clockOutInputSchema,
  endBreakInputSchema,
  requestTimeCorrectionInputSchema,
  recordMissedTimeEntryInputSchema,
  startBreakInputSchema,
} from "@/data/schemas";
import {
  approveTimeCorrection,
  clockIn,
  clockOut,
  endBreak,
  requestTimeCorrection,
  recordMissedTimeEntry,
  startBreak,
} from "@/data/workflows/time";

async function refreshTimeViews<T>(result: T): Promise<T> {
  revalidatePath("/time-clock");
  revalidatePath("/today");
  return result;
}

export async function clockInAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "time.clock_in",
    schema: clockInInputSchema,
    input,
    run: clockIn,
  });
  return result.ok && result.persisted ? refreshTimeViews(result) : result;
}

export async function clockOutAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "time.clock_out",
    schema: clockOutInputSchema,
    input,
    run: clockOut,
  });
  return result.ok && result.persisted ? refreshTimeViews(result) : result;
}

export async function startBreakAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "time.break_start",
    schema: startBreakInputSchema,
    input,
    run: startBreak,
  });
  return result.ok && result.persisted ? refreshTimeViews(result) : result;
}

export async function endBreakAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "time.break_end",
    schema: endBreakInputSchema,
    input,
    run: endBreak,
  });
  return result.ok && result.persisted ? refreshTimeViews(result) : result;
}

export async function approveTimeCorrectionAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "time.correction_decide",
    schema: approveTimeCorrectionInputSchema,
    input,
    run: approveTimeCorrection,
  });
  return result.ok && result.persisted ? refreshTimeViews(result) : result;
}

export async function requestTimeCorrectionAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "time.correction_request",
    schema: requestTimeCorrectionInputSchema,
    input,
    run: requestTimeCorrection,
  });
  return result.ok && result.persisted ? refreshTimeViews(result) : result;
}

export async function recordMissedTimeEntryAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "time.record_missed_entry",
    schema: recordMissedTimeEntryInputSchema,
    input,
    run: recordMissedTimeEntry,
  });
  return result.ok && result.persisted ? refreshTimeViews(result) : result;
}
