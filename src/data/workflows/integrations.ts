import "server-only";

import type {
  FinalizeManualCsvImportInput,
  ManualCsvUploadUrlInput,
  RetryIntegrationSyncInput,
} from "../schemas";
import type { WorkflowContext } from "../execute";
import { assertCondition, assertFound, throwDatabaseError } from "../errors";
import { requireOrganizationOperations } from "../policy";
import { requireAccessibleLocation } from "../resources";
import { decodeAndValidateManualCsv } from "@/lib/integrations/csv-import";
import { sha256Hex } from "@/lib/storage/file-integrity";
import {
  buildPrivateObjectPath,
  normalizePrivateFileName,
} from "@/lib/storage/private-files";

function requireIntegrationAdministrator(
  context: WorkflowContext,
  organizationId: string,
) {
  const membership = requireOrganizationOperations(context.actor, organizationId);
  assertCondition(
    membership.role === "owner" || membership.role === "admin",
    "forbidden",
    "Only an Owner or Admin can manage integration imports.",
  );
  return membership;
}

function expectedImportPath({
  organizationId,
  input,
}: {
  organizationId: string;
  input: Pick<
    FinalizeManualCsvImportInput,
    "requestId" | "uploadId" | "locationId" | "fileName"
  >;
}) {
  return buildPrivateObjectPath({
    organizationId,
    locationId: input.locationId,
    resourceKind: "imports",
    resourceId: input.requestId,
    uploadId: input.uploadId,
    fileName: input.fileName,
  });
}

export async function createManualCsvUploadUrl(
  context: WorkflowContext,
  input: ManualCsvUploadUrlInput,
) {
  const location = await requireAccessibleLocation(
    context.supabase,
    context.actor,
    input.locationId,
  );
  requireIntegrationAdministrator(context, location.organizationId);
  const objectPath = expectedImportPath({ organizationId: location.organizationId, input });
  const { data, error } = await context.supabase.storage
    .from("imports")
    .createSignedUploadUrl(objectPath, { upsert: false });
  if (error) throwDatabaseError(error, "A private import upload URL could not be created.");
  const upload = assertFound(data, "The private import upload URL was not returned.");
  assertCondition(
    upload.path === objectPath,
    "database",
    "The storage service returned an unexpected object path.",
  );

  return {
    bucket: "imports" as const,
    requestId: input.requestId,
    uploadId: input.uploadId,
    objectPath,
    token: upload.token,
    mimeType: "text/csv" as const,
    sizeBytes: input.sizeBytes,
    upsert: false as const,
  };
}

export async function finalizeManualCsvImport(
  context: WorkflowContext,
  input: FinalizeManualCsvImportInput,
) {
  const location = await requireAccessibleLocation(
    context.supabase,
    context.actor,
    input.locationId,
  );
  requireIntegrationAdministrator(context, location.organizationId);
  const objectPath = expectedImportPath({ organizationId: location.organizationId, input });
  assertCondition(
    input.objectPath === objectPath,
    "forbidden",
    "The uploaded CSV is outside this import request's private scope.",
  );

  const { data: uploaded, error: downloadError } = await context.supabase.storage
    .from("imports")
    .download(objectPath);
  if (downloadError) {
    throwDatabaseError(downloadError, "The private CSV upload could not be verified.");
  }
  const blob = assertFound(uploaded, "Upload the private CSV before finalizing the import.");
  assertCondition(
    blob.size === input.sizeBytes,
    "conflict",
    "The uploaded CSV size does not match the signed request.",
  );
  const bytes = new Uint8Array(await blob.arrayBuffer());
  const validation = decodeAndValidateManualCsv({ bytes, importType: input.importType });
  assertCondition(
    validation.ok,
    "validation",
    validation.ok ? "The CSV is valid." : validation.message,
  );
  const contentHash = sha256Hex(bytes);
  const mapping = Object.fromEntries(validation.headers.map((header) => [header, header]));

  const { data, error } = await context.supabase.rpc("create_manual_csv_import", {
    p_request_id: input.requestId,
    p_location_id: input.locationId,
    p_import_type: input.importType,
    p_file_name: normalizePrivateFileName(input.fileName),
    p_storage_path: objectPath,
    p_content_sha256: contentHash,
    p_total_rows: validation.totalRows,
    p_headers: validation.headers,
    p_mapping: {
      columns: mapping,
      validation_version: "manual-csv-v1",
    },
  });
  if (error) throwDatabaseError(error, "The validated CSV could not be queued safely.");
  const row = assertFound(
    Array.isArray(data) ? data[0] : data,
    "The queued import job was not returned.",
  );

  return {
    id: row.id as string,
    status: row.status as string,
    totalRows: validation.totalRows,
    contentHash,
  };
}

export async function retryIntegrationSync(
  context: WorkflowContext,
  input: RetryIntegrationSyncInput,
) {
  const { data: jobData, error: jobError } = await context.supabase
    .from("integration_sync_jobs")
    .select("id, organization_id, status, attempts, max_attempts")
    .eq("id", input.syncJobId)
    .maybeSingle();
  if (jobError) throwDatabaseError(jobError, "The sync job could not be verified.");
  const job = assertFound(jobData, "The failed sync job was not found.");
  requireIntegrationAdministrator(context, job.organization_id);
  assertCondition(job.status === "failed", "conflict", "Only a failed sync job can be retried.");
  assertCondition(
    job.attempts < job.max_attempts,
    "conflict",
    "This sync job has reached its retry limit.",
  );

  const { data, error } = await context.supabase.rpc("retry_integration_sync_job", {
    p_request_id: input.requestId,
    p_sync_job_id: input.syncJobId,
  });
  if (error) throwDatabaseError(error, "The sync retry could not be queued safely.");
  const retry = assertFound(
    Array.isArray(data) ? data[0] : data,
    "The queued sync retry was not returned.",
  );
  return {
    id: retry.id as string,
    status: retry.status as string,
    attempts: retry.attempts as number,
    nextAttemptAt: (retry.next_attempt_at as string | null) ?? null,
  };
}
