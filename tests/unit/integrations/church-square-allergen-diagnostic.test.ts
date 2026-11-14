import { beforeEach, expect, it, vi } from "vitest";
import { getChurchSquareAllergenDiagnosticAction } from "@/app/actions/workflows/church-square-allergen-diagnostic";
import { churchSandwichBenchRecipes } from "@/lib/kitchen/church-sandwich-bench";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), configuration: vi.fn(), catalog: vi.fn() }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/lib/integrations/church-square-configuration.server", () => ({ churchSquareCountConfiguration: mocks.configuration }));
vi.mock("@/lib/integrations/square-counts.server", () => ({
  SquareCountClient: class { verifyChurchSandwichCatalog = mocks.catalog; },
}));
vi.mock("@/data/execute", () => ({
  executeWorkflowAction: async (options: {
    run: (context: { actor: { userId: string }; supabase: { rpc: typeof mocks.rpc } }) => unknown;
    persists?: boolean;
  }) => {
    try {
      const data = await options.run({ actor: { userId: "chef" }, supabase: { rpc: mocks.rpc } });
      return { ok: true, persisted: options.persists ?? true, data };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  },
}));

const workspace = {
  mode: "live", identity: { userId: "chef" }, serviceSettings: { serviceModel: "counter" },
  role: "employee", capabilities: ["recipe.manage"], activeLocation: { id: "church" },
};
const tags = { status: "configured", standard: ["MILK"], custom: ["Wheat"] };
const catalog = churchSandwichBenchRecipes.map(({ name, key }) => key === "parisien"
  ? { name, itemId: "PARISIEN", status: "matched", variations: [{ id: "REGULAR", name: "Private variation fields" }],
    allergens: { ...tags, unrelated: "non-allergen fields" } }
  : { name, itemId: null, status: key === "bleu" ? "ambiguous" : "missing", variations: [] });

function response(data: unknown, code?: string) {
  return { abortSignal: async () => ({ data, error: code ? { code } : null }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ status: "ready", context: workspace });
  mocks.rpc.mockReturnValue(response([]));
  mocks.configuration.mockReturnValue({ locationId: "SQUARE-CHURCH" });
  mocks.catalog.mockResolvedValue([...catalog].reverse());
});

it("checks live native fields for an authorized chef and exposes only scoped catalog data", async () => {
  const result = await getChurchSquareAllergenDiagnosticAction();
  expect(result).toMatchObject({ ok: true, persisted: false, data: {
    checkedAt: expect.any(String), items: [
      { key: "parisien", name: "Le Parisien", status: "matched", itemId: "PARISIEN", variationIds: ["REGULAR"], allergens: tags },
      { key: "verger", allergens: null, status: "missing" },
      { key: "bellecour", allergens: null, status: "missing" },
      { key: "bleu", allergens: null, status: "ambiguous" },
      { key: "rustique", allergens: null, status: "missing" },
      { key: "figaro", allergens: null, status: "missing" },
    ],
  } });
  expect(JSON.stringify(result)).not.toMatch(/unrelated|non-allergen|Private variation/);
  expect(mocks.rpc).toHaveBeenCalledExactlyOnceWith("list_church_sandwich_formulas", { p_location_id: "church" });
  expect(mocks.catalog).toHaveBeenCalledExactlyOnceWith({ includeAllergens: true });
});

it("keeps capability, actor and exact location checks ahead of the Square read", async () => {
  mocks.session.mockResolvedValueOnce({ status: "ready", context: { ...workspace, capabilities: ["prep.complete"] } });
  expect(await getChurchSquareAllergenDiagnosticAction()).toMatchObject({ ok: false });
  mocks.session.mockResolvedValueOnce({ status: "ready", context: { ...workspace, identity: { userId: "different-actor" } } });
  expect(await getChurchSquareAllergenDiagnosticAction()).toMatchObject({ ok: false });
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockReturnValueOnce(response(null, "42501"));
  expect(await getChurchSquareAllergenDiagnosticAction()).toMatchObject({ ok: false });
  mocks.rpc.mockReturnValueOnce(response([{ unexplained: true }]));
  expect(await getChurchSquareAllergenDiagnosticAction()).toMatchObject({ ok: false });
  expect(mocks.catalog).not.toHaveBeenCalled();
});

it("shows an unreadable item as unavailable and rejects an incomplete menu result", async () => {
  mocks.catalog.mockResolvedValueOnce([
    { ...catalog[0], allergens: { status: "empty", standard: ["MILK"], custom: [] } }, ...catalog.slice(1),
  ]);
  expect(await getChurchSquareAllergenDiagnosticAction()).toMatchObject({ ok: true, data: { items: [
    expect.objectContaining({ status: "matched", allergens: { status: "unavailable", standard: [], custom: [] } }),
    ...catalog.slice(1).map((item) => expect.objectContaining({ name: item.name })),
  ] } });
  mocks.catalog.mockResolvedValueOnce([...catalog.slice(0, -1), catalog[0]]);
  expect(await getChurchSquareAllergenDiagnosticAction()).toMatchObject({ ok: false });
});
