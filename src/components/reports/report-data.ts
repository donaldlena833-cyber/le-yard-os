import { demoWorkspace } from "../../lib/demo";
import { formatMoney } from "../../lib/utils";
import type { ReportKind } from "../../types";

export const REPORT_CATALOG: Array<{
  kind: ReportKind;
  label: string;
  group: "People" | "Money" | "Inventory" | "Guests";
}> = [
  { kind: "labor", label: "Labor", group: "People" },
  { kind: "attendance", label: "Attendance", group: "People" },
  { kind: "overtime", label: "Overtime", group: "People" },
  { kind: "tips", label: "Tips", group: "People" },
  { kind: "payroll", label: "Payroll readiness", group: "People" },
  { kind: "sales_to_labor", label: "Sales / labor", group: "Money" },
  { kind: "receipts", label: "Receipts", group: "Money" },
  { kind: "expenses", label: "Expenses", group: "Money" },
  { kind: "inventory_variance", label: "Inventory variance", group: "Inventory" },
  { kind: "cogs", label: "COGS", group: "Inventory" },
  { kind: "waste", label: "Waste", group: "Inventory" },
  { kind: "vendor_pricing", label: "Vendor price", group: "Inventory" },
  { kind: "shift_performance", label: "Shift performance", group: "People" },
  { kind: "guest_activity", label: "Guest activity", group: "Guests" },
];

export interface ReportFilters {
  locationId: string;
  startsOn: string;
  endsOn: string;
}

export interface ReportColumn {
  key: string;
  label: string;
  align?: "left" | "right";
}

export interface ReportRow {
  id: string;
  cells: Record<string, string>;
}

export interface ReportChartPoint {
  label: string;
  value: number;
  displayValue: string;
  tone?: "accent" | "positive" | "warning" | "danger" | "neutral";
}

export interface ReportMetric {
  label: string;
  value: string;
  detail: string;
}

export interface ReportView {
  kind: ReportKind;
  title: string;
  description: string;
  sourceLabel: string;
  freshnessAt: string | null;
  coverageNote: string;
  metrics: ReportMetric[];
  columns: ReportColumn[];
  rows: ReportRow[];
  chart: {
    title: string;
    description: string;
    points: ReportChartPoint[];
  };
}

export const DEFAULT_REPORT_FILTERS: ReportFilters = {
  locationId: "all",
  startsOn: "2026-07-01",
  endsOn: "2026-08-01",
};

const reportKinds = new Set(REPORT_CATALOG.map((report) => report.kind));

export function isReportKind(value: string | null): value is ReportKind {
  return value !== null && reportKinds.has(value as ReportKind);
}

function locationName(locationId: string): string {
  return demoWorkspace.locations.find((location) => location.id === locationId)?.name ?? "Unknown location";
}

function personName(personId: string): string {
  return demoWorkspace.people.find((person) => person.id === personId)?.displayName ?? "Unknown team member";
}

function jobName(jobRoleId: string): string {
  return demoWorkspace.jobRoles.find((role) => role.id === jobRoleId)?.name ?? "Unknown role";
}

function vendorName(vendorId: string | null): string {
  return demoWorkspace.vendors.find((vendor) => vendor.id === vendorId)?.name ?? "Unmatched vendor";
}

function itemName(itemId: string): string {
  return demoWorkspace.inventoryItems.find((item) => item.id === itemId)?.name ?? "Unknown item";
}

function inRange(date: string, filters: ReportFilters): boolean {
  return date >= filters.startsOn && date <= filters.endsOn;
}

function atLocation(locationId: string, filters: ReportFilters): boolean {
  return filters.locationId === "all" || locationId === filters.locationId;
}

function latest(records: Array<{ updatedAt: string }>): string {
  if (!records.length) return demoWorkspace.asOf;
  return records.reduce(
    (current, record) => (record.updatedAt > current ? record.updatedAt : current),
    records[0].updatedAt,
  );
}

function hours(minutes: number): string {
  return `${(minutes / 60).toFixed(1)}h`;
}

function percentage(value: number): string {
  return `${value.toFixed(1)}%`;
}

function emptyPoint(label = "No records"): ReportChartPoint[] {
  return [{ label, value: 0, displayValue: "0", tone: "neutral" }];
}

function sumByLocation(
  locationIds: string[],
  valueForLocation: (locationId: string) => number,
  format: (value: number) => string,
): ReportChartPoint[] {
  const points = locationIds.map((locationId) => {
    const value = valueForLocation(locationId);
    return { label: locationName(locationId), value, displayValue: format(value), tone: "accent" as const };
  });
  return points.length ? points : emptyPoint();
}

function scopedLocationIds(filters: ReportFilters): string[] {
  return demoWorkspace.locations
    .filter((location) => atLocation(location.id, filters))
    .map((location) => location.id);
}

