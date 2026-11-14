import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  canRequest: vi.fn(),
  rpc: vi.fn(),
  abortSignal: vi.fn(),
}));

vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/data/read-models/church-square-order-window.server", () => ({
  canRequestChurchSquareOrderWindow: mocks.canRequest,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));

import { GET } from "@/app/api/workspace/church-square-order-watch/route";
import { isPublicRequestPath } from "@/lib/auth/public-paths";
import { churchSquareOrderWatchPath } from "@/lib/integrations/church-square-order-watch";

const locationId = "00000000-0000-4000-8000-000000000001";
const otherLocationId = "00000000-0000-4000-8000-000000000002";
const context = { activeLocation: { id: locationId } };
const snapshot = {
  checkedAt: "2026-11-14T18:35:00+00:00",
  orderCoverageThrough: "2026-11-14T18:32:00+00:00",
  hasMore: false,
  orders: [{
    reference: "order-1234",
    source: "DOORDASH",
    status: "OPEN",
    updatedAt: "2026-11-14T18:32:24+00:00",
    fulfillments: [{
      type: "DELIVERY",
      status: "PREPARED",
      promisedAt: "2026-11-14T18:38:00+00:00",
      readyAt: "2026-11-14T18:27:00+00:00",
      handoffAt: null,
      completedAt: null,
      canceledAt: null,
      rejectedAt: null,
    }],
  }],
};

function request(query = `?locationId=${locationId}`, headers?: HeadersInit) {
  return new Request(`https://example.invalid${churchSquareOrderWatchPath}${query}`, { headers });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ status: "ready", context });
  mocks.canRequest.mockReturnValue(true);
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal });
  mocks.abortSignal.mockResolvedValue({ data: snapshot, error: null });
});

describe("Church Square order watch route", () => {
  it("requires the current authenticated management workspace on every poll", async () => {
    expect(isPublicRequestPath(churchSquareOrderWatchPath)).toBe(false);
    mocks.session.mockResolvedValueOnce({ status: "unauthenticated" });
    expect((await GET(request())).status).toBe(401);
    expect((await GET(request(`?locationId=${otherLocationId}`))).status).toBe(403);
    mocks.canRequest.mockReturnValueOnce(false);
    expect((await GET(request())).status).toBe(403);
    expect(mocks.canRequest).toHaveBeenCalledWith(context);
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("rejects malformed and cross-site reads before resolving a session", async () => {
    expect((await GET(request(""))).status).toBe(400);
    expect((await GET(request(`?locationId=${locationId}&locationId=${locationId}`))).status).toBe(400);
    expect((await GET(request(`?locationId=${locationId}&merchant=other`))).status).toBe(400);
    expect((await GET(request(undefined, { "Sec-Fetch-Site": "cross-site" }))).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("reads only the scoped projection and returns the allowlisted fields without caching", async () => {
    const order = snapshot.orders[0];
    mocks.abortSignal.mockResolvedValueOnce({ data: {
      ...snapshot,
      privateMerchantId: "provider",
      orders: [{ ...order, totalCents: 1900, fulfillments: [{ ...order.fulfillments[0], note: "private note" }] }],
    }, error: null });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("list_church_square_order_watch", { p_location_id: locationId });
    expect(await response.json()).toEqual(snapshot);
  });

  it("fails closed on authorization changes or malformed saved facts", async () => {
    mocks.abortSignal.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "private detail" } });
    const denied = await GET(request());
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe("");
    mocks.abortSignal.mockResolvedValueOnce({ data: { ...snapshot, orderCoverageThrough: "invalid" }, error: null });
    expect((await GET(request())).status).toBe(503);
  });
});
