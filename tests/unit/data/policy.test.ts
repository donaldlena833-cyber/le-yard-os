import { describe, expect, it } from "vitest";
import { WorkflowError } from "@/data/errors";
import {
  canRequestOrganizationWideReport,
  requireLocationAccess,
  requireLocationManagement,
  requireManagementRead,
  requireOrganizationAccess,
  requireOrganizationOperations,
} from "@/data/policy";
import type { AuthenticatedActor } from "@/data/types";

const orgA = "22222222-2222-4222-8222-222222222222";
const orgB = "33333333-3333-4333-8333-333333333333";
const locA = "44444444-4444-4444-8444-444444444444";
const locB = "55555555-5555-4555-8555-555555555555";

function actor(
  role: "owner" | "admin" | "manager" | "employee",
  options: { aal?: "aal1" | "aal2"; locations?: string[] } = {},
): AuthenticatedActor {
  return {
    userId: "11111111-1111-4111-8111-111111111111",
    aal: options.aal ?? "aal1",
    memberships: [
      {
        organizationId: orgA,
        role,
        locationIds: options.locations ?? [locA],
        organizationWide: role === "owner" || role === "admin",
      },
    ],
  };
}

function expectForbidden(run: () => unknown) {
  expect(run).toThrowError(WorkflowError);
  try {
    run();
  } catch (error) {
    expect((error as WorkflowError).code).toBe("forbidden");
  }
}

describe("server actor scope policy", () => {
  it("rejects cross-tenant access", () => {
    expectForbidden(() => requireOrganizationAccess(actor("admin"), orgB));
  });

  it("allows management reads but not employee management reads", () => {
    expect(requireManagementRead(actor("manager"), orgA).role).toBe("manager");
    expectForbidden(() => requireManagementRead(actor("employee"), orgA));
  });

  it("requires assigned locations for managers and employees", () => {
    expect(requireLocationAccess(actor("manager"), orgA, locA).role).toBe("manager");
    expectForbidden(() => requireLocationAccess(actor("manager"), orgA, locB));
    expectForbidden(() => requireLocationAccess(actor("employee"), orgA, locB));
  });

  it("allows admins organization-wide location management", () => {
    expect(requireLocationManagement(actor("admin"), orgA, locB).role).toBe("admin");
  });

  it("allows password-authenticated owners to perform scoped writes", () => {
    expect(requireOrganizationOperations(actor("owner"), orgA).role).toBe("owner");
    expect(requireLocationManagement(actor("owner"), orgA, locB).role).toBe("owner");
  });

  it("allows assigned managers to operate but never employees", () => {
    expect(requireLocationManagement(actor("manager"), orgA, locA).role).toBe("manager");
    expectForbidden(() => requireLocationManagement(actor("manager"), orgA, locB));
    expectForbidden(() => requireLocationManagement(actor("employee"), orgA, locA));
  });

  it("limits organization-wide report requests to owners and admins", () => {
    expect(canRequestOrganizationWideReport(actor("admin").memberships[0])).toBe(true);
    expect(canRequestOrganizationWideReport(actor("manager").memberships[0])).toBe(false);
  });
});
