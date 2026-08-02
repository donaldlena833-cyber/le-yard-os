"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  ArrowRight,
  Check,
  ChevronRight,
  CircleDollarSign,
  Clock3,
  CloudSun,
  PackageSearch,
  Sparkles,
  UsersRound,
  Utensils,
} from "lucide-react";
import { useState } from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { LiveClock } from "@/components/today/live-clock";
import { cn } from "@/lib/utils";

const team = [
  { name: "Maya Chen", role: "Floor lead", start: "4:00", end: "11:30", status: "clocked" },
  { name: "Eli Brooks", role: "Bartender", start: "4:30", end: "12:00", status: "clocked" },
  { name: "Sofia Vega", role: "Server", start: "5:00", end: "11:00", status: "next" },
  { name: "Noah Martin", role: "Line cook", start: "3:00", end: "11:00", status: "clocked" },
  { name: "Ava Scott", role: "Host", start: "5:00", end: "10:00", status: "next" },
];

const initialActions = [
  { id: "a1", tone: "danger", title: "Approve Maya’s missed clock-out", detail: "Friday dinner · suggested 11:42 PM", icon: Clock3 },
  { id: "a2", tone: "warning", title: "Review 3 extracted receipts", detail: "$1,284.16 pending categorization", icon: CircleDollarSign },
  { id: "a3", tone: "warning", title: "Japanese whisky below par", detail: "2.4 bottles on hand · par is 5", icon: PackageSearch },
];

