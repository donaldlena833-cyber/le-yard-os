import type {
  ServiceScenarioEvent,
  ServiceScenarioMenuLine,
  ServiceScenarioTableAssignment,
  ServiceScenarioV1,
} from "./types.ts";

const date = "2026-04-18";

function at(localTime: string): string {
  const day = localTime === "24:00" ? "2026-04-19" : date;
  const time = localTime === "24:00" ? "00:00" : localTime;
  return `${day}T${time}:00-04:00`;
}

function menuLine(
  id: string,
  name: string,
  category: ServiceScenarioMenuLine["category"],
  unitPriceCents: number,
  quantity: number,
  servicePeriodId: ServiceScenarioMenuLine["servicePeriodId"],
  disposition: ServiceScenarioMenuLine["disposition"] = "sale",
  recipeId: string | null = id,
): ServiceScenarioMenuLine {
  return {
    id,
    name,
    category,
    unitPriceCents,
    quantity,
    disposition,
    servicePeriodId,
    recipeId,
  };
}

const lunchMenu: ServiceScenarioMenuLine[] = [
  menuLine("lunch-french-toast", "Brioche French Toast", "main", 2_400, 8, "lunch"),
  menuLine("lunch-omelette", "French Omelette", "main", 2_600, 8, "lunch"),
  menuLine("lunch-mushroom-tartine", "Mushroom Tartine", "main", 2_600, 6, "lunch"),
  menuLine("lunch-croque", "Croque Madame", "main", 2_700, 6, "lunch"),
  menuLine("lunch-burger", "Le Yard Burger", "main", 2_900, 5, "lunch"),
  menuLine("lunch-steak-eggs", "Steak & Eggs", "main", 3_800, 3, "lunch"),
  menuLine("lunch-gougeres", "Warm Gougères", "starter", 1_200, 4, "lunch"),
  menuLine("lunch-oysters", "Oysters du Jour", "starter", 2_400, 2, "lunch"),
  menuLine("lunch-frisee", "Frisée Lyonnaise", "starter", 1_800, 3, "lunch"),
  menuLine("lunch-rosti", "Pommes Rösti", "side", 900, 4, "lunch"),
  menuLine("lunch-greens", "Market Greens", "side", 900, 3, "lunch"),
  menuLine("lunch-frites", "Frites", "side", 1_000, 3, "lunch"),
  menuLine("lunch-coffee-tea", "Coffee or tea", "beverage", 500, 8, "lunch", "sale", null),
];

const dinnerMenu: ServiceScenarioMenuLine[] = [
  menuLine("dinner-gnocchi", "Gnocchi Parisienne", "main", 2_800, 12, "dinner"),
  menuLine("dinner-moules", "Moules Frites", "main", 3_100, 10, "dinner"),
  menuLine("dinner-chicken", "Roasted Half Chicken", "main", 3_400, 10, "dinner"),
  menuLine("dinner-salmon", "Seared Salmon", "main", 3_600, 8, "dinner"),
  menuLine("dinner-duck", "Duck Leg Confit", "main", 3_700, 8, "dinner"),
  menuLine("dinner-steak", "Steak Frites", "main", 3_800, 12, "dinner"),
  menuLine("dinner-gougeres", "Warm Gougères", "starter", 1_200, 6, "dinner"),
  menuLine("dinner-leeks", "Leeks Vinaigrette", "starter", 1_700, 6, "dinner"),
  menuLine("dinner-escargots", "Escargots", "starter", 1_900, 5, "dinner"),
  menuLine("dinner-tartare", "Steak Tartare", "starter", 2_200, 5, "dinner"),
  menuLine("dinner-oysters", "Oysters du Jour", "starter", 2_400, 8, "dinner"),
  menuLine("dinner-mousse", "Chocolate Mousse", "dessert", 1_300, 8, "dinner"),
  menuLine("dinner-creme-brulee", "Crème Brûlée", "dessert", 1_300, 8, "dinner"),
  menuLine("dinner-profiteroles", "Profiteroles", "dessert", 1_400, 8, "dinner"),
  menuLine("dinner-signature-cocktail", "Signature cocktail", "beverage", 1_900, 20, "dinner", "sale", null),
  menuLine("dinner-regular", "The Regular", "beverage", 2_000, 11, "dinner", "sale", null),
  menuLine("dinner-gamay", "Beaujolais-Villages glass", "beverage", 1_700, 10, "dinner", "sale", null),
  menuLine("dinner-burgundy", "Bourgogne Rouge glass", "beverage", 2_200, 5, "dinner", "sale", null),
  menuLine("dinner-zero-proof", "Zero-proof cocktail", "beverage", 1_400, 15, "dinner", "sale", null),
  menuLine("dinner-sauternes", "Sauternes", "beverage", 1_800, 6, "dinner", "sale", null),
  menuLine("dinner-cremant", "Crémant de Loire glass", "beverage", 1_700, 5, "dinner", "sale", null),
  menuLine("dinner-steak-comp", "Steak Frites service recovery", "main", 3_800, 1, "dinner", "comp"),
  menuLine("dinner-tartare-comp", "Steak Tartare VIP hospitality", "starter", 2_200, 1, "dinner", "comp"),
  menuLine("dinner-cocktail-void", "The Regular duplicate/misfire", "beverage", 2_000, 2, "dinner", "void", null),
];