function laborReport(filters: ReportFilters): ReportView {
  const records = demoWorkspace.timecards.filter(
    (card) => atLocation(card.locationId, filters) && inRange(card.clockedInAt.slice(0, 10), filters),
  );
  const totalRegular = records.reduce((sum, record) => sum + record.regularMinutes, 0);
  const totalOvertime = records.reduce((sum, record) => sum + record.overtimeMinutes, 0);
  const rows = records.map<ReportRow>((record) => ({
    id: record.id,
    cells: {
      person: personName(record.personId),
      location: locationName(record.locationId),
      role: jobName(record.jobRoleId),
      regular: hours(record.regularMinutes),
      overtime: hours(record.overtimeMinutes),
      status: record.status.replaceAll("_", " "),
    },
  }));
  return {
    kind: "labor",
    title: "Labor",
    description: "Recorded regular and overtime minutes from timecards in the selected period.",
    sourceLabel: "Timecards",
    freshnessAt: latest(records),
    coverageNote: "Hours are source records only; wage rates and payroll burden are not estimated.",
    metrics: [
      { label: "Worked hours", value: hours(totalRegular + totalOvertime), detail: `${records.length} timecards` },
      { label: "Regular", value: hours(totalRegular), detail: "Recorded minutes" },
      { label: "Overtime", value: hours(totalOvertime), detail: "Recorded minutes" },
      { label: "Open cards", value: String(records.filter((record) => record.status === "open").length), detail: "Not yet complete" },
    ],
    columns: [
      { key: "person", label: "Team member" },
      { key: "location", label: "Location" },
      { key: "role", label: "Job" },
      { key: "regular", label: "Regular", align: "right" },
      { key: "overtime", label: "Overtime", align: "right" },
      { key: "status", label: "State" },
    ],
    rows,
    chart: {
      title: "Worked hours by location",
      description: "Regular plus overtime hours from matching timecards.",
      points: sumByLocation(
        scopedLocationIds(filters),
        (locationId) =>
          records
            .filter((record) => record.locationId === locationId)
            .reduce((sum, record) => sum + record.regularMinutes + record.overtimeMinutes, 0) / 60,
        (value) => `${value.toFixed(1)}h`,
      ),
    },
  };
}

function attendanceReport(filters: ReportFilters): ReportView {
  const records = demoWorkspace.timecards.filter(
    (card) => atLocation(card.locationId, filters) && inRange(card.clockedInAt.slice(0, 10), filters),
  );
  const pendingIds = new Set(
    demoWorkspace.timecardCorrections
      .filter((correction) => correction.status === "pending")
      .map((correction) => correction.timecardId),
  );
  const corrections = demoWorkspace.timecardCorrections.filter((correction) =>
    records.some((record) => record.id === correction.timecardId),
  );
  const rows = records.map<ReportRow>((record) => ({
    id: record.id,
    cells: {
      person: personName(record.personId),
      location: locationName(record.locationId),
      date: record.clockedInAt.slice(0, 10),
      clockIn: new Date(record.clockedInAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      clockOut: record.clockedOutAt
        ? new Date(record.clockedOutAt).toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })
        : "Open",
      review: pendingIds.has(record.id) ? "Correction pending" : record.status.replaceAll("_", " "),
    },
  }));
  const statusCounts = ["open", "approved", "correction_pending", "complete"].map((status) => ({
    label: status.replaceAll("_", " "),
    value: records.filter((record) => record.status === status).length,
    displayValue: String(records.filter((record) => record.status === status).length),
    tone: status === "correction_pending" ? ("warning" as const) : ("accent" as const),
  }));
  return {
    kind: "attendance",
    title: "Attendance",
    description: "Punch state and correction queues without applying an attendance policy.",
    sourceLabel: "Timecards + correction requests",
    freshnessAt: latest([...records, ...corrections]),
    coverageNote: "No lateness, break, or attendance-compliance rule is inferred from these records.",
    metrics: [
      { label: "Punch records", value: String(records.length), detail: "Selected period" },
      { label: "Open", value: String(records.filter((record) => record.status === "open").length), detail: "End time pending" },
      { label: "Corrections", value: String(records.filter((record) => pendingIds.has(record.id)).length), detail: "Human review required" },
      { label: "Approved", value: String(records.filter((record) => record.status === "approved").length), detail: "Recorded state" },
    ],
    columns: [
      { key: "person", label: "Team member" },
      { key: "location", label: "Location" },
      { key: "date", label: "Date" },
      { key: "clockIn", label: "Start time", align: "right" },
      { key: "clockOut", label: "End time", align: "right" },
      { key: "review", label: "Review" },
    ],
    rows,
    chart: { title: "Punch state", description: "Count of matching timecards by current workflow state.", points: statusCounts },
  };
}

