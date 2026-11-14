import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), verify: vi.fn(), config: vi.fn(), payments: vi.fn(), refunds: vi.fn(),
}));

vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/data/read-models/church-square-order-window.server", () => ({ verifyChurchSquareOrderWindowScope: mocks.verify }));
vi.mock("@/lib/integrations/church-square-orders.server", () => ({
  churchSquareOrderConfiguration: mocks.config,
  ChurchSquareOrderClient: class {
    listPayments = mocks.payments;
    listRefunds = mocks.refunds;
  },
}));

import { GET } from "@/app/api/workspace/church-square-close-preview/route";
import { churchSquareCloseWindow } from "@/data/read-models/church-square-close-preview.server";
import { isPublicRequestPath } from "@/lib/auth/public-paths";
import { churchSquareClosePreviewPath } from "@/lib/integrations/church-square-close-preview";

const locationId = "00000000-0000-4000-8000-000000000001";
const now = "2026-11-14T13:00:00.000Z";
const stamp = "2026-11-13T13:00:00.000Z";
const date = "2026-11-13";
const context = { activeLocation: { id: locationId } };

const payment = (id: string, extras: object = {}) => ({
  id, createdAt: stamp, updatedAt: stamp, status: "COMPLETED", totalCents: 1200,
  source: "CARD", tipCents: null, amountCents: 1200, orderId: "order-unique", isOffline: false, ...extras,
});
const refund = (id: string, extra: object = {}) => ({
  id, createdAt: stamp, updatedAt: now, status: "COMPLETED", amountCents: 300, paymentId: "tender-a", ...extra,
});

function request(query = `?locationId=${locationId}&date=${date}`, headers?: HeadersInit) {
  return new Request(`https://example.invalid${churchSquareClosePreviewPath}${query}`, { headers });
}

beforeEach(() => {
  vi.resetAllMocks();
  vi.setSystemTime(now);
  mocks.session.mockResolvedValue({ status: "ready", context });
  mocks.verify.mockResolvedValue(true);
  mocks.config.mockReturnValue({});
  mocks.payments.mockResolvedValue({ payments: [], nextCursor: null });
  mocks.refunds.mockResolvedValue({ refunds: [], nextCursor: null });
});
afterEach(() => vi.useRealTimers());

