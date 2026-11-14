"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { executeWorkflowAction } from "@/data/execute";
import {
  finalizeManualCsvImportInputSchema,
  manualCsvUploadUrlInputSchema,
  retryIntegrationSyncInputSchema,
} from "@/data/schemas";
import {
  configureSquareProductionSource,
  createManualCsvUploadUrl,
  finalizeManualCsvImport,
  retryIntegrationSync,
  syncSquareProductionSource,
} from "@/data/workflows/integrations";

export async function configureSquareProductionSourceAction(input: unknown) {
  const sourceId = z.string().trim().regex(/^[A-Za-z0-9_-]{1,192}$/);
  const result = await executeWorkflowAction({
    operation: "integrations.square.configure_production_source",
    requiredTenantFeature: "providerIntegrations",
    schema: z.strictObject({
      requestId: z.uuid(), organizationId: z.uuid(), locationId: z.uuid(),
      merchantId: sourceId, squareLocationId: sourceId,
    }),
    input,
    run: configureSquareProductionSource,
  });
  if (result.ok && result.persisted) revalidatePath("/integrations");
  return result;
}

export async function syncSquareProductionSourceAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "integrations.square.sync_production_source",
    requiredTenantFeature: "providerIntegrations",
    schema: z.strictObject({
      requestId: z.uuid(), organizationId: z.uuid(), locationId: z.uuid(),
      cutoff: z.iso.datetime({ precision: 0 }),
    }),
    input,
    run: syncSquareProductionSource,
  });
  revalidatePath("/integrations");
  return result;
}

export async function createManualCsvUploadUrlAction(input: unknown) {
  return executeWorkflowAction({
    operation: "integrations.manual_csv.prepare_upload",
    requiredTenantFeature: "providerIntegrations",
    schema: manualCsvUploadUrlInputSchema,
    input,
    persists: false,
    run: createManualCsvUploadUrl,
  });
}

export async function finalizeManualCsvImportAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "integrations.manual_csv.queue",
    requiredTenantFeature: "providerIntegrations",
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
    requiredTenantFeature: "providerIntegrations",
    schema: retryIntegrationSyncInputSchema,
    input,
    run: retryIntegrationSync,
  });
  if (result.ok && result.persisted) revalidatePath("/integrations");
  return result;
}
