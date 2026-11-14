import { expect, it } from "vitest";
import { churchSandwichTimingRunList, recordChurchSandwichTimingRunInput } from "@/lib/kitchen/church-sandwich-timing";

const input = {
  requestId: "12345678-1234-4234-9234-1234567890ab",
  recipeKey: "parisien",
  formulaRevision: null,
  attempted: 6,
  accepted: 5,
  crewSize: 1,
  prepSeconds: null,
  buildSeconds: 384,
  packSeconds: 0,
  reference: "Bench sheet A",
  note: null,
};

it("preserves observed zero separately from an untimed phase and validates whole elapsed seconds", () => {
  expect(recordChurchSandwichTimingRunInput.parse(input)).toMatchObject({ prepSeconds: null, packSeconds: 0 });
  for (const overrides of [{ accepted: 7 }, { buildSeconds: 0 }, { prepSeconds: 1.25 }, { crewSize: 13 },
    { note: "one\ntwo" }, { formulaRevision: 0 }, { recordedByName: "impersonated operator" }]) {
    expect(recordChurchSandwichTimingRunInput.safeParse({ ...input, ...overrides }).success).toBe(false);
  }
});

it("retains the recorded run and excludes internal identity fields from the read projection", () => {
  const saved = churchSandwichTimingRunList.parse([{
    ...input, id: input.requestId, recordedAt: "2026-11-14T12:00:00Z",
    recordedByName: "Chef", recordedBy: "internal actor",
  }])[0];
  expect(saved).toMatchObject({ formulaRevision: null, attempted: 6, accepted: 5, buildSeconds: 384 });
  expect(saved).not.toHaveProperty("recordedBy");
  expect(saved).not.toHaveProperty("requestId");
});
