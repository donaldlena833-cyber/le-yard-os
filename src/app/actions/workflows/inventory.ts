"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  approveInventoryCountInputSchema,
  configureInventoryCatalogInputSchema,
  createInventoryTransferInputSchema,
  createPurchaseOrderInputSchema,
  receiveInventoryDeliveryInputSchema,
  reviewDeliveryExceptionsInputSchema,
  reviewPurchaseOrderInputSchema,
  recordInventoryItemCostInputSchema,
  reviewInventoryTransferInputSchema,
  reviewWasteRecordInputSchema,
  submitInventoryCountInputSchema,
  submitWasteRecordInputSchema,
} from "@/data/schemas";
import {
  approveInventoryCount,
  configureInventoryCatalog,
  createInventoryTransfer,
  createPurchaseOrder,
  receiveInventoryDelivery,
  reviewDeliveryExceptions,
  reviewPurchaseOrder,
  recordInventoryItemCost,
  reviewInventoryTransfer,
  reviewWasteRecord,
  submitInventoryCount,
  submitWasteRecord,
} from "@/data/workflows/inventory";

export async function configureInventoryCatalogAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.catalog_configure",
    schema: configureInventoryCatalogInputSchema,
    input,
    run: configureInventoryCatalog,
  });
  if (result.ok && result.persisted) revalidatePath("/inventory");
  return result;
}

export async function recordInventoryItemCostAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.item_cost_record",
    schema: recordInventoryItemCostInputSchema,
    input,
    run: recordInventoryItemCost,
  });
  if (result.ok && result.persisted) revalidatePath("/inventory");
  return result;
}

export async function submitInventoryCountAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.count_submit",
    schema: submitInventoryCountInputSchema,
    input,
    run: submitInventoryCount,
  });
  if (result.ok && result.persisted) revalidatePath("/inventory");
  return result;
}

export async function approveInventoryCountAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.count_review",
    schema: approveInventoryCountInputSchema,
    input,
    run: approveInventoryCount,
  });
  if (result.ok && result.persisted) revalidatePath("/inventory");
  return result;
}

export async function createPurchaseOrderAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.purchase_order_create",
    schema: createPurchaseOrderInputSchema,
    input,
    run: createPurchaseOrder,
  });
  if (result.ok && result.persisted) revalidatePath("/inventory");
  return result;
}

export async function receiveInventoryDeliveryAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.delivery_receive",
    schema: receiveInventoryDeliveryInputSchema,
    input,
    run: receiveInventoryDelivery,
  });
  if (result.ok && result.persisted) revalidatePath("/inventory");
  return result;
}

export async function reviewDeliveryExceptionsAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.delivery_exception_review",
    schema: reviewDeliveryExceptionsInputSchema,
    input,
    run: reviewDeliveryExceptions,
  });
  if (result.ok && result.persisted) revalidatePath("/inventory");
  return result;
}

export async function reviewPurchaseOrderAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.purchase_order_review",
    schema: reviewPurchaseOrderInputSchema,
    input,
    run: reviewPurchaseOrder,
  });
  if (result.ok && result.persisted) revalidatePath("/inventory");
  return result;
}

export async function submitWasteRecordAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.waste_submit",
    schema: submitWasteRecordInputSchema,
    input,
    run: submitWasteRecord,
  });
  if (result.ok && result.persisted) revalidatePath("/inventory");
  return result;
}

export async function reviewWasteRecordAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.waste_review",
    schema: reviewWasteRecordInputSchema,
    input,
    run: reviewWasteRecord,
  });
  if (result.ok && result.persisted) revalidatePath("/inventory");
  return result;
}

export async function createInventoryTransferAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.transfer_create",
    schema: createInventoryTransferInputSchema,
    input,
    run: createInventoryTransfer,
  });
  if (result.ok && result.persisted) revalidatePath("/inventory");
  return result;
}

export async function reviewInventoryTransferAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.transfer_review",
    schema: reviewInventoryTransferInputSchema,
    input,
    run: reviewInventoryTransfer,
  });
  if (result.ok && result.persisted) revalidatePath("/inventory");
  return result;
}
