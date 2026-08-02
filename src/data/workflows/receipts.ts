import "server-only";

import {
  assertCondition,
  assertFound,
  throwDatabaseError,
  WorkflowError,
} from "../errors";
import { requireLocationManagement } from "../policy";
import { requireManagedLocation } from "../resources";
import {
  buildPrivateObjectPath,
  normalizePrivateFileName,
  parsePrivateObjectPath,
  validatePrivateFile,
} from "@/lib/storage/private-files";
import {
  hasExpectedFileSignature,
  sha256Hex,
} from "@/lib/storage/file-integrity";
import type { WorkflowContext } from "../execute";
import type {
  FinalizeReceiptUploadInput,
  ReceiptUploadUrlInput,
  ReviewReceiptInput,
} from "../schemas";
import type {
  ResolveReceiptDuplicateInput,
  SetReceiptReferenceLinkInput,
} from "../receipt-schemas";
import type { Json } from "@/types/database.generated";

type JsonObject = { [key: string]: Json | undefined };

async function recordReceiptFingerprint(
  context: WorkflowContext,
  receipt: { id: string; requestId: string },
  bytes: Uint8Array,
) {
  const contentHash = sha256Hex(bytes);
  const { data, error } = await context.supabase.rpc("record_receipt_fingerprint", {
    p_request_id: receipt.requestId,
    p_receipt_id: receipt.id,
    p_content_hash: contentHash,
  });
  if (error) throwDatabaseError(error, "The receipt fingerprint could not be recorded.");
  const result = assertFound(data, "The receipt fingerprint result was not returned.");
  assertCondition(
    typeof result === "object" && !Array.isArray(result),
    "database",
    "The receipt fingerprint result was malformed.",
  );
  const receiptId = result.receipt_id;
  const recordedHash = result.content_hash;
  const duplicateReceiptId = result.duplicate_receipt_id;
  assertCondition(
    receiptId === receipt.id &&
      recordedHash === contentHash &&
      (duplicateReceiptId === null || typeof duplicateReceiptId === "string"),
    "database",
    "The receipt fingerprint result did not match the verified private file.",
  );
  return {
    contentHash,
    duplicateReceiptId,
  };
}

function toReceiptPatch(input: ReviewReceiptInput): JsonObject {
  const patch: JsonObject = {};
  if (input.vendorId !== undefined) patch.vendor_id = input.vendorId;
  if (input.expenseCategoryId !== undefined) {
    patch.expense_category_id = input.expenseCategoryId;
  }
  if (input.documentNumber !== undefined) patch.document_number = input.documentNumber;
  if (input.documentDate !== undefined) patch.document_date = input.documentDate;
  if (input.totalCents !== undefined) patch.total_cents = input.totalCents;
  if (input.taxCents !== undefined) patch.tax_cents = input.taxCents;
  if (input.paymentMethod !== undefined) patch.payment_method = input.paymentMethod;
  if (input.notes !== undefined) patch.notes = input.notes;
  return patch;
}

function providedPatchMatches(
  receipt: Record<string, unknown>,
  patch: JsonObject,
): boolean {
  return Object.entries(patch).every(([key, value]) => receipt[key] === value);
}

async function requireSameOrganizationReference(
  context: WorkflowContext,
  table: "vendors" | "expense_categories",
  id: string,
  organizationId: string,
  label: string,
) {
  const { data, error } = await context.supabase
    .from(table)
    .select("id")
    .eq("id", id)
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throwDatabaseError(error, `${label} could not be verified.`);
  assertFound(data, `${label} was not found in this organization.`);
}

