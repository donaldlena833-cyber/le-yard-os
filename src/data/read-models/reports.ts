import "server-only";

import type {
  ReportChartPoint,
  ReportFilters,
  ReportMetric,
  ReportRow,
  ReportView,
} from "@/components/reports/report-data";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/server";
import type { UserScopedSupabaseClient } from "@/data/types";
import type { ReportKind } from "@/types";
import { canAccessReportKind } from "@/lib/permissions/report-access";
import {
  isIsoCalendarDate,
  localDateKey,
  readFailure,
  readSuccess,
  type LiveReadResult,
} from "./shared";

const MAX_ROWS = 5_001;
const reportKinds = new Set<ReportKind>([
  "labor",
  "attendance",
  "overtime",
  "tips",
  "payroll",
  "sales_to_labor",
  "receipts",
  "expenses",
  "inventory_variance",
  "cogs",
  "waste",
  "vendor_pricing",
  "shift_performance",
  "guest_activity",
]);

export interface LiveReportLocation {
  id: string;
  name: string;
  timeZone: string;
}

export interface LiveReportsModel {
  view: ReportView;
  filters: ReportFilters;
  locations: LiveReportLocation[];
  generatedAt: string;
  truncated: boolean;
}

interface BaseContext {
  supabase: UserScopedSupabaseClient;
  organizationId: string;
  currencyCode: string;
  filters: ReportFilters;
  locations: LiveReportLocation[];
  locationById: Map<string, LiveReportLocation>;
  employees: Map<string, string>;
  jobs: Map<string, string>;
  vendors: Map<string, string>;
  items: Map<string, string>;
  units: Map<string, string>;
  generatedAt: string;
}

