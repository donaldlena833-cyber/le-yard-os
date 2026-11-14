import "server-only";

import { createHash } from "node:crypto";
import { z } from "zod";
import { churchSquareCountConfiguration } from "@/lib/integrations/church-square-configuration.server";
import { SquareCountClient, SquareCountError } from "@/lib/integrations/square-counts.server";
import { createAdminClient } from "@/lib/supabase/admin";
import { assertCondition, throwDatabaseError, WorkflowError } from "../errors";
import type { WorkflowContext } from "../execute";
import { requireLocationAccess } from "../policy";

const claimSchema = z.object({
  status: z.enum(["pending", "in_progress", "confirmed", "rejected", "recovery_required"]),
  requestId: z.uuid(),
  attemptId: z.uuid().nullish(),
  observedAt: z.string().optional(),
  quantity: z.union([z.string(), z.number()]).optional(),
  merchantId: z.string().optional(),
  squareLocationId: z.string().optional(),
  variationId: z.string().optional(),
  wasDispatched: z.boolean().optional(),
});
const squareStockReadback = z.object({
  currentQuantity: z.string().regex(/^-?\d{1,12}(?:\.\d{1,5})?$/),
  calculatedAt: z.iso.datetime({ offset: true }),
});
const stockReconciliation = z.object({ applied: z.number().int().nonnegative(), ignored: z.number().int().nonnegative() });

function requireSquareCountAdministrator(context: WorkflowContext, input: { organizationId: string; locationId: string }) {
  const membership = requireLocationAccess(context.actor, input.organizationId, input.locationId);
  assertCondition(membership.role === "owner" || membership.role === "admin",
    "forbidden", "Only an owner or admin can add Square items to stock counts.");
  const configuration = churchSquareCountConfiguration();
  assertCondition(configuration, "conflict", "Square stock counts are waiting for the café API connection.");
  return configuration;
}

function variationLabel(variation: { itemName: string; variationName: string }) {
  return variation.variationName === "Regular" || variation.variationName === variation.itemName
    ? variation.itemName : `${variation.itemName} · ${variation.variationName}`;
}

export function stockItemId(locationId: string, variationId: string) {
  const hash = createHash("sha256").update(`church-square-stock:${locationId}:${variationId}`).digest("hex");
  return `${hash.slice(0, 8)}-${hash.slice(8, 12)}-8${hash.slice(13, 16)}-8${hash.slice(17, 20)}-${hash.slice(20, 32)}`;
}

export async function listTrackedChurchSquareVariations(
  context: WorkflowContext,
  input: { organizationId: string; locationId: string },
) {
  const configuration = requireSquareCountAdministrator(context, input);
  const { data, error } = await context.supabase.rpc("list_church_square_count_items", { p_location_id: input.locationId });
  if (error) throwDatabaseError(error, "The café’s active stock items could not be loaded.");
  const mapped = new Set(z.array(z.object({ id: z.uuid() })).parse(data).map((item) => item.id));
  try {
    const variations = await new SquareCountClient(configuration).listTrackedVariations();
    return variations.filter((variation) => !mapped.has(stockItemId(input.locationId, variation.variationId)))
      .map((variation) => ({ id: variation.variationId, label: variationLabel(variation) }))
      .filter((variation) => variation.label.length <= 120);
  } catch {
    throw new WorkflowError("conflict", "Could not load the café’s tracked items from Square. Check the API connection and try again.");
  }
}

export async function configureChurchSquareCountItem(
  context: WorkflowContext,
  input: { organizationId: string; locationId: string; variationId: string },
) {
  const configuration = requireSquareCountAdministrator(context, input);

  let label: string;
  try {
    const variation = await new SquareCountClient(configuration).verifyTrackedVariation(input.variationId);
    label = variationLabel(variation);
    assertCondition(label.length <= 120, "conflict", "Shorten this item’s display name in Square first.");
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
    throw new WorkflowError("conflict", "Square could not verify this variation. Check that it belongs to Church Street and tracks stock by count.");
  }

  const { error } = await createAdminClient().rpc("service_configure_church_square_count_item", {
    p_actor_id: context.actor.userId,
    p_location_id: input.locationId,
    p_item_id: stockItemId(input.locationId, input.variationId),
    p_label: label,
    p_merchant_id: configuration.merchantId,
    p_square_location_id: configuration.locationId,
    p_variation_id: input.variationId,
    p_enabled: true,
  });
  if (error) throwDatabaseError(error, "The Square item could not be added.");
  return { label };
}

