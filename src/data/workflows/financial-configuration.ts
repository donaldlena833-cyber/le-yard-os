import "server-only";

import { assertCondition, assertFound, throwDatabaseError } from "../errors";
import {
  requireLocationManagement,
  requireOrganizationOperations,
} from "../policy";
import type { WorkflowContext } from "../execute";
import type {
  ApproveTipPolicyVersionInput,
  ConfigureRetentionPolicyInput,
  ConfigureTipPolicyInput,
  SaveTipPolicyDraftInput,
} from "../financial-configuration-schemas";

function requireOwnerOrAdmin(
  context: WorkflowContext,
  organizationId: string,
) {
  const membership = requireOrganizationOperations(context.actor, organizationId);
  assertCondition(
    membership.role === "owner" || membership.role === "admin",
    "forbidden",
    "Only Owners or Admins may configure financial policies.",
  );
  return membership;
}

export async function configureTipPolicy(
  context: WorkflowContext,
  input: ConfigureTipPolicyInput,
) {
  requireOwnerOrAdmin(context, input.organizationId);
  if (input.locationId) {
    requireLocationManagement(
      context.actor,
      input.organizationId,
      input.locationId,
    );
  }
  const { data, error } = await context.supabase.rpc(
    "configure_tip_pool_policy",
    {
      p_request_id: input.requestId,
      p_policy_id: input.policyId,
      p_organization_id: input.organizationId,
      p_location_id: input.locationId,
      p_name: input.name,
      p_description: input.description ?? null,
      p_is_active: input.isActive,
    },
  );
  if (error) throwDatabaseError(error, "The tip policy could not be saved.");
  const policy = assertFound(data, "The saved tip policy was not returned.");
  return {
    id: String(policy.id),
    name: String(policy.name),
    isActive: Boolean(policy.is_active),
  };
}

export async function saveTipPolicyDraft(
  context: WorkflowContext,
  input: SaveTipPolicyDraftInput,
) {
  const { data: policy, error: policyError } = await context.supabase
    .from("tip_pool_policies")
    .select("id, organization_id, location_id, is_active")
    .eq("id", input.policyId)
    .maybeSingle();
  if (policyError) throwDatabaseError(policyError, "The tip policy could not be verified.");
  const policyRow = assertFound(policy, "The tip policy was not found.");
  requireOwnerOrAdmin(context, policyRow.organization_id);
  assertCondition(policyRow.is_active, "conflict", "Reactivate this policy first.");

  const { data, error } = await context.supabase.rpc(
    "save_tip_pool_policy_draft",
    {
      p_request_id: input.requestId,
      p_policy_id: input.policyId,
      p_policy_version_id: input.policyVersionId,
      p_distribution_method: input.distributionMethod,
      p_effective_from: input.effectiveFrom,
      p_effective_to: input.effectiveTo,
      p_closeout_sources: input.closeoutSources,
      p_eligibility_rules: input.eligibilityRules.map((rule) => ({
        job_role_id: rule.jobRoleId,
        eligible: rule.eligible,
        points: rule.points,
        minimum_minutes: rule.minimumMinutes,
      })),
    },
  );
  if (error) throwDatabaseError(error, "The tip policy draft could not be saved.");
  const version = assertFound(data, "The saved tip policy draft was not returned.");
  return {
    id: String(version.id),
    policyId: String(version.policy_id),
    version: Number(version.version),
    approvedAt:
      version.approved_at == null ? null : String(version.approved_at),
  };
}

export async function approveTipPolicyVersion(
  context: WorkflowContext,
  input: ApproveTipPolicyVersionInput,
) {
  const { data: version, error: versionError } = await context.supabase
    .from("tip_pool_policy_versions")
    .select("id, organization_id, policy_id, created_by, approved_at")
    .eq("id", input.policyVersionId)
    .maybeSingle();
  if (versionError) {
    throwDatabaseError(versionError, "The tip policy draft could not be verified.");
  }
  const versionRow = assertFound(version, "The tip policy draft was not found.");
  const { data: policy, error: policyError } = await context.supabase
    .from("tip_pool_policies")
    .select("id, organization_id, location_id, is_active")
    .eq("id", versionRow.policy_id)
    .maybeSingle();
  if (policyError) throwDatabaseError(policyError, "The tip policy could not be verified.");
  const policyRow = assertFound(policy, "The tip policy was not found.");
  requireOwnerOrAdmin(context, policyRow.organization_id);
  assertCondition(policyRow.is_active, "conflict", "Reactivate this policy first.");
  assertCondition(
    versionRow.created_by !== context.actor.userId,
    "forbidden",
    "A different authorized person must approve this policy version.",
  );

  const { data, error } = await context.supabase.rpc(
    "approve_tip_policy_version",
    {
      p_request_id: input.requestId,
      p_policy_version_id: input.policyVersionId,
    },
  );
  if (error) throwDatabaseError(error, "The tip policy approval could not be recorded.");
  const approved = assertFound(data, "The approved tip policy version was not returned.");
  return {
    id: approved.id,
    approvedAt: approved.approved_at,
    alreadyApplied: versionRow.approved_at !== null,
  };
}

export async function configureRetentionPolicy(
  context: WorkflowContext,
  input: ConfigureRetentionPolicyInput,
) {
  requireOwnerOrAdmin(context, input.organizationId);
  const { data, error } = await context.supabase.rpc(
    "configure_retention_policy",
    {
      p_request_id: input.requestId,
      p_policy_id: input.policyId,
      p_organization_id: input.organizationId,
      p_data_class: input.dataClass,
      p_retention_days: input.retentionDays,
      p_legal_hold: input.legalHold,
      p_notes: input.notes ?? null,
    },
  );
  if (error) throwDatabaseError(error, "The retention decision could not be saved.");
  const policy = assertFound(data, "The saved retention decision was not returned.");
  return {
    id: String(policy.id),
    dataClass: String(policy.data_class),
    retentionDays:
      policy.retention_days == null ? null : Number(policy.retention_days),
    legalHold: Boolean(policy.legal_hold),
  };
}
