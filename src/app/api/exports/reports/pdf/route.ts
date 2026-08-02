import { buildReportPdf } from "@/components/reports/report-pdf";
import { getServerRuntimeConfiguration } from "@/lib/env.server";
import { unavailableLiveReportExportResponse } from "../export-readiness";
import {
  beginInlineReportExport,
  finalizeInlineReportExport,
  liveReportFromRequest,
} from "../live-report-request";
import { reportFromRequest } from "../report-request";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  const unavailable = unavailableLiveReportExportResponse();
  if (unavailable) return unavailable;
  const runtime = getServerRuntimeConfiguration();

  if (runtime.mode === "connected") {
    const report = await liveReportFromRequest(request);
    if ("error" in report) {
      return Response.json(
        { error: report.error },
        { status: report.status, headers: { "Cache-Control": "private, no-store" } },
      );
    }
    let audit: Awaited<ReturnType<typeof beginInlineReportExport>> | null = null;
    try {
      audit = await beginInlineReportExport(report, "pdf");
      const pdf = await buildReportPdf(report.model.view, report.model.filters, {
        locationLabel: report.locationLabel,
        provenance: `Tenant-scoped ${report.workspace.organization.name} records`,
        snapshotAt: report.model.generatedAt,
      });
      await finalizeInlineReportExport(audit, {
        status: "succeeded",
        rowCount: report.model.view.rows.length,
        summary: {
          report_kind: report.model.view.kind,
          location: report.locationLabel,
          starts_on: report.model.filters.startsOn,
          ends_on: report.model.filters.endsOn,
        },
      });
      const filename = `le-yard-${report.model.view.kind}-${report.model.filters.startsOn}-${report.model.filters.endsOn}.pdf`;
      return new Response(Buffer.from(pdf), {
        status: 200,
        headers: {
          "Cache-Control": "private, no-store",
          "Content-Disposition": `attachment; filename="${filename}"`,
          "Content-Type": "application/pdf",
          "X-Content-Type-Options": "nosniff",
          "X-Report-Export-Id": audit.requestId,
        },
      });
    } catch {
      if (audit) {
        try {
          await finalizeInlineReportExport(audit, {
            status: "failed",
            errorMessage: "Inline PDF generation failed.",
          });
        } catch {
          // The response remains withheld if its audit trail cannot finalize.
        }
      }
      return Response.json(
        { error: "The report export could not be generated." },
        { status: 500, headers: { "Cache-Control": "private, no-store" } },
      );
    }
  }

  const report = reportFromRequest(request);
  if ("error" in report) return Response.json({ error: report.error }, { status: 400 });

  const pdf = await buildReportPdf(report.view, report.filters);
  const filename = `le-yard-${report.kind}-${report.filters.startsOn}-${report.filters.endsOn}.pdf`;
  return new Response(Buffer.from(pdf), {
    status: 200,
    headers: {
      "Cache-Control": "private, no-store",
      "Content-Disposition": `attachment; filename="${filename}"`,
      "Content-Type": "application/pdf",
      "X-Content-Type-Options": "nosniff",
    },
  });
}