function overtimeReport(filters: ReportFilters): ReportView {
  const records = demoWorkspace.timecards.filter(
    (card) => atLocation(card.locationId, filters) && inRange(card.clockedInAt.slice(0, 10), filters),
  );
  const overtimeMinutes = records.reduce((sum, record) => sum + record.overtimeMinutes, 0);
  return {
    kind: "overtime",
    title: "Overtime",
    description: "Recorded overtime minutes by employee and location.",
    sourceLabel: "Timecards",
    freshnessAt: latest(records),
    coverageNote: "This view reports stored overtime minutes; it does not determine legal or policy thresholds.",
    metrics: [
      { label: "Recorded overtime", value: hours(overtimeMinutes), detail: "No threshold inferred" },
      { label: "People with overtime", value: String(new Set(records.filter((record) => record.overtimeMinutes > 0).map((record) => record.personId)).size), detail: "Selected period" },
      { label: "Reviewed cards", value: String(records.filter((record) => record.status === "approved").length), detail: "Approved state" },
      { label: "Source cards", value: String(records.length), detail: "Included records" },
    ],
    columns: [
      { key: "person", label: "Team member" },
      { key: "location", label: "Location" },
      { key: "regular", label: "Regular", align: "right" },
      { key: "overtime", label: "Overtime", align: "right" },
      { key: "status", label: "State" },
    ],
    rows: records.map((record) => ({
      id: record.id,
      cells: {
        person: personName(record.personId),
        location: locationName(record.locationId),
        regular: hours(record.regularMinutes),
        overtime: hours(record.overtimeMinutes),
        status: record.status.replaceAll("_", " "),
      },
    })),
    chart: {
      title: "Recorded overtime by employee",
      description: "Hours explicitly stored as overtime on matching timecards.",
      points: records.length
        ? records.map((record) => ({
            label: personName(record.personId),
            value: record.overtimeMinutes / 60,
            displayValue: hours(record.overtimeMinutes),
            tone: record.overtimeMinutes > 0 ? "warning" : "neutral",
          }))
        : emptyPoint(),
    },
  };
}

function tipsReport(filters: ReportFilters): ReportView {
  const runs = demoWorkspace.tipPoolRuns.filter(
    (run) => atLocation(run.locationId, filters) && inRange(run.businessDate, filters),
  );
  const distributable = runs.reduce((sum, run) => sum + run.distributableCents, 0);
  const serviceCharges = runs.reduce((sum, run) => sum + run.serviceChargesCents, 0);
  const allocated = runs.reduce(
    (sum, run) => sum + run.allocations.reduce((allocationSum, allocation) => allocationSum + allocation.allocatedCents, 0),
    0,
  );
  return {
    kind: "tips",
    title: "Tips",
    description: "Approved tip sources, separated service charges, and allocation status.",
    sourceLabel: "Tip pool runs",
    freshnessAt: latest(runs),
    coverageNote: "Service charges remain separate from distributable tips in the active demo policy.",
    metrics: [
      { label: "Distributable", value: formatMoney(distributable), detail: `${runs.length} pool runs` },
      { label: "Allocated", value: formatMoney(allocated), detail: allocated === distributable ? "Reconciled" : "Review difference" },
      { label: "Service charges", value: formatMoney(serviceCharges), detail: "Reported separately" },
      { label: "Locked", value: String(runs.filter((run) => run.status === "locked").length), detail: "Approval lock active" },
    ],
    columns: [
      { key: "date", label: "Business date" },
      { key: "location", label: "Location" },
      { key: "cash", label: "Cash tips", align: "right" },
      { key: "card", label: "Card tips", align: "right" },
      { key: "service", label: "Service charge", align: "right" },
      { key: "pool", label: "Pool", align: "right" },
      { key: "status", label: "State" },
    ],
    rows: runs.map((run) => ({
      id: run.id,
      cells: {
        date: run.businessDate,
        location: locationName(run.locationId),
        cash: formatMoney(run.cashTipsCents),
        card: formatMoney(run.cardTipsCents),
        service: formatMoney(run.serviceChargesCents),
        pool: formatMoney(run.distributableCents),
        status: run.status,
      },
    })),
    chart: {
      title: "Tip pool by location",
      description: "Distributable cash and card tips. Service charges are excluded.",
      points: sumByLocation(
        scopedLocationIds(filters),
        (locationId) => runs.filter((run) => run.locationId === locationId).reduce((sum, run) => sum + run.distributableCents, 0),
        (value) => formatMoney(value),
      ),
    },
  };
}