export async function reviewReceipt(
  context: WorkflowContext,
  input: ReviewReceiptInput,
) {
  const { supabase, actor } = context;
  const { data, error } = await supabase
    .from("receipts")
    .select(
      "id, organization_id, location_id, review_status, reviewed_at, vendor_id, expense_category_id, document_number, document_date, total_cents, tax_cents, payment_method, notes",
    )
    .eq("id", input.receiptId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The receipt could not be loaded.");
  const receipt = assertFound(data, "The receipt was not found.");
  requireLocationManagement(actor, receipt.organization_id, receipt.location_id);

  if (input.vendorId) {
    await requireSameOrganizationReference(
      context,
      "vendors",
      input.vendorId,
      receipt.organization_id,
      "The vendor",
    );
  }
  if (input.expenseCategoryId) {
    await requireSameOrganizationReference(
      context,
      "expense_categories",
      input.expenseCategoryId,
      receipt.organization_id,
      "The expense category",
    );
  }

  const patch = toReceiptPatch(input);
  if (receipt.review_status === "approved" || receipt.review_status === "rejected") {
    if (
      receipt.review_status === input.reviewStatus &&
      providedPatchMatches(receipt as unknown as Record<string, unknown>, patch)
    ) {
      return {
        id: receipt.id as string,
        reviewStatus: receipt.review_status as "approved" | "rejected",
        reviewedAt: receipt.reviewed_at as string | null,
        alreadyApplied: true,
      };
    }
    throw new WorkflowError(
      "conflict",
      `This receipt is already ${receipt.review_status} and is immutable through this workflow.`,
    );
  }

  const { data: updated, error: updateError } = await supabase.rpc(
    "review_receipt",
    {
      p_receipt_id: receipt.id,
      p_review_status: input.reviewStatus,
      p_patch: patch,
    },
  );
  if (updateError) throwDatabaseError(updateError, "The receipt review could not be saved.");
  const result = assertFound(updated, "The reviewed receipt was not returned.");

  return {
    id: result.id as string,
    reviewStatus: result.review_status as string,
    reviewedAt: result.reviewed_at as string,
    alreadyApplied: false,
  };
}

export function normalizeUploadFileName(fileName: string): string {
  return normalizePrivateFileName(fileName);
}

export async function createReceiptUploadUrl(
  { supabase, actor }: WorkflowContext,
  input: ReceiptUploadUrlInput,
) {
  const location = await requireManagedLocation(supabase, actor, input.locationId);
  const validation = validatePrivateFile("receipts", input.mimeType, input.sizeBytes);
  assertCondition(validation.ok, "validation", validation.message ?? "Invalid file.");

  const { data: existing, error: existingError } = await supabase
    .from("receipts")
    .select("id, organization_id, location_id, uploaded_by, review_status")
    .eq("id", input.uploadId)
    .maybeSingle();
  if (existingError) {
    throwDatabaseError(existingError, "The receipt upload could not be checked.");
  }
  if (existing) {
    assertCondition(
      existing.organization_id === location.organizationId &&
        existing.location_id === location.id &&
        existing.uploaded_by === actor.userId &&
        !["approved", "rejected"].includes(existing.review_status),
      "conflict",
      "This upload identifier is already bound to another receipt.",
    );
  } else {
    const { error: insertError } = await supabase.from("receipts").insert({
      id: input.uploadId,
      organization_id: location.organizationId,
      location_id: location.id,
      uploaded_by: actor.userId,
      source: input.source,
      review_status: "pending",
    });
    if (insertError) {
      throwDatabaseError(insertError, "The pending receipt could not be created.");
    }
  }

  const objectPath = buildPrivateObjectPath({
    organizationId: location.organizationId,
    locationId: location.id,
    resourceKind: "receipts",
    resourceId: input.uploadId,
    uploadId: input.uploadId,
    fileName: input.fileName,
  });

  const { data, error } = await supabase.storage
    .from("receipts")
    .createSignedUploadUrl(objectPath, { upsert: false });
  if (error) throwDatabaseError(error, "A private upload URL could not be created.");
  const upload = assertFound(data, "The private upload URL was not returned.");

  assertCondition(
    upload.path === objectPath,
    "database",
    "The storage service returned an unexpected object path.",
  );

  return {
    receiptId: input.uploadId,
    bucket: "receipts" as const,
    objectPath,
    signedUrl: upload.signedUrl,
    token: upload.token,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    upsert: false as const,
    alreadyCreated: Boolean(existing),
  };
}

export async function finalizeReceiptUpload(
  context: WorkflowContext,
  input: FinalizeReceiptUploadInput,
) {
  const { supabase, actor } = context;
  const validation = validatePrivateFile("receipts", input.mimeType, input.sizeBytes);
  assertCondition(validation.ok, "validation", validation.message ?? "Invalid file.");

  const { data: receiptRow, error: receiptError } = await supabase
    .from("receipts")
    .select("id, organization_id, location_id, review_status")
    .eq("id", input.receiptId)
    .maybeSingle();
  if (receiptError) throwDatabaseError(receiptError, "The receipt could not be loaded.");
  const receipt = assertFound(receiptRow, "The pending receipt was not found.");
  requireLocationManagement(actor, receipt.organization_id, receipt.location_id);
  assertCondition(
    !["approved", "rejected"].includes(receipt.review_status),
    "conflict",
    "Reviewed receipt evidence cannot be changed.",
  );

  const parsedPath = parsePrivateObjectPath(input.objectPath);
  assertCondition(
    parsedPath?.organizationId === receipt.organization_id &&
      parsedPath.locationId === receipt.location_id &&
      parsedPath.segments[2] === "receipts" &&
      parsedPath.segments[3] === receipt.id,
    "forbidden",
    "The uploaded object is outside this receipt's private scope.",
  );

  const { data: existing, error: existingError } = await supabase
    .from("receipt_files")
    .select("id, receipt_id, storage_path, mime_type, size_bytes")
    .eq("organization_id", receipt.organization_id)
    .eq("storage_path", input.objectPath)
    .maybeSingle();
  if (existingError) {
    throwDatabaseError(existingError, "The receipt file could not be checked.");
  }
  if (existing) {
    assertCondition(
      existing.receipt_id === receipt.id &&
        existing.mime_type === input.mimeType &&
        Number(existing.size_bytes) === input.sizeBytes,
      "conflict",
      "This private object is already bound with different metadata.",
    );
  }

  const { data: uploadedBlob, error: objectError } = await supabase.storage
    .from("receipts")
    .download(input.objectPath);
  if (objectError) throwDatabaseError(objectError, "The private upload could not be verified.");
  const uploaded = assertFound(
    uploadedBlob,
    "Upload the private file before finalizing the receipt.",
  );
  assertCondition(
    uploaded.size === input.sizeBytes,
    "conflict",
    "The uploaded file size does not match the pending receipt.",
  );
  const bytes = new Uint8Array(await uploaded.arrayBuffer());
  assertCondition(
    hasExpectedFileSignature(bytes, input.mimeType),
    "validation",
    "The private file contents do not match the selected document type.",
  );

  let fileId = existing?.id as string | undefined;
  if (!fileId) {
    const { data: inserted, error: insertError } = await supabase
      .from("receipt_files")
      .insert({
        organization_id: receipt.organization_id,
        receipt_id: receipt.id,
        storage_path: input.objectPath,
        file_name: normalizeUploadFileName(input.fileName),
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
      })
      .select("id")
      .single();
    if (insertError) {
      throwDatabaseError(insertError, "The receipt file could not be finalized.");
    }
    fileId = inserted.id as string;
  }

  const fingerprint = await recordReceiptFingerprint(
    context,
    { id: receipt.id as string, requestId: input.requestId },
    bytes,
  );

  return {
    id: fileId,
    receiptId: receipt.id as string,
    objectPath: input.objectPath,
    contentHash: fingerprint.contentHash,
    duplicateReceiptId: fingerprint.duplicateReceiptId,
    alreadyApplied: Boolean(existing),
  };
}

export async function resolveReceiptDuplicate(
  context: WorkflowContext,
  input: ResolveReceiptDuplicateInput,
) {
  const { data: match, error: matchError } = await context.supabase
    .from("receipt_duplicate_matches")
    .select("id, organization_id, receipt_id, possible_duplicate_id, resolution")
    .eq("id", input.matchId)
    .maybeSingle();
  if (matchError) throwDatabaseError(matchError, "The duplicate evidence could not be verified.");
  const sourceMatch = assertFound(match, "The duplicate evidence was not found.");

  const { data: receipts, error: receiptError } = await context.supabase
    .from("receipts")
    .select("id, organization_id, location_id, review_status")
    .in("id", [sourceMatch.receipt_id, sourceMatch.possible_duplicate_id]);
  if (receiptError) throwDatabaseError(receiptError, "The matched receipts could not be verified.");
  assertCondition(receipts?.length === 2, "not_found", "Both matched receipts must remain visible.");
  for (const receipt of receipts ?? []) {
    assertCondition(
      receipt.organization_id === sourceMatch.organization_id,
      "conflict",
      "The duplicate evidence is outside its receipt tenant.",
    );
    requireLocationManagement(context.actor, receipt.organization_id, receipt.location_id);
    assertCondition(
      !["approved", "rejected"].includes(receipt.review_status) ||
        receipt.id === sourceMatch.possible_duplicate_id,
      "conflict",
      "Terminal receipt duplicate evidence is immutable.",
    );
  }

  const { data, error } = await context.supabase.rpc("resolve_receipt_duplicate", {
    p_request_id: input.requestId,
    p_match_id: input.matchId,
    p_resolution: input.resolution,
  });
  if (error) throwDatabaseError(error, "The duplicate decision could not be saved.");
  const result = assertFound(data, "The resolved duplicate evidence was not returned.");
  return {
    id: result.id,
    resolution: result.resolution,
    resolvedAt: result.resolved_at,
  };
}

async function requireApprovedReceiptForReference(
  context: WorkflowContext,
  receiptId: string | null,
  organizationId: string,
  locationId: string,
) {
  if (!receiptId) return;
  const { data, error } = await context.supabase
    .from("receipts")
    .select("id, organization_id, location_id, review_status")
    .eq("id", receiptId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The linked receipt could not be verified.");
  const receipt = assertFound(data, "The linked receipt was not found.");
  assertCondition(
    receipt.organization_id === organizationId &&
      receipt.location_id === locationId &&
      receipt.review_status === "approved",
    "conflict",
    "Choose an approved receipt from the same location.",
  );
}

export async function setExpenseReceiptLink(
  context: WorkflowContext,
  input: SetReceiptReferenceLinkInput,
) {
  const { data: expense, error: expenseError } = await context.supabase
    .from("expenses")
    .select("id, organization_id, location_id")
    .eq("id", input.targetId)
    .maybeSingle();
  if (expenseError) throwDatabaseError(expenseError, "The expense could not be verified.");
  const target = assertFound(expense, "The expense was not found.");
  requireLocationManagement(context.actor, target.organization_id, target.location_id);
  await requireApprovedReceiptForReference(
    context,
    input.receiptId,
    target.organization_id,
    target.location_id,
  );
  const { data, error } = await context.supabase.rpc("set_expense_receipt_link", {
    p_request_id: input.requestId,
    p_expense_id: input.targetId,
    p_receipt_id: input.receiptId,
  });
  if (error) throwDatabaseError(error, "The expense receipt link could not be saved.");
  const result = assertFound(data, "The linked expense was not returned.");
  return { id: result.id, receiptId: result.receipt_id };
}

export async function setDeliveryReceiptLink(
  context: WorkflowContext,
  input: SetReceiptReferenceLinkInput,
) {
  const { data: delivery, error: deliveryError } = await context.supabase
    .from("deliveries")
    .select("id, organization_id, location_id")
    .eq("id", input.targetId)
    .maybeSingle();
  if (deliveryError) throwDatabaseError(deliveryError, "The delivery could not be verified.");
  const target = assertFound(delivery, "The delivery was not found.");
  requireLocationManagement(context.actor, target.organization_id, target.location_id);
  await requireApprovedReceiptForReference(
    context,
    input.receiptId,
    target.organization_id,
    target.location_id,
  );
  const { data, error } = await context.supabase.rpc("set_delivery_receipt_link", {
    p_request_id: input.requestId,
    p_delivery_id: input.targetId,
    p_receipt_id: input.receiptId,
  });
  if (error) throwDatabaseError(error, "The delivery receipt link could not be saved.");
  const result = assertFound(data, "The linked delivery was not returned.");
  return { id: result.id, receiptId: result.receipt_id };
}