const tableAssignments: ServiceScenarioTableAssignment[] = [
  { tableLabel: "5", partySize: 6, wave: 1, startsAt: at("18:00"), source: "web", guestSignal: "vip" },
  { tableLabel: "7", partySize: 6, wave: 1, startsAt: at("18:00"), source: "phone", guestSignal: "allergy" },
  { tableLabel: "9", partySize: 6, wave: 2, startsAt: at("18:15"), source: "web", guestSignal: "late" },
  { tableLabel: "4", partySize: 4, wave: 2, startsAt: at("18:15"), source: "manual", guestSignal: "birthday" },
  { tableLabel: "1", partySize: 2, wave: 2, startsAt: at("18:15"), source: "web", guestSignal: "standard" },
  { tableLabel: "6", partySize: 4, wave: 3, startsAt: at("18:30"), source: "web", guestSignal: "standard" },
  { tableLabel: "8", partySize: 4, wave: 3, startsAt: at("18:30"), source: "phone", guestSignal: "standard" },
  { tableLabel: "2", partySize: 2, wave: 3, startsAt: at("18:30"), source: "web", guestSignal: "standard" },
  { tableLabel: "3", partySize: 2, wave: 3, startsAt: at("18:30"), source: "manual", guestSignal: "standard" },
  { tableLabel: "10", partySize: 4, wave: 4, startsAt: at("18:45"), source: "walk_in", guestSignal: "standard" },
  { tableLabel: "11", partySize: 4, wave: 4, startsAt: at("18:45"), source: "web", guestSignal: "standard" },
  { tableLabel: "12", partySize: 2, wave: 4, startsAt: at("18:45"), source: "web", guestSignal: "standard" },
  { tableLabel: "13", partySize: 2, wave: 4, startsAt: at("18:45"), source: "phone", guestSignal: "standard" },
  { tableLabel: "14", partySize: 4, wave: 5, startsAt: at("19:00"), source: "web", guestSignal: "standard" },
  { tableLabel: "15", partySize: 4, wave: 5, startsAt: at("19:00"), source: "manual", guestSignal: "standard" },
  { tableLabel: "16", partySize: 2, wave: 5, startsAt: at("19:00"), source: "web", guestSignal: "standard" },
  { tableLabel: "17", partySize: 2, wave: 5, startsAt: at("19:00"), source: "web", guestSignal: "standard" },
];

function event(
  value: Omit<
    ServiceScenarioEvent,
    "simulatedCommandLatencyMs" | "simulatedRefreshLatencyMs"
  > & {
    simulatedCommandLatencyMs?: number;
    simulatedRefreshLatencyMs?: number;
  },
): ServiceScenarioEvent {
  return {
    simulatedCommandLatencyMs: value.simulatedCommandLatencyMs ?? 420,
    simulatedRefreshLatencyMs: value.simulatedRefreshLatencyMs ?? 780,
    ...value,
  };
}

