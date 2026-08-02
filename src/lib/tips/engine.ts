import { TipPoolValidationError } from "./errors";
import type {
  EmployeeCalculationExplanation,
  EmployeeEligibilityCode,
  EmployeeTipAllocation,
  SegmentCalculationExplanation,
  SegmentEligibilityCode,
  TipManualAdjustment,
  TipParticipant,
  TipPoolCalculation,
  TipPoolPolicy,
  TipPoolRun,
  TipSourceBreakdown,
  TipValidationIssue,
  WorkSegment,
} from "./types";
import { TIP_CALCULATION_VERSION } from "./types";
import { resolveSourceDisposition, validateTipPoolInputs } from "./validation";

const ZERO = BigInt(0);
const DEFAULT_WEIGHT_BASIS_POINTS = 10_000;

interface WorkingEmployee {
  participant: TipParticipant;
  eligibilityCode: EmployeeEligibilityCode;
  eligibilityNote: string;
  eligible: boolean;
  workedMinutes: number;
  eligibleMinutes: number;
  contributionUnits: bigint;
  segments: SegmentCalculationExplanation[];
  exactNumerator: bigint;
  exactDenominator: bigint;
  floorShareCents: bigint;
  remainderNumerator: bigint;
  roundingAwardCents: 0 | 1;
  adjustments: TipManualAdjustment[];
}

function compareIds(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function validationIssue(code: string, path: string, message: string): TipValidationIssue {
  return { code, path, message };
}

function toSafeNumber(value: bigint, path: string): number {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    throw new TipPoolValidationError([
      validationIssue("unsafe_aggregate", path, "The calculated value exceeds JavaScript's safe integer range."),
    ]);
  }
  return Number(value);
}

function resolveWeightBasisPoints(
  policy: TipPoolPolicy,
  participant: TipParticipant,
  segment: WorkSegment,
): { value: number; source: string } {
  if (policy.allocationMethod === "hours") {
    return { value: DEFAULT_WEIGHT_BASIS_POINTS, source: "hour-based policy" };
  }

  const employeeWeight = policy.weights?.employeeBasisPoints?.[participant.employeeId];
  if (employeeWeight !== undefined) return { value: employeeWeight, source: "employee override" };

  const jobWeight = policy.weights?.jobCodeBasisPoints?.[segment.jobCodeId];
  if (jobWeight !== undefined) return { value: jobWeight, source: `job ${segment.jobCodeId}` };

  const roleWeight = policy.weights?.organizationRoleBasisPoints?.[participant.organizationRole];
  if (roleWeight !== undefined) return { value: roleWeight, source: `role ${participant.organizationRole}` };

  return {
    value: policy.weights?.defaultBasisPoints ?? DEFAULT_WEIGHT_BASIS_POINTS,
    source: "policy default",
  };
}

function segmentExplanation(
  segment: WorkSegment,
  code: SegmentEligibilityCode,
  weightBasisPoints: number,
  contributionUnits: bigint,
  note: string,
): SegmentCalculationExplanation {
  return {
    segmentId: segment.id,
    jobCodeId: segment.jobCodeId,
    minutes: segment.minutes,
    included: code === "included",
    code,
    weightBasisPoints,
    contributionUnits: contributionUnits.toString(),
    note,
  };
}

function participantGate(
  participant: TipParticipant,
  policy: TipPoolPolicy,
): { code: SegmentEligibilityCode; employeeCode: EmployeeEligibilityCode; note: string } | undefined {
  if (participant.excluded) {
    return {
      code: "participant_excluded",
      employeeCode: "participant_excluded",
      note: participant.exclusionReason ?? "Participant was excluded from this run.",
    };
  }
  if (policy.eligibility?.excludedEmployeeIds?.includes(participant.employeeId)) {
    return {
      code: "policy_employee_excluded",
      employeeCode: "policy_employee_excluded",
      note: "Employee is excluded by this policy version.",
    };
  }
  const eligibleRoles = policy.eligibility?.organizationRoles;
  if (eligibleRoles && !eligibleRoles.includes(participant.organizationRole)) {
    return {
      code: "role_ineligible",
      employeeCode: "role_ineligible",
      note: `Role ${participant.organizationRole} is not eligible under this policy version.`,
    };
  }
  return undefined;
}

