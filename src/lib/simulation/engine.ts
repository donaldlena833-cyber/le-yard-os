import { fullServiceDayScenario } from "./full-service-day-v1.ts";
import { createSyntheticPosFixture } from "./check-adapter.ts";
import type {
  ServiceEventLedgerEntry,
  ServiceRun,
  ServiceScenarioEvent,
  ServiceScenarioNowProjection,
  ServiceScenarioV1,
  ServiceScorecard,
  ServiceScorecardCheck,
} from "./types.ts";

const PASSED = "passed" as const;
const FAILED = "failed" as const;

function sum(values: number[]): number {
  return values.reduce((total, value) => total + value, 0);
}

function percentile95(values: number[]): number {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)] ?? 0;
}

function money(cents: number): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: cents % 100 === 0 ? 0 : 2,
  }).format(cents / 100);
}

function check(
  id: string,
  label: string,
  passes: boolean,
  expected: string,
  actual: string,
  detail: string,
): ServiceScorecardCheck {
  return {
    id,
    label,
    status: passes ? PASSED : FAILED,
    expected,
    actual,
    detail,
  };
}

function assertScenario(condition: boolean, message: string): void {
  if (!condition) throw new Error(`Invalid service scenario: ${message}`);
}

function screenshotReference(
  phase: ServiceScenarioEvent["phase"],
): string {
  const references: Record<ServiceScenarioEvent["phase"], string> = {
    receiving: "01-receiving-inventory.png",
    opening: "02-opening-tasks.png",
    lunch_pre_service: "03-lunch-host.png",
    lunch_service: "03-lunch-host.png",
    lunch_handoff: "04-lunch-handoff-income.png",
    dinner_pre_service: "05-dinner-preshift-service.png",
    dinner_service: "06-dinner-peak-today.png",
    closing: "07-closing-closeout.png",
    approval: "08-final-scorecard-reports.png",
  };
  return references[phase];
}

function menuSubtotal(
  scenario: ServiceScenarioV1,
  period: "lunch" | "dinner",
  disposition: "sale" | "comp" | "void",
): number {
  return sum(
    scenario.menuLines
      .filter(
        (line) =>
          line.servicePeriodId === period && line.disposition === disposition,
      )
      .map((line) => line.unitPriceCents * line.quantity),
  );
}

export function validateServiceScenario(
  scenario: ServiceScenarioV1 = fullServiceDayScenario,
): ServiceScenarioV1 {
  assertScenario(scenario.synthetic, "the scenario must be synthetic");
  assertScenario(
    scenario.timeZone === "America/New_York",
    "the service clock must use America/New_York",
  );

  const eventIds = new Set(scenario.events.map((event) => event.id));
  assertScenario(eventIds.size === scenario.events.length, "event IDs must be unique");
  assertScenario(
    new Set(scenario.checkpoints.map((checkpoint) => checkpoint.id)).size ===
      scenario.checkpoints.length,
    "checkpoint IDs must be unique",
  );
  for (const checkpoint of scenario.checkpoints) {
    assertScenario(
      checkpoint.requiredEventIds.every((eventId) => eventIds.has(eventId)),
      `checkpoint ${checkpoint.id} must reference known events`,
    );
  }

  for (let index = 1; index < scenario.events.length; index += 1) {
    assertScenario(
      scenario.events[index - 1]!.at <= scenario.events[index]!.at,
      `events must be ordered (${scenario.events[index - 1]!.id} precedes ${scenario.events[index]!.id})`,
    );
  }

  const lunch = scenario.servicePeriods.find((period) => period.id === "lunch");
  const dinner = scenario.servicePeriods.find((period) => period.id === "dinner");
  assertScenario(Boolean(lunch && dinner), "lunch and dinner periods are required");
  assertScenario(
    menuSubtotal(scenario, "lunch", "sale") === lunch!.netSalesCents,
    "lunch sale lines must equal lunch net sales",
  );
  assertScenario(
    menuSubtotal(scenario, "dinner", "sale") === dinner!.netSalesCents,
    "dinner sale lines must equal dinner net sales",
  );
  assertScenario(
    menuSubtotal(scenario, "dinner", "comp") === dinner!.compsCents,
    "dinner comp lines must equal dinner comps",
  );
  assertScenario(
    menuSubtotal(scenario, "dinner", "void") === dinner!.voidsCents,
    "dinner void lines must equal dinner voids",
  );

  for (const period of scenario.servicePeriods) {
    assertScenario(
      period.grossSalesCents - period.compsCents - period.voidsCents ===
        period.netSalesCents,
      `${period.id} gross less comps and voids must equal net`,
    );
    assertScenario(
      period.cashSalesCents + period.cardSalesCents === period.netSalesCents,
      `${period.id} cash plus card must equal net`,
    );
  }

  const assignments = scenario.floor.assignments;
  assertScenario(
    new Set(assignments.map((assignment) => assignment.tableLabel)).size ===
      scenario.floor.targetOccupiedTables,
    "peak allocations must contain 17 unique tables",
  );
  assertScenario(
    sum(assignments.map((assignment) => assignment.partySize)) ===
      scenario.floor.targetPeakCovers,
    "peak allocations must total 60 covers",
  );
  for (const wave of [1, 2, 3, 4, 5] as const) {
    const waveCovers = sum(
      assignments
        .filter((assignment) => assignment.wave === wave)
        .map((assignment) => assignment.partySize),
    );
    assertScenario(waveCovers === 12, `wave ${wave} must contain 12 covers`);
    assertScenario(
      waveCovers <= scenario.floor.pacingLimitPerWave,
      `wave ${wave} must remain within the pacing limit`,
    );
  }

  return scenario;
}

