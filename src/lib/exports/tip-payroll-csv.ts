import { TipPoolExportError } from "../tips/errors";
import { assertTipCalculationReconciled } from "../tips/approval";
import type { EmployeeTipAllocation, TipPayrollCsvOptions, TipPoolCalculation } from "../tips/types";

const ZERO = BigInt(0);

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

/** Formats integer cents without floating-point arithmetic. */
export function formatCentsAsDecimal(cents: number): string {
  if (!Number.isSafeInteger(cents)) throw new TipPoolExportError("Currency values must be safe integer cents.");
  const negative = cents < 0;
  const absolute = Math.abs(cents);
  const dollars = Math.floor(absolute / 100);
  const remainder = absolute % 100;
  return `${negative ? "-" : ""}${dollars}.${remainder.toString().padStart(2, "0")}`;
}

/** Converts integer minutes to decimal hours, rounded half-up to four places. */
export function formatMinutesAsDecimalHours(minutes: number): string {
  if (!Number.isSafeInteger(minutes) || minutes < 0) {
    throw new TipPoolExportError("Worked minutes must be a non-negative safe integer.");
  }
  const scale = BigInt(10_000);
  const divisor = BigInt(60);
  const scaled = (BigInt(minutes) * scale + divisor / BigInt(2)) / divisor;
  const hours = scaled / scale;
  const fraction = scaled % scale;
  return `${hours.toString()}.${fraction.toString().padStart(4, "0")}`;
}

function protectSpreadsheetFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

export function escapeCsvField(value: string): string {
  if (!/[",\r\n]/.test(value)) return value;
  return `"${value.replaceAll('"', '""')}"`;
}

function textCell(value: string, preventSpreadsheetFormulas: boolean): string {
  return escapeCsvField(preventSpreadsheetFormulas ? protectSpreadsheetFormula(value) : value);
}

function allocationRow(
  calculation: TipPoolCalculation,
  employee: EmployeeTipAllocation,
  preventSpreadsheetFormulas: boolean,
): string {
  const explanation = `${employee.explanation.eligibilityNote} ${employee.explanation.reconciliation}`;
  const cells = [
    textCell(calculation.organizationId, preventSpreadsheetFormulas),
    textCell(calculation.locationId, preventSpreadsheetFormulas),
    textCell(calculation.runId, preventSpreadsheetFormulas),
    calculation.businessDate,
    textCell(calculation.policy.revision, preventSpreadsheetFormulas),
    textCell(employee.employeeId, preventSpreadsheetFormulas),
    textCell(employee.displayName, preventSpreadsheetFormulas),
    employee.eligible ? "true" : "false",
    employee.workedMinutes.toString(),
    employee.eligibleMinutes.toString(),
    formatMinutesAsDecimalHours(employee.eligibleMinutes),
    formatCentsAsDecimal(employee.poolShareCents),
    formatCentsAsDecimal(employee.adjustmentCents),
    formatCentsAsDecimal(employee.totalTipCents),
    calculation.currency,
    employee.explanation.eligibilityCode,
    textCell(explanation, preventSpreadsheetFormulas),
  ];
  return cells.join(",");
}

const HEADERS = [
  "Organization ID",
  "Location ID",
  "Run ID",
  "Business Date",
  "Policy Revision",
  "Employee ID",
  "Employee Name",
  "Eligible",
  "Worked Minutes",
  "Eligible Minutes",
  "Eligible Hours",
  "Pool Share",
  "Adjustment",
  "Total Tips",
  "Currency",
  "Eligibility Code",
  "Explanation",
] as const;

/**
 * Creates a stable RFC 4180-style payroll CSV. Approval is required by default;
 * callers may opt out only for clearly labeled previews.
 */
export function generateTipPayrollCsv(
  calculation: TipPoolCalculation,
  options: TipPayrollCsvOptions = {},
): string {
  const requireApproval = options.requireApproval ?? true;
  if (requireApproval && calculation.status !== "approved" && calculation.status !== "exported") {
    throw new TipPoolExportError("An approved tip calculation is required for payroll export.");
  }
  if (!calculation.reconciliation.balanced || calculation.reconciliation.payrollDifferenceCents !== 0) {
    throw new TipPoolExportError("An unreconciled tip calculation cannot be exported to payroll.");
  }
  assertTipCalculationReconciled(calculation);

  const includeZeroRows = options.includeZeroRows ?? false;
  const preventSpreadsheetFormulas = options.preventSpreadsheetFormulas ?? true;
  const rows = [...calculation.employees]
    .filter((employee) => includeZeroRows || BigInt(employee.totalTipCents) !== ZERO)
    .sort((left, right) => compareIds(left.employeeId, right.employeeId))
    .map((employee) => allocationRow(calculation, employee, preventSpreadsheetFormulas));
  const csv = [HEADERS.join(","), ...rows].join("\r\n");
  return `${options.includeUtf8Bom ? "\uFEFF" : ""}${csv}\r\n`;
}