function payrollReport(filters: ReportFilters): ReportView {
  const cards = demoWorkspace.timecards.filter(
    (card) => atLocation(card.locationId, filters) && inRange(card.clockedInAt.slice(0, 10), filters),
  );
  const runs = demoWorkspace.tipPoolRuns.filter(
    (run) => atLocation(run.locationId, filters) && inRange(run.businessDate, filters),
  );
  const rows: ReportRow[] = cards.map((card) => {
    const tipCents = runs.reduce(
      (sum, run) =>
        sum +
        run.allocations
          .filter((allocation) => allocation.personId === card.personId)
          .reduce((allocationSum, allocation) => allocationSum + allocation.allocatedCents, 0),
      0,
    );
    return {
      id: card.id,
      cells: {
        person: personName(card.personId),
        location: locationName(card.locationId),
        hours: hours(card.regularMinutes + card.overtimeMinutes),
        cardState: card.status.replaceAll("_", " "),
        tips: formatMoney(tipCents),
        readiness: card.status === "approved" && runs.every((run) => run.status === "locked") ? "Ready to export" : "Needs review",
      },
    };
  });
  return {
    kind: "payroll",
    title: "Payroll readiness",
    description: "Hours and locked tips prepared for provider export, without calculating wages or taxes.",
    sourceLabel: "Timecards + tip pool runs",
    freshnessAt: latest([...cards, ...runs]),
    coverageNote: "Payroll transmission, wage calculation, taxes, and filing remain outside this application.",
    metrics: [
      { label: "Timecards", value: String(cards.length), detail: "Selected period" },
      { label: "Approved cards", value: String(cards.filter((card) => card.status === "approved").length), detail: "Provider-ready state" },
      { label: "Locked pools", value: String(runs.filter((run) => run.status === "locked").length), detail: "Cannot be edited" },
      { label: "Needs review", value: String(rows.filter((row) => row.cells.readiness === "Needs review").length), detail: "Before export" },
    ],
    columns: [
      { key: "person", label: "Team member" },
      { key: "location", label: "Location" },
      { key: "hours", label: "Hours", align: "right" },
      { key: "cardState", label: "Timecard" },
      { key: "tips", label: "Tips", align: "right" },
      { key: "readiness", label: "Readiness" },
    ],
    rows,
    chart: {
      title: "Export readiness",
      description: "Count of included timecards by payroll export readiness.",
      points: [
        { label: "Ready", value: rows.filter((row) => row.cells.readiness === "Ready to export").length, displayValue: String(rows.filter((row) => row.cells.readiness === "Ready to export").length), tone: "positive" },
        { label: "Needs review", value: rows.filter((row) => row.cells.readiness === "Needs review").length, displayValue: String(rows.filter((row) => row.cells.readiness === "Needs review").length), tone: "warning" },
      ],
    },
  };
}

function salesLaborReport(filters: ReportFilters): ReportView {
  const closeouts = demoWorkspace.closeouts.filter(
    (closeout) => atLocation(closeout.locationId, filters) && inRange(closeout.businessDate, filters),
  );
  const cards = demoWorkspace.timecards.filter(
    (card) => atLocation(card.locationId, filters) && inRange(card.clockedInAt.slice(0, 10), filters),
  );
  const locationIds = scopedLocationIds(filters);
  const rows = locationIds.map<ReportRow>((locationId) => {
    const sales = closeouts.filter((closeout) => closeout.locationId === locationId).reduce((sum, closeout) => sum + closeout.netSalesCents, 0);
    const minutes = cards
      .filter((card) => card.locationId === locationId)
      .reduce((sum, card) => sum + card.regularMinutes + card.overtimeMinutes, 0);
    return {
      id: locationId,
      cells: {
        location: locationName(locationId),
        netSales: formatMoney(sales),
        workedHours: hours(minutes),
        salesPerHour: minutes > 0 ? formatMoney(Math.round((sales * 60) / minutes)) : "No worked hours",
        laborCost: "Not connected",
      },
    };
  });
  const totalSales = closeouts.reduce((sum, closeout) => sum + closeout.netSalesCents, 0);
  const totalMinutes = cards.reduce((sum, card) => sum + card.regularMinutes + card.overtimeMinutes, 0);
  return {
    kind: "sales_to_labor",
    title: "Sales / labor",
    description: "Net sales compared with recorded worked hours by location.",
    sourceLabel: "Approved closeouts + timecards",
    freshnessAt: latest([...closeouts, ...cards]),
    coverageNote: "Sales per worked hour is available. Labor-cost percentage waits for approved wage-rate data.",
    metrics: [
      { label: "Net sales", value: formatMoney(totalSales), detail: `${closeouts.length} closeouts` },
      { label: "Worked hours", value: hours(totalMinutes), detail: `${cards.length} timecards` },
      { label: "Sales / hour", value: totalMinutes ? formatMoney(Math.round((totalSales * 60) / totalMinutes)) : "—", detail: "Derived from source records" },
      { label: "Labor cost %", value: "Not available", detail: "Wage rates not connected" },
    ],
    columns: [
      { key: "location", label: "Location" },
      { key: "netSales", label: "Net sales", align: "right" },
      { key: "workedHours", label: "Worked hours", align: "right" },
      { key: "salesPerHour", label: "Sales / hour", align: "right" },
      { key: "laborCost", label: "Labor cost %", align: "right" },
    ],
    rows,
    chart: {
      title: "Net sales per worked hour",
      description: "Net closeout sales divided by recorded hours; not a labor-cost percentage.",
      points: locationIds.map((locationId) => {
        const sales = closeouts.filter((closeout) => closeout.locationId === locationId).reduce((sum, closeout) => sum + closeout.netSalesCents, 0);
        const minutes = cards.filter((card) => card.locationId === locationId).reduce((sum, card) => sum + card.regularMinutes + card.overtimeMinutes, 0);
        const value = minutes ? Math.round((sales * 60) / minutes) : 0;
        return { label: locationName(locationId), value, displayValue: formatMoney(value), tone: "accent" };
      }),
    },
  };
}

