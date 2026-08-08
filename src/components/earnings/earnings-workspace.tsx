"use client";

import { ArrowLeft, ArrowRight, Check, Clock3, WalletCards } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

type PayDay = {
  date: string;
  shift: string;
  hours: number;
  hourly: number;
  tips: number;
};

type Paystub = {
  id: string;
  payday: string;
  period: string;
  hours: number;
  hourly: number;
  tips: number;
  days: PayDay[];
};

const paystubs: Paystub[] = [
  {
    id: "pay-aug-7",
    payday: "Fri · Aug 7",
    period: "Jul 28–Aug 3",
    hours: 23.5,
    hourly: 376,
    tips: 172.4,
    days: [
      { date: "Tue · Jul 29", shift: "Dinner · Server", hours: 5.5, hourly: 88, tips: 34.4 },
      { date: "Thu · Jul 31", shift: "Dinner · Server", hours: 6, hourly: 96, tips: 41 },
      { date: "Fri · Aug 1", shift: "Dinner · Server", hours: 7, hourly: 112, tips: 58.8 },
      { date: "Sun · Aug 3", shift: "Dinner · Server", hours: 5, hourly: 80, tips: 38.2 },
    ],
  },
  {
    id: "pay-aug-1",
    payday: "Fri · Aug 1",
    period: "Jul 21–27",
    hours: 29,
    hourly: 464,
    tips: 211.6,
    days: [
      { date: "Mon · Jul 21", shift: "Dinner · Server", hours: 7, hourly: 112, tips: 51.2 },
      { date: "Wed · Jul 23", shift: "Dinner · Server", hours: 7, hourly: 112, tips: 48.4 },
      { date: "Fri · Jul 25", shift: "Dinner · Server", hours: 7.5, hourly: 120, tips: 59 },
      { date: "Sat · Jul 26", shift: "Dinner · Server", hours: 7.5, hourly: 120, tips: 53 },
    ],
  },
  {
    id: "pay-jul-25",
    payday: "Fri · Jul 25",
    period: "Jul 14–20",
    hours: 25.5,
    hourly: 408,
    tips: 188.2,
    days: [
      { date: "Tue · Jul 15", shift: "Dinner · Server", hours: 6, hourly: 96, tips: 39.2 },
      { date: "Thu · Jul 17", shift: "Dinner · Server", hours: 6, hourly: 96, tips: 44 },
      { date: "Fri · Jul 18", shift: "Dinner · Server", hours: 7, hourly: 112, tips: 57 },
      { date: "Sun · Jul 20", shift: "Dinner · Server", hours: 6.5, hourly: 104, tips: 48 },
    ],
  },
];

const periodTotals = {
  week: { label: "This week", earned: 548.4, tips: 172.4, hourly: 376, hours: 23.5 },
  month: { label: "This month", earned: 1864.8, tips: 612.8, hourly: 1252, hours: 78.25 },
  ytd: { label: "Year to date", earned: 12942.4, tips: 4250.4, hourly: 8692, hours: 543.25 },
  year: { label: "Year", earned: 12942.4, tips: 4250.4, hourly: 8692, hours: 543.25 },
} as const;

type Period = keyof typeof periodTotals;

