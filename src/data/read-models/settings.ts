import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.generated";
import { readFailure, readSuccess, type LiveReadResult } from "./shared";

export interface LiveSettingsLocation {
  id: string;
  name: string;
  code: string;
  timeZone: string;
  phone: string | null;
  address: string[];
  active: boolean;
}

export interface LiveSettingsOwner {
  userId: string;
  displayName: string;
  status: string;
}

export interface LiveSettingsAuditEvent {
  id: string;
  action: string;
  tableName: string;
  recordId: string | null;
  actorName: string;
  occurredAt: string;
}

export interface LiveNotificationPreference {
  id: string;
  notificationType: string;
  inApp: boolean;
  email: boolean;
  push: boolean;
  quietHours: Json;
  updatedAt: string;
}

export interface LivePushSubscription {
  id: string;
  endpointHash: string;
  deviceLabel: string | null;
  lastUsedAt: string | null;
  createdAt: string;
}

export interface LiveExpenseCategory {
  id: string;
  name: string;
  accountingCode: string | null;
  active: boolean;
}

export interface LiveSettingsModel {
  organization: {
    id: string;
    name: string;
    slug: string;
    timeZone: string;
    currencyCode: string;
    status: string;
    configuredAt: string | null;
    weekStartsOn: number;
  };
  locations: LiveSettingsLocation[];
  owners: LiveSettingsOwner[];
  roleCounts: Record<"owner" | "admin" | "manager" | "employee", number>;
  membershipCounts: { active: number; invited: number; suspended: number };
  retentionPolicies: Array<{
    id: string;
    dataClass: string;
    retentionDays: number | null;
    legalHold: boolean;
    configuredAt: string | null;
    notes?: string | null;
  }>;
  latestBackup: {
    status: string;
    provider: string;
    backupType: string;
    completedAt: string | null;
    restoreTestedAt: string | null;
  } | null;
  unresolvedErrorCount: number;
  exportRequests: Array<{
    id: string;
    subjectType: string;
    status: string;
    requestedAt: string;
    completedAt: string | null;
  }>;
  auditEvents: LiveSettingsAuditEvent[];
  notificationPreferences: LiveNotificationPreference[];
  pushSubscriptions: LivePushSubscription[];
  expenseCategories: LiveExpenseCategory[];
  canManage: boolean;
}

function addressLines(value: Json): string[] {
  if (!value || Array.isArray(value) || typeof value !== "object") return [];
  const text = (key: string) => typeof value[key] === "string" ? value[key].trim() : "";
  const first = [text("line1"), text("line2")].filter(Boolean);
  const locality = [text("city"), text("region"), text("postalCode") || text("postal_code")]
    .filter(Boolean)
    .join(" ");
  return [...first, ...(locality ? [locality] : [])];
}