function receiptReport(filters: ReportFilters, kind: "receipts" | "expenses"): ReportView {
  const records = demoWorkspace.receipts.filter(
    (receipt) => atLocation(receipt.locationId, filters) && inRange(receipt.documentDate, filters),
  );
  const total = records.reduce((sum, receipt) => sum + receipt.totalCents, 0);
  const verified = records.filter((receipt) => receipt.reviewStatus === "verified");
  const isExpenses = kind === "expenses";
  return {
    kind,
    title: isExpenses ? "Expenses" : "Receipts",
    description: isExpenses
      ? "Documented expenses by category, vendor, and review state."
      : "Receipt and invoice extraction coverage with human-review state.",
    sourceLabel: "Private receipt records",
    freshnessAt: latest(records),
    coverageNote: isExpenses
      ? "Totals include uploaded documents in every review state; filter to verified records before accounting export."
      : "AI-extracted fields are not treated as approved until a person verifies them.",
    metrics: [
      { label: isExpenses ? "Documented total" : "Documents", value: isExpenses ? formatMoney(total) : String(records.length), detail: "Selected period" },
      { label: "Verified", value: String(verified.length), detail: formatMoney(verified.reduce((sum, receipt) => sum + receipt.totalCents, 0)) },
      { label: "Needs review", value: String(records.filter((receipt) => receipt.reviewStatus === "needs_review").length), detail: "Human review required" },
      { label: "Average", value: records.length ? formatMoney(Math.round(total / records.length)) : formatMoney(0), detail: "Per document" },
    ],
    columns: [
      { key: "date", label: "Document date" },
      { key: "vendor", label: "Vendor" },
      { key: "location", label: "Location" },
      { key: "category", label: "Category" },
      { key: "total", label: "Total", align: "right" },
      { key: "review", label: "Review" },
    ],
    rows: records.map((receipt) => ({
      id: receipt.id,
      cells: {
        date: receipt.documentDate,
        vendor: vendorName(receipt.vendorId),
        location: locationName(receipt.locationId),
        category: receipt.expenseCategory.replaceAll("_", " "),
        total: formatMoney(receipt.totalCents),
        review: receipt.reviewStatus.replaceAll("_", " "),
      },
    })),
    chart: {
      title: isExpenses ? "Documented spend by location" : "Documents by location",
      description: isExpenses ? "Total uploaded document value." : "Count of matching receipt records.",
      points: sumByLocation(
        scopedLocationIds(filters),
        (locationId) =>
          records
            .filter((receipt) => receipt.locationId === locationId)
            .reduce((sum, receipt) => sum + (isExpenses ? receipt.totalCents : 1), 0),
        (value) => (isExpenses ? formatMoney(value) : String(value)),
      ),
    },
  };
}

