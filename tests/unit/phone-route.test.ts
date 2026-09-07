import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
const state = vi.hoisted(() => ({ role: "owner" }));
vi.mock("@/lib/auth/workspace-session", () => ({
  resolveWorkspaceSession: async () => ({ status: "ready", context: {
    mode: "live", role: state.role, capabilities: [], identity: { email: "owner@example.test", aal: "aal1" },
  } }),
}));
vi.mock("next/navigation", () => ({
  redirect: (url: string) => { throw new Error(`redirect:${url}`); },
  notFound: () => { throw new Error("not-found"); },
}));
beforeEach(() => { vi.resetModules(); vi.stubEnv("NEXT_PUBLIC_APP_SURFACE", "phone"); state.role = "owner"; });
afterEach(() => vi.unstubAllEnvs());
it.each(["owner", "admin"])("renders the signed-in phone page for %s without redirecting to itself", async role => {
  state.role = role;
  const { default: page } = await import("@/app/(workspace)/phone/page");
  const result = await page();
  expect(result?.props.live).toBe(true);
});
it("terminates denied access to the default route instead of redirecting in a loop", async () => {
  const { requireWorkspaceRouteAccess } = await import("@/lib/permissions/route-access.server");
  const context = { role: "employee", capabilities: [] } as unknown as WorkspaceContextValue;
  expect(() => requireWorkspaceRouteAccess("/phone", context)).toThrow("not-found");
});
