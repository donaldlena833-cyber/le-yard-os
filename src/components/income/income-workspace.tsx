"use client";

import {
  Activity,
  ArrowRight,
  BadgeDollarSign,
  CalendarRange,
  Clock3,
  DatabaseZap,
  RefreshCw,
  UserRoundCheck,
  UsersRound,
  WalletCards,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import type { CSSProperties } from "react";
import { RealtimeSyncStatus } from "@/components/realtime/realtime-sync-status";
import { Button, buttonVariants } from "@/components/ui/button";
import { Drawer } from "@/components/ui/drawer";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { ReadState } from "@/components/ui/read-state";
import { StatusPill } from "@/components/ui/status-pill";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import type { LiveReadResult } from "@/data/read-models/shared";
import {
  deriveIncomePlanningInsights,
  deriveIncomePlanningSummary,
  type IncomePlanningInsight,
} from "@/lib/income/insights";
import type {
  IncomeHourlyBucket,
  IncomeOperatingModel,
} from "@/lib/income/model";
import {
  useRealtimeInvalidation,
  type RealtimeInvalidationBinding,
} from "@/lib/realtime/use-realtime-invalidation";
import { cn } from "@/lib/utils";

const incomeRealtimeBindings = [
  { table: "service_shifts", scope: "location" },
  { table: "time_entries", scope: "location" },
  { table: "time_breaks", scope: "organization" },
  { table: "shift_closeouts", scope: "location" },
  { table: "expenses", scope: "location" },
  { table: "deliveries", scope: "location" },
  { table: "delivery_lines", scope: "organization" },
  { table: "waste_records", scope: "location" },
  { table: "reservations", scope: "location" },
  { table: "employee_job_roles", scope: "location" },
] satisfies readonly RealtimeInvalidationBinding[];

function currency(cents: number | null, code: string): string {
  if (cents === null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: code,
    maximumFractionDigits: 0,
  }).format(cents / 100);
}

function hourLabel(hour: number): string {
  return new Intl.DateTimeFormat("en-US", {
    hour: "numeric",
    timeZone: "UTC",
  }).format(new Date(Date.UTC(2026, 0, 1, hour)));
}

function dateTimeLabel(value: string, timeZone: string): string {
  return new Intl.DateTimeFormat("en-US", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone,
  }).format(new Date(value));
}

function freshnessLabel(value: string | null, timeZone: string): string {
  return value ? dateTimeLabel(value, timeZone) : "No source records";
}

type HourlyMetric = "revenue" | "demand" | "labor";

export interface IncomeActionAccess {
  canManageSchedule: boolean;
  canViewSchedule: boolean;
  canOpenTimeClock: boolean;
  canManageIntegrations: boolean;
}

const noIncomeActionAccess: IncomeActionAccess = {
  canManageSchedule: false,
  canViewSchedule: false,
  canOpenTimeClock: false,
  canManageIntegrations: false,
};

const hourlyMetricTabs = [
  { value: "revenue", label: "Revenue" },
  { value: "demand", label: "Demand" },
  { value: "labor", label: "Labor" },
] as const;

function hourlyMetricValue(
  bucket: IncomeHourlyBucket,
  metric: HourlyMetric,
): number {
  if (metric === "revenue") return bucket.revenueCents;
  if (metric === "demand") return bucket.reservationCovers;
  return bucket.laborMinutes;
}

function hourlyMetricLabel(
  bucket: IncomeHourlyBucket,
  metric: HourlyMetric,
  model: IncomeOperatingModel,
): string {
  if (metric === "revenue")
    return currency(bucket.revenueCents, model.currencyCode);
  if (metric === "demand") return `${bucket.reservationCovers} covers`;
  return `${(bucket.laborMinutes / 60).toFixed(1)}h`;
}

