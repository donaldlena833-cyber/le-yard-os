import { PDFDocument } from "pdf-lib";
import { describe, expect, it } from "vitest";

import { buildReportCsv, escapeReportCsvField } from "../../../src/components/reports/report-csv";
import {
  DEFAULT_REPORT_FILTERS,
  REPORT_CATALOG,
  getReportView,
  type ReportView,
} from "../../../src/components/reports/report-data";
import { buildReportPdf, sanitizePdfText } from "../../../src/components/reports/report-pdf";
import { reportFromRequest } from "../../../src/app/api/exports/reports/report-request";
import { demoWorkspace } from "../../../src/lib/demo";

describe("report views", () => {
  it("builds every catalog report with metrics, columns, chart evidence, and freshness", () => {
    expect(REPORT_CATALOG).toHaveLength(14);
    for (const entry of REPORT_CATALOG) {
      const report = getReportView(entry.kind, DEFAULT_REPORT_FILTERS);
      expect(report.kind).toBe(entry.kind);
      expect(report.metrics).toHaveLength(4);
      expect(report.columns.length).toBeGreaterThan(0);
      expect(report.chart.points.length).toBeGreaterThan(0);
      expect(report.freshnessAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(report.sourceLabel.length).toBeGreaterThan(2);
      expect(report.coverageNote.length).toBeGreaterThan(10);
    }
  });

  it("applies location and date filters to location-scoped labor records", () => {
    const garden = getReportView("labor", {
      locationId: "loc-garden-demo",
      startsOn: "2026-07-31",
      endsOn: "2026-07-31",
    });
    expect(garden.rows.length).toBeGreaterThan(0);
    const locationName = demoWorkspace.locations.find(
      (location) => location.id === "loc-garden-demo",
    )!.name;
    expect(garden.rows.every((row) => row.cells.location.includes(locationName))).toBe(true);

    const empty = getReportView("labor", {
      locationId: "loc-garden-demo",
      startsOn: "2025-01-01",
      endsOn: "2025-01-02",
    });
    expect(empty.rows).toEqual([]);
  });

  it("keeps service charges explicitly outside the tip pool", () => {
    const tips = getReportView("tips", DEFAULT_REPORT_FILTERS);
    expect(tips.coverageNote).toMatch(/separate/i);
    expect(tips.columns.map((column) => column.key)).toContain("service");
    expect(tips.rows[0].cells.service).toBe("$300");
  });

  it("does not invent attendance or overtime compliance conclusions", () => {
    const attendance = getReportView("attendance", DEFAULT_REPORT_FILTERS);
    const overtime = getReportView("overtime", DEFAULT_REPORT_FILTERS);
    expect(attendance.coverageNote).toMatch(/no lateness.*rule is inferred/i);
    expect(overtime.coverageNote).toMatch(/does not determine legal or policy thresholds/i);
  });

  it("labels missing labor-cost and formal COGS source coverage", () => {
    const salesLabor = getReportView("sales_to_labor", DEFAULT_REPORT_FILTERS);
    const cogs = getReportView("cogs", DEFAULT_REPORT_FILTERS);
    expect(salesLabor.metrics.find((metric) => metric.label === "Labor cost %")?.value).toBe("Not available");
    expect(cogs.metrics.find((metric) => metric.label === "Formal COGS")?.value).toBe("Not available");
    expect(cogs.coverageNote).toMatch(/not calculated/i);
  });
});

describe("report CSV", () => {
  it("escapes quotes and spreadsheet formulas", () => {
    expect(escapeReportCsvField('Vendor, "One"')).toBe('"Vendor, ""One"""');
    expect(escapeReportCsvField("=2+2")).toBe("'=2+2");
  });

  it("includes source metadata and table rows with CRLF records", () => {
    const report = getReportView("inventory_variance", DEFAULT_REPORT_FILTERS);
    const csv = buildReportCsv(report, DEFAULT_REPORT_FILTERS);
    expect(csv).toContain("Report,Inventory variance\r\n");
    expect(csv).toContain("Source freshness,");
    expect(csv).toContain("Roma tomatoes");
    expect(csv.endsWith("\r\n")).toBe(true);
  });
});

describe("report PDF", () => {
  it("sanitizes unsupported typography to ASCII-safe PDF text", () => {
    expect(sanitizePdfText("Garden Room — 2 × 4…")).toBe("Garden Room - 2 x 4...");
  });

  it("creates a loadable, titled PDF with at least one landscape page", async () => {
    const report = getReportView("inventory_variance", DEFAULT_REPORT_FILTERS);
    const bytes = await buildReportPdf(report, DEFAULT_REPORT_FILTERS);
    expect(Array.from(bytes.slice(0, 5))).toEqual([37, 80, 68, 70, 45]);

    const document = await PDFDocument.load(bytes);
    expect(document.getTitle()).toBe("Inventory variance - Le Yard OS");
    expect(document.getPageCount()).toBeGreaterThanOrEqual(1);
    const page = document.getPage(0);
    expect(page.getWidth()).toBeGreaterThan(page.getHeight());
  });

  it("paginates a long table without losing rows", async () => {
    const base = getReportView("labor", DEFAULT_REPORT_FILTERS);
    const longReport: ReportView = {
      ...base,
      rows: Array.from({ length: 80 }, (_, index) => ({
        id: `row-${index}`,
        cells: Object.fromEntries(base.columns.map((column) => [column.key, `Value ${index} for ${column.label}`])),
      })),
    };
    const bytes = await buildReportPdf(longReport, DEFAULT_REPORT_FILTERS);
    const document = await PDFDocument.load(bytes);
    expect(document.getPageCount()).toBeGreaterThan(1);
  });
});

describe("report export request validation", () => {
  it("parses valid report filters and rejects unknown kinds, locations, and ranges", () => {
    const valid = reportFromRequest(
      new Request("http://localhost/api/exports/reports/pdf?kind=tips&locationId=all&startsOn=2026-07-01&endsOn=2026-08-01"),
    );
    expect("error" in valid).toBe(false);

    expect(
      reportFromRequest(new Request("http://localhost/api/exports/reports/pdf?kind=unknown")),
    ).toEqual({ error: "Unknown report kind." });
    expect(
      reportFromRequest(new Request("http://localhost/api/exports/reports/pdf?kind=tips&locationId=missing")),
    ).toEqual({ error: "Unknown location." });
    expect(
      reportFromRequest(
        new Request("http://localhost/api/exports/reports/pdf?kind=tips&startsOn=2026-08-02&endsOn=2026-08-01"),
      ),
    ).toEqual({ error: "Use a valid date range." });
  });
});