function inventoryVarianceReport(filters: ReportFilters): ReportView {
  const counts = demoWorkspace.inventoryCounts.filter(
    (count) => atLocation(count.locationId, filters) && inRange(count.businessDate, filters),
  );
  const lines = counts.flatMap((count) =>
    count.lines.map((line) => ({ ...line, countId: count.id, locationId: count.locationId, date: count.businessDate, status: count.status })),
  );
  const variance = lines.reduce((sum, line) => sum + line.varianceValueCents, 0);
  return {
    kind: "inventory_variance",
    title: "Inventory variance",
    description: "Expected versus counted quantity and value from submitted counts.",
    sourceLabel: "Inventory counts",
    freshnessAt: latest(counts),
    coverageNote: "Variance reflects the recorded count units and item costs; it is not an automatic ledger adjustment.",
    metrics: [
      { label: "Net variance", value: formatMoney(variance), detail: `${lines.length} count lines` },
      { label: "Negative lines", value: String(lines.filter((line) => line.varianceValueCents < 0).length), detail: "Below expected" },
      { label: "Exact lines", value: String(lines.filter((line) => line.varianceValueCents === 0).length), detail: "No recorded variance" },
      { label: "Approved counts", value: String(counts.filter((count) => count.status === "approved").length), detail: `${counts.length} total counts` },
    ],
    columns: [
      { key: "item", label: "Item" },
      { key: "location", label: "Location" },
      { key: "expected", label: "Expected", align: "right" },
      { key: "counted", label: "Counted", align: "right" },
      { key: "quantity", label: "Variance", align: "right" },
      { key: "value", label: "Value", align: "right" },
    ],
    rows: lines.map((line) => ({
      id: `${line.countId}-${line.itemId}`,
      cells: {
        item: itemName(line.itemId),
        location: locationName(line.locationId),
        expected: `${line.expectedQuantity} ${line.unit}`,
        counted: `${line.countedQuantity} ${line.unit}`,
        quantity: `${line.varianceQuantity} ${line.unit}`,
        value: formatMoney(line.varianceValueCents),
      },
    })),
    chart: {
      title: "Absolute variance by item",
      description: "Magnitude of recorded value variance; labels preserve direction.",
      points: lines.length
        ? lines.map((line) => ({
            label: itemName(line.itemId),
            value: Math.abs(line.varianceValueCents),
            displayValue: formatMoney(line.varianceValueCents),
            tone: line.varianceValueCents < 0 ? "danger" : "positive",
          }))
        : emptyPoint(),
    },
  };
}

function cogsReport(filters: ReportFilters): ReportView {
  const receipts = demoWorkspace.receipts.filter(
    (receipt) => atLocation(receipt.locationId, filters) && inRange(receipt.documentDate, filters),
  );
  const rows = demoWorkspace.recipes.map<ReportRow>((recipe) => ({
    id: recipe.id,
    cells: {
      recipe: recipe.name,
      yield: `${recipe.yieldQuantity} ${recipe.yieldUnit}`,
      recipeCost: formatMoney(recipe.totalCostCents),
      costPerYield: formatMoney(recipe.costPerYieldCents),
      menuPrice: formatMoney(recipe.menuPriceCents),
      foodCost: percentage(recipe.foodCostPercentage),
    },
  }));
  return {
    kind: "cogs",
    title: "COGS",
    description: "Recipe-cost evidence and the source coverage needed for formal cost of goods sold.",
    sourceLabel: "Recipes + receipts + inventory counts",
    freshnessAt: latest([...demoWorkspace.recipes, ...receipts, ...demoWorkspace.inventoryCounts]),
    coverageNote: "Formal COGS is not calculated because beginning inventory, ending inventory, and complete purchases are not yet available for the period.",
    metrics: [
      { label: "Formal COGS", value: "Not available", detail: "Source coverage incomplete" },
      { label: "Recipes costed", value: String(demoWorkspace.recipes.length), detail: "Current recipe records" },
      { label: "Purchase documents", value: String(receipts.length), detail: "Selected period" },
      { label: "Inventory counts", value: String(demoWorkspace.inventoryCounts.filter((count) => atLocation(count.locationId, filters) && inRange(count.businessDate, filters)).length), detail: "Selected period" },
    ],
    columns: [
      { key: "recipe", label: "Recipe" },
      { key: "yield", label: "Yield" },
      { key: "recipeCost", label: "Recipe cost", align: "right" },
      { key: "costPerYield", label: "Cost / yield", align: "right" },
      { key: "menuPrice", label: "Menu price", align: "right" },
      { key: "foodCost", label: "Recipe cost %", align: "right" },
    ],
    rows,
    chart: {
      title: "Recipe cost per yield",
      description: "Current recorded cost per recipe yield, not period COGS.",
      points: demoWorkspace.recipes.length
        ? demoWorkspace.recipes.map((recipe) => ({ label: recipe.name, value: recipe.costPerYieldCents, displayValue: formatMoney(recipe.costPerYieldCents), tone: "accent" }))
        : emptyPoint(),
    },
  };
}

