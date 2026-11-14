import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), configuration: vi.fn(), payouts: vi.fn(), from: vi.fn(),
}));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mocks.from }) }));
vi.mock("@/lib/integrations/church-square-payouts.server", () => ({
  churchSquarePayoutConfiguration: mocks.configuration,
  ChurchSquarePayoutClient: class { listPayouts = mocks.payouts; },
  ChurchSquarePayoutReadError: class extends Error {
    constructor(message: string, readonly code: string, readonly status?: number) { super(message); }
  },
}));

import { GET } from "@/app/api/workspace/church-square-payouts/route";
import { isPublicRequestPath } from "@/lib/auth/public-paths";
import { churchSquarePayoutWindowPath } from "@/lib/integrations/church-square-payout-window";
import { ChurchSquarePayoutReadError } from "@/lib/integrations/church-square-payouts.server";

function request(query = "", headers?: HeadersInit) {
  return new Request("https://operations.leyardny.com" + churchSquarePayoutWindowPath + query, { headers });
}

const workspace = {
  role: "manager",
  mode: "live",
  capabilities: ["reports.financial.view"],
  serviceSettings: { serviceModel: "counter" },
  organization: { id: "church-tenant" },
  activeLocation: { id: "church-location" },
};
const payout = {
  id: "po_12345678-1234-1234-1234-0123456789ab",
  status: "PAID",
  amountCents: -752,
  createdAt: "2026-11-14T12:00:00Z",
  updatedAt: null,
  arrivalDate: "2026-11-14",
  destination: "private destination details",
};

function stubScope(locationFound = true) {
  const select = vi.fn().mockReturnThis();
  const eq = vi.fn().mockReturnThis();
  mocks.from.mockImplementation((table) => ({
    select, eq,
    maybeSingle: async () => ({ data: table === "organizations" || locationFound ? { id: "found" } : null, error: null }),
  }));
  return eq;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ status: "ready", context: workspace });
  mocks.configuration.mockReturnValue({ locationId: "verified-square-location" });
  mocks.payouts.mockResolvedValue({ payouts: [], nextCursor: null });
});

describe("Church Street Square payout window", () => {
  it("rejects client provider selectors, cross-site fetches, and unauthenticated sessions", async () => {
    expect(isPublicRequestPath(churchSquarePayoutWindowPath)).toBe(false);
    expect((await GET(request("?cursor=provider-cursor"))).status).toBe(400);
    expect((await GET(request("", { "Sec-Fetch-Site": "cross-site" }))).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
    mocks.session.mockResolvedValueOnce({ status: "unauthenticated" });
    expect((await GET(request())).status).toBe(401);
    expect(mocks.payouts).not.toHaveBeenCalled();
  });

  it("requires current financial management capability and the exact enrolled location", async () => {
    stubScope(false);
    mocks.session.mockResolvedValueOnce({ status: "ready", context: { ...workspace, capabilities: [] } });
    expect((await GET(request())).status).toBe(403);
    mocks.session.mockResolvedValueOnce({ status: "ready", context: { ...workspace, role: "employee" } });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
    expect((await GET(request())).status).toBe(403);
    expect(mocks.payouts).not.toHaveBeenCalled();
  });

  it("passes one server-derived seven-day range, retains signed amounts, and strips destinations and cursors", async () => {
    const eq = stubScope();
    mocks.payouts.mockResolvedValueOnce({ payouts: [payout], nextCursor: "internal-cursor" });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(eq).toHaveBeenCalledWith("slug", "le-yard-church-street");
    expect(eq).toHaveBeenCalledWith("code", "CHURCH");
    expect(mocks.payouts).toHaveBeenCalledOnce();
    const window = mocks.payouts.mock.lastCall?.[0];
    expect(Date.parse(window.to) - Date.parse(window.from)).toBe(7 * 24 * 60 * 60 * 1_000);
    expect(await response.json()).toEqual({
      checkedAt: window.to, hasMore: true,
      payouts: [{
        reference: payout.id, status: "PAID", amountCents: -752, createdAt: payout.createdAt,
        updatedAt: null, arrivalDate: payout.arrivalDate,
      }],
    });
  });

  it("distinguishes Square credential rejection from workspace denial and provider outages", async () => {
    stubScope();
    mocks.configuration.mockReturnValueOnce(undefined);
    const disabled = await GET(request());
    expect(disabled.status).toBe(503);
    expect(await disabled.json()).toEqual({ status: "setup_pending" });
    expect(mocks.payouts).not.toHaveBeenCalled();

    mocks.payouts.mockRejectedValueOnce(new ChurchSquarePayoutReadError("private rejection", "provider_unavailable", 403));
    const denied = await GET(request());
    expect(denied.status).toBe(503);
    expect(await denied.json()).toEqual({ status: "payout_permission_unavailable" });

    mocks.payouts.mockRejectedValueOnce(new ChurchSquarePayoutReadError("private location", "scope_mismatch"));
    const unavailable = await GET(request());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.json()).toEqual({ status: "unavailable" });
  });
});
