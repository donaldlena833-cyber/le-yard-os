import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), scope: vi.fn(), read: vi.fn() }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/data/read-models/church-square-loyalty.server", () => ({ verifyChurchLoyaltyScope: mocks.scope }));
vi.mock("@/lib/integrations/church-square-loyalty.server", () => ({ readChurchSquareLoyalty: mocks.read }));
import { POST } from "@/app/api/workspace/church-square-loyalty/route";
import { emptyLoyaltySnapshot } from "@/lib/integrations/church-square-loyalty";

const url = "https://operations.leyardny.com/api/workspace/church-square-loyalty";
function request(body = "{}", origin = "https://operations.leyardny.com") {
  return new Request(url, { method: "POST", headers: { origin, "content-type": "application/json" }, body });
}
beforeEach(() => { vi.clearAllMocks(); mocks.session.mockResolvedValue({ status: "ready", context: {} }); mocks.scope.mockResolvedValue(true); mocks.read.mockResolvedValue(emptyLoyaltySnapshot("active")); });

describe("loyalty route authorization and privacy", () => {
  it("rejects cross-site reads before contacting Square", async () => {
    expect((await POST(request("{}", "https://other.invalid"))).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects an unauthenticated caller", async () => {
    mocks.session.mockResolvedValue({ status: "unauthenticated" });
    expect((await POST(request())).status).toBe(401); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects callers outside the approved Church Street owner/admin scope", async () => {
    mocks.scope.mockResolvedValue(false);
    expect((await POST(request())).status).toBe(403); expect(mocks.read).not.toHaveBeenCalled();
  });
  it("rejects excess fields, invalid phones and oversized input", async () => {
    for (const body of ['{"merchantId":"foreign"}', '{"phone":"2125550100"}']) expect((await POST(request(body))).status).toBe(400);
    expect((await POST(request(' '.repeat(4097)))).status).toBe(413);
    expect(mocks.read).not.toHaveBeenCalled();
  });
  it("returns private no-store data only after scope verification", async () => {
    const response = await POST(request('{"phone":"+12125550100"}'));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(response.headers.get("vary")).toBe("Cookie"); expect(mocks.read).toHaveBeenCalledWith({ phone: "+12125550100" });
  });
});
