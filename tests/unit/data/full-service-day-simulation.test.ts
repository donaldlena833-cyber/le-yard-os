import { afterEach, describe, expect, it, vi } from "vitest";

import { createSaturdayServiceWorkspace } from "@/lib/demo";
import { createFullServiceReservationModel } from "@/lib/reservations/demo";
import {
  advanceServiceRun,
  buildServiceScorecard,
  createServiceRun,
  createSyntheticPosFixture,
  fullServiceDayScenario,
  injectServiceEvent,
  pauseServiceRun,
  resetServiceRun,
  runServiceScenario,
  validateServiceScenario,
} from "@/lib/simulation/index.ts";

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("full-service-day-v1", () => {
  it("locks the full-day covers, floor, financials, and dinner menu mix", () => {
    const scenario = validateServiceScenario(fullServiceDayScenario);
    const soldDinner = scenario.menuLines.filter(
      (line) => line.servicePeriodId === "dinner" && line.disposition === "sale",
    );
    const quantity = (category: (typeof soldDinner)[number]["category"]) =>
      sum(
        soldDinner
          .filter((line) => line.category === category)
          .map((line) => line.quantity),
      );

    expect(scenario.expectations).toMatchObject({
      fullDayCovers: 96,
      grossSalesCents: 556_000,
      compsCents: 6_000,
      voidsCents: 4_000,
      netSalesCents: 546_000,
      cashSalesCents: 109_200,
      cardSalesCents: 436_800,
      tipsCents: 106_680,
      expectedClosingDrawerCents: 55_200,
    });
    expect(scenario.floor.assignments).toHaveLength(17);
    expect(scenario.checkpoints).toHaveLength(9);
    expect(sum(scenario.floor.assignments.map((item) => item.partySize))).toBe(60);
    expect(quantity("main")).toBe(60);
    expect(quantity("starter")).toBe(30);
    expect(quantity("dessert")).toBe(24);
    expect(quantity("beverage")).toBe(72);
  });

  it("emits exact item-level checks, tenders, tips, recipe usage, and counts", () => {
    const fixture = createSyntheticPosFixture();
    expect(fixture.connectedProvider).toBeNull();
    expect(fixture.checks).toHaveLength(29);
    expect(sum(fixture.checks.map((check) => check.covers))).toBe(96);
    expect(sum(fixture.checks.map((check) => check.grossSalesCents))).toBe(556_000);
    expect(sum(fixture.checks.map((check) => check.netSalesCents))).toBe(546_000);
    expect(sum(fixture.checks.map((check) => check.cashSalesCents))).toBe(109_200);
    expect(sum(fixture.checks.map((check) => check.cardSalesCents))).toBe(436_800);
    expect(
      sum(
        fixture.checks.map(
          (check) => check.cashTipsCents + check.cardTipsCents,
        ),
      ),
    ).toBe(106_680);
    expect(
      fixture.inventoryExpectations.every(
        (item) =>
          item.startingQuantity -
            item.recipeConsumptionQuantity -
            item.wasteQuantity ===
            item.finalCountQuantity && item.finalCountQuantity >= 0,
      ),
    ).toBe(true);
    expect(fixture.waste).toHaveLength(2);
  });

  it("runs ten deterministic isolated replays without state leakage", () => {
    const scorecards = Array.from({ length: 10 }, (_, index) => {
      const run = runServiceScenario(`replay-${String(index + 1).padStart(2, "0")}`);
      return buildServiceScorecard(run);
    });

    expect(scorecards.every((scorecard) => scorecard.localStatus === "passed")).toBe(true);
    expect(scorecards.every((scorecard) => scorecard.releaseStatus === "blocked")).toBe(true);
    expect(new Set(scorecards.map((scorecard) => scorecard.runId)).size).toBe(10);
    expect(
      scorecards.every(
        (scorecard) =>
          scorecard.eventSummary.total === fullServiceDayScenario.events.length &&
          scorecard.eventSummary.failed === 0,
      ),
    ).toBe(true);
    expect(
      scorecards.every((scorecard) =>
        scorecard.checks.some(
          (check) => check.id === "scenario-checkpoints" && check.status === "passed",
        ),
      ),
    ).toBe(true);
  });

  it("supports ordered pause, advance, inject, and exact-run reset controls", () => {
    const seeded = createServiceRun("control-run");
    const advanced = advanceServiceRun(
      seeded,
      "2026-04-18T10:00:00-04:00",
    );
    expect(advanced.ledger.map((entry) => entry.eventId)).toEqual([
      "receiving-exception",
      "opening-checklists",
    ]);
    expect(pauseServiceRun(advanced).status).toBe("paused");
    const next = injectServiceEvent(advanced, "lunch-preshift");
    expect(next.ledger.at(-1)?.eventId).toBe("lunch-preshift");
    expect(resetServiceRun(next, "control-run").ledger).toEqual([]);
    expect(() => resetServiceRun(next, "different-run")).toThrow(/exact synthetic run/i);
    expect(() => injectServiceEvent(advanced, "dinner-wave-1")).toThrow(
      /deterministic event order/i,
    );
  });

  it("projects 60 seated covers across all 17 authoritative Host tables", () => {
    const model = createFullServiceReservationModel();
    expect(model.metrics).toMatchObject({ covers: 60, seated: 60, remaining: 0 });
    expect(model.floorNow.tables).toHaveLength(17);
    expect(model.floorNow.tables.every((table) => table.state === "occupied")).toBe(true);
    expect(new Set(model.floorNow.activeAllocations.map((item) => item.tableId)).size).toBe(17);
    expect(model.reservations.filter((item) => item.status === "no_show")).toHaveLength(1);
    expect(model.reservations.filter((item) => item.source === "walk_in")).toHaveLength(1);
    expect(model.pacing.map((bucket) => bucket.covers)).toEqual([12, 12, 12, 12, 12]);
  });

  it("uses the canonical fixture in Income and the working daily closeout", async () => {
    vi.stubEnv("NEXT_PUBLIC_SERVICE_SIMULATION", "full-service-day-v1");
    vi.resetModules();
    const { createDemoIncomeModel } = await import("@/lib/income/model");
    const income = createDemoIncomeModel();
    const workspace = createSaturdayServiceWorkspace();
    const closeout = workspace.closeouts[0]!;

    expect(income.current).toMatchObject({
      liveGrossSalesCents: 556_000,
      liveNetSalesCents: 546_000,
      salesCovers: 96,
      salesCheckCount: 29,
    });
    expect(income.sources[0]?.label).toBe("Synthetic POS check adapter");
    expect(sum(income.hourly.map((bucket) => bucket.laborMinutes))).toBe(
      income.current.laborMinutes,
    );
    expect(sum(income.hourly.map((bucket) => bucket.revenueCents))).toBe(
      income.current.liveNetSalesCents,
    );
    expect(sum(income.hourly.map((bucket) => bucket.checkCount))).toBe(
      income.current.salesCheckCount,
    );
    expect(income.hourly[23]?.revenueCents).toBe(0);
    expect(closeout).toMatchObject({
      businessDate: "2026-04-18",
      covers: 96,
      grossSalesCents: 556_000,
      netSalesCents: 546_000,
      cashSalesCents: 109_200,
      cardSalesCents: 436_800,
      expectedCashCents: 55_200,
      actualCashCents: 55_200,
      approvedBy: null,
    });
  });

  it("ties every event to audit evidence and a numbered phase screenshot", () => {
    const run = runServiceScenario("evidence-run");
    expect(run.ledger).toHaveLength(fullServiceDayScenario.events.length);
    expect(
      run.ledger.every(
        (entry) =>
          entry.auditEvidenceIds.length >= 2 &&
          /^0[1-8]-.+\.png$/.test(entry.screenshotRef ?? ""),
      ),
    ).toBe(true);
  });
});
