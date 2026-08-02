"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  approveCloseoutInputSchema,
  closeoutUploadUrlInputSchema,
  finalizeCloseoutUploadInputSchema,
  submitCloseoutInputSchema,
} from "@/data/schemas";
import {
  approveCloseout,
  createCloseoutUploadUrl,
  finalizeCloseoutUpload,
  submitCloseout,
} from "@/data/workflows/closeout";

export async function submitCloseoutAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "closeout.submit",
    schema: submitCloseoutInputSchema,
    input,
    run: submitCloseout,
  });
  if (result.ok && result.persisted) {
    revalidatePath("/closeout");
    revalidatePath("/reports");
  }
  return result;
}

export async function approveCloseoutAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "closeout.decide",
    schema: approveCloseoutInputSchema,
    input,
    run: approveCloseout,
  });
  if (result.ok && result.persisted) {
    revalidatePath("/closeout");
    revalidatePath("/reports");
  }
  return result;
}

export async function createCloseoutUploadUrlAction(input: unknown) {
  return executeWorkflowAction({
    operation: "closeout.create_private_upload_url",
    schema: closeoutUploadUrlInputSchema,
    input,
    persists: false,
    run: createCloseoutUploadUrl,
  });
}

export async function finalizeCloseoutUploadAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "closeout.finalize_private_upload",
    schema: finalizeCloseoutUploadInputSchema,
    input,
    run: finalizeCloseoutUpload,
  });
  if (result.ok && result.persisted) revalidatePath("/closeout");
  return result;
}
