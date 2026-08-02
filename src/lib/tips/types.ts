export const TIP_CALCULATION_VERSION = "1.0.0" as const;

export const ORGANIZATION_ROLES = [
  "owner",
  "admin",
  "manager",
  "employee",
] as const;

export type OrganizationRole = (typeof ORGANIZATION_ROLES)[number];

export const TIP_SOURCE_KINDS = [
  "cash_tip",
  "card_tip",
  "digital_tip",
  "other_tip",
  "service_charge",
] as const;

export type TipSourceKind = (typeof TIP_SOURCE_KINDS)[number];
export type TipSourceDisposition = "pool" | "separate" | "exclude";
export type TipAllocationMethod = "hours" | "weighted_points";
export type TipRunStatus = "draft" | "calculated" | "approved" | "exported";

export interface TipPoolPolicy {
  id: string;
  organizationId: string;
  locationId: string;
  version: number;
  name: string;
  status: "draft" | "active" | "retired";
  effectiveFrom: string;
  effectiveTo?: string;
  allocationMethod: TipAllocationMethod;
  eligibility?: {
    organizationRoles?: OrganizationRole[];
    jobCodeIds?: string[];
    excludedEmployeeIds?: string[];
  };
  weights?: {
    /** 10,000 basis points is a 1.0x weight. */
    defaultBasisPoints?: number;
    organizationRoleBasisPoints?: Partial<Record<OrganizationRole, number>>;
    jobCodeBasisPoints?: Record<string, number>;
    employeeBasisPoints?: Record<string, number>;
  };
  rounding?: {
    method?: "largest_remainder";
    tieBreaker?: "employee_id_ascending";
  };
}

export interface TipSource {
  id: string;
  label: string;
  kind: TipSourceKind;
  amountCents: number;
  /**
   * Defaults to `pool` for tips and `separate` for service charges.
   * A service charge can never be pooled by this engine.
   */
  disposition?: TipSourceDisposition;
}

export interface WorkSegment {
  id: string;
  jobCodeId: string;
  minutes: number;
  excluded?: boolean;
  exclusionReason?: string;
}

export interface TipParticipant {
  employeeId: string;
  displayName: string;
  organizationRole: OrganizationRole;
  segments: WorkSegment[];
  excluded?: boolean;
  exclusionReason?: string;
}

export interface TipManualAdjustment {
  id: string;
  employeeId: string;
  amountCents: number;
  reason: string;
  createdBy?: string;
  createdAt?: string;
}

export interface TipPoolRun {
  id: string;
  organizationId: string;
  locationId: string;
  businessDate: string;
  currency: string;
  policyId: string;
  policyVersion: number;
  status: TipRunStatus;
  sources: TipSource[];
  participants: TipParticipant[];
  adjustments?: TipManualAdjustment[];
}

export type EmployeeEligibilityCode =
  | "eligible"
  | "participant_excluded"
  | "policy_employee_excluded"
  | "role_ineligible"
  | "no_worked_minutes"
  | "all_segments_excluded"
  | "no_eligible_job_segments"
  | "zero_weight";

export type SegmentEligibilityCode =
  | "included"
  | "participant_excluded"
  | "policy_employee_excluded"
  | "role_ineligible"
  | "segment_excluded"
  | "job_ineligible"
  | "zero_weight";

export interface SegmentCalculationExplanation {
  segmentId: string;
  jobCodeId: string;
  minutes: number;
  included: boolean;
  code: SegmentEligibilityCode;
  weightBasisPoints: number;
  contributionUnits: string;
  note: string;
}

export interface EmployeeCalculationExplanation {
  allocationMethod: TipAllocationMethod;
  eligibilityCode: EmployeeEligibilityCode;
  eligibilityNote: string;
  segments: SegmentCalculationExplanation[];
  contributionUnits: string;
  totalContributionUnits: string;
  exactShareNumerator: string;
  exactShareDenominator: string;
  floorShareCents: number;
  remainderNumerator: string;
  roundingAwardCents: 0 | 1;
  adjustmentDetails: Array<{
    id: string;
    amountCents: number;
    reason: string;
  }>;
  reconciliation: string;
}

export interface EmployeeTipAllocation {
  employeeId: string;
  displayName: string;
  organizationRole: OrganizationRole;
  eligible: boolean;
  workedMinutes: number;
  eligibleMinutes: number;
  contributionUnits: string;
  poolShareCents: number;
  adjustmentCents: number;
  totalTipCents: number;
  explanation: EmployeeCalculationExplanation;
}

export interface TipSourceBreakdown extends TipSource {
  effectiveDisposition: TipSourceDisposition;
  explanation: string;
}

export interface TipPoolApproval {
  approvedBy: string;
  approvedAt: string;
  note?: string;
}

export interface TipPoolExportRecord {
  exportedBy: string;
  exportedAt: string;
}

export interface TipPoolCalculation {
  calculationVersion: typeof TIP_CALCULATION_VERSION;
  runId: string;
  organizationId: string;
  locationId: string;
  businessDate: string;
  currency: string;
  policy: {
    id: string;
    version: number;
    revision: string;
    name: string;
    allocationMethod: TipAllocationMethod;
  };
  status: "calculated" | "approved" | "exported";
  lock: {
    locked: boolean;
    reason?: "approved" | "exported";
  };
  approval?: TipPoolApproval;
  exportRecord?: TipPoolExportRecord;
  sources: TipSourceBreakdown[];
  employees: EmployeeTipAllocation[];
  totals: {
    grossSourceCents: number;
    pooledTipCents: number;
    separatedSourceCents: number;
    separatedServiceChargeCents: number;
    excludedSourceCents: number;
    allocatedPoolCents: number;
    adjustmentCents: number;
    payrollTipCents: number;
  };
  rounding: {
    method: "largest_remainder";
    tieBreaker: "employee_id_ascending";
    centsAwarded: number;
  };
  reconciliation: {
    classifiedSourceCents: number;
    sourceDifferenceCents: number;
    allocatedPoolCents: number;
    poolDifferenceCents: number;
    expectedPayrollCents: number;
    actualPayrollCents: number;
    payrollDifferenceCents: number;
    balanced: true;
  };
}

export interface TipValidationIssue {
  code: string;
  path: string;
  message: string;
}

export interface TipPayrollCsvOptions {
  includeZeroRows?: boolean;
  includeUtf8Bom?: boolean;
  preventSpreadsheetFormulas?: boolean;
  requireApproval?: boolean;
}
