import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { toDomainTipDistributionMethod } from "@/lib/supabase/value-mappers";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.generated";
import { localDateKey, readFailure, readSuccess, type LiveReadResult } from "./shared";

export interface LiveCloseoutAttachment {
  id: string;
  storagePath: string;
  fileName: string;
  mimeType: string | null;
}

export interface LiveCloseout {
  id: string;
  businessDate: string;
  shiftLabel: string;
  status: string;
  grossSalesCents: number;
  netSalesCents: number;
  cashSalesCents: number;
  cardSalesCents: number;
  expectedCashCents: number;
  actualCashCents: number | null;
  covers: number;
  compsCents: number;
  voidsCents: number;
  serviceChargesCents: number;
  cardTipsCents: number;
  cashTipsCents: number;
  notes: string | null;
  submittedByUserId: string;
  submittedBy: string;
  submittedAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  attachments: LiveCloseoutAttachment[];
}

export interface LiveTipPolicy {
  id: string;
  policyId: string;
  name: string;
  version: number;
  method: "hours" | "weighted_points" | null;
  effectiveFrom: string;
  effectiveTo: string | null;
  approvedBy: string;
  rules: Array<{
    jobRoleId: string;
    jobRoleName: string;
    eligible: boolean;
    points: number;
    minimumMinutes: number;
  }>;
}

export interface LiveTipAllocation {
  id: string;
  employeeId: string;
  employeeName: string;
  baseAmountCents: number;
  adjustmentCents: number;
  finalAmountCents: number;
  weight: number;
  remainderRank: number | null;
  explanation: Record<string, unknown>;
}

export interface LiveTipRun {
  id: string;
  closeoutId: string | null;
  policyVersionId: string;
  policyName: string;
  policyVersion: number;
  method: "hours" | "weighted_points" | null;
  businessDate: string;
  shiftLabel: string;
  status: string;
  distributableCents: number;
  allocatedCents: number;
  calculationVersion: string;
  calculatedAt: string | null;
  approvedBy: string | null;
  approvedAt: string | null;
  lockedAt: string | null;
  createdByUserId: string;
  createdBy: string;
  sources: Array<{
    id: string;
    sourceType: string;
    label: string;
    amountCents: number;
    isDistributable: boolean;
  }>;
  participants: Array<{
    id: string;
    employeeId: string;
    employeeName: string;
    jobRoleName: string;
    workedMinutes: number;
    points: number;
    eligible: boolean;
    exclusionReason: string | null;
    sourceTimeEntryIds: string[];
  }>;
  allocations: LiveTipAllocation[];
}

export interface LiveCloseoutModel {
  date: string;
  timeZone: string;
  currencyCode: string;
  closeouts: LiveCloseout[];
  policies: LiveTipPolicy[];
  tipRuns: LiveTipRun[];
}

