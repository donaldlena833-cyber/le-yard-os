import "server-only";

import {
  assertCondition,
  assertFound,
  throwDatabaseError,
  WorkflowError,
} from "../errors";
import {
  canRequestOrganizationWideReport,
  requireOrganizationOperations,
} from "../policy";
import { requireManagedLocation } from "../resources";
import type { WorkflowContext } from "../execute";
import type { RequestReportExportInput } from "../schemas";
import type { Json } from "@/types/database.generated";

export async function requestReportExport(
  context: WorkflowContext,
  input: RequestReportExportInput,
) {
  const membership = requireOrganizationOperations(
    context.actor,
    input.organizationId,
  );

  if (input.locationId) {
    const location = await requireManagedLocation(
      context.supabase,
      context.actor,
      input.locationId,
    );
    assertCondition(
      location.organizationId === input.organizationId,
      "forbidden",
      "The selected location is outside this organization.",
    );
  } else if (!canRequestOrganizationWideReport(membership)) {
    throw new WorkflowError(
      "forbidden",
      "Managers must select one of their assigned locations for a report export.",
    );
  }

  if (input.savedReportId) {
    const { data: savedReport, error } = await context.supabase
      .from("saved_reports")
      .select("id, organization_id, report_type")
      .eq("id", input.savedReportId)
      .eq("organization_id", input.organizationId)
      .maybeSingle();
    if (error) throwDatabaseError(error, "The saved report could not be verified.");
    const saved = assertFound(savedReport, "The saved report was not found.");
    assertCondition(
      saved.report_type === input.reportType,
      "conflict",
      "The requested report type does not match the saved report.",
    );
  }

  const { data: existing, error: existingError } = await context.supabase
    .from("export_jobs")
    .select("id")
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError, "The export request could not be checked.");

  const { data, error } = await context.supabase.rpc("request_report_export", {
    p_request_id: input.requestId,
    p_organization_id: input.organizationId,
    p_location_id: input.locationId ?? null,
    p_saved_report_id: input.savedReportId ?? null,
    p_report_type: input.reportType,
    p_period_start: input.periodStart ?? null,
    p_period_end: input.periodEnd ?? null,
    p_filters: input.filters as Json,
    p_export_type: input.exportType,
  });
  if (error) throwDatabaseError(error, "The report export could not be queued.");
  const job = assertFound(data, "The queued export job was not returned.");

  return {
    exportJobId: job.id as string,
    reportRunId: job.report_run_id as string,
    status: job.status as string,
    queuedAt: job.created_at as string,
    alreadyApplied: Boolean(existing),
  };
}
