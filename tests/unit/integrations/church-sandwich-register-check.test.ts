import { beforeEach, expect, it, vi } from "vitest";
import { recordChurchSandwichRegisterCheckAction } from "@/app/actions/workflows/church-sandwich-register-check";
import { recordChurchSandwichRegisterCheckInput } from "@/lib/kitchen/church-sandwich-register-check";

const mocks = vi.hoisted(() => ({ session: vi.fn(), catalog: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/lib/integrations/church-square-allergen-diagnostic.server", () => ({ readChurchSquareAllergenCatalog: mocks.catalog }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/data/execute", () => ({
  executeWorkflowAction: async ({ input, run }: {
    input: Parameters<typeof recordChurchSandwichRegisterCheckInput.parse>[0];
    run: (context: { actor: { userId: string } }, check: ReturnType<typeof recordChurchSandwichRegisterCheckInput.parse>) => Promise<unknown>;
  }) => {
    try {
      return { ok: true, persisted: true, data: await run({ actor: { userId: "chef" } }, recordChurchSandwichRegisterCheckInput.parse(input)) };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  },
}));

const workspace = {
  mode: "live", identity: { userId: "chef" }, serviceSettings: { serviceModel: "counter" },
  capabilities: ["recipe.manage"], activeLocation: { id: "church" },
};
const requestId = "39197d15-6173-4d03-94e3-183ce4c6cc15";
const details = {
  recipeKey: "parisien", formulaRevision: 2, squareItemId: "PARISIEN", squareCatalogVersion: "1794643600001",
  outcome: "matched", device: "Training register 1", reference: "Internal rehearsal 31",
};
const input = { ...details, requestId };
const recorded = { ...details, id: requestId, recordedByName: "Chef", recordedAt: "2026-11-14T14:50:12Z" };
const item = { key: details.recipeKey, status: "matched", itemId: details.squareItemId,
  catalogVersion: details.squareCatalogVersion, variationIds: ["REGULAR"], allergens: { status: "configured", standard: ["MILK"], custom: [] } };
const receipt = { p_actor_id: "chef", p_location_id: "church", p_request_id: requestId };

function response(data: unknown, code?: string) {
  return { abortSignal: async () => ({ data, error: code ? { code } : null }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ status: "ready", context: workspace });
  mocks.catalog.mockResolvedValue({ items: [item] });
  mocks.rpc.mockImplementation((name: string) => response(name === "record_church_sandwich_register_check" ? recorded : null));
});

it("verifies the Church scoped item and catalog version before writing operator evidence", async () => {
  expect(await recordChurchSandwichRegisterCheckAction(input)).toMatchObject({ ok: true, data: recorded });
  expect(mocks.rpc).toHaveBeenNthCalledWith(1, "get_church_sandwich_register_check_receipt", receipt);
  expect(mocks.rpc).toHaveBeenNthCalledWith(2, "record_church_sandwich_register_check", {
    ...receipt, p_recipe_key: details.recipeKey, p_formula_revision: details.formulaRevision, p_square_item_id: details.squareItemId,
    p_square_catalog_version: details.squareCatalogVersion, p_outcome: details.outcome, p_device: details.device, p_reference: details.reference,
  });
  expect(mocks.revalidate).toHaveBeenCalledWith("/kitchen");
});

it("rejects wrong location and unauthorized roles before reading Square", async () => {
  mocks.session.mockResolvedValueOnce({ status: "ready", context: { ...workspace, capabilities: ["prep.complete"] } });
  expect(await recordChurchSandwichRegisterCheckAction(input)).toMatchObject({ ok: false });
  expect(mocks.rpc).not.toHaveBeenCalled();
  mocks.rpc.mockReturnValueOnce(response(null, "42501"));
  expect(await recordChurchSandwichRegisterCheckAction(input)).toMatchObject({ ok: false });
  expect(mocks.catalog).not.toHaveBeenCalled();
});

it("keeps an older Square version or empty tags from passing a register match", async () => {
  mocks.catalog.mockResolvedValueOnce({ items: [{ ...item, catalogVersion: "1794643600002" }] });
  expect(await recordChurchSandwichRegisterCheckAction(input)).toMatchObject({ ok: false, message: expect.stringContaining("version changed") });
  mocks.catalog.mockResolvedValueOnce({ items: [{ ...item, allergens: { status: "empty", standard: [], custom: [] } }] });
  expect(await recordChurchSandwichRegisterCheckAction(input)).toMatchObject({ ok: false, message: expect.stringContaining("readable Square allergen tags") });
  expect(mocks.rpc.mock.calls.map(([name]) => name)).toEqual([
    "get_church_sandwich_register_check_receipt", "get_church_sandwich_register_check_receipt",
  ]);
});

it("replays the identical receipt during a Square outage and rejects a changed payload", async () => {
  mocks.rpc.mockReturnValue(response(recorded));
  mocks.catalog.mockRejectedValue(new Error("Offline"));
  expect(await recordChurchSandwichRegisterCheckAction(input)).toMatchObject({ ok: true, data: recorded });
  expect(await recordChurchSandwichRegisterCheckAction({ ...input, reference: "Different check" })).toMatchObject({ ok: false });
  expect(mocks.catalog).not.toHaveBeenCalled();
});
