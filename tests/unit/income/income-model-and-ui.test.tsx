// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { IncomeWorkspace } from "@/components/income/income-workspace";
import { readSuccess } from "@/data/read-models/shared";
import {
  createDemoIncomeModel,
  parseIncomeOperatingModel,
} from "@/lib/income/model";
import {
  deriveIncomePlanningInsights,
  deriveIncomePlanningSummary,
} from "@/lib/income/insights";
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

  it("derives separate busy, staffing, and coverage evidence", () => {
    const [busy, staffing, coverage] = deriveIncomePlanningInsights(
      createDemoIncomeModel(),
    );
    expect(busy.kind).toBe("busy_hour");
    expect(busy.bucket?.hour).toBe(19);
    expect(busy.sampleDays).toBe(21);
    expect(staffing.kind).toBe("staffed_without_demand");
    expect(staffing.buckets.map((bucket) => bucket.hour)).toEqual([15]);
    expect(coverage.kind).toBe("data_coverage");
    expect(coverage.currentSourceCount).toBe(3);
    expect(coverage.issues.map((source) => source.key)).toEqual(["closeouts"]);
  });

  it("falls back to reservation demand without treating missing sales as zero", () => {
    const demo = createDemoIncomeModel();
    demo.hourly = demo.hourly.map((bucket) => ({
      ...bucket,
      revenueCents: 0,
      salesSampleDays: 0,
    }));
    demo.sources[0] = {
      ...demo.sources[0],
      lastObservedAt: null,
      recordCount: 0,
      freshness: "unavailable",
    };

    const [busy] = deriveIncomePlanningInsights(demo);
    expect(busy.basis).toBe("reserved_covers");
    expect(busy.bucket?.hour).toBe(19);
    expect(busy.sourceFreshness).toBeNull();
    expect(busy.sampleDays).toBe(28);
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

  it("renders evidence beside permission-aware planning actions", () => {
    render(
      <IncomeWorkspace
        result={readSuccess(createDemoIncomeModel())}
        locationName="Le Yard"
        actionAccess={{
          canManageSchedule: true,
          canViewSchedule: true,
          canOpenTimeClock: true,
          canManageIntegrations: false,
        }}
        demo
      />,
    );

    expect(
      screen.getByRole("heading", { name: "Planning insights" }),
    ).toBeTruthy();
    expect(screen.getByText(/7 PM is the busiest observed hour/i)).toBeTruthy();
    expect(screen.getByText(/21 observed sales day/i)).toBeTruthy();
    expect(
      screen.getByRole("link", { name: /Plan coverage/i }).getAttribute("href"),
    ).toBe("/schedule");
    expect(
      screen.getByText(/An integrations manager can resolve source coverage/i),
    ).toBeTruthy();
    expect(screen.queryByRole("link", { name: /Review sources/i })).toBeNull();
  });

  it("offers review-only destinations without implying edit authority", () => {
    render(
      <IncomeWorkspace
        result={readSuccess(createDemoIncomeModel())}
        locationName="Le Yard"
        actionAccess={{
          canManageSchedule: false,
          canViewSchedule: true,
          canOpenTimeClock: true,
          canManageIntegrations: true,
        }}
        demo
      />,
    );

    expect(
      screen
        .getByRole("link", { name: /Review schedule/i })
        .getAttribute("href"),
    ).toBe("/schedule");
    expect(
      screen
        .getByRole("link", { name: /Review time clock/i })
        .getAttribute("href"),
    ).toBe("/time-clock");
    expect(
      screen
        .getByRole("link", { name: /Review sources/i })
        .getAttribute("href"),
    ).toBe("/integrations");
    expect(screen.queryByRole("link", { name: /Plan coverage/i })).toBeNull();
  });
});
