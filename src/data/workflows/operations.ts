import "server-only";

import {
  assertCondition,
  assertFound,
  throwDatabaseError,
} from "../errors";
import type { WorkflowContext } from "../execute";
import type {
  AcknowledgeSopInput,
  ChecklistEvidenceUploadInput,
  CompleteChecklistRunInput,
  CreateIncidentInput,
  CreateMaintenanceRequestInput,
  CreateTaskInput,
  CreateChecklistTemplateVersionInput,
  CreateSopDraftInput,
  CreateSopVersionInput,
  PublishChecklistTemplateInput,
  PublishSopVersionInput,
  RecordChecklistResponseInput,
  SetIncidentStatusInput,
  SetMaintenanceStatusInput,
  StartChecklistRunInput,
  TransitionTaskInput,
  UpdateSopDraftInput,
} from "../operations-schemas";
import {
  requireLocationAccess,
  requireLocationManagement,
  requireOrganizationAccess,
  requireOrganizationOperations,
} from "../policy";
import {
  requireAccessibleLocation,
  requireActorEmployee,
  requireManagedLocation,
} from "../resources";
import type { ActorMembership } from "../types";
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

function canManage(actor: WorkflowContext["actor"], membership: ActorMembership) {
  return (
    membership.role === "admin" ||
    membership.role === "manager" ||
    (membership.role === "owner" && actor.aal === "aal2")
  );
}

async function requireAssignedOperator(
  context: WorkflowContext,
  organizationId: string,
  locationId: string | null,
  assignedEmployeeId: string | null,
) {
  const membership = locationId
    ? requireLocationAccess(context.actor, organizationId, locationId)
    : requireOrganizationAccess(context.actor, organizationId);

  if (canManage(context.actor, membership)) {
    if (locationId) {
      requireLocationManagement(context.actor, organizationId, locationId);
    } else {
      requireOrganizationOperations(context.actor, organizationId);
    }
    return;
  }

  const employee = await requireActorEmployee(
    context.supabase,
    context.actor,
    organizationId,
  );
  assertCondition(
    assignedEmployeeId === employee.id,
    "forbidden",
    "Only the assigned employee or location management may perform this action.",
  );
}

