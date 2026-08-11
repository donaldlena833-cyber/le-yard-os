"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  BarChart3,
  CalendarRange,
  CheckCircle2,
  Clock3,
  Download,
  FileSpreadsheet,
  Info,
  MapPin,
} from "lucide-react";
import { useMemo, useState } from "react";

import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { ReadState } from "@/components/ui/read-state";
import { ResponsiveDataView } from "@/components/ui/responsive-data-view";
import { TabPanel, Tabs } from "@/components/ui/tabs";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { StatusPill } from "@/components/ui/status-pill";
import { demoWorkspace } from "@/lib/demo";
import { cn } from "@/lib/utils";
import type { ReportKind } from "@/types";

import {
  DEFAULT_REPORT_FILTERS,
  REPORT_CATALOG,
  getReportView,
  type ReportChartPoint,
  type ReportFilters,
} from "./report-data";

function exportHref(format: "csv" | "pdf", kind: ReportKind, filters: ReportFilters): string {
  const search = new URLSearchParams({
    kind,
    locationId: filters.locationId,
    startsOn: filters.startsOn,
    endsOn: filters.endsOn,
  });
  return `/api/exports/reports/${format}?${search.toString()}`;
}

function formatFreshness(value: string): string {
  return new Intl.DateTimeFormat("en-US", {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    timeZone: "America/New_York",
    timeZoneName: "short",
  }).format(new Date(value));
}

const toneFill: Record<NonNullable<ReportChartPoint["tone"]>, string> = {
  accent: "var(--accent)",
  positive: "var(--positive)",
  warning: "var(--warning)",
  danger: "var(--danger)",
  neutral: "var(--ink-faint)",
};

function AccessibleBarChart({
  reportKind,
  title,
  description,
  points,
}: {
  reportKind: ReportKind;
  title: string;
  description: string;
  points: ReportChartPoint[];
}) {
  const displayed = points.slice(0, 8);
  const width = 760;
  const labelWidth = 172;
  const valueWidth = 90;
  const chartWidth = width - labelWidth - valueWidth - 28;
  const rowHeight = 38;
  const height = Math.max(150, displayed.length * rowHeight + 28);
  const max = Math.max(1, ...displayed.map((point) => Math.abs(point.value)));
  const titleId = `chart-title-${reportKind}`;
  const descriptionId = `chart-description-${reportKind}`;
  const spokenValues = displayed.map((point) => `${point.label}: ${point.displayValue}`).join("; ");

  return (
    <svg
      role="img"
      aria-labelledby={`${titleId} ${descriptionId}`}
      className="h-auto w-full overflow-visible text-[var(--ink)]"
      viewBox={`0 0 ${width} ${height}`}
    >
      <title id={titleId}>{title}</title>
      <desc id={descriptionId}>{description} {spokenValues}</desc>
      {displayed.map((point, index) => {
        const y = 16 + index * rowHeight;
        const barWidth = Math.max(point.value === 0 ? 2 : 8, (Math.abs(point.value) / max) * chartWidth);
        return (
          <g key={`${point.label}-${index}`}>
            <text x="0" y={y + 13} fill="var(--ink-soft)" fontSize="11" fontWeight="550">
              {point.label.length > 24 ? `${point.label.slice(0, 23)}…` : point.label}
            </text>
            <rect x={labelWidth} y={y} width={chartWidth} height="17" rx="8.5" fill="var(--canvas-strong)" />
            <motion.rect
              initial={{ width: 0 }}
              animate={{ width: barWidth }}
              transition={{ duration: 0.5, ease: [0.22, 1, 0.36, 1] }}
              x={labelWidth}
              y={y}
              height="17"
              rx="8.5"
              fill={toneFill[point.tone ?? "accent"]}
            />
            <text x={width - 2} y={y + 13} textAnchor="end" fill="var(--ink)" fontSize="11" fontWeight="650">
              {point.displayValue}
            </text>
          </g>
        );
      })}
    </svg>
  );
}

