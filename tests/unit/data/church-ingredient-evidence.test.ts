import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

const mocks = vi.hoisted(() => ({ session: vi.fn(), rpc: vi.fn(), revalidate: vi.fn() }));
vi.mock("next/cache", () => ({ revalidatePath: mocks.revalidate }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: () => ({ rpc: mocks.rpc }) }));
vi.mock("@/data/execute", () => ({
  executeWorkflowAction: async (options: {
    input: unknown; schema: { parse: (data: unknown) => unknown };
    run: (context: { actor: { userId: string }; supabase: { rpc: typeof mocks.rpc } }, input: unknown) => unknown;
  }) => {
    try {
      const data = await options.run({
        actor: { userId: "operator" }, supabase: { rpc: mocks.rpc },
      }, options.schema.parse(options.input));
      return { ok: true, persisted: true, mode: "live", data };
    } catch (error) {
      return { ok: false, message: (error as Error).message };
    }
  },
}));

import { saveChurchSandwichIngredientEvidenceAction } from "@/app/actions/workflows/church-ingredient-evidence";
import { loadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";

const location = { id: "church", organizationId: "le-yard", name: "Church Street", isPrimary: true };
const workspace: WorkspaceContextValue = {
  mode: "live", serviceSettings: { serviceModel: "counter" },
  activeLocation: location,
  identity: { userId: "operator", displayName: "Chef", email: null, aal: "aal1" },
  organization: { id: "le-yard", name: "Le Yard" },
  locations: [location], availableWorkspaces: [], membershipId: "membership",
  role: "employee", organizationWide: false, capabilities: ["recipe.manage"],
};
const date = "2026-11-14T16:00:00Z";
const input = {
  ingredientKey: "10-inch baguette",
  status: "pending",
  requestId: "30000000-0000-4000-8000-000000000001",
  expectedRevision: 0,
  supplierSku: " SKU-42 ",
  sourceReference: "label rev A",
  allergenNotes: "Review ingredients with chef.",
  crossContactNotes: " ",
  storageRule: null,
  openedRule: null,
  preppedRule: null,
} as const;
const evidenceFields = {
  ingredientKey: input.ingredientKey, status: "pending", supplierSku: "SKU-42",
  sourceReference: "label rev A", allergenNotes: input.allergenNotes, crossContactNotes: null,
  storageRule: null, openedRule: null, preppedRule: null,
} as const;
const row = { ...evidenceFields, revision: 1, updatedAt: date, reviewedAt: null, reviewerName: null };

function response(data: unknown, error?: { code: string }) {
  return { abortSignal: async () => ({ data, error }) };
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ status: "ready", context: workspace });
  mocks.rpc.mockImplementation((name) => response(name === "list_church_ingredient_evidence" ? [row] : row));
});

describe("Church Street ingredient evidence", () => {
  it("reads only for an authorized Kitchen scope and suppresses the exact-tenant rejection", async () => {
    expect(await loadChurchIngredientEvidence({ ...workspace, capabilities: [] })).toBeNull();
    expect(mocks.rpc).not.toHaveBeenCalled();

    const prepWorkspace = { ...workspace, capabilities: ["prep.complete"] } satisfies WorkspaceContextValue;
    expect(await loadChurchIngredientEvidence(prepWorkspace)).toEqual({ ok: true, data: [row] });
    expect(mocks.rpc).toHaveBeenCalledWith("list_church_ingredient_evidence", { p_location_id: "church" });

    mocks.rpc.mockReturnValueOnce(response(null, { code: "42501" }));
    expect(await loadChurchIngredientEvidence(prepWorkspace)).toBeNull();
    mocks.rpc.mockReturnValueOnce(response([row, row]));
    expect(await loadChurchIngredientEvidence(prepWorkspace)).toMatchObject({ ok: false });
  });

  it("passes a normalized draft with actor-derived scope and revision to the user RPC", async () => {
    expect(await saveChurchSandwichIngredientEvidenceAction(input)).toEqual({
      ok: true, persisted: true, mode: "live", data: row,
    });
    expect(mocks.rpc).toHaveBeenCalledOnce();
    expect(mocks.rpc).toHaveBeenCalledWith("save_church_ingredient_evidence", {
      p_request_id: input.requestId, p_location_id: "church", p_ingredient_key: input.ingredientKey,
      p_status: "pending", p_expected_revision: 0, p_supplier_sku: "SKU-42", p_source_reference: "label rev A",
      p_allergen_notes: input.allergenNotes, p_cross_contact_notes: null, p_storage_rule: null,
      p_opened_rule: null, p_prepped_rule: null,
    });
    expect(mocks.revalidate).toHaveBeenCalledWith("/kitchen");
  });

  it("rejects read-only writers, extra approval fields, unknown components and incomplete reviewed evidence", async () => {
    for (const invalid of [
      { ...input, reviewedAt: date }, { ...input, ingredientKey: "invented item" },
      { ...input, supplierSku: "x".repeat(121) }, { ...input, status: "reviewed" },
    ]) {
      expect(await saveChurchSandwichIngredientEvidenceAction(invalid)).toMatchObject({ ok: false });
    }
    mocks.session.mockResolvedValueOnce({ status: "ready", context: { ...workspace, capabilities: ["prep.manage"] } });
    expect(await saveChurchSandwichIngredientEvidenceAction(input)).toMatchObject({ ok: false });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("permits explicit not-applicable values and displays review fields stamped by the database", async () => {
    const approved = {
      ...input, status: "reviewed", expectedRevision: 1,
      crossContactNotes: "Reviewed separate tools.",
      storageRule: "Approved from supplier guidance.", openedRule: "Not applicable to this package.",
      preppedRule: "Discard per the reviewed station procedure.",
    };
    mocks.rpc.mockReturnValueOnce(response({
      ...row, ...approved, revision: 2, reviewedAt: date, reviewerName: "Chef",
      privateId: "should-not-leave-server",
    }));
    const result = await saveChurchSandwichIngredientEvidenceAction(approved);
    expect(result).toMatchObject({ ok: true, data: { status: "reviewed", revision: 2, reviewedAt: date, reviewerName: "Chef" } });
    expect(JSON.stringify(result)).not.toContain("should-not-leave-server");
  });
});