function prepareEmployee(participant: TipParticipant, policy: TipPoolPolicy): WorkingEmployee {
  const gate = participantGate(participant, policy);
  const eligibleJobs = policy.eligibility?.jobCodeIds;
  const segmentExplanations: SegmentCalculationExplanation[] = [];
  let eligibleMinutes = 0;
  let contributionUnits = ZERO;
  let sawPolicyEligibleJob = false;
  let sawNonExcludedSegment = false;
  let sawPositiveWeight = false;

  for (const segment of [...participant.segments].sort((left, right) => compareIds(left.id, right.id))) {
    const weight = resolveWeightBasisPoints(policy, participant, segment);

    if (gate) {
      segmentExplanations.push(segmentExplanation(segment, gate.code, weight.value, ZERO, gate.note));
      continue;
    }
    if (segment.excluded) {
      segmentExplanations.push(
        segmentExplanation(
          segment,
          "segment_excluded",
          weight.value,
          ZERO,
          segment.exclusionReason ?? "Segment was excluded from this run.",
        ),
      );
      continue;
    }

    sawNonExcludedSegment = true;
    if (eligibleJobs && !eligibleJobs.includes(segment.jobCodeId)) {
      segmentExplanations.push(
        segmentExplanation(
          segment,
          "job_ineligible",
          weight.value,
          ZERO,
          `Job ${segment.jobCodeId} is not eligible under this policy version.`,
        ),
      );
      continue;
    }

    sawPolicyEligibleJob = true;
    if (weight.value === 0) {
      segmentExplanations.push(
        segmentExplanation(
          segment,
          "zero_weight",
          weight.value,
          ZERO,
          `The ${weight.source} weight is zero.`,
        ),
      );
      continue;
    }

    sawPositiveWeight = true;
    const segmentContribution =
      policy.allocationMethod === "hours"
        ? BigInt(segment.minutes)
        : BigInt(segment.minutes) * BigInt(weight.value);
    eligibleMinutes += segment.minutes;
    contributionUnits += segmentContribution;
    segmentExplanations.push(
      segmentExplanation(
        segment,
        "included",
        weight.value,
        segmentContribution,
        policy.allocationMethod === "hours"
          ? `${segment.minutes} eligible minutes.`
          : `${segment.minutes} minutes x ${weight.value} basis points from ${weight.source}.`,
      ),
    );
  }

  const workedMinutes = participant.segments.reduce((sum, segment) => sum + segment.minutes, 0);
  let eligibilityCode: EmployeeEligibilityCode;
  let eligibilityNote: string;

  if (gate) {
    eligibilityCode = gate.employeeCode;
    eligibilityNote = gate.note;
  } else if (participant.segments.length === 0) {
    eligibilityCode = "no_worked_minutes";
    eligibilityNote = "No work segments were supplied for this employee.";
  } else if (!sawNonExcludedSegment) {
    eligibilityCode = "all_segments_excluded";
    eligibilityNote = "Every work segment was explicitly excluded.";
  } else if (!sawPolicyEligibleJob) {
    eligibilityCode = "no_eligible_job_segments";
    eligibilityNote = "No worked segment used a job eligible under this policy version.";
  } else if (!sawPositiveWeight || contributionUnits === ZERO) {
    eligibilityCode = "zero_weight";
    eligibilityNote = "Eligible work exists, but its configured weight is zero.";
  } else {
    eligibilityCode = "eligible";
    eligibilityNote =
      policy.allocationMethod === "hours"
        ? "Pool share is proportional to eligible minutes."
        : "Pool share is proportional to eligible weighted points.";
  }

  return {
    participant,
    eligibilityCode,
    eligibilityNote,
    eligible: contributionUnits > ZERO,
    workedMinutes,
    eligibleMinutes,
    contributionUnits,
    segments: segmentExplanations,
    exactNumerator: ZERO,
    exactDenominator: ZERO,
    floorShareCents: ZERO,
    remainderNumerator: ZERO,
    roundingAwardCents: 0,
    adjustments: [],
  };
}

