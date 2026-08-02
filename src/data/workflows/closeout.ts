import "server-only";

import {
  assertCondition,
  assertFound,
  isUniqueViolation,
  throwDatabaseError,
  WorkflowError,
} from "../errors";
import { requireLocationManagement } from "../policy";
import { requireManagedLocation } from "../resources";
import { canonicalJson, resolveTerminalReview } from "../state";
import type { WorkflowContext } from "../execute";
import type {
  ApproveCloseoutInput,
  CloseoutUploadUrlInput,
  FinalizeCloseoutUploadInput,
  SubmitCloseoutInput,
} from "../schemas";
import type { TableInsert } from "@/types/database.generated";
import {
  buildPrivateObjectPath,
  normalizePrivateFileName,
  parsePrivateObjectPath,
  validatePrivateFile,
} from "@/lib/storage/private-files";
import { hasExpectedFileSignature } from "@/lib/storage/file-integrity";

function normalizedCloseoutInput(input: SubmitCloseoutInput) {
  return {
    location_id: input.locationId,
    business_date: input.businessDate,
    shift_label: input.shiftLabel,
    gross_sales_cents: input.grossSalesCents,
    net_sales_cents: input.netSalesCents,
    cash_sales_cents: input.cashSalesCents,
    card_sales_cents: input.cardSalesCents,
    expected_cash_cents: input.expectedCashCents,
    actual_cash_cents: input.actualCashCents,
    covers: input.covers,
    comps_cents: input.compsCents,
    voids_cents: input.voidsCents,
    service_charges_cents: input.serviceChargesCents,
    card_tips_cents: input.cardTipsCents,
    cash_tips_cents: input.cashTipsCents,
    notes: input.notes ?? null,
  };
}

function closeoutMatches(existing: Record<string, unknown>, input: SubmitCloseoutInput) {
  const expected = normalizedCloseoutInput(input);
  const actual = Object.fromEntries(
    Object.keys(expected).map((key) => [key, existing[key] ?? null]),
  );
  return canonicalJson(actual) === canonicalJson(expected);
}

const CLOSEOUT_SELECT =
  "id, organization_id, location_id, business_date, shift_label, status, gross_sales_cents, net_sales_cents, cash_sales_cents, card_sales_cents, expected_cash_cents, actual_cash_cents, covers, comps_cents, voids_cents, service_charges_cents, card_tips_cents, cash_tips_cents, notes, submitted_by, submitted_at, approved_at" as const;

export async function submitCloseout(
  { supabase, actor }: WorkflowContext,
  input: SubmitCloseoutInput,
) {
  const location = await requireManagedLocation(supabase, actor, input.locationId);

  const { data: existing, error: existingError } = await supabase
    .from("shift_closeouts")
    .select(CLOSEOUT_SELECT)
    .eq("id", input.submissionId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError, "The closeout request could not be checked.");
  if (existing) {
    assertCondition(
      existing.organization_id === location.organizationId &&
        existing.submitted_by === actor.userId &&
        closeoutMatches(existing as unknown as Record<string, unknown>, input),
      "conflict",
      "This submission ID was already used for a different closeout.",
    );
    return {
      id: existing.id as string,
      status: existing.status as string,
      submittedAt: existing.submitted_at as string,
      alreadyApplied: true,
    };
  }

  const payload = {
    id: input.submissionId,
    organization_id: location.organizationId,
    ...normalizedCloseoutInput(input),
    status: "pending" as const,
    submitted_by: actor.userId,
    submitted_at: new Date().toISOString(),
  } satisfies TableInsert<"shift_closeouts">;
  const { data: inserted, error: insertError } = await supabase
    .from("shift_closeouts")
    .insert(payload)
    .select("id, status, submitted_at")
    .single();

  if (insertError) {
    if (isUniqueViolation(insertError)) {
      const { data: raced, error: racedError } = await supabase
        .from("shift_closeouts")
        .select(CLOSEOUT_SELECT)
        .eq("id", input.submissionId)
        .maybeSingle();
      if (racedError) throwDatabaseError(racedError);
      if (
        raced &&
        raced.organization_id === location.organizationId &&
        raced.submitted_by === actor.userId &&
        closeoutMatches(raced as unknown as Record<string, unknown>, input)
      ) {
        return {
          id: raced.id as string,
          status: raced.status as string,
          submittedAt: raced.submitted_at as string,
          alreadyApplied: true,
        };
      }
    }
    throwDatabaseError(insertError, "The closeout could not be submitted.");
  }

  return {
    id: inserted.id as string,
    status: inserted.status as string,
    submittedAt: inserted.submitted_at as string,
    alreadyApplied: false,
  };
}

