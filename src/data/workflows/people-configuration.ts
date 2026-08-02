import "server-only";

import { assertFound, throwDatabaseError } from "../errors";
import type { WorkflowContext } from "../execute";
import type {
  CreateEmployeeJobAssignmentInput,
  CreateJobRoleDefinitionInput,
  DeactivateJobRoleDefinitionInput,
  EndEmployeeJobAssignmentInput,
  UpdateEmployeeJobAssignmentInput,
  UpdateJobRoleDefinitionInput,
} from "../people-configuration-schemas";

interface JobRoleCommandRow {
  id: string;
  name: string;
  code: string;
  department: string | null;
  color: string | null;
  default_tip_points: number;
  is_tipped: boolean;
  is_active: boolean;
}

interface JobAssignmentCommandRow {
  id: string;
  employee_id: string;
  job_role_id: string;
  location_id: string;
  effective_from: string;
  effective_to: string | null;
  is_primary: boolean;
}

function publicRole(row: JobRoleCommandRow) {
  return {
    id: row.id,
    name: row.name,
    code: row.code,
    department: row.department,
    color: row.color,
    defaultTipPoints: row.default_tip_points,
    isTipped: row.is_tipped,
    active: row.is_active,
  };
}

function publicAssignment(row: JobAssignmentCommandRow) {
  return {
    id: row.id,
    employeeId: row.employee_id,
    jobRoleId: row.job_role_id,
    locationId: row.location_id,
    effectiveFrom: row.effective_from,
    effectiveTo: row.effective_to,
    isPrimary: row.is_primary,
  };
}

export async function createJobRoleDefinition(
  context: WorkflowContext,
  input: CreateJobRoleDefinitionInput,
) {
  const { data, error } = await context.supabase.rpc(
    "create_job_role_definition",
    {
      p_request_id: input.requestId,
      p_organization_id: input.organizationId,
      p_name: input.name,
      p_code: input.code,
      p_department: input.department,
      p_color: input.color,
      p_default_tip_points: input.defaultTipPoints,
      p_is_tipped: input.isTipped,
    },
  );
  if (error) throwDatabaseError(error, "The job role could not be created.");
  return publicRole(assertFound(data, "The created job role was not returned."));
}

export async function updateJobRoleDefinition(
  context: WorkflowContext,
  input: UpdateJobRoleDefinitionInput,
) {
  const { data, error } = await context.supabase.rpc(
    "update_job_role_definition",
    {
      p_request_id: input.requestId,
      p_job_role_id: input.jobRoleId,
      p_name: input.name,
      p_code: input.code,
      p_department: input.department,
      p_color: input.color,
      p_default_tip_points: input.defaultTipPoints,
      p_is_tipped: input.isTipped,
    },
  );
  if (error) throwDatabaseError(error, "The job role could not be updated.");
  return publicRole(assertFound(data, "The updated job role was not returned."));
}

export async function deactivateJobRoleDefinition(
  context: WorkflowContext,
  input: DeactivateJobRoleDefinitionInput,
) {
  const { data, error } = await context.supabase.rpc(
    "deactivate_job_role_definition",
    {
      p_request_id: input.requestId,
      p_job_role_id: input.jobRoleId,
    },
  );
  if (error) throwDatabaseError(error, "The job role could not be deactivated.");
  return publicRole(assertFound(data, "The deactivated job role was not returned."));
}

export async function createEmployeeJobAssignment(
  context: WorkflowContext,
  input: CreateEmployeeJobAssignmentInput,
) {
  const { data, error } = await context.supabase.rpc(
    "create_employee_job_assignment",
    {
      p_request_id: input.requestId,
      p_employee_id: input.employeeId,
      p_job_role_id: input.jobRoleId,
      p_location_id: input.locationId,
      p_hourly_rate_cents: input.hourlyRateCents,
      p_effective_from: input.effectiveFrom,
      p_effective_to: input.effectiveTo,
      p_is_primary: input.isPrimary,
    },
  );
  if (error) throwDatabaseError(error, "The employee job assignment could not be created.");
  return publicAssignment(
    assertFound(data, "The created employee job assignment was not returned."),
  );
}

export async function updateEmployeeJobAssignment(
  context: WorkflowContext,
  input: UpdateEmployeeJobAssignmentInput,
) {
  const { data, error } = await context.supabase.rpc(
    "update_employee_job_assignment",
    {
      p_request_id: input.requestId,
      p_assignment_id: input.assignmentId,
      p_job_role_id: input.jobRoleId,
      p_location_id: input.locationId,
      p_set_hourly_rate: input.setHourlyRate,
      p_hourly_rate_cents: input.hourlyRateCents,
      p_effective_from: input.effectiveFrom,
      p_effective_to: input.effectiveTo,
      p_is_primary: input.isPrimary,
    },
  );
  if (error) throwDatabaseError(error, "The employee job assignment could not be updated.");
  return publicAssignment(
    assertFound(data, "The updated employee job assignment was not returned."),
  );
}

export async function endEmployeeJobAssignment(
  context: WorkflowContext,
  input: EndEmployeeJobAssignmentInput,
) {
  const { data, error } = await context.supabase.rpc(
    "end_employee_job_assignment",
    {
      p_request_id: input.requestId,
      p_assignment_id: input.assignmentId,
      p_effective_to: input.effectiveTo,
    },
  );
  if (error) throwDatabaseError(error, "The employee job assignment could not be ended.");
  return publicAssignment(
    assertFound(data, "The ended employee job assignment was not returned."),
  );
}