function wasteReport(filters: ReportFilters): ReportView {
  const records = demoWorkspace.wasteRecords.filter(
    (record) => atLocation(record.locationId, filters) && inRange(record.occurredAt.slice(0, 10), filters),
  );
  const total = records.reduce((sum, record) => sum + record.valueCents, 0);
  return {
    kind: "waste",
    title: "Waste",
    description: "Recorded waste quantity, value, reason, and responsible entry.",
    sourceLabel: "Waste records",
    freshnessAt: latest(records),
    coverageNote: "Only explicitly recorded waste is included; missing entries are not estimated.",
    metrics: [
      { label: "Recorded value", value: formatMoney(total), detail: `${records.length} waste records` },
      { label: "Items", value: String(new Set(records.map((record) => record.itemId)).size), detail: "Distinct inventory items" },
      { label: "Locations", value: String(new Set(records.map((record) => record.locationId)).size), detail: "With recorded waste" },
      { label: "Estimated waste", value: "$0", detail: "No inferred entries" },
    ],
    columns: [
      { key: "date", label: "Occurred" },
      { key: "item", label: "Item" },
      { key: "location", label: "Location" },
      { key: "quantity", label: "Quantity", align: "right" },
      { key: "reason", label: "Reason" },
      { key: "value", label: "Value", align: "right" },
    ],
    rows: records.map((record) => ({
      id: record.id,
      cells: {
        date: record.occurredAt.slice(0, 10),
        item: itemName(record.itemId),
        location: locationName(record.locationId),
        quantity: `${record.quantity} ${record.unit}`,
        reason: record.reason.replaceAll("_", " "),
        value: formatMoney(record.valueCents),
      },
    })),
    chart: {
      title: "Recorded waste value",
      description: "Value of each matching waste record.",
      points: records.length
        ? records.map((record) => ({ label: itemName(record.itemId), value: record.valueCents, displayValue: formatMoney(record.valueCents), tone: "warning" }))
        : emptyPoint(),
    },
  };
}

function vendorPricingReport(filters: ReportFilters): ReportView {
  const records = demoWorkspace.inventoryPrices.filter((record) => inRange(record.effectiveOn, filters));
  const byItem = new Map<string, typeof records>();
  for (const record of records) byItem.set(record.itemId, [...(byItem.get(record.itemId) ?? []), record]);
  const rows = records.map<ReportRow>((record) => {
    const history = [...(byItem.get(record.itemId) ?? [])].sort((left, right) => left.effectiveOn.localeCompare(right.effectiveOn));
    const index = history.findIndex((item) => item.id === record.id);
    const previous = index > 0 ? history[index - 1] : undefined;
    const change = previous ? ((record.unitCostCents - previous.unitCostCents) / previous.unitCostCents) * 100 : null;
    return {
      id: record.id,
      cells: {
        date: record.effectiveOn,
        item: itemName(record.itemId),
        vendor: vendorName(record.vendorId),
        unit: record.unit,
        cost: formatMoney(record.unitCostCents),
        change: change === null ? "First record" : `${change >= 0 ? "+" : ""}${percentage(change)}`,
      },
    };
  });
  return {
    kind: "vendor_pricing",
    title: "Vendor price",
    description: "Recorded inventory unit-cost history by vendor and effective date.",
    sourceLabel: "Inventory price history",
    freshnessAt: latest(records),
    coverageNote: filters.locationId === "all" ? "Prices are organization-level vendor records." : "Vendor price history is organization-level and is not location-specific.",
    metrics: [
      { label: "Price records", value: String(records.length), detail: "Selected period" },
      { label: "Items tracked", value: String(new Set(records.map((record) => record.itemId)).size), detail: "With source history" },
      { label: "Vendors", value: String(new Set(records.map((record) => record.vendorId)).size), detail: "Represented" },
      { label: "Latest updates", value: String(records.filter((record) => record.effectiveOn === records.reduce((date, item) => item.effectiveOn > date ? item.effectiveOn : date, "")).length), detail: "At most recent date" },
    ],
    columns: [
      { key: "date", label: "Effective" },
      { key: "item", label: "Item" },
      { key: "vendor", label: "Vendor" },
      { key: "unit", label: "Unit" },
      { key: "cost", label: "Unit cost", align: "right" },
      { key: "change", label: "Change", align: "right" },
    ],
    rows,
    chart: {
      title: "Recorded unit cost",
      description: "Unit-cost observations in effective-date order.",
      points: records.length
        ? records.map((record) => ({ label: `${itemName(record.itemId)} ${record.effectiveOn.slice(5)}`, value: record.unitCostCents, displayValue: formatMoney(record.unitCostCents), tone: "accent" }))
        : emptyPoint(),
    },
  };
}

