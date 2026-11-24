// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import {
  measureChurchIngredientBatchAction, recordChurchIngredientBatchAction, recordChurchIngredientBatchFromSourceAction,
  resolveChurchIngredientBatchAction, voidChurchIngredientBatchAction,
} from "@/app/actions/workflows/church-ingredient-batches";
import { ChurchBatchLabelsPanel } from "@/components/kitchen/church-batch-labels-panel";
import type { ChurchBatchLabel, ChurchBatchMeasurement } from "@/lib/kitchen/church-ingredient-batches";
import type { ChurchIngredientEvidence } from "@/lib/kitchen/church-sandwich-ingredient-evidence";

vi.mock("@/app/actions/workflows/church-ingredient-batches", () => ({
  measureChurchIngredientBatchAction: vi.fn(), recordChurchIngredientBatchAction: vi.fn(),
  recordChurchIngredientBatchFromSourceAction: vi.fn(),
  resolveChurchIngredientBatchAction: vi.fn(), voidChurchIngredientBatchAction: vi.fn(),
}));

const asOf = "2026-11-14T16:00:00Z";
const { refresh } = vi.hoisted(() => ({ refresh: vi.fn() }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh }) }));
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
const measurement: ChurchBatchMeasurement = {
  id: "11111111-1111-4111-8111-111111111111", batchId: recorded.id, quantity: 125.125,
  observedAt: asOf, recordedAt: "2026-11-14T16:00:00.123456Z", recordedByName: "Chef lead",
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
  vi.useRealTimers();
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

it("records a linked prep label against an earlier approved Eastern deadline and holds its descendants when the source is discarded", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(asOf));
  const child: ChurchBatchLabel = {
    ...recorded, id: "77777777-7777-4777-8777-777777777777", batchCode: "HAM-08",
    handledAt: "2026-11-14T15:45:00.000Z", discardAt: "2026-11-14T17:45:00.000Z",
    sourceBatch: { id: recorded.id, batchCode: recorded.batchCode, discardAt: recorded.discardAt }, sourceNeedsReview: false,
  };
  const source = { ...recorded, handledAs: "opened" as const, handlingRule: evidence.openedRule! };
  vi.mocked(recordChurchIngredientBatchFromSourceAction).mockResolvedValue({ ok: true, mode: "live", persisted: true, data: child });
  vi.mocked(resolveChurchIngredientBatchAction).mockResolvedValue({
    ok: true, mode: "live", persisted: true,
    data: { ...source, disposition: { outcome: "discarded", resolvedByName: "Chef lead", resolvedAt: asOf } },
  });
  render(<ChurchBatchLabelsPanel evidence={[evidence]} records={[source]} queue={{ batches: [source], total: 1 }} asOf={asOf} canRecord />);
  const sourceRow = openDetails("French-style ham · HAM-07");
  fireEvent.click(sourceRow.getByRole("button", { name: "Prep from this batch" }));
  const prep = within(sourceRow.getByRole("form", { name: "Prep from HAM-07" }));
  change("New batch code", child.batchCode);
  change("Prepped at (Eastern)", "2026-11-14T10:45");
  change("Discard deadline", "earlier");
  change("Earlier discard by (Eastern)", "2026-11-14T13:15");
  fireEvent.click(prep.getByRole("checkbox"));
  fireEvent.click(prep.getByRole("button", { name: "Record prep batch" }));
  expect(sourceRow.getByText(/future discard time no later than the source deadline/)).toBeTruthy();
  expect(recordChurchIngredientBatchFromSourceAction).not.toHaveBeenCalled();

  change("Earlier discard by (Eastern)", "2026-11-14T12:45");
  fireEvent.click(prep.getByRole("button", { name: "Record prep batch" }));
  expect(await sourceRow.findByText(/Prep batch HAM-08 recorded/)).toBeTruthy();
  expect(recordChurchIngredientBatchFromSourceAction).toHaveBeenCalledExactlyOnceWith({
    requestId: expect.any(String), sourceBatchId: recorded.id, batchCode: child.batchCode,
    handledAt: child.handledAt, discardAt: child.discardAt,
  });
  const childRow = openDetails("French-style ham · HAM-08");
  expect(childRow.getByText(/Prepped from batch HAM-07/).querySelector("time")?.dateTime).toBe(source.discardAt);
  expect(childRow.getByRole("button", { name: "Measure remaining" })).toBeTruthy();
  fireEvent.click(sourceRow.getByRole("button", { name: "Record discard" }));
  fireEvent.click(sourceRow.getByRole("button", { name: "Confirm discard" }));
  expect(await childRow.findByText("Source batch needs review")).toBeTruthy();
  for (const name of ["Measure remaining", "Prep from this batch", "Record used up", "Print label"]) {
    expect(childRow.queryByRole("button", { name })).toBeNull();
  }
  expect(childRow.getByRole("button", { name: "Record discard" })).toBeTruthy();
  expect(childRow.getByRole("button", { name: "Void label" })).toBeTruthy();
});