function HourlyProfile({ model }: { model: IncomeOperatingModel }) {
  const [metric, setMetric] = useState<HourlyMetric>("revenue");
  const [selectedHour, setSelectedHour] = useState<number | null>(null);
  const [selectedTrigger, setSelectedTrigger] = useState<HTMLElement | null>(
    null,
  );
  const visible = model.hourly.filter(
    (bucket) =>
      bucket.revenueCents > 0 ||
      bucket.reservationCovers > 0 ||
      bucket.laborMinutes > 0,
  );
  const buckets = visible.length
    ? visible
    : model.hourly.filter((bucket) => bucket.hour >= 15);
  const maximum = Math.max(
    1,
    ...buckets.map((bucket) => hourlyMetricValue(bucket, metric)),
  );
  const selected = model.hourly.find((bucket) => bucket.hour === selectedHour);

  return (
    <div className="border-y border-[var(--line)]">
      <Tabs
        id="income-hourly-metric"
        label="Hourly planning metric"
        items={hourlyMetricTabs}
        value={metric}
        onValueChange={setMetric}
      />
      <TabPanel
        id="income-hourly-metric"
        value={metric}
        className="overflow-x-auto py-5"
      >
        <div
          role="list"
          aria-label={`Hourly ${metric} profile`}
          className="grid min-w-[720px] grid-cols-[repeat(var(--hours),minmax(48px,1fr))] gap-2"
          style={{ "--hours": buckets.length } as CSSProperties}
        >
          {buckets.map((bucket) => (
            <button
              key={bucket.hour}
              type="button"
              role="listitem"
              aria-label={`${hourLabel(bucket.hour)}: ${currency(bucket.revenueCents, model.currencyCode)} recorded revenue across ${bucket.salesSampleDays} observed sales day${bucket.salesSampleDays === 1 ? "" : "s"}; ${bucket.reservationCovers} reserved covers; ${(bucket.laborMinutes / 60).toFixed(1)} labor hours. Open hour details.`}
              onClick={(event) => {
                setSelectedTrigger(event.currentTarget);
                setSelectedHour(bucket.hour);
              }}
              className="focus-ring group flex min-h-11 min-w-0 flex-col items-center rounded-lg"
            >
              <div className="flex h-44 w-full items-end justify-center gap-1 rounded-t-lg bg-[var(--canvas-strong)] px-1.5 pt-2">
                <span
                  aria-hidden="true"
                  className={cn(
                    "w-[46%] min-h-1 rounded-t-sm transition-[height] motion-reduce:transition-none",
                    metric === "revenue"
                      ? "bg-[var(--accent)]"
                      : metric === "demand"
                        ? "bg-[var(--ink-faint)]"
                        : "bg-[var(--positive)]",
                  )}
                  style={{
                    height: `${Math.max(3, (hourlyMetricValue(bucket, metric) / maximum) * 100)}%`,
                  }}
                />
              </div>
              <span className="mt-2 text-[11px] font-semibold text-[var(--ink-soft)]">
                {hourLabel(bucket.hour)}
              </span>
              <span className="mt-1 text-[10px] text-[var(--ink-faint)]">
                {hourlyMetricLabel(bucket, metric, model)}
              </span>
            </button>
          ))}
        </div>
        <div className="mt-4 flex flex-wrap gap-4 text-xs text-[var(--ink-faint)]">
          <span>
            Select an hour for its evidence. Revenue is grouped by check
            close/source hour; demand and labor are planning signals, not
            revenue.
          </span>
        </div>
      </TabPanel>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelectedHour(null)}
        labelledBy="income-hour-insight-title"
        width="sm"
        initialFocusSelector="[data-close-income-hour]"
        returnFocusTarget={selectedTrigger}
        className="p-5 pb-[calc(6.5rem+env(safe-area-inset-bottom))] sm:p-7"
      >
        {selected ? (
          <>
            <div className="flex items-start justify-between gap-4">
              <div>
                <StatusPill tone="neutral">Planning evidence</StatusPill>
                <h2
                  id="income-hour-insight-title"
                  className="mt-4 text-2xl font-medium tracking-[-0.045em]"
                >
                  {hourLabel(selected.hour)} operating detail
                </h2>
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  Totals across the selected {model.historyDays}-day history.
                </p>
              </div>
              <Button
                data-close-income-hour
                variant="quiet"
                size="icon"
                aria-label="Close hour details"
                onClick={() => setSelectedHour(null)}
              >
                <X className="size-4" />
              </Button>
            </div>

            <div className="mt-7 grid grid-cols-2 gap-3">
              <div className="rounded-[16px] bg-[var(--canvas)] p-4">
                <p className="eyebrow">Recorded revenue</p>
                <p className="mt-2 text-xl font-medium">
                  {currency(selected.revenueCents, model.currencyCode)}
                </p>
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  {selected.salesSampleDays} observed sales day(s)
                </p>
              </div>
              <div className="rounded-[16px] bg-[var(--canvas)] p-4">
                <p className="eyebrow">Checks</p>
                <p className="numeric mt-2 text-xl font-medium">
                  {selected.checkCount}
                </p>
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  {selected.salesCovers} recorded covers
                </p>
              </div>
              <div className="rounded-[16px] bg-[var(--canvas)] p-4">
                <p className="eyebrow">Reservation demand</p>
                <p className="numeric mt-2 text-xl font-medium">
                  {selected.reservationCovers}
                </p>
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  {selected.reservationCount} parties
                </p>
              </div>
              <div className="rounded-[16px] bg-[var(--canvas)] p-4">
                <p className="eyebrow">Known labor</p>
                <p className="mt-2 text-xl font-medium">
                  {(selected.laborMinutes / 60).toFixed(1)}h
                </p>
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  {currency(selected.laborCostCents, model.currencyCode)}{" "}
                  accrued
                </p>
              </div>
            </div>

            <InlineNotice
              className="mt-6"
              tone={selected.salesSampleDays ? "info" : "warning"}
              title={
                selected.salesSampleDays
                  ? "Compare averages, not raw totals"
                  : "No sales observation for this hour"
              }
            >
              {selected.salesSampleDays
                ? `${currency(Math.round(selected.revenueCents / selected.salesSampleDays), model.currencyCode)} average revenue per observed sales day. Confirm source coverage and service context before changing staffing.`
                : "Labor or reservation activity may still be present. Treat this as a coverage question until the sales source is proven complete."}
            </InlineNotice>
          </>
        ) : null}
      </Drawer>
    </div>
  );
}

