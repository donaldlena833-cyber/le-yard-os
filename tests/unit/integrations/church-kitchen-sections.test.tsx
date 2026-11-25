// @vitest-environment jsdom

import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it, vi } from "vitest";
import { ChurchSandwichQuotedCosts, ChurchSandwichStandardPanel } from "@/components/kitchen/church-sandwich-standard-panel";
import { KitchenSection } from "@/components/kitchen/kitchen-section";

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", window.location.pathname);
});

it("opens only prep initially and keeps each sandwich collapsible", () => {
  const view = render(
    <>
      <KitchenSection title="Today’s prep" defaultOpen><p>No prep tasks today.</p></KitchenSection>
      <KitchenSection title="Sandwich recipes"><ChurchSandwichStandardPanel /></KitchenSection>
    </>,
  );

  const prep = view.container.querySelector<HTMLDetailsElement>("details")!;
  const recipesSummary = screen.getByText("Sandwich recipes", { selector: "summary" });
  const recipes = recipesSummary.closest("details")!;
  expect(prep.open).toBe(true);
  expect(recipes.open).toBe(false);

  fireEvent.click(recipesSummary);
  expect(recipes.open).toBe(true);
  expect(within(recipes).getAllByText(/^Le /, { selector: "summary" })).toHaveLength(6);
  const parisienSummary = within(recipes).getByText("Le Parisien", { selector: "summary" });
  const parisien = parisienSummary.closest("details")!;
  expect(parisien.open).toBe(false);

  fireEvent.click(parisienSummary);
  const table = within(parisien).getByRole("table", { name: "Le Parisien portions" });
  expect(within(table).getByRole("row", { name: /French-style ham 43 g 72 g/ })).toBeTruthy();

  fireEvent.click(parisienSummary);
  expect(parisien.open).toBe(false);
  expect(recipes.open).toBe(true);
});

it("opens the costs section when following its existing link", () => {
  const view = render(<KitchenSection title="Costs"><ChurchSandwichQuotedCosts /></KitchenSection>);
  const disclosure = view.container.querySelector<HTMLDetailsElement>("details")!;
  const target = document.getElementById("church-sandwich-costing-title")!;
  target.scrollIntoView = vi.fn();
  expect(disclosure.open).toBe(false);

  act(() => {
    window.history.replaceState(null, "", "#church-sandwich-costing-title");
    window.dispatchEvent(new HashChangeEvent("hashchange"));
  });
  expect(disclosure.open).toBe(true);
  expect(target.scrollIntoView).toHaveBeenCalledWith({ block: "start" });
  expect(within(target).getByRole("row", { name: /Le Parisien.*\$3\.03.*\$4\.88/ })).toBeTruthy();
});
