import { TipPoolLockedError, TipPoolValidationError } from "./errors";
import type {
  TipPoolApproval,
  TipPoolCalculation,
  TipPoolExportRecord,
  TipRunStatus,
  TipValidationIssue,
} from "./types";
import { isIsoTimestamp } from "./validation";

const AUDIT_ACTOR_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function issue(code: string, path: string, message: string): TipValidationIssue {
  return { code, path, message };
}

function validateActorAndTimestamp(
  actor: string,
  timestamp: string,
  actorPath: string,
  timestampPath: string,
): void {
  const issues: TipValidationIssue[] = [];
  if (!AUDIT_ACTOR_PATTERN.test(actor)) {
    issues.push(issue("invalid_actor", actorPath, "A valid audit actor identifier is required."));
  }
  if (!isIsoTimestamp(timestamp)) {
    issues.push(issue("invalid_timestamp", timestampPath, "Use an ISO 8601 timestamp with a timezone."));
  }
  if (issues.length > 0) throw new TipPoolValidationError(issues);
}

function isSafeInteger(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value);
}

/** Recomputes every monetary control total before an approval or export boundary. */
export function assertTipCalculationReconciled(calculation: TipPoolCalculation): void {
  const reconciliation = calculation.reconciliation;
  const allAmounts: Array<{ value: unknown; path: string }> = [
    ...calculation.sources.map((source, index) => ({
      value: source.amountCents,
      path: `calculation.sources[${index}].amountCents`,
    })),
    ...calculation.employees.flatMap((employee, index) => [
      { value: employee.poolShareCents, path: `calculation.employees[${index}].poolShareCents` },
      { value: employee.adjustmentCents, path: `calculation.employees[${index}].adjustmentCents` },
      { value: employee.totalTipCents, path: `calculation.employees[${index}].totalTipCents` },
    ]),
    ...Object.entries(calculation.totals).map(([key, value]) => ({
      value,
      path: `calculation.totals.${key}`,
    })),
    ...Object.entries(reconciliation)
      .filter(([key]) => key.endsWith("Cents"))
      .map(([key, value]) => ({ value, path: `calculation.reconciliation.${key}` })),
    { value: calculation.rounding.centsAwarded, path: "calculation.rounding.centsAwarded" },
  ];
  const unsafe = allAmounts.find((amount) => !isSafeInteger(amount.value));
  if (unsafe) {
    throw new TipPoolValidationError([
      issue("invalid_calculation_amount", unsafe.path, "Calculation amounts must be safe integer cents."),
    ]);
  }

  const sourceGross = calculation.sources.reduce((sum, source) => sum + BigInt(source.amountCents), BigInt(0));
  const sourcePool = calculation.sources.reduce(
    (sum, source) => sum + (source.effectiveDisposition === "pool" ? BigInt(source.amountCents) : BigInt(0)),
    BigInt(0),
  );
  const sourceSeparate = calculation.sources.reduce(
    (sum, source) => sum + (source.effectiveDisposition === "separate" ? BigInt(source.amountCents) : BigInt(0)),
    BigInt(0),
  );
  const serviceChargeSeparate = calculation.sources.reduce(
    (sum, source) =>
      sum +
      (source.kind === "service_charge" && source.effectiveDisposition === "separate"
        ? BigInt(source.amountCents)
        : BigInt(0)),
    BigInt(0),
  );
  const sourceExcluded = calculation.sources.reduce(
    (sum, source) => sum + (source.effectiveDisposition === "exclude" ? BigInt(source.amountCents) : BigInt(0)),
    BigInt(0),
  );
  const employeePool = calculation.employees.reduce(
    (sum, employee) => sum + BigInt(employee.poolShareCents),
    BigInt(0),
  );
  const employeeAdjustments = calculation.employees.reduce(
    (sum, employee) => sum + BigInt(employee.adjustmentCents),
    BigInt(0),
  );
  const employeePayroll = calculation.employees.reduce(
    (sum, employee) => sum + BigInt(employee.totalTipCents),
    BigInt(0),
  );
  const employeeRowsReconcile = calculation.employees.every(
    (employee) =>
      employee.totalTipCents === employee.poolShareCents + employee.adjustmentCents && employee.totalTipCents >= 0,
  );
  const uniqueEmployeeIds = new Set(calculation.employees.map((employee) => employee.employeeId));
  const uniqueSourceIds = new Set(calculation.sources.map((source) => source.id));
  const roundingAwards = calculation.employees.reduce(
    (sum, employee) => sum + employee.explanation.roundingAwardCents,
    0,
  );

  if (
    !reconciliation.balanced ||
    reconciliation.sourceDifferenceCents !== 0 ||
    reconciliation.poolDifferenceCents !== 0 ||
    reconciliation.payrollDifferenceCents !== 0 ||
    sourceGross !== BigInt(calculation.totals.grossSourceCents) ||
    sourcePool !== BigInt(calculation.totals.pooledTipCents) ||
    sourceSeparate !== BigInt(calculation.totals.separatedSourceCents) ||
    serviceChargeSeparate !== BigInt(calculation.totals.separatedServiceChargeCents) ||
    sourceExcluded !== BigInt(calculation.totals.excludedSourceCents) ||
    sourceGross !== sourcePool + sourceSeparate + sourceExcluded ||
    employeePool !== BigInt(calculation.totals.allocatedPoolCents) ||
    employeeAdjustments !== BigInt(calculation.totals.adjustmentCents) ||
    employeePayroll !== BigInt(calculation.totals.payrollTipCents) ||
    !employeeRowsReconcile ||
    uniqueEmployeeIds.size !== calculation.employees.length ||
    uniqueSourceIds.size !== calculation.sources.length ||
    calculation.sources.some((source) => source.amountCents < 0) ||
    calculation.employees.some((employee) => employee.poolShareCents < 0) ||
    calculation.sources.some(
      (source) => source.kind === "service_charge" && source.effectiveDisposition === "pool",
    ) ||
    roundingAwards !== calculation.rounding.centsAwarded ||
    calculation.totals.allocatedPoolCents !== calculation.totals.pooledTipCents ||
    calculation.totals.payrollTipCents !==
      calculation.totals.pooledTipCents + calculation.totals.adjustmentCents
  ) {
    throw new TipPoolValidationError([
      issue(
        "unreconciled_calculation",
        "calculation.reconciliation",
        "Only an exactly reconciled calculation can be approved.",
      ),
    ]);
  }
}

