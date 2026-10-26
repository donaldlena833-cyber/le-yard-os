"use client";

import { AlertTriangle, MapPin, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { RealtimeSyncStatus } from "@/components/realtime/realtime-sync-status";
import { Button } from "@/components/ui/button";
import { PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type { LiveTimeClockModel } from "@/data/read-models/time-clock";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { useRealtimeInvalidation, type RealtimeInvalidationBinding } from "@/lib/realtime/use-realtime-invalidation";

const bindings = [
  { table: "time_entries", scope: "location" },
  { table: "time_breaks", scope: "organization" },
] satisfies readonly RealtimeInvalidationBinding[];

function dateTimeLabel(value: string | null, timeZone: string) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

export function LiveTimeClockWorkspace({ workspace, result }: {
  workspace: WorkspaceContextValue;
  result: LiveReadResult<LiveTimeClockModel>;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const model = result.ok ? result.data : null;
  const realtime = useRealtimeInvalidation({ enabled: Boolean(model), channelName: `time-clock-${workspace.activeLocation.id}`, bindings, organizationId: workspace.organization.id, locationId: workspace.activeLocation.id });
  if (!result.ok || !model) return (
    <PageFrame><section className="mx-auto mt-[10svh] max-w-xl rounded-[24px] bg-[var(--paper-strong)] p-8 text-center">
      <AlertTriangle className="mx-auto size-6 text-[var(--warning)]" />
      <h2 className="mt-4 text-xl font-medium">Time clock unavailable</h2>
      <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">Recorded attendance could not be loaded safely. Contact your manager about attendance questions.</p>
    </section></PageFrame>
  );
  return (
    <PageFrame width="wide">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><StatusPill tone="warning">Setup pending</StatusPill><h2 className="mt-3 text-2xl font-medium">Time clock</h2><p className="mt-1 text-[13px] text-[var(--ink-faint)]">Recorded attendance for {workspace.activeLocation.name}</p></div>
        <div className="flex items-center gap-3"><span className="flex items-center gap-2 text-xs text-[var(--ink-faint)]"><MapPin className="size-3.5" />{model.timeZone}</span><Button variant="secondary" size="sm" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}><RefreshCw className="size-3.5" />Refresh</Button></div>
      </div>
      <RealtimeSyncStatus {...realtime} />
      <section className="mt-5 rounded-[24px] bg-[var(--graphite)] p-6 text-white">
        <h3 className="text-lg font-medium">Attendance source not configured</h3>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">The manager must confirm the timekeeping system and punch procedure before use. Square is the selected POS; attendance and payroll connections still require separate setup and acceptance.</p>
        <p className="mt-3 text-xs text-white/60">Current clock and break status are unavailable. Ask your manager how to record a shift or request a correction.</p>
      </section>
      <section className="mt-8">
        <SectionHeading eyebrow="Retained attendance" title="Your recent entries" detail="Historical records remain available. An open record does not establish current clock state." />
        <div className="overflow-hidden rounded-[18px] bg-[var(--paper-strong)] shadow-[var(--shadow-card)]">
          {model.recentEntries.map(entry => <div key={entry.id} className="flex items-center justify-between gap-4 border-t border-[var(--line)] px-5 py-4 first:border-t-0"><div><p className="text-xs font-semibold">{entry.jobName}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{dateTimeLabel(entry.clockedInAt, model.timeZone)} – {dateTimeLabel(entry.clockedOutAt, model.timeZone)}</p></div><StatusPill size="sm">Recorded {entry.status}</StatusPill></div>)}
          {!model.recentEntries.length ? <p className="px-5 py-12 text-center text-xs text-[var(--ink-faint)]">No recorded entries are visible for your linked employee profile.</p> : null}
        </div>
      </section>
    </PageFrame>
  );
}