function sourceExplanation(source: TipSourceBreakdown): string {
  if (source.kind === "service_charge") {
    return source.effectiveDisposition === "exclude"
      ? "Service charge is recorded but excluded from this calculation."
      : "Service charge is reported separately and never enters the tip pool.";
  }
  if (source.effectiveDisposition === "pool") return "Tip source is included in the distributable pool.";
  if (source.effectiveDisposition === "separate") return "Tip source is held separate from this pool.";
  return "Tip source is recorded but excluded from this calculation.";
}

function buildSources(run: TipPoolRun): TipSourceBreakdown[] {
  return [...run.sources]
    .sort((left, right) => compareIds(left.id, right.id))
    .map((source) => {
      const breakdown: TipSourceBreakdown = {
        ...source,
        effectiveDisposition: resolveSourceDisposition(source),
        explanation: "",
      };
      breakdown.explanation = sourceExplanation(breakdown);
      return breakdown;
    });
}

function sumSources(
  sources: TipSourceBreakdown[],
  predicate: (source: TipSourceBreakdown) => boolean,
): bigint {
  return sources.reduce(
    (sum, source) => (predicate(source) ? sum + BigInt(source.amountCents) : sum),
    ZERO,
  );
}

function groupAdjustments(run: TipPoolRun): Map<string, TipManualAdjustment[]> {
  const byEmployee = new Map<string, TipManualAdjustment[]>();
  for (const adjustment of [...(run.adjustments ?? [])].sort((left, right) => compareIds(left.id, right.id))) {
    const employeeAdjustments = byEmployee.get(adjustment.employeeId) ?? [];
    employeeAdjustments.push(adjustment);
    byEmployee.set(adjustment.employeeId, employeeAdjustments);
  }
  return byEmployee;
}

function allocatePool(employees: WorkingEmployee[], poolCents: bigint): number {
  const totalContribution = employees.reduce((sum, employee) => sum + employee.contributionUnits, ZERO);
  if (poolCents > ZERO && totalContribution === ZERO) {
    throw new TipPoolValidationError([
      validationIssue(
        "no_eligible_contribution",
        "run.participants",
        "A positive tip pool cannot be distributed because no employee has eligible contribution units.",
      ),
    ]);
  }

  let allocatedFloor = ZERO;
  for (const employee of employees) {
    employee.exactDenominator = totalContribution;
    if (poolCents === ZERO || employee.contributionUnits === ZERO) continue;
    employee.exactNumerator = poolCents * employee.contributionUnits;
    employee.floorShareCents = employee.exactNumerator / totalContribution;
    employee.remainderNumerator = employee.exactNumerator % totalContribution;
    allocatedFloor += employee.floorShareCents;
  }

  const remainderCents = poolCents - allocatedFloor;
  const ranked = employees
    .filter((employee) => employee.contributionUnits > ZERO)
    .sort((left, right) => {
      if (left.remainderNumerator > right.remainderNumerator) return -1;
      if (left.remainderNumerator < right.remainderNumerator) return 1;
      return compareIds(left.participant.employeeId, right.participant.employeeId);
    });

  const awards = toSafeNumber(remainderCents, "calculation.rounding.centsAwarded");
  if (awards > ranked.length) {
    throw new TipPoolValidationError([
      validationIssue("rounding_invariant", "calculation.rounding", "Largest-remainder allocation invariant failed."),
    ]);
  }
  for (let index = 0; index < awards; index += 1) ranked[index].roundingAwardCents = 1;
  return awards;
}