async function requireChecklistRunOperator(
  context: WorkflowContext,
  runId: string,
) {
  const { data, error } = await context.supabase
    .from("checklist_runs")
    .select("id, organization_id, location_id, template_id, assigned_employee_id, status")
    .eq("id", runId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The checklist run could not be verified.");
  const run = assertFound(data, "The checklist run was not found.");
  await requireAssignedOperator(
    context,
    run.organization_id,
    run.location_id,
    run.assigned_employee_id,
  );
  return run;
}

export async function createTask(context: WorkflowContext, input: CreateTaskInput) {
  await requireManagedLocation(context.supabase, context.actor, input.locationId);

  const { data, error } = await context.supabase.rpc("create_task", {
    p_request_id: input.requestId,
    p_location_id: input.locationId,
    p_title: input.title,
    p_description: nullable(input.description),
    p_priority: input.priority,
    p_assigned_employee_id: input.assignedEmployeeId ?? null,
    p_due_at: input.dueAt ?? null,
  });
  if (error) throwDatabaseError(error, "The task could not be created.");
  const task = assertFound(data, "The created task was not returned.");
  return { id: task.id, status: task.status, createdAt: task.created_at };
}

export async function transitionTask(
  context: WorkflowContext,
  input: TransitionTaskInput,
) {
  const { data: existing, error: existingError } = await context.supabase
    .from("tasks")
    .select("id, organization_id, location_id, assigned_employee_id")
    .eq("id", input.taskId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError, "The task could not be verified.");
  const taskRecord = assertFound(existing, "The task was not found.");
  await requireAssignedOperator(
    context,
    taskRecord.organization_id,
    taskRecord.location_id,
    taskRecord.assigned_employee_id,
  );

  const { data, error } = await context.supabase.rpc("transition_task", {
    p_request_id: input.requestId,
    p_task_id: input.taskId,
    p_status: input.status,
    p_note: nullable(input.note),
  });
  if (error) throwDatabaseError(error, "The task status could not be changed.");
  const task = assertFound(data, "The updated task was not returned.");
  return {
    id: task.id,
    status: task.status,
    completedAt: task.completed_at,
  };
}

export async function startChecklistRun(
  context: WorkflowContext,
  input: StartChecklistRunInput,
) {
  const location = await requireAccessibleLocation(
    context.supabase,
    context.actor,
    input.locationId,
  );
  const membership = requireLocationAccess(
    context.actor,
    location.organizationId,
    location.id,
  );
  if (canManage(context.actor, membership)) {
    requireLocationManagement(context.actor, location.organizationId, location.id);
  } else {
    const employee = await requireActorEmployee(
      context.supabase,
      context.actor,
      location.organizationId,
    );
    assertCondition(
      !input.assignedEmployeeId || input.assignedEmployeeId === employee.id,
      "forbidden",
      "Staff may only start a checklist for themselves.",
    );
  }

  const { data: template, error: templateError } = await context.supabase
    .from("checklist_templates")
    .select("id, organization_id, location_id, is_active")
    .eq("id", input.templateId)
    .maybeSingle();
  if (templateError) {
    throwDatabaseError(templateError, "The checklist template could not be verified.");
  }
  const source = assertFound(template, "The checklist template was not found.");
  assertCondition(
    source.organization_id === location.organizationId &&
      (!source.location_id || source.location_id === location.id) &&
      source.is_active,
    "conflict",
    "This checklist template is not active for the selected location.",
  );

  const { data, error } = await context.supabase.rpc("start_checklist_run", {
    p_request_id: input.requestId,
    p_location_id: input.locationId,
    p_template_id: input.templateId,
    p_business_date: input.businessDate,
    p_assigned_employee_id: input.assignedEmployeeId ?? null,
  });
  if (error) throwDatabaseError(error, "The checklist run could not be started.");
  const run = assertFound(data, "The started checklist run was not returned.");
  return { id: run.id, status: run.status, startedAt: run.started_at };
}

export async function recordChecklistResponse(
  context: WorkflowContext,
  input: RecordChecklistResponseInput,
) {
  const run = await requireChecklistRunOperator(context, input.runId);
  const { data: item, error: itemError } = await context.supabase
    .from("checklist_template_items")
    .select("id, organization_id, template_id, response_type")
    .eq("id", input.templateItemId)
    .maybeSingle();
  if (itemError) throwDatabaseError(itemError, "The checklist item could not be verified.");
  const templateItem = assertFound(item, "The checklist item was not found.");
  assertCondition(
    templateItem.organization_id === run.organization_id &&
      templateItem.template_id === run.template_id,
    "conflict",
    "This checklist item does not belong to the selected run.",
  );

  if (templateItem.response_type === "photo") {
    assertCondition(
      Boolean(input.storagePath),
      "validation",
      "Photo checklist items require private evidence.",
    );
  }
  if (input.storagePath) {
    assertCondition(
      templateItem.response_type === "photo",
      "validation",
      "Private evidence is only accepted for photo checklist items.",
    );
    const response = input.response;
    assertCondition(
      Boolean(response) && !Array.isArray(response) && typeof response === "object",
      "validation",
      "Photo evidence metadata is required.",
    );
    const metadata = response as Record<string, unknown>;
    const mimeType = typeof metadata.mime_type === "string" ? metadata.mime_type : "";
    const sizeBytes = typeof metadata.size_bytes === "number" ? metadata.size_bytes : 0;
    const validation = validatePrivateFile("checklists", mimeType, sizeBytes);
    assertCondition(validation.ok, "validation", validation.message ?? "Invalid evidence file.");
    const parsed = parsePrivateObjectPath(input.storagePath);
    assertCondition(
      parsed?.organizationId === run.organization_id &&
        parsed.locationId === run.location_id &&
        parsed.segments[2] === "checklists" &&
        parsed.segments[3] === run.id,
      "forbidden",
      "The checklist evidence is outside this run's private scope.",
    );
    const { data: blob, error: blobError } = await context.supabase.storage
      .from("checklists")
      .download(input.storagePath);
    if (blobError) throwDatabaseError(blobError, "The checklist evidence could not be verified.");
    const uploaded = assertFound(blob, "Upload the checklist evidence before recording it.");
    assertCondition(
      uploaded.size === sizeBytes,
      "conflict",
      "The uploaded checklist evidence size does not match its metadata.",
    );
    const bytes = new Uint8Array(await uploaded.arrayBuffer());
    assertCondition(
      hasExpectedFileSignature(bytes, mimeType),
      "validation",
      "The checklist evidence contents do not match the selected image type.",
    );
    const { data, error } = await createAdminClient().rpc(
      "bind_verified_checklist_photo_response",
      {
      p_request_id: input.requestId,
      p_actor_id: context.actor.userId,
      p_actor_aal: context.actor.aal,
      p_run_id: input.runId,
      p_template_item_id: input.templateItemId,
      p_response: input.response,
      p_storage_path: input.storagePath,
      p_notes: nullable(input.notes),
      p_mime_type: mimeType,
      p_size_bytes: sizeBytes,
      },
    );
    if (error) throwDatabaseError(error, "The verified checklist photo could not be bound.");
    const verifiedResponse = assertFound(
      data,
      "The verified checklist photo response was not returned.",
    );
    return { id: verifiedResponse.id, respondedAt: verifiedResponse.responded_at };
  }

  const { data, error } = await context.supabase.rpc("record_checklist_response", {
    p_request_id: input.requestId,
    p_run_id: input.runId,
    p_template_item_id: input.templateItemId,
    p_response: input.response,
    p_storage_path: input.storagePath ?? null,
    p_notes: nullable(input.notes),
  });
  if (error) throwDatabaseError(error, "The checklist response could not be recorded.");
  const response = assertFound(data, "The checklist response was not returned.");
  return { id: response.id, respondedAt: response.responded_at };
}

export async function createChecklistEvidenceUploadUrl(
  context: WorkflowContext,
  input: ChecklistEvidenceUploadInput,
) {
  const run = await requireChecklistRunOperator(context, input.runId);
  assertCondition(run.status === "in_progress", "conflict", "Only an in-progress checklist accepts evidence.");
  const { data: item, error: itemError } = await context.supabase
    .from("checklist_template_items")
    .select("id, organization_id, template_id, response_type")
    .eq("id", input.templateItemId)
    .maybeSingle();
  if (itemError) throwDatabaseError(itemError, "The checklist item could not be verified.");
  const templateItem = assertFound(item, "The checklist item was not found.");
  assertCondition(
    templateItem.organization_id === run.organization_id &&
      templateItem.template_id === run.template_id &&
      templateItem.response_type === "photo",
    "conflict",
    "This is not a photo item in the selected checklist run.",
  );
  const validation = validatePrivateFile("checklists", input.mimeType, input.sizeBytes);
  assertCondition(validation.ok, "validation", validation.message ?? "Invalid evidence file.");
  const objectPath = buildPrivateObjectPath({
    organizationId: run.organization_id,
    locationId: run.location_id,
    resourceKind: "checklists",
    resourceId: run.id,
    uploadId: input.uploadId,
    fileName: input.fileName,
  });
  const { data, error } = await context.supabase.storage
    .from("checklists")
    .createSignedUploadUrl(objectPath, { upsert: false });
  if (error) throwDatabaseError(error, "A private checklist upload URL could not be created.");
  const upload = assertFound(data, "The private checklist upload URL was not returned.");
  assertCondition(upload.path === objectPath, "database", "The storage service returned an unexpected path.");
  return {
    bucket: "checklists" as const,
    objectPath,
    token: upload.token,
    mimeType: input.mimeType,
    sizeBytes: input.sizeBytes,
    upsert: false as const,
  };
}

export async function createChecklistTemplateVersion(
  context: WorkflowContext,
  input: CreateChecklistTemplateVersionInput,
) {
  await requireManagedLocation(context.supabase, context.actor, input.locationId);
  const { data, error } = await context.supabase.rpc("create_checklist_template_version", {
    p_request_id: input.requestId,
    p_location_id: input.locationId,
    p_name: input.name,
    p_checklist_type: input.checklistType,
    p_items: input.items.map((item) => ({
      label: item.label,
      instructions: nullable(item.instructions),
      response_type: item.responseType,
      required: item.required,
      validation: item.validation,
    })),
  });
  if (error) throwDatabaseError(error, "The checklist template version could not be created.");
  const template = assertFound(data, "The checklist template version was not returned.");
  return { id: template.id, version: template.version, active: template.is_active };
}

export async function publishChecklistTemplate(
  context: WorkflowContext,
  input: PublishChecklistTemplateInput,
) {
  const { data: existing, error: existingError } = await context.supabase
    .from("checklist_templates")
    .select("id, organization_id, location_id")
    .eq("id", input.templateId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError, "The checklist template could not be verified.");
  const template = assertFound(existing, "The checklist template was not found.");
  assertCondition(Boolean(template.location_id), "conflict", "Only location checklist versions can be published here.");
  requireLocationManagement(context.actor, template.organization_id, template.location_id as string);
  const { data, error } = await context.supabase.rpc("publish_checklist_template", {
    p_request_id: input.requestId,
    p_template_id: input.templateId,
  });
  if (error) throwDatabaseError(error, "The checklist template could not be published.");
  const result = assertFound(data, "The published checklist template was not returned.");
  return { id: result.id, version: result.version, active: result.is_active };
}

export async function completeChecklistRun(
  context: WorkflowContext,
  input: CompleteChecklistRunInput,
) {
  await requireChecklistRunOperator(context, input.runId);
  const { data, error } = await context.supabase.rpc("complete_checklist_run", {
    p_request_id: input.requestId,
    p_run_id: input.runId,
    p_note: nullable(input.note),
  });
  if (error) throwDatabaseError(error, "The checklist run could not be completed.");
  const run = assertFound(data, "The completed checklist run was not returned.");
  return { id: run.id, status: run.status, completedAt: run.completed_at };
}

export async function acknowledgeSop(
  context: WorkflowContext,
  input: AcknowledgeSopInput,
) {
  const { data: version, error: versionError } = await context.supabase
    .from("sop_versions")
    .select("id, organization_id, sop_document_id, version, published_at")
    .eq("id", input.sopVersionId)
    .maybeSingle();
  if (versionError) throwDatabaseError(versionError, "The SOP version could not be verified.");
  const sourceVersion = assertFound(version, "The SOP version was not found.");
  const { data: document, error: documentError } = await context.supabase
    .from("sop_documents")
    .select("id, organization_id, location_id, current_version, is_published")
    .eq("id", sourceVersion.sop_document_id)
    .maybeSingle();
  if (documentError) throwDatabaseError(documentError, "The SOP document could not be verified.");
  const sourceDocument = assertFound(document, "The SOP document was not found.");
  assertCondition(
    sourceDocument.organization_id === sourceVersion.organization_id &&
      sourceDocument.is_published &&
      sourceDocument.current_version === sourceVersion.version &&
      Boolean(sourceVersion.published_at),
    "conflict",
    "Only the current published SOP version can be acknowledged.",
  );
  if (sourceDocument.location_id) {
    requireLocationAccess(
      context.actor,
      sourceDocument.organization_id,
      sourceDocument.location_id,
    );
  } else {
    requireOrganizationAccess(context.actor, sourceDocument.organization_id);
  }
  await requireActorEmployee(
    context.supabase,
    context.actor,
    sourceDocument.organization_id,
  );

  const { data, error } = await context.supabase.rpc("acknowledge_sop", {
    p_request_id: input.requestId,
    p_sop_version_id: input.sopVersionId,
  });
  if (error) throwDatabaseError(error, "The SOP acknowledgement could not be recorded.");
  const acknowledgement = assertFound(data, "The SOP acknowledgement was not returned.");
  return { id: acknowledgement.id, acknowledgedAt: acknowledgement.acknowledged_at };
}

async function requireSopDocumentManagement(
  context: WorkflowContext,
  documentId: string,
) {
  const { data, error } = await context.supabase
    .from("sop_documents")
    .select("id, organization_id, location_id")
    .eq("id", documentId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The SOP document could not be verified.");
  const document = assertFound(data, "The SOP document was not found.");
  if (document.location_id) {
    requireLocationManagement(context.actor, document.organization_id, document.location_id);
  } else {
    requireOrganizationOperations(context.actor, document.organization_id);
  }
  return document;
}

export async function createSopDraft(
  context: WorkflowContext,
  input: CreateSopDraftInput,
) {
  await requireManagedLocation(context.supabase, context.actor, input.locationId);
  const { data, error } = await context.supabase.rpc("create_sop_draft", {
    p_request_id: input.requestId,
    p_location_id: input.locationId,
    p_title: input.title,
    p_category: nullable(input.category),
    p_requires_acknowledgement: input.requiresAcknowledgement,
    p_body: input.body,
    p_change_summary: nullable(input.changeSummary),
  });
  if (error) throwDatabaseError(error, "The SOP draft could not be created.");
  const version = assertFound(data, "The SOP draft was not returned.");
  return { id: version.id, documentId: version.sop_document_id, version: version.version };
}

export async function createSopVersion(
  context: WorkflowContext,
  input: CreateSopVersionInput,
) {
  await requireSopDocumentManagement(context, input.sopDocumentId);
  const { data, error } = await context.supabase.rpc("create_sop_version", {
    p_request_id: input.requestId,
    p_sop_document_id: input.sopDocumentId,
    p_body: input.body,
    p_change_summary: nullable(input.changeSummary),
  });
  if (error) throwDatabaseError(error, "The next SOP version could not be created.");
  const version = assertFound(data, "The SOP version draft was not returned.");
  return { id: version.id, documentId: version.sop_document_id, version: version.version };
}

async function requireSopVersionManagement(
  context: WorkflowContext,
  versionId: string,
) {
  const { data, error } = await context.supabase
    .from("sop_versions")
    .select("id, sop_document_id")
    .eq("id", versionId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The SOP version could not be verified.");
  const version = assertFound(data, "The SOP version was not found.");
  await requireSopDocumentManagement(context, version.sop_document_id);
  return version;
}

export async function updateSopDraft(
  context: WorkflowContext,
  input: UpdateSopDraftInput,
) {
  await requireSopVersionManagement(context, input.sopVersionId);
  const { data, error } = await context.supabase.rpc("update_sop_draft", {
    p_request_id: input.requestId,
    p_sop_version_id: input.sopVersionId,
    p_body: input.body,
    p_change_summary: nullable(input.changeSummary),
  });
  if (error) throwDatabaseError(error, "The SOP draft could not be updated.");
  const version = assertFound(data, "The updated SOP draft was not returned.");
  return { id: version.id, version: version.version };
}

export async function publishSopVersion(
  context: WorkflowContext,
  input: PublishSopVersionInput,
) {
  await requireSopVersionManagement(context, input.sopVersionId);
  const { data, error } = await context.supabase.rpc("publish_sop_version", {
    p_request_id: input.requestId,
    p_sop_version_id: input.sopVersionId,
  });
  if (error) throwDatabaseError(error, "The SOP version could not be published.");
  const version = assertFound(data, "The published SOP version was not returned.");
  return { id: version.id, version: version.version, publishedAt: version.published_at };
}

export async function createMaintenanceRequest(
  context: WorkflowContext,
  input: CreateMaintenanceRequestInput,
) {
  const location = await requireAccessibleLocation(
    context.supabase,
    context.actor,
    input.locationId,
  );
  if (input.assignedTo || input.vendorId || input.dueAt) {
    requireLocationManagement(context.actor, location.organizationId, location.id);
  }

  const { data, error } = await context.supabase.rpc("create_maintenance_request", {
    p_request_id: input.requestId,
    p_location_id: input.locationId,
    p_title: input.title,
    p_description: input.description,
    p_category: nullable(input.category),
    p_priority: input.priority,
    p_assigned_to: nullable(input.assignedTo),
    p_vendor_id: input.vendorId ?? null,
    p_due_at: input.dueAt ?? null,
  });
  if (error) throwDatabaseError(error, "The maintenance request could not be created.");
  const request = assertFound(data, "The maintenance request was not returned.");
  return { id: request.id, status: request.status, createdAt: request.created_at };
}

export async function setMaintenanceStatus(
  context: WorkflowContext,
  input: SetMaintenanceStatusInput,
) {
  const { data: existing, error: existingError } = await context.supabase
    .from("maintenance_requests")
    .select("id, organization_id, location_id")
    .eq("id", input.maintenanceRequestId)
    .maybeSingle();
  if (existingError) {
    throwDatabaseError(existingError, "The maintenance request could not be verified.");
  }
  const requestRecord = assertFound(existing, "The maintenance request was not found.");
  await requireManagedLocation(
    context.supabase,
    context.actor,
    requestRecord.location_id,
  );

  const { data, error } = await context.supabase.rpc("set_maintenance_status", {
    p_request_id: input.requestId,
    p_maintenance_id: input.maintenanceRequestId,
    p_status: input.status,
    p_assigned_to: nullable(input.assignedTo),
    p_vendor_id: input.vendorId ?? null,
    p_estimated_cost_cents: input.estimatedCostCents ?? null,
    p_actual_cost_cents: input.actualCostCents ?? null,
    p_due_at: input.dueAt ?? null,
    p_note: nullable(input.note),
  });
  if (error) throwDatabaseError(error, "The maintenance request could not be updated.");
  const request = assertFound(data, "The updated maintenance request was not returned.");
  return { id: request.id, status: request.status, resolvedAt: request.resolved_at };
}

export async function createIncident(
  context: WorkflowContext,
  input: CreateIncidentInput,
) {
  await requireAccessibleLocation(context.supabase, context.actor, input.locationId);

  const { data, error } = await context.supabase.rpc("create_incident", {
    p_request_id: input.requestId,
    p_location_id: input.locationId,
    p_incident_type: input.incidentType,
    p_severity: input.severity,
    p_description: input.description,
    p_occurred_at: input.occurredAt,
    p_involved_employee_ids: input.involvedEmployeeIds,
    p_guest_id: input.guestId ?? null,
  });
  if (error) throwDatabaseError(error, "The incident could not be recorded.");
  const incident = assertFound(data, "The incident record was not returned.");
  return { id: incident.id, status: incident.status, createdAt: incident.created_at };
}

export async function setIncidentStatus(
  context: WorkflowContext,
  input: SetIncidentStatusInput,
) {
  const { data: existing, error: existingError } = await context.supabase
    .from("incidents")
    .select("id, organization_id, location_id")
    .eq("id", input.incidentId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError, "The incident could not be verified.");
  const incidentRecord = assertFound(existing, "The incident was not found.");
  await requireManagedLocation(
    context.supabase,
    context.actor,
    incidentRecord.location_id,
  );

  const { data, error } = await context.supabase.rpc("set_incident_status", {
    p_request_id: input.requestId,
    p_incident_id: input.incidentId,
    p_status: input.status,
    p_follow_up: nullable(input.followUp),
  });
  if (error) throwDatabaseError(error, "The incident status could not be updated.");
  const incident = assertFound(data, "The updated incident was not returned.");
  return { id: incident.id, status: incident.status, resolvedAt: incident.resolved_at };
}
