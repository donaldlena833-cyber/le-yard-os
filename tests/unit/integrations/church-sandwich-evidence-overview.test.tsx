// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChurchSandwichEvidenceOverview } from "@/components/kitchen/church-sandwich-evidence-overview";
import type { ChurchSandwichFormula } from "@/lib/kitchen/church-sandwich-formula";

afterEach(cleanup);

it("propagates shared ingredient revisions and holds to the affected sandwiches", () => {
  render(<ChurchSandwichEvidenceOverview rows={[
    { ingredientKey: "10-inch baguette", status: "reviewed", revision: 2 },
    { ingredientKey: "walnuts", status: "hold", revision: 1 },
    { ingredientKey: "Dijon", status: "reviewed", revision: 3 },
  ]} formulas={[]} canManage={false} />);

  const verger = within(screen.getByText("Le Verger").parentElement!);
  expect(verger.getByText("1 of 5 ingredient records reviewed")).toBeTruthy();
  expect(verger.getByText("Hold · walnuts")).toBeTruthy();
  expect(verger.getByText(/Pending · Brie, apple, honey/)).toBeTruthy();
  expect(verger.getByText("Chef sign-off pending")).toBeTruthy();

  const rustique = within(screen.getByText("Le Rustique").parentElement!);
  expect(rustique.getByText("2 of 6 ingredient records reviewed")).toBeTruthy();
  expect(rustique.getByText(/Reviewed revisions · 10-inch baguette r2, Dijon r3/)).toBeTruthy();
  expect(rustique.queryByText(/Hold/)).toBeNull();
  expect(screen.getByRole("link", { name: "Open batches" }).getAttribute("href")).toBe("#church-batch-queue-heading");
  expect(screen.queryByRole("link", { name: "Square allergen check" })).toBeNull();
});

it("requires the signed recipe and exact current label revisions to agree", () => {
  const portion = { quantity: 16, evidenceRevision: 2, measuredInput: 160, measuredUsable: 150, yieldBasis: "weighed_usable_grams" } as const;
  const formula: ChurchSandwichFormula = {
    recipeKey: "parisien", current: true, revision: 3, reviewReference: "Prep trial 1",
    reviewedAt: "2026-11-14T12:00:00Z", reviewerName: "Chef",
    measurements: {
      "10-inch baguette": { ...portion, quantity: 1, measuredInput: 6, measuredUsable: 6, yieldBasis: "whole_each" },
      "French-style ham": { ...portion, quantity: 72 },
      "cultured butter": portion,
    },
  };
  const rows = [
    { ingredientKey: "10-inch baguette", status: "reviewed", revision: 2 },
    { ingredientKey: "French-style ham", status: "reviewed", revision: 2 },
    { ingredientKey: "cultured butter", status: "reviewed", revision: 2 },
  ] as const;
  const ui = render(<ChurchSandwichEvidenceOverview rows={rows} formulas={[formula]} canManage />);
  const parisien = () => within(screen.getByText("Le Parisien").parentElement!);
  expect(parisien().getByText("Current signed recipe r3")).toBeTruthy();
  expect(screen.getByRole("link", { name: "Square allergen check" }).getAttribute("href")).toBe("#square-allergen-panel-title");

  ui.rerender(<ChurchSandwichEvidenceOverview rows={[{ ...rows[0], revision: 3 }, rows[1], rows[2]]} formulas={[formula]} canManage />);
  expect(parisien().getByText("Recipe needs re-signoff")).toBeTruthy();
  expect(parisien().queryByText(/Current signed recipe/)).toBeNull();

  ui.rerender(<ChurchSandwichEvidenceOverview rows={[{ ...rows[0], status: "hold" }, rows[1], rows[2]]} formulas={[formula]} canManage />);
  expect(parisien().getByText("Hold · 10-inch baguette")).toBeTruthy();
  expect(parisien().getByText("Recipe needs re-signoff")).toBeTruthy();

  ui.rerender(<ChurchSandwichEvidenceOverview rows={rows} formulas={[{ ...formula, current: false }]} canManage />);
  expect(parisien().getByText("Recipe needs re-signoff")).toBeTruthy();

  ui.rerender(<ChurchSandwichEvidenceOverview rows={rows} formulas={null} canManage />);
  expect(screen.getByRole("status").textContent).toContain("Recipe sign-offs are unavailable.");
  expect(parisien().queryByText("Chef sign-off pending")).toBeNull();
  expect(parisien().getByText("3 of 3 ingredient records reviewed")).toBeTruthy();
  expect(screen.queryByRole("link", { name: "Chef sign-off" })).toBeNull();
});
