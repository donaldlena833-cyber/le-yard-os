import "server-only";

import type { ReportFilters } from "@/components/reports/report-data";
import { isLiveReportKind, loadLiveReport, type LiveReportsModel } from "@/data/read-models/reports";
import { isIsoCalendarDate } from "@/data/read-models/shared";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { toDatabaseReportType } from "@/lib/supabase/value-mappers";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import type { Json } from "@/types/database.generated";

export type LiveReportExportRequest = {
  workspace: WorkspaceContextValue;
  model: LiveReportsModel;
  locationLabel: string;
};

export async function liveReportFromRequest(
  request: Request,
): Promise<LiveReportExportRequest | { error: string; status: number }> {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") {
    return { error: "Sign in to export a report.", status: 401 };
  }
  const search = new URL(request.url).searchParams;
  const kind = search.get("kind") ?? "";
  const locationId = search.get("locationId") ?? "";
  const startsOn = search.get("startsOn") ?? "";
  const endsOn = search.get("endsOn") ?? "";
  if (!isLiveReportKind(kind)) return { error: "Unknown report kind.", status: 400 };
  if (
    !locationId ||
    !isIsoCalendarDate(startsOn) ||
    !isIsoCalendarDate(endsOn) ||
    startsOn > endsOn
  ) {
    return { error: "Use a valid report scope and date range.", status: 400 };
  }
  if (locationId === "all" && !resolution.context.organizationWide) {
    return { error: "Managers must export one assigned location at a time.", status: 403 };
  }
  const filters: ReportFilters = { locationId, startsOn, endsOn };
  const result = await loadLiveReport(resolution.context, kind, filters);
  if (!result.ok) return { error: result.message, status: 422 };
  if (result.data.truncated) {
    return {
      error: "Narrow the filters before exporting so every source row is included.",
      status: 422,
    };
  }
  const locationLabel = locationId === "all"
    ? "All accessible locations"
    : result.data.locations.find((location) => location.id === locationId)?.name ?? "Location";
  return { workspace: resolution.context, model: result.data, locationLabel };
}

export async function beginInlineReportExport(
  request: LiveReportExportRequest,
  exportType: "csv" | "pdf",
) {
  const requestId = crypto.randomUUID();
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("request_report_export", {
    p_request_id: requestId,
    p_organization_id: request.workspace.organization.id,
    p_location_id: request.model.filters.locationId === "all"
      ? null
      : request.model.filters.locationId,
    p_saved_report_id: null,
    p_report_type: toDatabaseReportType(request.model.view.kind),
    p_period_start: request.model.filters.startsOn,
    p_period_end: request.model.filters.endsOn,
    p_filters: {
      delivery: "inline",
      report_version: "live-v1",
    } as Json,
    p_export_type: exportType,
  });
  if (error || !data) throw new Error("The export audit record could not be created.");
  return { requestId, organizationId: request.workspace.organization.id };
}

export async function finalizeInlineReportExport(
  audit: { requestId: string; organizationId: string },
  outcome:
    | { status: "succeeded"; rowCount: number; summary: Json }
    | { status: "failed"; errorMessage: string },
) {
  const admin = createAdminClient();
  const { error } = await admin.rpc("complete_report_export", {
    p_export_id: audit.requestId,
    p_status: outcome.status,
    p_row_count: outcome.status === "succeeded" ? outcome.rowCount : 0,
    p_result_summary: outcome.status === "succeeded" ? outcome.summary : {},
    p_error_message:
      outcome.status === "failed" ? outcome.errorMessage.slice(0, 2_000) : null,
  });
  if (error) {
    throw new Error("The export audit record could not be finalized.");
  }
}
