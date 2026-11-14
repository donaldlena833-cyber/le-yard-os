import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), configuration: vi.fn(), payouts: vi.fn(), entries: vi.fn(), from: vi.fn(),
}));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mocks.from }) }));
vi.mock("@/lib/integrations/church-square-payouts.server", () => ({
  churchSquarePayoutConfiguration: mocks.configuration,
  ChurchSquarePayoutClient: class { listPayouts = mocks.payouts; getPayoutEntries = mocks.entries; },
  ChurchSquarePayoutReadError: class extends Error {
    constructor(message: string, readonly code: string, readonly status?: number) { super(message); }
  },
}));

import { GET } from "@/app/api/workspace/church-square-payouts/route";
import { GET as getEntries } from "@/app/api/workspace/church-square-payouts/[reference]/entries/route";
import { isPublicRequestPath } from "@/lib/auth/public-paths";
import { churchSquarePayoutEntriesPath, churchSquarePayoutWindowPath } from "@/lib/integrations/church-square-payout-window";
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

const entry = {
  reference: "poe-entry-1", type: "REFUND", effectiveAt: "2026-11-06T12:00:00Z",
  grossCents: -800, feeCents: -48, netCents: -752, paymentDetails: "private payment details",
};

function entryRequest(reference = payout.id, query = "", headers?: HeadersInit) {
  return getEntries(new Request("https://operations.leyardny.com" + churchSquarePayoutEntriesPath(reference) + query, { headers }),
    { params: Promise.resolve({ reference }) });
}

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
  mocks.entries.mockResolvedValue({ payout: { ...payout, payoutType: "BATCH" }, entries: [entry], hasMore: false });
});

describe("Church Street Square payout entries", () => {
  it("requires the same authenticated finance scope before any provider access", async () => {
    expect(isPublicRequestPath(churchSquarePayoutEntriesPath(payout.id))).toBe(false);
    expect((await entryRequest(payout.id, "?location=other")).status).toBe(400);
    expect((await entryRequest("../other")).status).toBe(400);
    expect((await entryRequest(payout.id, "", { "Sec-Fetch-Site": "cross-site" })).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
    mocks.session.mockResolvedValueOnce({ status: "unauthenticated" });
    expect((await entryRequest()).status).toBe(401);
    mocks.session.mockResolvedValueOnce({ status: "ready", context: { ...workspace, capabilities: [] } });
    expect((await entryRequest()).status).toBe(403);
    stubScope(false);
    expect((await entryRequest()).status).toBe(403);
    expect(mocks.entries).not.toHaveBeenCalled();
  });

  it("returns only safe entry facts and compares a complete signed batch", async () => {
    stubScope();
    const response = await entryRequest();
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(mocks.entries).toHaveBeenCalledExactlyOnceWith(payout.id);
    expect(await response.json()).toEqual({
      reference: payout.id, checkedAt: expect.any(String), payoutType: "BATCH", amountCents: -752, hasMore: false,
      entries: [{ reference: entry.reference, type: "REFUND", effectiveAt: entry.effectiveAt, grossCents: -800, feeCents: -48, netCents: -752 }],
      netTotalCents: -752, differenceCents: 0,
    });
  });

  it.each([
    { note: "later pages", hasMore: true, netCents: -752, payoutType: "BATCH", total: null },
    { note: "missing net", hasMore: false, netCents: null, payoutType: "BATCH", total: null },
    { note: "unknown payout type", hasMore: false, netCents: -752, payoutType: "UNKNOWN", total: -752 },
  ])("withholds comparison for $note", async ({ hasMore, netCents, payoutType, total }) => {
    stubScope();
    mocks.entries.mockResolvedValueOnce({ payout: { ...payout, payoutType }, entries: [{ ...entry, netCents }], hasMore });
    expect(await (await entryRequest()).json()).toMatchObject({ netTotalCents: total, differenceCents: null });
  });

  it("reports the signed difference and withholds unsafe amounts", async () => {
    stubScope();
    const large = Number.MAX_SAFE_INTEGER;
    const forNets = (...amounts: number[]) => ({ payout: { ...payout, payoutType: "BATCH" }, hasMore: false,
      entries: amounts.map((netCents, index) => ({ ...entry, reference: `poe-entry-${index}`, netCents })) });
    mocks.entries.mockResolvedValueOnce(forNets(-751, -3));
    expect(await (await entryRequest()).json()).toMatchObject({ netTotalCents: -754, differenceCents: -2 });
    mocks.entries.mockResolvedValueOnce(forNets(large, large, -large, -large, -752));
    expect(await (await entryRequest()).json()).toMatchObject({ netTotalCents: -752, differenceCents: 0 });
    mocks.entries.mockResolvedValueOnce(forNets(large, 1));
    expect(await (await entryRequest()).json()).toMatchObject({ netTotalCents: null, differenceCents: null });
  });

  it("keeps a zero-entry simple transfer distinct from missing and unavailable", async () => {
    stubScope();
    mocks.entries.mockResolvedValueOnce({ payout: { ...payout, payoutType: "SIMPLE" }, entries: [], hasMore: false });
    expect(await (await entryRequest()).json()).toMatchObject({ payoutType: "SIMPLE", entries: [], netTotalCents: null, differenceCents: null });
    mocks.entries.mockResolvedValueOnce(null);
    expect((await entryRequest()).status).toBe(404);
    mocks.entries.mockRejectedValueOnce(new ChurchSquarePayoutReadError("private rejection", "provider_unavailable", 403));
    const denied = await entryRequest();
    expect(denied.status).toBe(503);
    expect(await denied.json()).toEqual({ status: "payout_permission_unavailable" });
  });
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
