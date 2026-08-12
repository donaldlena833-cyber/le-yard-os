"use client";

import { BadgeCheck, Coffee, DatabaseZap, MapPin, Timer, UsersRound } from "lucide-react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Avatar } from "@/components/ui/avatar";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";

const demoRoster = [
  { name: "Aisha R.", role: "Server", shift: "2:00 PM–10:00 PM", state: "clocked in" },
  { name: "Leo M.", role: "Bartender", shift: "3:00 PM–11:00 PM", state: "on break" },
  { name: "Priya S.", role: "Host", shift: "4:00 PM–10:00 PM", state: "scheduled" },
] as const;

export function TimeClockWorkspace() {
  const workspace = useWorkspaceContext();

  return (
    <PageFrame width="wide">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill tone="accent">Toast POS demo</StatusPill>
            <span className="text-xs text-[var(--ink-faint)]">Read-only mirror</span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Time clock</h2>
          <p className="mt-1 text-[13px] text-[var(--ink-faint)]">Attendance from Toast Labor for {workspace.activeLocation.name}.</p>
        </div>
        <span className="flex items-center gap-2 text-xs text-[var(--ink-faint)]"><MapPin className="size-3.5" />America/New_York</span>
      </div>

      <section className="relative mt-5 overflow-hidden rounded-[26px] bg-[var(--graphite)] p-5 text-white sm:p-7 lg:p-8">
        <div className="absolute inset-0 workspace-grid opacity-20" />
        <div className="relative grid gap-7 lg:grid-cols-[1fr_.8fr] lg:items-end">
          <div>
            <StatusPill tone="neutral" className="bg-white/[0.08] text-white">No live punch in demo</StatusPill>
            <p className="mt-5 text-xs tracking-[.12em] text-white/55 uppercase">Current POS record</p>
            <p className="mt-2 text-[clamp(2rem,5vw,4rem)] leading-none font-medium tracking-[-0.06em]">Off the clock</p>
            <p className="mt-4 text-xs text-white/55">Sample attendance only</p>
          </div>
          <div className="rounded-[20px] border border-white/10 bg-white/[0.07] p-5">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white/10"><DatabaseZap className="size-5 text-[var(--accent)]" /></span>
              <div><p className="text-sm font-semibold">Punch on the Toast POS</p><p className="mt-1.5 text-xs leading-5 text-white/60">Clock in, clock out, and manage breaks on Toast. Le Yard OS only displays the imported facts.</p></div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-3 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0" aria-label="Time clock metrics">
        <Metric label="Clocked in" value="2" detail="Demo roster" />
        <Metric label="On break" value="1" detail="Reported by Toast" />
        <Metric label="Imported entries" value="14" detail="Recent sample" />
        <Metric label="Recorded" value="37h 42m" detail="Visible POS entries" />
      </section>

      <div className="mt-8 grid gap-10 xl:grid-cols-[1.25fr_.75fr]">
        <section>
          <SectionHeading eyebrow="Attendance" title="Today’s roster" detail="Sample state shaped like the Toast Labor import" />
          <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)]">
            {demoRoster.map((row, index) => (
              <div key={row.name} className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-[var(--line)] px-4 py-3.5 first:border-t-0 sm:grid-cols-[1fr_130px_130px]">
                <div className="flex min-w-0 items-center gap-3"><Avatar name={row.name} index={index} /><div><p className="text-xs font-semibold">{row.name}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{row.role}</p></div></div>
                <span className="numeric hidden text-xs text-[var(--ink-faint)] sm:block">{row.shift}</span>
                <StatusPill tone={row.state === "clocked in" ? "positive" : row.state === "on break" ? "warning" : "neutral"}>{row.state}</StatusPill>
              </div>
            ))}
          </div>
        </section>

        <aside>
          <SectionHeading eyebrow="Source health" title="Toast Labor API" detail="Demo connection evidence" />
          <div className="rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)] p-5">
            <div className="flex items-center justify-between gap-3"><span className="flex items-center gap-2 text-xs font-semibold"><BadgeCheck className="size-4 text-[var(--accent-strong)]" />Connection</span><StatusPill tone="neutral">demo</StatusPill></div>
          </div>
          <div className="mt-5 space-y-3 text-xs leading-5 text-[var(--ink-faint)]">
            <p className="flex gap-3 rounded-[16px] bg-[var(--canvas)] p-4"><Timer className="mt-0.5 size-4 shrink-0" />Refreshing Le Yard OS never sends a punch to Toast.</p>
            <p className="flex gap-3 rounded-[16px] bg-[var(--canvas)] p-4"><Coffee className="mt-0.5 size-4 shrink-0" />Corrections and missed breaks belong in Toast POS.</p>
            <p className="flex gap-3 rounded-[16px] bg-[var(--canvas)] p-4"><UsersRound className="mt-0.5 size-4 shrink-0" />Live mappings fail closed when an employee or job is ambiguous.</p>
          </div>
        </aside>
      </div>
    </PageFrame>
  );
}