it("opens a safe printable label on request and closes the preview when its source needs review", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(asOf));
  const doc = document.implementation.createHTMLDocument();
  const preview = { document: doc, opener: window, print: vi.fn(), close: vi.fn(), addEventListener: vi.fn() };
  const open = vi.spyOn(window, "open").mockReturnValueOnce(null).mockReturnValue(preview as unknown as Window);
  const batch: ChurchBatchLabel = {
    ...recorded, supplierLot: "LóT <script>throw 1</script>", supplierSku: "HF☕️",
    storageRule: "<img src=x onerror=alert(1)>\nReview pack label", recordedByName: "Élodie",
    sourceBatch: { id: "77777777-7777-4777-8777-777777777777", batchCode: "HAM–05", discardAt: "2026-11-14T18:00:00.123456Z" },
    sourceNeedsReview: false,
  };
  const props = { evidence: [evidence], asOf, canRecord: true };
  const view = render(<ChurchBatchLabelsPanel {...props} records={[batch]} />);
  const row = openDetails("French-style ham · HAM-07");
  fireEvent.click(row.getByRole("button", { name: "Print label" }));
  expect(row.getByText(/print preview could not open/)).toBeTruthy();
  fireEvent.click(row.getByRole("button", { name: "Print label" }));

  expect(open).toHaveBeenLastCalledWith("", "_blank", expect.stringContaining("popup"));
  expect(preview.opener).toBeNull();
  expect(preview.print).not.toHaveBeenCalled();
  const printable = within(doc.body);
  const label = within(printable.getByRole("main", { hidden: true }));
  expect(label.getByRole("heading", { hidden: true }).textContent).toBe("French-style ham");
  for (const text of [
    "Batch HAM-07", "LóT <script>throw 1</script>", "HF☕️ · r4", "Élodie", "HAM–05",
    "DISCARD BY Nov 14, 2026, 1:00:00 PM EST", "Nov 14, 2026, 1:00:00.123456 PM EST",
  ]) expect(label.getByText(text)).toBeTruthy();
  expect(doc.querySelector("script, img")).toBeNull();
  printable.getByText("Print batch label").click();
  expect(preview.print).toHaveBeenCalledOnce();

  view.rerender(<ChurchBatchLabelsPanel {...props} records={[{ ...batch, sourceNeedsReview: true }]} />);
  expect(row.queryByRole("button", { name: "Print label" })).toBeNull();
  expect(preview.close).toHaveBeenCalledOnce();
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

