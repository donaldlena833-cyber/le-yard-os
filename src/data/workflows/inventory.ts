import "server-only";

import {
  assertCondition,
  assertFound,
  throwDatabaseError,
} from "../errors";
import { requireManagedLocation } from "../resources";
import type { WorkflowContext } from "../execute";
import type {
  ApproveInventoryCountInput,
  CreateInventoryTransferInput,
  CreatePurchaseOrderInput,
  ConfigureInventoryCatalogInput,
  ReceiveInventoryDeliveryInput,
  ReviewInventoryTransferInput,
  ReviewWasteRecordInput,
  SubmitInventoryCountInput,
  SubmitWasteRecordInput,
} from "../schemas";

function normalizedNote(value: string | null | undefined) {
  return value?.trim() || null;
}

export async function configureInventoryCatalog(
  context: WorkflowContext,
  input: ConfigureInventoryCatalogInput,
) {
  const location = await requireManagedLocation(
    context.supabase,
    context.actor,
    input.workspaceLocationId,
  );
  const membership = context.actor.memberships.find(
    (candidate) => candidate.organizationId === location.organizationId,
  );
  assertCondition(
    membership?.role === "owner" || membership?.role === "admin",
    "forbidden",
    "Owner or admin access is required to configure inventory.",
  );

  const { requestId, command } = input;
  const payload = Object.fromEntries(
    Object.entries(input).filter(
      ([key]) => key !== "requestId" && key !== "workspaceLocationId" && key !== "command",
    ),
  );
  const { data, error } = await context.supabase.rpc("configure_inventory_catalog", {
    p_request_id: requestId,
    p_organization_id: location.organizationId,
    p_command: command,
    p_payload: payload,
  });
  if (error) throwDatabaseError(error, "The inventory setup change could not be saved.");
  assertCondition(
    typeof data === "object" && data !== null && "id" in data && "command" in data,
    "database",
    "The saved inventory setup record was not returned.",
  );
  const result = data as { id: unknown; command: unknown; replayed?: unknown };
  return {
    id: String(result.id),
    command: String(result.command),
    replayed: result.replayed === true,
  };
}

async function replayExistingInventoryCount(
  context: WorkflowContext,
  organizationId: string,
  locationId: string,
  input: SubmitInventoryCountInput,
) {
  const { data: existing, error: existingError } = await context.supabase
    .from("inventory_counts")
    .select("id, organization_id, location_id, status, count_type, counted_by, counted_at, notes")
    .eq("id", input.submissionId)
    .maybeSingle();
  if (existingError) {
    throwDatabaseError(existingError, "The inventory submission could not be checked.");
  }
  if (!existing) return null;

  assertCondition(
    existing.organization_id === organizationId &&
      existing.location_id === locationId &&
      existing.counted_by === context.actor.userId &&
      existing.count_type === input.countType &&
      normalizedNote(existing.notes) === normalizedNote(input.notes),
    "conflict",
    "This inventory submission id is already attached to a different request.",
  );

  const { data: lines, error: lineError } = await context.supabase
    .from("inventory_count_lines")
    .select("inventory_item_id, unit_id, counted_quantity, notes")
    .eq("organization_id", organizationId)
    .eq("inventory_count_id", existing.id);
  if (lineError) {
    throwDatabaseError(lineError, "The existing inventory count could not be verified.");
  }
  const requested = new Map(input.lines.map((line) => [line.inventoryItemId, line]));
  assertCondition(
    lines?.length === input.lines.length &&
      lines.every((line) => {
        const candidate = requested.get(line.inventory_item_id);
        return Boolean(
          candidate &&
            candidate.unitId === line.unit_id &&
            candidate.countedQuantity === Number(line.counted_quantity) &&
            normalizedNote(candidate.notes) === normalizedNote(line.notes),
        );
      }),
    "conflict",
    "This inventory submission id is already attached to different count lines.",
  );

  return {
    id: existing.id,
    status: existing.status,
    countedAt: existing.counted_at,
    lineCount: lines.length,
    alreadyApplied: true,
  };
}

