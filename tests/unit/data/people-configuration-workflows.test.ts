import { describe, expect, it, vi } from "vitest";
import type { WorkflowContext } from "@/data/execute";
import {
  createEmployeeJobAssignment,
  createJobRoleDefinition,
  deactivateJobRoleDefinition,
  endEmployeeJobAssignment,
  updateEmployeeJobAssignment,
  updateJobRoleDefinition,
} from "@/data/workflows/people-configuration";

vi.mock("server-only", () => ({}));

const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  employee: "33333333-3333-4333-8333-333333333333",
  role: "44444444-4444-4444-8444-444444444444",
  location: "55555555-5555-4555-8555-555555555555",
  assignment: "66666666-6666-4666-8666-666666666666",
};

describe("People configuration workflow contracts", () => {
  it("maps all six commands while keeping private rates out of results", async () => {
    const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
      void args;
      const data: Record<string, unknown> = {
        create_job_role_definition: {
          id: ids.role,
          name: "Server",
          code: "SERVER",
          department: "Dining room",
          color: "#1F2937",
          default_tip_points: 1,
          is_tipped: true,
          is_active: true,
        },
        update_job_role_definition: {
          id: ids.role,
          name: "Lead server",
          code: "LEAD_SERVER",
          department: "Dining room",
          color: null,
          default_tip_points: 1.25,
          is_tipped: true,
          is_active: true,
        },
        deactivate_job_role_definition: {
          id: ids.role,
          name: "Lead server",
          code: "LEAD_SERVER",
          department: "Dining room",
          color: null,
          default_tip_points: 1.25,
          is_tipped: true,
          is_active: false,
        },
        create_employee_job_assignment: {
          id: ids.assignment,
          employee_id: ids.employee,
          job_role_id: ids.role,
          location_id: ids.location,
          hourly_rate_cents: 2750,
          effective_from: "2026-08-01",
          effective_to: null,
          is_primary: true,
        },
        update_employee_job_assignment: {
          id: ids.assignment,
          employee_id: ids.employee,
          job_role_id: ids.role,
          location_id: ids.location,
          hourly_rate_cents: 2750,
          effective_from: "2026-08-02",
          effective_to: null,
          is_primary: true,
        },
        end_employee_job_assignment: {
          id: ids.assignment,
          employee_id: ids.employee,
          job_role_id: ids.role,
          location_id: ids.location,
          hourly_rate_cents: 2750,
          effective_from: "2026-08-02",
          effective_to: "2026-08-31",
          is_primary: true,
        },
      };
      return { data: data[name], error: null };
    });
    const context = {
      supabase: { rpc },
      actor: { userId: ids.request, aal: "aal1", memberships: [] },
    } as unknown as WorkflowContext;

    const createdRole = await createJobRoleDefinition(context, {
      requestId: ids.request,
      organizationId: ids.organization,
      name: "Server",
      code: "SERVER",
      department: "Dining room",
      color: "#1F2937",
      defaultTipPoints: 1,
      isTipped: true,
    });
    await updateJobRoleDefinition(context, {
      requestId: ids.request,
      jobRoleId: ids.role,
      name: "Lead server",
      code: "LEAD_SERVER",
      department: "Dining room",
      color: null,
      defaultTipPoints: 1.25,
      isTipped: true,
    });
    await deactivateJobRoleDefinition(context, {
      requestId: ids.request,
      jobRoleId: ids.role,
    });
    const createdAssignment = await createEmployeeJobAssignment(context, {
      requestId: ids.request,
      employeeId: ids.employee,
      jobRoleId: ids.role,
      locationId: ids.location,
      hourlyRateCents: 2750,
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      isPrimary: true,
    });
    await updateEmployeeJobAssignment(context, {
      requestId: ids.request,
      assignmentId: ids.assignment,
      jobRoleId: ids.role,
      locationId: ids.location,
      setHourlyRate: false,
      hourlyRateCents: null,
      effectiveFrom: "2026-08-02",
      effectiveTo: null,
      isPrimary: true,
    });
    await endEmployeeJobAssignment(context, {
      requestId: ids.request,
      assignmentId: ids.assignment,
      effectiveTo: "2026-08-31",
    });

    expect(createdRole).toEqual({
      id: ids.role,
      name: "Server",
      code: "SERVER",
      department: "Dining room",
      color: "#1F2937",
      defaultTipPoints: 1,
      isTipped: true,
      active: true,
    });
    expect(createdAssignment).toEqual({
      id: ids.assignment,
      employeeId: ids.employee,
      jobRoleId: ids.role,
      locationId: ids.location,
      effectiveFrom: "2026-08-01",
      effectiveTo: null,
      isPrimary: true,
    });
    expect(createdAssignment).not.toHaveProperty("hourlyRateCents");
    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "create_job_role_definition",
      "update_job_role_definition",
      "deactivate_job_role_definition",
      "create_employee_job_assignment",
      "update_employee_job_assignment",
      "end_employee_job_assignment",
    ]);
    expect(rpc.mock.calls[4][1]).toMatchObject({
      p_set_hourly_rate: false,
      p_hourly_rate_cents: null,
    });
  });
});