function SlowBusySummary({ model }: { model: IncomeOperatingModel }) {
  const summary = deriveIncomePlanningSummary(model);
  const basisDescription =
    summary.basis === "recorded_revenue"
      ? "average recorded revenue per observed sales day"
      : "average reserved covers per calendar day";
  return (
    <div className="grid gap-3 sm:grid-cols-3">
      <div className="rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)] p-4">
        <p className="eyebrow">Busiest recorded hour</p>
        <p className="mt-2 text-2xl font-medium">
          {summary.busiest
            ? hourLabel(summary.busiest.bucket.hour)
            : "Not enough data"}
        </p>
        <p className="mt-1 text-xs text-[var(--ink-faint)]">
          {summary.basis
            ? `Ranked by ${basisDescription}.`
            : "No demand evidence is recorded."}
        </p>
      </div>
      <div className="rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)] p-4">
        <p className="eyebrow">Slowest active hour</p>
        <p className="mt-2 text-2xl font-medium">
          {summary.slowest
            ? hourLabel(summary.slowest.bucket.hour)
            : "Not enough data"}
        </p>
        <p className="mt-1 text-xs text-[var(--ink-faint)]">
          {summary.observedHourCount} comparable observed hour(s).
        </p>
      </div>
      <div className="rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)] p-4">
        <p className="eyebrow">Coverage to inspect</p>
        <p className="numeric mt-2 text-2xl font-medium">
          {summary.staffedWithoutDemand.length} hour(s)
        </p>
        <p className="mt-1 text-xs text-[var(--ink-faint)]">
          Labor recorded without check or reservation demand; investigate before
          changing staffing.
        </p>
      </div>
    </div>
  );
}

