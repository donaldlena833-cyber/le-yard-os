import type { ReportFilters, ReportView } from "./report-data";
import { escapeCsvField } from "@/lib/exports/csv";

export const escapeReportCsvField = escapeCsvField;

export function buildReportCsv(view: ReportView, filters: ReportFilters): string {
  const metadata = [
    ["Report", view.title],
    ["Location", filters.locationId],
    ["Starts on", filters.startsOn],
    ["Ends on", filters.endsOn],
    ["Source", view.sourceLabel],
    ["Source freshness", view.freshnessAt ?? "No matching source observations"],
    ["Coverage", view.coverageNote],
  ].map((row) => row.map(escapeReportCsvField).join(","));

  const header = view.columns.map((column) => escapeReportCsvField(column.label)).join(",");
  const rows = view.rows.map((row) =>
    view.columns.map((column) => escapeReportCsvField(row.cells[column.key] ?? "")).join(","),
  );
  return [...metadata, "", header, ...rows].join("\r\n") + "\r\n";
}
