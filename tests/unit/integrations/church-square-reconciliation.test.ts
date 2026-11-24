import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  verifyScope: vi.fn(),
  rpc: vi.fn(),
  abortSignal: vi.fn(),
  after: vi.fn(),
  worker: vi.fn(),
}));

vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/data/read-models/church-square-order-window.server", () => ({
  verifyChurchSquareOrderWindowScope: mocks.verifyScope,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ rpc: mocks.rpc }) }));
vi.mock("@/lib/integrations/church-square-event-worker.server", () => ({
  processChurchSquareReceipts: mocks.worker,
}));

import { GET } from "@/app/api/workspace/church-square-reconciliation/route";
import { isPublicRequestPath } from "@/lib/auth/public-paths";
import { churchSquareReconciliationPath } from "@/lib/integrations/church-square-reconciliation";

function request(query = "", headers?: HeadersInit) {
  return new Request("https://example.invalid" + churchSquareReconciliationPath + query, { headers });
}

const currentWorkspace = { activeLocation: { id: "verified-church-workspace" } };
const invoice = {
  kind: "invoice",
  reference: ":invoiceID",
  orderReference: "order-id",
  status: "PARTIALLY_PAID",
  amountCents: null,
  depositState: "partial",
  depositDueCents: 25000,
  depositCompletedCents: 10000,
  serviceDate: "2026-11-14",
  updatedAt: "2026-11-14T18:30:00+00:00",
};

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ status: "ready", context: currentWorkspace });
  mocks.verifyScope.mockResolvedValue(true);
  mocks.rpc.mockReturnValue({ abortSignal: mocks.abortSignal });
  mocks.abortSignal.mockResolvedValue({ data: { pending: 0, needsReview: 0, resources: [] }, error: null });
});

describe("Church Square reconciliation route", () => {
  it("requires authenticated exact Church workspace scope", async () => {
    expect(isPublicRequestPath(churchSquareReconciliationPath)).toBe(false);
    mocks.session.mockResolvedValueOnce({ status: "unauthenticated" });
    expect((await GET(request())).status).toBe(401);
    mocks.verifyScope.mockResolvedValueOnce(false);
    expect((await GET(request())).status).toBe(403);
    expect(mocks.verifyScope).toHaveBeenCalledWith(currentWorkspace);
    expect(mocks.rpc).not.toHaveBeenCalled();
    expect(mocks.after).not.toHaveBeenCalled();
  });

  it("rejects client location overrides and cross-site preloads before session resolution", async () => {
    expect((await GET(request("?location=elsewhere"))).status).toBe(400);
    expect((await GET(request("", { "Sec-Fetch-Site": "cross-site" }))).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("returns a private allowlisted snapshot and schedules a retry only after an authorized pending read", async () => {
    mocks.abortSignal.mockResolvedValueOnce({
      data: {
        pending: 1, needsReview: 2, resources: [{ ...invoice, card: "PRIVATE card" }],
        internalDetails: "PRIVATE debug",
      },
      error: null,
    });
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(mocks.rpc).toHaveBeenCalledWith("list_church_square_reconciliation", {
      p_location_id: currentWorkspace.activeLocation.id,
    });
    expect(await response.json()).toEqual({ pending: 1, needsReview: 2, resources: [invoice] });
    expect(mocks.after).toHaveBeenCalledExactlyOnceWith(mocks.worker);
    expect(mocks.worker).not.toHaveBeenCalled();
    await GET(request());
    expect(mocks.after).toHaveBeenCalledTimes(1);
  });

  it("fails closed for invalid records or denied RPC reads and never queues a retry", async () => {
    mocks.abortSignal.mockResolvedValueOnce({
      data: { pending: 1, needsReview: 0, resources: [{ ...invoice, reference: "unexpected-full-resource-id" }] },
      error: null,
    });
    expect((await GET(request())).status).toBe(503);
    mocks.abortSignal.mockResolvedValueOnce({ data: null, error: { code: "42501", message: "private" } });
    const denied = await GET(request());
    expect(denied.status).toBe(403);
    expect(await denied.text()).toBe("");
    expect(mocks.after).not.toHaveBeenCalled();
  });
});