describe("Church Street Square daily close preview", () => {
  it("uses New York calendar boundaries across the spring and fall DST changes", () => {
    expect(churchSquareCloseWindow("2026-03-08", new Date("2026-03-09T18:00:00Z"))).toEqual({
      from: "2026-03-08T05:00:00.000Z", to: "2026-03-09T04:00:00.000Z", dayEnded: true,
    });
    expect(churchSquareCloseWindow("2026-11-01", new Date("2026-11-02T18:00:00Z"))).toEqual({
      from: "2026-11-01T04:00:00.000Z", to: "2026-11-02T05:00:00.000Z", dayEnded: true,
    });
    expect(churchSquareCloseWindow("2026-11-14", new Date(now))).toEqual({
      from: "2026-11-14T05:00:00.000Z", to: now, dayEnded: false,
    });
  });

  it("requires an exact signed-in Church finance workspace before reading either provider list", async () => {
    expect(isPublicRequestPath(churchSquareClosePreviewPath)).toBe(false);
    expect((await GET(request(`?locationId=${locationId}&date=2026-11-07`))).status).toBe(400);
    expect((await GET(request(undefined, { "Sec-Fetch-Site": "cross-site" }))).status).toBe(403);
    mocks.session.mockResolvedValueOnce({ status: "unauthenticated" });
    expect((await GET(request())).status).toBe(401);
    mocks.verify.mockResolvedValueOnce(false);
    expect((await GET(request())).status).toBe(403);
    expect(mocks.payments).not.toHaveBeenCalled();
    expect(mocks.refunds).not.toHaveBeenCalled();
  });

  it("counts split tenders once per ID, handles updates, and subtracts each completed refund once", async () => {
    const tenderA = payment("tender-a", { refundedCents: 300, offlineCreatedAt: stamp, customer: "private" });
    const tenderB = payment("tender-b", { source: "CASH", totalCents: 500, amountCents: 450, tipCents: 50, version: null });
    const external = payment("tender-external", { source: "EXTERNAL", totalCents: 200, amountCents: 200 });
    const unknown = payment("tender-unknown", { source: "UNKNOWN", totalCents: 10, amountCents: 10 });
    mocks.payments.mockResolvedValueOnce({
      payments: [tenderA, payment("tender-b", { status: "APPROVED", source: "CASH" })], nextCursor: "page-two",
    }).mockResolvedValueOnce({ payments: [tenderA, { ...tenderB, updatedAt: now }, external, unknown], nextCursor: null });
    const sameDayRefund = refund("refund-a");
    mocks.refunds.mockResolvedValueOnce({ refunds: [sameDayRefund], nextCursor: "refund-page-two" })
      .mockResolvedValueOnce({ refunds: [sameDayRefund, refund("refund-earlier", { paymentId: "prior-day", amountCents: 200 }),
        refund("refund-unlinked", { paymentId: null, amountCents: 100 }), refund("refund-pending", { status: "PENDING" })], nextCursor: null });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    const body = await response.json();
    expect(body.payments).toMatchObject({ coverage: "complete", observed: 4, completed: 4, offline: 1, totalCents: 1910, tipCents: 50 });
    expect(body.payments.tenders).toEqual([
      { source: "CARD", completed: 1, totalCents: 1200, tipCents: 0 },
      { source: "CASH", completed: 1, totalCents: 500, tipCents: 50 },
      { source: "EXTERNAL", completed: 1, totalCents: 200, tipCents: 0 },
      { source: "UNKNOWN", completed: 1, totalCents: 10, tipCents: 0 },
    ]);
    expect(body.refunds).toMatchObject({ coverage: "complete", observed: 4, completed: 3, unresolved: 1, withoutPaymentReference: 1, paymentOutsideRead: 1, amountCents: 600 });
    expect(body.netActivityCents).toBe(1310);
    expect(JSON.stringify(body)).not.toMatch(/private|tender-|refund-a|page-two/);
    expect(mocks.payments).toHaveBeenNthCalledWith(2, expect.objectContaining({ cursor: "page-two", from: "2026-11-13T05:00:00.000Z", to: "2026-11-14T05:00:00.000Z" }), expect.any(AbortSignal));
  });

  it("withholds totals on a partial read or missing amount and still distinguishes a complete empty refund read", async () => {
    mocks.payments.mockResolvedValueOnce({ payments: [payment("tender-a")], nextCursor: "one" })
      .mockResolvedValueOnce({ payments: [], nextCursor: "two" })
      .mockResolvedValueOnce({ payments: [], nextCursor: "three" });
    expect(await (await GET(request())).json()).toMatchObject({
      payments: { coverage: "partial", completed: 1, totalCents: null, tenders: [
        { source: "CARD", completed: 1, totalCents: null, tipCents: null },
      ] },
      refunds: { coverage: "complete", amountCents: 0 }, netActivityCents: null,
    });
    expect(mocks.payments).toHaveBeenCalledTimes(3);
    mocks.payments.mockResolvedValueOnce({
      payments: [payment("tender-missing", { totalCents: null, orderId: null }), payment("tender-valid", { source: "CASH" }),
        payment("not-completed", { source: "EXTERNAL", status: "PENDING" })],
      nextCursor: null,
    });
    expect(await (await GET(request())).json()).toMatchObject({
      payments: { coverage: "complete", missingTotal: 1, missingOrder: 1, totalCents: null, tipCents: null, tenders: [
        { source: "CARD", completed: 1, totalCents: null, tipCents: null },
        { source: "CASH", completed: 1, totalCents: 1200, tipCents: 0 },
      ] }, netActivityCents: null,
    });
  });

  it("discards ambiguous snapshots at the same revision and preserves independent refund coverage", async () => {
    mocks.payments.mockResolvedValueOnce({ payments: [payment("tender-a")], nextCursor: "one" })
      .mockResolvedValueOnce({ payments: [payment("tender-a", { totalCents: 100 })], nextCursor: null });
    expect(await (await GET(request())).json()).toMatchObject({
      payments: { coverage: "unavailable", observed: 0, totalCents: null, tenders: [] },
      refunds: { coverage: "complete", amountCents: 0 }, netActivityCents: null,
    });
  });
});
