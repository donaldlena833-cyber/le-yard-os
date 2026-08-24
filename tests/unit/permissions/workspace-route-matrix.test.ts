import { describe, expect, it } from "vitest";
import { isWorkspaceRouteAccessible } from "@/components/shell/navigation";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

const ROUTES = [
  "/today",
  "/reservations",
  "/reservations/setup",
  "/schedule",
  "/service",
  "/time-clock",
  "/messages",
  "/kitchen",
  "/inventory",
  "/vendors",
  "/team",
  "/earnings",
  "/guests",
  "/income",
  "/closeout",
  "/receipts",
  "/tasks",
  "/reports",
  "/assistant",
  "/integrations",
  "/settings",
] as const;

function workspace(
  role: WorkspaceContextValue["role"],
  capabilities: WorkspaceContextValue["capabilities"],
  activeJob?: WorkspaceContextValue["activeJob"],
): WorkspaceContextValue {
  const organizationId = "20000000-0000-4000-8000-000000000001";
  const location = {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId,
    name: "Le Yard",
    isPrimary: true,
  };
  return {
    mode: "demo",
    identity: {
      userId: "10000000-0000-4000-8000-000000000001",
      displayName: "Route Matrix User",
      email: null,
      aal: "aal1",
    },
    organization: { id: organizationId, name: "Le Yard" },
    activeLocation: location,
    locations: [location],
    availableWorkspaces: [],
    membershipId: "40000000-0000-4000-8000-000000000001",
    role,
    organizationWide: role === "owner" || role === "admin",
    capabilities,
    ...(activeJob ? { activeJob } : {}),
  };
}

function accessMap(context: WorkspaceContextValue) {
  return Object.fromEntries(
    ROUTES.map((route) => [route, isWorkspaceRouteAccessible(route, context)]),
  );
}

describe("workspace direct-route authorization matrix", () => {
  it("keeps every owner route reachable", () => {
    expect(Object.values(accessMap(workspace("owner", [])))).toEqual(
      ROUTES.map(() => true),
    );
  });

  it("keeps a manager without delegated capabilities out of protected domains", () => {
    const actual = accessMap(workspace("manager", []));
    for (const route of ["/today", "/schedule", "/service", "/time-clock", "/messages", "/team", "/earnings", "/receipts", "/tasks"]) {
      expect(actual[route]).toBe(true);
    }
    for (const route of ["/reservations", "/reservations/setup", "/kitchen", "/inventory", "/vendors", "/guests", "/income", "/closeout", "/reports", "/assistant", "/integrations", "/settings"]) {
      expect(actual[route]).toBe(false);
    }
  });

  it("lets an authorized Host reach reservation work without management or money", () => {
    const actual = accessMap(
      workspace("employee", ["reservations.view", "reservations.operate"], {
        name: "Host",
        code: "HOST",
        department: "Front of house",
      }),
    );
    for (const route of ["/today", "/reservations", "/schedule", "/service", "/time-clock", "/messages", "/earnings", "/tasks"]) {
      expect(actual[route]).toBe(true);
    }
    for (const route of ["/reservations/setup", "/team", "/inventory", "/guests", "/income", "/closeout", "/receipts", "/settings"]) {
      expect(actual[route]).toBe(false);
    }
  });

  it("keeps an ordinary employee on self-service and shared operations only", () => {
    const actual = accessMap(workspace("employee", []));
    for (const route of ["/today", "/schedule", "/service", "/time-clock", "/messages", "/earnings", "/tasks"]) {
      expect(actual[route]).toBe(true);
    }
    for (const route of ["/reservations", "/team", "/inventory", "/guests", "/income", "/closeout", "/receipts", "/reports", "/settings"]) {
      expect(actual[route]).toBe(false);
    }
  });
});
