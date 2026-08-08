"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  acknowledgePreshiftInputSchema,
  recordServiceAvailabilityInputSchema,
  saveManagerLogInputSchema,
  savePreshiftInputSchema,
} from "@/data/service-control-schemas";
import {
  acknowledgePreshift,
  recordServiceAvailability,
  saveManagerLog,
  savePreshift,
} from "@/data/workflows/service-control";

function refreshService() {
  revalidatePath("/service");
  revalidatePath("/today");
  revalidatePath("/kitchen");
}

export async function recordServiceAvailabilityAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "service.availability.record", schema: recordServiceAvailabilityInputSchema, input, run: recordServiceAvailability });
  if (result.ok && result.persisted) refreshService();
  return result;
}

export async function saveManagerLogAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "manager-log.save", schema: saveManagerLogInputSchema, input, run: saveManagerLog });
  if (result.ok && result.persisted) refreshService();
  return result;
}

export async function savePreshiftAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "preshift.save", schema: savePreshiftInputSchema, input, run: savePreshift });
  if (result.ok && result.persisted) refreshService();
  return result;
}

export async function acknowledgePreshiftAction(input: unknown) {
  const result = await executeWorkflowAction({ operation: "preshift.acknowledge", schema: acknowledgePreshiftInputSchema, input, run: acknowledgePreshift });
  if (result.ok && result.persisted) refreshService();
  return result;
}