function deepFreeze<T>(value: T, visited = new WeakSet<object>()): T {
  if (value === null || typeof value !== "object") return value;
  const object = value as object;
  if (visited.has(object)) return value;
  visited.add(object);
  for (const child of Object.values(object)) deepFreeze(child, visited);
  return Object.freeze(value);
}

export function isTipRunLocked(status: TipRunStatus | TipPoolCalculation["status"]): boolean {
  return status === "approved" || status === "exported";
}

export function assertTipRunEditable(run: { id: string; status: TipRunStatus }): void {
  if (isTipRunLocked(run.status)) throw new TipPoolLockedError(run.id, run.status);
}

export function assertTipCalculationEditable(calculation: TipPoolCalculation): void {
  if (calculation.lock.locked || isTipRunLocked(calculation.status)) {
    throw new TipPoolLockedError(calculation.runId, calculation.status);
  }
}

/**
 * Returns a deeply frozen approved snapshot. The caller supplies the audit time,
 * keeping approval deterministic and avoiding hidden clock dependencies.
 */
export function approveTipPoolCalculation(
  calculation: TipPoolCalculation,
  approval: TipPoolApproval,
): TipPoolCalculation {
  assertTipCalculationEditable(calculation);
  if (calculation.status !== "calculated") {
    throw new TipPoolValidationError([
      issue("invalid_approval_state", "calculation.status", "Only a calculated tip pool can be approved."),
    ]);
  }
  validateActorAndTimestamp(approval.approvedBy, approval.approvedAt, "approval.approvedBy", "approval.approvedAt");
  if (approval.note !== undefined && (approval.note.trim().length === 0 || approval.note.length > 500)) {
    throw new TipPoolValidationError([
      issue("invalid_approval_note", "approval.note", "Approval note must contain 1 to 500 characters."),
    ]);
  }
  assertTipCalculationReconciled(calculation);

  const snapshot = structuredClone(calculation);
  snapshot.status = "approved";
  snapshot.lock = { locked: true, reason: "approved" };
  snapshot.approval = {
    ...approval,
    note: approval.note?.trim(),
  };
  return deepFreeze(snapshot);
}

/** Returns a deeply frozen audit snapshot after a successful payroll export. */
export function markTipPoolCalculationExported(
  calculation: TipPoolCalculation,
  exportRecord: TipPoolExportRecord,
): TipPoolCalculation {
  if (calculation.status !== "approved" || !calculation.approval) {
    throw new TipPoolValidationError([
      issue(
        "approval_required",
        "calculation.status",
        "The calculation must be approved before it can be marked exported.",
      ),
    ]);
  }
  validateActorAndTimestamp(
    exportRecord.exportedBy,
    exportRecord.exportedAt,
    "exportRecord.exportedBy",
    "exportRecord.exportedAt",
  );

  const snapshot = structuredClone(calculation);
  snapshot.status = "exported";
  snapshot.lock = { locked: true, reason: "exported" };
  snapshot.exportRecord = { ...exportRecord };
  return deepFreeze(snapshot);
}
