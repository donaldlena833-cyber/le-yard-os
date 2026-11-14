import { afterEach, expect, it, vi } from "vitest";
import { buildChurchSandwichAvailability } from "@/data/read-models/church-sandwich-availability.server";
import { currentChurchAvailabilityRecipes } from "@/data/read-models/church-sandwich-formula.server";
import { readFailure, readSuccess } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import type { ChurchCateringPrepDay } from "@/lib/kitchen/church-catering-prep";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";
import { churchSandwichFormula, saveChurchSandwichFormulaInput } from "@/lib/kitchen/church-sandwich-formula";

const location = { id: "church", organizationId: "le-yard", name: "Church Street", isPrimary: true };
const workspace: WorkspaceContextValue = {
  mode: "live", serviceSettings: { serviceModel: "counter" }, activeLocation: location,
  identity: { userId: "operator", displayName: "Chef", email: null, aal: "aal1" },
  organization: { id: "le-yard", name: "Le Yard" },
  locations: [location], availableWorkspaces: [], membershipId: "membership",
  role: "employee", organizationWide: false, capabilities: ["prep.complete"],
};

const hold: ChurchIngredientEvidence = {
  ingredientKey: "Dijon", status: "hold", revision: 1, updatedAt: "2026-11-14T00:00:00Z",
  supplierSku: null, sourceReference: null, allergenNotes: null, crossContactNotes: null,
  storageRule: null, openedRule: null, preppedRule: null, reviewedAt: null, reviewerName: null,
};
const today: ChurchCateringPrepDay = {
  serviceDate: "2026-11-14", jobCount: 1,
  portions: { parisien: 8, verger: 0, bellecour: 0, bleu: 0, rustique: 0, figaro: 0 },
  packedPortions: { parisien: 3, verger: 0, bellecour: 0, bleu: 0, rustique: 0, figaro: 0 },
  remainingPortions: { parisien: 5, verger: 0, bellecour: 0, bleu: 0, rustique: 0, figaro: 0 },
};

afterEach(() => vi.useRealTimers());

it("uses the New York service day and keeps the approved recipe set empty pending signoff", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T04:30:00Z"));
  expect(buildChurchSandwichAvailability(workspace, {
    ingredientEvidenceResult: readSuccess([hold]),
    cateringPrepResult: { state: "ready", days: [today, { ...today, serviceDate: "2026-11-15" }] },
    formulaResult: readSuccess([]),
  })).toEqual(readSuccess({
    evidence: { Dijon: "hold" }, approvedRecipes: [], catering: today, serviceDate: today.serviceDate,
  }));
});

it("does not turn a failed or denied catering read into an empty plan", () => {
  const ingredientEvidenceResult = readSuccess([hold]);
  const formulaResult = readSuccess([]);
  expect(buildChurchSandwichAvailability(workspace, { ingredientEvidenceResult, cateringPrepResult: null, formulaResult })).toBeNull();
  expect(buildChurchSandwichAvailability(workspace, {
    ingredientEvidenceResult, cateringPrepResult: { state: "unavailable" }, formulaResult,
  })).toMatchObject({ ok: false });
  expect(buildChurchSandwichAvailability(workspace, {
    ingredientEvidenceResult: readFailure(), cateringPrepResult: { state: "unavailable" }, formulaResult,
  })).toBeNull();
  expect(buildChurchSandwichAvailability({ ...workspace, capabilities: [] }, {
    ingredientEvidenceResult, cateringPrepResult: { state: "ready", days: [today] }, formulaResult,
  })).toBeNull();
  expect(buildChurchSandwichAvailability(workspace, {
    ingredientEvidenceResult, cateringPrepResult: { state: "ready", days: [today] }, formulaResult: readFailure(),
  })).toMatchObject({ ok: false });
});

const measured = {
  recipeKey: "parisien",
  reviewReference: "Bench record 01",
  measurements: {
    "10-inch baguette": { quantity: 1, evidenceRevision: 2, yieldBasis: "whole_each", measuredInput: 6, measuredUsable: 6 },
    "French-style ham": { quantity: 74.5, evidenceRevision: 2, yieldBasis: "weighed_usable_grams", measuredInput: 500, measuredUsable: 470 },
    "cultured butter": { quantity: 16, evidenceRevision: 2, yieldBasis: "weighed_usable_grams", measuredInput: 120, measuredUsable: 112 },
  },
};

it("projects signed measured edible grams only while each exact supplier evidence revision is reviewed", () => {
  const formula = churchSandwichFormula.parse({
    ...measured, revision: 3, reviewerName: "Chef", reviewedAt: hold.updatedAt, current: true,
  });
  const evidence = Object.keys(measured.measurements).map((ingredientKey): ChurchIngredientEvidence => ({
    ...hold, ingredientKey, status: "reviewed", revision: 2, reviewedAt: hold.updatedAt, reviewerName: "Chef",
  }));
  const estimate = (rows: ChurchIngredientEvidence[], current = true) => buildChurchSandwichAvailability(workspace, {
    ingredientEvidenceResult: readSuccess(rows), cateringPrepResult: { state: "ready", days: [] },
    formulaResult: readSuccess([{ ...formula, current }]),
  });
  expect(estimate(evidence)).toMatchObject({ data: { approvedRecipes: [{
    key: "parisien", ingredients: { "10-inch baguette": 1, "French-style ham": 74.5, "cultured butter": 16 },
  }] } });
  expect(estimate([{ ...evidence[0], revision: 3 }, ...evidence.slice(1)])).toMatchObject({ data: { approvedRecipes: [] } });
  expect(estimate([{ ...evidence[0], status: "hold" }, ...evidence.slice(1)])).toMatchObject({ data: { approvedRecipes: [] } });
  expect(estimate(evidence, false)).toMatchObject({ data: { approvedRecipes: [] } });
  expect(currentChurchAvailabilityRecipes([formula], evidence.slice(1))).toEqual([]);
  expect(currentChurchAvailabilityRecipes([formula], [{ ...evidence[0], revision: 1 }, ...evidence.slice(1)])).toEqual([]);
});

it("rejects invalid measured yield, fractional baguettes, or a mismatched ingredient set", () => {
  const input = { ...measured, expectedRevision: 0, requestId: "deadbeef-5678-4789-9234-1234567890ab" };
  expect(saveChurchSandwichFormulaInput.safeParse(input).success).toBe(true);
  expect(saveChurchSandwichFormulaInput.safeParse({
    ...input, measurements: { ...input.measurements, "French-style ham": { ...input.measurements["French-style ham"], measuredUsable: 501 } },
  }).success).toBe(false);
  expect(saveChurchSandwichFormulaInput.safeParse({
    ...input, measurements: { ...input.measurements, "10-inch baguette": { ...input.measurements["10-inch baguette"], measuredUsable: 5.5 } },
  }).success).toBe(false);
  expect(saveChurchSandwichFormulaInput.safeParse({ ...input, recipeKey: "figaro" }).success).toBe(false);
});

it("reads review text within PostgreSQL character limits when it contains supplementary characters", () => {
  expect(churchSandwichFormula.safeParse({
    ...measured, reviewReference: "🍎".repeat(200), reviewerName: "🍎".repeat(65),
    revision: 3, reviewedAt: hold.updatedAt, current: true,
  }).success).toBe(true);
});