it("sorts the queue by deadline, closes an exactly due batch after authenticated discard, and retains audit history", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(asOf));
  const due = { ...recorded, id: "66666666-6666-4666-8666-666666666666", batchCode: "HAM-05", discardAt: asOf, recordedAt: "2026-11-14T15:30:00Z" };
  const latest = Array.from({ length: 49 }, (_, index) => ({ ...recorded, id: `latest-${index}`, batchCode: `HAM-X${index}`, recordedAt: "2026-11-14T15:45:00Z", voidedAt: "2026-11-14T15:50:00Z", voidReason: "Fixture" }));
  const discarded: ChurchBatchLabel = { ...due, disposition: { outcome: "discarded", resolvedByName: "Chef lead", resolvedAt: asOf } };
  vi.mocked(resolveChurchIngredientBatchAction).mockResolvedValue({ ok: true, mode: "live", persisted: true, data: discarded });
  render(<ChurchBatchLabelsPanel evidence={[evidence]} records={[recorded, ...latest]} queue={{ batches: [recorded, due], total: 4 }} asOf={asOf} canRecord />);
  const queue = within(screen.getByRole("region", { name: "Open batches by discard time" }));
  const history = within(screen.getByRole("region", { name: "Recent batch label activity" }));
  expect(queue.getByText(/4 open batches/)).toBeTruthy();
  expect(queue.getByText(/Showing 2 of 4/)).toBeTruthy();
  const queueRows = queue.getAllByText(/French-style ham · HAM-/);
  expect(queueRows.map((row) => row.textContent)).toEqual(["French-style ham · HAM-05", "French-style ham · HAM-07"]);
  expect(history.queryByText("French-style ham · HAM-07")).toBeNull();

  const row = openDetails("French-style ham · HAM-05");
  expect(row.getByText("Discard time reached")).toBeTruthy();
  expect(row.queryByRole("button", { name: "Record used up" })).toBeNull();
  fireEvent.click(row.getByRole("button", { name: "Record discard" }));
  expect(row.getByText("Confirm after discarding this physical batch.")).toBeTruthy();
  expect(resolveChurchIngredientBatchAction).not.toHaveBeenCalled();
  fireEvent.click(row.getByRole("button", { name: "Confirm discard" }));
  await history.findByText("Discarded");
  expect(resolveChurchIngredientBatchAction).toHaveBeenCalledExactlyOnceWith({ requestId: expect.any(String), batchId: due.id, outcome: "discarded" });
  expect(queue.queryByText("French-style ham · HAM-05")).toBeNull();
  expect(queue.getByText(/3 open batches/)).toBeTruthy();
  const saved = openDetails("French-style ham · HAM-05");
  expect(saved.getByText(/Discarded recorded by Chef lead/).querySelector("time")?.dateTime).toBe(asOf);
  expect(saved.queryByRole("button")).toBeNull();
});

it("blocks used up after a deadline or evidence change, and communicates an unavailable queue", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(asOf));
  const props = { evidence: [evidence], records: [recorded], queue: { batches: [recorded], total: 1 }, canRecord: true };
  const view = render(<ChurchBatchLabelsPanel {...props} asOf={asOf} />);
  const row = openDetails("French-style ham · HAM-07");
  fireEvent.click(row.getByRole("button", { name: "Record used up" }));
  expect(row.getByText(/Confirm this batch was fully used/)).toBeTruthy();
  view.rerender(<ChurchBatchLabelsPanel {...props} asOf={recorded.discardAt} />);
  expect((row.getByRole("button", { name: "Confirm used up" }) as HTMLButtonElement).disabled).toBe(true);
  expect(resolveChurchIngredientBatchAction).not.toHaveBeenCalled();
  fireEvent.click(row.getByRole("button", { name: "Cancel" }));
  view.rerender(<ChurchBatchLabelsPanel {...props} evidence={[{ ...evidence, revision: 5 }]} asOf={asOf} />);
  expect(row.getByText("Supplier recheck needed")).toBeTruthy();
  expect(row.queryByRole("button", { name: "Record used up" })).toBeNull();

  view.rerender(<ChurchBatchLabelsPanel {...props} queue={null} asOf={asOf} canRecord={false} />);
  const queue = within(screen.getByRole("region", { name: "Open batches by discard time" }));
  expect(queue.getByText(/batch queue could not be loaded/)).toBeTruthy();
  expect(queue.queryByRole("region", { name: "Current shift batch checks" })).toBeNull();
  expect(queue.queryByText("French-style ham · HAM-07")).toBeNull();
  expect(screen.queryByRole("button", { name: "Record discard" })).toBeNull();
  fireEvent.click(queue.getByRole("button", { name: "Refresh list" }));
  expect(refresh).toHaveBeenCalledOnce();
});

it("updates due status exactly at the next visible deadline", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(asOf));
  const soon = { ...recorded, discardAt: "2026-11-14T16:30:02.000Z" };
  render(<ChurchBatchLabelsPanel evidence={[evidence]} records={[soon]} queue={{ batches: [soon], total: 1 }} asOf={asOf} canRecord />);
  const row = openDetails("French-style ham · HAM-07");
  await act(async () => { await vi.advanceTimersByTimeAsync(1_999); });
  expect(row.getByText("Recorded label")).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(row.getByText("Due within 30 minutes")).toBeTruthy();
  expect(row.getByRole("button", { name: "Record used up" })).toBeTruthy();
  expect(row.getByRole("button", { name: "Measure remaining" })).toBeTruthy();
  // Restore a suspended tab immediately before the exact deadline, then let the timer expire.
  act(() => {
    vi.setSystemTime(new Date("2026-11-14T16:30:01.999Z"));
    window.dispatchEvent(new PageTransitionEvent("pageshow", { persisted: true }));
  });
  expect(row.getByRole("button", { name: "Measure remaining" })).toBeTruthy();
  await act(async () => { await vi.advanceTimersByTimeAsync(1); });
  expect(row.getByText("Discard time reached")).toBeTruthy();
  expect(row.queryByRole("button", { name: "Record used up" })).toBeNull();
  expect(row.queryByRole("button", { name: "Measure remaining" })).toBeNull();
});

