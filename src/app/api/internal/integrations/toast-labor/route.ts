import { timingSafeEqual } from "node:crypto";
import { sanitizeIntegrationError } from "@/lib/integrations/adapters";
import {
  requireToastLaborConfiguration,
  ToastLaborClient,
  toastTimeEntryPayloadHash,
  type ToastEmployee,
  type ToastJob,
} from "@/lib/integrations/toast-labor.server";
import { createAdminClient } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type AdminClient = ReturnType<typeof createAdminClient>;

function authorized(request: Request) {
  const expected = process.env.TOAST_LABOR_SYNC_SECRET?.trim();
  const provided = request.headers
    .get("authorization")
    ?.match(/^Bearer\s+(.+)$/i)?.[1]
    ?.trim();
  if (!expected || !provided || expected.length < 32) return false;
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  return (
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}

function normalized(value: string | null | undefined) {
  return value?.trim().toLocaleLowerCase("en-US") ?? "";
}

function identifiers(reference: {
  guid: string;
  externalId?: string | null;
}) {
  return new Set(
    [reference.guid, reference.externalId]
      .map(normalized)
      .filter(Boolean),
  );
}

function exactlyOne<T>(values: T[]) {
  return values.length === 1 ? values[0] : null;
}

function mapEmployee(
  reference: { guid: string; externalId?: string | null },
  toastEmployees: ToastEmployee[],
  localEmployees: Array<{
    id: string;
    employee_number: string | null;
    payroll_reference: string | null;
    email: string | null;
  }>,
) {
  const toastEmployee = toastEmployees.find((employee) => {
    const candidateIds = identifiers(employee);
    if (employee.externalEmployeeId) {
      candidateIds.add(normalized(employee.externalEmployeeId));
    }
    return [...identifiers(reference)].some((id) => candidateIds.has(id));
  });
  if (!toastEmployee || toastEmployee.deleted) return null;
  const candidateIds = identifiers(toastEmployee);
  if (toastEmployee.externalEmployeeId) {
    candidateIds.add(normalized(toastEmployee.externalEmployeeId));
  }
  const explicit = exactlyOne(
    localEmployees.filter(
      (employee) =>
        candidateIds.has(normalized(employee.employee_number)) ||
        candidateIds.has(normalized(employee.payroll_reference)),
    ),
  );
  if (explicit) return explicit.id;
  const email = normalized(toastEmployee.email);
  return email
    ? exactlyOne(localEmployees.filter((employee) => normalized(employee.email) === email))?.id ??
        null
    : null;
}

function mapJob(
  reference: { guid: string; externalId?: string | null },
  toastJobs: ToastJob[],
  localJobs: Array<{ id: string; code: string; name: string }>,
) {
  const toastJob = toastJobs.find((job) =>
    [...identifiers(reference)].some((id) => identifiers(job).has(id)),
  );
  if (!toastJob || toastJob.deleted) return null;
  const candidateIds = identifiers(toastJob);
  const explicit = exactlyOne(
    localJobs.filter((job) => candidateIds.has(normalized(job.code))),
  );
  if (explicit) return explicit.id;
  return (
    exactlyOne(
      localJobs.filter((job) => normalized(job.name) === normalized(toastJob.title)),
    )?.id ?? null
  );
}

async function configuredScope(admin: AdminClient) {
  const locationId = process.env.TOAST_LOCATION_ID?.trim();
  if (!locationId) throw new Error("Toast location mapping is unavailable.");
  const locationResult = await admin
    .from("locations")
    .select("id, organization_id, name")
    .eq("id", locationId)
    .eq("is_active", true)
    .single();
  if (locationResult.error || !locationResult.data) {
    throw new Error("Toast location mapping is unavailable.");
  }
  return locationResult.data;
}

async function ownerForOrganization(admin: AdminClient, organizationId: string) {
  const ownerResult = await admin
    .from("organization_memberships")
    .select("user_id")
    .eq("organization_id", organizationId)
    .eq("status", "active")
    .in("role", ["owner", "admin"])
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (ownerResult.error || !ownerResult.data) {
    throw new Error("A connection owner is unavailable.");
  }
  return ownerResult.data.user_id;
}

async function toastConnection(
  admin: AdminClient,
  scope: { id: string; organization_id: string; name: string },
  ownerId: string,
) {
  const existing = await admin
    .from("integration_connections")
    .select("id, status, last_synced_at")
    .eq("organization_id", scope.organization_id)
    .eq("location_id", scope.id)
    .eq("provider", "toast")
    .maybeSingle();
  if (existing.error) throw new Error("Toast connection could not be loaded.");
  if (existing.data) {
    if (existing.data.status === "disabled") {
      throw new Error("Toast connection is disabled.");
    }
    return existing.data;
  }

  const created = await admin
    .from("integration_connections")
    .insert({
      organization_id: scope.organization_id,
      location_id: scope.id,
      provider: "toast",
      display_name: `Toast Labor · ${scope.name}`,
      adapter_version: "toast-labor-v1",
      status: "pending",
      capabilities: ["labor"],
      configuration: { authority: "toast_pos", direction: "read" },
      created_by: ownerId,
    })
    .select("id, status, last_synced_at")
    .single();
  if (created.error || !created.data) {
    throw new Error("Toast connection could not be created.");
  }
  return created.data;
}

async function finishJob(
  admin: AdminClient,
  jobId: string,
  values: {
    status: "succeeded" | "partially_succeeded" | "failed";
    cursor: string | null;
    recordsProcessed: number;
    errorMessage: string | null;
  },
) {
  await admin
    .from("integration_sync_jobs")
    .update({
      status: values.status,
      cursor: values.cursor,
      records_processed: values.recordsProcessed,
      error_message: values.errorMessage,
      completed_at: new Date().toISOString(),
      lease_expires_at: null,
    })
    .eq("id", jobId)
    .eq("status", "running");
}

async function synchronize(request: Request) {
  if (!authorized(request)) {
    return Response.json(
      { error: "Unauthorized" },
      { status: 401, headers: { "cache-control": "no-store" } },
    );
  }

  const configuration = requireToastLaborConfiguration();
  const admin = createAdminClient();
  const scope = await configuredScope(admin);
  const ownerId = await ownerForOrganization(admin, scope.organization_id);
  const connection = await toastConnection(admin, scope, ownerId);

  const claimResult = await admin.rpc("service_claim_integration_sync_job", {
    p_organization_id: scope.organization_id,
    p_connection_id: connection.id,
    p_resource_type: "time_entries",
    p_requested_by: ownerId,
    p_direction: "import",
    p_cursor: connection.last_synced_at,
    p_lease_seconds: 900,
  });
  if (claimResult.error) throw new Error("Toast sync state could not be claimed.");
  const claimedJob = Array.isArray(claimResult.data)
    ? claimResult.data[0]
    : claimResult.data;
  if (!claimedJob) {
    return Response.json(
      { error: "A Toast labor sync is already active." },
      { status: 409, headers: { "cache-control": "no-store" } },
    );
  }

  const startedAt = new Date(claimedJob.started_at ?? new Date().toISOString());
  const jobId = claimedJob.id;

  try {
    const fallbackStart = startedAt.getTime() - 7 * 86_400_000;
    const effectiveCursor = claimedJob.cursor ?? connection.last_synced_at;
    const previousCursor = effectiveCursor
      ? new Date(effectiveCursor).getTime() - 5 * 60_000
      : fallbackStart;
    const minimumStart = startedAt.getTime() - 29 * 86_400_000;
    const windowStart = new Date(Math.max(minimumStart, previousCursor));
    const client = new ToastLaborClient(configuration);
    const toast = await client.readModifiedTimeEntries(windowStart, startedAt);

    const [employeeResult, jobRoleResult] = await Promise.all([
      admin
        .from("employees")
        .select("id, employee_number, payroll_reference, email")
        .eq("organization_id", scope.organization_id)
        .eq("employment_status", "active"),
      admin
        .from("job_roles")
        .select("id, code, name")
        .eq("organization_id", scope.organization_id)
        .eq("is_active", true),
    ]);
    if (employeeResult.error || jobRoleResult.error) {
      throw new Error("Local labor mappings could not be loaded.");
    }

    let failed = 0;
    let processed = 0;
    for (const entry of toast.timeEntries) {
      const payloadHash = toastTimeEntryPayloadHash(entry);
      const employeeId = mapEmployee(
        entry.employeeReference,
        toast.employees,
        employeeResult.data ?? [],
      );
      const jobRoleId = mapJob(
        entry.jobReference,
        toast.jobs,
        jobRoleResult.data ?? [],
      );
      let status: "created" | "updated" | "unchanged" | "failed" = "failed";
      let localId: string | null = null;
      let errorMessage: string | null = null;

      if (!employeeId || !jobRoleId) {
        errorMessage = !employeeId
          ? "Toast employee is not mapped to one active local employee."
          : "Toast job is not mapped to one active local job role.";
      } else {
        const ingested = await admin.rpc("service_ingest_pos_time_entry", {
          p_organization_id: scope.organization_id,
          p_location_id: scope.id,
          p_connection_id: connection.id,
          p_external_id: entry.guid,
          p_external_modified_at: entry.modifiedDate,
          p_payload_hash: payloadHash,
          p_employee_id: employeeId,
          p_job_role_id: jobRoleId,
          p_scheduled_shift_id: null,
          p_clocked_in_at: entry.inDate,
          p_clocked_out_at: entry.outDate ?? null,
          p_auto_clocked_out: entry.autoClockedOut ?? false,
          p_source_deleted_at: entry.deleted ? entry.deletedDate ?? entry.modifiedDate : null,
          p_breaks: (entry.breaks ?? [])
            .filter((breakRow) => !breakRow.missed)
            .map((breakRow) => ({
              externalId: breakRow.guid,
              startedAt: breakRow.inDate,
              endedAt: breakRow.outDate ?? null,
              isPaid: breakRow.paid ?? false,
            })),
        });
        if (ingested.error) {
          errorMessage = sanitizeIntegrationError(ingested.error.message);
        } else {
          const result = ingested.data as { status?: string; id?: string | null } | null;
          status =
            result?.status === "created" || result?.status === "updated"
              ? result.status
              : "unchanged";
          localId = result?.id ?? null;
        }
      }

      if (errorMessage) failed += 1;
      processed += 1;
      const recordResult = await admin.from("integration_sync_records").insert({
        organization_id: scope.organization_id,
        sync_job_id: jobId,
        resource_type: "time_entry",
        external_id: entry.guid,
        local_table: localId ? "time_entries" : null,
        local_id: localId,
        status,
        payload_hash: payloadHash,
        error_message: errorMessage,
      });
      if (recordResult.error) throw new Error("Toast sync evidence could not be recorded.");
    }

    const terminalStatus = failed ? "partially_succeeded" : "succeeded";
    await finishJob(admin, jobId, {
      status: terminalStatus,
      cursor: startedAt.toISOString(),
      recordsProcessed: processed,
      errorMessage: failed ? `${failed} Toast record mapping or import failures.` : null,
    });
    await admin
      .from("integration_connections")
      .update({
        status: failed ? "degraded" : "connected",
        last_synced_at: startedAt.toISOString(),
      })
      .eq("id", connection.id);

    return Response.json(
      { ok: true, status: terminalStatus, recordsProcessed: processed, failed },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    const safeError = sanitizeIntegrationError(
      error instanceof Error ? error.message : "Toast labor sync failed.",
    );
    await finishJob(admin, jobId, {
      status: "failed",
      cursor: null,
      recordsProcessed: 0,
      errorMessage: safeError,
    });
    await admin
      .from("integration_connections")
      .update({ status: "degraded" })
      .eq("id", connection.id)
      .neq("status", "disabled");
    return Response.json(
      { error: "Toast labor sync failed." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}

export async function POST(request: Request) {
  try {
    return await synchronize(request);
  } catch {
    return Response.json(
      { error: "Toast labor sync is not configured." },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