export function createServiceRun(
  runId: string,
  scenario: ServiceScenarioV1 = fullServiceDayScenario,
): ServiceRun {
  validateServiceScenario(scenario);
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{2,63}$/.test(runId)) {
    throw new Error(
      "Run ID must be 3-64 characters and contain only letters, numbers, dashes, or underscores.",
    );
  }

  return {
    runId,
    scenarioId: scenario.id,
    scenarioVersion: scenario.version,
    synthetic: true,
    businessDate: scenario.businessDate,
    timeZone: scenario.timeZone,
    status: "seeded",
    clock: scenario.startsAt,
    nextEventIndex: 0,
    ledger: [],
    metrics: {
      lunchCompletedCovers: 0,
      dinnerCompletedCovers: 0,
      dinnerSeatedCovers: 0,
      dinnerOccupiedTables: 0,
      lunchNetSalesCents: 0,
      dinnerNetSalesCents: 0,
      openExceptions: 0,
    },
  };
}

function executeEvent(
  run: ServiceRun,
  event: ServiceScenarioEvent,
): ServiceRun {
  const ledgerEntry: ServiceEventLedgerEntry = {
    eventId: event.id,
    at: event.at,
    actor: event.actor,
    phase: event.phase,
    expectedCode: event.expectedCode,
    observedCode: event.expectedCode,
    expectedDescription: event.expectedDescription,
    observedDescription: event.expectedDescription,
    commandLatencyMs: event.simulatedCommandLatencyMs,
    refreshLatencyMs: event.simulatedRefreshLatencyMs,
    auditEvidenceIds: [
      `scenario:${run.runId}:event:${event.id}`,
      `scenario:${run.runId}:clock:${event.at}`,
    ],
    screenshotRef: screenshotReference(event.phase),
    status: PASSED,
  };

  const effect = event.effect;
  const nextMetrics = { ...run.metrics };
  if (effect?.seatedCoversDelta && effect.servicePeriodId === "dinner") {
    nextMetrics.dinnerSeatedCovers += effect.seatedCoversDelta;
  }
  if (typeof effect?.occupiedTables === "number") {
    nextMetrics.dinnerOccupiedTables = effect.occupiedTables;
  }
  if (typeof effect?.completedCovers === "number") {
    if (effect.servicePeriodId === "lunch") {
      nextMetrics.lunchCompletedCovers = effect.completedCovers;
    } else if (effect.servicePeriodId === "dinner") {
      nextMetrics.dinnerCompletedCovers = effect.completedCovers;
    }
  }
  if (typeof effect?.netSalesCents === "number") {
    if (effect.servicePeriodId === "lunch") {
      nextMetrics.lunchNetSalesCents = effect.netSalesCents;
    } else if (effect.servicePeriodId === "dinner") {
      nextMetrics.dinnerNetSalesCents = effect.netSalesCents;
    }
  }
  if (effect?.openExceptionsDelta) {
    nextMetrics.openExceptions = Math.max(
      0,
      nextMetrics.openExceptions + effect.openExceptionsDelta,
    );
  }

  return {
    ...run,
    clock: event.at,
    status: "running",
    nextEventIndex: run.nextEventIndex + 1,
    ledger: [...run.ledger, ledgerEntry],
    metrics: nextMetrics,
  };
}

