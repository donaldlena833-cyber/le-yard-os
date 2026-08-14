import type {
  IncomeHourlyBucket,
  IncomeOperatingModel,
} from "@/lib/income/model";

export type IncomePlanningBasis = "recorded_revenue" | "reserved_covers";

export interface RankedIncomeHour {
  bucket: IncomeHourlyBucket;
  average: number;
}

export interface IncomePlanningSummary {
  basis: IncomePlanningBasis | null;
  busiest: RankedIncomeHour | null;
  slowest: RankedIncomeHour | null;
  observedHourCount: number;
  staffedWithoutDemand: IncomeHourlyBucket[];
}

export type IncomePlanningInsight =
  | {
      kind: "busy_hour";
      basis: IncomePlanningBasis | null;
      bucket: IncomeHourlyBucket | null;
      average: number | null;
      sampleDays: number;
      sourceFreshness: "current" | "stale" | "unavailable" | null;
    }
  | {
      kind: "staffed_without_demand";
      buckets: IncomeHourlyBucket[];
      laborMinutes: number;
      laborCostCents: number;
      timeClockFreshness: "current" | "stale" | "unavailable";
      salesFreshness: "current" | "stale" | "unavailable";
    }
  | {
      kind: "data_coverage";
      currentSourceCount: number;
      totalSourceCount: number;
      issues: IncomeOperatingModel["sources"];
    };

function rankedHour(
  bucket: IncomeHourlyBucket,
  basis: IncomePlanningBasis,
  historyDays: number,
): RankedIncomeHour {
  return {
    bucket,
    average:
      basis === "recorded_revenue"
        ? bucket.revenueCents / Math.max(1, bucket.salesSampleDays)
        : bucket.reservationCovers / Math.max(1, historyDays),
  };
}

/**
 * Produces a single, comparable planning basis. Revenue is preferred only
 * when source-backed sales observations exist; otherwise reservation demand
 * is used. Dollars and covers are never blended into an invented score.
 */
export function deriveIncomePlanningSummary(
  model: IncomeOperatingModel,
): IncomePlanningSummary {
  const revenueHours = model.hourly.filter(
    (bucket) => bucket.salesSampleDays > 0,
  );
  const reservationHours = model.hourly.filter(
    (bucket) => bucket.reservationCount > 0 || bucket.reservationCovers > 0,
  );
  const basis: IncomePlanningBasis | null = revenueHours.length
    ? "recorded_revenue"
    : reservationHours.length
      ? "reserved_covers"
      : null;
  const observed =
    basis === "recorded_revenue" ? revenueHours : reservationHours;
  const ranked = basis
    ? observed
        .map((bucket) => rankedHour(bucket, basis, model.historyDays))
        .sort((left, right) =>
          right.average === left.average
            ? left.bucket.hour - right.bucket.hour
            : right.average - left.average,
        )
    : [];
  const staffedWithoutDemand = model.hourly.filter(
    (bucket) =>
      bucket.laborMinutes > 0 &&
      bucket.salesSampleDays === 0 &&
      bucket.reservationCovers === 0,
  );

  return {
    basis,
    busiest: ranked[0] ?? null,
    slowest: ranked.at(-1) ?? null,
    observedHourCount: observed.length,
    staffedWithoutDemand,
  };
}

/**
 * Builds deterministic planning evidence. Each insight stays within one
 * measurement grain and keeps source freshness beside the conclusion.
 */
export function deriveIncomePlanningInsights(
  model: IncomeOperatingModel,
): readonly [
  Extract<IncomePlanningInsight, { kind: "busy_hour" }>,
  Extract<IncomePlanningInsight, { kind: "staffed_without_demand" }>,
  Extract<IncomePlanningInsight, { kind: "data_coverage" }>,
] {
  const summary = deriveIncomePlanningSummary(model);
  const salesSource = model.sources.find(
    (source) => source.key === "sales_checks",
  );
  const timeClockSource = model.sources.find(
    (source) => source.key === "time_entries",
  );
  const staffed = summary.staffedWithoutDemand;
  const issues = model.sources.filter(
    (source) => source.freshness !== "current",
  );

  return [
    {
      kind: "busy_hour",
      basis: summary.basis,
      bucket: summary.busiest?.bucket ?? null,
      average: summary.busiest?.average ?? null,
      sampleDays:
        summary.basis === "recorded_revenue"
          ? (summary.busiest?.bucket.salesSampleDays ?? 0)
          : summary.basis === "reserved_covers"
            ? model.historyDays
            : 0,
      sourceFreshness:
        summary.basis === "recorded_revenue"
          ? (salesSource?.freshness ?? "unavailable")
          : null,
    },
    {
      kind: "staffed_without_demand",
      buckets: staffed,
      laborMinutes: staffed.reduce(
        (total, bucket) => total + bucket.laborMinutes,
        0,
      ),
      laborCostCents: staffed.reduce(
        (total, bucket) => total + bucket.laborCostCents,
        0,
      ),
      timeClockFreshness: timeClockSource?.freshness ?? "unavailable",
      salesFreshness: salesSource?.freshness ?? "unavailable",
    },
    {
      kind: "data_coverage",
      currentSourceCount: model.sources.length - issues.length,
      totalSourceCount: model.sources.length,
      issues,
    },
  ];
}
