"use client";

import { AlertTriangle, MapPin, RefreshCw } from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { clockInAction, clockOutAction, endBreakAction, startBreakAction } from "@/app/actions/workflows/time";
import { RealtimeSyncStatus } from "@/components/realtime/realtime-sync-status";
import { Button } from "@/components/ui/button";
import { PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type { LiveTimeClockModel } from "@/data/read-models/time-clock";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { useRealtimeInvalidation, type RealtimeInvalidationBinding } from "@/lib/realtime/use-realtime-invalidation";

const bindings = [
  { table: "time_entries", scope: "location" },
  { table: "time_breaks", scope: "organization" },
] satisfies readonly RealtimeInvalidationBinding[];

function dateTimeLabel(value: string | null, timeZone: string) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", { timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }).format(new Date(value));
}

function CounterClock({ workspace, model }: { workspace: WorkspaceContextValue; model: LiveTimeClockModel }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState("");
  const [roleChoice, setRoleChoice] = useState("");
  const [breakChoice, setBreakChoice] = useState("");
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const scope = { organizationId: workspace.organization.id, locationId: workspace.activeLocation.id };
  const entry = model.activeEntry;
  const activeBreak = entry?.breaks.find((item) => item.endedAt === null);
  const roleId = model.roles.length === 1 ? model.roles[0].id : roleChoice;
  const externalEntry = entry && (entry.source !== "employee" || entry.sourceProvider);

  function record(action: () => Promise<{ ok: boolean; message?: string }>, confirmation: string, requestScope?: string) {
    startTransition(async () => {
      setMessage("");
      try {
        const response = await action();
        if (!response.ok) {
          setMessage(response.message ?? "The punch could not be recorded.");
          router.refresh();
          return;
        }
        if (requestScope) rotateRequestId(requestScope);
        setMessage(confirmation);
        setBreakChoice("");
        router.refresh();
      } catch {
        setMessage("The punch could not be confirmed. Refresh before trying again.");
      }
    });
  }

  function clockIn() {
    if (!model.roles.some((role) => role.id === roleId)) return;
    const now = Date.now();
    const shift = model.shifts.find((item) => item.jobRoleId === roleId &&
      ["scheduled", "claimed"].includes(item.status) && Date.parse(item.startsAt) <= now && Date.parse(item.endsAt) >= now);
    const payload = { ...scope, jobRoleId: roleId, scheduledShiftId: shift?.id ?? null };
    record(() => clockInAction({ ...payload, requestId: requestIdFor("time.clock_in", payload) }), "Clock-in recorded.", "time.clock_in");
  }

  function startBreak() {
    if (!entry || (breakChoice !== "paid" && breakChoice !== "unpaid")) return;
    const payload = { ...scope, timeEntryId: entry.id, isPaid: breakChoice === "paid" };
    record(() => startBreakAction({ ...payload, requestId: requestIdFor("time.break_start", payload) }), "Break started.", "time.break_start");
  }

  const selectClass = "focus-ring h-10 rounded-xl bg-[var(--paper-strong)] px-3 text-sm text-[var(--ink)]";
  return (
    <section aria-label="Record attendance" className="mt-5 rounded-[24px] bg-[var(--graphite)] p-6 text-white">
      <h3 className="text-lg font-medium">{activeBreak ? "On break" : entry ? "Clocked in" : "Clocked out"}</h3>
      {entry ? <p className="mt-2 text-sm text-white/70">{entry.jobName} · Since {dateTimeLabel(entry.clockedInAt, model.timeZone)}</p> : null}
      {!model.employee ? <p className="mt-3 text-sm text-white/70">Ask your manager to link your employee profile.</p> : null}
      {model.employee && !entry && !model.roles.length ? <p className="mt-3 text-sm text-white/70">Ask your manager to assign your job at this location.</p> : null}
      {externalEntry ? <p className="mt-3 text-sm text-white/70">Ask your manager about this open attendance record.</p> : null}
      <div className="mt-4 flex flex-wrap items-center gap-3">
        {model.employee && !entry && model.roles.length > 0 ? <>
          {model.roles.length > 1 ? <select aria-label="Job for this shift" value={roleChoice} onChange={(event) => setRoleChoice(event.target.value)} disabled={pending} className={selectClass}>
            <option value="">Choose your job</option>
            {model.roles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}
          </select> : null}
          <Button variant="accent" disabled={pending || !roleId} onClick={clockIn}>Clock in</Button>
        </> : null}
        {entry && !externalEntry && activeBreak ? (
          <Button variant="accent" disabled={pending} onClick={() => record(() => endBreakAction({ ...scope, breakId: activeBreak.id }), "Break ended.")}>End break</Button>
        ) : null}
        {entry && !externalEntry && !activeBreak ? <>
          <Button variant="accent" disabled={pending} onClick={() => record(() => clockOutAction({ ...scope, timeEntryId: entry.id }), "Clock-out recorded.")}>Clock out</Button>
          <select aria-label="Break type" value={breakChoice} onChange={(event) => setBreakChoice(event.target.value)} disabled={pending} className={selectClass}>
            <option value="">Choose break type</option>
            <option value="paid">Paid break</option>
            <option value="unpaid">Unpaid break</option>
          </select>
          <Button variant="secondary" disabled={pending || !breakChoice} onClick={startBreak}>Start break</Button>
        </> : null}
      </div>
      {message ? <p role="status" className="mt-3 text-sm text-white/80">{message}</p> : null}
    </section>
  );
}

