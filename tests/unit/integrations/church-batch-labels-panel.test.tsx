// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { recordChurchIngredientBatchAction, voidChurchIngredientBatchAction } from "@/app/actions/workflows/church-ingredient-batches";
import { ChurchBatchLabelsPanel } from "@/components/kitchen/church-batch-labels-panel";
import type { ChurchBatchLabel } from "@/lib/kitchen/church-ingredient-batches";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

vi.mock("@/app/actions/workflows/church-ingredient-batches", () => ({
  recordChurchIngredientBatchAction: vi.fn(), voidChurchIngredientBatchAction: vi.fn(),
}));

const asOf = "2026-11-14T16:00:00Z";
const evidence: ChurchIngredientEvidence = {
  ingredientKey: "French-style ham", status: "reviewed", supplierSku: "H-123", sourceReference: "Pack label revision B",
  allergenNotes: "Label retained", crossContactNotes: "See supplier statement", storageRule: "Follow reviewed storage sheet",
  openedRule: "Use the verified opening rule", preppedRule: "Use the verified prep rule", revision: 4,
  updatedAt: asOf, reviewedAt: asOf, reviewerName: "Kitchen lead",
};
const recorded: ChurchBatchLabel = {
  id: "55555555-5555-4555-8555-555555555555", ingredientKey: "French-style ham", evidenceRevision: 4, supplierSku: "H-123",
  supplierLot: "LOT-22", batchCode: "HAM-07", handledAs: "prepped", handledAt: "2026-11-14T15:30:00.000Z", discardAt: "2026-11-14T18:00:00.000Z",
  handlingRule: evidence.preppedRule!, storageRule: evidence.storageRule!, recordedAt: asOf, recordedByName: "Kitchen lead",
  evidenceCurrent: true, voidedAt: null, voidReason: null,
};

function openDetails(detail: string) {
  const label = screen.getByText(detail, { exact: true });
  fireEvent.click(label);
  return within(label.closest("details")!);
}

function change(label: string, value: string) {
  fireEvent.change(screen.getByLabelText(label), { target: { value } });
}

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
  vi.resetAllMocks();
});

it("requires the exact reviewed lot, converts unambiguous Eastern time, and submits after verification", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(asOf));
  vi.mocked(recordChurchIngredientBatchAction).mockResolvedValue({ ok: true, mode: "live", persisted: true, data: recorded });
  render(<ChurchBatchLabelsPanel evidence={[evidence]} records={[]} asOf={asOf} canRecord />);
  openDetails("Record a batch label");
  expect((screen.getByRole("option", { name: "walnuts" }) as HTMLOptionElement).disabled).toBe(true);
  change("Ingredient", evidence.ingredientKey);
  expect(screen.getByText(/After opening.*verified opening rule/)).toBeTruthy();
  change("Handling", "prepped");
  expect(screen.getByText(/After prep.*verified prep rule/)).toBeTruthy();
  expect(screen.getByText(/earliest applicable discard time/)).toBeTruthy();
  change("Supplier lot", "  LOT-22  ");
  change("Batch code", "HAM-07");
  change("Prepped at (Eastern)", "2026-11-01T01:30");
  change("Discard by (Eastern)", "2026-11-14T13:00");
  fireEvent.click(screen.getByRole("button", { name: "Record verified label" }));
  expect(screen.getByText(/Times skipped or repeated/)).toBeTruthy();
  change("Prepped at (Eastern)", "2026-11-14T10:30");
  fireEvent.click(screen.getByRole("button", { name: "Record verified label" }));
  expect(screen.getByText(/Confirm that the person in charge/)).toBeTruthy();
  expect(recordChurchIngredientBatchAction).not.toHaveBeenCalled();
  fireEvent.click(screen.getByRole("checkbox"));
  fireEvent.click(screen.getByRole("button", { name: "Record verified label" }));
  expect(await screen.findByText("Batch HAM-07 recorded.")).toBeTruthy();
  expect(recordChurchIngredientBatchAction).toHaveBeenCalledExactlyOnceWith({
    requestId: expect.any(String), ingredientKey: evidence.ingredientKey, evidenceRevision: 4,
    supplierLot: "LOT-22", batchCode: "HAM-07", handledAs: "prepped",
    handledAt: recorded.handledAt, discardAt: recorded.discardAt,
  });
  expect(screen.getByText("Recorded label")).toBeTruthy();
});

it("retains source audit details in read-only view and fails closed for expired or changed evidence", () => {
  const expired = { ...recorded, id: "66666666-6666-4666-8666-666666666666", batchCode: "HAM-05", discardAt: asOf };
  render(<ChurchBatchLabelsPanel evidence={[{ ...evidence, revision: 5 }]} records={[recorded, expired]} asOf={asOf} canRecord={false} />);
  const row = openDetails("French-style ham · HAM-07");
  expect(row.getByText("Supplier recheck needed")).toBeTruthy();
  expect(row.getByText(/LOT-22.*H-123.*label r4/)).toBeTruthy();
  expect(row.getByText(/Kitchen lead/)).toBeTruthy();
  expect(screen.getByText("Discard time reached")).toBeTruthy();
  expect(screen.queryByText("Record a batch label")).toBeNull();
  expect(row.queryByRole("button")).toBeNull();
});

it("requires physical-label removal to void and preserves newer server void evidence over a late local reply", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(asOf));
  let finish!: (result: Awaited<ReturnType<typeof voidChurchIngredientBatchAction>>) => void;
  vi.mocked(voidChurchIngredientBatchAction).mockReturnValue(new Promise((resolve) => { finish = resolve; }));
  const view = render(<ChurchBatchLabelsPanel evidence={[evidence]} records={[recorded]} asOf={asOf} canRecord />);
  const row = openDetails("French-style ham · HAM-07");
  fireEvent.click(row.getByRole("button", { name: "Void label" }));
  change("Reason for voiding", "Incorrect written lot");
  fireEvent.click(row.getByRole("button", { name: "Confirm void" }));
  expect(voidChurchIngredientBatchAction).not.toHaveBeenCalled();
  fireEvent.click(row.getByRole("checkbox"));
  fireEvent.click(row.getByRole("button", { name: "Confirm void" }));
  expect(voidChurchIngredientBatchAction).toHaveBeenCalledExactlyOnceWith({ requestId: expect.any(String), batchId: recorded.id, reason: "Incorrect written lot" });

  const latest = { ...recorded, evidenceCurrent: false, voidedAt: asOf, voidReason: "Latest server void reason" };
  view.rerender(<ChurchBatchLabelsPanel evidence={[{ ...evidence, revision: 5 }]} records={[latest]} asOf={asOf} canRecord />);
  finish({ ok: true, mode: "live", persisted: true, data: { ...recorded, voidedAt: asOf, voidReason: "Old action reply" } });
  expect(await row.findByText(/Latest server void reason/)).toBeTruthy();
  expect(row.getByText("Voided")).toBeTruthy();
  expect(row.getByText(/Recheck the current supplier label/)).toBeTruthy();
  expect(row.queryByText(/Old action reply/)).toBeNull();
});
