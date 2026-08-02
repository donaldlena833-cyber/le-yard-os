import { describe, expect, it } from "vitest";

import {
  AI_HUMAN_APPROVAL_ACTIONS,
  PERMISSIONS,
  ROLE_PERMISSIONS,
  canApproveAIAction,
  canAssignRole,
  canCreateUserWithRole,
  canCreateUsers,
  canSuspendUser,
  canViewSensitiveField,
  evaluateAIAction,
  hasLocationMembership,
  hasTenantMembership,
  isAllowed,
  roleHasPermission,
  type AppRole,
  type PermissionActor,
} from "../../../src/lib/permissions";

const organizationId = "org-le-yard-demo";
const primaryLocationId = "loc-brooklyn";
const secondaryLocationId = "loc-queens";

function actor(role: AppRole, overrides: Partial<PermissionActor> = {}): PermissionActor {
  return {
    userId: `person-${role}`,
    organizationId,
    role,
    membershipStatus: "active",
    locationIds: [primaryLocationId],
    organizationWide: role === "owner" || role === "admin",
    ...overrides,
  };
}

describe("role permission matrix", () => {
  it("defines every role and only known permissions", () => {
    expect(Object.keys(ROLE_PERMISSIONS).sort()).toEqual(["admin", "employee", "manager", "owner"]);
    for (const grants of Object.values(ROLE_PERMISSIONS)) {
      expect([...grants].every((permission) => PERMISSIONS.includes(permission))).toBe(true);
    }
  });

  it.each([
    ["owner", true],
    ["admin", true],
    ["manager", false],
    ["employee", false],
  ] as const)("enforces admin-only user creation for %s", (role, expected) => {
    expect(canCreateUsers(actor(role))).toBe(expected);
  });

  it("gives owners the complete permission surface", () => {
    expect([...ROLE_PERMISSIONS.owner].sort()).toEqual([...PERMISSIONS].sort());
  });

  it("keeps employee self-service capabilities narrow", () => {
    expect(roleHasPermission("employee", "timeclock.clock_self")).toBe(true);
    expect(roleHasPermission("employee", "schedule.request_swap")).toBe(true);
    expect(roleHasPermission("employee", "timeclock.view_all")).toBe(false);
    expect(roleHasPermission("employee", "tips.approve")).toBe(false);
    expect(roleHasPermission("employee", "receipts.upload")).toBe(false);
    expect(roleHasPermission("employee", "inventory.count")).toBe(false);
    expect(roleHasPermission("employee", "crm.view")).toBe(false);
    expect(roleHasPermission("employee", "ai.use")).toBe(false);
    expect(roleHasPermission("employee", "audit.view")).toBe(false);
    expect(roleHasPermission("manager", "ai.use")).toBe(true);
  });
});

describe("tenant and location isolation", () => {
  it("denies active users from another tenant", () => {
    const manager = actor("manager");
    expect(hasTenantMembership(manager, "org-other")).toBe(false);
    expect(isAllowed(manager, "schedule.view", { organizationId: "org-other", locationId: primaryLocationId })).toBe(false);
  });

  it("denies suspended and invited memberships", () => {
    for (const membershipStatus of ["suspended", "invited"] as const) {
      expect(hasTenantMembership(actor("owner", { membershipStatus }), organizationId)).toBe(false);
      expect(isAllowed(actor("owner", { membershipStatus }), "organization.update", { organizationId })).toBe(false);
    }
  });

  it("enforces explicit location membership for a manager", () => {
    const manager = actor("manager");
    expect(hasLocationMembership(manager, organizationId, primaryLocationId)).toBe(true);
    expect(hasLocationMembership(manager, organizationId, secondaryLocationId)).toBe(false);
    expect(isAllowed(manager, "inventory.adjust", { organizationId, locationId: secondaryLocationId })).toBe(false);
  });

  it("allows organization-wide members to reach both in-tenant locations", () => {
    const admin = actor("admin");
    expect(hasLocationMembership(admin, organizationId, secondaryLocationId)).toBe(true);
    expect(isAllowed(admin, "schedule.publish", { organizationId, locationId: secondaryLocationId })).toBe(true);
  });
});