function employeeOutput(
  employee: WorkingEmployee,
  policy: TipPoolPolicy,
  totalContribution: bigint,
): EmployeeTipAllocation {
  const poolShare = employee.floorShareCents + BigInt(employee.roundingAwardCents);
  const adjustment = employee.adjustments.reduce(
    (sum, item) => sum + BigInt(item.amountCents),
    ZERO,
  );
  const total = poolShare + adjustment;

  const poolShareCents = toSafeNumber(poolShare, `calculation.employees.${employee.participant.employeeId}.poolShareCents`);
  const adjustmentCents = toSafeNumber(
    adjustment,
    `calculation.employees.${employee.participant.employeeId}.adjustmentCents`,
  );
  const totalTipCents = toSafeNumber(total, `calculation.employees.${employee.participant.employeeId}.totalTipCents`);

  const explanation: EmployeeCalculationExplanation = {
    allocationMethod: policy.allocationMethod,
    eligibilityCode: employee.eligibilityCode,
    eligibilityNote: employee.eligibilityNote,
    segments: employee.segments,
    contributionUnits: employee.contributionUnits.toString(),
    totalContributionUnits: totalContribution.toString(),
    exactShareNumerator: employee.exactNumerator.toString(),
    exactShareDenominator: employee.exactDenominator.toString(),
    floorShareCents: toSafeNumber(
      employee.floorShareCents,
      `calculation.employees.${employee.participant.employeeId}.explanation.floorShareCents`,
    ),
    remainderNumerator: employee.remainderNumerator.toString(),
    roundingAwardCents: employee.roundingAwardCents,
    adjustmentDetails: employee.adjustments.map((item) => ({
      id: item.id,
      amountCents: item.amountCents,
      reason: item.reason,
    })),
    reconciliation: `${poolShareCents} cents pool share + ${adjustmentCents} cents adjustments = ${totalTipCents} cents.`,
  };

  return {
    employeeId: employee.participant.employeeId,
    displayName: employee.participant.displayName,
    organizationRole: employee.participant.organizationRole,
    eligible: employee.eligible,
    workedMinutes: employee.workedMinutes,
    eligibleMinutes: employee.eligibleMinutes,
    contributionUnits: employee.contributionUnits.toString(),
    poolShareCents,
    adjustmentCents,
    totalTipCents,
    explanation,
  };
}

/**
 * Deterministically calculates a tip pool using integer cents and minutes.
 * No clock, random value, locale, or input ordering affects the result.
 */
