"use client";

import { AnimatePresence, motion } from "motion/react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  CalendarDays,
  Check,
  ChefHat,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  Radio,
  Sparkles,
  UsersRound,
  Utensils,
  WalletCards,
} from "lucide-react";
import type { LucideIcon } from "lucide-react";
import { useState } from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { LiveClock } from "@/components/today/live-clock";
import {
  isSaturdayServicePreview,
  saturdayServiceSimulation,
} from "@/lib/demo";
import { cn } from "@/lib/utils";

const team = [
  { name: "Donald", role: "Owner operator", start: "4:00", end: "11:30", status: "on_shift" },
  { name: "Maris", role: "Owner operator", start: "4:30", end: "12:00", status: "on_shift" },
  { name: "Irini", role: "Server", start: "5:00", end: "11:00", status: "next" },
  { name: "Mateo", role: "Chef / manager", start: "3:00", end: "11:00", status: "on_shift" },
];

type TodayAction = {
  id: string;
  icon: LucideIcon;
  tone: "danger" | "warning";
  title: string;
  detail: string;
};

const initialActions: TodayAction[] = [];

const saturdayServiceActions: TodayAction[] = [
  {
    id: "table-nine-delay",
    icon: Clock3,
    tone: "danger",
    title: "Table 9 is 18 minutes behind pace",
    detail: "Party of 6 · entrées fired at 7:31 PM · server requested a manager touch.",
  },
  {
    id: "filet-running-low",
    icon: ChefHat,
    tone: "warning",
    title: "Filet au poivre is running low",
    detail: "8 portions remain · 11 later covers have ordered steak on comparable Saturdays.",
  },
  {
    id: "break-window",
    icon: UsersRound,
    tone: "warning",
    title: "Two break windows need adjustment",
    detail: "Irini and Leo cross six hours tonight; no break timing has been approved yet.",
  },
];

const saturdayTeam = [
  { name: "Donald", role: "Owner · floor", shift: "4:00–11:30", station: "Dining room" },
  { name: "Maris", role: "Owner · host", shift: "4:30–12:00", station: "Door" },
  { name: "Mateo", role: "Executive chef", shift: "2:30–11:30", station: "Expo" },
  { name: "Irini", role: "Server", shift: "4:30–11:00", station: "Section 2" },
  { name: "Aisha", role: "FOH manager", shift: "3:30–12:00", station: "Floor" },
  { name: "Priya", role: "Bartender", shift: "4:00–12:00", station: "Bar" },
  { name: "Leo", role: "Line cook", shift: "2:30–11:30", station: "Sauté" },
  { name: "Imani", role: "Server", shift: "5:00–11:30", station: "Section 1" },
];

