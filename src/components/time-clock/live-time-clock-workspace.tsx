"use client";

import {
  AlertTriangle,
  BadgeCheck,
  Coffee,
  DatabaseZap,
  MapPin,
  RefreshCw,
  Timer,
  UsersRound,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState, useTransition } from "react";
import { RealtimeSyncStatus } from "@/components/realtime/realtime-sync-status";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type { LiveTimeClockModel } from "@/data/read-models/time-clock";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import {
  useRealtimeInvalidation,
  type RealtimeInvalidationBinding,
} from "@/lib/realtime/use-realtime-invalidation";

const timeClockRealtimeBindings = [
  { table: "time_entries", scope: "location" },
  { table: "time_breaks", scope: "organization" },
  { table: "integration_connections", scope: "location" },
  { table: "integration_sync_jobs", scope: "organization" },
] satisfies readonly RealtimeInvalidationBinding[];

const rosterTone = {
  clocked_in: "positive",
  on_break: "warning",
  scheduled: "neutral",
  exception: "danger",
} as const;

function useCurrentTime() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const initial = window.setTimeout(() => setNow(new Date()), 0);
    const timer = window.setInterval(() => setNow(new Date()), 30_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);
  return now;
}

function dateTimeLabel(value: string | null, timeZone: string) {
  if (!value) return "Not yet";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = Math.max(0, minutes % 60);
  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
}

function connectionTone(status: string, stale: boolean) {
  if (status === "connected" && !stale) return "positive" as const;
  if (status === "degraded" || stale) return "warning" as const;
  if (status === "disabled") return "danger" as const;
  return "neutral" as const;
}