export function calculateTipPool(policyInput: unknown, runInput: unknown): TipPoolCalculation {
  const { policy, run } = validateTipPoolInputs(policyInput, runInput);
  const sources = buildSources(run);
  const grossSourceCents = sumSources(sources, () => true);
  const pooledTipCents = sumSources(sources, (source) => source.effectiveDisposition === "pool");
  const separatedSourceCents = sumSources(sources, (source) => source.effectiveDisposition === "separate");
  const separatedServiceChargeCents = sumSources(
    sources,
    (source) => source.kind === "service_charge" && source.effectiveDisposition === "separate",
  );
  const excludedSourceCents = sumSources(sources, (source) => source.effectiveDisposition === "exclude");

  const workingEmployees = [...run.participants]
    .sort((left, right) => compareIds(left.employeeId, right.employeeId))
    .map((participant) => prepareEmployee(participant, policy));
  const adjustmentGroups = groupAdjustments(run);
  for (const employee of workingEmployees) {
    employee.adjustments = adjustmentGroups.get(employee.participant.employeeId) ?? [];
  }

  const roundingCentsAwarded = allocatePool(workingEmployees, pooledTipCents);
  const totalContribution = workingEmployees.reduce((sum, employee) => sum + employee.contributionUnits, ZERO);
  const employees = workingEmployees.map((employee) => employeeOutput(employee, policy, totalContribution));

  const negativePayoutIssues = employees
    .filter((employee) => employee.totalTipCents < 0)
    .map((employee) =>
      validationIssue(
        "negative_employee_payout",
        `calculation.employees.${employee.employeeId}.totalTipCents`,
        "Manual adjustments cannot reduce an employee's payout below zero.",
      ),
    );
  if (negativePayoutIssues.length > 0) throw new TipPoolValidationError(negativePayoutIssues);

  const allocatedPoolCents = employees.reduce(
    (sum, employee) => sum + BigInt(employee.poolShareCents),
    ZERO,
  );
  const adjustmentCents = employees.reduce(
    (sum, employee) => sum + BigInt(employee.adjustmentCents),
    ZERO,
  );
  const payrollTipCents = employees.reduce(
    (sum, employee) => sum + BigInt(employee.totalTipCents),
    ZERO,
  );
  const classifiedSourceCents = pooledTipCents + separatedSourceCents + excludedSourceCents;
  const sourceDifferenceCents = grossSourceCents - classifiedSourceCents;
  const poolDifferenceCents = pooledTipCents - allocatedPoolCents;
  const expectedPayrollCents = pooledTipCents + adjustmentCents;
  const payrollDifferenceCents = expectedPayrollCents - payrollTipCents;

  if (sourceDifferenceCents !== ZERO || poolDifferenceCents !== ZERO || payrollDifferenceCents !== ZERO) {
    throw new TipPoolValidationError([
      validationIssue(
        "reconciliation_invariant",
        "calculation.reconciliation",
        "The calculation did not reconcile exactly to its classified sources and adjustments.",
      ),
    ]);
  }

  return {
    calculationVersion: TIP_CALCULATION_VERSION,
    runId: run.id,
    organizationId: run.organizationId,
    locationId: run.locationId,
    businessDate: run.businessDate,
    currency: run.currency,
    policy: {
      id: policy.id,
      version: policy.version,
      revision: `${policy.id}@${policy.version}`,
      name: policy.name,
      allocationMethod: policy.allocationMethod,
    },
    status: "calculated",
    lock: { locked: false },
    sources,
    employees,
    totals: {
      grossSourceCents: toSafeNumber(grossSourceCents, "calculation.totals.grossSourceCents"),
      pooledTipCents: toSafeNumber(pooledTipCents, "calculation.totals.pooledTipCents"),
      separatedSourceCents: toSafeNumber(
        separatedSourceCents,
        "calculation.totals.separatedSourceCents",
      ),
      separatedServiceChargeCents: toSafeNumber(
        separatedServiceChargeCents,
        "calculation.totals.separatedServiceChargeCents",
      ),
      excludedSourceCents: toSafeNumber(excludedSourceCents, "calculation.totals.excludedSourceCents"),
      allocatedPoolCents: toSafeNumber(allocatedPoolCents, "calculation.totals.allocatedPoolCents"),
      adjustmentCents: toSafeNumber(adjustmentCents, "calculation.totals.adjustmentCents"),
      payrollTipCents: toSafeNumber(payrollTipCents, "calculation.totals.payrollTipCents"),
    },
    rounding: {
      method: policy.rounding?.method ?? "largest_remainder",
      tieBreaker: policy.rounding?.tieBreaker ?? "employee_id_ascending",
      centsAwarded: roundingCentsAwarded,
    },
    reconciliation: {
      classifiedSourceCents: toSafeNumber(
        classifiedSourceCents,
        "calculation.reconciliation.classifiedSourceCents",
      ),
      sourceDifferenceCents: 0,
      allocatedPoolCents: toSafeNumber(
        allocatedPoolCents,
        "calculation.reconciliation.allocatedPoolCents",
      ),
      poolDifferenceCents: 0,
      expectedPayrollCents: toSafeNumber(
        expectedPayrollCents,
        "calculation.reconciliation.expectedPayrollCents",
      ),
      actualPayrollCents: toSafeNumber(
        payrollTipCents,
        "calculation.reconciliation.actualPayrollCents",
      ),
      payrollDifferenceCents: 0,
      balanced: true,
    },
  };
}
