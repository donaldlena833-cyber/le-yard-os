"use client";

import { motion } from "motion/react";
import {
  BarChart3,
  CalendarRange,
  CheckCircle2,
  CircleAlert,
  Clock3,
  Download,
  FileSpreadsheet,
  Info,
  MapPin,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type { LiveReportsModel } from "@/data/read-models/reports";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { cn } from "@/lib/utils";
import type { ReportKind } from "@/types";

const catalog: Array<{
  kind: ReportKind;
  label: string;
  group: "People" | "Money" | "Inventory" | "Guests";
}> = [
  { kind: "labor", label: "Labor", group: "People" },
  { kind: "attendance", label: "Attendance", group: "People" },
  { kind: "overtime", label: "Overtime", group: "People" },
  { kind: "tips", label: "Tips", group: "People" },
  { kind: "payroll", label: "Payroll readiness", group: "People" },
  { kind: "sales_to_labor", label: "Sales / labor", group: "Money" },
  { kind: "receipts", label: "Receipts", group: "Money" },
  { kind: "expenses", label: "Expenses", group: "Money" },
  { kind: "inventory_variance", label: "Inventory variance", group: "Inventory" },
  { kind: "cogs", label: "COGS", group: "Inventory" },
  { kind: "waste", label: "Waste", group: "Inventory" },
  { kind: "vendor_pricing", label: "Vendor pricing", group: "Inventory" },
  { kind: "shift_performance", label: "Shift performance", group: "People" },
  { kind: "guest_activity", label: "Guest activity", group: "Guests" },
];

function reportUrl(
  kind: ReportKind,
  model: LiveReportsModel,
  overrides: Partial<{ location: string; from: string; to: string }> = {},
) {
  const search = new URLSearchParams({
    type: kind,
    location: overrides.location ?? model.filters.locationId,
    from: overrides.from ?? model.filters.startsOn,
    to: overrides.to ?? model.filters.endsOn,
  });
  return `/reports?${search.toString()}`;
}

function exportUrl(format: "csv" | "pdf", model: LiveReportsModel) {
  const search = new URLSearchParams({
    kind: model.view.kind,
    locationId: model.filters.locationId,
    startsOn: model.filters.startsOn,
    endsOn: model.filters.endsOn,
  });
  return `/api/exports/reports/${format}?${search.toString()}`;
}

const toneClass = {
  accent: "bg-[var(--accent)]",
  positive: "bg-[var(--positive)]",
  warning: "bg-[var(--warning)]",
  danger: "bg-[var(--danger)]",
  neutral: "bg-[var(--ink-faint)]",
};

function AccessibleBars({ model }: { model: LiveReportsModel }) {
  const points = model.view.chart.points.slice(0, 10);
  const max = Math.max(1, ...points.map((point) => Math.abs(point.value)));
  return (
    <div role="img" aria-label={`${model.view.chart.title}. ${points.map((point) => `${point.label}: ${point.displayValue}`).join("; ")}`} className="space-y-3 border-y border-[var(--line)] py-5">
      {points.map((point, index) => (
        <div key={`${point.label}:${index}`} className="grid grid-cols-[minmax(105px,180px)_minmax(80px,1fr)_auto] items-center gap-3">
          <span className="truncate text-[10px] font-medium text-[var(--ink-soft)]">{point.label}</span>
          <span className="h-2.5 overflow-hidden rounded-full bg-[var(--canvas-strong)]"><motion.span initial={{ width: 0 }} animate={{ width: `${Math.max(point.value === 0 ? 1 : 3, (Math.abs(point.value) / max) * 100)}%` }} transition={{ duration: 0.45, delay: index * 0.025 }} className={cn("block h-full rounded-full", toneClass[point.tone ?? "accent"])} /></span>
          <span className="numeric min-w-16 text-right text-[10px] font-semibold">{point.displayValue}</span>
        </div>
      ))}
    </div>
  );
}

function ExportLink({ href, format }: { href: string; format: "CSV" | "PDF" }) {
  const Icon = format === "CSV" ? FileSpreadsheet : Download;
  return <a href={href} download className="focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-4 text-xs font-semibold transition-colors hover:border-[var(--line-strong)] hover:bg-[var(--paper)]"><Icon className="size-3.5" />{format}</a>;
}

export function LiveReportsWorkspace({
  workspace,
  result,
}: {
  workspace: WorkspaceContextValue;
  result: LiveReadResult<LiveReportsModel>;
}) {
  const router = useRouter();
  if (!result.ok) {
    return <PageFrame><section className="mx-auto mt-[10svh] max-w-xl rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-8 text-center"><CircleAlert className="mx-auto size-6 text-[var(--warning)]" /><h2 className="mt-4 text-xl font-medium">Report unavailable</h2><p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">{result.message}</p></section></PageFrame>;
  }
  const model = result.data;
  const report = model.view;
  const group = catalog.find((item) => item.kind === report.kind)?.group ?? "Operations";
  const locationLabel = model.filters.locationId === "all"
    ? "All accessible locations"
    : model.locations.find((location) => location.id === model.filters.locationId)?.name ?? "Location";

  return (
    <PageFrame width="full" className="max-w-[1700px]">
      <header className="flex flex-col justify-between gap-5 xl:flex-row xl:items-end">
        <div><div className="flex items-center gap-2"><StatusPill tone="positive" dot>Source-backed</StatusPill><span className="text-[10px] text-[var(--ink-faint)]">Generated {new Date(model.generatedAt).toLocaleString()}</span></div><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Reports</h2><p className="mt-1 text-[11px] text-[var(--ink-faint)]">Tenant-scoped operational evidence for {workspace.organization.name}.</p></div>
        <form action="/reports" className="grid gap-2 sm:grid-cols-[minmax(180px,1fr)_160px_160px_auto]"><input type="hidden" name="type" value={report.kind} /><label className="relative"><span className="sr-only">Location</span><MapPin className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" /><select name="location" defaultValue={model.filters.locationId} className="h-10 w-full appearance-none rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] pr-7 pl-9 text-[11px] font-semibold outline-none"><option value="all">All accessible locations</option>{model.locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</select></label><label className="relative"><span className="sr-only">Start date</span><CalendarRange className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" /><input name="from" type="date" defaultValue={model.filters.startsOn} className="h-10 min-w-0 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] pr-2 pl-9 text-[11px] font-semibold outline-none" /></label><label className="relative"><span className="sr-only">End date</span><CalendarRange className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-[var(--ink-faint)]" /><input name="to" type="date" defaultValue={model.filters.endsOn} className="h-10 min-w-0 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] pr-2 pl-9 text-[11px] font-semibold outline-none" /></label><Button type="submit" variant="secondary">Apply</Button></form>
      </header>

      <div className="mt-6 lg:hidden"><label><span className="mb-1.5 block text-[10px] font-semibold text-[var(--ink-faint)]">Report view</span><select value={report.kind} onChange={(event) => router.push(reportUrl(event.target.value as ReportKind, model))} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-xs font-semibold outline-none">{catalog.map((item) => <option key={item.kind} value={item.kind}>{item.group} · {item.label}</option>)}</select></label></div>
      <nav aria-label="Report views" className="mt-6 hidden overflow-x-auto border-y border-[var(--line)] lg:block"><div role="tablist" className="flex min-w-max items-center">{catalog.map((item) => <button key={item.kind} role="tab" aria-selected={report.kind === item.kind} onClick={() => router.push(reportUrl(item.kind, model))} className={cn("relative min-h-12 px-3.5 text-[10px] font-semibold text-[var(--ink-faint)] transition-colors hover:text-[var(--ink)]", report.kind === item.kind && "text-[var(--ink)]")}>{item.label}{report.kind === item.kind ? <motion.span layoutId="live-report-tab" className="absolute inset-x-3 bottom-0 h-0.5 rounded-full bg-[var(--accent)]" /> : null}</button>)}</div></nav>

      {model.truncated ? <div role="status" className="mt-4 rounded-xl bg-[var(--warning-soft)] px-4 py-3 text-[10px] text-[var(--warning)]">This view reached its 5,000-row safety bound. Narrow the date or location filter before exporting a complete report.</div> : null}

      <div className="mt-7 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">{group}</p><h3 className="mt-2 text-xl font-medium tracking-[-0.04em]">{report.title}</h3><p className="mt-1 max-w-2xl text-[11px] leading-5 text-[var(--ink-faint)]">{report.description}</p></div><div className="flex gap-2"><ExportLink href={exportUrl("csv", model)} format="CSV" /><ExportLink href={exportUrl("pdf", model)} format="PDF" /></div></div>

      <section aria-label={`${report.title} metrics`} className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">{report.metrics.map((metric) => <Metric key={metric.label} label={metric.label} value={metric.value} detail={metric.detail} />)}</section>

      <div className="mt-7 grid gap-8 xl:grid-cols-[minmax(0,1fr)_310px]"><section className="min-w-0"><SectionHeading eyebrow="Selected view" title={report.chart.title} detail={report.chart.description} /><AccessibleBars model={model} /></section><aside><SectionHeading eyebrow="Evidence" title="Source coverage" /><div className="divide-y divide-[var(--line)] border-y border-[var(--line)]"><div className="flex gap-3 py-4"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[var(--positive)]" /><div><p className="text-[11px] font-semibold">{report.sourceLabel}</p><p className="mt-1 text-[9px] leading-4 text-[var(--ink-faint)]">Primary tenant-scoped records</p></div></div><div className="flex gap-3 py-4"><Clock3 className="mt-0.5 size-4 shrink-0 text-[var(--accent)]" /><div><p className="text-[11px] font-semibold">Fresh {new Date(report.freshnessAt).toLocaleString()}</p><p className="mt-1 text-[9px] leading-4 text-[var(--ink-faint)]">Newest included source update</p></div></div><div className="flex gap-3 py-4"><MapPin className="mt-0.5 size-4 shrink-0 text-[var(--ink-faint)]" /><div><p className="text-[11px] font-semibold">{locationLabel}</p><p className="mt-1 text-[9px] leading-4 text-[var(--ink-faint)]">{model.filters.startsOn} through {model.filters.endsOn}</p></div></div><div className="flex gap-3 py-4"><Info className="mt-0.5 size-4 shrink-0 text-[var(--warning)]" /><p className="text-[10px] leading-4 text-[var(--ink-soft)]">{report.coverageNote}</p></div></div></aside></div>

      <section className="mt-9"><SectionHeading eyebrow="Source rows" title={`${report.rows.length} matching record${report.rows.length === 1 ? "" : "s"}`} detail={`${model.filters.startsOn} through ${model.filters.endsOn}`} action={<span className="flex items-center gap-1.5 text-[9px] text-[var(--ink-faint)]"><BarChart3 className="size-3" />Values preserve source precision</span>} /><div role="region" aria-label={`${report.title} source records`} tabIndex={0} className="overflow-x-auto border-y border-[var(--line)]"><table className="w-full min-w-[760px] border-collapse text-left"><thead className="bg-[var(--canvas-strong)]"><tr>{report.columns.map((column) => <th key={column.key} scope="col" className={cn("px-4 py-2.5 text-[9px] font-semibold tracking-[0.1em] text-[var(--ink-faint)] uppercase", column.align === "right" && "text-right")}>{column.label}</th>)}</tr></thead><tbody className="divide-y divide-[var(--line)]">{report.rows.map((row) => <tr key={row.id} className="transition-colors hover:bg-[var(--paper)]">{report.columns.map((column) => <td key={column.key} className={cn("px-4 py-3.5 text-[10px] text-[var(--ink-soft)]", column.align === "right" && "numeric text-right font-semibold text-[var(--ink)]")}>{row.cells[column.key] || "—"}</td>)}</tr>)}{!report.rows.length ? <tr><td colSpan={report.columns.length} className="px-5 py-12 text-center text-[11px] text-[var(--ink-faint)]">No source records match these filters.</td></tr> : null}</tbody></table></div></section>
    </PageFrame>
  );
}