export function LiveTimeClockWorkspace({
  workspace,
  result,
}: {
  workspace: WorkspaceContextValue;
  result: LiveReadResult<LiveTimeClockModel>;
}) {
  const router = useRouter();
  const now = useCurrentTime();
  const [isRefreshing, startRefresh] = useTransition();
  const model = result.ok ? result.data : null;
  const realtime = useRealtimeInvalidation({
    enabled: Boolean(model),
    channelName: `time-clock-${workspace.activeLocation.id}`,
    bindings: timeClockRealtimeBindings,
    organizationId: workspace.organization.id,
    locationId: workspace.activeLocation.id,
  });

  const recordedMinutes = useMemo(
    () => model?.recentEntries.reduce((sum, entry) => sum + entry.workedMinutes, 0) ?? 0,
    [model],
  );

  if (!result.ok || !model) {
    return (
      <PageFrame>
        <section className="mx-auto mt-[10svh] max-w-xl rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] p-8 text-center">
          <AlertTriangle className="mx-auto size-6 text-[var(--warning)]" />
          <h2 className="mt-4 text-xl font-medium">Time clock unavailable</h2>
          <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">
            The latest POS attendance snapshot could not be loaded safely. Punches still belong in Toast POS.
          </p>
        </section>
      </PageFrame>
    );
  }

  const activeBreak = model.activeEntry?.breaks.find((item) => !item.endedAt) ?? null;
  const sessionMinutes = model.activeEntry
    ? Math.max(
        0,
        Math.floor(
          ((now?.getTime() ?? new Date(model.activeEntry.clockedInAt).getTime()) -
            new Date(model.activeEntry.clockedInAt).getTime()) /
            60_000,
        ) - model.activeEntry.unpaidBreakMinutes,
      )
    : 0;
  const activeCount = model.roster.filter((row) =>
    ["clocked_in", "on_break", "exception"].includes(row.status),
  ).length;
  const syncTone = connectionTone(
    model.posSource.connectionStatus,
    model.posSource.stale,
  );
  const syncLabel =
    model.posSource.connectionStatus === "connected" && !model.posSource.stale
      ? "Toast synced"
      : model.posSource.connectionStatus === "not_configured"
        ? "Toast setup pending"
        : model.posSource.stale
          ? "Toast data may be stale"
          : `Toast ${model.posSource.connectionStatus}`;

  return (
    <PageFrame width="wide">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <StatusPill tone={syncTone} dot={syncTone === "positive"}>{syncLabel}</StatusPill>
            <span className="text-xs text-[var(--ink-faint)]">Read-only POS mirror</span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Time clock</h2>
          <p className="mt-1 text-[13px] text-[var(--ink-faint)]">
            Attendance from Toast Labor for {workspace.activeLocation.name}.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <span className="flex items-center gap-2 text-xs text-[var(--ink-faint)]">
            <MapPin className="size-3.5" />{model.timeZone}
          </span>
          <Button
            variant="secondary"
            size="sm"
            disabled={isRefreshing}
            onClick={() => startRefresh(() => router.refresh())}
          >
            <RefreshCw className={isRefreshing ? "size-3.5 animate-spin" : "size-3.5"} />
            Refresh
          </Button>
        </div>
      </div>
      <RealtimeSyncStatus {...realtime} />

      <section className="relative mt-5 overflow-hidden rounded-[26px] bg-[var(--graphite)] p-5 text-white sm:p-7 lg:p-8">
        <div className="absolute inset-0 workspace-grid opacity-20" />
        <div className="relative grid gap-7 lg:grid-cols-[1fr_.8fr] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                tone={model.activeEntry ? (activeBreak ? "warning" : "positive") : "neutral"}
                dot={Boolean(model.activeEntry && !activeBreak)}
                className="bg-white/[0.08] text-white"
              >
                {activeBreak ? "On break in Toast" : model.activeEntry ? "Clocked in on Toast" : "No open Toast punch"}
              </StatusPill>
              <span className="text-xs text-white/55">
                {model.employee?.displayName ?? "No linked employee profile"}
              </span>
            </div>
            <p className="mt-5 text-xs tracking-[.12em] text-white/55 uppercase">Current POS record</p>
            <p className="mt-2 text-[clamp(2rem,5vw,4rem)] leading-none font-medium tracking-[-0.06em]">
              {model.activeEntry ? durationLabel(sessionMinutes) : "Off the clock"}
            </p>
            <p className="mt-4 text-xs text-white/55">
              {model.activeEntry
                ? `${model.activeEntry.jobName} · in ${model.activeEntry.clockedInLabel}`
                : `${workspace.activeLocation.name} · ${model.date}`}
            </p>
          </div>
          <div className="rounded-[20px] border border-white/10 bg-white/[0.07] p-5 backdrop-blur-sm">
            <div className="flex items-start gap-3">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-2xl bg-white/10">
                <DatabaseZap className="size-5 text-[var(--accent)]" />
              </span>
              <div>
                <p className="text-sm font-semibold">Punch on the Toast POS</p>
                <p className="mt-1.5 text-xs leading-5 text-white/60">
                  Clock in, clock out, and start or end breaks on Toast. Le Yard OS imports those facts through the Labor API; it does not create or edit punches here.
                </p>
              </div>
            </div>
          </div>
        </div>
      </section>

      <section className="mt-3 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0" aria-label="Time clock metrics">
        <Metric label="Clocked in" value={String(activeCount)} detail={workspace.activeLocation.name} />
        <Metric label="On break" value={String(model.roster.filter((row) => row.status === "on_break").length)} detail="Reported by Toast" />
        <Metric label="Your entries" value={String(model.recentEntries.length)} detail="Most recent imported records" />
        <Metric label="Recent recorded" value={durationLabel(recordedMinutes)} detail="Visible POS entries" />
      </section>

      <div className="mt-8 grid gap-10 xl:grid-cols-[1.25fr_.75fr]">
        <section>
          {model.canManage ? (
            <>
              <SectionHeading
                eyebrow="Attendance"
                title="Today’s roster"
                detail={`${model.roster.length} scheduled or active team members; punch state comes from Toast`}
              />
              <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)]">
                {model.roster.map((row, index) => (
                  <div key={row.employeeId} className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-[var(--line)] px-4 py-3.5 first:border-t-0 sm:grid-cols-[1fr_130px_150px]">
                    <div className="flex min-w-0 items-center gap-3">
                      <Avatar name={row.employeeName} index={index} />
                      <div className="min-w-0">
                        <p className="truncate text-xs font-semibold">{row.employeeName}</p>
                        <p className="mt-1 truncate text-xs text-[var(--ink-faint)]">{row.jobName}</p>
                      </div>
                    </div>
                    <span className="numeric hidden text-xs text-[var(--ink-faint)] sm:block">{row.shiftLabel ?? "Unscheduled"}</span>
                    <StatusPill tone={rosterTone[row.status]}>{row.status.replaceAll("_", " ")}</StatusPill>
                  </div>
                ))}
                {!model.roster.length ? (
                  <p className="px-5 py-12 text-center text-xs text-[var(--ink-faint)]">No scheduled staff or imported open punches are visible.</p>
                ) : null}
              </div>
            </>
          ) : null}

          <div className={model.canManage ? "mt-9" : ""}>
            <SectionHeading
              eyebrow="POS history"
              title="Your recent entries"
              detail="For a missed or incorrect punch, correct the source record in Toast POS"
            />
            <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)]">
              {model.recentEntries.map((entry) => (
                <div key={entry.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-[var(--line)] px-4 py-3.5 first:border-t-0 sm:grid-cols-[1fr_120px_110px]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="text-xs font-semibold">{entry.jobName}</p>
                      {entry.sourceProvider === "toast" ? <StatusPill size="sm" tone="accent">Toast</StatusPill> : <StatusPill size="sm">Legacy</StatusPill>}
                    </div>
                    <p className="mt-1 text-xs text-[var(--ink-faint)]">
                      {dateTimeLabel(entry.clockedInAt, model.timeZone)}–{dateTimeLabel(entry.clockedOutAt, model.timeZone)}
                    </p>
                  </div>
                  <span className="numeric hidden text-xs text-[var(--ink-faint)] sm:block">{durationLabel(entry.workedMinutes)}</span>
                  <StatusPill tone={entry.status === "open" ? "positive" : "neutral"}>{entry.status}</StatusPill>
                </div>
              ))}
              {!model.recentEntries.length ? (
                <p className="px-5 py-12 text-center text-xs text-[var(--ink-faint)]">No Toast time entries are visible for your linked employee profile.</p>
              ) : null}
            </div>
          </div>
        </section>

        <aside>
          <SectionHeading eyebrow="Source health" title="Toast Labor API" detail="Read-only attendance integration" />
          <div className="rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)] p-5">
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-xs font-semibold"><BadgeCheck className="size-4 text-[var(--accent-strong)]" />Connection</span>
              <StatusPill tone={syncTone}>{model.posSource.connectionStatus.replaceAll("_", " ")}</StatusPill>
            </div>
            <dl className="mt-5 divide-y divide-[var(--line)] text-xs">
              <div className="flex justify-between gap-4 py-3"><dt className="text-[var(--ink-faint)]">Last API sync</dt><dd className="text-right font-medium">{dateTimeLabel(model.posSource.lastSyncedAt, model.timeZone)}</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-[var(--ink-faint)]">Last job</dt><dd className="text-right font-medium">{model.posSource.lastJobStatus?.replaceAll("_", " ") ?? "None"}</dd></div>
              <div className="flex justify-between gap-4 py-3"><dt className="text-[var(--ink-faint)]">Authority</dt><dd className="text-right font-medium">Toast POS</dd></div>
            </dl>
          </div>

          <div className="mt-5 space-y-3">
            <div className="flex gap-3 rounded-[16px] bg-[var(--canvas)] p-4 text-xs leading-5 text-[var(--ink-faint)]">
              <Timer className="mt-0.5 size-4 shrink-0 text-[var(--accent-strong)]" />
              <p>Open shifts and break state update after the next Labor API sync. Refreshing this page does not send a punch to Toast.</p>
            </div>
            <div className="flex gap-3 rounded-[16px] bg-[var(--canvas)] p-4 text-xs leading-5 text-[var(--ink-faint)]">
              <Coffee className="mt-0.5 size-4 shrink-0 text-[var(--accent-strong)]" />
              <p>Missed breaks and punch corrections must be handled in Toast so both systems keep one authoritative history.</p>
            </div>
            <div className="flex gap-3 rounded-[16px] bg-[var(--canvas)] p-4 text-xs leading-5 text-[var(--ink-faint)]">
              <UsersRound className="mt-0.5 size-4 shrink-0 text-[var(--accent-strong)]" />
              <p>Employee and job mappings must be unique. Ambiguous records are rejected and surfaced as a degraded sync instead of being guessed.</p>
            </div>
          </div>
        </aside>
      </div>
    </PageFrame>
  );
}
