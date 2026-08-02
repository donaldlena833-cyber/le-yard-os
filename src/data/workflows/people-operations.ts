import "server-only";

import {
  assertCondition,
  assertFound,
  throwDatabaseError,
} from "../errors";
import type { WorkflowContext } from "../execute";
import type {
  CancelTimeOffInput,
  DecideTimeOffInput,
  DeleteAvailabilityInput,
  EmployeeDocumentUploadInput,
  FinalizeEmployeeDocumentInput,
  SaveAvailabilityInput,
  SaveCertificationInput,
  SaveEmergencyContactInput,
  SaveTimeOffInput,
  UpdateEmployeeDocumentInput,
} from "../people-operations-schemas";
import { requireAccessibleLocation, requireManagedLocation } from "../resources";
import { zonedLocalToIso } from "../read-models/local-time";
import {
  buildPrivateObjectPath,
  parsePrivateObjectPath,
  validatePrivateFile,
} from "@/lib/storage/private-files";
import { hasExpectedFileSignature } from "@/lib/storage/file-integrity";
import { createAdminClient } from "@/lib/supabase/admin";

function nullable(value: string | null | undefined) {
  return value?.trim() || null;
}

async function requireEmployeeAtManagedLocation(
  context: WorkflowContext,
  employeeId: string,
  locationId: string,
) {
  const location = await requireManagedLocation(
    context.supabase,
    context.actor,
    locationId,
  );
  const { data: employee, error: employeeError } = await context.supabase
    .from("employees")
    .select("id, organization_id, user_id, home_location_id, employment_status")
    .eq("id", employeeId)
    .maybeSingle();
  if (employeeError) {
    throwDatabaseError(employeeError, "The employee could not be verified.");
  }
  const target = assertFound(employee, "The employee was not found.");
  assertCondition(
    target.organization_id === location.organizationId &&
      target.employment_status !== "terminated",
    "forbidden",
    "The employee is outside this managed location scope.",
  );
  if (target.home_location_id === location.id) return { location, employee: target };

  const [{ data: assignment, error: assignmentError }, membershipResult] =
    await Promise.all([
      context.supabase
        .from("employee_job_roles")
        .select("id")
        .eq("organization_id", location.organizationId)
        .eq("employee_id", target.id)
        .eq("location_id", location.id)
        .limit(1)
        .maybeSingle(),
      target.user_id
        ? context.supabase
            .from("location_memberships")
            .select("id")
            .eq("organization_id", location.organizationId)
            .eq("user_id", target.user_id)
            .eq("location_id", location.id)
            .limit(1)
            .maybeSingle()
        : Promise.resolve({ data: null, error: null }),
    ]);
  if (assignmentError || membershipResult.error) {
    throwDatabaseError(
      assignmentError ?? membershipResult.error,
      "The employee location assignment could not be verified.",
    );
  }
  assertCondition(
    Boolean(assignment || membershipResult.data),
    "forbidden",
    "The employee has no relationship with this managed location.",
  );
  return { location, employee: target };
}

export async function saveAvailability(
  context: WorkflowContext,
  input: SaveAvailabilityInput,
) {
  const { data, error } = await context.supabase.rpc("save_availability_rule", {
    p_request_id: input.requestId,
    p_employee_id: input.employeeId,
    p_rule_id: input.ruleId ?? null,
    p_location_id: input.locationId ?? null,
    p_weekday: input.weekday,
    p_available_from: input.availableFrom ?? null,
    p_available_until: input.availableUntil ?? null,
    p_is_available: input.isAvailable,
    p_effective_from: input.effectiveFrom,
    p_effective_to: input.effectiveTo ?? null,
    p_notes: nullable(input.notes),
  });
  if (error) throwDatabaseError(error, "The availability rule could not be saved.");
  const rule = assertFound(data, "The saved availability rule was not returned.");
  return { id: rule.id, updatedAt: rule.updated_at };
}

export async function deleteAvailability(
  context: WorkflowContext,
  input: DeleteAvailabilityInput,
) {
  const { data, error } = await context.supabase.rpc("delete_availability_rule", {
    p_request_id: input.requestId,
    p_rule_id: input.ruleId,
  });
  if (error) throwDatabaseError(error, "The availability rule could not be deleted.");
  return { id: assertFound(data, "The deleted availability rule was not returned.") };
}

