"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { executeWorkflowAction, type WorkflowContext } from "@/data/execute";
import { WorkflowError } from "@/data/errors";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
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

const counterClockScope = { organizationId: z.uuid(), locationId: z.uuid() };

function runCounterClock<TInput extends { organizationId: string; locationId: string }, TOutput>(
  operation: string,
  schema: z.ZodType<TInput>,
  input: unknown,
  run: (context: WorkflowContext, input: TInput, scope: TInput) => Promise<TOutput>,
) {
  return executeWorkflowAction({
    operation,
    schema,
    input,
    run: async (context, parsed) => {
      const session = await resolveWorkspaceSession();
      if (session.status !== "ready" || session.context.mode !== "live" ||
        session.context.serviceSettings?.serviceModel !== "counter" ||
        session.context.organization.id !== parsed.organizationId ||
        session.context.activeLocation.id !== parsed.locationId) {
        throw new WorkflowError("forbidden", "Open the Time clock in your active Church Street workspace to record a punch.");
      }
      return run(context, parsed, parsed);
    },
  });
}

export async function clockInAction(input: unknown) {
  const result = await runCounterClock("time.clock_in", clockInInputSchema.extend(counterClockScope), input, clockIn);
  return result.ok && result.persisted ? refreshTimeViews(result) : result;
}

export async function clockOutAction(input: unknown) {
  const result = await runCounterClock("time.clock_out", clockOutInputSchema.extend(counterClockScope), input, clockOut);
  return result.ok && result.persisted ? refreshTimeViews(result) : result;
}

export async function startBreakAction(input: unknown) {
  const result = await runCounterClock("time.break_start", startBreakInputSchema.extend(counterClockScope), input, startBreak);
  return result.ok && result.persisted ? refreshTimeViews(result) : result;
}

export async function endBreakAction(input: unknown) {
  const result = await runCounterClock("time.break_end", endBreakInputSchema.extend(counterClockScope), input, endBreak);
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
