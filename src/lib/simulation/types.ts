export type ServiceScenarioPhase =
  | "receiving"
  | "opening"
  | "lunch_pre_service"
  | "lunch_service"
  | "lunch_handoff"
  | "dinner_pre_service"
  | "dinner_service"
  | "closing"
  | "approval";

export type ServiceScenarioSeverity = "info" | "warning" | "danger";

export type ServiceScenarioGateStatus =
  | "ready"
  | "passed"
  | "failed"
  | "blocked"
  | "not_tested";

export interface ServiceScenarioMenuLine {
  id: string;
  name: string;
  category: "main" | "starter" | "side" | "dessert" | "beverage";
  unitPriceCents: number;
  quantity: number;
  disposition: "sale" | "comp" | "void";
  servicePeriodId: "lunch" | "dinner";
  recipeId: string | null;
}

export interface ServiceScenarioServicePeriod {
  id: "lunch" | "dinner";
  label: string;
  startsAt: string;
  endsAt: string;
  targetCovers: number;
  peakCovers: number;
  grossSalesCents: number;
  compsCents: number;
  voidsCents: number;
  netSalesCents: number;
  cashSalesCents: number;
  cardSalesCents: number;
  cashTipsCents: number;
  cardTipsCents: number;
}

export interface ServiceScenarioTableAssignment {
  tableLabel: string;
  partySize: 2 | 4 | 6;
  wave: 1 | 2 | 3 | 4 | 5;
  startsAt: string;
  source: "web" | "phone" | "manual" | "walk_in";
  guestSignal: "standard" | "vip" | "allergy" | "birthday" | "late";
}

export interface ServiceScenarioCashMovement {
  id: string;
  at: string;
  kind:
    | "opening_bank"
    | "cash_sale"
    | "paid_out"
    | "cash_drop"
    | "deposit"
    | "adjustment";
  amountCents: number;
  actor: string;
  note: string;
}

export interface ServiceScenarioEventEffect {
  servicePeriodId?: "lunch" | "dinner";
  seatedCoversDelta?: number;
  completedCovers?: number;
  netSalesCents?: number;
  occupiedTables?: number;
  openExceptionsDelta?: number;
}

export interface ServiceScenarioEvent {
  id: string;
  at: string;
  phase: ServiceScenarioPhase;
  actor: string;
  kind:
    | "workflow"
    | "checkpoint"
    | "failure_injection"
    | "recovery"
    | "approval";
  severity: ServiceScenarioSeverity;
  title: string;
  detail: string;
  sourceHref: string;
  expectedCode: string;
  expectedDescription: string;
  simulatedCommandLatencyMs: number;
  simulatedRefreshLatencyMs: number;
  effect?: ServiceScenarioEventEffect;
}

export type ServiceEvent = ServiceScenarioEvent;

export interface ServiceCheckpoint {
  id: string;
  at: string;
  phase: ServiceScenarioPhase;
  label: string;
  requiredEventIds: string[];
  acceptance: string[];
}

export interface ServiceScenarioExternalGate {
  id: "connected_preview" | "physical_rehearsal" | "managed_recovery";
  label: string;
  status: ServiceScenarioGateStatus;
  detail: string;
}

export interface ServiceScenarioV1 {
  version: 1;
  id: "full-service-day-v1";
  label: string;
  synthetic: true;
  seed: number;
  businessDate: string;
  timeZone: "America/New_York";
  currencyCode: "USD";
  openedOn: string;
  observedAt: string;
  startsAt: string;
  endsAt: string;
  floor: {
    tableCount: 17;
    seatCount: 68;
    targetOccupiedTables: 17;
    targetPeakCovers: 60;
    pacingLimitPerWave: 14;
    assignments: ServiceScenarioTableAssignment[];
  };
  roster: Array<{
    id: string;
    label: string;
    role: string;
    station: string;
    startsAt: string;
    endsAt: string;
  }>;
  servicePeriods: ServiceScenarioServicePeriod[];
  menuLines: ServiceScenarioMenuLine[];
  cashMovements: ServiceScenarioCashMovement[];
  checkpoints: ServiceCheckpoint[];
  events: ServiceScenarioEvent[];
  externalGates: ServiceScenarioExternalGate[];
  expectations: {
    fullDayCovers: 96;
    grossSalesCents: 556_000;
    compsCents: 6_000;
    voidsCents: 4_000;
    netSalesCents: 546_000;
    cashSalesCents: 109_200;
    cardSalesCents: 436_800;
    tipsCents: 106_680;
    expectedClosingDrawerCents: 55_200;
    commandP95BudgetMs: 2_000;
    refreshP95BudgetMs: 3_000;
  };
}

export interface ServiceEventLedgerEntry {
  eventId: string;
  at: string;
  actor: string;
  phase: ServiceScenarioPhase;
  expectedCode: string;
  observedCode: string;
  expectedDescription: string;
  observedDescription: string;
  commandLatencyMs: number;
  refreshLatencyMs: number;
  auditEvidenceIds: string[];
  screenshotRef: string | null;
  status: "passed" | "failed";
}

export interface ServiceRun {
  runId: string;
  scenarioId: ServiceScenarioV1["id"];
  scenarioVersion: 1;
  synthetic: true;
  businessDate: string;
  timeZone: string;
  status: "seeded" | "running" | "paused" | "completed";
  clock: string;
  nextEventIndex: number;
  ledger: ServiceEventLedgerEntry[];
  metrics: {
    lunchCompletedCovers: number;
    dinnerCompletedCovers: number;
    dinnerSeatedCovers: number;
    dinnerOccupiedTables: number;
    lunchNetSalesCents: number;
    dinnerNetSalesCents: number;
    openExceptions: number;
  };
}

export interface ServiceScorecardCheck {
  id: string;
  label: string;
  status: "passed" | "failed" | "blocked";
  expected: string;
  actual: string;
  detail: string;
}

export interface ServiceScorecard {
  scenarioId: ServiceScenarioV1["id"];
  runId: string;
  generatedAt: string;
  localStatus: "passed" | "failed";
  releaseStatus: "passed" | "blocked" | "failed";
  checks: ServiceScorecardCheck[];
  eventSummary: {
    total: number;
    passed: number;
    failed: number;
    commandP95Ms: number;
    refreshP95Ms: number;
  };
  externalGates: ServiceScenarioExternalGate[];
}

export interface ServiceScenarioNowProjection {
  phase: ServiceScenarioPhase;
  phaseLabel: string;
  simulatedTimeLabel: string;
  sourceLabel: string;
  freshnessLabel: string;
  metrics: {
    dinnerCovers: number;
    dayCovers: number;
    seatedCovers: number;
    occupiedTables: number;
    dinnerNetSalesCents: number;
    dayNetSalesCents: number;
    averageDinnerSpendCents: number;
    onShift: number;
  };
  now: Array<{ label: string; value: string; detail: string }>;
  exceptions: Array<{
    id: string;
    severity: "warning" | "danger";
    title: string;
    detail: string;
    href: string;
    actionLabel: string;
  }>;
  next: Array<{ at: string; title: string; detail: string; href: string }>;
  close: Array<{ label: string; value: string; detail: string }>;
}