export async function saveTimeOff(
  context: WorkflowContext,
  input: SaveTimeOffInput,
) {
  const location = await requireAccessibleLocation(
    context.supabase,
    context.actor,
    input.locationId,
  );
  const { data: locationRow, error: locationError } = await context.supabase
    .from("locations")
    .select("timezone")
    .eq("id", location.id)
    .single();
  if (locationError) {
    throwDatabaseError(locationError, "The restaurant time zone could not be loaded.");
  }
  const [startDate, startTime] = input.startsAtLocal.split("T");
  const [endDate, endTime] = input.endsAtLocal.split("T");
  const startsAt = zonedLocalToIso(startDate, startTime, locationRow.timezone);
  const endsAt = zonedLocalToIso(endDate, endTime, locationRow.timezone);
  assertCondition(
    startsAt && endsAt && endsAt > startsAt,
    "validation",
    "The selected restaurant-local time range is invalid or does not exist.",
  );

  const { data, error } = await context.supabase.rpc("save_time_off_request", {
    p_request_id: input.requestId,
    p_employee_id: input.employeeId,
    p_time_off_id: input.timeOffId ?? null,
    p_location_id: input.locationId,
    p_starts_at: startsAt,
    p_ends_at: endsAt,
    p_reason: nullable(input.reason),
  });
  if (error) throwDatabaseError(error, "The time-off request could not be saved.");
  const request = assertFound(data, "The saved time-off request was not returned.");
  return { id: request.id, status: request.status, updatedAt: request.updated_at };
}

export async function cancelTimeOff(
  context: WorkflowContext,
  input: CancelTimeOffInput,
) {
  const { data, error } = await context.supabase.rpc("cancel_time_off_request", {
    p_request_id: input.requestId,
    p_time_off_id: input.timeOffId,
  });
  if (error) throwDatabaseError(error, "The time-off request could not be cancelled.");
  const request = assertFound(data, "The cancelled time-off request was not returned.");
  return { id: request.id, status: request.status };
}

export async function decideTimeOff(
  context: WorkflowContext,
  input: DecideTimeOffInput,
) {
  const { data, error } = await context.supabase.rpc("decide_time_off_request", {
    p_request_id: input.requestId,
    p_time_off_id: input.timeOffId,
    p_approve: input.approve,
    p_decision_note: nullable(input.decisionNote),
  });
  if (error) throwDatabaseError(error, "The time-off decision could not be recorded.");
  const request = assertFound(data, "The decided time-off request was not returned.");
  return {
    id: request.id,
    status: request.status,
    decidedAt: request.decided_at,
  };
}

export async function saveCertification(
  context: WorkflowContext,
  input: SaveCertificationInput,
) {
  const { data, error } = await context.supabase.rpc(
    "save_employee_certification",
    {
      p_request_id: input.requestId,
      p_employee_id: input.employeeId,
      p_certification_id: input.certificationId ?? null,
      p_certification_type: input.certificationType,
      p_issuer: nullable(input.issuer),
      p_credential_number: nullable(input.credentialNumber),
      p_issued_on: input.issuedOn ?? null,
      p_expires_on: input.expiresOn ?? null,
      p_verified: input.verified,
    },
  );
  if (error) throwDatabaseError(error, "The certification could not be saved.");
  const certification = assertFound(data, "The saved certification was not returned.");
  return {
    id: certification.id,
    verifiedAt: certification.verified_at,
    updatedAt: certification.updated_at,
  };
}

export async function saveEmergencyContact(
  context: WorkflowContext,
  input: SaveEmergencyContactInput,
) {
  const { data, error } = await context.supabase.rpc(
    "save_employee_emergency_contact",
    {
      p_request_id: input.requestId,
      p_employee_id: input.employeeId,
      p_contact_id: input.contactId ?? null,
      p_name: input.name,
      p_relationship: nullable(input.relationship),
      p_phone: input.phone,
      p_email: nullable(input.email),
      p_is_primary: input.isPrimary,
    },
  );
  if (error) throwDatabaseError(error, "The emergency contact could not be saved.");
  const contact = assertFound(data, "The saved emergency contact was not returned.");
  return { id: contact.id, isPrimary: contact.is_primary, updatedAt: contact.updated_at };
}