export function LiveTimeClockWorkspace({ workspace, result }: {
  workspace: WorkspaceContextValue;
  result: LiveReadResult<LiveTimeClockModel>;
}) {
  const router = useRouter();
  const [refreshing, startRefresh] = useTransition();
  const nativeClock = workspace.serviceSettings?.serviceModel === "counter";
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
        <div>{nativeClock ? null : <StatusPill tone="warning">Setup pending</StatusPill>}<h2 className="mt-3 text-2xl font-medium">Time clock</h2><p className="mt-1 text-[13px] text-[var(--ink-faint)]">Recorded attendance for {workspace.activeLocation.name}</p></div>
        <div className="flex items-center gap-3"><span className="flex items-center gap-2 text-xs text-[var(--ink-faint)]"><MapPin className="size-3.5" />{model.timeZone}</span><Button variant="secondary" size="sm" disabled={refreshing} onClick={() => startRefresh(() => router.refresh())}><RefreshCw className="size-3.5" />Refresh</Button></div>
      </div>
      <RealtimeSyncStatus {...realtime} />
      {nativeClock ? <CounterClock key={workspace.activeLocation.id} workspace={workspace} model={model} /> : <section className="mt-5 rounded-[24px] bg-[var(--graphite)] p-6 text-white">
        <h3 className="text-lg font-medium">Attendance source not configured</h3>
        <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">The manager must confirm the timekeeping system and punch procedure before use. Square is the selected POS; attendance and payroll connections still require separate setup and acceptance.</p>
        <p className="mt-3 text-xs text-white/60">Current clock and break status are unavailable. Ask your manager how to record a shift or request a correction.</p>
      </section>}
      <section className="mt-8">
        <SectionHeading eyebrow={nativeClock ? undefined : "Retained attendance"} title="Your recent entries" detail={nativeClock ? undefined : "Historical records remain available. An open record does not establish current clock state."} />
        <div className="overflow-hidden rounded-[18px] bg-[var(--paper-strong)] shadow-[var(--shadow-card)]">
          {model.recentEntries.map(entry => <div key={entry.id} className="flex items-center justify-between gap-4 border-t border-[var(--line)] px-5 py-4 first:border-t-0"><div><p className="text-xs font-semibold">{entry.jobName}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{dateTimeLabel(entry.clockedInAt, model.timeZone)} – {dateTimeLabel(entry.clockedOutAt, model.timeZone)}</p></div><StatusPill size="sm">Recorded {entry.status}</StatusPill></div>)}
          {!model.recentEntries.length ? <p className="px-5 py-12 text-center text-xs text-[var(--ink-faint)]">No recorded entries are visible for your linked employee profile.</p> : null}
        </div>
      </section>
    </PageFrame>
  );
}
