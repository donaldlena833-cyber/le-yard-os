import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({
  resolution: {
    status: "ready",
    context: {
      mode: "live",
      identity: {
        userId: "11111111-1111-4111-8111-111111111111",
        displayName: "Operator",
        email: "operator@example.com",
        aal: "aal2",
      },
      organization: {
        id: "22222222-2222-4222-8222-222222222222",
        name: "Verified tenant",
      },
      activeLocation: {
        id: "33333333-3333-4333-8333-333333333333",
        organizationId: "22222222-2222-4222-8222-222222222222",
        name: "Main",
        isPrimary: true,
      },
      locations: [],
      membershipId: "44444444-4444-4444-8444-444444444444",
      role: "owner",
      organizationWide: true,
    },
  } as Record<string, unknown>,
}));

const insert = vi.hoisted(() => vi.fn());

vi.mock("@/lib/env", () => ({ isDemoMode: false }));
vi.mock("@/lib/env.server", () => ({
  getServerRuntimeConfiguration: () => ({ ready: true, mode: "connected" }),
}));
vi.mock("@/lib/auth/workspace-session", () => ({
  resolveWorkspaceSession: async () => state.resolution,
}));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from: (table: string) => {
      expect(table).toBe("application_errors");
      return { insert };
    },
  }),
}));

import { POST } from "@/app/api/client-errors/route";

describe("client error route", () => {
  beforeEach(() => {
    insert.mockReset();
    insert.mockResolvedValue({ error: null });
  });

  it("persists only a generic row in the verified workspace scope", async () => {
    const rawSecret = "database-password=do-not-store";
    const response = await POST(
      new Request("https://ops.example.com/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ digest: "framework_digest-123" }),
      }),
    );

    expect(response.status).toBe(202);
    expect(insert).toHaveBeenCalledTimes(1);
    const record = insert.mock.calls[0][0];
    expect(record.organization_id).toBe(
      "22222222-2222-4222-8222-222222222222",
    );
    expect(record.location_id).toBe(
      "33333333-3333-4333-8333-333333333333",
    );
    expect(record.user_id).toBe(
      "11111111-1111-4111-8111-111111111111",
    );
    expect(record.message).toBe("Workspace error boundary event");
    expect(record.context).toEqual({
      digest: "framework_digest-123",
      source: "workspace_error_boundary",
    });
    expect(JSON.stringify(record)).not.toContain(rawSecret);
    expect(record.context).not.toHaveProperty("path");
    expect(record).not.toHaveProperty("raw_error");
  });

  it("rejects legacy raw error and path fields", async () => {
    const response = await POST(
      new Request("https://ops.example.com/api/client-errors", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          digest: "framework_digest-123",
          message: "sensitive raw exception",
          path: "/payroll/private",
        }),
      }),
    );

    expect(response.status).toBe(400);
    expect(insert).not.toHaveBeenCalled();
  });
});
