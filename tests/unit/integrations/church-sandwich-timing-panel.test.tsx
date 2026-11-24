// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { recordChurchSandwichTimingRunAction } from "@/app/actions/workflows/church-sandwich-timing";
import { ChurchSandwichTimingPanel } from "@/components/kitchen/church-sandwich-timing-panel";
import type { ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";
import type { ChurchSandwichTimingRun } from "@/lib/kitchen/church-sandwich-timing";

vi.mock("@/app/actions/workflows/church-sandwich-timing", () => ({ recordChurchSandwichTimingRunAction: vi.fn() }));

const recordedAt = "2026-11-14T14:00:00Z";
const formula: ChurchSandwichFormula = {
  recipeKey: "parisien", revision: 3, current: true, reviewedAt: recordedAt, reviewerName: "Chef lead", reviewReference: "Bench 3",
  measurements: {
    "10-inch baguette": { quantity: 1, measuredInput: 10, measuredUsable: 9, evidenceRevision: 1, yieldBasis: "whole_each" },
    "French-style ham": { quantity: 72, measuredInput: 500, measuredUsable: 400, evidenceRevision: 1, yieldBasis: "weighed_usable_grams" },
    "cultured butter": { quantity: 16, measuredInput: 100, measuredUsable: 100, evidenceRevision: 1, yieldBasis: "weighed_usable_grams" },
  },
};
const run: ChurchSandwichTimingRun = {
  id: "6ee07bdf-1737-4d7b-855e-34fc06840dc9", recordedAt, recordedByName: "Chef lead", recipeKey: "parisien", formulaRevision: 3,
  attempted: 3, accepted: 2, crewSize: 1, prepSeconds: null, buildSeconds: 181, packSeconds: 0,
  reference: "2026-11-14 bench A", note: "Stage wraps first",
};

function openForm() {
  fireEvent.click(screen.getByText("Record a timing run"));
  return within(screen.getByRole("form", { name: "Record sandwich timing run" }));
}

function set(form: ReturnType<typeof within>, title: string, value: string) {
  fireEvent.change(form.getByLabelText(title), { target: { value } });
}

function fill(form: ReturnType<typeof within>, signed = true) {
  set(form, "Sandwich", "parisien");
  if (signed) set(form, "Recipe basis", "3");
  set(form, "Sandwiches attempted", "3");
  set(form, "Sandwiches accepted", "2");
  set(form, "People on the run", "1");
  set(form, "Build (seconds)", "181");
  set(form, "Pack (seconds)", "0");
  set(form, "Worksheet or batch reference", " 2026-11-14 bench A ");
  set(form, "Interruptions or next run change (optional)", "Stage wraps first");
}

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

it("validates observed counts, records current signed timing, and preserves measured zero versus blank", async () => {
  vi.mocked(recordChurchSandwichTimingRunAction).mockResolvedValue({ ok: true, mode: "live", persisted: true, data: run });
  render(<ChurchSandwichTimingPanel formulas={[formula]} runs={[]} canRecord />);
  expect(screen.getByText("No timing runs recorded.")).toBeTruthy();
  const form = openForm();
  fill(form);
  set(form, "Sandwiches accepted", "4");
  fireEvent.click(form.getByRole("button", { name: "Save timing run" }));
  expect(form.getByText(/accepted sandwiches up to the attempted count/)).toBeTruthy();
  expect(recordChurchSandwichTimingRunAction).not.toHaveBeenCalled();
  set(form, "Sandwiches accepted", "2");
  fireEvent.click(form.getByRole("button", { name: "Save timing run" }));
  expect(await form.findByText("Timing run recorded.")).toBeTruthy();
  expect(recordChurchSandwichTimingRunAction).toHaveBeenCalledExactlyOnceWith({
    requestId: expect.any(String), recipeKey: "parisien", formulaRevision: 3, attempted: 3, accepted: 2, crewSize: 1,
    prepSeconds: null, buildSeconds: 181, packSeconds: 0, reference: "2026-11-14 bench A", note: "Stage wraps first",
  });
  const summary = screen.getByText("2 of 3 accepted");
  fireEvent.click(summary);
  const history = within(summary.closest("details")!);
  expect(history.getByText("Signed recipe r3")).toBeTruthy();
  expect(history.getByText("Prep Unmeasured · Build 181 sec · Pack 0 sec")).toBeTruthy();
  expect(history.getByText(/Chef lead/).querySelector("time")?.dateTime).toBe(recordedAt);
  expect(history.getByText(/Run note · Stage wraps first/)).toBeTruthy();
});

it("requires a fresh recipe basis after signed evidence changes and keeps bench recordings explicit", async () => {
  const rehearsal = { ...run, formulaRevision: null };
  vi.mocked(recordChurchSandwichTimingRunAction).mockResolvedValue({ ok: true, mode: "live", persisted: true, data: rehearsal });
  const view = render(<ChurchSandwichTimingPanel formulas={[formula]} runs={[]} canRecord />);
  const form = openForm();
  fill(form);
  view.rerender(<ChurchSandwichTimingPanel formulas={[{ ...formula, current: false }]} runs={[]} canRecord />);
  expect(form.queryByRole("option", { name: /Current signed recipe/ })).toBeNull();
  fireEvent.click(form.getByRole("button", { name: "Save timing run" }));
  expect(form.getByText(/Choose the sandwich and current recipe basis/)).toBeTruthy();
  expect(recordChurchSandwichTimingRunAction).not.toHaveBeenCalled();
  set(form, "Recipe basis", "bench");
  fireEvent.click(form.getByRole("button", { name: "Save timing run" }));
  expect(await form.findByText("Timing run recorded.")).toBeTruthy();
  expect(recordChurchSandwichTimingRunAction).toHaveBeenCalledWith(expect.objectContaining({ formulaRevision: null }));
});

it("shows persisted history without a recording form for read-only staff", () => {
  render(<ChurchSandwichTimingPanel formulas={[]} runs={[run]} canRecord={false} />);
  expect(screen.queryByText("Record a timing run")).toBeNull();
  expect(screen.getByText("Signed recipe r3")).toBeTruthy();
  expect(screen.getByText("2 of 3 accepted")).toBeTruthy();
});

it("compares a complete solo build and pack run with its recipe's trial target", () => {
  const runs: ChurchSandwichTimingRun[] = [
    { ...run, accepted: 3, buildSeconds: 150, packSeconds: 30 },
    { ...run, id: "2", recipeKey: "verger", formulaRevision: null, accepted: 3, buildSeconds: 240, packSeconds: 31 },
    { ...run, id: "3", accepted: 3, packSeconds: null },
    { ...run, id: "4", accepted: 3, crewSize: 2 },
    { ...run, id: "5" },
  ];
  render(<ChurchSandwichTimingPanel formulas={[formula]} runs={runs} canRecord={false} />);

  const signed = within(screen.getAllByText("Signed recipe r3")[0].closest("details")!);
  expect(signed.getByText("Build and pack run average 60 sec per sandwich · Within 60 sec trial target")).toBeTruthy();
  const bench = within(screen.getByText("Bench rehearsal").closest("details")!);
  expect(bench.getByText("Build and pack run average 90.33 sec per sandwich · Above 90 sec trial target")).toBeTruthy();
  expect(screen.getAllByText(/Build and pack run average/)).toHaveLength(2);
});