function objectJson(value: Json): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function loadLiveCloseout(
  workspace: WorkspaceContextValue,
): Promise<LiveReadResult<LiveCloseoutModel>> {
  if (workspace.role === "employee") return readFailure("Management access is required.");
  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const locationId = workspace.activeLocation.id;
    const [locationResult, organizationResult] = await Promise.all([
      supabase
        .from("locations")
        .select("timezone")
        .eq("organization_id", organizationId)
        .eq("id", locationId)
        .single(),
      supabase
        .from("organizations")
        .select("currency_code")
        .eq("id", organizationId)
        .single(),
    ]);
    if (
      locationResult.error ||
      !locationResult.data ||
      organizationResult.error ||
      !organizationResult.data
    ) return readFailure();
    const location = locationResult.data;
    const date = localDateKey(new Date(), location.timezone);

    const [closeoutResult, policyResult, tipRunResult] = await Promise.all([
      supabase
        .from("shift_closeouts")
        .select(
          "id, business_date, shift_label, status, gross_sales_cents, net_sales_cents, cash_sales_cents, card_sales_cents, expected_cash_cents, actual_cash_cents, covers, comps_cents, voids_cents, service_charges_cents, card_tips_cents, cash_tips_cents, notes, submitted_by, submitted_at, approved_by, approved_at",
        )
        .eq("organization_id", organizationId)
        .eq("location_id", locationId)
        .order("business_date", { ascending: false })
        .order("submitted_at", { ascending: false })
        .limit(60),
      supabase
        .from("tip_pool_policies")
        .select("id, name")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .or(`location_id.is.null,location_id.eq.${locationId}`)
        .order("name"),
      supabase
        .from("tip_runs")
        .select(
          "id, closeout_id, policy_version_id, business_date, shift_label, status, distributable_cents, allocated_cents, calculation_version, calculated_at, approved_by, approved_at, locked_at, created_by",
        )
        .eq("organization_id", organizationId)
        .eq("location_id", locationId)
        .order("business_date", { ascending: false })
        .order("created_at", { ascending: false })
        .limit(60),
    ]);
    if (closeoutResult.error || policyResult.error || tipRunResult.error) return readFailure();

    const closeoutIds = (closeoutResult.data ?? []).map((row) => row.id);
    const policyIds = (policyResult.data ?? []).map((row) => row.id);
    const runIds = (tipRunResult.data ?? []).map((row) => row.id);
    const runPolicyVersionIds = [
      ...new Set((tipRunResult.data ?? []).map((row) => row.policy_version_id)),
    ];
    const emptyResult = Promise.resolve({ data: [], error: null });
    const [
      attachmentResult,
      versionResult,
      runVersionResult,
      sourceResult,
      participantResult,
      allocationResult,
    ] =
      await Promise.all([
        closeoutIds.length
          ? supabase
              .from("closeout_attachments")
              .select("id, closeout_id, storage_path, file_name, mime_type")
              .eq("organization_id", organizationId)
              .in("closeout_id", closeoutIds)
          : emptyResult,
        policyIds.length
          ? supabase
              .from("tip_pool_policy_versions")
              .select(
                "id, policy_id, version, distribution_method, effective_from, effective_to, approved_by",
              )
              .eq("organization_id", organizationId)
              .in("policy_id", policyIds)
              .not("approved_at", "is", null)
              .lte("effective_from", date)
              .or(`effective_to.is.null,effective_to.gte.${date}`)
              .order("version", { ascending: false })
          : emptyResult,
        runPolicyVersionIds.length
          ? supabase
              .from("tip_pool_policy_versions")
              .select(
                "id, policy_id, version, distribution_method, effective_from, effective_to, approved_by",
              )
              .eq("organization_id", organizationId)
              .in("id", runPolicyVersionIds)
          : emptyResult,
        runIds.length
          ? supabase
              .from("tip_sources")
              .select("id, tip_run_id, source_type, label, amount_cents, is_distributable")
              .eq("organization_id", organizationId)
              .in("tip_run_id", runIds)
          : emptyResult,
        runIds.length
          ? supabase
              .from("tip_run_participants")
              .select(
                "id, tip_run_id, employee_id, job_role_id, worked_minutes, points, eligible, exclusion_reason, source_time_entry_ids",
              )
              .eq("organization_id", organizationId)
              .in("tip_run_id", runIds)
          : emptyResult,
        runIds.length
          ? supabase
              .from("tip_allocations")
              .select(
                "id, tip_run_id, employee_id, base_amount_cents, adjustment_cents, final_amount_cents, weight, remainder_rank, explanation",
              )
              .eq("organization_id", organizationId)
              .in("tip_run_id", runIds)
          : emptyResult,
      ]);
    if (
      attachmentResult.error ||
      versionResult.error ||
      runVersionResult.error ||
      sourceResult.error ||
      participantResult.error ||
      allocationResult.error
    ) {
      return readFailure();
    }

    const versions = [
      ...new Map(
        [...(versionResult.data ?? []), ...(runVersionResult.data ?? [])].map((row) => [
          row.id,
          row,
        ]),
      ).values(),
    ];
    const versionIds = versions.map((row) => row.id);
    const participantRows = participantResult.data ?? [];
    const employeeIds = [
      ...new Set([
        ...participantRows.map((row) => row.employee_id),
        ...(allocationResult.data ?? []).map((row) => row.employee_id),
      ]),
    ];
    const roleIds = [...new Set(participantRows.map((row) => row.job_role_id))];
    const actorIds = [
      ...new Set([
        ...(closeoutResult.data ?? []).map((row) => row.submitted_by),
        ...(closeoutResult.data ?? [])
          .map((row) => row.approved_by)
          .filter((id): id is string => Boolean(id)),
        ...(tipRunResult.data ?? []).map((row) => row.created_by),
        ...(tipRunResult.data ?? [])
          .map((row) => row.approved_by)
          .filter((id): id is string => Boolean(id)),
      ]),
    ];
    const [ruleResult, employeeResult, roleResult, profileResult] = await Promise.all([
      versionIds.length
        ? supabase
            .from("tip_pool_eligibility_rules")
            .select("policy_version_id, job_role_id, eligible, points, minimum_minutes")
            .eq("organization_id", organizationId)
            .in("policy_version_id", versionIds)
        : emptyResult,
      employeeIds.length
        ? supabase
            .from("employees")
            .select("id, display_name")
            .eq("organization_id", organizationId)
            .in("id", employeeIds)
        : emptyResult,
      roleIds.length || versionIds.length
        ? supabase
            .from("job_roles")
            .select("id, name")
            .eq("organization_id", organizationId)
        : emptyResult,
      actorIds.length
        ? supabase.from("profiles").select("id, display_name, preferred_name").in("id", actorIds)
        : emptyResult,
    ]);
    if (ruleResult.error || employeeResult.error || roleResult.error || profileResult.error) {
      return readFailure();
    }

    const policyNames = new Map((policyResult.data ?? []).map((row) => [row.id, row.name]));
    const roleNames = new Map((roleResult.data ?? []).map((row) => [row.id, row.name]));
    const employeeNames = new Map(
      (employeeResult.data ?? []).map((row) => [row.id, row.display_name]),
    );
    const profileNames = new Map(
      (profileResult.data ?? []).map((row) => [
        row.id,
        row.preferred_name?.trim() || row.display_name,
      ]),
    );
    const versionById = new Map(versions.map((row) => [row.id, row]));

    return readSuccess({
      date,
      timeZone: location.timezone,
      currencyCode: organizationResult.data.currency_code,
      closeouts: (closeoutResult.data ?? []).map((row) => ({
        id: row.id,
        businessDate: row.business_date,
        shiftLabel: row.shift_label,
        status: row.status,
        grossSalesCents: Number(row.gross_sales_cents),
        netSalesCents: Number(row.net_sales_cents),
        cashSalesCents: Number(row.cash_sales_cents),
        cardSalesCents: Number(row.card_sales_cents),
        expectedCashCents: Number(row.expected_cash_cents),
        actualCashCents: row.actual_cash_cents == null ? null : Number(row.actual_cash_cents),
        covers: row.covers,
        compsCents: Number(row.comps_cents),
        voidsCents: Number(row.voids_cents),
        serviceChargesCents: Number(row.service_charges_cents),
        cardTipsCents: Number(row.card_tips_cents),
        cashTipsCents: Number(row.cash_tips_cents),
        notes: row.notes,
        submittedByUserId: row.submitted_by,
        submittedBy: profileNames.get(row.submitted_by) ?? "Management",
        submittedAt: row.submitted_at,
        approvedBy: row.approved_by
          ? profileNames.get(row.approved_by) ?? "Management"
          : null,
        approvedAt: row.approved_at,
        attachments: (attachmentResult.data ?? [])
          .filter((attachment) => attachment.closeout_id === row.id)
          .map((attachment) => ({
            id: attachment.id,
            storagePath: attachment.storage_path,
            fileName: attachment.file_name,
            mimeType: attachment.mime_type,
          })),
      })),
      policies: (versionResult.data ?? []).map((version) => {
        let method: "hours" | "weighted_points" | null = null;
        try {
          method = toDomainTipDistributionMethod(version.distribution_method);
        } catch {
          method = null;
        }
        return {
          id: version.id,
          policyId: version.policy_id,
          name: policyNames.get(version.policy_id) ?? "Tip policy",
          version: version.version,
          method,
          effectiveFrom: version.effective_from,
          effectiveTo: version.effective_to,
          approvedBy: profileNames.get(version.approved_by!) ?? "Approved manager",
          rules: (ruleResult.data ?? [])
            .filter((rule) => rule.policy_version_id === version.id)
            .map((rule) => ({
              jobRoleId: rule.job_role_id,
              jobRoleName: roleNames.get(rule.job_role_id) ?? "Assigned role",
              eligible: rule.eligible,
              points: Number(rule.points),
              minimumMinutes: rule.minimum_minutes,
            })),
        };
      }),
      tipRuns: (tipRunResult.data ?? []).map((run) => {
        const version = versionById.get(run.policy_version_id);
        let method: "hours" | "weighted_points" | null = null;
        if (version) {
          try {
            method = toDomainTipDistributionMethod(version.distribution_method);
          } catch {
            method = null;
          }
        }
        return {
          id: run.id,
          closeoutId: run.closeout_id,
          policyVersionId: run.policy_version_id,
          policyName: version
            ? policyNames.get(version.policy_id) ?? "Tip policy"
            : "Archived policy",
          policyVersion: version?.version ?? 0,
          method,
          businessDate: run.business_date,
          shiftLabel: run.shift_label,
          status: run.status,
          distributableCents: Number(run.distributable_cents),
          allocatedCents: Number(run.allocated_cents),
          calculationVersion: run.calculation_version,
          calculatedAt: run.calculated_at,
          approvedBy: run.approved_by
            ? profileNames.get(run.approved_by) ?? "Management"
            : null,
          approvedAt: run.approved_at,
          lockedAt: run.locked_at,
          createdByUserId: run.created_by,
          createdBy: profileNames.get(run.created_by) ?? "Management",
          sources: (sourceResult.data ?? [])
            .filter((source) => source.tip_run_id === run.id)
            .map((source) => ({
              id: source.id,
              sourceType: source.source_type,
              label: source.label,
              amountCents: Number(source.amount_cents),
              isDistributable: source.is_distributable,
            })),
          participants: participantRows
            .filter((participant) => participant.tip_run_id === run.id)
            .map((participant) => ({
              id: participant.id,
              employeeId: participant.employee_id,
              employeeName: employeeNames.get(participant.employee_id) ?? "Team member",
              jobRoleName: roleNames.get(participant.job_role_id) ?? "Assigned role",
              workedMinutes: participant.worked_minutes,
              points: Number(participant.points),
              eligible: participant.eligible,
              exclusionReason: participant.exclusion_reason,
              sourceTimeEntryIds: participant.source_time_entry_ids,
            })),
          allocations: (allocationResult.data ?? [])
            .filter((allocation) => allocation.tip_run_id === run.id)
            .map((allocation) => ({
              id: allocation.id,
              employeeId: allocation.employee_id,
              employeeName: employeeNames.get(allocation.employee_id) ?? "Team member",
              baseAmountCents: Number(allocation.base_amount_cents),
              adjustmentCents: Number(allocation.adjustment_cents),
              finalAmountCents: Number(allocation.final_amount_cents),
              weight: Number(allocation.weight),
              remainderRank: allocation.remainder_rank,
              explanation: objectJson(allocation.explanation),
            })),
        };
      }),
    });
  } catch {
    return readFailure();
  }
}
