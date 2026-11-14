import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  session: vi.fn(),
  allowed: vi.fn(),
  evidence: vi.fn(),
  records: vi.fn(),
  queue: vi.fn(),
}));

vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/data/read-models/church-ingredient-evidence.server", () => ({
  canReadChurchIngredientEvidence: mocks.allowed,
  loadChurchIngredientEvidence: mocks.evidence,
}));
vi.mock("@/data/read-models/church-ingredient-batches.server", () => ({
  loadChurchBatchLabels: mocks.records,
  loadChurchBatchQueue: mocks.queue,
}));

import { GET } from "@/app/api/workspace/church-kitchen-batches/route";
import { isPublicRequestPath } from "@/lib/auth/public-paths";
import {
  churchBatchBoardPath, churchBatchBoardResponse, churchBatchBoardScopeHeader, churchBatchBoardScopeValue,
} from "@/lib/kitchen/church-batch-board";

const scope = {
  organizationId: "00000000-0000-4000-8000-000000000001",
  locationId: "00000000-0000-4000-8000-000000000002",
  userId: "00000000-0000-4000-8000-000000000003",
};
const context = {
  organization: { id: scope.organizationId },
  activeLocation: { id: scope.locationId },
  identity: { userId: scope.userId },
};
const emptyQueue = { batches: [], total: 0 };

function request(headers: HeadersInit = { [churchBatchBoardScopeHeader]: churchBatchBoardScopeValue(scope) }, search = "") {
  return new Request(`https://example.invalid${churchBatchBoardPath}${search}`, { headers });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ status: "ready", context });
  mocks.allowed.mockReturnValue(true);
  mocks.evidence.mockResolvedValue({ ok: true, data: [] });
  mocks.records.mockResolvedValue({ ok: true, data: [] });
  mocks.queue.mockResolvedValue({ ok: true, data: emptyQueue });
});

describe("Church Street batch board read", () => {
  it("uses the authenticated scope and returns a private explicitly empty snapshot", async () => {
    expect(isPublicRequestPath(churchBatchBoardPath)).toBe(false);
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("private, no-store");
    expect(response.headers.get("vary")).toBe("Cookie");
    expect(churchBatchBoardResponse.parse(await response.json())).toMatchObject({
      ...scope, evidence: [], records: [], queue: emptyQueue,
    });
    for (const load of [mocks.evidence, mocks.records, mocks.queue]) expect(load).toHaveBeenCalledWith(context);
  });

  it("denies cross-site requests and tabs whose session scope has changed before reading batch data", async () => {
    expect((await GET(request({ "sec-fetch-site": "cross-site" }))).status).toBe(403);
    expect((await GET(request(undefined, "?locationId=another-store"))).status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
    expect((await GET(request({}))).status).toBe(403);
    mocks.session.mockResolvedValueOnce({
      status: "ready", context: { ...context, identity: { userId: "new-user" } },
    });
    expect((await GET(request())).status).toBe(403);
    mocks.session.mockResolvedValueOnce({ status: "unauthenticated" });
    expect((await GET(request())).status).toBe(401);
    mocks.allowed.mockReturnValueOnce(false);
    expect((await GET(request())).status).toBe(403);
    expect(mocks.evidence).not.toHaveBeenCalled();
    expect(mocks.records).not.toHaveBeenCalled();
    expect(mocks.queue).not.toHaveBeenCalled();
  });

  it("distinguishes a denied read from a temporary failure without returning a partial board", async () => {
    mocks.queue.mockResolvedValueOnce(null);
    expect((await GET(request())).status).toBe(403);
    mocks.queue.mockResolvedValueOnce({ ok: false, error: "Database read failed." });
    const unavailable = await GET(request());
    expect(unavailable.status).toBe(503);
    expect(await unavailable.text()).toBe("");
    mocks.session.mockResolvedValueOnce({ status: "data_error" });
    expect((await GET(request())).status).toBe(503);
  });
});