export function TodayWorkspace() {
  const workspace = useWorkspaceContext();
  const [actions, setActions] = useState(initialActions);
  const firstName = workspace.identity.displayName.trim().split(/\s+/)[0] || "there";

  return (
    <PageFrame>
      <section className="relative overflow-hidden rounded-[26px] bg-[var(--graphite)] px-5 py-6 text-white sm:px-7 sm:py-7 lg:px-8">
        <div className="absolute inset-0 workspace-grid opacity-20" />
        <div className="relative flex flex-col justify-between gap-8 xl:flex-row xl:items-end">
          <div className="max-w-xl">
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill tone="positive" dot className="bg-white/[0.08] text-[#93d0ad]">
                Prep on track
              </StatusPill>
              <span className="flex items-center gap-1.5 text-[10px] text-white/55">
                <CloudSun className="size-3.5" /> 78° · Patio ready
              </span>
            </div>
            <h2 className="mt-5 text-[clamp(2rem,4.2vw,4rem)] leading-none font-medium tracking-[-0.065em]">
              Good afternoon, {firstName}.
            </h2>
            <p className="mt-4 max-w-lg text-sm leading-6 text-white/55">
              Dinner has 86 covers on the books. Two approvals and one stock decision need you before doors.
            </p>
          </div>
          <div className="flex items-end gap-10 border-t border-white/10 pt-5 xl:border-0 xl:pt-0">
            <div>
              <p className="text-[9px] tracking-[0.14em] text-white/55 uppercase">Local time</p>
              <p className="mt-2 text-2xl font-medium tracking-[-0.05em]">
                <LiveClock />
              </p>
            </div>
            <div>
              <p className="text-[9px] tracking-[0.14em] text-white/55 uppercase">Doors</p>
              <p className="numeric mt-2 text-2xl font-medium tracking-[-0.05em]">6:00 PM</p>
            </div>
          </div>
        </div>
      </section>

      <section aria-label="Today’s key metrics" className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-b border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Covers" value="86" detail="72 booked · 14 walk-in hold" trend={{ label: "+12%", tone: "positive" }} />
        <Metric label="Scheduled labor" value="71.5h" detail="$1,486 estimated" trend={{ label: "22.4%", tone: "neutral" }} />
        <Metric label="Projected sales" value="$6.8k" detail="$79 per cover" trend={{ label: "+$640", tone: "positive" }} />
        <Metric label="Prep complete" value="92%" detail="4 of 48 items open" trend={{ label: "On time", tone: "positive" }} />
      </section>

      <div className="mt-8 grid gap-8 xl:grid-cols-[1.45fr_.8fr] xl:gap-12">
        <section>
          <SectionHeading
            eyebrow="Live service"
            title="Who’s on"
            detail="11 scheduled · 7 clocked in · no late arrivals"
            action={<Button variant="quiet" size="sm">Open time clock <ArrowRight className="size-3" /></Button>}
          />
          <div className="overflow-hidden border-y border-[var(--line)]">
            <div className="grid grid-cols-[1fr_auto] items-center bg-[var(--canvas-strong)] px-4 py-2.5 text-[9px] font-semibold tracking-[0.12em] text-[var(--ink-faint)] uppercase sm:grid-cols-[1fr_110px_110px]">
              <span>Team member</span>
              <span className="hidden sm:block">Shift</span>
              <span className="text-right">Status</span>
            </div>
            {team.map((person, index) => (
              <button key={person.name} className="focus-ring grid w-full grid-cols-[1fr_auto] items-center gap-4 border-t border-[var(--line)] px-4 py-3.5 text-left transition-colors first:border-0 hover:bg-[var(--paper)] sm:grid-cols-[1fr_110px_110px]">
                <span className="flex min-w-0 items-center gap-3">
                  <Avatar name={person.name} index={index} />
                  <span className="min-w-0">
                    <span className="block truncate text-xs font-semibold text-[var(--ink)]">{person.name}</span>
                    <span className="mt-1 block truncate text-[10px] text-[var(--ink-faint)]">{person.role}</span>
                  </span>
                </span>
                <span className="numeric hidden text-[10px] text-[var(--ink-faint)] sm:block">{person.start}–{person.end}</span>
                <span className="flex justify-end">
                  <StatusPill tone={person.status === "clocked" ? "positive" : "neutral"} dot={person.status === "clocked"}>
                    {person.status === "clocked" ? "Clocked in" : `Starts ${person.start}`}
                  </StatusPill>
                </span>
              </button>
            ))}
          </div>

          <div className="mt-9 grid gap-8 md:grid-cols-2">
            <section>
              <SectionHeading eyebrow="Run of show" title="Before doors" detail={`Local time · ${workspace.activeLocation.name}`} />
              <ol className="relative ml-2 border-l border-[var(--line-strong)] pl-5">
                {[
                  ["4:15", "Lineup & allergy review", "Maya"],
                  ["4:45", "Family meal", "Kitchen"],
                  ["5:15", "Bar count & cash drawers", "Eli"],
                  ["5:40", "Pre-shift huddle", "All staff"],
                ].map(([time, title, owner], index) => (
                  <li key={title} className="relative pb-5 last:pb-0">
                    <span className={cn("absolute top-1 -left-[24.5px] size-2 rounded-full ring-4 ring-[var(--canvas)]", index === 0 ? "bg-[var(--accent)]" : "bg-[var(--line-strong)]")} />
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-xs font-semibold">{title}</p>
                      <time className="numeric text-[10px] text-[var(--ink-faint)]">{time}</time>
                    </div>
                    <p className="mt-1 text-[10px] text-[var(--ink-faint)]">{owner}</p>
                  </li>
                ))}
              </ol>
            </section>

            <section>
              <SectionHeading eyebrow="Reservations" title="Pacing" detail="From Resy import · 2:10 PM" />
              <div className="space-y-3">
                {[
                  ["6 PM", 22, 45],
                  ["7 PM", 38, 76],
                  ["8 PM", 31, 62],
                  ["9 PM", 17, 34],
                ].map(([time, covers, width]) => (
                  <div key={time} className="grid grid-cols-[42px_1fr_28px] items-center gap-3">
                    <span className="numeric text-[10px] text-[var(--ink-faint)]">{time}</span>
                    <span className="h-1.5 overflow-hidden rounded-full bg-[var(--canvas-strong)]">
                      <motion.span initial={{ width: 0 }} animate={{ width: `${width}%` }} transition={{ duration: 0.7 }} className="block h-full rounded-full bg-[var(--accent)]" />
                    </span>
                    <span className="numeric text-right text-[10px] font-semibold">{covers}</span>
                  </div>
                ))}
              </div>
              <div className="mt-6 flex items-start gap-3 rounded-xl bg-[var(--positive-soft)] px-3.5 py-3 text-[10px] leading-4 text-[var(--positive)]">
                <Sparkles className="mt-0.5 size-3.5 shrink-0" />
                Pacing looks balanced. The 7:30 turn is the only compressed window.
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
          <div className="border-y border-[var(--line)]">
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
                        <span className="block text-xs font-semibold leading-5">{action.title}</span>
                        <span className="mt-1 block text-[10px] leading-4 text-[var(--ink-faint)]">{action.detail}</span>
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
                <p className="mt-3 text-xs font-semibold">No open decisions</p>
                <p className="mt-1 text-[10px] text-[var(--ink-faint)]">We’ll surface the next exception here.</p>
              </div>
            ) : null}
          </div>

          <section className="mt-9">
            <SectionHeading eyebrow="Service pulse" title="Tonight at a glance" />
            <div className="space-y-4 border-y border-[var(--line)] py-4">
              {[
                { icon: UsersRound, label: "Team confirmations", value: "10 / 11", note: "Ava hasn’t opened the schedule" },
                { icon: Utensils, label: "Menu readiness", value: "4 open", note: "Two prep, two vendor items" },
                { icon: AlertTriangle, label: "Guest notes", value: "7", note: "3 allergies · 2 VIPs · 2 birthdays" },
              ].map((item) => (
                <div key={item.label} className="flex items-start gap-3">
                  <item.icon className="mt-0.5 size-4 text-[var(--ink-faint)]" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-baseline justify-between gap-3">
                      <p className="text-[11px] font-semibold">{item.label}</p>
                      <p className="numeric text-[11px] font-semibold">{item.value}</p>
                    </div>
                    <p className="mt-1 text-[9px] leading-4 text-[var(--ink-faint)]">{item.note}</p>
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
