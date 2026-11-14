// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { saveChurchSandwichIngredientEvidenceAction } from "@/app/actions/workflows/church-ingredient-evidence";
import { ChurchSupplierEvidencePanel } from "@/components/kitchen/church-supplier-evidence-panel";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

vi.mock("@/app/actions/workflows/church-ingredient-evidence", () => ({
  saveChurchSandwichIngredientEvidenceAction: vi.fn(),
}));

const pending: ChurchIngredientEvidence = {
  ingredientKey: "10-inch baguette", status: "pending", supplierSku: "Bakery B-061",
  sourceReference: null, allergenNotes: null, crossContactNotes: null, storageRule: null,
  openedRule: null, preppedRule: null, revision: 1, updatedAt: "2026-11-14T12:00:00Z", reviewedAt: null, reviewerName: null,
};
const reviewed: ChurchIngredientEvidence = {
  ...pending, revision: 2, status: "reviewed", sourceReference: "Bakery label B-061 rev 3",
  allergenNotes: "Label identifies wheat", crossContactNotes: "Supplier states shared line with sesame",
  storageRule: "Supplier receiving declaration on file", openedRule: "Opening procedure on supplier sheet",
  preppedRule: "See chef's dated preparation rule", reviewedAt: "2026-11-14T12:15:00Z", reviewerName: "Kitchen lead",
};

function wholePanel() {
  return within(screen.getByRole("region", { name: "Supplier label evidence" }));
}

function openBreadForm() {
  const panel = wholePanel();
  const register = panel.getByText("Sandwich components").closest("details")!;
  fireEvent.click(within(register).getByText("Sandwich components"));
  const bread = within(register).getByText("10-inch baguette", { exact: true }).closest("details")!;
  fireEvent.click(within(bread).getByText("10-inch baguette"));
  return { bread, form: within(within(bread).getByRole("form", { name: "10-inch baguette supplier evidence" })) };
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("defaults the 16 component records to pending and captures an incomplete label as a draft", async () => {
  vi.mocked(saveChurchSandwichIngredientEvidenceAction).mockResolvedValue({ ok: true, mode: "live", persisted: true, data: pending });
  render(<ChurchSupplierEvidencePanel formulas={[]} initialRows={[]} canManage />);
  const register = wholePanel().getByText("Sandwich components").closest("details")!;
  expect(within(register).getAllByText("Pending", { selector: "summary span" })).toHaveLength(16);
  const { form } = openBreadForm();
  fireEvent.change(form.getByLabelText("Supplier, brand and exact SKU"), { target: { value: " Bakery B-061 " } });
  fireEvent.click(form.getByRole("button", { name: "Save evidence" }));
  await form.findByText("Supplier evidence saved.");
  expect(saveChurchSandwichIngredientEvidenceAction).toHaveBeenCalledWith({
    requestId: expect.any(String), ingredientKey: "10-inch baguette", expectedRevision: 0, status: "pending",
    supplierSku: "Bakery B-061", sourceReference: null, allergenNotes: null,
    crossContactNotes: null, storageRule: null, openedRule: null, preppedRule: null,
  });
});

it("requires complete evidence for review and updates the recipe overview after save", async () => {
  vi.mocked(saveChurchSandwichIngredientEvidenceAction).mockResolvedValue({ ok: true, mode: "live", persisted: true, data: reviewed });
  render(<ChurchSupplierEvidencePanel formulas={[]} initialRows={[pending]} canManage />);
  const { bread, form } = openBreadForm();
  fireEvent.change(form.getByLabelText("Review status"), { target: { value: "reviewed" } });
  fireEvent.click(form.getByRole("button", { name: "Save reviewed evidence" }));
  expect(form.getByText("Complete every evidence field before marking this ingredient reviewed.")).toBeTruthy();
  expect(form.getByLabelText("Label or supplier document reference").getAttribute("aria-invalid")).toBe("true");
  expect(saveChurchSandwichIngredientEvidenceAction).not.toHaveBeenCalled();

  for (const [label, value] of [
    ["Label or supplier document reference", reviewed.sourceReference],
    ["Allergens listed by the supplier", reviewed.allergenNotes],
    ["Supplier cross-contact statement", reviewed.crossContactNotes],
    ["Sealed storage and date rules", reviewed.storageRule],
    ["After-opening storage and discard rules", reviewed.openedRule],
    ["After-prep storage and discard rules", reviewed.preppedRule],
  ]) {
    fireEvent.change(form.getByLabelText(label!), { target: { value } });
  }
  fireEvent.click(form.getByRole("button", { name: "Save reviewed evidence" }));
  await form.findByText("Supplier evidence reviewed.");
  expect(saveChurchSandwichIngredientEvidenceAction).toHaveBeenCalledWith(expect.objectContaining({
    expectedRevision: 1, status: "reviewed", sourceReference: reviewed.sourceReference, crossContactNotes: reviewed.crossContactNotes,
  }));
  const review = within(bread).getByText(/Reviewed by Kitchen lead/);
  expect(review.querySelector("time")?.dateTime).toBe(reviewed.reviewedAt);
  const recipe = wholePanel().getByText("Le Parisien", { exact: true }).closest("div")!;
  expect(within(recipe).getByText("1 of 3 ingredient records reviewed")).toBeTruthy();
});

it("keeps read-only records visible and blocks saves against a changed revision", () => {
  const ui = render(<ChurchSupplierEvidencePanel formulas={[]} initialRows={[reviewed]} canManage={false} />);
  let register = wholePanel().getByText("Sandwich components").closest("details")!;
  expect(within(register).queryByRole("form", { hidden: true })).toBeNull();
  expect(within(register).getByText(reviewed.sourceReference!)).toBeTruthy();

  ui.rerender(<ChurchSupplierEvidencePanel formulas={[]} initialRows={[reviewed]} canManage />);
  const { form } = openBreadForm();
  fireEvent.change(form.getByLabelText("Supplier, brand and exact SKU"), { target: { value: "Older unsaved label" } });
  ui.rerender(<ChurchSupplierEvidencePanel formulas={[]} initialRows={[{ ...reviewed, revision: 3, supplierSku: "New lot B-062" }]} canManage />);
  expect(form.getByText(/saved evidence changed/)).toBeTruthy();
  fireEvent.click(form.getByRole("button", { name: "Save reviewed evidence" }));
  expect(saveChurchSandwichIngredientEvidenceAction).not.toHaveBeenCalled();
  fireEvent.click(form.getByRole("button", { name: "Load saved evidence" }));
  expect((form.getByLabelText("Supplier, brand and exact SKU") as HTMLInputElement).value).toBe("New lot B-062");
  register = wholePanel().getByText("Sandwich components").closest("details")!;
  expect(within(register).getByText("Reviewed", { selector: "summary span" })).toBeTruthy();
});