function sourceTone(
  freshness: "current" | "stale" | "unavailable" | null,
): "positive" | "warning" | "neutral" {
  if (freshness === "current") return "positive";
  if (freshness === "stale") return "warning";
  return "neutral";
}

function PlanningInsightAction({
  insight,
  access,
}: {
  insight: IncomePlanningInsight;
  access: IncomeActionAccess;
}) {
  if (insight.kind === "busy_hour") {
    if (access.canManageSchedule || access.canViewSchedule) {
      return (
        <a
          href="/schedule"
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          {access.canManageSchedule ? "Plan coverage" : "Review schedule"}
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </a>
      );
    }
    return (
      <p className="text-xs leading-5 text-[var(--ink-faint)]">
        Schedule access is required to act on this finding.
      </p>
    );
  }

  if (insight.kind === "staffed_without_demand") {
    if (access.canManageSchedule) {
      return (
        <a
          href="/schedule"
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          Review staffing
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </a>
      );
    }
    if (access.canOpenTimeClock) {
      return (
        <a
          href="/time-clock"
          className={buttonVariants({ variant: "secondary", size: "sm" })}
        >
          Review time clock
          <ArrowRight className="size-3.5" aria-hidden="true" />
        </a>
      );
    }
    return (
      <p className="text-xs leading-5 text-[var(--ink-faint)]">
        Time-clock or schedule access is required to investigate.
      </p>
    );
  }

  if (access.canManageIntegrations) {
    return (
      <a
        href="/integrations"
        className={buttonVariants({ variant: "secondary", size: "sm" })}
      >
        Review sources
        <ArrowRight className="size-3.5" aria-hidden="true" />
      </a>
    );
  }
  return (
    <p className="text-xs leading-5 text-[var(--ink-faint)]">
      An integrations manager can resolve source coverage.
    </p>
  );
}