describe("user lifecycle controls", () => {
  it("prevents admins from creating or assigning owner authority", () => {
    const admin = actor("admin");
    expect(canCreateUserWithRole(admin, "manager")).toBe(true);
    expect(canCreateUserWithRole(admin, "owner")).toBe(false);
    expect(canAssignRole(admin, "admin")).toBe(true);
    expect(canAssignRole(admin, "owner")).toBe(false);
  });

  it("allows owners to assign owner authority", () => {
    expect(canCreateUserWithRole(actor("owner"), "owner")).toBe(true);
    expect(canAssignRole(actor("owner"), "owner")).toBe(true);
  });

  it("does not allow self-suspension, cross-tenant suspension, or admin suspension of owners", () => {
    const admin = actor("admin");
    expect(canSuspendUser(admin, admin)).toBe(false);
    expect(canSuspendUser(admin, actor("owner"))).toBe(false);
    expect(canSuspendUser(admin, actor("employee", { organizationId: "org-other" }))).toBe(false);
    expect(canSuspendUser(admin, actor("employee"))).toBe(true);
  });
});

describe("sensitive field visibility", () => {
  it("lets an employee see only their own emergency contact and documents", () => {
    const employee = actor("employee");
    const selfScope = { organizationId, locationId: primaryLocationId, subjectUserId: employee.userId };
    expect(canViewSensitiveField(employee, "emergency_contact", selfScope)).toBe(true);
    expect(canViewSensitiveField(employee, "employee_documents", selfScope)).toBe(true);
    expect(canViewSensitiveField(employee, "compensation", selfScope)).toBe(false);
    expect(canViewSensitiveField(employee, "emergency_contact", { ...selfScope, subjectUserId: "someone-else" })).toBe(false);
  });

  it("lets managers see operationally necessary details but not payroll or credentials", () => {
    const manager = actor("manager");
    const scope = { organizationId, locationId: primaryLocationId, subjectUserId: "person-employee" };
    expect(canViewSensitiveField(manager, "guest_allergies", scope)).toBe(true);
    expect(canViewSensitiveField(manager, "emergency_contact", scope)).toBe(true);
    expect(canViewSensitiveField(manager, "payroll_export", scope)).toBe(false);
    expect(canViewSensitiveField(manager, "integration_credentials", scope)).toBe(false);
  });

  it("still denies owners across tenant boundaries", () => {
    expect(canViewSensitiveField(actor("owner"), "audit_details", { organizationId: "org-other" })).toBe(false);
  });
});

describe("AI human approval guards", () => {
  it("requires human approval and disables automatic execution for every restricted action", () => {
    const owner = actor("owner");
    for (const action of AI_HUMAN_APPROVAL_ACTIONS) {
      expect(evaluateAIAction(owner, action, { organizationId, locationId: primaryLocationId })).toEqual({
        requiresHumanApproval: true,
        canActorApprove: true,
        canExecuteAutomatically: false,
      });
    }
  });

  it("maps approvals to the matching human permission", () => {
    const manager = actor("manager");
    expect(canApproveAIAction(manager, "approve_punch_edit", { organizationId, locationId: primaryLocationId })).toBe(true);
    expect(canApproveAIAction(manager, "post_inventory_adjustment", { organizationId, locationId: primaryLocationId })).toBe(true);
    expect(canApproveAIAction(manager, "mutate_guest_record", { organizationId, locationId: primaryLocationId })).toBe(true);
    expect(canApproveAIAction(manager, "finalize_payroll", { organizationId, locationId: primaryLocationId })).toBe(false);
    expect(canApproveAIAction(manager, "finalize_tip_distribution", { organizationId, locationId: primaryLocationId })).toBe(true);
  });

  it("never lets an AI proposal bypass a location boundary", () => {
    const manager = actor("manager");
    expect(evaluateAIAction(manager, "approve_punch_edit", { organizationId, locationId: secondaryLocationId })).toEqual({
      requiresHumanApproval: true,
      canActorApprove: false,
      canExecuteAutomatically: false,
    });
  });
});
