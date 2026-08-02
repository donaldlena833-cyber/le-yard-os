import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.generated";
import { readFailure, readSuccess, type LiveReadResult } from "./shared";

export interface TipPolicyConfigurationRole {
  id: string;
  name: string;
  code: string;
  defaultTipPoints: number;
  isTipped: boolean;
}

export interface TipPolicyConfigurationRule {
  jobRoleId: string;
  jobRoleName: string;
  eligible: boolean;
  points: number;
  minimumMinutes: number;
}

export interface TipPolicyConfigurationVersion {
  id: string;
  version: number;
  distributionMethod: "hours" | "weighted_hours" | "points";
  effectiveFrom: string;
  effectiveTo: string | null;
  closeoutSources: string[];
  createdByUserId: string;
  createdBy: string;
  createdAt: string;
  approvedBy: string | null;
  approvedAt: string | null;
  rules: TipPolicyConfigurationRule[];
}

export interface TipPolicyConfigurationPolicy {
  id: string;
  locationId: string | null;
  locationName: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdByUserId: string;
  versions: TipPolicyConfigurationVersion[];
}

export interface TipPolicyConfigurationModel {
  canAuthor: boolean;
  roles: TipPolicyConfigurationRole[];
  policies: TipPolicyConfigurationPolicy[];
}

function closeoutSources(value: Json): string[] {
  if (!value || typeof value !== "object" || Array.isArray(value)) return [];
  const sources = (value as Record<string, unknown>).closeout_sources;
  return Array.isArray(sources)
    ? sources.filter((source): source is string => typeof source === "string")
    : [];
}

export async function loadTipPolicyConfiguration(
  workspace: WorkspaceContextValue,
): Promise<LiveReadResult<TipPolicyConfigurationModel>> {
  if (workspace.role === "employee") return readFailure("Management access is required.");
  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const locationId = workspace.activeLocation.id;
    const [policyResult, roleResult] = await Promise.all([
      supabase
        .from("tip_pool_policies")
        .select(
          "id, location_id, name, description, is_active, created_by, created_at",
        )
        .eq("organization_id", organizationId)
        .or(`location_id.is.null,location_id.eq.${locationId}`)
        .order("is_active", { ascending: false })
        .order("name"),
      supabase
        .from("job_roles")
        .select("id, name, code, default_tip_points, is_tipped")
        .eq("organization_id", organizationId)
        .eq("is_active", true)
        .order("name"),
    ]);
    if (policyResult.error || roleResult.error) return readFailure();

    const policies = policyResult.data ?? [];
    const policyIds = policies.map((policy) => policy.id);
    const emptyResult = Promise.resolve({ data: [], error: null });
    const versionResult = policyIds.length
      ? await supabase
          .from("tip_pool_policy_versions")
          .select(
            "id, policy_id, version, distribution_method, effective_from, effective_to, source_rules, created_by, created_at, approved_by, approved_at",
          )
          .eq("organization_id", organizationId)
          .in("policy_id", policyIds)
          .order("version", { ascending: false })
      : await emptyResult;
    if (versionResult.error) return readFailure();

    const versions = versionResult.data ?? [];
    const versionIds = versions.map((version) => version.id);
    const actorIds = [
      ...new Set(
        [
          ...policies.map((policy) => policy.created_by),
          ...versions.map((version) => version.created_by),
          ...versions
            .map((version) => version.approved_by)
            .filter((id): id is string => Boolean(id)),
        ],
      ),
    ];
    const [ruleResult, profileResult] = await Promise.all([
      versionIds.length
        ? supabase
            .from("tip_pool_eligibility_rules")
            .select(
              "policy_version_id, job_role_id, eligible, points, minimum_minutes",
            )
            .eq("organization_id", organizationId)
            .in("policy_version_id", versionIds)
        : emptyResult,
      actorIds.length
        ? supabase
            .from("profiles")
            .select("id, display_name, preferred_name")
            .in("id", actorIds)
        : emptyResult,
    ]);
    if (ruleResult.error || profileResult.error) return readFailure();

    const roleNames = new Map(
      (roleResult.data ?? []).map((role) => [role.id, role.name]),
    );
    const profileNames = new Map(
      (profileResult.data ?? []).map((profile) => [
        profile.id,
        profile.preferred_name?.trim() || profile.display_name,
      ]),
    );
    const locationNames = new Map(
      workspace.locations.map((location) => [location.id, location.name]),
    );

    return readSuccess({
      canAuthor:
        (workspace.role === "admin" || workspace.role === "owner") &&
        (workspace.role !== "owner" || workspace.identity.aal === "aal2"),
      roles: (roleResult.data ?? []).map((role) => ({
        id: role.id,
        name: role.name,
        code: role.code,
        defaultTipPoints: Number(role.default_tip_points),
        isTipped: role.is_tipped,
      })),
      policies: policies.map((policy) => ({
        id: policy.id,
        locationId: policy.location_id,
        locationName: policy.location_id
          ? locationNames.get(policy.location_id) ?? "Assigned location"
          : "All locations",
        name: policy.name,
        description: policy.description,
        isActive: policy.is_active,
        createdByUserId: policy.created_by,
        versions: versions
          .filter((version) => version.policy_id === policy.id)
          .map((version) => ({
            id: version.id,
            version: version.version,
            distributionMethod: version.distribution_method,
            effectiveFrom: version.effective_from,
            effectiveTo: version.effective_to,
            closeoutSources: closeoutSources(version.source_rules),
            createdByUserId: version.created_by,
            createdBy:
              profileNames.get(version.created_by) ?? "Authorized operator",
            createdAt: version.created_at,
            approvedBy: version.approved_by
              ? profileNames.get(version.approved_by) ?? "Authorized operator"
              : null,
            approvedAt: version.approved_at,
            rules: (ruleResult.data ?? [])
              .filter((rule) => rule.policy_version_id === version.id)
              .map((rule) => ({
                jobRoleId: rule.job_role_id,
                jobRoleName:
                  roleNames.get(rule.job_role_id) ?? "Archived job role",
                eligible: rule.eligible,
                points: Number(rule.points),
                minimumMinutes: rule.minimum_minutes,
              })),
          })),
      })),
    });
  } catch {
    return readFailure();
  }
}
