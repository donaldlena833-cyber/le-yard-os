"use server";

import { revalidatePath } from "next/cache";
import { assertCondition, throwDatabaseError } from "@/data/errors";
import { executeWorkflowAction, type WorkflowContext } from "@/data/execute";
import { canRecordChurchBatchLabels } from "@/data/read-models/church-ingredient-batches.server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import {
  churchBatchLabel, churchBatchMeasurement, measureChurchIngredientBatchInput, recordChurchIngredientBatchInput,
  resolveChurchIngredientBatchInput, voidChurchIngredientBatchInput,
} from "@/lib/kitchen/church-ingredient-batches";

async function batchLocation(context: WorkflowContext) {
  const session = await resolveWorkspaceSession();
  assertCondition(session.status === "ready" && session.context.identity.userId === context.actor.userId
    && canRecordChurchBatchLabels(session.context),
  "forbidden", "Church Street recipe or prep management access is required.");
  return session.context.activeLocation.id;
}

function parseBatchLabel(data: unknown) {
  const parsed = churchBatchLabel.safeParse(data);
  assertCondition(parsed.success, "database", "The saved batch label could not be loaded.");
  return parsed.data;
}

export async function recordChurchIngredientBatchAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church.kitchen.batch-label.record",
    schema: recordChurchIngredientBatchInput,
    input,
    run: async (context, batch) => {
      const location = await batchLocation(context);
      const { data, error } = await context.supabase.rpc("record_church_ingredient_batch", {
        p_location_id: location,
        p_request_id: batch.requestId,
        p_ingredient_key: batch.ingredientKey,
        p_evidence_revision: batch.evidenceRevision,
        p_supplier_lot: batch.supplierLot,
        p_batch_code: batch.batchCode,
        p_handled_as: batch.handledAs,
        p_handled_at: batch.handledAt,
        p_discard_at: batch.discardAt,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "The Church Street batch label could not be recorded.");
      return parseBatchLabel(data);
    },
  });
  if (result.ok && result.persisted) revalidatePath("/kitchen");
  return result;
}

export async function voidChurchIngredientBatchAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church.kitchen.batch-label.void",
    schema: voidChurchIngredientBatchInput,
    input,
    run: async (context, label) => {
      const location = await batchLocation(context);
      const { data, error } = await context.supabase.rpc("void_church_ingredient_batch", {
        p_location_id: location,
        p_batch_id: label.batchId,
        p_request_id: label.requestId,
        p_reason: label.reason,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "The Church Street batch label could not be voided.");
      return parseBatchLabel(data);
    },
  });
  if (result.ok && result.persisted) revalidatePath("/kitchen");
  return result;
}

export async function measureChurchIngredientBatchAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church.kitchen.batch-label.measure",
    schema: measureChurchIngredientBatchInput,
    input,
    run: async (context, measurement) => {
      const location = await batchLocation(context);
      const { data, error } = await context.supabase.rpc("record_church_ingredient_batch_measurement", {
        p_location_id: location,
        p_batch_id: measurement.batchId,
        p_request_id: measurement.requestId,
        p_expected_latest_id: measurement.expectedLatestId,
        p_quantity: measurement.quantity,
        p_observed_at: measurement.observedAt,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "The usable quantity could not be recorded.");
      const receipt = churchBatchMeasurement.safeParse(data);
      assertCondition(receipt.success && receipt.data.id === measurement.requestId && receipt.data.batchId === measurement.batchId,
        "database", "The saved batch measurement could not be confirmed.");
      return receipt.data;
    },
  });
  if (result.ok && result.persisted) revalidatePath("/kitchen");
  return result;
}

export async function resolveChurchIngredientBatchAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church.kitchen.batch-label.resolve",
    schema: resolveChurchIngredientBatchInput,
    input,
    run: async (context, resolution) => {
      const location = await batchLocation(context);
      const { data, error } = await context.supabase.rpc("resolve_church_ingredient_batch", {
        p_location_id: location,
        p_batch_id: resolution.batchId,
        p_request_id: resolution.requestId,
        p_outcome: resolution.outcome,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "The Church Street batch outcome could not be saved.");
      const saved = parseBatchLabel(data);
      assertCondition(saved.disposition?.outcome === resolution.outcome, "database", "The saved batch outcome could not be confirmed.");
      return saved;
    },
  });
  if (result.ok && result.persisted) revalidatePath("/kitchen");
  return result;
}
