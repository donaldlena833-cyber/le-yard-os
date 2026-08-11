import type { Json } from "@/types/database.generated";

export interface IncomeCurrentMetrics {
  liveNetSalesCents: number | null;
  liveGrossSalesCents: number | null;
  salesCovers: number;
  salesCheckCount: number;
  closeoutNetSalesCents: number | null;
  closeoutCount: number;
  approvedCloseoutCount: number;
  laborMinutes: number;
  laborKnownRateMinutes: number;
  laborCostCents: number;
  activeTimeEntryCount: number;
  recordedExpenseCents: number;
  recordedExpenseCount: number;
  receivedInventoryCostCents: number;
  approvedWasteCostCents: number;
  wasteMissingCostCount: number;
  trackedContributionCents: number | null;
}

export interface IncomeHourlyBucket {
  hour: number;
  revenueCents: number;
  checkCount: number;
  salesCovers: number;
  salesSampleDays: number;
  reservationCount: number;
  reservationCovers: number;
  laborMinutes: number;
  laborCostCents: number;
}

export interface IncomeSourceEvidence {
  key: "sales_checks" | "time_entries" | "expenses" | "closeouts";
  label: string;
  lastObservedAt: string | null;
  recordCount: number;
  grain: string;
  freshness: "current" | "stale" | "unavailable";
}

export interface IncomeOperatingModel {
  observedAt: string;
  organizationId: string;
  locationId: string;
  businessDate: string;
  timeZone: string;
  currencyCode: string;
  historyDays: number;
  windowStartsAt: string;
  windowEndsAt: string;
  current: IncomeCurrentMetrics;
  hourly: IncomeHourlyBucket[];
  sources: IncomeSourceEvidence[];
}

type JsonObject = { [key: string]: Json | undefined };

function object(value: Json | undefined): JsonObject | null {
  return value && !Array.isArray(value) && typeof value === "object"
    ? value
    : null;
}

function string(value: Json | undefined): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function integer(value: Json | undefined): number | null {
  return typeof value === "number" && Number.isSafeInteger(value)
    ? value
    : null;
}

function nullableInteger(value: Json | undefined): number | null | undefined {
  return value === null ? null : (integer(value) ?? undefined);
}

const currentIntegerKeys = [
  "salesCovers",
  "salesCheckCount",
  "closeoutCount",
  "approvedCloseoutCount",
  "laborMinutes",
  "laborKnownRateMinutes",
  "laborCostCents",
  "activeTimeEntryCount",
  "recordedExpenseCents",
  "recordedExpenseCount",
  "receivedInventoryCostCents",
  "approvedWasteCostCents",
  "wasteMissingCostCount",
] as const;

function parseCurrent(value: Json | undefined): IncomeCurrentMetrics | null {
  const input = object(value);
  if (!input) return null;
  const integers = Object.fromEntries(
    currentIntegerKeys.map((key) => [key, integer(input[key])]),
  ) as Record<(typeof currentIntegerKeys)[number], number | null>;
  const liveNetSalesCents = nullableInteger(input.liveNetSalesCents);
  const liveGrossSalesCents = nullableInteger(input.liveGrossSalesCents);
  const closeoutNetSalesCents = nullableInteger(input.closeoutNetSalesCents);
  const trackedContributionCents = nullableInteger(
    input.trackedContributionCents,
  );
  if (
    Object.values(integers).some((entry) => entry === null) ||
    liveNetSalesCents === undefined ||
    liveGrossSalesCents === undefined ||
    closeoutNetSalesCents === undefined ||
    trackedContributionCents === undefined
  )
    return null;
  return {
    ...(integers as Record<(typeof currentIntegerKeys)[number], number>),
    liveNetSalesCents,
    liveGrossSalesCents,
    closeoutNetSalesCents,
    trackedContributionCents,
  };
}

const hourlyIntegerKeys = [
  "hour",
  "revenueCents",
  "checkCount",
  "salesCovers",
  "salesSampleDays",
  "reservationCount",
  "reservationCovers",
  "laborMinutes",
  "laborCostCents",
] as const;

function parseHourly(value: Json | undefined): IncomeHourlyBucket[] | null {
  if (!Array.isArray(value) || value.length !== 24) return null;
  const parsed = value.map((item) => {
    const input = object(item);
    if (!input) return null;
    const values = Object.fromEntries(
      hourlyIntegerKeys.map((key) => [key, integer(input[key])]),
    ) as Record<(typeof hourlyIntegerKeys)[number], number | null>;
    if (Object.values(values).some((entry) => entry === null)) return null;
    return values as IncomeHourlyBucket;
  });
  return parsed.every((item): item is IncomeHourlyBucket => Boolean(item)) &&
    parsed.every((item, index) => item.hour === index)
    ? parsed
    : null;
}

const sourceKeys = new Set<IncomeSourceEvidence["key"]>([
  "sales_checks",
  "time_entries",
  "expenses",
  "closeouts",
]);

function sourceFreshness(
  key: IncomeSourceEvidence["key"],
  lastObservedAt: string | null,
  observedAt: string,
): IncomeSourceEvidence["freshness"] {
  if (!lastObservedAt) return "unavailable";
  const age = Date.parse(observedAt) - Date.parse(lastObservedAt);
  if (!Number.isFinite(age)) return "unavailable";
  const maxAgeMs =
    key === "sales_checks" || key === "time_entries"
      ? 15 * 60 * 1000
      : 36 * 60 * 60 * 1000;
  return age <= maxAgeMs ? "current" : "stale";
}