function formatMoney(cents: number, currencyCode: string): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: currencyCode,
    maximumFractionDigits: 2,
  }).format(cents / 100);
}

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(2)}h`;
}

function count(value: number): string {
  return new Intl.NumberFormat("en-US").format(value);
}

function inRange(date: string, filters: ReportFilters): boolean {
  return date >= filters.startsOn && date <= filters.endsOn;
}

function selectedLocation(base: BaseContext, locationId: string): boolean {
  return base.filters.locationId === "all" || base.filters.locationId === locationId;
}

function timestampInRange(base: BaseContext, locationId: string, timestamp: string): boolean {
  const location = base.locationById.get(locationId);
  if (!location || !selectedLocation(base, locationId)) return false;
  return inRange(localDateKey(new Date(timestamp), location.timeZone), base.filters);
}

function broadTimestampRange(filters: ReportFilters) {
  const start = new Date(`${filters.startsOn}T00:00:00.000Z`);
  const end = new Date(`${filters.endsOn}T23:59:59.999Z`);
  start.setUTCDate(start.getUTCDate() - 2);
  end.setUTCDate(end.getUTCDate() + 2);
  return { start: start.toISOString(), end: end.toISOString() };
}

function locationName(base: BaseContext, locationId: string): string {
  return base.locationById.get(locationId)?.name ?? "Location";
}

function latest(values: Array<string | null | undefined>): string | null {
  return values.reduce<string | null>(
    (current, value) => (value && (!current || value > current) ? value : current),
    null,
  );
}

function emptyPoints(label = "No matching records"): ReportChartPoint[] {
  return [{ label, value: 0, displayValue: "0", tone: "neutral" }];
}

function byLocation(
  base: BaseContext,
  value: (locationId: string) => number,
  display: (value: number) => string,
): ReportChartPoint[] {
  const points = base.locations
    .filter((location) => selectedLocation(base, location.id))
    .map((location) => {
      const amount = value(location.id);
      return {
        label: location.name,
        value: amount,
        displayValue: display(amount),
        tone: "accent" as const,
      };
    });
  return points.length ? points : emptyPoints();
}

function reportView(input: {
  kind: ReportKind;
  title: string;
  description: string;
  sourceLabel: string;
  freshnessAt: string | null;
  coverageNote: string;
  metrics: ReportMetric[];
  columns: ReportView["columns"];
  rows: ReportRow[];
  chartTitle: string;
  chartDescription: string;
  points: ReportChartPoint[];
}): ReportView {
  return {
    kind: input.kind,
    title: input.title,
    description: input.description,
    sourceLabel: input.sourceLabel,
    freshnessAt: input.freshnessAt,
    coverageNote: input.coverageNote,
    metrics: input.metrics,
    columns: input.columns,
    rows: input.rows,
    chart: {
      title: input.chartTitle,
      description: input.chartDescription,
      points: input.points.length ? input.points : emptyPoints(),
    },
  };
}

async function loadTimeEvidence(base: BaseContext) {
  const range = broadTimestampRange(base.filters);
  let entryQuery = base.supabase
    .from("time_entries")
    .select("id, location_id, employee_id, job_role_id, scheduled_shift_id, clocked_in_at, clocked_out_at, status, source, submitted_at, approved_at, updated_at")
    .eq("organization_id", base.organizationId)
    .gte("clocked_in_at", range.start)
    .lte("clocked_in_at", range.end)
    .order("clocked_in_at", { ascending: false })
    .limit(MAX_ROWS);
  if (base.filters.locationId !== "all") {
    entryQuery = entryQuery.eq("location_id", base.filters.locationId);
  }
  const entryResult = await entryQuery;
  if (entryResult.error) throw entryResult.error;
  const broadEntries = entryResult.data ?? [];
  const entries = broadEntries.filter((entry) =>
    timestampInRange(base, entry.location_id, entry.clocked_in_at),
  );
  const entryIds = entries.map((entry) => entry.id);
  if (!entryIds.length) {
    return { entries, breaks: [], corrections: [], truncated: broadEntries.length >= MAX_ROWS };
  }
  const [breakResult, correctionResult] = await Promise.all([
    base.supabase
      .from("time_breaks")
      .select("id, time_entry_id, started_at, ended_at, is_paid, updated_at")
      .eq("organization_id", base.organizationId)
      .in("time_entry_id", entryIds)
      .limit(MAX_ROWS),
    base.supabase
      .from("time_entry_corrections")
      .select("id, time_entry_id, status, created_at, updated_at")
      .eq("organization_id", base.organizationId)
      .in("time_entry_id", entryIds)
      .limit(MAX_ROWS),
  ]);
  if (breakResult.error) throw breakResult.error;
  if (correctionResult.error) throw correctionResult.error;
  return {
    entries,
    breaks: breakResult.data ?? [],
    corrections: correctionResult.data ?? [],
    truncated:
      broadEntries.length >= MAX_ROWS ||
      (breakResult.data?.length ?? 0) >= MAX_ROWS ||
      (correctionResult.data?.length ?? 0) >= MAX_ROWS,
  };
}

function paidMinutes(
  entry: { id: string; clocked_in_at: string; clocked_out_at: string | null },
  breaks: Array<{ time_entry_id: string; started_at: string; ended_at: string | null; is_paid: boolean }>,
): number | null {
  if (!entry.clocked_out_at) return null;
  const elapsed = Math.max(
    0,
    Math.round((new Date(entry.clocked_out_at).valueOf() - new Date(entry.clocked_in_at).valueOf()) / 60_000),
  );
  const unpaid = breaks
    .filter((item) => item.time_entry_id === entry.id && !item.is_paid && item.ended_at)
    .reduce(
      (sum, item) =>
        sum +
        Math.max(
          0,
          Math.round((new Date(item.ended_at!).valueOf() - new Date(item.started_at).valueOf()) / 60_000),
        ),
      0,
    );
  return Math.max(0, elapsed - unpaid);
}

async function buildPeopleReport(base: BaseContext, kind: "labor" | "attendance" | "overtime" | "payroll") {
  const money = (cents: number) => formatMoney(cents, base.currencyCode);
  const evidence = await loadTimeEvidence(base);
  const entries = evidence.entries;
  const minutes = new Map(entries.map((entry) => [entry.id, paidMinutes(entry, evidence.breaks)]));
  const totalMinutes = [...minutes.values()].reduce<number>((sum, value) => sum + (value ?? 0), 0);
  const openCount = entries.filter((entry) => !entry.clocked_out_at).length;
  const pendingCorrections = new Set(
    evidence.corrections
      .filter((correction) => correction.status === "pending")
      .map((correction) => correction.time_entry_id),
  );
  const approved = entries.filter((entry) => ["approved", "corrected"].includes(entry.status));
  const freshness = latest(
    [
      ...entries.map((entry) => entry.updated_at),
      ...evidence.breaks.map((item) => item.updated_at),
      ...evidence.corrections.map((item) => item.updated_at),
    ],
  );

  if (kind === "overtime") {
    return {
      view: reportView({
        kind,
        title: "Overtime",
        description: "Worked-time evidence awaiting an owner-configured overtime rule.",
        sourceLabel: "Time entries + breaks",
        freshnessAt: freshness,
        coverageNote:
          "No overtime rule is configured. Le Yard OS does not infer thresholds, workweeks, exemptions, or jurisdictional policy, so no hours are labeled overtime.",
        metrics: [
          { label: "Overtime", value: "Not configured", detail: "Owner policy required" },
          { label: "Worked hours", value: hours(totalMinutes), detail: `${entries.length} entries` },
          { label: "People", value: count(new Set(entries.map((entry) => entry.employee_id)).size), detail: "With source entries" },
          { label: "Open entries", value: count(openCount), detail: "Not included in worked total" },
        ],
        columns: [
          { key: "person", label: "Team member" },
          { key: "location", label: "Location" },
          { key: "date", label: "Local date" },
          { key: "worked", label: "Worked", align: "right" },
          { key: "overtime", label: "Overtime" },
          { key: "state", label: "State" },
        ],
        rows: entries.map((entry) => ({
          id: entry.id,
          cells: {
            person: base.employees.get(entry.employee_id) ?? "Team member",
            location: locationName(base, entry.location_id),
            date: localDateKey(new Date(entry.clocked_in_at), base.locationById.get(entry.location_id)!.timeZone),
            worked: minutes.get(entry.id) == null ? "Open" : hours(minutes.get(entry.id)!),
            overtime: "Rule not configured",
            state: entry.status.replaceAll("_", " "),
          },
        })),
        chartTitle: "Worked hours by location",
        chartDescription: "Paid elapsed hours after completed unpaid breaks; not classified as overtime.",
        points: byLocation(
          base,
          (locationId) =>
            entries
              .filter((entry) => entry.location_id === locationId)
              .reduce((sum, entry) => sum + (minutes.get(entry.id) ?? 0), 0) / 60,
          (value) => `${value.toFixed(2)}h`,
        ),
      }),
      truncated: evidence.truncated,
    };
  }

  if (kind === "attendance") {
    const stateCounts = new Map<string, number>();
    entries.forEach((entry) => stateCounts.set(entry.status, (stateCounts.get(entry.status) ?? 0) + 1));
    return {
      view: reportView({
        kind,
        title: "Attendance",
        description: "Punch state and correction queues without applying a lateness or attendance policy.",
        sourceLabel: "Time entries + correction requests",
        freshnessAt: freshness,
        coverageNote:
          "This report states recorded punch facts only. It does not infer lateness, absence, required breaks, or disciplinary outcomes.",
        metrics: [
          { label: "Punch records", value: count(entries.length), detail: "Selected period" },
          { label: "Open", value: count(openCount), detail: "Clock-out pending" },
          { label: "Corrections", value: count(pendingCorrections.size), detail: "Pending human review" },
          { label: "Approved", value: count(approved.length), detail: "Approved or corrected" },
        ],
        columns: [
          { key: "person", label: "Team member" },
          { key: "location", label: "Location" },
          { key: "clockIn", label: "Clock in" },
          { key: "clockOut", label: "Clock out" },
          { key: "worked", label: "Paid time", align: "right" },
          { key: "review", label: "Review" },
        ],
        rows: entries.map((entry) => ({
          id: entry.id,
          cells: {
            person: base.employees.get(entry.employee_id) ?? "Team member",
            location: locationName(base, entry.location_id),
            clockIn: entry.clocked_in_at,
            clockOut: entry.clocked_out_at ?? "Open",
            worked: minutes.get(entry.id) == null ? "—" : hours(minutes.get(entry.id)!),
            review: pendingCorrections.has(entry.id)
              ? "Correction pending"
              : entry.status.replaceAll("_", " "),
          },
        })),
        chartTitle: "Punch state",
        chartDescription: "Count of matching entries by current workflow state.",
        points: [...stateCounts.entries()].map(([label, value]) => ({
          label: label.replaceAll("_", " "),
          value,
          displayValue: count(value),
          tone: label === "open" || label === "submitted" ? "warning" : "accent",
        })),
      }),
      truncated: evidence.truncated,
    };
  }

  if (kind === "payroll") {
    let runQuery = base.supabase
      .from("tip_runs")
      .select("id, location_id, business_date, status, updated_at")
      .eq("organization_id", base.organizationId)
      .gte("business_date", base.filters.startsOn)
      .lte("business_date", base.filters.endsOn)
      .eq("status", "approved")
      .limit(MAX_ROWS);
    if (base.filters.locationId !== "all") runQuery = runQuery.eq("location_id", base.filters.locationId);
    const runResult = await runQuery;
    if (runResult.error) throw runResult.error;
    const runs = runResult.data ?? [];
    const allocationResult = runs.length
      ? await base.supabase
          .from("tip_allocations")
          .select("id, tip_run_id, employee_id, final_amount_cents, created_at")
          .eq("organization_id", base.organizationId)
          .in("tip_run_id", runs.map((run) => run.id))
          .limit(MAX_ROWS)
      : { data: [], error: null };
    if (allocationResult.error) throw allocationResult.error;
    const allocations = allocationResult.data ?? [];
    const employeeIds = [...new Set([...entries.map((entry) => entry.employee_id), ...allocations.map((allocation) => allocation.employee_id)])];
    const rows = employeeIds.map((employeeId) => {
      const cards = entries.filter((entry) => entry.employee_id === employeeId);
      const approvedMinutes = cards
        .filter((entry) => ["approved", "corrected"].includes(entry.status))
        .reduce((sum, entry) => sum + (minutes.get(entry.id) ?? 0), 0);
      const tips = allocations
        .filter((allocation) => allocation.employee_id === employeeId)
        .reduce((sum, allocation) => sum + Number(allocation.final_amount_cents), 0);
      const needsReview = cards.some((entry) => !["approved", "corrected"].includes(entry.status));
      return {
        id: employeeId,
        cells: {
          person: base.employees.get(employeeId) ?? "Team member",
          hours: hours(approvedMinutes),
          entries: count(cards.length),
          tips: money(tips),
          readiness: needsReview ? "Needs time review" : "Hours and tips approved",
        },
        approvedMinutes,
        tips,
        needsReview,
      };
    });
    return {
      view: reportView({
        kind,
        title: "Payroll readiness",
        description: "Approved hours and locked tips prepared for provider export, without calculating wages or taxes.",
        sourceLabel: "Time entries + approved tip allocations",
        freshnessAt: latest(
          [freshness, ...runs.map((run) => run.updated_at), ...allocations.map((item) => item.created_at)],
        ),
        coverageNote:
          "Payroll transmission, wage calculation, taxes, deductions, and filing remain outside Le Yard OS. Only approved/corrected time and approved tip runs are included in readiness totals.",
        metrics: [
          { label: "Approved hours", value: hours(rows.reduce((sum, row) => sum + row.approvedMinutes, 0)), detail: "Approved or corrected entries" },
          { label: "Approved tips", value: money(rows.reduce((sum, row) => sum + row.tips, 0)), detail: `${runs.length} locked runs` },
          { label: "People", value: count(rows.length), detail: "With time or tips" },
          { label: "Needs review", value: count(rows.filter((row) => row.needsReview).length), detail: "Before provider export" },
        ],
        columns: [
          { key: "person", label: "Team member" },
          { key: "hours", label: "Approved hours", align: "right" },
          { key: "entries", label: "Time entries", align: "right" },
          { key: "tips", label: "Approved tips", align: "right" },
          { key: "readiness", label: "Readiness" },
        ],
        rows: rows.map(({ id, cells }) => ({ id, cells })),
        chartTitle: "Approved hours by employee",
        chartDescription: "Paid hours from approved or corrected entries only.",
        points: rows.map((row) => ({
          label: row.cells.person,
          value: row.approvedMinutes / 60,
          displayValue: hours(row.approvedMinutes),
          tone: row.needsReview ? "warning" : "positive",
        })),
      }),
      truncated:
        evidence.truncated ||
        runs.length >= MAX_ROWS ||
        allocations.length >= MAX_ROWS,
    };
  }

  return {
    view: reportView({
      kind: "labor",
      title: "Labor",
      description: "Paid elapsed time from recorded entries and completed unpaid breaks.",
      sourceLabel: "Time entries + breaks",
      freshnessAt: freshness,
      coverageNote:
        "Hours are source evidence only. Open entries are shown but excluded from totals; wage rates, payroll burden, and overtime are not estimated.",
      metrics: [
        { label: "Worked hours", value: hours(totalMinutes), detail: `${entries.length} entries` },
        { label: "Approved hours", value: hours(approved.reduce((sum, entry) => sum + (minutes.get(entry.id) ?? 0), 0)), detail: `${approved.length} approved/corrected` },
        { label: "People", value: count(new Set(entries.map((entry) => entry.employee_id)).size), detail: "With source entries" },
        { label: "Open entries", value: count(openCount), detail: "Excluded from total" },
      ],
      columns: [
        { key: "person", label: "Team member" },
        { key: "location", label: "Location" },
        { key: "role", label: "Job" },
        { key: "clockIn", label: "Clock in" },
        { key: "clockOut", label: "Clock out" },
        { key: "worked", label: "Paid time", align: "right" },
        { key: "state", label: "State" },
      ],
      rows: entries.map((entry) => ({
        id: entry.id,
        cells: {
          person: base.employees.get(entry.employee_id) ?? "Team member",
          location: locationName(base, entry.location_id),
          role: base.jobs.get(entry.job_role_id) ?? "Job role",
          clockIn: entry.clocked_in_at,
          clockOut: entry.clocked_out_at ?? "Open",
          worked: minutes.get(entry.id) == null ? "—" : hours(minutes.get(entry.id)!),
          state: entry.status.replaceAll("_", " "),
        },
      })),
      chartTitle: "Paid hours by location",
      chartDescription: "Elapsed hours less completed unpaid breaks.",
      points: byLocation(
        base,
        (locationId) =>
          entries
            .filter((entry) => entry.location_id === locationId)
            .reduce((sum, entry) => sum + (minutes.get(entry.id) ?? 0), 0) / 60,
        (value) => `${value.toFixed(2)}h`,
      ),
    }),
    truncated: evidence.truncated,
  };
}

async function buildTipsReport(base: BaseContext) {
  const money = (cents: number) => formatMoney(cents, base.currencyCode);
  let runQuery = base.supabase
    .from("tip_runs")
    .select("id, location_id, business_date, shift_label, status, distributable_cents, allocated_cents, calculated_at, approved_at, updated_at")
    .eq("organization_id", base.organizationId)
    .gte("business_date", base.filters.startsOn)
    .lte("business_date", base.filters.endsOn)
    .order("business_date", { ascending: false })
    .limit(MAX_ROWS);
  if (base.filters.locationId !== "all") runQuery = runQuery.eq("location_id", base.filters.locationId);
  const runResult = await runQuery;
  if (runResult.error) throw runResult.error;
  const runs = runResult.data ?? [];
  const sourceResult = runs.length
    ? await base.supabase
        .from("tip_sources")
        .select("id, tip_run_id, source_type, amount_cents, is_distributable, created_at")
        .eq("organization_id", base.organizationId)
        .in("tip_run_id", runs.map((run) => run.id))
        .limit(MAX_ROWS)
    : { data: [], error: null };
  if (sourceResult.error) throw sourceResult.error;
  const sources = sourceResult.data ?? [];
  const distributable = runs.reduce((sum, run) => sum + Number(run.distributable_cents), 0);
  const allocated = runs.reduce((sum, run) => sum + Number(run.allocated_cents), 0);
  const serviceCharges = sources
    .filter((source) => source.source_type === "service_charge")
    .reduce((sum, source) => sum + Number(source.amount_cents), 0);
  const rows = runs.map((run) => {
    const ownSources = sources.filter((source) => source.tip_run_id === run.id);
    const sourceAmount = (type: string) =>
      ownSources
        .filter((source) => source.source_type === type)
        .reduce((sum, source) => sum + Number(source.amount_cents), 0);
    return {
      id: run.id,
      cells: {
        date: run.business_date,
        location: locationName(base, run.location_id),
        shift: run.shift_label,
        cash: money(sourceAmount("cash_tips")),
        card: money(sourceAmount("card_tips")),
        service: money(sourceAmount("service_charge")),
        pool: money(Number(run.distributable_cents)),
        allocated: money(Number(run.allocated_cents)),
        state: run.status,
      },
    };
  });
  return {
    view: reportView({
      kind: "tips",
      title: "Tips",
      description: "Source-separated tip pools, service charges, and approval state.",
      sourceLabel: "Tip runs + source evidence",
      freshnessAt: latest(
        [...runs.map((run) => run.updated_at), ...sources.map((source) => source.created_at)],
      ),
      coverageNote:
        "Service charges are displayed separately and are included in the pool only when the approved policy explicitly marks them distributable. Draft/calculated rows are not payroll-ready.",
      metrics: [
        { label: "Distributable", value: money(distributable), detail: `${runs.length} runs` },
        { label: "Allocated", value: money(allocated), detail: allocated === distributable ? "Cent reconciled" : "Includes unapproved/draft runs" },
        { label: "Service charges", value: money(serviceCharges), detail: "Source-separated" },
        { label: "Approved", value: count(runs.filter((run) => run.status === "approved").length), detail: "Locked runs" },
      ],
      columns: [
        { key: "date", label: "Business date" },
        { key: "location", label: "Location" },
        { key: "shift", label: "Shift" },
        { key: "cash", label: "Cash tips", align: "right" },
        { key: "card", label: "Card tips", align: "right" },
        { key: "service", label: "Service charge", align: "right" },
        { key: "pool", label: "Pool", align: "right" },
        { key: "allocated", label: "Allocated", align: "right" },
        { key: "state", label: "State" },
      ],
      rows,
      chartTitle: "Distributable tips by location",
      chartDescription: "Policy-derived pool amounts; service-charge sources remain separately evidenced.",
      points: byLocation(
        base,
        (locationId) =>
          runs
            .filter((run) => run.location_id === locationId)
            .reduce((sum, run) => sum + Number(run.distributable_cents), 0),
        money,
      ),
    }),
    truncated: runs.length >= MAX_ROWS || sources.length >= MAX_ROWS,
  };
}

async function buildCloseoutReport(base: BaseContext, kind: "sales_to_labor" | "shift_performance") {
  const money = (cents: number) => formatMoney(cents, base.currencyCode);
  let closeoutQuery = base.supabase
    .from("shift_closeouts")
    .select("id, location_id, business_date, shift_label, status, gross_sales_cents, net_sales_cents, covers, comps_cents, voids_cents, service_charges_cents, submitted_at, approved_at, updated_at")
    .eq("organization_id", base.organizationId)
    .gte("business_date", base.filters.startsOn)
    .lte("business_date", base.filters.endsOn)
    .order("business_date", { ascending: false })
    .limit(MAX_ROWS);
  if (base.filters.locationId !== "all") closeoutQuery = closeoutQuery.eq("location_id", base.filters.locationId);
  const closeoutResult = await closeoutQuery;
  if (closeoutResult.error) throw closeoutResult.error;
  const closeouts = closeoutResult.data ?? [];

  if (kind === "shift_performance") {
    const netSales = closeouts.reduce((sum, row) => sum + Number(row.net_sales_cents), 0);
    const covers = closeouts.reduce((sum, row) => sum + row.covers, 0);
    return {
      view: reportView({
        kind,
        title: "Shift performance",
        description: "Closeout sales, covers, comps, voids, and workflow state by service shift.",
        sourceLabel: "Shift closeouts",
        freshnessAt: latest(closeouts.map((row) => row.updated_at)),
        coverageNote:
          "No subjective performance score is generated. Rows preserve the submitted closeout facts and approval state.",
        metrics: [
          { label: "Net sales", value: money(netSales), detail: `${closeouts.length} closeouts` },
          { label: "Covers", value: count(covers), detail: "Recorded covers" },
          { label: "Sales / cover", value: covers ? money(Math.round(netSales / covers)) : "—", detail: "Net sales divided by covers" },
          { label: "Approved", value: count(closeouts.filter((row) => row.status === "approved").length), detail: "Independently reviewed" },
        ],
        columns: [
          { key: "date", label: "Business date" },
          { key: "location", label: "Location" },
          { key: "shift", label: "Shift" },
          { key: "net", label: "Net sales", align: "right" },
          { key: "covers", label: "Covers", align: "right" },
          { key: "perCover", label: "Per cover", align: "right" },
          { key: "comps", label: "Comps", align: "right" },
          { key: "voids", label: "Voids", align: "right" },
          { key: "state", label: "State" },
        ],
        rows: closeouts.map((row) => ({
          id: row.id,
          cells: {
            date: row.business_date,
            location: locationName(base, row.location_id),
            shift: row.shift_label,
            net: money(Number(row.net_sales_cents)),
            covers: count(row.covers),
            perCover: row.covers ? money(Math.round(Number(row.net_sales_cents) / row.covers)) : "—",
            comps: money(Number(row.comps_cents)),
            voids: money(Number(row.voids_cents)),
            state: row.status,
          },
        })),
        chartTitle: "Net sales by closeout",
        chartDescription: "Recorded net sales for each shift closeout.",
        points: closeouts.map((row) => ({
          label: `${row.business_date} · ${row.shift_label}`,
          value: Number(row.net_sales_cents),
          displayValue: money(Number(row.net_sales_cents)),
          tone: row.status === "approved" ? "positive" : "warning",
        })),
      }),
      truncated: closeouts.length >= MAX_ROWS,
    };
  }

  const timeEvidence = await loadTimeEvidence(base);
  const minutesByLocationDate = new Map<string, number>();
  for (const entry of timeEvidence.entries) {
    const minutes = paidMinutes(entry, timeEvidence.breaks) ?? 0;
    const timeZone = base.locationById.get(entry.location_id)?.timeZone;
    if (!timeZone) continue;
    const date = localDateKey(new Date(entry.clocked_in_at), timeZone);
    const key = `${entry.location_id}:${date}`;
    minutesByLocationDate.set(key, (minutesByLocationDate.get(key) ?? 0) + minutes);
  }
  const approvedCloseouts = closeouts.filter((row) => row.status === "approved");
  const totalSales = approvedCloseouts.reduce((sum, row) => sum + Number(row.net_sales_cents), 0);
  const totalMinutes = [...minutesByLocationDate.values()].reduce((sum, value) => sum + value, 0);
  return {
    view: reportView({
      kind,
      title: "Sales to labor",
      description: "Approved net sales compared with recorded paid labor hours.",
      sourceLabel: "Approved closeouts + time entries",
      freshnessAt: latest(
        [...closeouts.map((row) => row.updated_at), ...timeEvidence.entries.map((entry) => entry.updated_at)],
      ),
      coverageNote:
        "This is net sales per paid labor hour, not labor-cost percentage. Wage rates and payroll burden are not estimated; only approved closeouts contribute sales.",
      metrics: [
        { label: "Approved net sales", value: money(totalSales), detail: `${approvedCloseouts.length} closeouts` },
        { label: "Paid labor hours", value: hours(totalMinutes), detail: "Closed time entries" },
        { label: "Sales / paid hour", value: totalMinutes ? money(Math.round(totalSales / (totalMinutes / 60))) : "—", detail: "Not labor-cost %" },
        { label: "Pending closeouts", value: count(closeouts.length - approvedCloseouts.length), detail: "Excluded from sales" },
      ],
      columns: [
        { key: "date", label: "Business date" },
        { key: "location", label: "Location" },
        { key: "sales", label: "Approved net sales", align: "right" },
        { key: "hours", label: "Paid hours", align: "right" },
        { key: "perHour", label: "Sales / hour", align: "right" },
        { key: "state", label: "Closeout" },
      ],
      rows: closeouts.map((row) => {
        const minutes = minutesByLocationDate.get(`${row.location_id}:${row.business_date}`) ?? 0;
        const sales = row.status === "approved" ? Number(row.net_sales_cents) : 0;
        return {
          id: row.id,
          cells: {
            date: row.business_date,
            location: locationName(base, row.location_id),
            sales: row.status === "approved" ? money(sales) : "Excluded",
            hours: hours(minutes),
            perHour: minutes && row.status === "approved" ? money(Math.round(sales / (minutes / 60))) : "—",
            state: row.status,
          },
        };
      }),
      chartTitle: "Approved net sales by location",
      chartDescription: "Approved closeout net sales in the selected range.",
      points: byLocation(
        base,
        (locationId) =>
          approvedCloseouts
            .filter((row) => row.location_id === locationId)
            .reduce((sum, row) => sum + Number(row.net_sales_cents), 0),
        money,
      ),
    }),
    truncated: closeouts.length >= MAX_ROWS || timeEvidence.truncated,
  };
}

async function buildMoneyReport(base: BaseContext, kind: "receipts" | "expenses") {
  const money = (cents: number) => formatMoney(cents, base.currencyCode);
  if (kind === "receipts") {
    let query = base.supabase
      .from("receipts")
      .select("id, location_id, vendor_id, document_kind, document_number, document_date, total_cents, tax_cents, review_status, source, created_at, updated_at")
      .eq("organization_id", base.organizationId)
      .gte("document_date", base.filters.startsOn)
      .lte("document_date", base.filters.endsOn)
      .order("document_date", { ascending: false })
      .limit(MAX_ROWS);
    if (base.filters.locationId !== "all") query = query.eq("location_id", base.filters.locationId);
    const result = await query;
    if (result.error) throw result.error;
    const rows = result.data ?? [];
    const total = rows.reduce((sum, row) => sum + Number(row.total_cents ?? 0), 0);
    return {
      view: reportView({
        kind,
        title: "Receipts",
        description: "Receipt and invoice documents by document date and review state.",
        sourceLabel: "Receipt records",
        freshnessAt: latest(rows.map((row) => row.updated_at)),
        coverageNote:
          "Only records with a document date in the selected range are included. OCR suggestions remain unverified until human review.",
        metrics: [
          { label: "Documents", value: count(rows.length), detail: "Dated records" },
          { label: "Document total", value: money(total), detail: "Known totals only" },
          { label: "Approved", value: count(rows.filter((row) => row.review_status === "approved").length), detail: "Human reviewed" },
          { label: "Needs review", value: count(rows.filter((row) => ["pending", "in_review"].includes(row.review_status)).length), detail: "Not accounting-ready" },
        ],
        columns: [
          { key: "date", label: "Document date" },
          { key: "location", label: "Location" },
          { key: "vendor", label: "Vendor" },
          { key: "kind", label: "Kind" },
          { key: "number", label: "Document no." },
          { key: "tax", label: "Tax", align: "right" },
          { key: "total", label: "Total", align: "right" },
          { key: "review", label: "Review" },
        ],
        rows: rows.map((row) => ({
          id: row.id,
          cells: {
            date: row.document_date ?? "Undated",
            location: locationName(base, row.location_id),
            vendor: row.vendor_id ? base.vendors.get(row.vendor_id) ?? "Vendor" : "Unmatched",
            kind: row.document_kind.replaceAll("_", " "),
            number: row.document_number ?? "—",
            tax: row.tax_cents == null ? "—" : money(Number(row.tax_cents)),
            total: row.total_cents == null ? "—" : money(Number(row.total_cents)),
            review: row.review_status.replaceAll("_", " "),
          },
        })),
        chartTitle: "Document total by location",
        chartDescription: "Known receipt and invoice totals.",
        points: byLocation(
          base,
          (locationId) =>
            rows
              .filter((row) => row.location_id === locationId)
              .reduce((sum, row) => sum + Number(row.total_cents ?? 0), 0),
          money,
        ),
      }),
      truncated: rows.length >= MAX_ROWS,
    };
  }

  let query = base.supabase
    .from("expenses")
    .select("id, location_id, vendor_id, expense_category_id, expense_date, subtotal_cents, tax_cents, total_cents, description, updated_at")
    .eq("organization_id", base.organizationId)
    .gte("expense_date", base.filters.startsOn)
    .lte("expense_date", base.filters.endsOn)
    .order("expense_date", { ascending: false })
    .limit(MAX_ROWS);
  if (base.filters.locationId !== "all") query = query.eq("location_id", base.filters.locationId);
  const [result, categoryResult] = await Promise.all([
    query,
    base.supabase
      .from("expense_categories")
      .select("id, name")
      .eq("organization_id", base.organizationId),
  ]);
  if (result.error) throw result.error;
  if (categoryResult.error) throw categoryResult.error;
  const rows = result.data ?? [];
  const categories = new Map((categoryResult.data ?? []).map((category) => [category.id, category.name]));
  const total = rows.reduce((sum, row) => sum + Number(row.total_cents), 0);
  return {
    view: reportView({
      kind,
      title: "Expenses",
      description: "Recorded expenses by category, vendor, and location.",
      sourceLabel: "Expense records",
      freshnessAt: latest(rows.map((row) => row.updated_at)),
      coverageNote:
        "This view includes entered expense records only. It does not infer accruals, taxes, or accounting classifications.",
      metrics: [
        { label: "Expenses", value: count(rows.length), detail: "Selected period" },
        { label: "Total", value: money(total), detail: "Subtotal plus recorded tax" },
        { label: "Tax", value: money(rows.reduce((sum, row) => sum + Number(row.tax_cents), 0)), detail: "Recorded tax" },
        { label: "Uncategorized", value: count(rows.filter((row) => !row.expense_category_id).length), detail: "Needs classification" },
      ],
      columns: [
        { key: "date", label: "Expense date" },
        { key: "location", label: "Location" },
        { key: "vendor", label: "Vendor" },
        { key: "category", label: "Category" },
        { key: "description", label: "Description" },
        { key: "subtotal", label: "Subtotal", align: "right" },
        { key: "tax", label: "Tax", align: "right" },
        { key: "total", label: "Total", align: "right" },
      ],
      rows: rows.map((row) => ({
        id: row.id,
        cells: {
          date: row.expense_date,
          location: locationName(base, row.location_id),
          vendor: row.vendor_id ? base.vendors.get(row.vendor_id) ?? "Vendor" : "Unmatched",
          category: row.expense_category_id ? categories.get(row.expense_category_id) ?? "Category" : "Uncategorized",
          description: row.description ?? "—",
          subtotal: money(Number(row.subtotal_cents)),
          tax: money(Number(row.tax_cents)),
          total: money(Number(row.total_cents)),
        },
      })),
      chartTitle: "Expense total by location",
      chartDescription: "Recorded expense totals in the selected range.",
      points: byLocation(
        base,
        (locationId) =>
          rows
            .filter((row) => row.location_id === locationId)
            .reduce((sum, row) => sum + Number(row.total_cents), 0),
        money,
      ),
    }),
    truncated: rows.length >= MAX_ROWS,
  };
}

async function buildInventoryReport(
  base: BaseContext,
  kind: "inventory_variance" | "cogs" | "waste" | "vendor_pricing",
) {
  const money = (cents: number) => formatMoney(cents, base.currencyCode);
  if (kind === "inventory_variance") {
    const range = broadTimestampRange(base.filters);
    let countQuery = base.supabase
      .from("inventory_counts")
      .select("id, location_id, counted_at, status, count_type, approved_at, updated_at")
      .eq("organization_id", base.organizationId)
      .gte("counted_at", range.start)
      .lte("counted_at", range.end)
      .order("counted_at", { ascending: false })
      .limit(MAX_ROWS);
    if (base.filters.locationId !== "all") countQuery = countQuery.eq("location_id", base.filters.locationId);
    const countResult = await countQuery;
    if (countResult.error) throw countResult.error;
    const broadCounts = countResult.data ?? [];
    const counts = broadCounts.filter((row) => timestampInRange(base, row.location_id, row.counted_at));
    const lineResult = counts.length
      ? await base.supabase
          .from("inventory_count_lines")
          .select("id, inventory_count_id, inventory_item_id, unit_id, expected_quantity, counted_quantity, unit_cost_cents, created_at")
          .eq("organization_id", base.organizationId)
          .in("inventory_count_id", counts.map((row) => row.id))
          .limit(MAX_ROWS)
      : { data: [], error: null };
    if (lineResult.error) throw lineResult.error;
    const lines = lineResult.data ?? [];
    const rows = lines.map((line) => {
      const parent = counts.find((row) => row.id === line.inventory_count_id)!;
      const expected = line.expected_quantity == null ? null : Number(line.expected_quantity);
      const counted = Number(line.counted_quantity);
      const variance = expected == null ? null : counted - expected;
      const value = variance == null || line.unit_cost_cents == null
        ? null
        : Math.round(variance * Number(line.unit_cost_cents));
      return {
        id: line.id,
        parent,
        variance,
        value,
        cells: {
          date: parent.counted_at,
          location: locationName(base, parent.location_id),
          item: base.items.get(line.inventory_item_id) ?? "Inventory item",
          expected: expected == null ? "—" : `${expected} ${base.units.get(line.unit_id) ?? "unit"}`,
          counted: `${counted} ${base.units.get(line.unit_id) ?? "unit"}`,
          variance: variance == null ? "—" : variance.toFixed(4),
          value: value == null ? "—" : money(value),
          state: parent.status,
        },
      };
    });
    const approvedRows = rows.filter((row) => row.parent.status === "approved");
    const knownVariance = approvedRows.filter((row) => row.value !== null);
    return {
      view: reportView({
        kind,
        title: "Inventory variance",
        description: "Expected versus counted quantities with approval state and known cost impact.",
        sourceLabel: "Inventory counts + count lines",
        freshnessAt: latest(
          [...counts.map((row) => row.updated_at), ...lines.map((line) => line.created_at)],
        ),
        coverageNote:
          "Pending counts are shown for review but do not change on-hand inventory. Cost variance is shown only where a canonical unit cost was snapshotted.",
        metrics: [
          { label: "Count lines", value: count(rows.length), detail: `${counts.length} submitted counts` },
          { label: "Approved lines", value: count(approvedRows.length), detail: "Ledger-posted counts" },
          { label: "Known variance", value: money(knownVariance.reduce((sum, row) => sum + (row.value ?? 0), 0)), detail: "Signed cost impact" },
          { label: "Missing cost", value: count(approvedRows.filter((row) => row.value === null).length), detail: "No valuation inferred" },
        ],
        columns: [
          { key: "date", label: "Counted at" },
          { key: "location", label: "Location" },
          { key: "item", label: "Item" },
          { key: "expected", label: "Expected", align: "right" },
          { key: "counted", label: "Counted", align: "right" },
          { key: "variance", label: "Variance", align: "right" },
          { key: "value", label: "Cost impact", align: "right" },
          { key: "state", label: "State" },
        ],
        rows: rows.map(({ id, cells }) => ({ id, cells })),
        chartTitle: "Known approved variance by location",
        chartDescription: "Signed cost impact from independently approved counts with known unit cost.",
        points: byLocation(
          base,
          (locationId) =>
            knownVariance
              .filter((row) => row.parent.location_id === locationId)
              .reduce((sum, row) => sum + (row.value ?? 0), 0),
          money,
        ),
      }),
      truncated: broadCounts.length >= MAX_ROWS || lines.length >= MAX_ROWS,
    };
  }

  if (kind === "cogs") {
    let query = base.supabase
      .from("cogs_periods")
      .select("id, location_id, period_start, period_end, opening_inventory_cents, purchases_cents, transfers_in_cents, transfers_out_cents, closing_inventory_cents, cogs_cents, status, calculated_at, approved_at, updated_at")
      .eq("organization_id", base.organizationId)
      .lte("period_start", base.filters.endsOn)
      .gte("period_end", base.filters.startsOn)
      .order("period_end", { ascending: false })
      .limit(MAX_ROWS);
    if (base.filters.locationId !== "all") query = query.eq("location_id", base.filters.locationId);
    const result = await query;
    if (result.error) throw result.error;
    const rows = result.data ?? [];
    const approved = rows.filter((row) => row.status === "approved");
    return {
      view: reportView({
        kind,
        title: "Cost of goods sold",
        description: "Period COGS reconciliations from inventory and purchasing records.",
        sourceLabel: "COGS periods",
        freshnessAt: latest(rows.map((row) => row.updated_at)),
        coverageNote:
          "COGS is opening inventory plus purchases and transfers in, less transfers out and closing inventory. Only approved periods are included in the headline total.",
        metrics: [
          { label: "Approved COGS", value: money(approved.reduce((sum, row) => sum + Number(row.cogs_cents), 0)), detail: `${approved.length} periods` },
          { label: "Purchases", value: money(approved.reduce((sum, row) => sum + Number(row.purchases_cents), 0)), detail: "Approved periods" },
          { label: "Closing inventory", value: money(approved.reduce((sum, row) => sum + Number(row.closing_inventory_cents), 0)), detail: "Approved periods" },
          { label: "Needs review", value: count(rows.length - approved.length), detail: "Excluded from approved total" },
        ],
        columns: [
          { key: "period", label: "Period" },
          { key: "location", label: "Location" },
          { key: "opening", label: "Opening", align: "right" },
          { key: "purchases", label: "Purchases", align: "right" },
          { key: "transfers", label: "Net transfers", align: "right" },
          { key: "closing", label: "Closing", align: "right" },
          { key: "cogs", label: "COGS", align: "right" },
          { key: "state", label: "State" },
        ],
        rows: rows.map((row) => ({
          id: row.id,
          cells: {
            period: `${row.period_start} – ${row.period_end}`,
            location: locationName(base, row.location_id),
            opening: money(Number(row.opening_inventory_cents)),
            purchases: money(Number(row.purchases_cents)),
            transfers: money(Number(row.transfers_in_cents) - Number(row.transfers_out_cents)),
            closing: money(Number(row.closing_inventory_cents)),
            cogs: money(Number(row.cogs_cents)),
            state: row.status,
          },
        })),
        chartTitle: "Approved COGS by location",
        chartDescription: "Approved period COGS totals.",
        points: byLocation(
          base,
          (locationId) =>
            approved
              .filter((row) => row.location_id === locationId)
              .reduce((sum, row) => sum + Number(row.cogs_cents), 0),
          money,
        ),
      }),
      truncated: rows.length >= MAX_ROWS,
    };
  }

  if (kind === "waste") {
    const range = broadTimestampRange(base.filters);
    let query = base.supabase
      .from("waste_records")
      .select("id, location_id, inventory_item_id, unit_id, quantity, reason_code, estimated_cost_cents, occurred_at, notes, approved_at, created_at")
      .eq("organization_id", base.organizationId)
      .gte("occurred_at", range.start)
      .lte("occurred_at", range.end)
      .order("occurred_at", { ascending: false })
      .limit(MAX_ROWS);
    if (base.filters.locationId !== "all") query = query.eq("location_id", base.filters.locationId);
    const result = await query;
    if (result.error) throw result.error;
    const broadRows = result.data ?? [];
    const rows = broadRows.filter((row) => timestampInRange(base, row.location_id, row.occurred_at));
    const approved = rows.filter((row) => row.approved_at);
    return {
      view: reportView({
        kind,
        title: "Waste",
        description: "Recorded waste quantities, reason codes, estimated cost, and approval state.",
        sourceLabel: "Waste records",
        freshnessAt: latest(rows.map((row) => row.created_at)),
        coverageNote:
          "Estimated cost is reported only when present. Pending waste records are visible but are not treated as approved ledger adjustments.",
        metrics: [
          { label: "Waste records", value: count(rows.length), detail: "Selected period" },
          { label: "Approved cost", value: money(approved.reduce((sum, row) => sum + Number(row.estimated_cost_cents ?? 0), 0)), detail: "Known estimates" },
          { label: "Pending", value: count(rows.length - approved.length), detail: "Needs review" },
          { label: "Missing cost", value: count(rows.filter((row) => row.estimated_cost_cents == null).length), detail: "Not estimated" },
        ],
        columns: [
          { key: "occurred", label: "Occurred" },
          { key: "location", label: "Location" },
          { key: "item", label: "Item" },
          { key: "quantity", label: "Quantity", align: "right" },
          { key: "reason", label: "Reason" },
          { key: "cost", label: "Estimated cost", align: "right" },
          { key: "state", label: "State" },
        ],
        rows: rows.map((row) => ({
          id: row.id,
          cells: {
            occurred: row.occurred_at,
            location: locationName(base, row.location_id),
            item: base.items.get(row.inventory_item_id) ?? "Inventory item",
            quantity: `${Number(row.quantity)} ${base.units.get(row.unit_id) ?? "unit"}`,
            reason: row.reason_code.replaceAll("_", " "),
            cost: row.estimated_cost_cents == null ? "—" : money(Number(row.estimated_cost_cents)),
            state: row.approved_at ? "approved" : "pending",
          },
        })),
        chartTitle: "Approved estimated waste cost by location",
        chartDescription: "Known cost estimates from approved waste records.",
        points: byLocation(
          base,
          (locationId) =>
            approved
              .filter((row) => row.location_id === locationId)
              .reduce((sum, row) => sum + Number(row.estimated_cost_cents ?? 0), 0),
          money,
        ),
      }),
      truncated: broadRows.length >= MAX_ROWS,
    };
  }

  const range = broadTimestampRange(base.filters);
  const query = base.supabase
    .from("item_price_history")
    .select("id, inventory_item_id, vendor_id, unit_id, price_quantity, unit_price_cents, effective_at, source_type, created_at")
    .eq("organization_id", base.organizationId)
    .gte("effective_at", range.start)
    .lte("effective_at", range.end)
    .order("effective_at", { ascending: false })
    .limit(MAX_ROWS);
  const result = await query;
  if (result.error) throw result.error;
  const rows = result.data ?? [];
  const changes = rows.map((row, index) => {
    const older = rows.slice(index + 1).find(
      (candidate) =>
        candidate.inventory_item_id === row.inventory_item_id &&
        candidate.vendor_id === row.vendor_id &&
        candidate.unit_id === row.unit_id,
    );
    const unitCost = Number(row.unit_price_cents) / Number(row.price_quantity);
    const olderUnitCost = older
      ? Number(older.unit_price_cents) / Number(older.price_quantity)
      : null;
    const delta = olderUnitCost === null ? null : unitCost - olderUnitCost;
    const percentage = olderUnitCost
      ? (delta! / olderUnitCost) * 100
      : null;
    return { row, delta, percentage };
  });
  return {
    view: reportView({
      kind,
      title: "Vendor pricing",
      description: "Item price history by vendor and purchase unit.",
      sourceLabel: "Item price history",
      freshnessAt: latest(rows.map((row) => row.created_at)),
      coverageNote:
        `Price history is organization-wide because its source records do not carry a location. ${base.filters.locationId === "all" ? "The current scope includes the organization." : "The selected location does not narrow this report."} Price change compares with the immediately older matching item/vendor/unit record available inside the selected range. Unit conversions are not inferred.`,
      metrics: [
        { label: "Price records", value: count(rows.length), detail: "Selected period" },
        { label: "Items", value: count(new Set(rows.map((row) => row.inventory_item_id)).size), detail: "With price evidence" },
        { label: "Vendors", value: count(new Set(rows.map((row) => row.vendor_id)).size), detail: "With price evidence" },
        { label: "Increases", value: count(changes.filter((change) => (change.delta ?? 0) > 0).length), detail: "Comparable records" },
      ],
      columns: [
        { key: "effective", label: "Effective" },
        { key: "item", label: "Item" },
        { key: "vendor", label: "Vendor" },
        { key: "unit", label: "Unit" },
        { key: "price", label: "Unit price", align: "right" },
        { key: "change", label: "Change", align: "right" },
        { key: "source", label: "Source" },
      ],
      rows: changes.map(({ row, delta, percentage }) => ({
        id: row.id,
        cells: {
          effective: row.effective_at,
          item: base.items.get(row.inventory_item_id) ?? "Inventory item",
          vendor: row.vendor_id ? base.vendors.get(row.vendor_id) ?? "Vendor" : "Direct cost",
          unit: base.units.get(row.unit_id) ?? "unit",
          price: money(Number(row.unit_price_cents) / Number(row.price_quantity)),
          change: delta == null || percentage == null
            ? "No prior in range"
            : `${delta >= 0 ? "+" : ""}${money(delta)} (${percentage.toFixed(1)}%)`,
          source: row.source_type ?? "manual",
        },
      })),
      chartTitle: "Latest price by item",
      chartDescription: "Newest matching unit price records in the selected range.",
      points: changes.slice(0, 12).map(({ row }) => ({
        label: base.items.get(row.inventory_item_id) ?? "Inventory item",
        value: Number(row.unit_price_cents),
        displayValue: money(Number(row.unit_price_cents)),
        tone: "accent",
      })),
    }),
    truncated: rows.length >= MAX_ROWS,
  };
}

async function buildGuestActivityReport(base: BaseContext) {
  const money = (cents: number) => formatMoney(cents, base.currencyCode);
  const range = broadTimestampRange(base.filters);
  let visitQuery = base.supabase
    .from("guest_visits")
    .select("id, location_id, guest_id, visited_at, party_size, covers, spend_cents, source, notes, created_at")
    .eq("organization_id", base.organizationId)
    .gte("visited_at", range.start)
    .lte("visited_at", range.end)
    .order("visited_at", { ascending: false })
    .limit(MAX_ROWS);
  let reservationQuery = base.supabase
    .from("reservations")
    .select("id, location_id, guest_id, reserved_at, party_size, status, source, created_at, updated_at")
    .eq("organization_id", base.organizationId)
    .gte("reserved_at", range.start)
    .lte("reserved_at", range.end)
    .order("reserved_at", { ascending: false })
    .limit(MAX_ROWS);
  if (base.filters.locationId !== "all") {
    visitQuery = visitQuery.eq("location_id", base.filters.locationId);
    reservationQuery = reservationQuery.eq("location_id", base.filters.locationId);
  }
  const [visitResult, reservationResult] = await Promise.all([visitQuery, reservationQuery]);
  if (visitResult.error) throw visitResult.error;
  if (reservationResult.error) throw reservationResult.error;
  const broadVisits = visitResult.data ?? [];
  const broadReservations = reservationResult.data ?? [];
  const visits = broadVisits.filter((row) => timestampInRange(base, row.location_id, row.visited_at));
  const reservations = broadReservations.filter((row) => timestampInRange(base, row.location_id, row.reserved_at));
  const guestIds = [...new Set([
    ...visits.map((row) => row.guest_id),
    ...reservations.flatMap((row) => (row.guest_id ? [row.guest_id] : [])),
  ])];
  const guestResult = guestIds.length
    ? await base.supabase
        .from("guests")
        .select("id, display_name")
        .eq("organization_id", base.organizationId)
        .in("id", guestIds)
    : { data: [], error: null };
  if (guestResult.error) throw guestResult.error;
  const guests = new Map((guestResult.data ?? []).map((guest) => [guest.id, guest.display_name]));
  const visitRows = visits.map((row) => ({
    id: `visit:${row.id}`,
    timestamp: row.visited_at,
    locationId: row.location_id,
    cells: {
      type: "visit",
      date: row.visited_at,
      location: locationName(base, row.location_id),
      guest: guests.get(row.guest_id) ?? "Guest",
      party: row.party_size == null ? "—" : count(row.party_size),
      spend: row.spend_cents == null ? "—" : money(Number(row.spend_cents)),
      state: "recorded",
      source: row.source,
    },
  }));
  const reservationRows = reservations.map((row) => ({
    id: `reservation:${row.id}`,
    timestamp: row.reserved_at,
    locationId: row.location_id,
    cells: {
      type: "reservation",
      date: row.reserved_at,
      location: locationName(base, row.location_id),
      guest: row.guest_id ? guests.get(row.guest_id) ?? "Guest" : "Unlinked guest",
      party: count(row.party_size),
      spend: "—",
      state: row.status.replaceAll("_", " "),
      source: row.source,
    },
  }));
  const sourceRows = [...visitRows, ...reservationRows].sort((left, right) => right.timestamp.localeCompare(left.timestamp));
  const spend = visits.reduce((sum, row) => sum + Number(row.spend_cents ?? 0), 0);
  return {
    view: reportView({
      kind: "guest_activity",
      title: "Guest activity",
      description: "Visit and reservation activity with source and linkage state.",
      sourceLabel: "Guest visits + reservations",
      freshnessAt: latest(
        [...visits.map((row) => row.created_at), ...reservations.map((row) => row.updated_at)],
      ),
      coverageNote:
        "Spend is included only on visit records where it was supplied. Reservations without a linked guest remain visible and are not silently deduplicated.",
      metrics: [
        { label: "Visits", value: count(visits.length), detail: "Recorded visits" },
        { label: "Reservations", value: count(reservations.length), detail: "Selected period" },
        { label: "Known spend", value: money(spend), detail: "Visits with supplied spend" },
        { label: "No-shows", value: count(reservations.filter((row) => row.status === "no_show").length), detail: "Recorded status; no policy inferred" },
      ],
      columns: [
        { key: "type", label: "Type" },
        { key: "date", label: "Date / time" },
        { key: "location", label: "Location" },
        { key: "guest", label: "Guest" },
        { key: "party", label: "Party", align: "right" },
        { key: "spend", label: "Known spend", align: "right" },
        { key: "state", label: "State" },
        { key: "source", label: "Source" },
      ],
      rows: sourceRows.map(({ id, cells }) => ({ id, cells })),
      chartTitle: "Guest activity by location",
      chartDescription: "Visit and reservation records in the selected range.",
      points: byLocation(
        base,
        (locationId) => sourceRows.filter((row) => row.locationId === locationId).length,
        count,
      ),
    }),
    truncated: broadVisits.length >= MAX_ROWS || broadReservations.length >= MAX_ROWS,
  };
}

export function isLiveReportKind(value: string): value is ReportKind {
  return reportKinds.has(value as ReportKind);
}

export async function loadLiveReport(
  workspace: WorkspaceContextValue,
  kind: ReportKind,
  filters: ReportFilters,
): Promise<LiveReadResult<LiveReportsModel>> {
  if (!canAccessReportKind(workspace, kind)) {
    return readFailure("This report requires a capability that is not assigned to you.");
  }
  if (
    !reportKinds.has(kind) ||
    !isIsoCalendarDate(filters.startsOn) ||
    !isIsoCalendarDate(filters.endsOn) ||
    filters.startsOn > filters.endsOn
  ) {
    return readFailure("Choose a valid report and date range.");
  }
  const spanDays = Math.round(
    (new Date(`${filters.endsOn}T00:00:00Z`).valueOf() -
      new Date(`${filters.startsOn}T00:00:00Z`).valueOf()) /
      86_400_000,
  );
  if (spanDays > 731) return readFailure("Choose a report range of two years or less.");

  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const generatedAt = new Date().toISOString();
    const [organizationResult, locationResult, employeeResult, jobResult, vendorResult, itemResult, unitResult] =
      await Promise.all([
        supabase
          .from("organizations")
          .select("currency_code")
          .eq("id", organizationId)
          .single(),
        supabase
          .from("locations")
          .select("id, name, timezone")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("employees")
          .select("id, display_name")
          .eq("organization_id", organizationId),
        supabase
          .from("job_roles")
          .select("id, name")
          .eq("organization_id", organizationId),
        supabase
          .from("vendors")
          .select("id, name")
          .eq("organization_id", organizationId),
        supabase
          .from("inventory_items")
          .select("id, name")
          .eq("organization_id", organizationId),
        supabase
          .from("measurement_units")
          .select("id, symbol")
          .eq("organization_id", organizationId),
      ]);
    if (
      organizationResult.error ||
      locationResult.error ||
      employeeResult.error ||
      jobResult.error ||
      vendorResult.error ||
      itemResult.error ||
      unitResult.error
    ) {
      return readFailure();
    }
    const locations = (locationResult.data ?? []).map((location) => ({
      id: location.id,
      name: location.name,
      timeZone: location.timezone,
    }));
    if (
      filters.locationId !== "all" &&
      !locations.some((location) => location.id === filters.locationId)
    ) {
      return readFailure("The selected location is unavailable.");
    }
    const base: BaseContext = {
      supabase,
      organizationId,
      currencyCode: organizationResult.data.currency_code,
      filters,
      locations,
      locationById: new Map(locations.map((location) => [location.id, location])),
      employees: new Map((employeeResult.data ?? []).map((employee) => [employee.id, employee.display_name])),
      jobs: new Map((jobResult.data ?? []).map((job) => [job.id, job.name])),
      vendors: new Map((vendorResult.data ?? []).map((vendor) => [vendor.id, vendor.name])),
      items: new Map((itemResult.data ?? []).map((item) => [item.id, item.name])),
      units: new Map((unitResult.data ?? []).map((unit) => [unit.id, unit.symbol])),
      generatedAt,
    };

    let built: { view: ReportView; truncated: boolean };
    if (["labor", "attendance", "overtime", "payroll"].includes(kind)) {
      built = await buildPeopleReport(base, kind as "labor" | "attendance" | "overtime" | "payroll");
    } else if (kind === "tips") {
      built = await buildTipsReport(base);
    } else if (kind === "sales_to_labor" || kind === "shift_performance") {
      built = await buildCloseoutReport(base, kind);
    } else if (kind === "receipts" || kind === "expenses") {
      built = await buildMoneyReport(base, kind);
    } else if (["inventory_variance", "cogs", "waste", "vendor_pricing"].includes(kind)) {
      built = await buildInventoryReport(
        base,
        kind as "inventory_variance" | "cogs" | "waste" | "vendor_pricing",
      );
    } else {
      built = await buildGuestActivityReport(base);
    }

    return readSuccess({
      view: built.view,
      filters,
      locations,
      generatedAt,
      truncated: built.truncated,
    });
  } catch {
    return readFailure();
  }
}
