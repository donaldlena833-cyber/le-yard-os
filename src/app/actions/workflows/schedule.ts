"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  acknowledgeShiftInputSchema,
  publishScheduleInputSchema,
} from "@/data/schemas";
import {
  acknowledgeShift,
  publishSchedule,
} from "@/data/workflows/schedule";

export async function publishScheduleAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "schedule.publish",
    schema: publishScheduleInputSchema,
    input,
    run: publishSchedule,
  });
  if (result.ok && result.persisted) {
    revalidatePath("/schedule");
    revalidatePath("/today");
  }
  return result;
}

export async function acknowledgeShiftAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "schedule.acknowledge",
    schema: acknowledgeShiftInputSchema,
    input,
    run: acknowledgeShift,
  });
  if (result.ok && result.persisted) {
    revalidatePath("/schedule");
    revalidatePath("/today");
  }
  return result;
}