export async function approveCloseout(
  { supabase, actor }: WorkflowContext,
  input: ApproveCloseoutInput,
) {
  const { data, error } = await supabase
    .from("shift_closeouts")
    .select("id, organization_id, location_id, status, approved_at")
    .eq("id", input.closeoutId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The closeout could not be loaded.");
  const closeout = assertFound(data, "The closeout was not found.");
  requireLocationManagement(actor, closeout.organization_id, closeout.location_id);

  const requestedStatus = input.approved ? "approved" : "rejected";
  const resolution = resolveTerminalReview(closeout.status, requestedStatus);
  if (resolution.alreadyApplied) {
    return {
      id: closeout.id as string,
      status: requestedStatus,
      approvedAt: closeout.approved_at as string | null,
      alreadyApplied: true,
    };
  }
  if (closeout.status !== "pending" && closeout.status !== "in_review") {
    throw new WorkflowError("conflict", "This closeout is not awaiting review.");
  }

  const { data: decided, error: decisionError } = await supabase.rpc(
    "approve_closeout",
    {
      p_closeout_id: closeout.id,
      p_approved: input.approved,
      p_note: input.note ?? null,
    },
  );
  if (decisionError) throwDatabaseError(decisionError, "The closeout decision could not be saved.");
  const result = assertFound(decided, "The reviewed closeout was not returned.");

  return {
    id: result.id as string,
    status: result.status as string,
    approvedAt: result.approved_at as string | null,
    alreadyApplied: false,
  };
}

export async function createCloseoutUploadUrl(
  { supabase, actor }: WorkflowContext,
  input: CloseoutUploadUrlInput,
) {
  const validation = validatePrivateFile("closeouts", input.mimeType, input.sizeBytes);
  assertCondition(validation.ok, "validation", validation.message ?? "Invalid file.");
  const { data, error } = await supabase
    .from("shift_closeouts")
    .select("id, organization_id, location_id, status")
    .eq("id", input.closeoutId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The closeout could not be loaded.");
  const closeout = assertFound(data, "The closeout was not found.");
  requireLocationManagement(actor, closeout.organization_id, closeout.location_id);
  assertCondition(
    !["approved", "rejected"].includes(closeout.status),
    "conflict",
    "Reviewed closeout evidence is locked.",
  );
  const objectPath = buildPrivateObjectPath({
    organizationId: closeout.organization_id,
    locationId: closeout.location_id,
    resourceKind: "closeouts",
    resourceId: closeout.id,
    uploadId: input.uploadId,
    fileName: input.fileName,
  });
  const { data: upload, error: uploadError } = await supabase.storage
    .from("closeouts")
    .createSignedUploadUrl(objectPath, { upsert: false });
  if (uploadError) {
    throwDatabaseError(uploadError, "A private closeout upload URL could not be created.");
  }
  const signed = assertFound(upload, "The private upload URL was not returned.");
  assertCondition(
    signed.path === objectPath,
    "database",
    "The storage service returned an unexpected object path.",
  );
  return {
    bucket: "closeouts" as const,
    objectPath,
    token: signed.token,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
  };
}

export async function finalizeCloseoutUpload(
  { supabase, actor }: WorkflowContext,
  input: FinalizeCloseoutUploadInput,
) {
  const validation = validatePrivateFile("closeouts", input.mimeType, input.sizeBytes);
  assertCondition(validation.ok, "validation", validation.message ?? "Invalid file.");
  const { data, error } = await supabase
    .from("shift_closeouts")
    .select("id, organization_id, location_id, status")
    .eq("id", input.closeoutId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The closeout could not be loaded.");
  const closeout = assertFound(data, "The closeout was not found.");
  requireLocationManagement(actor, closeout.organization_id, closeout.location_id);
  assertCondition(
    !["approved", "rejected"].includes(closeout.status),
    "conflict",
    "Reviewed closeout evidence is locked.",
  );
  const parsed = parsePrivateObjectPath(input.objectPath);
  assertCondition(
    parsed?.organizationId === closeout.organization_id &&
      parsed.locationId === closeout.location_id &&
      parsed.segments[2] === "closeouts" &&
      parsed.segments[3] === closeout.id,
    "forbidden",
    "The uploaded object is outside this closeout's private scope.",
  );
  const { data: existing, error: existingError } = await supabase
    .from("closeout_attachments")
    .select("id, closeout_id, mime_type")
    .eq("organization_id", closeout.organization_id)
    .eq("storage_path", input.objectPath)
    .maybeSingle();
  if (existingError) {
    throwDatabaseError(existingError, "The closeout attachment could not be checked.");
  }
  if (existing) {
    assertCondition(
      existing.closeout_id === closeout.id && existing.mime_type === input.mimeType,
      "conflict",
      "This private object is already bound to different closeout evidence.",
    );
    return { id: existing.id as string, alreadyApplied: true };
  }
  const { data: uploaded, error: downloadError } = await supabase.storage
    .from("closeouts")
    .download(input.objectPath);
  if (downloadError) {
    throwDatabaseError(downloadError, "The private closeout upload could not be verified.");
  }
  const blob = assertFound(uploaded, "Upload the private file before finalizing it.");
  assertCondition(
    blob.size === input.sizeBytes,
    "conflict",
    "The uploaded file size does not match the pending attachment.",
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  assertCondition(
    hasExpectedFileSignature(bytes, input.mimeType),
    "validation",
    "The private file contents do not match the selected document type.",
  );
  const { data: inserted, error: insertError } = await supabase
    .from("closeout_attachments")
    .insert({
      organization_id: closeout.organization_id,
      closeout_id: closeout.id,
      storage_path: input.objectPath,
      file_name: normalizePrivateFileName(input.fileName),
      mime_type: input.mimeType,
      uploaded_by: actor.userId,
    })
    .select("id")
    .single();
  if (insertError) {
    throwDatabaseError(insertError, "The closeout attachment could not be finalized.");
  }
  return { id: inserted.id as string, alreadyApplied: false };
}