async function buildAuthoritativeCountLines(
  context: WorkflowContext,
  organizationId: string,
  locationId: string,
  input: SubmitInventoryCountInput,
) {
  const { data: items, error: itemError } = await context.supabase
    .from("inventory_items")
    .select("id, base_unit_id")
    .eq("organization_id", organizationId)
    .eq("is_active", true)
    .eq("track_inventory", true)
    .order("id");
  if (itemError) throwDatabaseError(itemError, "Inventory items could not be verified.");
  assertCondition(items?.length, "conflict", "There are no active tracked items to count.");

  const submittedByItem = new Map<string, SubmitInventoryCountInput["lines"][number]>();
  for (const line of input.lines) {
    assertCondition(
      !submittedByItem.has(line.inventoryItemId),
      "conflict",
      "Each tracked item may appear only once in a full inventory count.",
    );
    submittedByItem.set(line.inventoryItemId, line);
  }
  assertCondition(
    submittedByItem.size === items.length &&
      items.every((item) => {
        const submitted = submittedByItem.get(item.id);
        return submitted?.unitId === item.base_unit_id;
      }),
    "conflict",
    "A full count must include every active tracked item in its current base unit.",
  );

  const itemIds = items.map((item) => item.id);
  const [{ data: onHandRows, error: onHandError }, { data: priceRows, error: priceError }] =
    await Promise.all([
      context.supabase
        .from("inventory_on_hand")
        .select("inventory_item_id, quantity_on_hand")
        .eq("organization_id", organizationId)
        .eq("location_id", locationId)
        .in("inventory_item_id", itemIds),
      context.supabase
        .from("item_price_history")
        .select("inventory_item_id, unit_id, unit_price_cents, effective_at")
        .eq("organization_id", organizationId)
        .in("inventory_item_id", itemIds)
        .order("effective_at", { ascending: false })
        .limit(5_000),
    ]);
  if (onHandError) throwDatabaseError(onHandError, "Current on-hand quantities could not be verified.");
  if (priceError) throwDatabaseError(priceError, "Current inventory costs could not be verified.");

  const onHand = new Map(
    (onHandRows ?? []).map((row) => [row.inventory_item_id, Number(row.quantity_on_hand)]),
  );
  const latestPrice = new Map<string, number>();
  for (const price of priceRows ?? []) {
    const key = `${price.inventory_item_id}:${price.unit_id}`;
    if (!latestPrice.has(key)) latestPrice.set(key, Number(price.unit_price_cents));
  }

  return items.map((item) => {
    const submitted = submittedByItem.get(item.id)!;
    return {
      inventory_item_id: item.id,
      unit_id: item.base_unit_id,
      expected_quantity: onHand.get(item.id) ?? 0,
      counted_quantity: submitted.countedQuantity,
      unit_cost_cents: latestPrice.get(`${item.id}:${item.base_unit_id}`) ?? null,
      notes: normalizedNote(submitted.notes),
    };
  });
}

export async function submitInventoryCount(
  context: WorkflowContext,
  input: SubmitInventoryCountInput,
) {
  const location = await requireManagedLocation(
    context.supabase,
    context.actor,
    input.locationId,
  );
  const replay = await replayExistingInventoryCount(
    context,
    location.organizationId,
    location.id,
    input,
  );
  if (replay) return replay;

  const lines = await buildAuthoritativeCountLines(
    context,
    location.organizationId,
    location.id,
    input,
  );
  const { data, error } = await context.supabase.rpc("submit_inventory_count", {
    p_submission_id: input.submissionId,
    p_location_id: input.locationId,
    p_count_type: input.countType,
    p_notes: normalizedNote(input.notes),
    p_lines: lines,
  });
  if (error) throwDatabaseError(error, "The inventory count could not be submitted.");
  const count = assertFound(data, "The submitted inventory count was not returned.");

  return {
    id: count.id as string,
    status: count.status as string,
    countedAt: count.counted_at as string,
    lineCount: lines.length,
    alreadyApplied: false,
  };
}