function parseSources(
  value: Json | undefined,
  observedAt: string,
): IncomeSourceEvidence[] | null {
  if (!Array.isArray(value) || value.length !== 4) return null;
  const parsed = value.map((item) => {
    const input = object(item);
    if (!input) return null;
    const key = string(input.key);
    const label = string(input.label);
    const grain = string(input.grain);
    const recordCount = integer(input.recordCount);
    const lastObservedAt =
      input.lastObservedAt === null ? null : string(input.lastObservedAt);
    if (
      !key ||
      !sourceKeys.has(key as IncomeSourceEvidence["key"]) ||
      !label ||
      !grain ||
      recordCount === null ||
      (input.lastObservedAt !== null && !lastObservedAt)
    )
      return null;
    const typedKey = key as IncomeSourceEvidence["key"];
    return {
      key: typedKey,
      label,
      grain,
      recordCount,
      lastObservedAt,
      freshness: sourceFreshness(typedKey, lastObservedAt, observedAt),
    };
  });
  return parsed.every((item): item is IncomeSourceEvidence => Boolean(item))
    ? parsed
    : null;
}

export function parseIncomeOperatingModel(
  value: Json,
): IncomeOperatingModel | null {
  const input = object(value);
  if (!input) return null;
  const observedAt = string(input.observedAt);
  const organizationId = string(input.organizationId);
  const locationId = string(input.locationId);
  const businessDate = string(input.businessDate);
  const timeZone = string(input.timeZone);
  const currencyCode = string(input.currencyCode);
  const historyDays = integer(input.historyDays);
  const windowStartsAt = string(input.windowStartsAt);
  const windowEndsAt = string(input.windowEndsAt);
  const current = parseCurrent(input.current);
  const hourly = parseHourly(input.hourly);
  const sources = observedAt ? parseSources(input.sources, observedAt) : null;
  if (
    !observedAt ||
    !organizationId ||
    !locationId ||
    !businessDate ||
    !timeZone ||
    !currencyCode ||
    historyDays === null ||
    !windowStartsAt ||
    !windowEndsAt ||
    !current ||
    !hourly ||
    !sources
  )
    return null;
  return {
    observedAt,
    organizationId,
    locationId,
    businessDate,
    timeZone,
    currencyCode,
    historyDays,
    windowStartsAt,
    windowEndsAt,
    current,
    hourly,
    sources,
  };
}

export function createDemoIncomeModel(): IncomeOperatingModel {
  const observedAt = "2026-08-10T19:15:00-04:00";
  return {
    observedAt,
    organizationId: "org-le-yard-demo",
    locationId: "loc-garden-demo",
    businessDate: "2026-08-10",
    timeZone: "America/New_York",
    currencyCode: "USD",
    historyDays: 28,
    windowStartsAt: "2026-08-10T15:00:00-04:00",
    windowEndsAt: "2026-08-11T02:00:00-04:00",
    current: {
      liveNetSalesCents: 864250,
      liveGrossSalesCents: 941800,
      salesCovers: 146,
      salesCheckCount: 58,
      closeoutNetSalesCents: null,
      closeoutCount: 0,
      approvedCloseoutCount: 0,
      laborMinutes: 2475,
      laborKnownRateMinutes: 2475,
      laborCostCents: 112900,
      activeTimeEntryCount: 14,
      recordedExpenseCents: 18400,
      recordedExpenseCount: 3,
      receivedInventoryCostCents: 42700,
      approvedWasteCostCents: 5600,
      wasteMissingCostCount: 1,
      trackedContributionCents: 732950,
    },
    hourly: Array.from({ length: 24 }, (_, hour) => ({
      hour,
      revenueCents:
        hour >= 16 && hour <= 23
          ? [0, 62000, 145000, 218000, 192000, 137000, 78000, 32250][hour - 16]
          : 0,
      checkCount:
        hour >= 16 && hour <= 23 ? [0, 5, 11, 15, 12, 8, 5, 2][hour - 16] : 0,
      salesCovers:
        hour >= 16 && hour <= 23
          ? [0, 12, 24, 35, 30, 22, 15, 8][hour - 16]
          : 0,
      salesSampleDays: hour >= 16 && hour <= 23 ? 21 : 0,
      reservationCount:
        hour >= 16 && hour <= 23 ? [1, 4, 8, 12, 10, 7, 4, 1][hour - 16] : 0,
      reservationCovers:
        hour >= 16 && hour <= 23
          ? [2, 10, 20, 31, 27, 18, 11, 3][hour - 16]
          : 0,
      laborMinutes:
        hour >= 15 && hour <= 23
          ? [180, 280, 360, 390, 390, 340, 275, 180, 80][hour - 15]
          : 0,
      laborCostCents:
        hour >= 15 && hour <= 23
          ? [8100, 12600, 16200, 17600, 17600, 15300, 12400, 8100, 3600][
              hour - 15
            ]
          : 0,
    })),
    sources: [
      {
        key: "sales_checks",
        label: "Live sales checks",
        lastObservedAt: observedAt,
        recordCount: 58,
        grain: "check_latest_state",
        freshness: "current",
      },
      {
        key: "time_entries",
        label: "Time clock",
        lastObservedAt: observedAt,
        recordCount: 14,
        grain: "time_entry_accrual",
        freshness: "current",
      },
      {
        key: "expenses",
        label: "Recorded expenses",
        lastObservedAt: observedAt,
        recordCount: 3,
        grain: "business_date",
        freshness: "current",
      },
      {
        key: "closeouts",
        label: "Shift closeouts",
        lastObservedAt: null,
        recordCount: 0,
        grain: "service_closeout",
        freshness: "unavailable",
      },
    ],
  };
}
