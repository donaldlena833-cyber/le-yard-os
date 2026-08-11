// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IncomeWorkspace } from "@/components/income/income-workspace";
import { readSuccess } from "@/data/read-models/shared";
import {
  createDemoIncomeModel,
  parseIncomeOperatingModel,
} from "@/lib/income/model";
import { deriveIncomePlanningSummary } from "@/lib/income/insights";
import type { Json } from "@/types/database.generated";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: vi.fn() }),
}));

afterEach(cleanup);

describe("income operating model", () => {
  it("accepts the bounded 24-hour contract and derives source freshness", () => {
    const demo = createDemoIncomeModel();
    const parsed = parseIncomeOperatingModel(
      JSON.parse(JSON.stringify(demo)) as Json,
    );
    expect(parsed?.hourly).toHaveLength(24);
    expect(
      parsed?.sources.find((source) => source.key === "sales_checks")
        ?.freshness,
    ).toBe("current");
  });

  it("fails closed when an hour is missing", () => {
    const demo = createDemoIncomeModel();
    demo.hourly.pop();
    expect(
      parseIncomeOperatingModel(JSON.parse(JSON.stringify(demo)) as Json),
    ).toBeNull();
  });

  it("ranks comparable per-day revenue without blending dollars and covers", () => {
    const demo = createDemoIncomeModel();
    demo.hourly[17] = {
      ...demo.hourly[17],
      revenueCents: 100_000,
      salesSampleDays: 10,
    };
    demo.hourly[18] = {
      ...demo.hourly[18],
      revenueCents: 20_000,
      salesSampleDays: 1,
    };
    const summary = deriveIncomePlanningSummary(demo);
    expect(summary.basis).toBe("recorded_revenue");
    expect(summary.busiest?.bucket.hour).toBe(18);
    expect(summary.busiest?.average).toBe(20_000);
  });
});

describe("IncomeWorkspace", () => {
  it("labels partial contribution and cost grains without calling them profit", () => {
    render(
      <IncomeWorkspace
        result={readSuccess(createDemoIncomeModel())}
        locationName="Le Yard"
        demo
      />,
    );
    expect(screen.getByRole("heading", { name: "Income" })).toBeTruthy();
    expect(screen.getByText("Tracked contribution")).toBeTruthy();
    expect(screen.getByText(/not profit/i)).toBeTruthy();
    expect(
      screen.getByText(/Purchase receipt cost, not same-day COGS/i),
    ).toBeTruthy();
    expect(
      screen.getByRole("list", { name: /Hourly revenue profile/i }),
    ).toBeTruthy();

    const hour = screen.getByRole("listitem", {
      name: /6 PM:.*Open hour details/i,
    });
    fireEvent.click(hour);
    expect(
      screen.getByRole("dialog", { name: "6 PM operating detail" }),
    ).toBeTruthy();
    fireEvent.keyDown(document, { key: "Escape" });
    expect(document.activeElement).toBe(hour);
  });

  it("does not turn unavailable live sales into zero revenue", () => {
    const model = createDemoIncomeModel();
    model.current.liveNetSalesCents = null;
    model.current.liveGrossSalesCents = null;
    model.current.trackedContributionCents = null;
    model.sources[0] = {
      ...model.sources[0],
      lastObservedAt: null,
      recordCount: 0,
      freshness: "unavailable",
    };
    render(
      <IncomeWorkspace
        result={readSuccess(model)}
        locationName="Le Yard"
        demo
      />,
    );
    expect(screen.getByText("Live sales unavailable")).toBeTruthy();
    expect(
      screen.getByText(/real-time revenue source is not connected/i),
    ).toBeTruthy();
    expect(screen.getAllByText("—").length).toBeGreaterThan(0);
  });
});
