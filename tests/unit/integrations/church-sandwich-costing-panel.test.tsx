// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { recordChurchSandwichPackCostAction } from "@/app/actions/workflows/church-sandwich-costing";
import { ChurchSandwichCostingPanel } from "@/components/kitchen/church-sandwich-costing-panel";
import type { ChurchSandwichPackCost } from "@/lib/kitchen/church-sandwich-costing";
import type { ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

vi.mock("@/app/actions/workflows/church-sandwich-costing", () => ({ recordChurchSandwichPackCostAction: vi.fn() }));

const recordedAt = "2026-11-14T17:32:00Z";
const evidence: ChurchIngredientEvidence[] = ["10-inch baguette", "French-style ham", "cultured butter", "Brie"].map((ingredientKey, index) => ({
  ingredientKey, revision: index + 1, status: index === 3 ? "hold" : "reviewed", supplierSku: `SKU-${index + 1}`,
  sourceReference: "Supplier spec", allergenNotes: "Package label recorded", crossContactNotes: "Statement on file",
  storageRule: "Use reviewed storage rule", openedRule: "Check handling sheet", preppedRule: "Check signed worksheet",
  reviewedAt: recordedAt, updatedAt: recordedAt, reviewerName: "Kitchen lead",
}));
const formula: ChurchSandwichFormula = {
  recipeKey: "parisien", revision: 1, reviewReference: "Parisien trial worksheet", reviewedAt: recordedAt,
  reviewerName: "Kitchen lead", current: true,
  measurements: {
    "10-inch baguette": { quantity: 1, evidenceRevision: 1, measuredInput: 10, measuredUsable: 10, yieldBasis: "whole_each" },
    "French-style ham": { quantity: 50, evidenceRevision: 2, measuredInput: 1_000, measuredUsable: 800, yieldBasis: "weighed_usable_grams" },
    "cultured butter": { quantity: 10, evidenceRevision: 3, measuredInput: 500, measuredUsable: 500, yieldBasis: "weighed_usable_grams" },
  },
};
const bread: ChurchSandwichPackCost = { ingredientKey: "10-inch baguette", evidenceRevision: 1, supplierSku: "SKU-1",
  packQuantity: 10, packCostCents: 1_000, invoiceDate: "2026-11-13", invoiceReference: "Bread invoice 01 line 2", recordedAt };
const ham: ChurchSandwichPackCost = { ...bread, ingredientKey: "French-style ham", evidenceRevision: 2, supplierSku: "SKU-2",
  packQuantity: 1_000, packCostCents: 3_000, invoiceReference: "Ham invoice 01 line 1" };
const butter: ChurchSandwichPackCost = { ...bread, ingredientKey: "cultured butter", evidenceRevision: 3, supplierSku: "SKU-3",
  packQuantity: 500, invoiceReference: "Butter invoice 01 line 1" };

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("shows pending, incomplete, and yield-adjusted costs without using a stale supplier invoice", () => {
  const { rerender } = render(<ChurchSandwichCostingPanel formulas={[formula]} evidence={evidence} costs={null} />);
  expect(screen.getByText(/Invoice pack costs could not be loaded/)).toBeTruthy();
  expect(screen.queryByText("Needs a current signed recipe")).toBeNull();

  rerender(<ChurchSandwichCostingPanel formulas={[formula]} evidence={evidence} costs={[bread, { ...ham, supplierSku: "Previous-SKU" }, butter]} />);
  expect(screen.getAllByText("Needs a current signed recipe")).toHaveLength(5);
  expect(screen.getByText("Le Parisien")).toBeTruthy();
  expect(screen.getByText("Missing invoice costs for French-style ham")).toBeTruthy();
  fireEvent.click(screen.getByText("Current supplier pack costs"));
  expect(screen.queryByText(/Ham invoice 01/)).toBeNull();
  expect(screen.queryByRole("form")).toBeNull();

  rerender(<ChurchSandwichCostingPanel formulas={[formula]} evidence={evidence} costs={[bread, ham, butter]} />);
  expect(screen.getByText("$3.08 per sandwich")).toBeTruthy();
  expect(screen.getByText(/Ham invoice 01 line 1/)).toBeTruthy();
  expect(screen.queryByText(/Missing invoice costs/)).toBeNull();
});

it("records an exact reviewed SKU revision using named purchase units and a stable retry request", async () => {
  const save = vi.mocked(recordChurchSandwichPackCostAction);
  save.mockRejectedValueOnce(new Error("Temporarily offline"))
    .mockResolvedValueOnce({ ok: true, mode: "live", persisted: true, data: ham });
  render(<ChurchSandwichCostingPanel formulas={[]} evidence={evidence} costs={[]} canRecord />);
  fireEvent.click(screen.getByText("Record an invoice pack cost"));
  const form = within(screen.getByRole("form", { name: "Record an invoice pack cost" }));
  const picker = form.getByRole("combobox", { name: "Reviewed ingredient" });
  expect(form.queryByRole("option", { name: "Brie" })).toBeNull();
  fireEvent.change(picker, { target: { value: "10-inch baguette" } });
  fireEvent.change(form.getByLabelText("Whole baguettes in the purchased pack"), { target: { value: "10.5" } });
  fireEvent.click(form.getByRole("button", { name: "Save pack cost" }));
  expect(form.getByText(/positive whole baguette count/)).toBeTruthy();
  expect(save).not.toHaveBeenCalled();

  fireEvent.change(picker, { target: { value: "French-style ham" } });
  expect(form.getByText("Supplier SKU SKU-2 · Label revision 2")).toBeTruthy();
  const weight = form.getByLabelText("Purchased pack weight before trim or drain (g)") as HTMLInputElement;
  expect(weight.value).toBe("");
  fireEvent.change(weight, { target: { value: "1000.125" } });
  fireEvent.change(form.getByLabelText("Pack total (USD)"), { target: { value: "30.09" } });
  fireEvent.change(form.getByLabelText("Invoice date"), { target: { value: "2026-11-13" } });
  fireEvent.change(form.getByLabelText("Invoice line reference"), { target: { value: " Ham invoice 01 line 1 " } });
  fireEvent.click(form.getByRole("button", { name: "Save pack cost" }));
  expect(await form.findByText("The pack cost could not be confirmed. Try again.")).toBeTruthy();
  const button = await form.findByRole("button", { name: "Save pack cost" });
  await waitFor(() => expect(button.matches(":disabled")).toBe(false));
  fireEvent.click(button);
  expect(await form.findByText("Invoice pack cost recorded.")).toBeTruthy();
  expect(save).toHaveBeenCalledTimes(2);
  expect(save.mock.calls[0]).toEqual(save.mock.calls[1]);
  expect(save).toHaveBeenLastCalledWith({ ingredientKey: "French-style ham", evidenceRevision: 2,
    packQuantity: 1000.125, packCostCents: 3009, invoiceDate: "2026-11-13", invoiceReference: "Ham invoice 01 line 1",
    requestId: expect.any(String) });
  expect((picker as HTMLSelectElement).value).toBe("");
});
