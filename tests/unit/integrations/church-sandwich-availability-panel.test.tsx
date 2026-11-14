// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, expect, it } from "vitest";
import { ChurchSandwichAvailabilityPanel } from "@/components/kitchen/church-sandwich-availability-panel";
import type { ChurchCateringPrepDay } from "@/lib/kitchen/church-catering-prep";
import { churchAvailabilityBenchRecipes } from "@/lib/kitchen/church-sandwich-availability";

const date = "2026-11-14";
const fixture = { approvedRecipes: [], evidence: {}, catering: null, serviceDate: date };

function enterStock(label: RegExp, value: string) {
  fireEvent.change(screen.getByRole("textbox", { name: label }), { target: { value } });
}

function findLimit(sandwich: string) {
  const table = screen.getByRole("table", { name: "Stand-alone sandwich limits after published catering" });
  return within(within(table).getByRole("row", { name: new RegExp(sandwich) }));
}

function enterExtras(sandwich: string, value: string) {
  const extras = within(screen.getByRole("group", { name: "Extra café portions" }));
  fireEvent.change(extras.getByRole("textbox", { name: sandwich }), { target: { value } });
}

afterEach(cleanup);

it("keeps six limits pending until observed counts are entered and preserves a confirmed zero", () => {
  render(<ChurchSandwichAvailabilityPanel {...fixture} />);
  expect((screen.getByRole("radio", { name: "Bench rehearsal" }) as HTMLInputElement).checked).toBe(true);
  expect(screen.getByText(/No approved recipes are available.*draft recipes/)).toBeTruthy();
  expect(within(screen.getByRole("table")).getAllByText("Pending")).toHaveLength(6);
  fireEvent.click(screen.getByText("Enter usable stock"));
  expect((screen.getByRole("textbox", { name: /10-inch baguette/ }) as HTMLInputElement).value).toBe("");
  enterStock(/10-inch baguette/, "0");
  enterStock(/French-style ham/, "144");
  enterStock(/cultured butter/, "32");
  const parisien = findLimit("Le Parisien");
  expect(parisien.getByText("0")).toBeTruthy();
  expect(parisien.getByText("10-inch baguette")).toBeTruthy();
  enterStock(/10-inch baguette/, "1.5");
  expect(parisien.getByText("Pending")).toBeTruthy();
  expect(screen.getByText("Enter a whole count from 0 to 1,000,000.")).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Approved recipes" }));
  expect(parisien.getByText("Approved recipe and yield needed.")).toBeTruthy();
});

it("subtracts published catering once and checks shared stock across extra café portions", () => {
  const catering: ChurchCateringPrepDay = {
    serviceDate: date,
    jobCount: 1,
    portions: { parisien: 1, verger: 0, bellecour: 0, bleu: 0, rustique: 0, figaro: 0 },
  };
  render(<ChurchSandwichAvailabilityPanel {...fixture} catering={catering} />);
  expect(screen.getByText("Le Parisien · 1")).toBeTruthy();
  fireEvent.click(screen.getByText("Enter usable stock"));
  fireEvent.click(screen.getByText("Check a combined sandwich mix"));
  expect(screen.getByRole("status").textContent).toMatch(/Rehearsal · Pending/);
  enterStock(/10-inch baguette/, "2");
  enterStock(/French-style ham/, "144");
  enterStock(/cultured butter/, "32");
  enterStock(/Brie/, "45");
  enterStock(/apple/, "40");
  enterStock(/walnuts/, "14");
  enterStock(/honey/, "8");
  expect(findLimit("Le Parisien").getByText("1")).toBeTruthy();
  expect(findLimit("Le Verger").getByText("1")).toBeTruthy();
  expect(screen.getByRole("status").textContent).toMatch(/Rehearsal · Fits entered stock/);

  enterExtras("Le Parisien", "1");
  enterExtras("Le Verger", "1");
  expect(screen.getByRole("status").textContent).toMatch(/Rehearsal · Short on stock/);
  const mix = screen.getByRole("table", { name: "Ingredients needed for the combined sandwich mix" });
  const baguettes = within(within(mix).getByRole("row", { name: /10-inch baguette/ }));
  expect(baguettes.getByText("3 each")).toBeTruthy();
  expect(baguettes.getByText("1 each")).toBeTruthy();
  enterStock(/10-inch baguette/, "0");
  expect(findLimit("Le Parisien").getByText(/Published catering needs more stock/)).toBeTruthy();
  enterExtras("Le Verger", "1000");
  expect(screen.getByRole("status").textContent).toMatch(/Correct the extra portion quantities/);
  expect(screen.queryByRole("table", { name: "Ingredients needed for the combined sandwich mix" })).toBeNull();
});

it("requires supplier review in approved mode and carries supplier holds into rehearsal", () => {
  render(<ChurchSandwichAvailabilityPanel {...fixture}
    approvedRecipes={[churchAvailabilityBenchRecipes[0]]}
    evidence={{ "French-style ham": "hold", "10-inch baguette": "reviewed" }}
  />);
  expect((screen.getByRole("radio", { name: "Approved recipes" }) as HTMLInputElement).checked).toBe(true);
  const parisien = findLimit("Le Parisien");
  expect(parisien.getByText(/Supplier evidence on hold · French-style ham/)).toBeTruthy();
  expect(parisien.getByText(/Supplier evidence needs review · cultured butter/)).toBeTruthy();
  fireEvent.click(screen.getByRole("radio", { name: "Bench rehearsal" }));
  expect(parisien.getByText(/Supplier evidence on hold · French-style ham/)).toBeTruthy();
  expect(parisien.queryByText(/Supplier evidence needs review/)).toBeNull();
});