export async function loadLiveSettings(
  workspace: WorkspaceContextValue,
): Promise<LiveReadResult<LiveSettingsModel>> {
  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const [
      organizationResult,
      settingsResult,
      locationResult,
      membershipResult,
      retentionResult,
      backupResult,
      errorResult,
      exportResult,
      auditResult,
      notificationPreferenceResult,
      pushSubscriptionResult,
      expenseCategoryResult,
    ] = await Promise.all([
      supabase
        .from("organizations")
        .select("id, name, slug, timezone, currency_code, status")
        .eq("id", organizationId)
        .single(),
      supabase
        .from("organization_settings")
        .select("configured_at, week_starts_on")
        .eq("organization_id", organizationId)
        .maybeSingle(),
      supabase
        .from("locations")
        .select("id, name, code, timezone, phone, address, is_active")
        .eq("organization_id", organizationId)
        .order("name"),
      supabase
        .from("organization_memberships")
        .select("user_id, role, status")
        .eq("organization_id", organizationId),
      supabase
        .from("retention_policies")
        .select("id, data_class, retention_days, legal_hold, configured_at, notes")
        .eq("organization_id", organizationId)
        .order("data_class"),
      supabase
        .from("backup_runs")
        .select("status, provider, backup_type, completed_at, restore_tested_at")
        .eq("organization_id", organizationId)
        .order("started_at", { ascending: false })
        .limit(1)
        .maybeSingle(),
      supabase
        .from("application_errors")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("resolved_at", null),
      supabase
        .from("data_export_requests")
        .select("id, subject_type, status, created_at, completed_at")
        .eq("organization_id", organizationId)
        .order("created_at", { ascending: false })
        .limit(20),
      supabase
        .from("audit_events")
        .select("id, action, table_name, record_id, actor_id, occurred_at")
        .eq("organization_id", organizationId)
        .order("occurred_at", { ascending: false })
        .limit(50),
      supabase
        .from("notification_preferences")
        .select("id, notification_type, in_app, email, push, quiet_hours, updated_at")
        .eq("organization_id", organizationId)
        .eq("user_id", workspace.identity.userId)
        .order("notification_type"),
      supabase
        .from("push_subscriptions")
        .select("id, endpoint_hash, device_label, last_used_at, created_at")
        .eq("organization_id", organizationId)
        .eq("user_id", workspace.identity.userId)
        .order("created_at", { ascending: false }),
      supabase
        .from("expense_categories")
        .select("id, name, accounting_code, is_active")
        .eq("organization_id", organizationId)
        .order("name"),
    ]);
    if (
      organizationResult.error ||
      settingsResult.error ||
      locationResult.error ||
      membershipResult.error ||
      retentionResult.error ||
      backupResult.error ||
      errorResult.error ||
      exportResult.error ||
      auditResult.error ||
      notificationPreferenceResult.error ||
      pushSubscriptionResult.error ||
      expenseCategoryResult.error ||
      !organizationResult.data
    ) {
      return readFailure("Tenant settings could not be loaded safely. Try again.");
    }

    const memberships = membershipResult.data ?? [];
    const actorIds = [...new Set([
      ...memberships.filter((membership) => membership.role === "owner").map((membership) => membership.user_id),
      ...(auditResult.data ?? []).flatMap((event) => event.actor_id ? [event.actor_id] : []),
    ])];
    const profileResult = actorIds.length
      ? await supabase.from("profiles").select("id, display_name").in("id", actorIds)
      : { data: [], error: null };
    if (profileResult.error) return readFailure("Tenant settings could not be loaded safely. Try again.");
    const names = new Map((profileResult.data ?? []).map((profile) => [profile.id, profile.display_name]));
    const roleCounts = { owner: 0, admin: 0, manager: 0, employee: 0 };
    const membershipCounts = { active: 0, invited: 0, suspended: 0 };
    for (const membership of memberships) {
      roleCounts[membership.role] += 1;
      membershipCounts[membership.status] += 1;
    }

    return readSuccess({
      organization: {
        id: organizationResult.data.id,
        name: organizationResult.data.name,
        slug: organizationResult.data.slug,
        timeZone: organizationResult.data.timezone,
        currencyCode: organizationResult.data.currency_code,
        status: organizationResult.data.status,
        configuredAt: settingsResult.data?.configured_at ?? null,
        weekStartsOn: settingsResult.data?.week_starts_on ?? 1,
      },
      locations: (locationResult.data ?? []).map((location) => ({
        id: location.id,
        name: location.name,
        code: location.code,
        timeZone: location.timezone,
        phone: location.phone,
        address: addressLines(location.address),
        active: location.is_active,
      })),
      owners: memberships
        .filter((membership) => membership.role === "owner")
        .map((membership) => ({
          userId: membership.user_id,
          displayName: names.get(membership.user_id) ?? "Owner account",
          status: membership.status,
        })),
      roleCounts,
      membershipCounts,
      retentionPolicies: (retentionResult.data ?? []).map((policy) => ({
        id: policy.id,
        dataClass: policy.data_class,
        retentionDays: policy.retention_days,
        legalHold: policy.legal_hold,
        configuredAt: policy.configured_at,
        notes: policy.notes,
      })),
      latestBackup: backupResult.data ? {
        status: backupResult.data.status,
        provider: backupResult.data.provider,
        backupType: backupResult.data.backup_type,
        completedAt: backupResult.data.completed_at,
        restoreTestedAt: backupResult.data.restore_tested_at,
      } : null,
      unresolvedErrorCount: errorResult.count ?? 0,
      exportRequests: (exportResult.data ?? []).map((request) => ({
        id: request.id,
        subjectType: request.subject_type,
        status: request.status,
        requestedAt: request.created_at,
        completedAt: request.completed_at,
      })),
      auditEvents: (auditResult.data ?? []).map((event) => ({
        id: String(event.id),
        action: event.action,
        tableName: event.table_name,
        recordId: event.record_id,
        actorName: event.actor_id ? names.get(event.actor_id) ?? "Authorized user" : "System",
        occurredAt: event.occurred_at,
      })),
      notificationPreferences: (notificationPreferenceResult.data ?? []).map((preference) => ({
        id: preference.id,
        notificationType: preference.notification_type,
        inApp: preference.in_app,
        email: preference.email,
        push: preference.push,
        quietHours: preference.quiet_hours,
        updatedAt: preference.updated_at,
      })),
      pushSubscriptions: (pushSubscriptionResult.data ?? []).map((subscription) => ({
        id: subscription.id,
        endpointHash: subscription.endpoint_hash,
        deviceLabel: subscription.device_label,
        lastUsedAt: subscription.last_used_at,
        createdAt: subscription.created_at,
      })),
      expenseCategories: (expenseCategoryResult.data ?? []).map((category) => ({
        id: category.id,
        name: category.name,
        accountingCode: category.accounting_code,
        active: category.is_active,
      })),
      canManage: workspace.role === "owner" || workspace.role === "admin",
    });
  } catch {
    return readFailure("Tenant settings could not be loaded safely. Try again.");
  }
}