function shiftPerformanceReport(filters: ReportFilters): ReportView {
  const shifts = demoWorkspace.shifts.filter(
    (shift) => atLocation(shift.locationId, filters) && inRange(shift.startsAt.slice(0, 10), filters),
  );
  const rows = shifts.map<ReportRow>((shift) => {
    const scheduledMinutes = Math.max(0, Math.round((Date.parse(shift.endsAt) - Date.parse(shift.startsAt)) / 60_000) - shift.unpaidBreakMinutes);
    return {
      id: shift.id,
      cells: {
        person: shift.personId ? personName(shift.personId) : "Open shift",
        location: locationName(shift.locationId),
        role: jobName(shift.jobRoleId),
        scheduled: hours(scheduledMinutes),
        period: shift.period,
        status: shift.status,
      },
    };
  });
  return {
    kind: "shift_performance",
    title: "Shift performance",
    description: "Coverage, acknowledgement, and scheduled duration by shift.",
    sourceLabel: "Published schedules",
    freshnessAt: latest(shifts),
    coverageNote: "This view reports workflow state and coverage; it does not rank individual employee performance.",
    metrics: [
      { label: "Shifts", value: String(shifts.length), detail: "Selected period" },
      { label: "Acknowledged", value: String(shifts.filter((shift) => shift.status === "acknowledged").length), detail: "Employee-confirmed" },
      { label: "Open", value: String(shifts.filter((shift) => shift.status === "open").length), detail: "Unassigned coverage" },
      { label: "Published", value: String(shifts.filter((shift) => shift.status === "published").length), detail: "Awaiting acknowledgement" },
    ],
    columns: [
      { key: "person", label: "Team member" },
      { key: "location", label: "Location" },
      { key: "role", label: "Job" },
      { key: "scheduled", label: "Scheduled", align: "right" },
      { key: "period", label: "Period" },
      { key: "status", label: "State" },
    ],
    rows,
    chart: {
      title: "Shift workflow state",
      description: "Count of shifts by acknowledgement and coverage state.",
      points: ["acknowledged", "published", "open"].map((status) => ({
        label: status,
        value: shifts.filter((shift) => shift.status === status).length,
        displayValue: String(shifts.filter((shift) => shift.status === status).length),
        tone: status === "open" ? "warning" : status === "acknowledged" ? "positive" : "accent",
      })),
    },
  };
}

function guestActivityReport(filters: ReportFilters): ReportView {
  const visits = demoWorkspace.guestVisits.filter(
    (visit) => atLocation(visit.locationId, filters) && inRange(visit.visitedAt.slice(0, 10), filters),
  );
  const totalSpend = visits.reduce((sum, visit) => sum + visit.spendCents, 0);
  return {
    kind: "guest_activity",
    title: "Guest activity",
    description: "Recorded visits, spend, party size, and source by guest.",
    sourceLabel: "Guest visits + reservation links",
    freshnessAt: latest(visits),
    coverageNote: "Only recorded/imported visits are included; live Resy coverage is not assumed.",
    metrics: [
      { label: "Visits", value: String(visits.length), detail: "Selected period" },
      { label: "Recorded spend", value: formatMoney(totalSpend), detail: "Visit records" },
      { label: "Covers", value: String(visits.reduce((sum, visit) => sum + visit.partySize, 0)), detail: "Recorded party size" },
      { label: "Average spend", value: visits.length ? formatMoney(Math.round(totalSpend / visits.length)) : formatMoney(0), detail: "Per visit" },
    ],
    columns: [
      { key: "date", label: "Visit" },
      { key: "guest", label: "Guest" },
      { key: "location", label: "Location" },
      { key: "party", label: "Party", align: "right" },
      { key: "spend", label: "Spend", align: "right" },
      { key: "source", label: "Source" },
    ],
    rows: visits.map((visit) => {
      const guest = demoWorkspace.guests.find((item) => item.id === visit.guestId);
      return {
        id: visit.id,
        cells: {
          date: visit.visitedAt.slice(0, 10),
          guest: guest ? `${guest.firstName} ${guest.lastName}` : "Unknown guest",
          location: locationName(visit.locationId),
          party: String(visit.partySize),
          spend: formatMoney(visit.spendCents),
          source: visit.source.replaceAll("_", " "),
        },
      };
    }),
    chart: {
      title: "Recorded spend by location",
      description: "Spend attached to matching guest visit records.",
      points: sumByLocation(
        scopedLocationIds(filters),
        (locationId) => visits.filter((visit) => visit.locationId === locationId).reduce((sum, visit) => sum + visit.spendCents, 0),
        (value) => formatMoney(value),
      ),
    },
  };
}

export function getReportView(kind: ReportKind, filters: ReportFilters): ReportView {
  switch (kind) {
    case "labor":
      return laborReport(filters);
    case "attendance":
      return attendanceReport(filters);
    case "overtime":
      return overtimeReport(filters);
    case "tips":
      return tipsReport(filters);
    case "payroll":
      return payrollReport(filters);
    case "sales_to_labor":
      return salesLaborReport(filters);
    case "receipts":
      return receiptReport(filters, "receipts");
    case "expenses":
      return receiptReport(filters, "expenses");
    case "inventory_variance":
      return inventoryVarianceReport(filters);
    case "cogs":
      return cogsReport(filters);
    case "waste":
      return wasteReport(filters);
    case "vendor_pricing":
      return vendorPricingReport(filters);
    case "shift_performance":
      return shiftPerformanceReport(filters);
    case "guest_activity":
      return guestActivityReport(filters);
  }
}