it("counts only displayed open batches and keeps a measured zero separate from missing observations", () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(asOf));
  const expired = { ...recorded, id: "expired", batchCode: "HAM-EXPIRED", discardAt: asOf, evidenceCurrent: false };
  const held = { ...recorded, id: "supplier-hold", batchCode: "HAM-OLD-LABEL", evidenceRevision: 3 };
  const child = { ...recorded, id: "child", batchCode: "HAM-CHILD", discardAt: "2026-11-14T16:30:00Z",
    sourceBatch: { id: recorded.id, batchCode: recorded.batchCode, discardAt: recorded.discardAt } };
  const discardedSource: ChurchBatchLabel = { ...recorded,
    disposition: { outcome: "discarded", resolvedAt: asOf, resolvedByName: "Chef lead" } };
  const zero = { ...recorded, id: "zero", batchCode: "HAM-ZERO", discardAt: "2026-11-14T16:30:00Z",
    latestMeasurement: { ...measurement, batchId: "zero", quantity: 0 } };
  const unmeasured = { ...recorded, id: "unmeasured", batchCode: "HAM-COUNT" };
  render(<ChurchBatchLabelsPanel evidence={[evidence]} records={[discardedSource]} canRecord asOf={asOf}
    queue={{ batches: [expired, held, child, zero, unmeasured], total: 7 }} />);

  const triage = within(screen.getByRole("region", { name: "Current shift batch checks" }));
  expect(triage.getByText(/Counts cover the 5 open batches shown/)).toBeTruthy();
  expect(screen.getByText(/Showing 5 of 7/)).toBeTruthy();
  for (const [label, count] of [["Expired", "1"], ["Held for review", "2"], ["Due within 30 min", "1"], ["Usable batches unmeasured", "1"]]) {
    expect(triage.getByText(label).nextElementSibling?.textContent).toBe(count);
  }
  const zeroSummary = within(screen.getByText("French-style ham · HAM-ZERO").closest("summary")!);
  expect(zeroSummary.getByText(/Measured 0 g/).querySelector("time")?.dateTime).toBe(asOf);
  expect(zeroSummary.getByText("Due within 30 minutes")).toBeTruthy();
  expect(screen.getByText("Remaining quantity unmeasured")).toBeTruthy();
  const heldChild = openDetails("French-style ham · HAM-CHILD");
  expect(heldChild.getByText("Source batch needs review")).toBeTruthy();
  expect(heldChild.queryByRole("button", { name: "Print label" })).toBeNull();
  expect(heldChild.queryByRole("button", { name: "Measure remaining" })).toBeNull();
  expect(heldChild.getByRole("button", { name: "Record discard" })).toBeTruthy();
});

it("records an explicit zero against the latest batch reading and leaves the batch open", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse("2026-11-14T16:01:00.300Z"));
  const withReading = { ...recorded, latestMeasurement: measurement };
  vi.mocked(measureChurchIngredientBatchAction).mockResolvedValue({ ok: true, mode: "live", persisted: true, data: {
    ...measurement, id: "22222222-2222-4222-8222-222222222222", quantity: 0,
    observedAt: "2026-11-14T16:01:00.000Z", recordedAt: "2026-11-14T16:01:00.306Z", recordedByName: "Prep lead",
  } });
  render(<ChurchBatchLabelsPanel evidence={[evidence]} records={[withReading]} queue={{ batches: [withReading], total: 1 }} asOf={asOf} canRecord />);
  const row = openDetails("French-style ham · HAM-07");
  fireEvent.click(row.getByRole("button", { name: "Measure remaining" }));
  expect((row.getByLabelText("Observed at (Eastern)") as HTMLInputElement).value).toMatch(/^2026-11-14T11:01(:00)?$/);
  fireEvent.click(row.getByRole("button", { name: "Record measurement" }));
  expect(measureChurchIngredientBatchAction).not.toHaveBeenCalled();
  change("Remaining quantity (g)", "0");
  change("Observed at (Eastern)", "2026-11-14T10:59:59");
  fireEvent.click(row.getByRole("button", { name: "Record measurement" }));
  expect(row.getByText(/cannot be earlier than the last measurement/)).toBeTruthy();
  expect(measureChurchIngredientBatchAction).not.toHaveBeenCalled();
  change("Observed at (Eastern)", "2026-11-14T11:01:00");
  fireEvent.click(row.getByRole("button", { name: "Record measurement" }));
  expect(await row.findByText("Batch measurement recorded.")).toBeTruthy();
  expect(measureChurchIngredientBatchAction).toHaveBeenCalledExactlyOnceWith({
    requestId: expect.any(String), expectedLatestId: measurement.id, batchId: recorded.id,
    quantity: 0, observedAt: "2026-11-14T16:01:00.000Z",
  });
  expect(row.getByText(/Last measured remaining.*0 g.*Prep lead/)).toBeTruthy();
  expect(row.getByRole("button", { name: "Record used up" })).toBeTruthy();
  expect(resolveChurchIngredientBatchAction).not.toHaveBeenCalled();
});

