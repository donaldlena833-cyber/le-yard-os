// @vitest-environment jsdom
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChurchSandwichEvidenceOverview } from "@/components/kitchen/church-sandwich-evidence-overview";

afterEach(cleanup);

it("propagates shared ingredient revisions and holds to the affected sandwiches", () => {
  render(<ChurchSandwichEvidenceOverview rows={[
    { ingredientKey: "10-inch baguette", status: "reviewed", revision: 2 },
    { ingredientKey: "walnuts", status: "hold", revision: 1 },
    { ingredientKey: "Dijon", status: "reviewed", revision: 3 },
  ]} />);

  const verger = within(screen.getByText("Le Verger").parentElement!);
  expect(verger.getByText("1 of 5 ingredient records reviewed")).toBeTruthy();
  expect(verger.getByText("Hold · walnuts")).toBeTruthy();
  expect(verger.getByText(/Pending · Brie, apple, honey/)).toBeTruthy();

  const rustique = within(screen.getByText("Le Rustique").parentElement!);
  expect(rustique.getByText("2 of 6 ingredient records reviewed")).toBeTruthy();
  expect(rustique.getByText(/Reviewed revisions · 10-inch baguette r2, Dijon r3/)).toBeTruthy();
  expect(rustique.queryByText(/Hold/)).toBeNull();
});