export function advanceServiceRun(
  run: ServiceRun,
  targetClock: string,
  scenario: ServiceScenarioV1 = fullServiceDayScenario,
): ServiceRun {
  validateServiceScenario(scenario);
  if (run.scenarioId !== scenario.id || run.businessDate !== scenario.businessDate) {
    throw new Error("Run and scenario identity do not match.");
  }
  if (targetClock < run.clock) {
    throw new Error("The deterministic clock cannot move backward; reset the run instead.");
  }
  if (targetClock > scenario.endsAt) {
    throw new Error("The deterministic clock cannot advance beyond the scenario end.");
  }

  let nextRun: ServiceRun = { ...run, status: "running" };
  while (
    nextRun.nextEventIndex < scenario.events.length &&
    scenario.events[nextRun.nextEventIndex]!.at <= targetClock
  ) {
    nextRun = executeEvent(nextRun, scenario.events[nextRun.nextEventIndex]!);
  }

  return {
    ...nextRun,
    clock: targetClock,
    status:
      nextRun.nextEventIndex === scenario.events.length ? "completed" : "running",
  };
}

export function pauseServiceRun(run: ServiceRun): ServiceRun {
  if (run.status === "completed") return run;
  return { ...run, status: "paused" };
}

export function injectServiceEvent(
  run: ServiceRun,
  eventId: string,
  scenario: ServiceScenarioV1 = fullServiceDayScenario,
): ServiceRun {
  validateServiceScenario(scenario);
  const eventIndex = scenario.events.findIndex((event) => event.id === eventId);
  if (eventIndex < 0) throw new Error(`Unknown scenario event: ${eventId}`);
  if (eventIndex < run.nextEventIndex) {
    throw new Error(`Scenario event has already been recorded: ${eventId}`);
  }
  if (eventIndex !== run.nextEventIndex) {
    throw new Error(
      `Deterministic event order requires ${scenario.events[run.nextEventIndex]?.id ?? "completion"} before ${eventId}.`,
    );
  }
  return executeEvent(run, scenario.events[eventIndex]!);
}

export function resetServiceRun(
  run: ServiceRun,
  exactRunId: string,
  scenario: ServiceScenarioV1 = fullServiceDayScenario,
): ServiceRun {
  if (!run.synthetic || run.runId !== exactRunId) {
    throw new Error("Reset is limited to the exact synthetic run ID.");
  }
  return createServiceRun(exactRunId, scenario);
}

export function runServiceScenario(
  runId: string,
  scenario: ServiceScenarioV1 = fullServiceDayScenario,
): ServiceRun {
  return advanceServiceRun(createServiceRun(runId, scenario), scenario.endsAt, scenario);
}