it("refreshes concurrent batch conflicts and shows newer readings only as history after evidence changes", async () => {
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(asOf));
  let finish!: (result: Awaited<ReturnType<typeof measureChurchIngredientBatchAction>>) => void;
  vi.mocked(measureChurchIngredientBatchAction)
    .mockResolvedValueOnce({ ok: false, persisted: false, code: "stale", message: "Newer reading" })
    .mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
  const renderPanel = (row: ChurchBatchLabel, revision = evidence.revision) => <ChurchBatchLabelsPanel evidence={[{ ...evidence, revision }]} records={[row]}
    queue={{ batches: [row], total: 1 }} asOf={asOf} canRecord />;
  const view = render(renderPanel(recorded));
  const row = openDetails("French-style ham · HAM-07");
  fireEvent.click(row.getByRole("button", { name: "Measure remaining" }));
  change("Remaining quantity (g)", "125.125");
  fireEvent.click(row.getByRole("button", { name: "Record measurement" }));
  await row.findByText(/latest measurement changed/);
  expect(refresh).toHaveBeenCalledOnce();

  fireEvent.click(row.getByRole("button", { name: "Measure remaining" }));
  change("Remaining quantity (g)", "125.125");
  fireEvent.click(row.getByRole("button", { name: "Record measurement" }));
  const newer = { ...measurement, id: "33333333-3333-4333-8333-333333333333", quantity: 30, recordedAt: "2026-11-14T16:00:00.123999Z", recordedByName: "Incoming lead" };
  view.rerender(renderPanel({ ...recorded, latestMeasurement: newer }, 5));
  await act(async () => finish({ ok: true, mode: "live", persisted: true, data: measurement }));
  expect(row.getByText(/Historical measurement.*30 g.*Incoming lead/)).toBeTruthy();
  expect(row.queryByText(/125\.125 g/)).toBeNull();
  expect(row.queryByRole("button", { name: "Measure remaining" })).toBeNull();
});

it("leaves an ambiguous Eastern wall clock time blank and requires an unambiguous observation", async () => {
  const clockChangeTime = "2026-11-01T06:30:04.000Z";
  vi.spyOn(Date, "now").mockReturnValue(Date.parse(clockChangeTime));
  const bread = { ...recorded, ingredientKey: "10-inch baguette", handledAt: "2026-11-01T04:30:00Z" };
  render(<ChurchBatchLabelsPanel evidence={[{ ...evidence, ingredientKey: bread.ingredientKey }]} records={[bread]} asOf={clockChangeTime} canRecord />);
  const row = openDetails("10-inch baguette · HAM-07");
  fireEvent.click(row.getByRole("button", { name: "Measure remaining" }));
  expect((row.getByLabelText("Observed at (Eastern)") as HTMLInputElement).value).toBe("");
  change("Remaining quantity (each)", "1.5");
  fireEvent.click(row.getByRole("button", { name: "Record measurement" }));
  expect(row.getByText(/Enter a whole baguette count/)).toBeTruthy();
  change("Remaining quantity (each)", "2");
  change("Observed at (Eastern)", "2026-11-01T01:30:04");
  fireEvent.click(row.getByRole("button", { name: "Record measurement" }));
  expect(row.getByText(/Times skipped or repeated/)).toBeTruthy();
  expect(measureChurchIngredientBatchAction).not.toHaveBeenCalled();
});
