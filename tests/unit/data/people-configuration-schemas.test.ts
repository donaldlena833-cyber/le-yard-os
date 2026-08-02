import { describe, expect, it } from "vitest";
import {
  createEmployeeJobAssignmentInputSchema,
  createJobRoleDefinitionInputSchema,
  updateEmployeeJobAssignmentInputSchema,
} from "@/data/people-configuration-schemas";

const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  employee: "33333333-3333-4333-8333-333333333333",
  role: "44444444-4444-4444-8444-444444444444",
  location: "55555555-5555-4555-8555-555555555555",
  assignment: "66666666-6666-4666-8666-666666666666",
};

describe("People configuration schemas", () => {
  it("normalizes explicit role configuration without supplying operational defaults", () => {
    const result = createJobRoleDefinitionInputSchema.safeParse({
      requestId: ids.request,
      organizationId: ids.organization,
      name: "  Lead server  ",
      code: " lead_server ",
      department: null,
      color: "#0f766e",
      defaultTipPoints: 1.125,
      isTipped: true,
    });
    expect(result.success).toBe(true);
    if (result.success) {
      expect(result.data).toMatchObject({
        name: "Lead server",
        code: "LEAD_SERVER",
        color: "#0F766E",
        defaultTipPoints: 1.125,
      });
    }
    expect(
      createJobRoleDefinitionInputSchema.safeParse({
        requestId: ids.request,
        organizationId: ids.organization,
        name: "Server",
        code: "SERVER",
        department: null,
        color: null,
        defaultTipPoints: 1.0001,
        isTipped: true,
      }).success,
    ).toBe(false);
  });

  it("validates private rates and assignment date ranges", () => {
    const base = {
      requestId: ids.request,
      employeeId: ids.employee,
      jobRoleId: ids.role,
      locationId: ids.location,
      hourlyRateCents: 2750,
      effectiveFrom: "2026-08-02",
      effectiveTo: null,
      isPrimary: false,
    };
    expect(createEmployeeJobAssignmentInputSchema.safeParse(base).success).toBe(true);
    expect(
      createEmployeeJobAssignmentInputSchema.safeParse({
        ...base,
        hourlyRateCents: -1,
      }).success,
    ).toBe(false);
    expect(
      createEmployeeJobAssignmentInputSchema.safeParse({
        ...base,
        effectiveTo: "2026-08-01",
      }).success,
    ).toBe(false);

    expect(
      updateEmployeeJobAssignmentInputSchema.safeParse({
        requestId: ids.request,
        assignmentId: ids.assignment,
        jobRoleId: ids.role,
        locationId: ids.location,
        setHourlyRate: false,
        hourlyRateCents: 2750,
        effectiveFrom: "2026-08-02",
        effectiveTo: null,
        isPrimary: false,
      }).success,
    ).toBe(false);
  });
});
