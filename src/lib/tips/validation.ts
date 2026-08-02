import { z } from "zod";

import { TipPoolLockedError, TipPoolValidationError } from "./errors";
import {
  ORGANIZATION_ROLES,
  TIP_SOURCE_KINDS,
  type TipPoolPolicy,
  type TipPoolRun,
  type TipSource,
  type TipSourceDisposition,
  type TipValidationIssue,
} from "./types";

const identifierSchema = z
  .string()
  .trim()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9][A-Za-z0-9._:-]*$/, "Use letters, numbers, dots, underscores, colons, or hyphens.");

const labelSchema = z.string().trim().min(1).max(240);
const dateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD.");
const timestampSchema = z.string().trim().min(1).max(64);
const safeUnsignedIntegerSchema = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const safePositiveIntegerSchema = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const safeSignedIntegerSchema = z
  .number()
  .int()
  .min(Number.MIN_SAFE_INTEGER)
  .max(Number.MAX_SAFE_INTEGER);
const basisPointSchema = safeUnsignedIntegerSchema.max(1_000_000);

const roleSchema = z.enum(ORGANIZATION_ROLES);
const sourceKindSchema = z.enum(TIP_SOURCE_KINDS);

const policySchema = z
  .object({
    id: identifierSchema,
    organizationId: identifierSchema,
    locationId: identifierSchema,
    version: safePositiveIntegerSchema,
    name: labelSchema,
    status: z.enum(["draft", "active", "retired"]),
    effectiveFrom: dateSchema,
    effectiveTo: dateSchema.optional(),
    allocationMethod: z.enum(["hours", "weighted_points"]),
    eligibility: z
      .object({
        organizationRoles: z.array(roleSchema).max(4).optional(),
        jobCodeIds: z.array(identifierSchema).max(1_000).optional(),
        excludedEmployeeIds: z.array(identifierSchema).max(10_000).optional(),
      })
      .strict()
      .optional(),
    weights: z
      .object({
        defaultBasisPoints: basisPointSchema.optional(),
        organizationRoleBasisPoints: z.record(z.string(), basisPointSchema).optional(),
        jobCodeBasisPoints: z.record(identifierSchema, basisPointSchema).optional(),
        employeeBasisPoints: z.record(identifierSchema, basisPointSchema).optional(),
      })
      .strict()
      .optional(),
    rounding: z
      .object({
        method: z.literal("largest_remainder").optional(),
        tieBreaker: z.literal("employee_id_ascending").optional(),
      })
      .strict()
      .optional(),
  })
  .strict();

const segmentSchema = z
  .object({
    id: identifierSchema,
    jobCodeId: identifierSchema,
    minutes: safePositiveIntegerSchema,
    excluded: z.boolean().optional(),
    exclusionReason: labelSchema.optional(),
  })
  .strict();

const participantSchema = z
  .object({
    employeeId: identifierSchema,
    displayName: labelSchema,
    organizationRole: roleSchema,
    segments: z.array(segmentSchema).max(10_000),
    excluded: z.boolean().optional(),
    exclusionReason: labelSchema.optional(),
  })
  .strict();

const sourceSchema = z
  .object({
    id: identifierSchema,
    label: labelSchema,
    kind: sourceKindSchema,
    amountCents: safeUnsignedIntegerSchema,
    disposition: z.enum(["pool", "separate", "exclude"]).optional(),
  })
  .strict();

const adjustmentSchema = z
  .object({
    id: identifierSchema,
    employeeId: identifierSchema,
    amountCents: safeSignedIntegerSchema.refine((amount) => amount !== 0, "Adjustment cannot be zero."),
    reason: labelSchema,
    createdBy: identifierSchema.optional(),
    createdAt: timestampSchema.optional(),
  })
  .strict();

const runSchema = z
  .object({
    id: identifierSchema,
    organizationId: identifierSchema,
    locationId: identifierSchema,
    businessDate: dateSchema,
    currency: z.string().regex(/^[A-Z]{3}$/, "Use a three-letter uppercase ISO currency code."),
    policyId: identifierSchema,
    policyVersion: safePositiveIntegerSchema,
    status: z.enum(["draft", "calculated", "approved", "exported"]),
    sources: z.array(sourceSchema).max(10_000),
    participants: z.array(participantSchema).max(100_000),
    adjustments: z.array(adjustmentSchema).max(100_000).optional(),
  })
  .strict();

function pathToString(root: string, path: PropertyKey[]): string {
  return path.reduce<string>((result, part) => {
    if (typeof part === "number") return `${result}[${part}]`;
    return result.length === 0 ? String(part) : `${result}.${String(part)}`;
  }, root);
}