const events: ServiceScenarioEvent[] = [
  event({ id: "receiving-exception", at: at("09:00"), phase: "receiving", actor: "BOH receiver", kind: "failure_injection", severity: "warning", title: "Damaged produce and one substitution", detail: "Receiver records accepted, rejected, and substituted quantities with evidence; a different manager reviews the exception.", sourceHref: "/inventory", expectedCode: "receiving.exception.reviewed", expectedDescription: "Exception remains append-only and posts only after independent review.", effect: { openExceptionsDelta: 1 } }),
  event({ id: "opening-checklists", at: at("10:00"), phase: "opening", actor: "Opening team", kind: "workflow", severity: "info", title: "Opening controls completed", detail: "Food safety, equipment, Prep, floor, and the $300 opening bank are acknowledged.", sourceHref: "/tasks", expectedCode: "opening.checklists.completed", expectedDescription: "Every required opening control has actor and timestamp evidence.", effect: { openExceptionsDelta: -1 } }),
  event({ id: "lunch-preshift", at: at("10:45"), phase: "lunch_pre_service", actor: "Manager", kind: "workflow", severity: "info", title: "Lunch brief published and acknowledged", detail: "Stations, allergy/VIP context, staffing, and service targets are visible before acknowledgement.", sourceHref: "/service", expectedCode: "preshift.lunch.acknowledged", expectedDescription: "Every scheduled lunch principal acknowledges the same immutable version." }),
  event({ id: "lunch-wave-1", at: at("11:30"), phase: "lunch_service", actor: "Host", kind: "workflow", severity: "info", title: "Lunch wave one seated", detail: "Twelve covers arrive within the configured pacing limit.", sourceHref: `/reservations?date=${date}`, expectedCode: "lunch.wave.1.seated", expectedDescription: "Twelve covers have authoritative seated allocations.", effect: { servicePeriodId: "lunch", seatedCoversDelta: 12 } }),
  event({ id: "lunch-wave-2", at: at("11:45"), phase: "lunch_service", actor: "Host", kind: "workflow", severity: "info", title: "Lunch wave two seated", detail: "Twelve more covers seat without a table overlap.", sourceHref: `/reservations?date=${date}`, expectedCode: "lunch.wave.2.seated", expectedDescription: "Twenty-four lunch covers are seated.", effect: { servicePeriodId: "lunch", seatedCoversDelta: 12 } }),
  event({ id: "lunch-wave-3", at: at("12:00"), phase: "lunch_service", actor: "Host", kind: "workflow", severity: "info", title: "Lunch wave three seated", detail: "Lunch reaches the locked 36-cover target.", sourceHref: `/reservations?date=${date}`, expectedCode: "lunch.wave.3.seated", expectedDescription: "Thirty-six lunch covers are seated.", effect: { servicePeriodId: "lunch", seatedCoversDelta: 12 } }),
  event({ id: "lunch-checkpoint", at: at("13:30"), phase: "lunch_handoff", actor: "Manager", kind: "checkpoint", severity: "info", title: "Lunch service checkpoint frozen", detail: "Thirty-six covers and $1,260 net sales reconcile before the dinner reset.", sourceHref: "/income", expectedCode: "lunch.checkpoint.reconciled", expectedDescription: "Covers, checks, tenders, tips, and source timestamps agree.", effect: { servicePeriodId: "lunch", completedCovers: 36, netSalesCents: 126_000 } }),
  event({ id: "lunch-handoff", at: at("14:00"), phase: "lunch_handoff", actor: "Manager", kind: "workflow", severity: "info", title: "Lunch handoff accepted", detail: "Waste, count, room reset, and unresolved work carry into one dinner handoff.", sourceHref: "/tasks", expectedCode: "lunch.handoff.accepted", expectedDescription: "No separate closeout or duplicate approval is created." }),
  event({ id: "dinner-preshift", at: at("16:30"), phase: "dinner_pre_service", actor: "Manager and Chef", kind: "workflow", severity: "info", title: "Dinner readiness review", detail: "Prep, schedule, breaks, reservations, menu availability, and the 60-cover target are reviewed.", sourceHref: "/service", expectedCode: "preshift.dinner.acknowledged", expectedDescription: "Every dinner principal sees the role-safe published brief." }),
  event({ id: "staff-late", at: at("17:00"), phase: "dinner_pre_service", actor: "Manager", kind: "failure_injection", severity: "warning", title: "Server arrival is late", detail: "The manager reassigns one station without overwriting the published schedule.", sourceHref: "/schedule", expectedCode: "staffing.late.reassigned", expectedDescription: "Coverage and source timing remain visible.", effect: { openExceptionsDelta: 1 } }),
  event({ id: "delivery-failed", at: at("17:30"), phase: "dinner_pre_service", actor: "Host", kind: "failure_injection", severity: "warning", title: "Reservation delivery failed", detail: "The first provider attempt fails and remains failed; it is not marked notified.", sourceHref: `/reservations?date=${date}`, expectedCode: "delivery.failed.visible", expectedDescription: "The failed attempt has channel, timestamp, and escalation evidence.", effect: { openExceptionsDelta: 1 } }),
  event({ id: "delivery-recovered", at: at("17:45"), phase: "dinner_pre_service", actor: "Host", kind: "recovery", severity: "info", title: "Approved delivery fallback succeeds", detail: "A separately initiated fallback succeeds and starts the offer deadline.", sourceHref: `/reservations?date=${date}`, expectedCode: "delivery.fallback.sent", expectedDescription: "The original failed attempt is retained and no duplicate automatic replay occurs.", effect: { openExceptionsDelta: -1 } }),
  event({ id: "dinner-wave-1", at: at("18:00"), phase: "dinner_service", actor: "Host", kind: "workflow", severity: "info", title: "Dinner wave one seated", detail: "Two six-tops seat for twelve covers.", sourceHref: `/reservations?date=${date}`, expectedCode: "dinner.wave.1.seated", expectedDescription: "Twelve covers have authoritative table allocations.", effect: { servicePeriodId: "dinner", seatedCoversDelta: 12, occupiedTables: 2 } }),
  event({ id: "dinner-wave-2", at: at("18:15"), phase: "dinner_service", actor: "Host", kind: "workflow", severity: "info", title: "Dinner wave two seated", detail: "A six-top, four-top, and two-top seat for twelve covers.", sourceHref: `/reservations?date=${date}`, expectedCode: "dinner.wave.2.seated", expectedDescription: "Twenty-four covers are seated without overlap.", effect: { servicePeriodId: "dinner", seatedCoversDelta: 12, occupiedTables: 5 } }),
  event({ id: "dinner-wave-3", at: at("18:30"), phase: "dinner_service", actor: "Host", kind: "workflow", severity: "info", title: "Dinner wave three seated", detail: "Two four-tops and two two-tops seat for twelve covers.", sourceHref: `/reservations?date=${date}`, expectedCode: "dinner.wave.3.seated", expectedDescription: "Thirty-six covers are seated.", effect: { servicePeriodId: "dinner", seatedCoversDelta: 12, occupiedTables: 9 } }),
  event({ id: "no-show-walk-in", at: at("18:45"), phase: "dinner_service", actor: "Host", kind: "failure_injection", severity: "warning", title: "Four-top no-show replaced by walk-in", detail: "The no-show remains historical and a four-cover walk-in receives a fresh allocation.", sourceHref: `/reservations?date=${date}`, expectedCode: "reservation.no_show.walk_in.recovered", expectedDescription: "The original party is no-show and the replacement is a distinct seated reservation." }),
  event({ id: "dinner-wave-4", at: at("18:45"), phase: "dinner_service", actor: "Host", kind: "workflow", severity: "info", title: "Dinner wave four seated", detail: "Two four-tops and two two-tops seat for twelve completed allocations.", sourceHref: `/reservations?date=${date}`, expectedCode: "dinner.wave.4.seated", expectedDescription: "Forty-eight covers are seated.", effect: { servicePeriodId: "dinner", seatedCoversDelta: 12, occupiedTables: 13 } }),
  event({ id: "dinner-wave-5", at: at("19:00"), phase: "dinner_service", actor: "Host", kind: "checkpoint", severity: "info", title: "Dining room reaches peak", detail: "All 17 tables are occupied with 60 seated covers; the final wave remains below the 14-cover limit.", sourceHref: `/reservations?date=${date}`, expectedCode: "dinner.peak.reconciled", expectedDescription: "Sixty active covers occupy 17 unique tables.", effect: { servicePeriodId: "dinner", seatedCoversDelta: 12, occupiedTables: 17 } }),
  event({ id: "table-allocation-race", at: at("19:05"), phase: "dinner_service", actor: "Two Host sessions", kind: "failure_injection", severity: "warning", title: "Simultaneous table request conflicts", detail: "One version-fenced command wins; the stale host refreshes to authoritative alternatives.", sourceHref: `/reservations?date=${date}`, expectedCode: "reservation.table_race.single_winner", expectedDescription: "No overlap or duplicate allocation is created." }),
  event({ id: "table-reset-recovered", at: at("19:15"), phase: "dinner_service", actor: "Support", kind: "recovery", severity: "info", title: "Table 17 reset completes", detail: "The earlier needs-reset state is restored before its two-top seats.", sourceHref: `/reservations?date=${date}`, expectedCode: "floor.table_17.available", expectedDescription: "The table has an audited physical-state head and one occupant." }),
  event({ id: "oysters-running-low", at: at("19:30"), phase: "dinner_service", actor: "Chef", kind: "failure_injection", severity: "warning", title: "Oysters running low", detail: "The canonical menu item is marked running low with portions and source evidence.", sourceHref: "/service", expectedCode: "availability.oysters.running_low", expectedDescription: "FOH and BOH read the same item state.", effect: { openExceptionsDelta: 1 } }),
  event({ id: "oysters-86-substitution", at: at("19:45"), phase: "dinner_service", actor: "Chef and Manager", kind: "recovery", severity: "warning", title: "Oysters 86; equal-price substitution approved", detail: "Cold Seafood Platter replaces the remaining $24 oyster orders without changing the sales target.", sourceHref: "/service", expectedCode: "availability.oysters.86_substituted", expectedDescription: "The 86 is versioned and the substitution keeps checks and recipe consumption coherent." }),
  event({ id: "kitchen-delay", at: at("20:00"), phase: "dinner_service", actor: "Chef", kind: "failure_injection", severity: "danger", title: "Entrée station delay", detail: "A delayed course triggers a manager touch without inventing KDS provider evidence.", sourceHref: "/tasks", expectedCode: "service.delay.manager_touch", expectedDescription: "The incident, affected table, owner, and recovery remain linked.", simulatedCommandLatencyMs: 760, simulatedRefreshLatencyMs: 1_420, effect: { openExceptionsDelta: 1 } }),
  event({ id: "break-conflict", at: at("20:15"), phase: "dinner_service", actor: "Manager", kind: "failure_injection", severity: "warning", title: "Break window conflicts with peak", detail: "A break is reassigned and the source schedule remains unchanged.", sourceHref: "/schedule", expectedCode: "labor.break.reassigned", expectedDescription: "The operating exception and manager decision are timestamped.", effect: { openExceptionsDelta: 1 } }),
  event({ id: "tablet-offline", at: at("20:30"), phase: "dinner_service", actor: "Server", kind: "failure_injection", severity: "danger", title: "Service tablet goes offline", detail: "Consequential writes disable and the last snapshot is visibly stale.", sourceHref: "/today", expectedCode: "offline.writes.blocked", expectedDescription: "No reservation, 86, inventory, or closeout command is queued for replay.", simulatedCommandLatencyMs: 0, simulatedRefreshLatencyMs: 0, effect: { openExceptionsDelta: 1 } }),
  event({ id: "tablet-reconnected", at: at("20:35"), phase: "dinner_service", actor: "Server", kind: "recovery", severity: "info", title: "Tablet reconnects and reconciles", detail: "The app refreshes authoritative state before enabling commands.", sourceHref: "/today", expectedCode: "offline.reconnect.reconciled", expectedDescription: "No offline mutation is replayed and source freshness is current.", simulatedCommandLatencyMs: 840, simulatedRefreshLatencyMs: 1_780, effect: { openExceptionsDelta: -1 } }),
  event({ id: "lost-response", at: at("20:45"), phase: "dinner_service", actor: "Manager", kind: "failure_injection", severity: "warning", title: "Duplicate command after lost response", detail: "Receipt lookup returns the original result; the second command does not apply again.", sourceHref: "/inventory", expectedCode: "command.receipt.recovered", expectedDescription: "Exactly one consequential record exists.", simulatedCommandLatencyMs: 1_280, simulatedRefreshLatencyMs: 2_320 }),
  event({ id: "checks-frozen", at: at("22:30"), phase: "closing", actor: "Manager", kind: "checkpoint", severity: "info", title: "Dinner checks frozen", detail: "Sixty completed covers reconcile to $4,300 gross and $4,200 net sales.", sourceHref: "/income", expectedCode: "dinner.checks.reconciled", expectedDescription: "Checks, tenders, comps, voids, and tips agree by service period.", effect: { servicePeriodId: "dinner", completedCovers: 60, netSalesCents: 420_000 } }),
  event({ id: "closing-controls", at: at("23:00"), phase: "closing", actor: "Closing team", kind: "workflow", severity: "info", title: "Closing controls completed", detail: "Waste, temperatures, equipment, security, and evidence are complete.", sourceHref: "/tasks", expectedCode: "closing.checklists.completed", expectedDescription: "Every required close item has actor and timestamp evidence.", effect: { openExceptionsDelta: -2 } }),
  event({ id: "cash-shortage", at: at("23:30"), phase: "closing", actor: "Manager", kind: "failure_injection", severity: "danger", title: "$5 cash shortage blocks submission", detail: "The first count is $547 against a $552 expected drawer.", sourceHref: "/closeout", expectedCode: "closeout.cash_variance.blocked", expectedDescription: "Submission requires a variance reason or linked correction.", effect: { openExceptionsDelta: 1 } }),
  event({ id: "cash-recovered", at: at("23:35"), phase: "closing", actor: "Manager", kind: "recovery", severity: "info", title: "Cash recount resolves variance", detail: "The missing $5 is located and the final drawer equals $552.", sourceHref: "/closeout", expectedCode: "closeout.cash_variance.resolved", expectedDescription: "The failed first count and final recount both remain in evidence.", effect: { openExceptionsDelta: -1 } }),
  event({ id: "same-owner-approval", at: at("23:40"), phase: "approval", actor: "Submitting manager", kind: "failure_injection", severity: "warning", title: "Same-person approval denied", detail: "The submitter cannot approve the immutable closeout and tip run.", sourceHref: "/closeout", expectedCode: "closeout.same_actor.denied", expectedDescription: "No approval timestamp or lock is created." }),
  event({ id: "manager-submit", at: at("23:50"), phase: "approval", actor: "Manager", kind: "approval", severity: "info", title: "Daily closeout submitted", detail: "Ninety-six covers, $5,460 net sales, $1,092 cash, $4,368 card, and $1,066.80 tips reconcile.", sourceHref: "/closeout", expectedCode: "closeout.submitted", expectedDescription: "Submission is immutable and awaits a different authorized Owner." }),
  event({ id: "second-owner-approval", at: at("24:00"), phase: "approval", actor: "Owner 2", kind: "approval", severity: "info", title: "Second Owner approves and locks", detail: "The closeout, tips, evidence, and final scorecard are locked for review.", sourceHref: "/closeout", expectedCode: "closeout.approved_locked", expectedDescription: "The independent approval and exact-cent tip allocation are audited." }),
];