function PlanningInsights({
  model,
  access,
}: {
  model: IncomeOperatingModel;
  access: IncomeActionAccess;
}) {
  const insights = deriveIncomePlanningInsights(model);

  return (
    <section className="mt-8" aria-label="Planning insights">
      <SectionHeading
        eyebrow="Insight to action"
        title="Planning insights"
        detail="Deterministic findings with their evidence, freshness, and one safe next step."
      />
      <div className="grid gap-3 lg:grid-cols-3">
        {insights.map((insight) => {
          if (insight.kind === "busy_hour") {
            const revenueBasis = insight.basis === "recorded_revenue";
            return (
              <article
                key={insight.kind}
                className="flex min-h-[280px] flex-col rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <CalendarRange
                    className="size-5 text-[var(--accent)]"
                    aria-hidden="true"
                  />
                  <StatusPill tone={sourceTone(insight.sourceFreshness)}>
                    {insight.sourceFreshness ?? "demand signal"}
                  </StatusPill>
                </div>
                <h3 className="mt-5 text-sm font-semibold">
                  Busy-hour capacity
                </h3>
                <p className="mt-1 text-2xl font-medium tracking-[-0.035em]">
                  {insight.bucket
                    ? `${hourLabel(insight.bucket.hour)} is the busiest observed hour`
                    : "More history is needed"}
                </p>
                <p className="mt-3 text-xs leading-5 text-[var(--ink-faint)]">
                  {insight.bucket && insight.average !== null
                    ? revenueBasis
                      ? `${currency(Math.round(insight.average), model.currencyCode)} average recorded revenue across ${insight.sampleDays} observed sales ${insight.sampleDays === 1 ? "day" : "days"}; ${insight.bucket.salesCovers} recorded covers and ${insight.bucket.reservationCovers} reserved covers in the selected history.`
                      : `${insight.average.toFixed(1)} reserved covers per day across ${insight.sampleDays} calendar day(s). Revenue was not used.`
                    : "No comparable sales or reservation-demand evidence is available."}
                </p>
                <div className="mt-auto pt-5">
                  <PlanningInsightAction insight={insight} access={access} />
                </div>
              </article>
            );
          }

          if (insight.kind === "staffed_without_demand") {
            const hourRange = insight.buckets
              .map((bucket) => hourLabel(bucket.hour))
              .join(", ");
            return (
              <article
                key={insight.kind}
                className="flex min-h-[280px] flex-col rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] p-5"
              >
                <div className="flex items-start justify-between gap-3">
                  <UserRoundCheck
                    className="size-5 text-[var(--warning)]"
                    aria-hidden="true"
                  />
                  <StatusPill tone={sourceTone(insight.timeClockFreshness)}>
                    clock {insight.timeClockFreshness}
                  </StatusPill>
                </div>
                <h3 className="mt-5 text-sm font-semibold">
                  Staffed without recorded demand
                </h3>
                <p className="mt-1 text-2xl font-medium tracking-[-0.035em]">
                  {insight.buckets.length
                    ? `${insight.buckets.length} hour${insight.buckets.length === 1 ? "" : "s"} to investigate`
                    : "No coverage exception found"}
                </p>
                <p className="mt-3 text-xs leading-5 text-[var(--ink-faint)]">
                  {insight.buckets.length
                    ? `${hourRange}: ${(insight.laborMinutes / 60).toFixed(1)} labor hours and ${currency(insight.laborCostCents, model.currencyCode)} known labor with no recorded check observation or reserved covers. Sales source is ${insight.salesFreshness}; verify context before changing staffing.`
                    : "Every staffed hour has at least one recorded sales observation or reservation-demand signal in this view."}
                </p>
                <div className="mt-auto pt-5">
                  <PlanningInsightAction insight={insight} access={access} />
                </div>
              </article>
            );
          }

          const issueLabels = insight.issues
            .map((source) => `${source.label} (${source.freshness})`)
            .join(", ");
          return (
            <article
              key={insight.kind}
              className="flex min-h-[280px] flex-col rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] p-5"
            >
              <div className="flex items-start justify-between gap-3">
                <DatabaseZap
                  className="size-5 text-[var(--positive)]"
                  aria-hidden="true"
                />
                <StatusPill
                  tone={insight.issues.length ? "warning" : "positive"}
                >
                  {insight.currentSourceCount}/{insight.totalSourceCount}{" "}
                  current
                </StatusPill>
              </div>
              <h3 className="mt-5 text-sm font-semibold">Data coverage</h3>
              <p className="mt-1 text-2xl font-medium tracking-[-0.035em]">
                {insight.issues.length
                  ? "Resolve gaps before making structural changes"
                  : "Planning sources are current"}
              </p>
              <p className="mt-3 text-xs leading-5 text-[var(--ink-faint)]">
                {insight.issues.length
                  ? `${issueLabels}. Rankings show observed evidence only; missing data is never treated as zero activity.`
                  : "Sales checks, time entries, expenses, and closeouts all meet their source-specific freshness thresholds."}
              </p>
              <div className="mt-auto pt-5">
                <PlanningInsightAction insight={insight} access={access} />
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

export function IncomeWorkspace({
  result,
  locationName,
  realtimeScope,
  actionAccess = noIncomeActionAccess,
  demo = false,
}: {
  result: LiveReadResult<IncomeOperatingModel>;
  locationName: string;
  realtimeScope?: { organizationId: string; locationId: string };
  actionAccess?: IncomeActionAccess;
  demo?: boolean;
}) {
  const router = useRouter();
  const realtime = useRealtimeInvalidation({
    enabled: !demo && Boolean(realtimeScope) && result.ok,
    channelName: `income-${realtimeScope?.organizationId ?? "disabled"}-${realtimeScope?.locationId ?? "disabled"}`,
    bindings: incomeRealtimeBindings,
    organizationId: realtimeScope?.organizationId ?? "",
    locationId: realtimeScope?.locationId ?? "",
  });
  useEffect(() => {
    if (demo) return;
    // Service-role sales evidence cannot be exposed through browser Realtime.
    // Keep a low-frequency authoritative refresh as the safe provider fallback.
    const timer = window.setInterval(() => {
      if (navigator.onLine) router.refresh();
    }, 60_000);
    return () => window.clearInterval(timer);
  }, [demo, router]);

  const refreshLabel = useMemo(
    () =>
      result.ok
        ? `Observed ${new Intl.DateTimeFormat("en-US", {
            hour: "numeric",
            minute: "2-digit",
            timeZone: result.data.timeZone,
          }).format(new Date(result.data.observedAt))}`
        : "Unavailable",
    [result],
  );

  if (!result.ok) {
    return (
      <PageFrame>
        <ReadState
          className="mx-auto mt-[10svh] max-w-xl"
          state="unavailable"
          title="Income unavailable"
          description={result.message}
          detail="No revenue, cost, or profitability values were estimated."
          headingLevel={1}
        />
      </PageFrame>
    );
  }

  const model = result.data;
  const laborCoverage =
    model.current.laborMinutes === 0
      ? 100
      : Math.round(
          (model.current.laborKnownRateMinutes / model.current.laborMinutes) *
            100,
        );
  const salesSource = model.sources.find(
    (source) => source.key === "sales_checks",
  );
  const liveUnavailable = model.current.liveNetSalesCents === null;

  return (
    <PageFrame width="full" className="max-w-[1700px]">
      <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={liveUnavailable ? "warning" : "positive"} dot>
              {liveUnavailable
                ? "Live sales unavailable"
                : demo
                  ? "Synthetic preview"
                  : "Live operating view"}
            </StatusPill>
            <span className="flex items-center gap-1.5 text-xs text-[var(--ink-faint)]">
              <RefreshCw className="size-3" />
              {refreshLabel} · refreshes every minute
            </span>
          </div>
          <h1 className="mt-3 text-3xl font-medium tracking-[-0.055em]">
            Income
          </h1>
          <p className="mt-1 text-[13px] text-[var(--ink-faint)]">
            Revenue, recorded costs, labor, and hourly demand for {locationName}
            .
          </p>
        </div>
        <nav
          aria-label="Income history"
          className="flex min-h-11 items-center rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] p-1"
        >
          {[7, 28, 56].map((days) => (
            <a
              key={days}
              href={`/income?days=${days}`}
              aria-current={model.historyDays === days ? "page" : undefined}
              className={cn(
                "focus-ring inline-flex min-h-9 items-center rounded-lg px-3 text-xs font-semibold",
                model.historyDays === days
                  ? "bg-[var(--ink)] text-[var(--paper)]"
                  : "text-[var(--ink-faint)] hover:text-[var(--ink)]",
              )}
            >
              {days} days
            </a>
          ))}
        </nav>
      </header>
      <RealtimeSyncStatus {...realtime} />

      {liveUnavailable ? (
        <InlineNotice
          className="mt-6"
          tone="warning"
          title="A real-time revenue source is not connected"
        >
          Labor, recorded expenses, closeouts, and reservation demand remain
          visible. Revenue and tracked contribution stay blank until approved
          check facts arrive.
        </InlineNotice>
      ) : null}

      <section
        aria-label="Current operating income metrics"
        className="mt-7 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] lg:grid-cols-4 lg:divide-y-0"
      >
        <Metric
          label="Live net revenue"
          value={currency(model.current.liveNetSalesCents, model.currencyCode)}
          detail={`${model.current.salesCheckCount} checks · ${model.current.salesCovers} covers`}
        />
        <Metric
          label="Accrued labor"
          value={currency(model.current.laborCostCents, model.currencyCode)}
          detail={`${(model.current.laborMinutes / 60).toFixed(1)}h · ${laborCoverage}% rate coverage`}
        />
        <Metric
          label="Recorded expenses"
          value={currency(
            model.current.recordedExpenseCents,
            model.currencyCode,
          )}
          detail={`${model.current.recordedExpenseCount} day-level records`}
        />
        <Metric
          label="Tracked contribution"
          value={currency(
            model.current.trackedContributionCents,
            model.currencyCode,
          )}
          detail="Revenue − known labor − recorded expenses; not profit"
        />
      </section>

      <div className="mt-8 grid gap-8 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section className="min-w-0">
          <SectionHeading
            eyebrow={`${model.historyDays}-day profile`}
            title="When service is busy—and when it is not"
            detail="Hourly recorded revenue, reservation demand, and accrued labor provide a planning baseline."
          />
          <HourlyProfile model={model} />
          <div className="mt-5">
            <SlowBusySummary model={model} />
          </div>
          <PlanningInsights model={model} access={actionAccess} />
        </section>

        <aside className="space-y-7">
          <section>
            <SectionHeading
              eyebrow="Current operating day"
              title={model.businessDate}
              detail={`${dateTimeLabel(model.windowStartsAt, model.timeZone)} – ${dateTimeLabel(model.windowEndsAt, model.timeZone)}`}
            />
            <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
              <div className="flex gap-3 py-4">
                <UsersRound className="mt-0.5 size-4 text-[var(--accent)]" />
                <div>
                  <p className="text-sm font-semibold">
                    {model.current.activeTimeEntryCount} clocked in
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    {model.current.laborMinutes} paid minutes accrued
                  </p>
                </div>
              </div>
              <div className="flex gap-3 py-4">
                <WalletCards className="mt-0.5 size-4 text-[var(--warning)]" />
                <div>
                  <p className="text-sm font-semibold">
                    {currency(
                      model.current.receivedInventoryCostCents,
                      model.currencyCode,
                    )}{" "}
                    received
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    Purchase receipt cost, not same-day COGS
                  </p>
                </div>
              </div>
              <div className="flex gap-3 py-4">
                <Activity className="mt-0.5 size-4 text-[var(--danger)]" />
                <div>
                  <p className="text-sm font-semibold">
                    {currency(
                      model.current.approvedWasteCostCents,
                      model.currencyCode,
                    )}{" "}
                    approved waste
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    {model.current.wasteMissingCostCount} approved record(s)
                    missing cost
                  </p>
                </div>
              </div>
              <div className="flex gap-3 py-4">
                <BadgeDollarSign className="mt-0.5 size-4 text-[var(--positive)]" />
                <div>
                  <p className="text-sm font-semibold">
                    {currency(
                      model.current.closeoutNetSalesCents,
                      model.currencyCode,
                    )}{" "}
                    closeout revenue
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    {model.current.approvedCloseoutCount}/
                    {model.current.closeoutCount} closeouts approved
                  </p>
                </div>
              </div>
            </div>
          </section>

          <section>
            <SectionHeading eyebrow="Evidence" title="Source freshness" />
            <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
              {model.sources.map((source) => (
                <div
                  key={source.key}
                  className="flex items-start justify-between gap-3 py-3.5"
                >
                  <div>
                    <p className="text-xs font-semibold">{source.label}</p>
                    <p className="mt-1 text-[11px] text-[var(--ink-faint)]">
                      {source.recordCount} records ·{" "}
                      {source.grain.replaceAll("_", " ")}
                    </p>
                  </div>
                  <StatusPill
                    tone={
                      source.freshness === "current"
                        ? "positive"
                        : source.freshness === "stale"
                          ? "warning"
                          : "neutral"
                    }
                  >
                    {source.freshness}
                  </StatusPill>
                </div>
              ))}
            </div>
            <p className="mt-3 flex items-start gap-2 text-xs leading-5 text-[var(--ink-faint)]">
              <Clock3 className="mt-0.5 size-3.5 shrink-0" />
              Sales:{" "}
              {freshnessLabel(
                salesSource?.lastObservedAt ?? null,
                model.timeZone,
              )}
              . Provider status and source-data freshness are intentionally
              separate.
            </p>
          </section>
        </aside>
      </div>

      <InlineNotice className="mt-8" tone="info" title="How to read this view">
        This is an operating snapshot, not GAAP profit. Expenses are recorded
        day-level costs; received inventory is a purchasing diagnostic;
        reservation covers indicate demand only. Hourly comparisons become more
        reliable as complete check and time-clock history accumulates.
      </InlineNotice>
    </PageFrame>
  );
}
