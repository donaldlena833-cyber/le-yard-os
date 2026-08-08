import { describe, expect, it } from "vitest";
import {
  allNavItems,
  isNavItemVisible,
} from "@/components/shell/navigation";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { DEMO_CAPABILITY_TEMPLATES } from "@/lib/permissions/capabilities";

function workspace(
  role: WorkspaceContextValue["role"],
  capabilities: WorkspaceContextValue["capabilities"],
  persona?: "chef",
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
    const labels = visibleLabels(workspace("employee", []));
    expect(labels).toEqual(expect.arrayContaining(["Today", "Schedule", "Time Clock", "Service Control", "Messages", "Earnings", "Tasks & SOPs"]));
    expect(labels).not.toContain("Inventory");
    expect(labels).not.toContain("Guests");
    expect(labels).not.toContain("Settings");
  });
});