export const fullServiceDayScenario = {
  version: 1,
  id: "full-service-day-v1",
  label: "Le Yard full-day pressure test",
  synthetic: true,
  seed: 600_070,
  businessDate: date,
  timeZone: "America/New_York",
  currencyCode: "USD",
  openedOn: "2025-11-18",
  observedAt: at("20:00"),
  startsAt: at("09:00"),
  endsAt: at("24:00"),
  floor: {
    tableCount: 17,
    seatCount: 68,
    targetOccupiedTables: 17,
    targetPeakCovers: 60,
    pacingLimitPerWave: 14,
    assignments: tableAssignments,
  },
  roster: [
    { id: "owner-1", label: "Owner 1", role: "Owner · floor", station: "Dining room", startsAt: at("16:00"), endsAt: at("23:50") },
    { id: "owner-2", label: "Owner 2", role: "Owner · approval", station: "Close review", startsAt: at("16:30"), endsAt: at("24:00") },
    { id: "server-1", label: "Server 1", role: "Server", station: "Section 1", startsAt: at("10:30"), endsAt: at("23:00") },
    { id: "server-2", label: "Server 2", role: "Server", station: "Section 2", startsAt: at("10:30"), endsAt: at("23:00") },
    { id: "server-3", label: "Server 3", role: "Server", station: "Section 3", startsAt: at("16:00"), endsAt: at("23:30") },
    { id: "server-4", label: "Server 4", role: "Server / Host", station: "Door", startsAt: at("16:00"), endsAt: at("23:30") },
    { id: "bartender", label: "Bartender", role: "Bartender", station: "Bar", startsAt: at("10:30"), endsAt: at("24:00") },
    { id: "support", label: "Support", role: "Runner / support", station: "Floor", startsAt: at("10:30"), endsAt: at("23:30") },
    { id: "chef", label: "Chef", role: "Executive Chef", station: "Expo", startsAt: at("09:00"), endsAt: at("23:30") },
    { id: "boh-1", label: "BOH 1", role: "Line cook", station: "Sauté", startsAt: at("09:00"), endsAt: at("23:30") },
    { id: "boh-2", label: "BOH 2", role: "Line cook", station: "Grill", startsAt: at("09:00"), endsAt: at("23:30") },
    { id: "boh-3", label: "BOH 3", role: "Line cook", station: "Garde manger", startsAt: at("09:00"), endsAt: at("23:30") },
    { id: "boh-4", label: "BOH 4", role: "Prep cook", station: "Prep", startsAt: at("09:00"), endsAt: at("18:00") },
    { id: "boh-5", label: "BOH 5", role: "Porter", station: "Dish / close", startsAt: at("10:00"), endsAt: at("24:00") },
  ],
  servicePeriods: [
    { id: "lunch", label: "Lunch", startsAt: at("11:30"), endsAt: at("14:00"), targetCovers: 36, peakCovers: 36, grossSalesCents: 126_000, compsCents: 0, voidsCents: 0, netSalesCents: 126_000, cashSalesCents: 25_200, cardSalesCents: 100_800, cashTipsCents: 4_536, cardTipsCents: 18_144 },
    { id: "dinner", label: "Dinner", startsAt: at("18:00"), endsAt: at("22:30"), targetCovers: 60, peakCovers: 60, grossSalesCents: 430_000, compsCents: 6_000, voidsCents: 4_000, netSalesCents: 420_000, cashSalesCents: 84_000, cardSalesCents: 336_000, cashTipsCents: 16_800, cardTipsCents: 67_200 },
  ],
  menuLines: [...lunchMenu, ...dinnerMenu],
  cashMovements: [
    { id: "cash-opening-bank", at: at("10:00"), kind: "opening_bank", amountCents: 30_000, actor: "Manager", note: "Synthetic opening bank." },
    { id: "cash-lunch-sales", at: at("14:00"), kind: "cash_sale", amountCents: 25_200, actor: "POS adapter", note: "Lunch cash tender total." },
    { id: "cash-dinner-sales", at: at("22:30"), kind: "cash_sale", amountCents: 84_000, actor: "POS adapter", note: "Dinner cash tender total." },
    { id: "cash-paid-out", at: at("15:30"), kind: "paid_out", amountCents: -4_000, actor: "Manager", note: "Approved synthetic operational paid-out." },
    { id: "cash-drop", at: at("22:45"), kind: "cash_drop", amountCents: -80_000, actor: "Manager", note: "Cash secured for deposit." },
  ],
  checkpoints: [
    { id: "receiving-reviewed", at: at("09:00"), phase: "receiving", label: "Receiving exceptions reviewed", requiredEventIds: ["receiving-exception"], acceptance: ["Damaged quantity and substitution retain independent evidence."] },
    { id: "opening-ready", at: at("10:00"), phase: "opening", label: "Opening controls ready", requiredEventIds: ["opening-checklists"], acceptance: ["Safety, equipment, Prep, floor, and bank controls are acknowledged."] },
    { id: "lunch-closed", at: at("13:30"), phase: "lunch_handoff", label: "Lunch service frozen", requiredEventIds: ["lunch-wave-1", "lunch-wave-2", "lunch-wave-3", "lunch-checkpoint"], acceptance: ["36 covers and $1,260 net sales reconcile."] },
    { id: "lunch-handed-off", at: at("14:00"), phase: "lunch_handoff", label: "Lunch handoff accepted", requiredEventIds: ["lunch-handoff"], acceptance: ["One handoff carries unresolved work without a duplicate closeout."] },
    { id: "dinner-ready", at: at("16:30"), phase: "dinner_pre_service", label: "Dinner readiness published", requiredEventIds: ["dinner-preshift"], acceptance: ["Prep, staffing, reservations, and availability share one version."] },
    { id: "dinner-peak", at: at("19:00"), phase: "dinner_service", label: "Dining room peak reconciled", requiredEventIds: ["dinner-wave-1", "dinner-wave-2", "dinner-wave-3", "dinner-wave-4", "dinner-wave-5"], acceptance: ["60 covers occupy 17 unique tables with five 12-cover waves."] },
    { id: "checks-frozen", at: at("22:30"), phase: "closing", label: "Dinner checks frozen", requiredEventIds: ["checks-frozen"], acceptance: ["Dinner closes at $4,300 gross and $4,200 net for 60 covers."] },
    { id: "daily-close-submitted", at: at("23:50"), phase: "approval", label: "Daily close submitted", requiredEventIds: ["closing-controls", "cash-shortage", "cash-recovered", "same-owner-approval", "manager-submit"], acceptance: ["Cash, tips, exceptions, and separation of duties reconcile before submission."] },
    { id: "owner-approved", at: at("24:00"), phase: "approval", label: "Independent Owner approval locked", requiredEventIds: ["second-owner-approval"], acceptance: ["The final synthetic audit snapshot is immutable."] },
  ],
  events,
  externalGates: [
    { id: "connected_preview", label: "Connected isolated Supabase rehearsal", status: "blocked", detail: "Requires an approved isolated nonproduction project, synthetic identities, and attestation for the exact deployment." },
    { id: "physical_rehearsal", label: "Staffed physical dress rehearsal", status: "blocked", detail: "Requires the measured floor, actual service devices, scheduled staff, and Owner sign-off." },
    { id: "managed_recovery", label: "Managed backup and Storage recovery", status: "blocked", detail: "Repository restore evidence does not substitute for an approved managed backup, PITR, and private Storage recovery rehearsal." },
  ],
  expectations: {
    fullDayCovers: 96,
    grossSalesCents: 556_000,
    compsCents: 6_000,
    voidsCents: 4_000,
    netSalesCents: 546_000,
    cashSalesCents: 109_200,
    cardSalesCents: 436_800,
    tipsCents: 106_680,
    expectedClosingDrawerCents: 55_200,
    commandP95BudgetMs: 2_000,
    refreshP95BudgetMs: 3_000,
  },
} as const satisfies ServiceScenarioV1;

export const legacySaturdaySimulationId = "saturday-service";