export async function createEmployeeDocumentUploadUrl(
  context: WorkflowContext,
  input: EmployeeDocumentUploadInput,
) {
  const scope = await requireEmployeeAtManagedLocation(
    context,
    input.employeeId,
    input.locationId,
  );
  const validation = validatePrivateFile(
    "employee-documents",
    input.mimeType,
    input.sizeBytes,
  );
  assertCondition(validation.ok, "validation", validation.message ?? "Invalid file.");
  const objectPath = buildPrivateObjectPath({
    organizationId: scope.location.organizationId,
    locationId: scope.location.id,
    resourceKind: "employee-documents",
    resourceId: scope.employee.id,
    uploadId: input.uploadId,
    fileName: input.fileName,
  });
  const { data, error } = await context.supabase.storage
    .from("employee-documents")
    .createSignedUploadUrl(objectPath, { upsert: false });
  if (error) {
    throwDatabaseError(error, "A private employee document upload could not be prepared.");
  }
  const upload = assertFound(data, "The private upload URL was not returned.");
  assertCondition(
    upload.path === objectPath,
    "database",
    "The storage service returned an unexpected object path.",
  );
  return {
    requestId: input.uploadId,
    bucket: "employee-documents" as const,
    objectPath,
    signedUrl: upload.signedUrl,
    token: upload.token,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    upsert: false as const,
  };
}

export async function finalizeEmployeeDocument(
  context: WorkflowContext,
  input: FinalizeEmployeeDocumentInput,
) {
  const scope = await requireEmployeeAtManagedLocation(
    context,
    input.employeeId,
    input.locationId,
  );
  const validation = validatePrivateFile(
    "employee-documents",
    input.mimeType,
    input.sizeBytes,
  );
  assertCondition(validation.ok, "validation", validation.message ?? "Invalid file.");
  const parsed = parsePrivateObjectPath(input.objectPath);
  assertCondition(
    parsed?.organizationId === scope.location.organizationId &&
      parsed.locationId === scope.location.id &&
      parsed.segments[2] === "employee-documents" &&
      parsed.segments[3] === scope.employee.id &&
      parsed.segments[4]?.startsWith(`${input.requestId}-`),
    "forbidden",
    "The uploaded object is outside this employee's private scope.",
  );

  const { data: uploadedBlob, error: objectError } = await context.supabase.storage
    .from("employee-documents")
    .download(input.objectPath);
  if (objectError) {
    throwDatabaseError(objectError, "The private employee document could not be verified.");
  }
  const uploaded = assertFound(uploadedBlob, "Upload the private file before finalizing it.");
  assertCondition(
    uploaded.size === input.sizeBytes,
    "conflict",
    "The uploaded file size does not match the pending document.",
  );
  const bytes = new Uint8Array(await uploaded.arrayBuffer());
  assertCondition(
    hasExpectedFileSignature(bytes, input.mimeType),
    "validation",
    "The private file contents do not match the selected document type.",
  );

  const admin = createAdminClient();
  const { data, error } = await admin.rpc("service_finalize_employee_document", {
    p_request_id: input.requestId,
    p_actor_id: context.actor.userId,
    p_actor_aal: context.actor.aal,
    p_employee_id: input.employeeId,
    p_location_id: input.locationId,
    p_storage_path: input.objectPath,
    p_document_type: input.documentType,
    p_title: input.title,
    p_mime_type: input.mimeType,
    p_size_bytes: input.sizeBytes,
    p_is_employee_visible: input.employeeVisible,
  });
  if (error) throwDatabaseError(error, "The employee document could not be finalized.");
  const document = assertFound(data, "The finalized employee document was not returned.");
  return { id: document.id, objectPath: document.storage_path };
}

export async function updateEmployeeDocument(
  context: WorkflowContext,
  input: UpdateEmployeeDocumentInput,
) {
  const { data, error } = await context.supabase.rpc(
    "update_employee_document_metadata",
    {
      p_request_id: input.requestId,
      p_document_id: input.documentId,
      p_document_type: input.documentType,
      p_title: input.title,
      p_is_employee_visible: input.employeeVisible,
    },
  );
  if (error) throwDatabaseError(error, "The employee document metadata could not be saved.");
  const document = assertFound(data, "The updated employee document was not returned.");
  return {
    id: document.id,
    title: document.title,
    employeeVisible: document.is_employee_visible,
  };
}
