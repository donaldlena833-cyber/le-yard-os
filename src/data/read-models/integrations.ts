import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { sanitizeIntegrationError } from "@/lib/integrations/adapters";
import { createClient } from "@/lib/supabase/server";
import { readFailure, readSuccess, type LiveReadResult } from "./shared";

export interface LiveIntegrationConnection {
  id: string;
  provider: string;
  displayName: string;
  adapterVersion: string;
  status: string;
  capabilities: string[];
  locationId: string | null;
  scopeLabel: string;
  lastSyncedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LiveIntegrationSyncJob {
  id: string;
  connectionId: string;
  provider: string;
  connectionName: string;
  direction: string;
  resourceType: string;
  status: string;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string | null;
  recordsProcessed: number;
  recordOutcomes: Record<string, number>;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
  canRetry: boolean;
}

export interface LiveIntegrationImportJob {
  id: string;
  locationId: string | null;
  importType: string;
  fileName: string;
  status: string;
  totalRows: number | null;
  successfulRows: number;
  failedRows: number;
  requestedByUserId: string;
  requestedBy: string;
  completedAt: string | null;
  createdAt: string;
}

export interface LiveIntegrationEvent {
  id: number;
  connectionId: string | null;
  connectionName: string | null;
  eventType: string;
  severity: string;
  message: string;
  occurredAt: string;
}

export interface LiveIntegrationAuditEvent {
  id: number;
  actorId: string | null;
  actorName: string;
  actorRole: string | null;
  action: string;
  tableName: string;
  recordId: string | null;
  requestId: string | null;
  occurredAt: string;
}

export interface LiveIntegrationsModel {
  organizationName: string;
  locationId: string;
  locationName: string;
  role: string;
  canManageSettings: boolean;
  ownerNeedsMfa: boolean;
  connections: LiveIntegrationConnection[];
  syncJobs: LiveIntegrationSyncJob[];
  importJobs: LiveIntegrationImportJob[];
  events: LiveIntegrationEvent[];
  auditEvents: LiveIntegrationAuditEvent[];
  syncRecordEvidenceLimited: boolean;
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").slice(0, 100);
}

function profileName(row: { display_name: string; preferred_name: string | null }): string {
  return row.preferred_name?.trim() || row.display_name;
}

const integrationAuditTables = [
  "integration_connections",
  "integration_sync_jobs",
  "integration_sync_records",
  "import_jobs",
  "import_rows",
  "integration_events",
] as const;

export async function loadLiveIntegrations(
  workspace: WorkspaceContextValue,
): Promise<LiveReadResult<LiveIntegrationsModel>> {
  if (workspace.role === "employee") {
    return readFailure("Management access is required to view integration status.");
  }

  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const locationId = workspace.activeLocation.id;

    const [connectionResult, importResult, auditResult] = await Promise.all([
      supabase
        .from("integration_connections")
        .select(
          "id, location_id, provider, display_name, adapter_version, status, capabilities, last_synced_at, created_at, updated_at",
        )
        .eq("organization_id", organizationId)
        .or(`location_id.is.null,location_id.eq.${locationId}`)
        .order("provider")
        .order("location_id", { ascending: false, nullsFirst: false }),
      supabase
        .from("import_jobs")
        .select(
          "id, location_id, import_type, file_name, status, total_rows, successful_rows, failed_rows, requested_by, completed_at, created_at",
        )
        .eq("organization_id", organizationId)
        .eq("location_id", locationId)
        .order("created_at", { ascending: false })
        .limit(100),
      supabase
        .from("audit_events")
        .select(
          "id, occurred_at, actor_id, actor_role, action, table_name, record_id, request_id",
        )
        .eq("organization_id", organizationId)
        .in("table_name", [...integrationAuditTables])
        .order("occurred_at", { ascending: false })
        .limit(100),
    ]);

    if (connectionResult.error || importResult.error || auditResult.error) return readFailure();

    const connections = connectionResult.data ?? [];
    const connectionIds = connections.map((connection) => connection.id);
    const connectionById = new Map(connections.map((connection) => [connection.id, connection]));
    const emptyResult = Promise.resolve({ data: [], error: null });

    let eventQuery = supabase
      .from("integration_events")
      .select("id, connection_id, event_type, severity, message, occurred_at")
      .eq("organization_id", organizationId);
    eventQuery = connectionIds.length
      ? eventQuery.or(`connection_id.is.null,connection_id.in.(${connectionIds.join(",")})`)
      : eventQuery.is("connection_id", null);

    const [syncResult, eventResult] = await Promise.all([
      connectionIds.length
        ? supabase
            .from("integration_sync_jobs")
            .select(
              "id, connection_id, direction, resource_type, status, attempts, max_attempts, next_attempt_at, records_processed, error_message, started_at, completed_at, created_at, updated_at",
            )
            .eq("organization_id", organizationId)
            .in("connection_id", connectionIds)
            .order("created_at", { ascending: false })
            .limit(100)
        : emptyResult,
      eventQuery.order("occurred_at", { ascending: false }).limit(100),
    ]);
    if (syncResult.error || eventResult.error) return readFailure();

    const syncRows = syncResult.data ?? [];
    const syncIds = syncRows.map((job) => job.id);
    const actorIds = [
      ...(importResult.data ?? []).map((job) => job.requested_by),
      ...(auditResult.data ?? []).flatMap((event) => (event.actor_id ? [event.actor_id] : [])),
    ];
    const uniqueActorIds = [...new Set(actorIds)];

    const [recordResult, profileResult] = await Promise.all([
      syncIds.length
        ? supabase
            .from("integration_sync_records")
            .select("sync_job_id, status")
            .eq("organization_id", organizationId)
            .in("sync_job_id", syncIds)
            .limit(10_000)
        : emptyResult,
      uniqueActorIds.length
        ? supabase
            .from("profiles")
            .select("id, display_name, preferred_name")
            .in("id", uniqueActorIds)
        : emptyResult,
    ]);
    if (recordResult.error) return readFailure();

    const profiles = new Map(
      (profileResult.data ?? []).map((profile) => [profile.id, profileName(profile)]),
    );
    const outcomes = new Map<string, Record<string, number>>();
    for (const record of recordResult.data ?? []) {
      const current = outcomes.get(record.sync_job_id) ?? {};
      current[record.status] = (current[record.status] ?? 0) + 1;
      outcomes.set(record.sync_job_id, current);
    }

    return readSuccess({
      organizationName: workspace.organization.name,
      locationId,
      locationName: workspace.activeLocation.name,
      role: workspace.role,
      canManageSettings: workspace.role === "owner" || workspace.role === "admin",
      ownerNeedsMfa: workspace.role === "owner" && workspace.identity.aal !== "aal2",
      connections: connections.map((connection) => ({
        id: connection.id,
        provider: connection.provider,
        displayName: connection.display_name,
        adapterVersion: connection.adapter_version,
        status: connection.status,
        capabilities: stringArray(connection.capabilities),
        locationId: connection.location_id,
        scopeLabel: connection.location_id ? workspace.activeLocation.name : workspace.organization.name,
        lastSyncedAt: connection.last_synced_at,
        createdAt: connection.created_at,
        updatedAt: connection.updated_at,
      })),
      syncJobs: syncRows.map((job) => {
        const connection = connectionById.get(job.connection_id);
        return {
          id: job.id,
          connectionId: job.connection_id,
          provider: connection?.provider ?? "unknown",
          connectionName: connection?.display_name ?? "Unavailable connection",
          direction: job.direction,
          resourceType: job.resource_type,
          status: job.status,
          attempts: job.attempts,
          maxAttempts: job.max_attempts,
          nextAttemptAt: job.next_attempt_at,
          recordsProcessed: job.records_processed,
          recordOutcomes: outcomes.get(job.id) ?? {},
          errorMessage: job.error_message
            ? sanitizeIntegrationError(job.error_message)
            : null,
          startedAt: job.started_at,
          completedAt: job.completed_at,
          createdAt: job.created_at,
          updatedAt: job.updated_at,
          canRetry: job.status === "failed" && job.attempts < job.max_attempts,
        };
      }),
      importJobs: (importResult.data ?? []).map((job) => ({
        id: job.id,
        locationId: job.location_id,
        importType: job.import_type,
        fileName: job.file_name,
        status: job.status,
        totalRows: job.total_rows,
        successfulRows: job.successful_rows,
        failedRows: job.failed_rows,
        requestedByUserId: job.requested_by,
        requestedBy: profiles.get(job.requested_by) ?? "Authorized team member",
        completedAt: job.completed_at,
        createdAt: job.created_at,
      })),
      events: (eventResult.data ?? []).map((event) => ({
        id: event.id,
        connectionId: event.connection_id,
        connectionName: event.connection_id
          ? connectionById.get(event.connection_id)?.display_name ?? "Unavailable connection"
          : null,
        eventType: event.event_type,
        severity: event.severity,
        message: sanitizeIntegrationError(event.message),
        occurredAt: event.occurred_at,
      })),
      auditEvents: (auditResult.data ?? []).map((event) => ({
        id: event.id,
        actorId: event.actor_id,
        actorName: event.actor_id
          ? profiles.get(event.actor_id) ?? "Authorized team member"
          : "Server process",
        actorRole: event.actor_role,
        action: event.action,
        tableName: event.table_name,
        recordId: event.record_id,
        requestId: event.request_id,
        occurredAt: event.occurred_at,
      })),
      syncRecordEvidenceLimited: (recordResult.data?.length ?? 0) === 10_000,
    });
  } catch {
    return readFailure();
  }
}
