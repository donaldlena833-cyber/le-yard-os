import { beforeEach, describe, expect, it, vi } from "vitest";
import { churchSandwichBenchRecipes } from "@/lib/kitchen/church-sandwich-bench";
import { stockItemId } from "@/data/workflows/church-square-counts";

const mocks = vi.hoisted(() => ({
  session: vi.fn(), rpc: vi.fn(), configuration: vi.fn(), catalog: vi.fn(),
}));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/lib/integrations/church-square-configuration.server", () => ({
  churchSquareCountConfiguration: mocks.configuration,
}));
vi.mock("@/lib/integrations/square-counts.server", () => ({
  SquareCountClient: class { verifyChurchSandwichCatalog = mocks.catalog; },
}));
vi.mock("@/data/execute", () => ({
  executeWorkflowAction: async (options: {
    run: (context: { actor: { userId: string }; supabase: { rpc: typeof mocks.rpc } }) => unknown;
    persists?: boolean;
  }) => {
    try {
      const data = await options.run({ actor: { userId: "operator" }, supabase: { rpc: mocks.rpc } });
      return { ok: true, persisted: options.persists ?? true, data };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  },
}));

import { getChurchSquareMenuDiagnosticAction } from "@/app/actions/workflows/church-square-menu-diagnostic";

const workspace = {
  mode: "live", identity: { userId: "operator" }, serviceSettings: { serviceModel: "counter" },
  role: "owner", activeLocation: { id: "church" },
};
const regularId = "SQUARE-PARISIEN-REGULAR";
const date = "2026-11-14T16:00:00Z";
const menu = churchSandwichBenchRecipes.map(({ name, key }) => key === "parisien"
  ? { name, itemId: "PARISIEN", status: "matched", variations: [
    { id: regularId, name: "Regular", sku: "SKU-1", tracking: "tracked", excluded: "private-extras" },
    { id: "SQUARE-PARISIEN-TEST", name: "Second portion", sku: null, tracking: "untracked" },
  ] }
  : { name, itemId: null, status: key === "bleu" ? "ambiguous" : "missing", variations: [] });

function response(data: unknown, error?: { code: string }) {
  return { abortSignal: async () => ({ data, error }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ status: "ready", context: workspace });
  mocks.rpc.mockReturnValue(response([
    { id: stockItemId("church", regularId), label: "Earlier display name", lastConfirmedObservedAt: date, lastConfirmedQuantity: 7 },
    { id: stockItemId("different-location", "SQUARE-PARISIEN-TEST"), label: "Second portion" },
  ]));
  mocks.configuration.mockReturnValue({ locationId: "SQUARE-CHURCH" });
  mocks.catalog.mockResolvedValue([...menu].reverse());
});

describe("Church Square sandwich menu diagnostic", () => {
  it("derives all six rows in menu order and maps by exact location and variation, not by name", async () => {
    const result = await getChurchSquareMenuDiagnosticAction();
    expect(result).toMatchObject({
      ok: true, persisted: false,
      data: { items: [
        { key: "parisien", status: "matched", itemId: "PARISIEN", variations: [
          { id: regularId, name: "Regular", sku: "SKU-1", tracking: "tracked", mapping: "mapped", openingCount: "confirmed" },
          { id: "SQUARE-PARISIEN-TEST", tracking: "untracked", mapping: "unmapped", openingCount: "unrecorded" },
        ] },
        { key: "verger", status: "missing", variations: [] },
        { key: "bellecour", status: "missing", variations: [] },
        { key: "bleu", status: "ambiguous", variations: [] },
        { key: "rustique", status: "missing", variations: [] },
        { key: "figaro", status: "missing", variations: [] },
      ] },
    });
    expect(mocks.rpc.mock.calls).toEqual([["list_church_square_count_items", { p_location_id: "church" }]]);
    expect(mocks.catalog).toHaveBeenCalledExactlyOnceWith();
    expect(JSON.stringify(result)).not.toMatch(/7"|lastConfirmedQuantity|private-extras/);
  });

  it("keeps the owner/admin and exact database authority ahead of the provider read", async () => {
    mocks.session.mockResolvedValueOnce({ status: "ready", context: { ...workspace, role: "manager" } });
    expect(await getChurchSquareMenuDiagnosticAction()).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();

    mocks.rpc.mockReturnValueOnce(response(null, { code: "42501" }));
    expect(await getChurchSquareMenuDiagnosticAction()).toMatchObject({ ok: false });
    expect(mocks.catalog).not.toHaveBeenCalled();
  });

  it("does not invent mappings, counts or missing rows when source evidence is incomplete", async () => {
    mocks.rpc.mockReturnValueOnce(response({ unexpected: true }));
    expect(await getChurchSquareMenuDiagnosticAction()).toMatchObject({
      ok: true,
      data: { items: expect.arrayContaining([{ key: "parisien", name: "Le Parisien", status: "matched", itemId: "PARISIEN",
        variations: expect.arrayContaining([expect.objectContaining({ mapping: "unknown", openingCount: "unknown" })]) }]) },
    });
    mocks.catalog.mockResolvedValueOnce(menu.slice(0, -1));
    expect(await getChurchSquareMenuDiagnosticAction()).toMatchObject({ ok: false });
  });
});