function schemaIssues(root: string, error: z.ZodError): TipValidationIssue[] {
  return error.issues.map((issue) => ({
    code: `schema_${issue.code}`,
    path: pathToString(root, issue.path),
    message: issue.message,
  }));
}

function issue(code: string, path: string, message: string): TipValidationIssue {
  return { code, path, message };
}

function isRealCalendarDate(value: string): boolean {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return false;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const candidate = new Date(Date.UTC(year, month - 1, day));
  return (
    candidate.getUTCFullYear() === year &&
    candidate.getUTCMonth() === month - 1 &&
    candidate.getUTCDate() === day
  );
}

export function isIsoTimestamp(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    return false;
  }
  return isRealCalendarDate(value.slice(0, 10)) && Number.isFinite(Date.parse(value));
}

function addDuplicateIssues(
  values: string[],
  path: string,
  code: string,
  issues: TipValidationIssue[],
): void {
  const seen = new Set<string>();
  const reported = new Set<string>();
  for (const value of values) {
    if (seen.has(value) && !reported.has(value)) {
      issues.push(issue(code, path, `Duplicate identifier "${value}".`));
      reported.add(value);
    }
    seen.add(value);
  }
}

function assertSafeBigInt(value: bigint, path: string, issues: TipValidationIssue[]): void {
  if (value > BigInt(Number.MAX_SAFE_INTEGER) || value < BigInt(Number.MIN_SAFE_INTEGER)) {
    issues.push(issue("unsafe_aggregate", path, "The aggregate exceeds JavaScript's safe integer range."));
  }
}

export function resolveSourceDisposition(source: TipSource): TipSourceDisposition {
  if (source.disposition) return source.disposition;
  return source.kind === "service_charge" ? "separate" : "pool";
}

export function validateTipPoolPolicy(input: unknown): TipPoolPolicy {
  const parsed = policySchema.safeParse(input);
  if (!parsed.success) throw new TipPoolValidationError(schemaIssues("policy", parsed.error));

  const policy = parsed.data as TipPoolPolicy;
  const issues: TipValidationIssue[] = [];

  if (!isRealCalendarDate(policy.effectiveFrom)) {
    issues.push(issue("invalid_date", "policy.effectiveFrom", "The effective date is not a real calendar date."));
  }
  if (policy.effectiveTo && !isRealCalendarDate(policy.effectiveTo)) {
    issues.push(issue("invalid_date", "policy.effectiveTo", "The effective date is not a real calendar date."));
  }
  if (policy.effectiveTo && policy.effectiveTo < policy.effectiveFrom) {
    issues.push(issue("invalid_effective_window", "policy.effectiveTo", "The end date precedes the start date."));
  }

  addDuplicateIssues(
    policy.eligibility?.organizationRoles ?? [],
    "policy.eligibility.organizationRoles",
    "duplicate_role",
    issues,
  );
  addDuplicateIssues(
    policy.eligibility?.jobCodeIds ?? [],
    "policy.eligibility.jobCodeIds",
    "duplicate_job_code",
    issues,
  );
  addDuplicateIssues(
    policy.eligibility?.excludedEmployeeIds ?? [],
    "policy.eligibility.excludedEmployeeIds",
    "duplicate_employee",
    issues,
  );

  for (const role of Object.keys(policy.weights?.organizationRoleBasisPoints ?? {})) {
    if (!(ORGANIZATION_ROLES as readonly string[]).includes(role)) {
      issues.push(
        issue(
          "unknown_role_weight",
          `policy.weights.organizationRoleBasisPoints.${role}`,
          `Unknown organization role "${role}".`,
        ),
      );
    }
  }

  if (issues.length > 0) throw new TipPoolValidationError(issues);
  return policy;
}