function ExportLink({ href, format }: { href: string; format: "CSV" | "PDF" }) {
  const Icon = format === "CSV" ? FileSpreadsheet : Download;
  return (
    <a
      href={href}
      download
      className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-4 text-xs font-semibold transition-[border-color,background,transform] hover:border-[var(--line-strong)] hover:bg-[var(--paper)] active:scale-[.98]"
    >
      <Icon className="size-3.5" />
      {format}
    </a>
  );
}

export function ReportsWorkspace() {
  const workspace = useWorkspaceContext();
  const [kind, setKind] = useState<ReportKind>("labor");
  const [filters, setFilters] = useState<ReportFilters>(DEFAULT_REPORT_FILTERS);
  const report = useMemo(() => getReportView(kind, filters), [kind, filters]);

  function updateFilter<Key extends keyof ReportFilters>(key: Key, value: ReportFilters[Key]) {
    setFilters((current) => ({ ...current, [key]: value }));
  }

  const invalidRange = filters.startsOn > filters.endsOn;
  const visibleLocations = workspace.locations;
  const primaryColumn = report.columns[0];
  const supportingColumns = report.columns.slice(1);
  const responsiveColumns = report.columns.map((column) => ({
    key: column.key,
    label: column.label,
    align: column.align,
    render: (row: (typeof report.rows)[number]) => row.cells[column.key] || "—",
  }));

  return (
    <PageFrame width="full" className="max-w-[1700px]">
      <header className="flex flex-col justify-between gap-5 lg:flex-row lg:items-end">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill tone="positive" dot>Source-backed</StatusPill>
            <span className="text-xs text-[var(--ink-faint)]">Synthetic workspace · {demoWorkspace.asOf.slice(0, 10)}</span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Reports</h2>
          <p className="mt-1 text-[13px] text-[var(--ink-faint)]">Operational evidence, freshness, and exports in one working surface.</p>
        </div>

        <div className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_170px_170px]">
          <label className="relative">
            <span className="sr-only">Location</span>
            <MapPin className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" />
            <select
              value={filters.locationId}
              onChange={(event) => updateFilter("locationId", event.target.value)}
              className="h-10 w-full appearance-none rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] pr-7 pl-9 text-[13px] font-semibold outline-none"
            >
              <option value="all">Le Yard</option>
              {visibleLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
            </select>
          </label>
          <label className="relative">
            <span className="sr-only">Start date</span>
            <CalendarRange className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" />
            <input
              type="date"
              value={filters.startsOn}
              onChange={(event) => updateFilter("startsOn", event.target.value)}
              className="h-10 min-w-0 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] pr-2 pl-9 text-[13px] font-semibold outline-none"
            />
          </label>
          <label className="relative">
            <span className="sr-only">End date</span>
            <CalendarRange className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" />
            <input
              type="date"
              value={filters.endsOn}
              onChange={(event) => updateFilter("endsOn", event.target.value)}
              className={cn(
                "h-10 min-w-0 w-full rounded-xl border bg-[var(--paper-strong)] pr-2 pl-9 text-[13px] font-semibold outline-none",
                invalidRange ? "border-[var(--danger)]" : "border-[var(--line)]",
              )}
            />
          </label>
        </div>
      </header>

      <div className="mt-6 lg:hidden">
        <label>
          <span className="mb-1.5 block text-xs font-semibold text-[var(--ink-faint)]">Report view</span>
          <select
            value={kind}
            onChange={(event) => setKind(event.target.value as ReportKind)}
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-xs font-semibold outline-none"
          >
            {REPORT_CATALOG.map((item) => <option key={item.kind} value={item.kind}>{item.group} · {item.label}</option>)}
          </select>
        </label>
      </div>

      <Tabs
        id="demo-report-views"
        label="Report views"
        className="mt-6 hidden border-y lg:flex"
        size="large"
        items={REPORT_CATALOG.map((item) => ({
          value: item.kind,
          label: item.label,
        }))}
        value={kind}
        onValueChange={setKind}
      />

      {invalidRange ? (
        <div role="alert" className="mt-4 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-[13px] text-[var(--danger)]">The start date must be on or before the end date.</div>
      ) : null}

      <AnimatePresence mode="wait">
        <motion.div
          key={`${kind}-${filters.locationId}-${filters.startsOn}-${filters.endsOn}`}
          initial={{ opacity: 0, y: 7 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -5 }}
          transition={{ duration: 0.2 }}
        >
          <TabPanel id="demo-report-views" value={kind}>
          <div className="mt-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
            <div>
              <p className="eyebrow">{REPORT_CATALOG.find((item) => item.kind === kind)?.group}</p>
              <h3 className="mt-2 text-xl font-medium tracking-[-0.04em]">{report.title}</h3>
              <p className="mt-1 max-w-2xl text-[13px] leading-5 text-[var(--ink-faint)]">{report.description}</p>
            </div>
            <div className="flex gap-2">
              <ExportLink href={exportHref("csv", kind, filters)} format="CSV" />
              <ExportLink href={exportHref("pdf", kind, filters)} format="PDF" />
            </div>
          </div>

          <section aria-label={`${report.title} metrics`} className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
            {report.metrics.map((metric) => <Metric key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} />)}
          </section>

          <div className="mt-7 grid gap-8 xl:grid-cols-[minmax(0,1fr)_300px]">
            <section className="min-w-0">
              <SectionHeading eyebrow="Selected view" title={report.chart.title} detail={report.chart.description} />
              <div className="overflow-hidden border-y border-[var(--line)] py-5">
                <AccessibleBarChart reportKind={kind} title={report.chart.title} description={report.chart.description} points={report.chart.points} />
              </div>
            </section>

            <aside>
              <SectionHeading eyebrow="Evidence" title="Source coverage" />
              <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
                <div className="flex gap-3 py-4">
                  <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--positive)]" />
                  <div><p className="text-[13px] font-semibold">{report.sourceLabel}</p><p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">Primary records for this view</p></div>
                </div>
                <div className="flex gap-3 py-4">
                  <Clock3 className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" />
                  <div><p className="text-[13px] font-semibold">Fresh {formatFreshness(report.freshnessAt)}</p><p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">Newest included source update</p></div>
                </div>
                <div className="flex gap-3 py-4">
                  <Info className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" />
                  <p className="text-xs leading-4 text-[var(--ink-soft)]">{report.coverageNote}</p>
                </div>
              </div>
            </aside>
          </div>

          <section className="mt-9">
            <SectionHeading
              eyebrow="Source rows"
              title={`${report.rows.length} matching record${report.rows.length === 1 ? "" : "s"}`}
              detail={`${filters.startsOn} through ${filters.endsOn}`}
              action={<span className="flex items-center gap-1.5 text-xs text-[var(--ink-faint)]"><BarChart3 className="size-3" /> Values preserve source precision</span>}
            />
            <ResponsiveDataView
              items={report.rows}
              columns={responsiveColumns}
              getItemKey={(row) => row.id}
              label={`${report.title} source records`}
              empty={<ReadState compact state="empty" title="No matching source records" description="Adjust the report, location, or date filters to broaden the evidence window." />}
              renderCard={(row) => (
                <div>
                  <p className="text-sm font-semibold text-[var(--ink)]">
                    {primaryColumn ? row.cells[primaryColumn.key] || "—" : "Source record"}
                  </p>
                  <dl className="mt-3 grid grid-cols-2 gap-x-4 gap-y-3">
                    {supportingColumns.map((column) => (
                      <div key={column.key} className={column.align === "right" ? "text-right" : undefined}>
                        <dt className="text-[11px] font-semibold tracking-[0.08em] text-[var(--ink-faint)] uppercase">{column.label}</dt>
                        <dd className={cn("mt-1 text-xs capitalize text-[var(--ink-soft)]", column.align === "right" && "numeric font-semibold text-[var(--ink)]")}>{row.cells[column.key] || "—"}</dd>
                      </div>
                    ))}
                  </dl>
                </div>
              )}
            />
          </section>
          </TabPanel>
        </motion.div>
      </AnimatePresence>
    </PageFrame>
  );
}