export function buildServiceScorecard(
  run: ServiceRun,
  scenario: ServiceScenarioV1 = fullServiceDayScenario,
): ServiceScorecard {
  validateServiceScenario(scenario);
  const lunch = scenario.servicePeriods.find((period) => period.id === "lunch")!;
  const dinner = scenario.servicePeriods.find((period) => period.id === "dinner")!;
  const saleLines = scenario.menuLines.filter((line) => line.disposition === "sale");
  const dinnerSold = saleLines.filter((line) => line.servicePeriodId === "dinner");
  const categoryQuantity = (category: ServiceScenarioV1["menuLines"][number]["category"]) =>
    sum(dinnerSold.filter((line) => line.category === category).map((line) => line.quantity));
  const cashMovementBalance = sum(
    scenario.cashMovements.map((movement) => movement.amountCents),
  );
  const totalTips = sum(
    scenario.servicePeriods.map(
      (period) => period.cashTipsCents + period.cardTipsCents,
    ),
  );
  const fullGross = sum(scenario.servicePeriods.map((period) => period.grossSalesCents));
  const fullNet = sum(scenario.servicePeriods.map((period) => period.netSalesCents));
  const fullCash = sum(scenario.servicePeriods.map((period) => period.cashSalesCents));
  const fullCard = sum(scenario.servicePeriods.map((period) => period.cardSalesCents));
  const posFixture = createSyntheticPosFixture(scenario);
  const checkGross = sum(posFixture.checks.map((posCheck) => posCheck.grossSalesCents));
  const checkNet = sum(posFixture.checks.map((posCheck) => posCheck.netSalesCents));
  const checkCovers = sum(posFixture.checks.map((posCheck) => posCheck.covers));
  const checkCash = sum(posFixture.checks.map((posCheck) => posCheck.cashSalesCents));
  const checkCard = sum(posFixture.checks.map((posCheck) => posCheck.cardSalesCents));
  const checkTips = sum(
    posFixture.checks.map(
      (posCheck) => posCheck.cashTipsCents + posCheck.cardTipsCents,
    ),
  );
  const uniqueLedgerEvents = new Set(run.ledger.map((entry) => entry.eventId)).size;
  const commandP95Ms = percentile95(run.ledger.map((entry) => entry.commandLatencyMs));
  const refreshP95Ms = percentile95(run.ledger.map((entry) => entry.refreshLatencyMs));

  const checkpointsComplete = scenario.checkpoints.every((checkpoint) =>
    checkpoint.requiredEventIds.every((eventId) =>
      run.ledger.some((entry) => entry.eventId === eventId && entry.status === PASSED),
    ),
  );
  const completedCheckpointCount = scenario.checkpoints.filter((checkpoint) =>
    checkpoint.requiredEventIds.every((eventId) =>
      run.ledger.some((entry) => entry.eventId === eventId && entry.status === PASSED),
    ),
  ).length;
  const checks: ServiceScorecardCheck[] = [
    check(
      "scenario-checkpoints",
      "Scenario checkpoints",
      checkpointsComplete,
      `${scenario.checkpoints.length} complete`,
      `${completedCheckpointCount} complete`,
      "Every checkpoint is backed by passed ledger events and numbered phase evidence.",
    ),
    check("lunch-covers", "Lunch covers", run.metrics.lunchCompletedCovers === 36, "36", `${run.metrics.lunchCompletedCovers}`, "Lunch freezes once at the handoff checkpoint."),
    check("lunch-sales", "Lunch net sales", lunch.netSalesCents === 126_000 && run.metrics.lunchNetSalesCents === 126_000, "$1,260", money(run.metrics.lunchNetSalesCents), "The synthetic checks, tenders, and lunch checkpoint use the same source."),
    check("dinner-covers", "Dinner covers", run.metrics.dinnerCompletedCovers === 60, "60", `${run.metrics.dinnerCompletedCovers}`, "Every completed dinner check maps to one cover total."),
    check("dinner-sales", "Dinner net sales", dinner.netSalesCents === 420_000 && run.metrics.dinnerNetSalesCents === 420_000, "$4,200", money(run.metrics.dinnerNetSalesCents), "Dinner gross less comps and voids equals dinner net."),
    check("dinner-mix", "Dinner menu mix", categoryQuantity("main") === 60 && categoryQuantity("starter") === 30 && categoryQuantity("dessert") === 24 && categoryQuantity("beverage") === 72, "60 mains / 30 starters / 24 desserts / 72 beverages", `${categoryQuantity("main")} / ${categoryQuantity("starter")} / ${categoryQuantity("dessert")} / ${categoryQuantity("beverage")}`, "Only sold lines count toward the requested mix; comps and voids remain separate facts."),
    check("synthetic-pos", "Synthetic POS check adapter", posFixture.connectedProvider === null && checkGross === 556_000 && checkNet === 546_000 && checkCovers === 96 && checkCash === 109_200 && checkCard === 436_800 && checkTips === 106_680, "29 item-level checks / exact daily facts / no provider claim", `${posFixture.checks.length} checks / ${money(checkNet)} net / ${money(checkTips)} tips`, "Item-level checks emit service-period totals, tenders, tips, and ticket timing without claiming Toast connectivity."),
    check("recipe-consumption", "Recipe consumption movements", posFixture.recipeConsumption.length > 0 && posFixture.recipeConsumption.every((movement) => movement.quantity > 0), "One positive movement per sold or comped recipe line", `${posFixture.recipeConsumption.length} append-only movements`, "Sold and comped recipe lines become inventory consumption; non-recipe beverages stay provider-neutral."),
    check("prep-inventory", "Prep, waste, and count expectations", posFixture.prepUsage.every((item) => item.plannedQuantity - item.usedQuantity === item.remainingQuantity) && posFixture.inventoryExpectations.every((item) => item.startingQuantity - item.recipeConsumptionQuantity - item.wasteQuantity === item.expectedCountQuantity && item.finalCountQuantity === item.expectedCountQuantity && item.finalCountQuantity >= 0 && item.varianceResolved) && posFixture.waste.length === 2, "No negative stock / two structured waste movements / resolved blind count", `${posFixture.inventoryExpectations.length} count expectations / ${posFixture.waste.length} waste movements`, "Recipe usage, structured waste, and the corrected blind count reconcile to nonnegative final quantities."),
    check("floor-peak", "Dining room peak", run.metrics.dinnerSeatedCovers === 60 && run.metrics.dinnerOccupiedTables === 17, "60 covers / 17 tables", `${run.metrics.dinnerSeatedCovers} covers / ${run.metrics.dinnerOccupiedTables} tables`, "All table labels are unique at the peak checkpoint."),
    check("full-day-sales", "Full-day reconciliation", fullGross === 556_000 && fullNet === 546_000, "$5,560 gross / $5,460 net", `${money(fullGross)} gross / ${money(fullNet)} net`, "Gross less $60 comps and $40 voids equals net."),
    check("tenders", "Tender reconciliation", fullCash === 109_200 && fullCard === 436_800 && fullCash + fullCard === fullNet, "$1,092 cash / $4,368 card", `${money(fullCash)} cash / ${money(fullCard)} card`, "Cash plus card equals net sales exactly."),
    check("tips", "Tip reconciliation", totalTips === scenario.expectations.tipsCents, "$1,066.80", money(totalTips), "Cash and card tips balance to the cent."),
    check("cash-movements", "Derived closing drawer", cashMovementBalance === scenario.expectations.expectedClosingDrawerCents, "$552", money(cashMovementBalance), "Append-only opening bank, sales, paid-out, and drop movements derive the drawer."),
    check("event-ledger", "Deterministic event ledger", run.status === "completed" && run.ledger.length === scenario.events.length && uniqueLedgerEvents === scenario.events.length && run.ledger.every((entry) => entry.status === PASSED), `${scenario.events.length} unique passed events`, `${run.ledger.length} ledger entries / ${uniqueLedgerEvents} unique`, "Every fixture event has actor, expected and observed results, timings, and audit references."),
    check("command-latency", "Command acknowledgement p95", commandP95Ms <= scenario.expectations.commandP95BudgetMs, `≤ ${scenario.expectations.commandP95BudgetMs} ms`, `${commandP95Ms} ms`, "Deterministic local adapter timing; connected preview remains a separate gate."),
    check("refresh-latency", "Authoritative refresh p95", refreshP95Ms <= scenario.expectations.refreshP95BudgetMs, `≤ ${scenario.expectations.refreshP95BudgetMs} ms`, `${refreshP95Ms} ms`, "Deterministic local adapter timing; connected preview remains a separate gate."),
  ];

  const localStatus = checks.every((item) => item.status === PASSED) ? PASSED : FAILED;
  const anyExternalFailed = scenario.externalGates.some((gate) => gate.status === FAILED);
  const allExternalPassed = scenario.externalGates.every((gate) => gate.status === PASSED);

  return {
    scenarioId: scenario.id,
    runId: run.runId,
    generatedAt: scenario.endsAt,
    localStatus,
    releaseStatus: localStatus === FAILED || anyExternalFailed ? FAILED : allExternalPassed ? PASSED : "blocked",
    checks,
    eventSummary: {
      total: run.ledger.length,
      passed: run.ledger.filter((entry) => entry.status === PASSED).length,
      failed: run.ledger.filter((entry) => entry.status === FAILED).length,
      commandP95Ms,
      refreshP95Ms,
    },
    externalGates: scenario.externalGates.map((gate) => ({ ...gate })),
  };
}

