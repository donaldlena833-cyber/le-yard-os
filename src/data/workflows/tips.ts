import "server-only";

import { z } from "zod";
import { assertCondition, assertFound, throwDatabaseError } from "../errors";
import { requireLocationManagement, requireOrganizationAccess } from "../policy";
import type { WorkflowContext } from "../execute";
import type {
  ApproveTipRunInput,
  CalculateTipRunInput,
  ExportTipPayrollInput,
  PrepareTipRunInput,
} from "../schemas";
import { encodeCsvRows } from "@/lib/exports/csv";
import {
  formatCentsAsDecimal,
  formatMinutesAsDecimalHours,
} from "@/lib/exports/tip-payroll-csv";

const payrollAllocationSnapshotSchema = z.array(
  z
    .object({
      employee_id: z.string().uuid(),
      payroll_reference: z.string().nullable(),
      display_name: z.string().min(1),
      worked_minutes: z.number().int().nonnegative(),
      eligible: z.boolean(),
      base_amount_cents: z.number().int(),
      adjustment_cents: z.number().int(),
      final_amount_cents: z.number().int(),
      weight: z.number().finite(),
      explanation: z.unknown(),
    })
    .strict(),
);

async function requireManagedTipRun(
  context: WorkflowContext,
  tipRunId: string,
) {
  const { data, error } = await context.supabase
    .from("tip_runs")
    .select(
      "id, organization_id, location_id, status, distributable_cents, allocated_cents, created_by, approved_by, approved_at, locked_at, calculated_at",
    )
    .eq("id", tipRunId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The tip run could not be loaded.");
  const run = assertFound(data, "The tip run was not found.");
  requireLocationManagement(
    context.actor,
    run.organization_id,
    run.location_id,
  );
  return run;
}

export async function prepareTipRun(
  context: WorkflowContext,
  input: PrepareTipRunInput,
) {
  const { data: closeout, error: closeoutError } = await context.supabase
    .from("shift_closeouts")
    .select("id, organization_id, location_id, status")
    .eq("id", input.closeoutId)
    .maybeSingle();
  if (closeoutError) throwDatabaseError(closeoutError, "The closeout could not be verified.");
  const source = assertFound(closeout, "The closeout was not found.");
  requireLocationManagement(context.actor, source.organization_id, source.location_id);
  assertCondition(
    source.status === "approved",
    "conflict",
    "Approve the closeout before preparing its payroll-support tip run.",
  );

  const { data: policy, error: policyError } = await context.supabase
    .from("tip_pool_policy_versions")
    .select("id, organization_id, approved_at, distribution_method")
    .eq("id", input.policyVersionId)
    .maybeSingle();
  if (policyError) throwDatabaseError(policyError, "The tip policy could not be verified.");
  const version = assertFound(policy, "The tip policy version was not found.");
  assertCondition(
    version.organization_id === source.organization_id && version.approved_at !== null,
    "conflict",
    "Choose an approved tip policy from this organization.",
  );
  assertCondition(
    version.distribution_method !== "points",
    "validation",
    "Points-only policies are unsupported; use hours or weighted hours.",
  );

  const { data, error } = await context.supabase.rpc(
    "prepare_tip_run_from_closeout",
    {
      p_request_id: input.requestId,
      p_closeout_id: input.closeoutId,
      p_policy_version_id: input.policyVersionId,
    },
  );
  if (error) throwDatabaseError(error, "The tip run could not be prepared from verified records.");
  const run = assertFound(data, "The prepared tip run was not returned.");
  return {
    id: run.id as string,
    status: run.status as string,
    closeoutId: run.closeout_id as string,
  };
}

export async function calculateTipRun(
  context: WorkflowContext,
  input: CalculateTipRunInput,
) {
  const existing = await requireManagedTipRun(context, input.tipRunId);
  if (existing.status === "calculated") {
    return {
      id: existing.id as string,
      status: existing.status as string,
      distributableCents: Number(existing.distributable_cents),
      allocatedCents: Number(existing.allocated_cents),
      alreadyApplied: true,
    };
  }
  assertCondition(
    existing.locked_at === null && existing.status === "draft",
    "conflict",
    "Only an unlocked draft tip run can be calculated.",
  );
  const { data, error } = await context.supabase.rpc("calculate_tip_run", {
    p_tip_run_id: existing.id,
  });
  if (error) throwDatabaseError(error, "The deterministic tip calculation failed.");
  const run = assertFound(data, "The calculated tip run was not returned.");
  return {
    id: run.id as string,
    status: run.status as string,
    distributableCents: Number(run.distributable_cents),
    allocatedCents: Number(run.allocated_cents),
    alreadyApplied: false,
  };
}

export async function approveTipRun(
  context: WorkflowContext,
  input: ApproveTipRunInput,
) {
  const existing = await requireManagedTipRun(context, input.tipRunId);
  if (existing.status === "approved") {
    return {
      id: existing.id as string,
      status: existing.status as string,
      approvedAt: existing.approved_at as string,
      alreadyApplied: true,
    };
  }
  assertCondition(
    existing.status === "calculated" &&
      Number(existing.allocated_cents) === Number(existing.distributable_cents),
    "conflict",
    "Only a balanced calculated tip run can be approved.",
  );
  assertCondition(
    existing.created_by !== context.actor.userId,
    "forbidden",
    "A different authorized manager must approve this tip run.",
  );
  const { data, error } = await context.supabase.rpc("approve_tip_run", {
    p_tip_run_id: existing.id,
  });
  if (error) throwDatabaseError(error, "The tip approval could not be recorded.");
  const run = assertFound(data, "The approved tip run was not returned.");
  return {
    id: run.id as string,
    status: run.status as string,
    approvedAt: run.approved_at as string,
    alreadyApplied: false,
  };
}

export async function exportTipPayroll(
  context: WorkflowContext,
  input: ExportTipPayrollInput,
) {
  const { data: runRow, error: runError } = await context.supabase
    .from("tip_runs")
    .select(
      "id, organization_id, location_id, policy_version_id, business_date, shift_label, status, distributable_cents, allocated_cents, calculation_version",
    )
    .eq("id", input.tipRunId)
    .maybeSingle();
  if (runError) throwDatabaseError(runError, "The approved tip run could not be loaded.");
  const run = assertFound(runRow, "The approved tip run was not found.");
  const membership = requireOrganizationAccess(context.actor, run.organization_id);
  assertCondition(
    membership.role === "admin" || membership.role === "owner",
    "forbidden",
    "Only Owners or Admins may create a payroll export.",
  );
  assertCondition(
    run.status === "approved" &&
      Number(run.distributable_cents) === Number(run.allocated_cents),
    "conflict",
    "Only a locked, balanced, approved tip run can be exported.",
  );

  const { data: existing, error: existingError } = await context.supabase
    .from("payroll_exports")
    .select("id")
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) {
    throwDatabaseError(existingError, "The export request could not be checked.");
  }

  const { data: audited, error: auditError } = await context.supabase.rpc(
    "record_tip_payroll_export",
    {
      p_request_id: input.requestId,
      p_tip_run_id: run.id,
      p_format: "csv",
      p_storage_path: null,
    },
  );
  if (auditError) {
    throwDatabaseError(auditError, "The payroll export could not be audited.");
  }
  const audit = assertFound(audited, "The audited payroll export was not returned.");
  const parsedSnapshot = payrollAllocationSnapshotSchema.safeParse(
    audit.allocation_snapshot,
  );
  assertCondition(
    parsedSnapshot.success && parsedSnapshot.data.length > 0,
    "conflict",
    "The audited payroll allocation snapshot is incomplete.",
  );
  const allocations = parsedSnapshot.data;
  const allocationTotal = allocations.reduce(
    (sum, row) => sum + row.final_amount_cents,
    0,
  );
  assertCondition(
    Number.isSafeInteger(allocationTotal) && allocationTotal === Number(run.allocated_cents),
    "conflict",
    "The audited payroll allocation snapshot does not reconcile to the approved tip run.",
  );

  const [versionResult, organizationResult] = await Promise.all([
    context.supabase
      .from("tip_pool_policy_versions")
      .select("version, policy_id")
      .eq("organization_id", run.organization_id)
      .eq("id", run.policy_version_id)
      .single(),
    context.supabase
      .from("organizations")
      .select("currency_code")
      .eq("id", run.organization_id)
      .single(),
  ]);
  if (versionResult.error || organizationResult.error) {
    throwDatabaseError(
      versionResult.error ?? organizationResult.error!,
      "The payroll export labels could not be loaded.",
    );
  }
  const { data: policy, error: policyError } = await context.supabase
    .from("tip_pool_policies")
    .select("name")
    .eq("organization_id", run.organization_id)
    .eq("id", versionResult.data.policy_id)
    .single();
  if (policyError) {
    throwDatabaseError(policyError, "The payroll policy label could not be loaded.");
  }

  const rows: string[][] = [
    [
      "Organization ID",
      "Location ID",
      "Run ID",
      "Business Date",
      "Shift",
      "Policy Revision",
      "Employee ID",
      "Payroll Reference",
      "Employee Name",
      "Eligible",
      "Worked Minutes",
      "Worked Hours",
      "Pool Share",
      "Adjustment",
      "Total Tips",
      "Currency",
      "Explanation",
    ],
  ];
  for (const allocation of allocations) {
    const workedMinutes = allocation.worked_minutes;
    rows.push([
      run.organization_id,
      run.location_id,
      run.id,
      run.business_date,
      run.shift_label,
      `${policy.name} v${versionResult.data.version}`,
      allocation.employee_id,
      allocation.payroll_reference ?? "",
      allocation.display_name,
      allocation.eligible ? "true" : "false",
      String(workedMinutes),
      formatMinutesAsDecimalHours(workedMinutes),
      formatCentsAsDecimal(Number(allocation.base_amount_cents)),
      formatCentsAsDecimal(Number(allocation.adjustment_cents)),
      formatCentsAsDecimal(Number(allocation.final_amount_cents)),
      organizationResult.data.currency_code,
      JSON.stringify(allocation.explanation),
    ]);
  }
  const csv = encodeCsvRows(rows);
  return {
    id: audit.id as string,
    csv,
    fileName: `le-yard-tips-${run.business_date}-${run.shift_label.toLowerCase().replaceAll(/[^a-z0-9]+/g, "-")}.csv`,
    alreadyApplied: existing !== null,
  };
}