function money(value: number) {
  return `$${value.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function EarningsWorkspace() {
  const [period, setPeriod] = useState<Period>("week");
  const [selectedId, setSelectedId] = useState(paystubs[0]!.id);
  const selected = useMemo(() => paystubs.find((stub) => stub.id === selectedId) ?? paystubs[0]!, [selectedId]);
  const total = selected.hourly + selected.tips;
  const summary = periodTotals[period];

  return (
    <PageFrame width="wide">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end"><div><p className="eyebrow">Private to you</p><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Earnings</h2><p className="mt-1 text-[11px] text-[var(--ink-faint)]">Hours, approved tips, and hourly pay organized by Friday payday.</p></div><StatusPill tone="positive" dot>Updated after approvals</StatusPill></div>

      <div className="mt-6 flex items-center gap-1 overflow-x-auto border-b border-[var(--line)]">{(Object.keys(periodTotals) as Period[]).map((item) => <button key={item} onClick={() => setPeriod(item)} className={cn("focus-ring relative min-h-10 shrink-0 px-3 text-[11px] font-semibold", period === item ? "text-[var(--ink)]" : "text-[var(--ink-faint)]")}>{periodTotals[item].label}{period === item ? <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--accent)]" /> : null}</button>)}</div>

      <section aria-label="Earnings summary" className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0"><Metric label="Total earned" value={money(summary.earned)} detail={summary.label} /><Metric label="Hours" value={`${summary.hours}h`} detail="Approved and recorded" /><Metric label="Tips" value={money(summary.tips)} detail="Approved tip pool" /><Metric label="Hourly pay" value={money(summary.hourly)} detail="Regular + overtime where applicable" /></section>

      <div className="mt-8 grid gap-8 xl:grid-cols-[.78fr_1.22fr]">
        <section><SectionHeading eyebrow="Paydays are Fridays" title="Paystub history" detail="Each stub covers the previous workweek." /><div className="mt-4 border-y border-[var(--line)]">{paystubs.map((stub) => { const active = selected.id === stub.id; return <button key={stub.id} onClick={() => setSelectedId(stub.id)} className={cn("focus-ring flex w-full items-start gap-3 border-t border-[var(--line)] px-3 py-4 text-left first:border-0 hover:bg-[var(--paper)]", active && "bg-[var(--paper)]")}><span className={cn("flex size-9 shrink-0 items-center justify-center rounded-xl", active ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "bg-[var(--canvas-strong)] text-[var(--ink-faint)]")}><WalletCards className="size-4" /></span><span className="min-w-0 flex-1"><span className="flex items-center justify-between gap-3"><span className="text-xs font-semibold">{stub.payday}</span><span className="numeric text-xs font-semibold">{money(stub.hourly + stub.tips)}</span></span><span className="mt-1 block text-[10px] text-[var(--ink-faint)]">{stub.period} · {stub.hours}h · {money(stub.tips)} tips</span></span><ArrowRight className="mt-1 size-3.5 text-[var(--ink-faint)]" /></button>; })}</div><div className="mt-5 flex items-start gap-3 rounded-xl bg-[var(--canvas-strong)] px-3.5 py-3 text-[10px] leading-4 text-[var(--ink-faint)]"><Check className="mt-0.5 size-3.5 shrink-0 text-[var(--positive)]" />Your pay is shown after a manager approves the closeout and tip distribution.</div></section>

        <section><div className="flex items-end justify-between gap-3"><SectionHeading eyebrow="Selected paystub" title={`${selected.payday} · ${selected.period}`} detail="Simplified daily view of this payday." className="mb-0" /><Button variant="quiet" size="sm"><ArrowLeft className="size-3.5" />Back</Button></div><div className="mt-4 border-y border-[var(--line)]"><div className="grid grid-cols-[1fr_auto] gap-3 px-3 py-4"><div><p className="text-[10px] text-[var(--ink-faint)]">Total paid</p><p className="numeric mt-1 text-3xl font-semibold tracking-[-0.05em]">{money(total)}</p></div><div className="text-right"><p className="text-[10px] text-[var(--ink-faint)]">Payday</p><p className="mt-1 text-xs font-semibold">{selected.payday}</p></div></div><div className="grid grid-cols-3 divide-x border-t border-[var(--line)]"><div className="px-3 py-3"><p className="numeric text-sm font-semibold">{selected.hours}h</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">Hours</p></div><div className="px-3 py-3"><p className="numeric text-sm font-semibold">{money(selected.hourly)}</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">Hourly pay</p></div><div className="px-3 py-3"><p className="numeric text-sm font-semibold">{money(selected.tips)}</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">Tips</p></div></div></div><div className="mt-5 overflow-hidden border-y border-[var(--line)]"><div className="grid grid-cols-[1fr_65px_75px_75px] gap-2 bg-[var(--canvas-strong)] px-3 py-2.5 text-[9px] font-semibold tracking-[0.08em] text-[var(--ink-faint)] uppercase"><span>Day</span><span className="text-right">Hours</span><span className="text-right">Tips</span><span className="text-right">Total</span></div>{selected.days.map((day) => <div key={day.date} className="grid grid-cols-[1fr_65px_75px_75px] items-center gap-2 border-t border-[var(--line)] px-3 py-3"><div><p className="text-[10px] font-semibold">{day.date}</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">{day.shift}</p></div><span className="numeric text-right text-[10px]">{day.hours}h</span><span className="numeric text-right text-[10px]">{money(day.tips)}</span><span className="numeric text-right text-[10px] font-semibold">{money(day.hourly + day.tips)}</span></div>)}<div className="grid grid-cols-[1fr_auto] gap-3 border-t border-[var(--line)] px-3 py-3"><span className="text-[10px] font-semibold">Paystub total</span><span className="numeric text-[10px] font-semibold">{money(total)}</span></div></div><p className="mt-4 flex items-center gap-2 text-[10px] leading-4 text-[var(--ink-faint)]"><Clock3 className="size-3.5 shrink-0" />Hourly rate shown: $16.00 · Tips reflect the approved pool for each shift.</p></section>
      </div>
    </PageFrame>
  );
}
