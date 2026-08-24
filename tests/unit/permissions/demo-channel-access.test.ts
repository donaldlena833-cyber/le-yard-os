import { describe, expect, it } from "vitest";
import { demoWorkspace } from "@/lib/demo";
import { canAccessDemoChannel } from "@/lib/permissions/demo-channel-access";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

function workspace(
  role: WorkspaceContextValue["role"],
  userId: string,
): WorkspaceContextValue {
  const location = {
    id: "loc-garden-demo",
    organizationId: "org-le-yard-demo",
    name: "Le Yard",
    isPrimary: true,
  };
  return {
    mode: "demo",
    identity: { userId, displayName: "Tester", email: null, aal: "aal1" },
    organization: { id: "org-le-yard-demo", name: "Le Yard" },
    activeLocation: location,
    locations: [location],
    availableWorkspaces: [],
    membershipId: "membership",
    role,
    organizationWide: role === "owner" || role === "admin",
    capabilities: [],
  };
}

describe("playground channel access", () => {
  const management = demoWorkspace.chatChannels.find(
    (channel) => channel.kind === "management",
  )!;
  const allStaff = demoWorkspace.chatChannels.find(
    (channel) => channel.kind === "all_staff",
  )!;

  it("does not enumerate management for an ordinary employee", () => {
    expect(
      canAccessDemoChannel(
        management,
        workspace("employee", "person-irini-demo"),
      ),
    ).toBe(false);
    expect(
      canAccessDemoChannel(allStaff, workspace("employee", "person-irini-demo")),
    ).toBe(true);
  });

  it("requires both management authority and channel participation", () => {
    expect(
      canAccessDemoChannel(
        management,
        workspace("manager", "person-mateo-demo"),
      ),
    ).toBe(true);
    expect(
      canAccessDemoChannel(management, workspace("manager", "not-a-member")),
    ).toBe(false);
  });
});
