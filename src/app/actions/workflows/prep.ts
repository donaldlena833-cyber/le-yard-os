"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  completePrepTaskInputSchema,
  correctPrepCompletionInputSchema,
  previewPrepCompletionInputSchema,
  savePrepTaskInputSchema,
  transitionPrepTaskInputSchema,
} from "@/data/schemas";
import {
  completePrepTask,
  correctPrepCompletion,
  previewPrepCompletion,
  savePrepTask,
  transitionPrepTask,
} from "@/data/workflows/prep";

function refreshKitchen(result: { ok: boolean; persisted: boolean }) {
  if (result.ok && result.persisted) {
    revalidatePath("/kitchen");
    revalidatePath("/today");
  }
}

export async function savePrepTaskAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "prep.task.save",
    schema: savePrepTaskInputSchema,
    input,
    run: savePrepTask,
  });
  refreshKitchen(result);
  return result;
}

export async function transitionPrepTaskAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "prep.task.transition",
    schema: transitionPrepTaskInputSchema,
    input,
    run: transitionPrepTask,
  });
  refreshKitchen(result);
  return result;
}

export async function previewPrepCompletionAction(input: unknown) {
  return executeWorkflowAction({
    operation: "prep.completion.preview",
    schema: previewPrepCompletionInputSchema,
    input,
    persists: false,
    run: previewPrepCompletion,
  });
}

export async function completePrepTaskAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "prep.completion.post",
    schema: completePrepTaskInputSchema,
    input,
    run: completePrepTask,
  });
  refreshKitchen(result);
  return result;
}

export async function correctPrepCompletionAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "prep.completion.correct",
    schema: correctPrepCompletionInputSchema,
    input,
    run: correctPrepCompletion,
  });
  refreshKitchen(result);
  return result;
}
