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
