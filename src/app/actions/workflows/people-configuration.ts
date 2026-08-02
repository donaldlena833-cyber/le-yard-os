"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  createEmployeeJobAssignmentInputSchema,
  createJobRoleDefinitionInputSchema,
  deactivateJobRoleDefinitionInputSchema,
  endEmployeeJobAssignmentInputSchema,
  updateEmployeeJobAssignmentInputSchema,
  updateJobRoleDefinitionInputSchema,
} from "@/data/people-configuration-schemas";
import {
  createEmployeeJobAssignment,
  createJobRoleDefinition,
  deactivateJobRoleDefinition,
  endEmployeeJobAssignment,
  updateEmployeeJobAssignment,
  updateJobRoleDefinition,
} from "@/data/workflows/people-configuration";

async function runConfigurationAction<T extends { ok: boolean; persisted: boolean }>(
  action: Promise<T>,
) {
  const result = await action;
  if (result.ok && result.persisted) revalidatePath("/team");
  return result;
}

export async function createJobRoleDefinitionAction(input: unknown) {
  return runConfigurationAction(
    executeWorkflowAction({
      operation: "people.job_role.create",
      schema: createJobRoleDefinitionInputSchema,
      input,
      run: createJobRoleDefinition,
    }),
  );
}

export async function updateJobRoleDefinitionAction(input: unknown) {
  return runConfigurationAction(
    executeWorkflowAction({
      operation: "people.job_role.update",
      schema: updateJobRoleDefinitionInputSchema,
      input,
      run: updateJobRoleDefinition,
    }),
  );
}

export async function deactivateJobRoleDefinitionAction(input: unknown) {
  return runConfigurationAction(
    executeWorkflowAction({
      operation: "people.job_role.deactivate",
      schema: deactivateJobRoleDefinitionInputSchema,
      input,
      run: deactivateJobRoleDefinition,
    }),
  );
}

export async function createEmployeeJobAssignmentAction(input: unknown) {
  return runConfigurationAction(
    executeWorkflowAction({
      operation: "people.job_assignment.create",
      schema: createEmployeeJobAssignmentInputSchema,
      input,
      run: createEmployeeJobAssignment,
    }),
  );
}

export async function updateEmployeeJobAssignmentAction(input: unknown) {
  return runConfigurationAction(
    executeWorkflowAction({
      operation: "people.job_assignment.update",
      schema: updateEmployeeJobAssignmentInputSchema,
      input,
      run: updateEmployeeJobAssignment,
    }),
  );
}

export async function endEmployeeJobAssignmentAction(input: unknown) {
  return runConfigurationAction(
    executeWorkflowAction({
      operation: "people.job_assignment.end",
      schema: endEmployeeJobAssignmentInputSchema,
      input,
      run: endEmployeeJobAssignment,
    }),
  );
}
