import { describe, expect, it } from "vitest";
import {
  allNavItems,
  getMobileNavItems,
  isNavItemVisible,
  isWorkspaceRouteAccessible,
} from "@/components/shell/navigation";
import type {
  WorkspaceActiveJobAssignment,
  WorkspaceContextValue,
} from "@/lib/auth/workspace-context";
import { DEMO_CAPABILITY_TEMPLATES } from "@/lib/permissions/capabilities";

function workspace(
  role: WorkspaceContextValue["role"],
  capabilities: WorkspaceContextValue["capabilities"],
  persona?: "chef",
  activeJob?: WorkspaceActiveJobAssignment,
): WorkspaceContextValue {
  const location = {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
    name: "Le Yard",
    isPrimary: true,
  };
  return {
    mode: "live",
    identity: {
      userId: "10000000-0000-4000-8000-000000000001",
      displayName: "Test User",
      email: "test@example.invalid",
      aal: "aal2",
    },
    organization: { id: location.organizationId, name: "Le Yard" },
    activeLocation: location,
    locations: [location],
    availableWorkspaces: [],
    membershipId: "40000000-0000-4000-8000-000000000001",
    role,
    organizationWide: role === "owner" || role === "admin",
    capabilities,
    ...(activeJob ? { activeJob } : {}),
    ...(persona ? { persona } : {}),
  };
}

function visibleLabels(context: WorkspaceContextValue): string[] {
  return allNavItems.filter((item) => isNavItemVisible(item, context)).map((item) => item.label);
}

describe("capability-aware navigation", () => {
  it("gives an Executive Chef kitchen operations without tenant security or money", () => {
    const labels = visibleLabels(workspace("manager", DEMO_CAPABILITY_TEMPLATES.executiveChef, "chef"));
    expect(labels).toContain("Kitchen");
    expect(labels).toContain("Inventory");
    expect(labels).toContain("Vendors");
    expect(labels).toContain("Reports");
    expect(labels).toContain("Time Clock");
    expect(labels).toContain("Service Control");
    expect(labels).not.toContain("Settings");
    expect(labels).not.toContain("People");
    expect(labels).not.toContain("Closeout & tips");
  });

  it("does not treat the Manager role alone as kitchen authorization", () => {
    const labels = visibleLabels(workspace("manager", []));
    expect(labels).not.toContain("Kitchen");
    expect(labels).not.toContain("Inventory");
    expect(labels).not.toContain("Vendors");
    expect(labels).not.toContain("Settings");
  });

  it("keeps an ordinary employee on personal and team workflows", () => {
    const employeeWorkspace = workspace("employee", []);
    const labels = visibleLabels(employeeWorkspace);
    expect(labels).toEqual(expect.arrayContaining(["Today", "Schedule", "Time Clock", "Service Control", "Messages", "Earnings", "Tasks & SOPs"]));
    expect(labels).not.toContain("Inventory");
    expect(labels).not.toContain("Guests");
    expect(labels).not.toContain("Settings");
    expect(getMobileNavItems(employeeWorkspace).map((item) => item.label)).toEqual([
      "Today",
      "Time Clock",
      "Schedule",
      "Messages",
    ]);
    expect(isWorkspaceRouteAccessible("/settings", employeeWorkspace)).toBe(false);
    expect(isWorkspaceRouteAccessible("/assistant", employeeWorkspace)).toBe(false);
    expect(isWorkspaceRouteAccessible("/vendors", employeeWorkspace)).toBe(false);
  });

  it("prioritizes Kitchen in the Chef mobile navigation and blocks unrelated direct routes", () => {
    const chefWorkspace = workspace("manager", DEMO_CAPABILITY_TEMPLATES.executiveChef, "chef");
    expect(getMobileNavItems(chefWorkspace).map((item) => item.label)).toEqual([
      "Today",
      "Kitchen",
      "Inventory",
      "Messages",
    ]);
    expect(isWorkspaceRouteAccessible("/kitchen", chefWorkspace)).toBe(true);
    expect(isWorkspaceRouteAccessible("/team", chefWorkspace)).toBe(false);
    expect(isWorkspaceRouteAccessible("/earnings", chefWorkspace)).toBe(false);
  });

  it("uses the server-provided Host assignment without bypassing reservation authorization", () => {
    const activeHost = {
      name: "Host",
      code: "HOST",
      department: "Front of house",
    };
    const authorizedHost = workspace(
      "employee",
      ["reservations.view"],
      undefined,
      activeHost,
    );
    const unauthorizedHost = workspace("employee", [], undefined, activeHost);

    expect(getMobileNavItems(authorizedHost).map((item) => item.label)).toEqual([
      "Today",
      "Reservations",
      "Service Control",
      "Messages",
    ]);
    expect(getMobileNavItems(unauthorizedHost).map((item) => item.label)).toEqual([
      "Today",
      "Service Control",
      "Schedule",
      "Messages",
    ]);
    expect(isWorkspaceRouteAccessible("/reservations", authorizedHost)).toBe(true);
    expect(isWorkspaceRouteAccessible("/reservations", unauthorizedHost)).toBe(false);
  });

  it("lets an override-only service manager reach dated reservation controls", () => {
    const context = workspace("manager", ["reservations.override"]);
    expect(isWorkspaceRouteAccessible("/reservations/setup", context)).toBe(true);
    expect(visibleLabels(context)).toContain("Reservation controls");
  });

  it("keeps Income behind the exact financial reporting capability", () => {
    const financial = workspace("manager", ["reports.financial.view"]);
    const operational = workspace("manager", ["reports.operational.view"]);
    expect(isWorkspaceRouteAccessible("/income", financial)).toBe(true);
    expect(visibleLabels(financial)).toContain("Income");
    expect(isWorkspaceRouteAccessible("/income", operational)).toBe(false);
    expect(visibleLabels(operational)).not.toContain("Income");
  });

  it("uses the server-provided BOH assignment and keeps kitchen capability-gated", () => {
    const activeBoh = {
      name: "Line Cook",
      code: "BOH-LINE",
      department: "Kitchen",
    };
    const kitchenEmployee = workspace(
      "employee",
      ["prep.complete"],
      undefined,
      activeBoh,
    );
    const unprivilegedBoh = workspace("employee", [], undefined, activeBoh);

    expect(getMobileNavItems(kitchenEmployee).map((item) => item.label)).toEqual([
      "Today",
      "Time Clock",
      "Kitchen",
      "Messages",
    ]);
    expect(getMobileNavItems(unprivilegedBoh).map((item) => item.label)).toEqual([
      "Today",
      "Time Clock",
      "Tasks & SOPs",
      "Messages",
    ]);
    expect(isWorkspaceRouteAccessible("/kitchen", kitchenEmployee)).toBe(true);
    expect(isWorkspaceRouteAccessible("/kitchen", unprivilegedBoh)).toBe(false);
  });
});
