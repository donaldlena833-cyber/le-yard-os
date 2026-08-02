import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFPage,
} from "pdf-lib";

import { demoWorkspace } from "../../lib/demo";

import type { ReportFilters, ReportView } from "./report-data";

const PAGE_WIDTH = 842;
const PAGE_HEIGHT = 595;
const MARGIN = 42;
const INK = rgb(0.09, 0.1, 0.09);
const SOFT_INK = rgb(0.34, 0.36, 0.33);
const FAINT_INK = rgb(0.48, 0.49, 0.46);
const LINE = rgb(0.86, 0.85, 0.81);
const PAPER = rgb(0.99, 0.985, 0.96);
const ACCENT = rgb(0.78, 0.43, 0.12);
const POSITIVE = rgb(0.18, 0.45, 0.32);
const WARNING = rgb(0.7, 0.42, 0.09);
const DANGER = rgb(0.65, 0.25, 0.2);

export function sanitizePdfText(value: string): string {
  return value
    .replaceAll("—", "-")
    .replaceAll("–", "-")
    .replaceAll("−", "-")
    .replaceAll("×", "x")
    .replaceAll("•", "-")
    .replaceAll("…", "...")
    .replaceAll("’", "'")
    .replaceAll("“", '"')
    .replaceAll("”", '"')
    .replaceAll("·", "-")
    .replaceAll("••••", "****")
    .replace(/[^\x20-\x7E]/g, "?");
}

function wrapText(text: string, font: PDFFont, size: number, maxWidth: number): string[] {
  const safe = sanitizePdfText(text);
  if (!safe) return [""];
  const words = safe.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (font.widthOfTextAtSize(candidate, size) <= maxWidth) {
      line = candidate;
      continue;
    }
    if (line) lines.push(line);
    if (font.widthOfTextAtSize(word, size) <= maxWidth) {
      line = word;
      continue;
    }
    let fragment = "";
    for (const character of word) {
      const candidateFragment = fragment + character;
      if (font.widthOfTextAtSize(candidateFragment, size) > maxWidth && fragment) {
        lines.push(fragment);
        fragment = character;
      } else {
        fragment = candidateFragment;
      }
    }
    line = fragment;
  }
  if (line) lines.push(line);
  return lines;
}

function toneColor(tone: ReportView["chart"]["points"][number]["tone"]) {
  if (tone === "positive") return POSITIVE;
  if (tone === "warning") return WARNING;
  if (tone === "danger") return DANGER;
  if (tone === "neutral") return FAINT_INK;
  return ACCENT;
}

function drawHeader(
  page: PDFPage,
  title: string,
  subtitle: string,
  font: PDFFont,
  bold: PDFFont,
  continuation = false,
): void {
  page.drawRectangle({ x: 0, y: PAGE_HEIGHT - 82, width: PAGE_WIDTH, height: 82, color: INK });
  page.drawText("LE YARD OS  /  OPERATIONS REPORT", {
    x: MARGIN,
    y: PAGE_HEIGHT - 28,
    size: 8,
    font: bold,
    color: rgb(0.83, 0.64, 0.35),
  });
  page.drawText(sanitizePdfText(`${title}${continuation ? " - continued" : ""}`), {
    x: MARGIN,
    y: PAGE_HEIGHT - 56,
    size: 20,
    font: bold,
    color: PAPER,
  });
  page.drawText(sanitizePdfText(subtitle), {
    x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(sanitizePdfText(subtitle), 8),
    y: PAGE_HEIGHT - 53,
    size: 8,
    font,
    color: rgb(0.73, 0.74, 0.7),
  });
}

function drawTableHeader(
  page: PDFPage,
  view: ReportView,
  y: number,
  columnWidth: number,
  bold: PDFFont,
): number {
  page.drawRectangle({
    x: MARGIN,
    y: y - 21,
    width: PAGE_WIDTH - MARGIN * 2,
    height: 21,
    color: rgb(0.94, 0.93, 0.89),
  });
  view.columns.forEach((column, index) => {
    const label = sanitizePdfText(column.label.toUpperCase());
    const labelWidth = bold.widthOfTextAtSize(label, 6.5);
    const baseX = MARGIN + index * columnWidth;
    const x = column.align === "right" ? baseX + columnWidth - 7 - labelWidth : baseX + 7;
    page.drawText(label, { x, y: y - 14, size: 6.5, font: bold, color: FAINT_INK });
  });
  return y - 21;
}