export async function sendChurchSquareCount(
  context: WorkflowContext,
  input: { organizationId: string; locationId: string; itemId: string; requestId: string; quantity: string; reason: string },
) {
  requireLocationAccess(context.actor, input.organizationId, input.locationId);
  const configuration = churchSquareCountConfiguration();
  assertCondition(configuration, "conflict", "Square stock counts are waiting for the café API connection.");
  const admin = createAdminClient();
  const { data, error } = await admin.rpc("service_claim_church_square_count", {
    p_actor_id: context.actor.userId,
    p_location_id: input.locationId,
    p_item_id: input.itemId,
    p_request_id: input.requestId,
    p_quantity: input.quantity,
    p_reason: input.reason,
  });
  if (error) throwDatabaseError(error, "The Square count could not be queued. Refresh to check for an existing count.");
  const claim = claimSchema.parse(data);
  if (claim.status === "confirmed" || claim.status === "rejected" || claim.status === "in_progress") {
    return { status: claim.status };
  }
  assertCondition(claim.requestId === input.requestId && claim.attemptId && claim.observedAt && claim.variationId
    && String(claim.quantity) === input.quantity && claim.merchantId === configuration.merchantId
    && claim.squareLocationId === configuration.locationId,
  "conflict", "The saved count does not match the current Square connection. Ask an owner to review it.");

  const client = new SquareCountClient(configuration);
  const observation = {
    requestId: claim.requestId, occurredAt: claim.observedAt,
    quantity: Number(claim.quantity), variationId: claim.variationId,
  };
  let dispatchMarked = claim.wasDispatched === true;
  async function rejectUndispatched() {
    const { error: finishError } = await admin.rpc("service_finish_church_square_count", {
      p_request_id: input.requestId, p_attempt_id: claim.attemptId!, p_status: "rejected",
    });
    return { status: finishError ? "pending" as const : "rejected" as const };
  }
  if (claim.status === "recovery_required" && !dispatchMarked) return rejectUndispatched();
  let receipt;
  try {
    receipt = claim.status === "recovery_required"
      ? await client.confirmPhysicalCount(observation)
      : await client.writePhysicalCount(observation, async () => {
        const { data: allowed, error: dispatchError } = await admin.rpc("service_mark_church_square_count_dispatched", {
          p_request_id: input.requestId, p_attempt_id: claim.attemptId!,
        });
        if (dispatchError || allowed !== true) throw new Error("The Square count dispatch could not be recorded.");
        dispatchMarked = true;
      });
  } catch (error) {
    if (!dispatchMarked && error instanceof SquareCountError
      && ["invalid_input", "scope_mismatch", "variation_ineligible"].includes(error.code)) return rejectUndispatched();
    return { status: "pending" as const };
  }
  if (!receipt) return { status: "recovery_required" as const };

  const { error: finishError } = await admin.rpc("service_finish_church_square_count", {
    p_request_id: input.requestId,
    p_attempt_id: claim.attemptId,
    p_status: "confirmed",
    p_provider_count_id: receipt.physicalCountId,
  });
  if (finishError) return { status: "pending" as const };

  // The confirmed physical receipt and Square's current stock are separate facts.
  // Feed only the latter through the same monotonic observation path as recovery.
  try {
    const stock = squareStockReadback.safeParse(receipt);
    const calculatedAt = stock.success ? Date.parse(stock.data.calculatedAt) : NaN;
    if (!stock.success || receipt.variationId !== claim.variationId || receipt.locationId !== configuration.locationId
      || !(calculatedAt >= Date.parse(observation.occurredAt) && calculatedAt <= Date.now() + 60_000)) {
      throw new Error("The confirmed Square stock observation is unavailable.");
    }
    const saved = await admin.rpc("service_reconcile_church_square_stock", {
      p_merchant_id: configuration.merchantId,
      p_square_location_id: configuration.locationId,
      p_inventory: [{ variationId: claim.variationId, quantity: stock.data.currentQuantity, calculatedAt: stock.data.calculatedAt }],
    }).abortSignal(AbortSignal.timeout(5_000));
    const result = stockReconciliation.safeParse(saved.data);
    if (saved.error || !result.success || result.data.applied + result.data.ignored !== 1) {
      throw new Error("The confirmed Square stock observation could not be saved.");
    }
    const { applied, ignored } = result.data;
    console.info("Church Street Square stock readback synced.", { applied, ignored });
  } catch {
    // A signed webhook or the scheduled read can still update the shared stock state.
    console.error("Church Street Square stock readback sync incomplete.");
  }
  return { status: "confirmed" as const, currentQuantity: receipt.currentQuantity };
}