export async function approveInventoryCount(
  context: WorkflowContext,
  input: ApproveInventoryCountInput,
) {
  const { data: countRecord, error: countError } = await context.supabase
    .from("inventory_counts")
    .select("id, location_id, counted_by")
    .eq("id", input.countId)
    .maybeSingle();
  if (countError) throwDatabaseError(countError, "The inventory count could not be verified.");
  const existing = assertFound(countRecord, "The inventory count was not found.");
  await requireManagedLocation(context.supabase, context.actor, existing.location_id);
  assertCondition(
    existing.counted_by !== context.actor.userId,
    "conflict",
    "An inventory count must be reviewed by someone other than its counter.",
  );

  const { data, error } = await context.supabase.rpc("approve_inventory_count", {
    p_request_id: input.requestId,
    p_count_id: input.countId,
    p_approve: input.approve,
    p_note: normalizedNote(input.note),
  });
  if (error) throwDatabaseError(error, "The inventory count review could not be recorded.");
  const count = assertFound(data, "The reviewed inventory count was not returned.");
  return {
    id: count.id as string,
    status: count.status as string,
    approvedAt: (count.approved_at as string | null) ?? null,
  };
}

export async function createPurchaseOrder(
  context: WorkflowContext,
  input: CreatePurchaseOrderInput,
) {
  await requireManagedLocation(context.supabase, context.actor, input.locationId);
  const { data, error } = await context.supabase.rpc("create_purchase_order", {
      p_request_id: input.requestId,
      p_location_id: input.locationId,
      p_vendor_id: input.vendorId,
      p_po_number: input.poNumber,
      p_ordered_on: input.orderedOn ?? null,
      p_expected_on: input.expectedOn ?? null,
      p_tax_cents: input.taxCents,
      p_shipping_cents: input.shippingCents,
      p_notes: normalizedNote(input.notes),
      p_lines: input.lines.map((line) => ({
        inventory_item_id: line.inventoryItemId,
        unit_id: line.unitId,
        quantity: line.quantity,
        unit_price_cents: line.unitPriceCents,
        notes: normalizedNote(line.notes),
      })),
  });
  if (error) throwDatabaseError(error, "The purchase order could not be created.");
  const order = assertFound(data, "The created purchase order was not returned.");
  return {
    id: String(order.id),
    status: String(order.status),
    subtotalCents: Number(order.subtotal_cents),
  };
}

export async function receiveInventoryDelivery(
  context: WorkflowContext,
  input: ReceiveInventoryDeliveryInput,
) {
  await requireManagedLocation(context.supabase, context.actor, input.locationId);
  const { data, error } = await context.supabase.rpc("receive_inventory_delivery", {
      p_request_id: input.requestId,
      p_location_id: input.locationId,
      p_vendor_id: input.vendorId,
      p_purchase_order_id: input.purchaseOrderId ?? null,
      p_delivered_at: input.deliveredAt,
      p_invoice_number: normalizedNote(input.invoiceNumber),
      p_notes: normalizedNote(input.notes),
      p_lines: input.lines.map((line) => ({
        inventory_item_id: line.inventoryItemId,
        unit_id: line.unitId,
        quantity: line.quantity,
        accepted_quantity: line.acceptedQuantity,
        unit_price_cents: line.unitPriceCents,
        lot_code: normalizedNote(line.lotCode),
        expires_on: line.expiresOn ?? null,
      })),
  });
  if (error) throwDatabaseError(error, "The inventory delivery could not be received.");
  const delivery = assertFound(data, "The received delivery was not returned.");
  return {
    id: String(delivery.id),
    deliveredAt: String(delivery.delivered_at),
    purchaseOrderId: delivery.purchase_order_id ? String(delivery.purchase_order_id) : null,
  };
}

