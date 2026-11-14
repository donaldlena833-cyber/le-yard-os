// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { saveChurchSandwichFormulaAction } from "@/app/actions/workflows/church-sandwich-formula";
import { ChurchSandwichRecipeApprovalPanel } from "@/components/kitchen/church-sandwich-recipe-approval-panel";
import type { ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

vi.mock("@/app/actions/workflows/church-sandwich-formula", () => ({ saveChurchSandwichFormulaAction: vi.fn() }));

const reviewedAt = "2026-11-14T12:15:00Z";
const parisienEvidence: ChurchIngredientEvidence[] = ["10-inch baguette", "French-style ham", "cultured butter"].map((ingredientKey, index) => ({
  ingredientKey, status: "reviewed", supplierSku: `Supplier lot SKU-${index + 1}`, sourceReference: `Supplier sheet ${index + 1}`,
  allergenNotes: "Recorded package label", crossContactNotes: "Recorded supplier statement", storageRule: "See supplier file",
  openedRule: "See batch worksheet", preppedRule: "See chef review", revision: index + 3, updatedAt: reviewedAt, reviewedAt, reviewerName: "Kitchen lead",
}));

const measurements: ChurchSandwichFormula["measurements"] = {
  "10-inch baguette": { quantity: 1, measuredInput: 10, measuredUsable: 9, evidenceRevision: 3, yieldBasis: "whole_each" },
  "French-style ham": { quantity: 75.25, measuredInput: 500, measuredUsable: 400, evidenceRevision: 4, yieldBasis: "weighed_usable_grams" },
  "cultured butter": { quantity: 12, measuredInput: 240, measuredUsable: 240, evidenceRevision: 5, yieldBasis: "weighed_usable_grams" },
};

const signed: ChurchSandwichFormula = {
  recipeKey: "parisien", revision: 1, measurements, reviewReference: "Kitchen bench 14-B", reviewedAt, reviewerName: "Kitchen lead", current: true,
};

function openParisien() {
  const name = screen.getByText("Le Parisien", { exact: true });
  fireEvent.click(name);
  return within(name.closest("details")!);
}

function change(group: ReturnType<typeof within>, name: RegExp, value: string) {
  fireEvent.change(group.getByRole("textbox", { name }), { target: { value } });
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("renders six pending recipes and withholds signoff until label review and recipe permission", () => {
  const { rerender } = render(<ChurchSandwichRecipeApprovalPanel formulas={[]} evidence={[]} canManage />);
  expect(screen.getAllByText("Pending signoff")).toHaveLength(6);
  const row = openParisien();
  expect(row.getByText("Finish the required supplier label reviews to start signoff.")).toBeTruthy();
  expect(row.queryByRole("form")).toBeNull();
  rerender(<ChurchSandwichRecipeApprovalPanel formulas={[signed]} evidence={parisienEvidence} canManage={false} />);
  expect(row.getByText("Current signoff")).toBeTruthy();
  expect(row.getByText(/Kitchen bench 14-B/)).toBeTruthy();
  expect(row.queryByRole("form")).toBeNull();
});

it("keeps measured inputs blank, validates batch yield, and signs against exact supplier revisions", async () => {
  vi.mocked(saveChurchSandwichFormulaAction).mockResolvedValue({ ok: true, mode: "live", persisted: true, data: signed });
  render(<ChurchSandwichRecipeApprovalPanel formulas={[]} evidence={parisienEvidence} canManage />);
  const row = openParisien();
  const form = within(row.getByRole("form", { name: "Le Parisien recipe signoff" }));
  const ham = within(form.getByRole("group", { name: "French-style ham" }));
  const butter = within(form.getByRole("group", { name: "cultured butter" }));
  const bread = within(form.getByRole("group", { name: "10-inch baguette" }));
  expect(row.getByText("· Bench reference 72 g")).toBeTruthy();
  expect((ham.getByLabelText("Per sandwich (g)") as HTMLInputElement).value).toBe("");
  expect((bread.getByLabelText("As received (each)") as HTMLInputElement).value).toBe("");
  expect(form.queryByRole("textbox", { name: "Per sandwich (each)" })).toBeNull();
  expect(row.getByText(/Reviewed label r4 · Supplier lot SKU-2 · Supplier sheet 2/)).toBeTruthy();

  change(bread, /As received/, "10");
  change(bread, /Usable after prep/, "9");
  change(ham, /Per sandwich/, "75.25");
  change(ham, /As received/, "500");
  change(ham, /Usable after prep/, "50");
  change(butter, /Per sandwich/, "12");
  change(butter, /As received/, "240");
  change(butter, /Usable after prep/, "240");
  change(form, /Worksheet or measured batch reference/, " Kitchen bench 14-B ");
  fireEvent.click(form.getByRole("button", { name: "Sign measured recipe" }));
  expect(form.getByText(/Confirm the measurements and supplier references/)).toBeTruthy();
  expect(ham.getByText(/Usable quantity must cover/)).toBeTruthy();
  expect(saveChurchSandwichFormulaAction).not.toHaveBeenCalled();
  change(ham, /Usable after prep/, "400");
  expect(ham.getByText("Measured usable yield 80%")).toBeTruthy();
  fireEvent.click(form.getByRole("checkbox"));
  fireEvent.click(form.getByRole("button", { name: "Sign measured recipe" }));
  expect(await row.findByText("Recipe revision 1 signed.")).toBeTruthy();
  expect(saveChurchSandwichFormulaAction).toHaveBeenCalledExactlyOnceWith({
    requestId: expect.any(String), recipeKey: "parisien", expectedRevision: 0, reviewReference: "Kitchen bench 14-B", measurements,
  });
  expect(row.getByText(/Signed 75.25 g.*80%.*label r4/)).toBeTruthy();
});

it("keeps the last signed quantities and clears in-progress signoff when evidence changes", () => {
  const view = render(<ChurchSandwichRecipeApprovalPanel formulas={[signed]} evidence={parisienEvidence} canManage />);
  const row = openParisien();
  change(row, /Worksheet or measured batch reference/, "Old supplier draft");
  const changed = parisienEvidence.map((record) => record.ingredientKey === "French-style ham"
    ? { ...record, revision: 5, sourceReference: "New ham specification" }
    : record);
  view.rerender(<ChurchSandwichRecipeApprovalPanel formulas={[signed]} evidence={changed} canManage />);
  expect(row.getByText("Recheck required")).toBeTruthy();
  expect(row.getByText(/label r4 · Recheck this ingredient/)).toBeTruthy();
  expect(row.getByText(/Reviewed label r5.*New ham specification/)).toBeTruthy();
  expect((row.getByLabelText("Worksheet or measured batch reference") as HTMLInputElement).value).toBe("");
  expect(saveChurchSandwichFormulaAction).not.toHaveBeenCalled();
});
