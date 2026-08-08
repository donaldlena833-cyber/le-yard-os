"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  finalizeReceiptUploadInputSchema,
  receiptUploadUrlInputSchema,
  reviewReceiptInputSchema,
} from "@/data/schemas";
import {
  assignReceiptInventoryMatchInputSchema,
  resolveReceiptDuplicateInputSchema,
  setDeliveryReceiptLinkInputSchema,
  setExpenseReceiptLinkInputSchema,
} from "@/data/receipt-schemas";
import {
  assignReceiptInventoryMatch,
  createReceiptUploadUrl,
  finalizeReceiptUpload,
  reviewReceipt,
  resolveReceiptDuplicate,
  setDeliveryReceiptLink,
  setExpenseReceiptLink,
} from "@/data/workflows/receipts";

export async function assignReceiptInventoryMatchAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "receipt.inventory.match",
    schema: assignReceiptInventoryMatchInputSchema,
    input,
    run: assignReceiptInventoryMatch,
  });
  if (result.ok && result.persisted) revalidatePath("/receipts");
  return result;
}

export async function reviewReceiptAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "receipt.review",
    schema: reviewReceiptInputSchema,
    input,
    run: reviewReceipt,
  });
  if (result.ok && result.persisted) revalidatePath("/receipts");
  return result;
}

export async function createReceiptUploadUrlAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "receipt.create_private_upload_url",
    schema: receiptUploadUrlInputSchema,
    input,
    run: createReceiptUploadUrl,
  });
  if (result.ok && result.persisted) revalidatePath("/receipts");
  return result;
}

export async function finalizeReceiptUploadAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "receipt.finalize_private_upload",
    schema: finalizeReceiptUploadInputSchema,
    input,
    run: finalizeReceiptUpload,
  });
  if (result.ok && result.persisted) revalidatePath("/receipts");
  return result;
}

export async function resolveReceiptDuplicateAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "receipt.duplicate.resolve",
    schema: resolveReceiptDuplicateInputSchema,
    input,
    run: resolveReceiptDuplicate,
  });
  if (result.ok && result.persisted) revalidatePath("/receipts");
  return result;
}

export async function setExpenseReceiptLinkAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "receipt.expense.link",
    schema: setExpenseReceiptLinkInputSchema,
    input,
    run: setExpenseReceiptLink,
  });
  if (result.ok && result.persisted) revalidatePath("/receipts");
  return result;
}

export async function setDeliveryReceiptLinkAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "receipt.delivery.link",
    schema: setDeliveryReceiptLinkInputSchema,
    input,
    run: setDeliveryReceiptLink,
  });
  if (result.ok && result.persisted) revalidatePath("/receipts");
  return result;
}