export async function submitWasteRecord(
  context: WorkflowContext,
  input: SubmitWasteRecordInput,
) {
  await requireManagedLocation(context.supabase, context.actor, input.locationId);
  const { data, error } = await context.supabase.rpc("submit_waste_record", {
      p_request_id: input.requestId,
      p_location_id: input.locationId,
      p_inventory_item_id: input.inventoryItemId,
      p_unit_id: input.unitId,
      p_quantity: input.quantity,
      p_reason_code: input.reasonCode,
      p_occurred_at: input.occurredAt,
      p_notes: normalizedNote(input.notes),
  });
  if (error) throwDatabaseError(error, "The waste record could not be submitted.");
  const waste = assertFound(data, "The submitted waste record was not returned.");
  return {
    id: String(waste.id),
    status: String(waste.status),
    estimatedCostCents: waste.estimated_cost_cents == null
      ? null
      : Number(waste.estimated_cost_cents),
  };
}

export async function reviewWasteRecord(
  context: WorkflowContext,
  input: ReviewWasteRecordInput,
) {
  const { data: record, error } = await context.supabase
    .from("waste_records")
    .select("id, location_id, recorded_by")
    .eq("id", input.wasteRecordId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The waste record could not be verified.");
  const existing = assertFound(record, "The waste record was not found.");
  await requireManagedLocation(context.supabase, context.actor, existing.location_id);
  assertCondition(
    existing.recorded_by !== context.actor.userId,
    "conflict",
    "Waste must be reviewed by someone other than its recorder.",
  );
  const { data, error: reviewError } = await context.supabase.rpc("review_waste_record", {
      p_request_id: input.requestId,
      p_waste_record_id: input.wasteRecordId,
      p_approve: input.approve,
      p_note: normalizedNote(input.note),
  });
  if (reviewError) throwDatabaseError(reviewError, "The waste review could not be recorded.");
  const waste = assertFound(data, "The reviewed waste record was not returned.");
  return {
    id: String(waste.id),
    status: String(waste.status),
    reviewedAt: waste.approved_at ? String(waste.approved_at) : null,
  };
}

export async function createInventoryTransfer(
  context: WorkflowContext,
  input: CreateInventoryTransferInput,
) {
  await requireManagedLocation(context.supabase, context.actor, input.fromLocationId);
  const { data, error } = await context.supabase.rpc("create_inventory_transfer", {
      p_request_id: input.requestId,
      p_from_location_id: input.fromLocationId,
      p_to_location_id: input.toLocationId,
      p_notes: normalizedNote(input.notes),
      p_lines: input.lines.map((line) => ({
        inventory_item_id: line.inventoryItemId,
        unit_id: line.unitId,
        sent_quantity: line.sentQuantity,
      })),
  });
  if (error) throwDatabaseError(error, "The inventory transfer could not be submitted.");
  const transfer = assertFound(data, "The submitted inventory transfer was not returned.");
  return { id: String(transfer.id), status: String(transfer.status) };
}

export async function reviewInventoryTransfer(
  context: WorkflowContext,
  input: ReviewInventoryTransferInput,
) {
  const { data: record, error } = await context.supabase
    .from("inventory_transfers")
    .select("id, to_location_id, created_by")
    .eq("id", input.transferId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The transfer could not be verified.");
  const existing = assertFound(record, "The inventory transfer was not found.");
  await requireManagedLocation(context.supabase, context.actor, existing.to_location_id);
  assertCondition(
    existing.created_by !== context.actor.userId,
    "conflict",
    "A transfer must be reviewed by someone other than its creator.",
  );
  const { data, error: reviewError } = await context.supabase.rpc("review_inventory_transfer", {
      p_request_id: input.requestId,
      p_transfer_id: input.transferId,
      p_approve: input.approve,
      p_note: normalizedNote(input.note),
      p_lines: input.lines.map((line) => ({
        inventory_item_id: line.inventoryItemId,
        unit_id: line.unitId,
        received_quantity: line.receivedQuantity,
      })),
  });
  if (reviewError) throwDatabaseError(reviewError, "The inventory transfer review could not be recorded.");
  const transfer = assertFound(data, "The reviewed inventory transfer was not returned.");
  return {
    id: String(transfer.id),
    status: String(transfer.status),
    reviewedAt: transfer.reviewed_at ? String(transfer.reviewed_at) : null,
  };
}
