"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  cancelTimeOffInputSchema,
  decideTimeOffInputSchema,
  deleteAvailabilityInputSchema,
  employeeDocumentUploadInputSchema,
  finalizeEmployeeDocumentInputSchema,
  saveAvailabilityInputSchema,
  saveCertificationInputSchema,
  saveEmergencyContactInputSchema,
  saveTimeOffInputSchema,
  updateEmployeeDocumentInputSchema,
} from "@/data/people-operations-schemas";
import {
  cancelTimeOff,
  createEmployeeDocumentUploadUrl,
  decideTimeOff,
  deleteAvailability,
  finalizeEmployeeDocument,
  saveAvailability,
  saveCertification,
  saveEmergencyContact,
  saveTimeOff,
  updateEmployeeDocument,
} from "@/data/workflows/people-operations";

async function runPeopleAction<T extends { ok: boolean; persisted: boolean }>(
  action: Promise<T>,
) {
  const result = await action;
  if (result.ok && result.persisted) revalidatePath("/team");
  return result;
}

export async function saveAvailabilityAction(input: unknown) {
  return runPeopleAction(
    executeWorkflowAction({
      operation: "people.availability.save",
      schema: saveAvailabilityInputSchema,
      input,
      run: saveAvailability,
    }),
  );
}

export async function deleteAvailabilityAction(input: unknown) {
  return runPeopleAction(
    executeWorkflowAction({
      operation: "people.availability.delete",
      schema: deleteAvailabilityInputSchema,
      input,
      run: deleteAvailability,
    }),
  );
}

export async function saveTimeOffAction(input: unknown) {
  return runPeopleAction(
    executeWorkflowAction({
      operation: "people.time_off.save",
      schema: saveTimeOffInputSchema,
      input,
      run: saveTimeOff,
    }),
  );
}

export async function cancelTimeOffAction(input: unknown) {
  return runPeopleAction(
    executeWorkflowAction({
      operation: "people.time_off.cancel",
      schema: cancelTimeOffInputSchema,
      input,
      run: cancelTimeOff,
    }),
  );
}

export async function decideTimeOffAction(input: unknown) {
  return runPeopleAction(
    executeWorkflowAction({
      operation: "people.time_off.decide",
      schema: decideTimeOffInputSchema,
      input,
      run: decideTimeOff,
    }),
  );
}

export async function saveCertificationAction(input: unknown) {
  return runPeopleAction(
    executeWorkflowAction({
      operation: "people.certification.save",
      schema: saveCertificationInputSchema,
      input,
      run: saveCertification,
    }),
  );
}

export async function saveEmergencyContactAction(input: unknown) {
  return runPeopleAction(
    executeWorkflowAction({
      operation: "people.emergency_contact.save",
      schema: saveEmergencyContactInputSchema,
      input,
      run: saveEmergencyContact,
    }),
  );
}

export async function createEmployeeDocumentUploadUrlAction(input: unknown) {
  return executeWorkflowAction({
    operation: "people.employee_document.prepare",
    schema: employeeDocumentUploadInputSchema,
    input,
    persists: false,
    run: createEmployeeDocumentUploadUrl,
  });
}

export async function finalizeEmployeeDocumentAction(input: unknown) {
  return runPeopleAction(
    executeWorkflowAction({
      operation: "people.employee_document.finalize",
      schema: finalizeEmployeeDocumentInputSchema,
      input,
      run: finalizeEmployeeDocument,
    }),
  );
}

export async function updateEmployeeDocumentAction(input: unknown) {
  return runPeopleAction(
    executeWorkflowAction({
      operation: "people.employee_document.metadata",
      schema: updateEmployeeDocumentInputSchema,
      input,
      run: updateEmployeeDocument,
    }),
  );
}
