import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  app: { surface: "operations" },
  session: vi.fn(),
  kitchenAccess: vi.fn(),
  evidence: vi.fn(),
}));

vi.mock("@/lib/app-surface", () => ({ get appSurface() { return mocks.app.surface; } }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/components/shell/navigation", () => ({ isWorkspaceRouteAccessible: mocks.kitchenAccess }));
vi.mock("@/data/read-models/church-ingredient-evidence.server", () => ({ loadChurchIngredientEvidence: mocks.evidence }));

import { GET } from "@/app/api/workspace/church-sandwich-staff-resources/[resource]/route";

const churchWorkspace = { activeLocation: { id: "church" } };

function request(resource = "training", headers: Record<string, string> = {}) {
  return GET(new Request("https://operations.example.test/resource", { headers }), {
    params: Promise.resolve({ resource }),
  });
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.app.surface = "operations";
  mocks.session.mockResolvedValue({ status: "ready", context: churchWorkspace });
  mocks.kitchenAccess.mockReturnValue(true);
  mocks.evidence.mockResolvedValue({ ok: true, data: [] });
});

describe("Church Street staff document downloads", () => {
  it.each([
    ["training", "sandwich-station-training"],
    ["supplier-intake", "supplier-label-intake"],
    ["batch-labels", "kitchen-batch-labels"],
  ])("serves the %s PDF after checking Kitchen access", async (resource, filename) => {
    const response = await request(resource);
    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("application/pdf");
    expect(response.headers.get("content-disposition")).toBe(`inline; filename="church-street-${filename}.pdf"`);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(new TextDecoder().decode((await response.arrayBuffer()).slice(0, 5))).toBe("%PDF-");
    expect(mocks.kitchenAccess).toHaveBeenCalledWith("/kitchen", churchWorkspace);
    expect(mocks.evidence).toHaveBeenCalledWith(churchWorkspace);
  });

  it("rejects non-Operations surfaces, unknown resources and cross-site loading before session work", async () => {
    expect((await request("../training")).status).toBe(404);
    expect((await request("constructor")).status).toBe(404);
    expect((await request("training", { "sec-fetch-site": "cross-site" })).status).toBe(403);
    mocks.app.surface = "host";
    expect((await request()).status).toBe(404);
    expect(mocks.session).not.toHaveBeenCalled();
  });

  it("requires a signed-in session with Kitchen and Church Street ingredient access", async () => {
    mocks.session.mockResolvedValueOnce({ status: "unauthenticated" });
    expect((await request()).status).toBe(401);
    mocks.kitchenAccess.mockReturnValueOnce(false);
    expect((await request()).status).toBe(403);
    expect(mocks.evidence).not.toHaveBeenCalled();
    mocks.evidence.mockResolvedValueOnce(null);
    expect((await request()).status).toBe(403);
  });

  it("returns no document when access cannot be verified", async () => {
    mocks.evidence.mockResolvedValueOnce({ ok: false });
    const response = await request();
    expect(response.status).toBe(503);
    expect(await response.text()).toBe("");
  });
});
