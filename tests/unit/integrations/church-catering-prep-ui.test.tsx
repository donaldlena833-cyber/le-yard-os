// @vitest-environment jsdom

import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChurchCateringPrep } from "@/components/kitchen/church-catering-prep";
import type { ChurchCateringPrepDay } from "@/lib/kitchen/church-catering-prep";
import type { ChurchAvailabilityRecipe } from "@/lib/kitchen/church-sandwich-availability";

const day: ChurchCateringPrepDay = {
  serviceDate: "2026-11-20",
  jobCount: 2,
  portions: { parisien: 2, verger: 1, bellecour: 0, bleu: 0, rustique: 0, figaro: 0 },
  packedPortions: { parisien: 1, verger: 0, bellecour: 0, bleu: 0, rustique: 0, figaro: 0 },
  remainingPortions: { parisien: 1, verger: 1, bellecour: 0, bleu: 0, rustique: 0, figaro: 0 },
};
const later: ChurchCateringPrepDay = { ...day, serviceDate: "2026-11-21", jobCount: 1 };
const parisien: ChurchAvailabilityRecipe = {
  key: "parisien", ingredients: { "10-inch baguette": 1, "French-style ham": 66.125, "cultured butter": 15 },
};
const verger: ChurchAvailabilityRecipe = {
  key: "verger", ingredients: { "10-inch baguette": 1, Brie: 42, apple: 36, walnuts: 13, honey: 8 },
};

afterEach(cleanup);

async function showWorksheet(approvedRecipes: readonly ChurchAvailabilityRecipe[] | null) {
  const worksheet = await ChurchCateringPrep({ data: Promise.resolve({ state: "ready", days: [day, later] }), approvedRecipes: Promise.resolve(approvedRecipes) });
  render(worksheet);
  const first = screen.getByText("Friday, November 20, 2026").closest("details")!;
  const second = screen.getByText("Saturday, November 21, 2026").closest("details")!;
  const bench = within(first).getByText("Bench estimate").closest("details")!;
  return { first, second, bench, day: within(first), trial: within(bench) };
}

it("shows only measured quantities in the open recipe worksheet and keeps trial quantities collapsed", async () => {
  const view = await showWorksheet([parisien, verger]);
  expect(view.first.open).toBe(true);
  expect(view.second.open).toBe(false);
  expect(view.bench.open).toBe(false);
  expect(view.first.querySelector("summary")?.textContent).toMatch(/3 published · 1 packed · 2 still to build · 2 jobs/);
  expect(view.day.getByRole("row", { name: "Le Parisien 2 1 1" })).toBeTruthy();
  expect(view.day.getByRole("row", { name: "Le Verger 1 0 1" })).toBeTruthy();
  const signed = within(view.day.getByText("Signed usable ingredient totals").parentElement!);
  expect(signed.getByText("66.125 g French-style ham")).toBeTruthy();
  expect(signed.getByText("2 × 10-inch baguettes")).toBeTruthy();
  expect(signed.queryByText("72 g French-style ham")).toBeNull();
  expect(view.trial.getByText("72 g French-style ham")).toBeTruthy();
  expect(view.trial.getByText(/Trial assembly time about 3 min/)).toBeTruthy();
});

it("names pending sandwich signoffs and withholds partial signed totals", async () => {
  const view = await showWorksheet([parisien]);
  const signed = within(view.day.getByText("Signed usable ingredient totals").parentElement!);
  expect(signed.getByText(/Chef signoff pending for Le Verger/)).toBeTruthy();
  expect(signed.queryByText(/66.125 g|72 g|baguettes/)).toBeNull();
  expect(view.trial.getByText(/Rehearsal only/)).toBeTruthy();
});

it("keeps service counts visible when the signed recipe read is unavailable", async () => {
  const view = await showWorksheet(null);
  const signed = within(view.day.getByText("Signed usable ingredient totals").parentElement!);
  expect(signed.getByText(/Signed recipe totals are unavailable/)).toBeTruthy();
  expect(view.day.getByRole("row", { name: "Le Parisien 2 1 1" })).toBeTruthy();
  expect(view.bench.open).toBe(false);
});

it("keeps fully packed days visible without requiring recipe data", async () => {
  const empty = { parisien: 0, verger: 0, bellecour: 0, bleu: 0, rustique: 0, figaro: 0 };
  const worksheet = await ChurchCateringPrep({
    data: Promise.resolve({
      state: "ready", days: [{ ...day, packedPortions: day.portions, remainingPortions: empty }],
    }),
    approvedRecipes: Promise.resolve(null),
  });
  render(worksheet);
  expect(screen.getByText(/3 published · 3 packed · 0 still to build/)).toBeTruthy();
  expect(screen.getByText(/All published sandwiches are packed/)).toBeTruthy();
  expect(screen.getByRole("row", { name: "Le Parisien 2 2 0" })).toBeTruthy();
  expect(screen.queryByText("Bench estimate")).toBeNull();
});