export async function buildReportPdf(
  view: ReportView,
  filters: ReportFilters,
  options: {
    locationLabel?: string;
    provenance?: string;
    snapshotAt?: string;
  } = {},
): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  const font = await pdf.embedFont(StandardFonts.Helvetica);
  const bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const location = options.locationLabel ?? (
    filters.locationId === "all"
      ? "All locations"
      : demoWorkspace.locations.find((item) => item.id === filters.locationId)?.name ?? "Unknown location"
  );
  const provenance = options.provenance ?? "Synthetic demo data";
  const snapshotAt = options.snapshotAt ?? demoWorkspace.asOf;
  const range = `${filters.startsOn} to ${filters.endsOn} / ${location}`;

  pdf.setTitle(`${view.title} - Le Yard OS`);
  pdf.setAuthor("Le Yard OS");
  pdf.setSubject(`${view.sourceLabel}; ${provenance}.`);
  pdf.setKeywords(["restaurant operations", view.kind, "report"]);

  let page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
  drawHeader(page, view.title, range, font, bold);

  const metricTop = PAGE_HEIGHT - 113;
  const metricWidth = (PAGE_WIDTH - MARGIN * 2) / Math.max(1, view.metrics.length);
  view.metrics.forEach((metric, index) => {
    const x = MARGIN + index * metricWidth;
    if (index > 0) page.drawLine({ start: { x, y: metricTop - 52 }, end: { x, y: metricTop + 4 }, thickness: 0.6, color: LINE });
    page.drawText(sanitizePdfText(metric.label.toUpperCase()), { x: x + 10, y: metricTop, size: 6.5, font: bold, color: FAINT_INK });
    const valueLines = wrapText(metric.value, bold, 15, metricWidth - 20).slice(0, 2);
    valueLines.forEach((line, lineIndex) => page.drawText(line, { x: x + 10, y: metricTop - 21 - lineIndex * 14, size: 15, font: bold, color: INK }));
    page.drawText(sanitizePdfText(metric.detail), { x: x + 10, y: metricTop - 48, size: 6.5, font, color: FAINT_INK });
  });
  page.drawLine({ start: { x: MARGIN, y: metricTop - 60 }, end: { x: PAGE_WIDTH - MARGIN, y: metricTop - 60 }, thickness: 0.7, color: LINE });

  let y = metricTop - 82;
  page.drawText("SOURCE COVERAGE", { x: MARGIN, y, size: 7, font: bold, color: ACCENT });
  y -= 15;
  const coverageLines = wrapText(`${view.sourceLabel}. ${view.coverageNote}`, font, 8.2, PAGE_WIDTH - MARGIN * 2);
  coverageLines.slice(0, 3).forEach((line, index) => page.drawText(line, { x: MARGIN, y: y - index * 11, size: 8.2, font, color: SOFT_INK }));
  y -= Math.min(coverageLines.length, 3) * 11 + 10;
  page.drawText(`Source freshness: ${sanitizePdfText(view.freshnessAt)}`, { x: MARGIN, y, size: 7, font, color: FAINT_INK });

  y -= 27;
  page.drawText(sanitizePdfText(view.chart.title.toUpperCase()), { x: MARGIN, y, size: 7, font: bold, color: FAINT_INK });
  y -= 14;
  const chartPoints = view.chart.points.slice(0, 6);
  const maxValue = Math.max(1, ...chartPoints.map((point) => Math.abs(point.value)));
  const labelWidth = 118;
  const valueWidth = 72;
  const chartWidth = PAGE_WIDTH - MARGIN * 2 - labelWidth - valueWidth;
  chartPoints.forEach((point) => {
    const barWidth = Math.max(point.value === 0 ? 1 : 4, (Math.abs(point.value) / maxValue) * chartWidth);
    page.drawText(sanitizePdfText(point.label).slice(0, 25), { x: MARGIN, y: y + 2, size: 7, font, color: SOFT_INK });
    page.drawRectangle({ x: MARGIN + labelWidth, y, width: chartWidth, height: 7, color: rgb(0.93, 0.92, 0.88) });
    page.drawRectangle({ x: MARGIN + labelWidth, y, width: barWidth, height: 7, color: toneColor(point.tone) });
    const display = sanitizePdfText(point.displayValue);
    page.drawText(display, { x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(display, 7), y: y + 1, size: 7, font: bold, color: INK });
    y -= 15;
  });

  y -= 7;
  const columnWidth = (PAGE_WIDTH - MARGIN * 2) / Math.max(1, view.columns.length);
  y = drawTableHeader(page, view, y, columnWidth, bold);

  for (const row of view.rows) {
    const cellLines = view.columns.map((column) =>
      wrapText(row.cells[column.key] ?? "", font, 7.2, columnWidth - 14).slice(0, 2),
    );
    const rowHeight = Math.max(25, Math.max(...cellLines.map((lines) => lines.length)) * 9 + 10);
    if (y - rowHeight < 46) {
      page = pdf.addPage([PAGE_WIDTH, PAGE_HEIGHT]);
      drawHeader(page, view.title, range, font, bold, true);
      y = drawTableHeader(page, view, PAGE_HEIGHT - 105, columnWidth, bold);
    }
    view.columns.forEach((column, columnIndex) => {
      const lines = cellLines[columnIndex];
      lines.forEach((line, lineIndex) => {
        const width = font.widthOfTextAtSize(line, 7.2);
        const baseX = MARGIN + columnIndex * columnWidth;
        const x = column.align === "right" ? baseX + columnWidth - 7 - width : baseX + 7;
        page.drawText(line, { x, y: y - 14 - lineIndex * 9, size: 7.2, font, color: INK });
      });
    });
    y -= rowHeight;
    page.drawLine({ start: { x: MARGIN, y }, end: { x: PAGE_WIDTH - MARGIN, y }, thickness: 0.45, color: LINE });
  }

  if (view.rows.length === 0) {
    page.drawText("No source records match these filters.", { x: MARGIN + 7, y: y - 22, size: 8.5, font, color: FAINT_INK });
  }

  const pages = pdf.getPages();
  pages.forEach((pdfPage, index) => {
    const footer = `${provenance} / ${view.sourceLabel} / Page ${index + 1} of ${pages.length}`;
    pdfPage.drawText(sanitizePdfText(footer), { x: MARGIN, y: 20, size: 6.5, font, color: FAINT_INK });
    const generated = `Snapshot ${snapshotAt}`;
    pdfPage.drawText(generated, {
      x: PAGE_WIDTH - MARGIN - font.widthOfTextAtSize(generated, 6.5),
      y: 20,
      size: 6.5,
      font,
      color: FAINT_INK,
    });
  });

  return pdf.save();
}
