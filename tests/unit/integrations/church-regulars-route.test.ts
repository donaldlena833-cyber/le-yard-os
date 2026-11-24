import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), scope: vi.fn(), manage: vi.fn() }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/data/read-models/church-square-loyalty.server", () => ({ verifyChurchLoyaltyScope: mocks.scope }));
vi.mock("@/lib/integrations/church-regulars-streak.server", () => ({ manageChurchRegulars: mocks.manage, RegularsConflict: class extends Error {} }));
import { POST } from "@/app/api/workspace/church-regulars/route";
const base = "https://operations.leyardny.com";
function request(body: object | string = { action: "read", accountId: "member" }, origin = base) {
  return new Request(`${base}/api/workspace/church-regulars`, { method: "POST", headers: { origin, "content-type": "application/json" }, body: typeof body === "string" ? body : JSON.stringify(body) });
}
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ status: "ready", context: { role: "owner" } }); mocks.scope.mockResolvedValue(true); mocks.manage.mockResolvedValue({ currentStreak: 0, rewards: [] }); });
describe("private counter treat boundary", () => {
  it("rejects foreign origins before looking up a customer", async () => {
    expect((await POST(request(undefined, "https://foreign.invalid"))).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.manage).not.toHaveBeenCalled();
  });
  it("rejects unauthenticated and foreign-workspace users before service access", async () => {
    mocks.session.mockResolvedValue({ status: "unauthenticated" });
    expect((await POST(request())).status).toBe(401);
    mocks.session.mockResolvedValue({ status: "ready", context: {} }); mocks.scope.mockResolvedValue(false);
    expect((await POST(request())).status).toBe(403); expect(mocks.manage).not.toHaveBeenCalled();
  });
  it("does not accept forged purchase proof, a foreign actor, or an unbounded request", async () => {
    for (const body of [{ action: "reserve", accountId: "member", actorId: "foreign" },
      { action: "read", accountId: "member", qualifyingDays: ["2026-11-24"] }]) expect((await POST(request(body))).status).toBe(400);
    expect((await POST(request(" ".repeat(2049)))).status).toBe(413); expect(mocks.manage).not.toHaveBeenCalled();
  });
  it("passes only the validated command and actor-derived context", async () => {
    const response = await POST(request());
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.manage).toHaveBeenCalledWith({ role: "owner" }, { action: "read", accountId: "member" });
  });
});