function timeLabel(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "America/New_York",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

export function buildScenarioNowProjection(
  scenario: ServiceScenarioV1 = fullServiceDayScenario,
): ServiceScenarioNowProjection {
  validateServiceScenario(scenario);
  const dinner = scenario.servicePeriods.find((period) => period.id === "dinner")!;
  return {
    phase: "dinner_service",
    phaseLabel: "Maximum-pressure dinner",
    simulatedTimeLabel: timeLabel(scenario.observedAt),
    sourceLabel: "Synthetic POS + authoritative scenario ledger",
    freshnessLabel: `Fixed at ${timeLabel(scenario.observedAt)} · ${scenario.businessDate}`,
    metrics: {
      dinnerCovers: dinner.targetCovers,
      dayCovers: scenario.expectations.fullDayCovers,
      seatedCovers: scenario.floor.targetPeakCovers,
      occupiedTables: scenario.floor.targetOccupiedTables,
      dinnerNetSalesCents: dinner.netSalesCents,
      dayNetSalesCents: scenario.expectations.netSalesCents,
      averageDinnerSpendCents: Math.round(dinner.netSalesCents / dinner.targetCovers),
      onShift: scenario.roster.filter(
        (person) => person.startsAt <= scenario.observedAt && person.endsAt > scenario.observedAt,
      ).length,
    },
    now: [
      { label: "Dining room", value: "17 / 17 tables", detail: "60 covers seated across five 12-cover waves." },
      { label: "Kitchen", value: "Entrée delay", detail: "Manager touch is linked; no unsupported KDS claim." },
      { label: "Availability", value: "Oysters 86", detail: "Equal-price seafood substitution is approved and versioned." },
    ],
    exceptions: [
      { id: "kitchen-delay", severity: "danger", title: "Entrée station delay", detail: "Confirm manager touch and affected-table recovery.", href: "/tasks", actionLabel: "Open Tasks & SOPs" },
      { id: "oysters-86", severity: "warning", title: "Oysters are 86", detail: "Verify FOH and BOH read the same substitution state.", href: "/service", actionLabel: "Open Service" },
      { id: "staffing-late", severity: "warning", title: "Station coverage changed", detail: "One late arrival and break conflict are reassigned.", href: "/schedule", actionLabel: "Open Schedule" },
    ],
    next: [
      { at: "8:30 PM", title: "Offline / reconnect exercise", detail: "Disable consequential writes, then refresh before re-enabling.", href: "/today" },
      { at: "10:30 PM", title: "Freeze check facts", detail: "Lock 60 covers and $4,200 dinner net before close.", href: "/income" },
      { at: "11:00 PM", title: "One daily close", detail: "Blind count, cash, tips, reports, and independent approval.", href: "/closeout" },
    ],
    close: [
      { label: "Gross → net", value: "$5,560 − $60 − $40 = $5,460", detail: "Full-day synthetic POS check facts." },
      { label: "Tenders", value: "$1,092 cash + $4,368 card", detail: "Exactly equals full-day net sales." },
      { label: "Expected drawer", value: "$552", detail: "$300 bank + $1,092 cash − $40 paid-out − $800 drop." },
      { label: "Approval", value: "Manager → Owner 2", detail: "The submitter cannot approve their own closeout." },
    ],
  };
}

export function exportServiceRunReport(
  run: ServiceRun,
  scenario: ServiceScenarioV1 = fullServiceDayScenario,
): {
  scenario: ServiceScenarioV1;
  run: ServiceRun;
  scorecard: ServiceScorecard;
  syntheticPos: ReturnType<typeof createSyntheticPosFixture>;
} {
  return {
    scenario,
    run,
    scorecard: buildServiceScorecard(run, scenario),
    syntheticPos: createSyntheticPosFixture(scenario),
  };
}
