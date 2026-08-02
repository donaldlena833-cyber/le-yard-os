"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  acknowledgeSopInputSchema,
  checklistEvidenceUploadInputSchema,
  completeChecklistRunInputSchema,
  createIncidentInputSchema,
  createMaintenanceRequestInputSchema,
  createTaskInputSchema,
  createChecklistTemplateVersionInputSchema,
  createSopDraftInputSchema,
  createSopVersionInputSchema,
  publishChecklistTemplateInputSchema,
  publishSopVersionInputSchema,
  recordChecklistResponseInputSchema,
  setIncidentStatusInputSchema,
  setMaintenanceStatusInputSchema,
  startChecklistRunInputSchema,
  transitionTaskInputSchema,
  updateSopDraftInputSchema,
} from "@/data/operations-schemas";
import {
  acknowledgeSop,
  createChecklistEvidenceUploadUrl,
  completeChecklistRun,
  createIncident,
  createMaintenanceRequest,
  createTask,
  createChecklistTemplateVersion,
  createSopDraft,
  createSopVersion,
  publishChecklistTemplate,
  publishSopVersion,
  recordChecklistResponse,
  setIncidentStatus,
  setMaintenanceStatus,
  startChecklistRun,
  transitionTask,
  updateSopDraft,
} from "@/data/workflows/operations";

async function runOperationsAction<
  T extends { ok: boolean; persisted: boolean },
>(action: Promise<T>) {
  const result = await action;
  if (result.ok && result.persisted) {
    revalidatePath("/tasks");
  }
  return result;
}

export async function createTaskAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "task.create",
      schema: createTaskInputSchema,
      input,
      run: createTask,
    }),
  );
}

export async function transitionTaskAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "task.transition",
      schema: transitionTaskInputSchema,
      input,
      run: transitionTask,
    }),
  );
}

export async function startChecklistRunAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "checklist.start",
      schema: startChecklistRunInputSchema,
      input,
      run: startChecklistRun,
    }),
  );
}

export async function recordChecklistResponseAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "checklist.respond",
      schema: recordChecklistResponseInputSchema,
      input,
      run: recordChecklistResponse,
    }),
  );
}

export async function createChecklistEvidenceUploadUrlAction(input: unknown) {
  return executeWorkflowAction({
    operation: "checklist.evidence.create_upload_url",
    schema: checklistEvidenceUploadInputSchema,
    input,
    persists: false,
    run: createChecklistEvidenceUploadUrl,
  });
}

export async function createChecklistTemplateVersionAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "checklist.template.version.create",
      schema: createChecklistTemplateVersionInputSchema,
      input,
      run: createChecklistTemplateVersion,
    }),
  );
}

export async function publishChecklistTemplateAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "checklist.template.publish",
      schema: publishChecklistTemplateInputSchema,
      input,
      run: publishChecklistTemplate,
    }),
  );
}

export async function completeChecklistRunAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "checklist.complete",
      schema: completeChecklistRunInputSchema,
      input,
      run: completeChecklistRun,
    }),
  );
}

export async function acknowledgeSopAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "sop.acknowledge",
      schema: acknowledgeSopInputSchema,
      input,
      run: acknowledgeSop,
    }),
  );
}

export async function createSopDraftAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "sop.draft.create",
      schema: createSopDraftInputSchema,
      input,
      run: createSopDraft,
    }),
  );
}

export async function createSopVersionAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "sop.version.create",
      schema: createSopVersionInputSchema,
      input,
      run: createSopVersion,
    }),
  );
}

export async function updateSopDraftAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "sop.draft.update",
      schema: updateSopDraftInputSchema,
      input,
      run: updateSopDraft,
    }),
  );
}

export async function publishSopVersionAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "sop.version.publish",
      schema: publishSopVersionInputSchema,
      input,
      run: publishSopVersion,
    }),
  );
}

export async function createMaintenanceRequestAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "maintenance.create",
      schema: createMaintenanceRequestInputSchema,
      input,
      run: createMaintenanceRequest,
    }),
  );
}

export async function setMaintenanceStatusAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "maintenance.transition",
      schema: setMaintenanceStatusInputSchema,
      input,
      run: setMaintenanceStatus,
    }),
  );
}

export async function createIncidentAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "incident.create",
      schema: createIncidentInputSchema,
      input,
      run: createIncident,
    }),
  );
}

export async function setIncidentStatusAction(input: unknown) {
  return runOperationsAction(
    executeWorkflowAction({
      operation: "incident.transition",
      schema: setIncidentStatusInputSchema,
      input,
      run: setIncidentStatus,
    }),
  );
}
