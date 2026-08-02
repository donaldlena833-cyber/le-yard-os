"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  finalizeManualCsvImportInputSchema,
  manualCsvUploadUrlInputSchema,
  retryIntegrationSyncInputSchema,
} from "@/data/schemas";
import {
  createManualCsvUploadUrl,
  finalizeManualCsvImport,
  retryIntegrationSync,
} from "@/data/workflows/integrations";

export async function createManualCsvUploadUrlAction(input: unknown) {
  return executeWorkflowAction({
    operation: "integrations.manual_csv.prepare_upload",
    schema: manualCsvUploadUrlInputSchema,
    input,
    persists: false,
    run: createManualCsvUploadUrl,
  });
}

export async function finalizeManualCsvImportAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "integrations.manual_csv.queue",
    schema: finalizeManualCsvImportInputSchema,
    input,
    run: finalizeManualCsvImport,
  });
  if (result.ok && result.persisted) revalidatePath("/integrations");
  return result;
}

export async function retryIntegrationSyncAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "integrations.sync.retry",
    schema: retryIntegrationSyncInputSchema,
    input,
    run: retryIntegrationSync,
  });
  if (result.ok && result.persisted) revalidatePath("/integrations");
  return result;
}