function SaturdayServiceTodayWorkspace({ firstName }: { firstName: string }) {
  const [actions, setActions] = useState(saturdayServiceActions);
  const pacing = [
    { label: "5 PM", covers: 18, width: "38%" },
    { label: "6 PM", covers: 27, width: "58%" },
    { label: "7 PM", covers: 46, width: "100%" },
    { label: "8 PM", covers: 39, width: "85%", current: true },
    { label: "9 PM", covers: 24, width: "52%" },
    { label: "10 PM", covers: 9, width: "20%" },
  ];

  return (
    <PageFrame>
      <section className="relative overflow-hidden rounded-[30px] border border-white/[0.08] bg-[var(--graphite)] px-5 py-7 text-white shadow-[var(--shadow-raised)] sm:px-8 sm:py-9">
        <div className="absolute inset-0 workspace-grid opacity-20" />
        <div className="relative flex flex-col justify-between gap-8 xl:flex-row xl:items-end">
          <div className="max-w-2xl">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="positive" dot className="bg-white/[0.08] text-[#93d0ad]">In service</StatusPill>
              <StatusPill tone="neutral" className="bg-white/[0.08] text-white/70">Synthetic preview</StatusPill>
              <span className="text-xs text-white/55">Saturday · April 18 · five months open</span>
            </div>
            <h2 className="mt-5 text-[clamp(2rem,4.2vw,4rem)] leading-none font-medium tracking-[-0.065em]">
              Saturday night, {firstName}.
            </h2>
            <p className="mt-4 max-w-xl text-sm leading-6 text-white/60">
              You are entering Le Yard at the peak of dinner service. Every record in this preview is synthetic and every owner workflow is available to explore.
            </p>
          </div>
          <div className="flex items-end gap-8 border-t border-white/10 pt-5 xl:border-0 xl:pt-0">
            <div>
              <p className="text-xs tracking-[0.12em] text-white/55 uppercase">Simulated time</p>
              <p className="numeric mt-2 text-3xl font-medium tracking-[-0.05em]">8:00 PM</p>
            </div>
            <div>
              <p className="text-xs tracking-[0.12em] text-white/55 uppercase">Service state</p>
              <p className="mt-2 flex items-center gap-2 text-xl font-medium"><Radio className="size-4 text-[#93d0ad]" /> Peak</p>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="Saturday service metrics" className="mt-4 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Metric className="rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] !px-4 shadow-[var(--shadow-card)]" label="Covers" value="163" detail="128 booked · 35 walk-in" />
        <Metric className="rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] !px-4 shadow-[var(--shadow-card)]" label="Seated so far" value="112" detail="68.7% of projected covers" />
        <Metric className="rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] !px-4 shadow-[var(--shadow-card)]" label="Net sales" value="$8.4k" detail="$12.7k projected close" />
        <Metric className="rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] !px-4 shadow-[var(--shadow-card)]" label="Labor" value="13 on" detail="1 late · 2 break windows" />
      </section>

      <div className="mt-8 grid gap-8 xl:grid-cols-[1.45fr_.8fr] xl:gap-12">
        <div className="space-y-9">
          <section>
            <SectionHeading
              eyebrow="Service now"
              title="Dining room pulse"
              detail="Host, floor, kitchen, and sales context at the simulated 8:00 PM moment."
              action={<Link href={`/reservations?date=${saturdayServiceSimulation.businessDate}`} className="focus-ring inline-flex min-h-10 items-center gap-1 rounded-xl px-3 text-xs font-semibold text-[var(--accent-strong)] hover:bg-[var(--canvas-strong)]">Open reservations <ArrowRight className="size-3" /></Link>}
            />
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
              {[
                { icon: UsersRound, label: "Dining room", value: "14 tables", note: "11 seated · 2 reset · 1 open" },
                { icon: Clock3, label: "Average turn", value: "94 min", note: "6 min above Saturday target" },
                { icon: ChefHat, label: "Kitchen", value: "17 open", note: "8 entrées firing · 9 on hold" },
                { icon: CircleDollarSign, label: "Average check", value: "$74", note: "$3 above five-month average" },
              ].map((item) => (
                <div key={item.label} className="rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] p-4 shadow-[var(--shadow-card)]">
                  <item.icon className="size-4 text-[var(--accent-strong)]" />
                  <p className="mt-5 text-xs font-semibold tracking-[0.08em] text-[var(--ink-faint)] uppercase">{item.label}</p>
                  <p className="numeric mt-2 text-xl font-semibold tracking-[-0.04em]">{item.value}</p>
                  <p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">{item.note}</p>
                </div>
              ))}
            </div>
          </section>

          <div className="grid gap-8 lg:grid-cols-[.85fr_1.15fr]">
            <section>
              <SectionHeading eyebrow="Reservations" title="Pacing" detail="163 projected covers · current hour highlighted" />
              <div className="space-y-3 rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-card)]">
                {pacing.map((period) => (
                  <div key={period.label} className="grid grid-cols-[44px_1fr_32px] items-center gap-3">
                    <span className={cn("text-xs font-semibold", period.current ? "text-[var(--accent-strong)]" : "text-[var(--ink-faint)]")}>{period.label}</span>
                    <div className="h-2 overflow-hidden rounded-full bg-[var(--canvas-strong)]">
                      <div className={cn("h-full rounded-full", period.current ? "bg-[var(--accent)]" : "bg-[var(--graphite)]/65")} style={{ width: period.width }} />
                    </div>
                    <span className="numeric text-right text-xs font-semibold">{period.covers}</span>
                  </div>
                ))}
              </div>
            </section>

            <section>
              <SectionHeading eyebrow="Team" title="Who’s operating" detail="8 key team members shown · 13 clocked in" />
              <div className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] shadow-[var(--shadow-card)]">
                {saturdayTeam.map((person, index) => (
                  <div key={person.name} className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-[var(--line)] px-4 py-3 first:border-0 sm:grid-cols-[1fr_100px_92px]">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={person.name} index={index} />
                      <div className="min-w-0"><p className="truncate text-sm font-semibold">{person.name}</p><p className="truncate text-xs text-[var(--ink-faint)]">{person.role}</p></div>
                    </div>
                    <p className="hidden text-xs text-[var(--ink-faint)] sm:block">{person.station}</p>
                    <StatusPill tone="positive" dot>On shift</StatusPill>
                  </div>
                ))}
              </div>
            </section>
          </div>
        </div>

        <aside className="space-y-9">
          <section>
            <SectionHeading eyebrow="Needs attention" title={`${actions.length} live decisions`} detail="Resolve freely; the preview resets without touching live data." />
            <div className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] shadow-[var(--shadow-card)]">
              <AnimatePresence initial={false}>
                {actions.map((action) => {
                  const Icon = action.icon;
                  return (
                    <motion.div key={action.id} layout exit={{ opacity: 0, height: 0 }} className="border-b border-[var(--line)] last:border-0">
                      <div className="flex items-start gap-3 px-4 pt-4">
                        <span className={cn("mt-0.5 flex size-9 shrink-0 items-center justify-center rounded-xl", action.tone === "danger" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warning-soft)] text-[var(--warning)]")}><Icon className="size-4" /></span>
                        <div><p className="text-sm font-semibold leading-5">{action.title}</p><p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">{action.detail}</p></div>
                      </div>
                      <div className="flex justify-end gap-2 px-4 py-3">
                        <Button variant="quiet" size="sm">Review</Button>
                        <Button variant="secondary" size="sm" onClick={() => setActions((current) => current.filter((item) => item.id !== action.id))}><Check className="size-3" /> Resolve</Button>
                      </div>
                    </motion.div>
                  );
                })}
              </AnimatePresence>
              {!actions.length ? <div className="px-5 py-9 text-center"><Check className="mx-auto size-5 text-[var(--positive)]" /><p className="mt-3 text-sm font-semibold">Service exceptions cleared</p><p className="mt-1 text-xs text-[var(--ink-faint)]">The simulated service remains active.</p></div> : null}
            </div>
          </section>

          <section>
            <SectionHeading eyebrow="Five-month context" title="Compared with prior Saturdays" />
            <div className="space-y-4 rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] p-4 shadow-[var(--shadow-card)]">
              {[
                ["Cover pace", "+12%", "Ahead of the 145-cover average"],
                ["Net sales pace", "+8%", "Average check is carrying the gain"],
                ["Ticket time", "+6 min", "Entrée station is the current constraint"],
                ["Guest recovery", "1 open", "Manager touch requested at table 9"],
              ].map(([label, value, note]) => (
                <div key={label} className="flex items-start justify-between gap-4 border-b border-[var(--line)] pb-4 last:border-0 last:pb-0">
                  <div><p className="text-sm font-semibold">{label}</p><p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">{note}</p></div>
                  <p className="numeric shrink-0 text-sm font-semibold">{value}</p>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </PageFrame>
  );
}

const employeeOpenShifts = [
  { id: "open-tue", day: "Tue · Aug 11", time: "5:00–11:00 PM", role: "Server", covers: 72 },
  { id: "open-fri", day: "Fri · Aug 14", time: "4:30–11:30 PM", role: "Server", covers: 86 },
];

function EmployeeTodayWorkspace() {
  const workspace = useWorkspaceContext();
  const [requestedShift, setRequestedShift] = useState<string | null>(null);
  const firstName = workspace.identity.displayName.trim().split(/\s+/)[0] || "there";

  return (
    <PageFrame>
      <section className="relative overflow-hidden rounded-[30px] border border-white/[0.08] bg-[var(--graphite)] px-5 py-7 text-white shadow-[var(--shadow-raised)] sm:px-8 sm:py-9">
        <div className="absolute inset-0 workspace-grid opacity-20" />
        <div className="relative flex flex-col justify-between gap-7 xl:flex-row xl:items-end">
          <div className="max-w-xl">
            <p className="text-xs font-semibold tracking-[0.14em] text-[#dfa14a] uppercase">Your shift</p>
            <h2 className="mt-4 text-[clamp(2rem,4.2vw,4rem)] leading-none font-medium tracking-[-0.065em]">Good afternoon, {firstName}.</h2>
            <p className="mt-4 text-sm leading-6 text-white/55">Le Yard · Server · Tonight, 4:00–11:00 PM</p>
          </div>
          <div className="flex items-end gap-8 border-t border-white/10 pt-5 xl:border-0 xl:pt-0">
            <div>
              <p className="text-xs tracking-[0.12em] text-white/55 uppercase">Covers on your shift</p>
              <p className="numeric mt-2 text-3xl font-medium tracking-[-0.05em]">86</p>
            </div>
            <div>
              <p className="text-xs tracking-[0.12em] text-white/55 uppercase">Local time</p>
              <p className="mt-2 text-2xl font-medium tracking-[-0.05em]"><LiveClock /></p>
            </div>
          </div>
        </div>
      </section>

      <div className="mt-8 grid gap-8 xl:grid-cols-[1.2fr_.8fr]">
        <section>
          <div className="flex items-end justify-between gap-3">
            <SectionHeading eyebrow="Priority" title="Open shifts & swaps" detail="Ask to pick up a shift; an owner or manager approves it." className="mb-0" />
            <Link href="/schedule" className="focus-ring hidden items-center gap-1 text-xs font-semibold text-[var(--accent-strong)] sm:flex">Open schedule <ArrowRight className="size-3" /></Link>
          </div>
          <div className="mt-4 overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] shadow-[var(--shadow-card)]">
            {employeeOpenShifts.map((shift) => {
              const requested = requestedShift === shift.id;
              return (
                <div key={shift.id} className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] px-3 py-4 first:border-0">
                  <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]"><CalendarDays className="size-4" /></span>
                  <div className="min-w-0 flex-1"><p className="text-sm font-semibold">{shift.day} · {shift.role}</p><p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">{shift.time} · {shift.covers} covers scheduled</p></div>
                  {requested ? <StatusPill tone="warning">Pending approval</StatusPill> : <Button variant="secondary" size="sm" onClick={() => setRequestedShift(shift.id)}>Ask to pick up</Button>}
                </div>
              );
            })}
          </div>
        </section>

        <section>
          <div className="flex items-end justify-between gap-3"><SectionHeading eyebrow="Pay" title="This week" detail="Tips and hourly pay update after approval." className="mb-0" /><WalletCards className="mb-1 size-5 text-[var(--accent)]" /></div>
          <div className="mt-4 overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] shadow-[var(--shadow-card)]">
            <div className="flex items-baseline justify-between gap-3 px-4 py-5"><span className="text-xs text-[var(--ink-faint)]">Estimated earned</span><span className="numeric text-2xl font-semibold tracking-[-0.04em]">$464.40</span></div>
            <div className="grid grid-cols-3 divide-x divide-[var(--line)] border-t border-[var(--line)] bg-[var(--paper)]"><div className="px-4 py-4"><p className="numeric text-base font-semibold">22.5h</p><p className="mt-1 text-xs text-[var(--ink-faint)]">Hours</p></div><div className="px-4 py-4"><p className="numeric text-base font-semibold">$104</p><p className="mt-1 text-xs text-[var(--ink-faint)]">Tips</p></div><div className="px-4 py-4"><p className="numeric text-base font-semibold">$360</p><p className="mt-1 text-xs text-[var(--ink-faint)]">Hourly</p></div></div>
          </div>
          <Link href="/earnings" className="focus-ring mt-4 flex items-center justify-between border-b border-[var(--line)] pb-3 text-[13px] font-semibold">View earnings & paystubs <ArrowRight className="size-3.5 text-[var(--accent-strong)]" /></Link>
        </section>
      </div>

      <section className="mt-8">
        <div className="flex items-end justify-between gap-3"><SectionHeading eyebrow="Your week" title="Upcoming shifts" detail="Release a shift from the schedule when you need coverage." className="mb-0" /><Link href="/schedule" className="focus-ring text-xs font-semibold text-[var(--accent-strong)]">Manage availability</Link></div>
        <div className="mt-4 overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] shadow-[var(--shadow-card)]">
          {[{ day: "Tonight · Aug 8", time: "4:00–11:00 PM", covers: 86 }, { day: "Sat · Aug 9", time: "4:30–11:30 PM", covers: 74 }].map((shift, index) => (
            <div key={shift.day} className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] px-4 py-4 first:border-0"><span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)] text-[var(--ink-faint)]"><CalendarDays className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{shift.day}</p><p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">{shift.time} · {shift.covers} covers scheduled</p></div>{index === 0 ? <StatusPill tone="positive">Confirmed</StatusPill> : <StatusPill tone="neutral">Published</StatusPill>}</div>
          ))}
        </div>
      </section>
    </PageFrame>
  );
}

