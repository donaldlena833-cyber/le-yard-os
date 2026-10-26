import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
const mocks = vi.hoisted(() => ({ user: vi.fn(), session: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ auth: { getUser: mocks.user } }) }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
import { workspaceAccessRevision } from "@/lib/auth/workspace-access.server";
import { GET } from "@/app/api/workspace/access/route";
const context: WorkspaceContextValue = { mode: "live", identity: { userId: "user", displayName: "Private name", email: "private@example.invalid", aal: "aal1" }, organization: { id: "org", name: "Room" }, activeLocation: { id: "location", organizationId: "org", name: "Room", isPrimary: true, timeZone: "America/New_York" }, membershipId: "membership", role: "employee", organizationWide: false, capabilities: ["reservations.view", "preshift.manage"], locations: [{ id: "location", organizationId: "org", name: "Room", isPrimary: true }], availableWorkspaces: [] };
const request = () => new Request("https://example.invalid/api/workspace/access");
beforeEach(() => { vi.resetAllMocks(); mocks.user.mockResolvedValue({ data: { user: { id: "user" } }, error: null }); mocks.session.mockResolvedValue({ status: "ready", context }); });
describe("workspace access revision", () => {
  it("is stable across label, assurance and capability order changes", () => {
    expect(workspaceAccessRevision({ ...context, identity: { ...context.identity, displayName: "Changed", aal: "aal2" }, capabilities: [...context.capabilities].reverse() })).toBe(workspaceAccessRevision(context));
  });
  it.each([
    { ...context, identity: { ...context.identity, userId: "another" } },
    { ...context, membershipId: "another" },
    { ...context, role: "manager" as const },
    { ...context, activeLocation: { ...context.activeLocation, id: "another" } },
    { ...context, capabilities: [] },
    { ...context, locations: [] },
    { ...context, persona: "chef" as const },
    { ...context, activeJob: { name: "Server", code: "SERVER", department: null } },
    { ...context, activeLocation: { ...context.activeLocation, timeZone: "Europe/Paris" } },
  ])("changes when current authority or available scope changes", changed => {
    expect(workspaceAccessRevision(changed)).not.toBe(workspaceAccessRevision(context));
  });
});
describe("own-workspace access endpoint", () => {
  it("returns only a private revision after real Auth and current scope agree", async () => {
    const response = await GET(request()); expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ status: "ready", revision: workspaceAccessRevision(context) });
    expect(response.headers.get("cache-control")).toContain("no-store");
  });
  it.each([401, 403])("rejects Auth refusal%s before workspace queries", async status => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: { status } });
    const response = await GET(request());expect(response.status).toBe(401);expect(mocks.session).not.toHaveBeenCalled();
  });
  it("does not turn an Auth outage into sign-out", async () => {
    mocks.user.mockResolvedValue({ data: { user: null }, error: { status: 503 } });
    expect((await GET(request())).status).toBe(503);expect(mocks.session).not.toHaveBeenCalled();
  });
  it.each(["no_access", "no_location"])("returns a generic refusal for%s without identity data", async status => {
    mocks.session.mockResolvedValue({ status, identity: context.identity });const response = await GET(request());
    expect(response.status).toBe(403);expect(await response.json()).toEqual({ status: "access_changed" });
  });
  it.each(["data_error", "configuration_error"])("keeps%s unavailable without exposing diagnostic fields", async status => {
    mocks.session.mockResolvedValue({ status, identity: context.identity });const response = await GET(request());expect(response.status).toBe(503);expect(await response.json()).toEqual({ status: "unavailable" });
  });
  it("does not verify a mismatched actor or demo scope", async () => {
    mocks.session.mockResolvedValueOnce({ status: "ready", context: { ...context, identity: { ...context.identity, userId: "someone-else" } } }).mockResolvedValueOnce({ status: "ready", context: { ...context, mode: "demo" } });
    expect((await GET(request())).status).toBe(503);expect((await GET(request())).status).toBe(503);
  });
  it("rejects browser-selected identity/scope before any Auth or data work", async () => {
    expect((await GET(new Request(request().url+"?userId=someone-else"))).status).toBe(400);expect(mocks.user).not.toHaveBeenCalled();
  });
  it("sanitizes unexpected service failures", async () => {
    mocks.user.mockRejectedValue(Error("private-diagnostic"));const response = await GET(request());expect(response.status).toBe(503);expect(await response.json()).toEqual({ status: "unavailable" });
  });
});
