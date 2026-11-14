import { afterEach, expect, it, vi } from "vitest";
import { buildChurchSandwichAvailability } from "@/data/read-models/church-sandwich-availability.server";
import { readFailure, readSuccess } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import type { ChurchCateringPrepDay } from "@/lib/kitchen/church-catering-prep";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

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
};

afterEach(() => vi.useRealTimers());

it("uses the New York service day and keeps the approved recipe set empty pending signoff", () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-15T04:30:00Z"));
  expect(buildChurchSandwichAvailability(workspace, {
    ingredientEvidenceResult: readSuccess([hold]),
    cateringPrepResult: { state: "ready", days: [today, { ...today, serviceDate: "2026-11-15" }] },
  })).toEqual(readSuccess({
    evidence: { Dijon: "hold" }, approvedRecipes: [], catering: today, serviceDate: today.serviceDate,
  }));
});

it("does not turn a failed or denied catering read into an empty plan", () => {
  const ingredientEvidenceResult = readSuccess([hold]);
  expect(buildChurchSandwichAvailability(workspace, { ingredientEvidenceResult, cateringPrepResult: null })).toBeNull();
  expect(buildChurchSandwichAvailability(workspace, {
    ingredientEvidenceResult, cateringPrepResult: { state: "unavailable" },
  })).toMatchObject({ ok: false });
  expect(buildChurchSandwichAvailability(workspace, {
    ingredientEvidenceResult: readFailure(), cateringPrepResult: { state: "unavailable" },
  })).toBeNull();
  expect(buildChurchSandwichAvailability({ ...workspace, capabilities: [] }, {
    ingredientEvidenceResult, cateringPrepResult: { state: "ready", days: [today] },
  })).toBeNull();
});