function ChefTodayWorkspace() {
  const workspace = useWorkspaceContext();
  const firstName = workspace.identity.displayName.trim().split(/\s+/)[0] || "Chef";
  return (
    <PageFrame>
      <section className="relative overflow-hidden rounded-[30px] border border-white/[0.08] bg-[var(--graphite)] px-5 py-7 text-white shadow-[var(--shadow-raised)] sm:px-8 sm:py-9">
        <div className="absolute inset-0 workspace-grid opacity-20" />
        <div className="relative flex flex-col justify-between gap-7 xl:flex-row xl:items-end"><div><p className="text-xs font-semibold tracking-[0.14em] text-[#dfa14a] uppercase">Kitchen today</p><h2 className="mt-4 text-[clamp(2rem,4.2vw,4rem)] leading-none font-medium tracking-[-0.065em]">Good afternoon, {firstName}.</h2><p className="mt-4 text-sm leading-6 text-white/55">Le Yard · Back of house · Friday service</p></div><div className="flex items-end gap-8 border-t border-white/10 pt-5 xl:border-0 xl:pt-0"><div><p className="text-xs tracking-[0.12em] text-white/55 uppercase">Covers tonight</p><p className="numeric mt-2 text-3xl font-medium tracking-[-0.05em]">86</p></div><div><p className="text-xs tracking-[0.12em] text-white/55 uppercase">Line status</p><p className="mt-2 text-2xl font-medium tracking-[-0.05em]">Ready</p></div></div></div>
      </section>
      <div className="mt-8 grid gap-8 xl:grid-cols-[1.2fr_.8fr]"><section><div className="flex items-end justify-between gap-3"><SectionHeading eyebrow="Priority" title="Kitchen worklist" detail="Today’s kitchen priorities." className="mb-0" /><Link href="/kitchen" className="focus-ring hidden items-center gap-1 text-xs font-semibold text-[var(--accent-strong)] sm:flex">Open kitchen <ArrowRight className="size-3" /></Link></div><div className="mt-4 overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] shadow-[var(--shadow-card)]">{[{ title: "Publish BOH schedule", detail: "Saturday prep coverage has one open shift", tone: "warning" as const }, { title: "Review filet au poivre spec", detail: "Portion cost changes with the 180 g filet", tone: "neutral" as const }, { title: "Check produce count", detail: "Roma tomatoes and basil need a count before prep", tone: "positive" as const }].map((item) => <div key={item.title} className="flex items-center gap-3 border-t border-[var(--line)] px-4 py-4 first:border-0"><span className={cn("size-2 rounded-full", item.tone === "warning" ? "bg-[var(--warning)]" : item.tone === "positive" ? "bg-[var(--positive)]" : "bg-[var(--accent)]")} /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{item.title}</p><p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">{item.detail}</p></div><ChevronRight className="size-4 text-[var(--ink-faint)]" /></div>)}</div></section><section><SectionHeading eyebrow="Menu costing" title="Recipes to review" detail="Portion specs and current prices." /><div className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] shadow-[var(--shadow-card)]"><div className="flex items-center justify-between border-t border-[var(--line)] px-4 py-4 first:border-0"><div><p className="text-sm font-semibold">Filet au poivre</p><p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">180 g filet · sauce · fries</p></div><StatusPill tone="warning">Adjust</StatusPill></div><div className="flex items-center justify-between border-t border-[var(--line)] px-4 py-4"><div><p className="text-sm font-semibold">Tomato toast</p><p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">Yield and ingredient costs current</p></div><StatusPill tone="positive">Costed</StatusPill></div></div></section></div>
    </PageFrame>
  );
}

export function TodayWorkspace() {
  const workspace = useWorkspaceContext();
  const [actions, setActions] = useState(initialActions);
  const firstName = workspace.identity.displayName.trim().split(/\s+/)[0] || "there";

  if (workspace.role === "employee") return <EmployeeTodayWorkspace />;
  if (workspace.persona === "chef") return <ChefTodayWorkspace />;
  if (isSaturdayServicePreview) return <SaturdayServiceTodayWorkspace firstName={firstName} />;

  return (
    <PageFrame>
      <section className="relative overflow-hidden rounded-[30px] border border-white/[0.08] bg-[var(--graphite)] px-5 py-7 text-white shadow-[var(--shadow-raised)] sm:px-8 sm:py-9">
        <div className="absolute inset-0 workspace-grid opacity-20" />
        <div className="relative flex flex-col justify-between gap-8 xl:flex-row xl:items-end">
          <div className="max-w-xl">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="positive" dot className="bg-white/[0.08] text-[#93d0ad]">
                Ready for live data
              </StatusPill>
              <span className="text-xs text-white/55">Le Yard · main dining room</span>
            </div>
            <h2 className="mt-5 text-[clamp(2rem,4.2vw,4rem)] leading-none font-medium tracking-[-0.065em]">
              Good afternoon, {firstName}.
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-6 text-white/55">
              Live sales, reservations, receipts, and inventory will appear here as Toast, Resy, and vendor data are connected.
            </p>
          </div>
          <div className="flex items-end gap-10 border-t border-white/10 pt-5 xl:border-0 xl:pt-0">
            <div>
              <p className="text-xs tracking-[0.12em] text-white/55 uppercase">Local time</p>
              <p className="mt-2 text-2xl font-medium tracking-[-0.05em]">
                <LiveClock />
              </p>
            </div>
            <div>
              <p className="text-xs tracking-[0.12em] text-white/55 uppercase">Doors</p>
              <p className="numeric mt-2 text-2xl font-medium tracking-[-0.05em]">6:00 PM</p>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="Today’s key metrics" className="mt-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric className="rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] !px-4 shadow-[var(--shadow-card)]" label="Covers" value="—" detail="Connect Resy to import reservations" />
        <Metric className="rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] !px-4 shadow-[var(--shadow-card)]" label="Scheduled labor" value="—" detail="Publish a live schedule" />
        <Metric className="rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] !px-4 shadow-[var(--shadow-card)]" label="Projected sales" value="—" detail="Connect Toast to import sales" />
        <Metric className="rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] !px-4 shadow-[var(--shadow-card)]" label="Prep complete" value="—" detail="No checklist data yet" />
      </section>

      <div className="mt-8 grid gap-8 xl:grid-cols-[1.45fr_.8fr] xl:gap-12">
        <section>
          <SectionHeading
            eyebrow="Live service"
            title="Who’s on"
            detail={`${team.length} real users in this playground account set`}
            action={<Link href="/vendors" className="focus-ring inline-flex min-h-9 items-center gap-1 rounded-xl px-3 text-xs font-semibold text-[var(--accent-strong)] hover:bg-[var(--canvas-strong)]">Open vendors <ArrowRight className="size-3" /></Link>}
          />
          <div className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] shadow-[var(--shadow-card)]">
            <div className="grid grid-cols-[1fr_auto] items-center bg-[var(--canvas-strong)] px-4 py-3 text-xs font-semibold tracking-[0.1em] text-[var(--ink-faint)] uppercase sm:grid-cols-[1fr_110px_110px]">
              <span>Team member</span>
              <span className="hidden sm:block">Shift</span>
              <span className="text-right">Status</span>
            </div>
            {team.map((person, index) => (
              <button key={person.name} className="focus-ring grid w-full grid-cols-[1fr_auto] items-center gap-4 border-t border-[var(--line)] px-4 py-3.5 text-left transition-colors first:border-0 hover:bg-[var(--paper)] sm:grid-cols-[1fr_110px_110px]">
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={person.name} index={index} />
                  <span className="min-w-0">
                    <span className="block truncate text-sm font-semibold text-[var(--ink)]">{person.name}</span>
                    <span className="mt-1 block truncate text-xs text-[var(--ink-faint)]">{person.role}</span>
                  </span>
                </span>
                <span className="numeric hidden text-xs text-[var(--ink-faint)] sm:block">{person.start}–{person.end}</span>
                <span className="flex justify-end">
                  <StatusPill tone={person.status === "on_shift" ? "positive" : "neutral"} dot={person.status === "on_shift"}>
                    {person.status === "on_shift" ? "On shift" : `Starts ${person.start}`}
                  </StatusPill>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-9 grid gap-8 md:grid-cols-2">
            <section>
              <SectionHeading eyebrow="Run of show" title="Before doors" detail={`Local time · ${workspace.activeLocation.name}`} />
              <ol className="relative rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] px-5 py-5 shadow-[var(--shadow-card)] before:absolute before:top-6 before:bottom-6 before:left-[23px] before:w-px before:bg-[var(--line-strong)]">
                {[
                  ["Before service", "Lineup & allergy review", "Managers"],
                  ["Before service", "Family meal", "Mateo"],
                  ["Before service", "Drawer and vendor checks", "Donald · Maris"],
                  ["Before service", "Pre-shift huddle", "All staff"],
                ].map(([time, title, owner], index) => (
                  <li key={title} className="relative pl-8 pb-5 last:pb-0">
                    <span className={cn("absolute top-1 left-[-1px] size-2 rounded-full ring-4 ring-[var(--paper-strong)]", index === 0 ? "bg-[var(--accent)]" : "bg-[var(--line-strong)]")} />
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-xs font-semibold">{title}</p>
                      <time className="numeric text-xs text-[var(--ink-faint)]">{time}</time>
                    </div>
                    <p className="mt-1 text-xs text-[var(--ink-faint)]">{owner}</p>
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <SectionHeading eyebrow="Reservations" title="Pacing" detail="No Resy feed connected" />
              <div className="rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] px-5 py-8 text-center text-sm text-[var(--ink-faint)] shadow-[var(--shadow-card)]">Connect Resy to see covers by service window.</div>
              <div className="mt-4 flex items-start gap-3 rounded-2xl bg-[var(--positive-soft)] px-4 py-3.5 text-xs leading-5 text-[var(--positive)]">
                <Sparkles className="mt-0.5 size-3.5 shrink-0" />
                This dashboard stays empty until live service data is connected.
              </div>
            </section>
          </div>
        </section>

        <aside>
          <SectionHeading
            eyebrow="Needs action"
            title={actions.length ? `${actions.length} decisions` : "All clear"}
            detail="Nothing is finalized without your approval"
          />
          <div className="overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] shadow-[var(--shadow-card)]">
            <AnimatePresence initial={false}>
              {actions.map((action) => {
                const Icon = action.icon;
                return (
                  <motion.div key={action.id} layout exit={{ opacity: 0, height: 0 }} className="border-b border-[var(--line)] last:border-0">
                    <button className="focus-ring group flex w-full items-start gap-3 px-1 py-4 text-left">
                      <span className={cn("mt-0.5 flex size-8 shrink-0 items-center justify-center rounded-xl", action.tone === "danger" ? "bg-[var(--danger-soft)] text-[var(--danger)]" : "bg-[var(--warning-soft)] text-[var(--warning)]")}>
                        <Icon className="size-3.5" />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-sm font-semibold leading-5">{action.title}</span>
                        <span className="mt-1 block text-xs leading-5 text-[var(--ink-faint)]">{action.detail}</span>
                      </span>
                      <ChevronRight className="mt-2 size-3.5 text-[var(--ink-faint)] transition-transform group-hover:translate-x-0.5" />
                    </button>
                    <div className="flex justify-end gap-2 pb-3">
                      <Button variant="quiet" size="sm">Review</Button>
                      <Button variant="secondary" size="sm" onClick={() => setActions((current) => current.filter((item) => item.id !== action.id))}>
                        <Check className="size-3" /> Resolve
                      </Button>
                    </div>
                  </motion.div>
                );
              })}
            </AnimatePresence>
            {!actions.length ? (
              <div className="flex flex-col items-center px-5 py-10 text-center">
                <span className="flex size-10 items-center justify-center rounded-full bg-[var(--positive-soft)] text-[var(--positive)]"><Check className="size-4" /></span>
                <p className="mt-3 text-sm font-semibold">No open decisions</p>
                <p className="mt-1 text-xs text-[var(--ink-faint)]">We’ll surface the next exception here.</p>
              </div>
            ) : null}
          </div>

          <section className="mt-9">
            <SectionHeading eyebrow="Service pulse" title="Tonight at a glance" />
            <div className="space-y-5 rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] p-4 shadow-[var(--shadow-card)]">
              {[
                { icon: UsersRound, label: "Team confirmations", value: "—", note: "Publish a schedule to collect acknowledgements" },
                { icon: Utensils, label: "Menu readiness", value: "—", note: "Add kitchen checklists when ready" },
                { icon: AlertTriangle, label: "Guest notes", value: "—", note: "Connect Resy to import guest context" },
              ].map((item) => (
                <div key={item.label} className="flex items-start gap-3">
                  <item.icon className="mt-0.5 size-4 text-[var(--ink-faint)]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-sm font-semibold">{item.label}</p>
                      <p className="numeric text-sm font-semibold">{item.value}</p>
                    </div>
                    <p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">{item.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </section>
        </aside>
      </div>
    </PageFrame>
  );
}