export function validateTipPoolRun(input: unknown): TipPoolRun {
  const parsed = runSchema.safeParse(input);
  if (!parsed.success) throw new TipPoolValidationError(schemaIssues("run", parsed.error));

  const run = parsed.data as TipPoolRun;
  const issues: TipValidationIssue[] = [];

  if (!isRealCalendarDate(run.businessDate)) {
    issues.push(issue("invalid_date", "run.businessDate", "The business date is not a real calendar date."));
  }

  addDuplicateIssues(run.sources.map((source) => source.id), "run.sources", "duplicate_source", issues);
  addDuplicateIssues(
    run.participants.map((participant) => participant.employeeId),
    "run.participants",
    "duplicate_employee",
    issues,
  );
  addDuplicateIssues(
    run.adjustments?.map((adjustment) => adjustment.id) ?? [],
    "run.adjustments",
    "duplicate_adjustment",
    issues,
  );

  const employeeIds = new Set(run.participants.map((participant) => participant.employeeId));
  const segmentIds: string[] = [];
  let totalMinutes = BigInt(0);

  run.participants.forEach((participant, participantIndex) => {
    if (participant.excluded && !participant.exclusionReason) {
      issues.push(
        issue(
          "missing_exclusion_reason",
          `run.participants[${participantIndex}].exclusionReason`,
          "An excluded participant requires a reason.",
        ),
      );
    }
    participant.segments.forEach((segment, segmentIndex) => {
      segmentIds.push(segment.id);
      totalMinutes += BigInt(segment.minutes);
      if (segment.excluded && !segment.exclusionReason) {
        issues.push(
          issue(
            "missing_exclusion_reason",
            `run.participants[${participantIndex}].segments[${segmentIndex}].exclusionReason`,
            "An excluded work segment requires a reason.",
          ),
        );
      }
    });
  });
  addDuplicateIssues(segmentIds, "run.participants.segments", "duplicate_segment", issues);
  assertSafeBigInt(totalMinutes, "run.participants.segments.minutes", issues);

  run.sources.forEach((source, sourceIndex) => {
    if (source.kind === "service_charge" && resolveSourceDisposition(source) === "pool") {
      issues.push(
        issue(
          "service_charge_must_be_separate",
          `run.sources[${sourceIndex}].disposition`,
          "Service charges cannot be included in the tip pool.",
        ),
      );
    }
  });

  run.adjustments?.forEach((adjustment, adjustmentIndex) => {
    if (!employeeIds.has(adjustment.employeeId)) {
      issues.push(
        issue(
          "unknown_adjustment_employee",
          `run.adjustments[${adjustmentIndex}].employeeId`,
          `No participant exists for employee "${adjustment.employeeId}".`,
        ),
      );
    }
    if (adjustment.createdAt && !isIsoTimestamp(adjustment.createdAt)) {
      issues.push(
        issue(
          "invalid_timestamp",
          `run.adjustments[${adjustmentIndex}].createdAt`,
          "Use an ISO 8601 timestamp with a timezone.",
        ),
      );
    }
  });

  const grossSourceCents = run.sources.reduce(
    (sum, source) => sum + BigInt(source.amountCents),
    BigInt(0),
  );
  const adjustmentCents = (run.adjustments ?? []).reduce(
    (sum, adjustment) => sum + BigInt(adjustment.amountCents),
    BigInt(0),
  );
  assertSafeBigInt(grossSourceCents, "run.sources.amountCents", issues);
  assertSafeBigInt(adjustmentCents, "run.adjustments.amountCents", issues);

  if (issues.length > 0) throw new TipPoolValidationError(issues);
  return run;
}

export function validateTipPoolInputs(
  policyInput: unknown,
  runInput: unknown,
): { policy: TipPoolPolicy; run: TipPoolRun } {
  const policy = validateTipPoolPolicy(policyInput);
  const run = validateTipPoolRun(runInput);

  if (run.status === "approved" || run.status === "exported") {
    throw new TipPoolLockedError(run.id, run.status);
  }

  const issues: TipValidationIssue[] = [];
  if (policy.status === "draft") {
    issues.push(issue("draft_policy", "policy.status", "A draft policy cannot calculate a tip run."));
  }
  if (run.policyId !== policy.id) {
    issues.push(issue("policy_id_mismatch", "run.policyId", "The run references a different policy."));
  }
  if (run.policyVersion !== policy.version) {
    issues.push(issue("policy_version_mismatch", "run.policyVersion", "The run references a different policy version."));
  }
  if (run.organizationId !== policy.organizationId) {
    issues.push(
      issue("organization_mismatch", "run.organizationId", "The run and policy belong to different organizations."),
    );
  }
  if (run.locationId !== policy.locationId) {
    issues.push(issue("location_mismatch", "run.locationId", "The run and policy belong to different locations."));
  }
  if (run.businessDate < policy.effectiveFrom) {
    issues.push(issue("policy_not_effective", "run.businessDate", "The policy is not yet effective on this date."));
  }
  if (policy.effectiveTo && run.businessDate > policy.effectiveTo) {
    issues.push(issue("policy_expired", "run.businessDate", "The policy is no longer effective on this date."));
  }

  if (issues.length > 0) throw new TipPoolValidationError(issues);
  return { policy, run };
}
