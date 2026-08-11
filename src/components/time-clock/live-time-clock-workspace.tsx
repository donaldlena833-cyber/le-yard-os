"use client";

import {
  AlertTriangle,
  Check,
  Coffee,
  FileClock,
  History,
  LoaderCircle,
  LogIn,
  LogOut,
  MapPin,
  PencilLine,
  ShieldCheck,
  TimerReset,
  UserRoundCheck,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useEffect, useMemo, useState } from "react";
import {
  approveTimeCorrectionAction,
  clockInAction,
  clockOutAction,
  endBreakAction,
  recordMissedTimeEntryAction,
  requestTimeCorrectionAction,
  startBreakAction,
} from "@/app/actions/workflows/time";
import { RealtimeSyncStatus } from "@/components/realtime/realtime-sync-status";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  LiveRosterRow,
  LiveTimeClockModel,
  LiveTimeEntry,
} from "@/data/read-models/time-clock";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import {
  useRealtimeInvalidation,
  type RealtimeInvalidationBinding,
} from "@/lib/realtime/use-realtime-invalidation";
import { cn } from "@/lib/utils";

const timeClockRealtimeBindings = [
  { table: "time_entries", scope: "location" },
  { table: "time_entry_corrections", scope: "location" },
] satisfies readonly RealtimeInvalidationBinding[];

function useCurrentTime() {
  const [now, setNow] = useState<Date | null>(null);
  useEffect(() => {
    const initial = window.setTimeout(() => setNow(new Date()), 0);
    const timer = window.setInterval(() => setNow(new Date()), 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);
  return now;
}

function clockLabel(value: Date | null, timeZone: string) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        timeZone,
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
      }).format(value)
    : "—:—:—";
}

function dateTimeLabel(value: string | null, timeZone: string) {
  if (!value) return "Not recorded";
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function localInputValue(value: string | null, timeZone: string) {
  if (!value) return "";
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat("en-US", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hourCycle: "h23",
    })
      .formatToParts(new Date(value))
      .map((part) => [part.type, part.value]),
  );
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}`;
}

function durationLabel(minutes: number) {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  return `${hours}h ${String(remainder).padStart(2, "0")}m`;
}

function ModalFrame({
  title,
  description,
  onClose,
  children,
}: {
  title: string;
  description: string;
  onClose: () => void;
  children: React.ReactNode;
}) {
  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 overflow-y-auto bg-black/30 px-3 py-6 backdrop-blur-[3px]"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-labelledby="time-dialog-title"
        aria-modal="true"
        role="dialog"
        className="mx-auto w-full max-w-xl rounded-[26px] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-float)] sm:p-7"
      >
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 id="time-dialog-title" className="text-xl font-medium tracking-[-0.04em]">
              {title}
            </h3>
            <p className="mt-1 max-w-md text-[13px] leading-5 text-[var(--ink-faint)]">
              {description}
            </p>
          </div>
          <Button variant="quiet" size="icon" aria-label="Close dialog" onClick={onClose}>
            <X className="size-4" />
          </Button>
        </div>
        {children}
      </section>
    </div>
  );
}

function CorrectionDialog({
  entry,
  model,
  busy,
  onClose,
  onSubmit,
}: {
  entry: LiveTimeEntry;
  model: LiveTimeClockModel;
  busy: boolean;
  onClose: () => void;
  onSubmit: (form: FormData) => void;
}) {
  return (
    <ModalFrame
      title="Request a punch correction"
      description="The original entry remains in the audit trail. Another manager must approve the request."
      onClose={onClose}
    >
      <form action={onSubmit} className="mt-6 grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="entryId" value={entry.id} />
        <label>
          <span className="mb-1.5 block text-xs font-semibold">Correct clock-in</span>
          <input
            name="clockedIn"
            type="datetime-local"
            defaultValue={localInputValue(entry.clockedInAt, model.timeZone)}
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"
          />
        </label>
        <label>
          <span className="mb-1.5 block text-xs font-semibold">Correct clock-out</span>
          <input
            name="clockedOut"
            type="datetime-local"
            defaultValue={localInputValue(entry.clockedOutAt, model.timeZone)}
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"
          />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1.5 block text-xs font-semibold">Job code</span>
          <select
            name="jobRoleId"
            defaultValue={entry.jobRoleId}
            className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"
          >
            <option value={entry.jobRoleId}>{entry.jobName}</option>
            {model.roles
              .filter((role) => role.id !== entry.jobRoleId)
              .map((role) => (
                <option key={role.id} value={role.id}>
                  {role.name}
                </option>
              ))}
          </select>
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1.5 block text-xs font-semibold">What happened?</span>
          <textarea
            required
            minLength={8}
            maxLength={2_000}
            name="reason"
            rows={4}
            placeholder="Add enough context for an independent manager to verify."
            className="w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs"
          />
        </label>
        <div className="sm:col-span-2 flex items-start gap-3 rounded-xl bg-[var(--canvas)] p-3.5 text-xs leading-4 text-[var(--ink-faint)]">
          <History className="mt-0.5 size-4 shrink-0" />
          <span>Times are interpreted in {model.timeZone}; the server records the requester and preserves the original values.</span>
        </div>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <PencilLine className="size-4" />}
            Submit request
          </Button>
        </div>
      </form>
    </ModalFrame>
  );
}

function MissedPunchDialog({
  row,
  model,
  workspace,
  busy,
  onClose,
  onSubmit,
}: {
  row: LiveRosterRow;
  model: LiveTimeClockModel;
  workspace: WorkspaceContextValue;
  busy: boolean;
  onClose: () => void;
  onSubmit: (form: FormData) => void;
}) {
  return (
    <ModalFrame
      title="Record a verified missed shift"
      description="This creates a manager-source corrected entry only after overlap, assignment, and tenant checks pass."
      onClose={onClose}
    >
      <form action={onSubmit} className="mt-6 grid gap-4 sm:grid-cols-2">
        <input type="hidden" name="employeeId" value={row.employeeId} />
        <input type="hidden" name="jobRoleId" value={row.jobRoleId} />
        <input type="hidden" name="shiftId" value={row.shiftId ?? ""} />
        <div className="sm:col-span-2 flex items-center gap-3 border-y border-[var(--line)] py-4">
          <Avatar name={row.employeeName} index={2} />
          <div><p className="text-xs font-semibold">{row.employeeName}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{row.jobName} · {workspace.activeLocation.name}</p></div>
        </div>
        <label>
          <span className="mb-1.5 block text-xs font-semibold">Verified clock-in</span>
          <input required name="clockedIn" type="datetime-local" defaultValue={localInputValue(row.shiftStartsAt, model.timeZone)} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" />
        </label>
        <label>
          <span className="mb-1.5 block text-xs font-semibold">Verified clock-out</span>
          <input required name="clockedOut" type="datetime-local" defaultValue={localInputValue(row.shiftEndsAt, model.timeZone)} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" />
        </label>
        <label className="sm:col-span-2">
          <span className="mb-1.5 block text-xs font-semibold">Verification note</span>
          <textarea required minLength={8} maxLength={2_000} name="reason" rows={4} placeholder="State how the shift was verified." className="w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs" />
        </label>
        <div className="flex justify-end gap-2 sm:col-span-2">
          <Button variant="quiet" onClick={onClose}>Cancel</Button>
          <Button type="submit" variant="accent" disabled={busy}>
            {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
            Record verified entry
          </Button>
        </div>
      </form>
    </ModalFrame>
  );
}

const rosterTone = {
  clocked_in: "positive",
  on_break: "warning",
  scheduled: "neutral",
  exception: "danger",
} as const;

export function LiveTimeClockWorkspace({
  workspace,
  result,
}: {
  workspace: WorkspaceContextValue;
  result: LiveReadResult<LiveTimeClockModel>;
}) {
  const router = useRouter();
  const now = useCurrentTime();
  const model = result.ok ? result.data : null;
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [breakPaid, setBreakPaid] = useState(false);
  const [selectedRoleId, setSelectedRoleId] = useState(model?.roles[0]?.id ?? "");
  const [selectedShiftId, setSelectedShiftId] = useState("");
  const [correctionEntryId, setCorrectionEntryId] = useState<string | null>(null);
  const [missedEmployeeId, setMissedEmployeeId] = useState<string | null>(null);
  const [selectedCorrectionId, setSelectedCorrectionId] = useState<string | null>(null);
  const [decisionNote, setDecisionNote] = useState("");
  const { requestIdFor, rotateRequestId } = useStableRequestIds();

  const realtime = useRealtimeInvalidation({
    enabled: Boolean(model),
    channelName: `time-clock-${workspace.activeLocation.id}`,
    bindings: timeClockRealtimeBindings,
    organizationId: workspace.organization.id,
    locationId: workspace.activeLocation.id,
  });

  const correctionEntry = model?.recentEntries.find((entry) => entry.id === correctionEntryId) ?? null;
  const missedRow = model?.roster.find((row) => row.employeeId === missedEmployeeId) ?? null;
  const pendingCorrections = model?.corrections.filter((item) => item.status === "pending") ?? [];
  const selectedCorrection =
    model?.corrections.find((item) => item.id === selectedCorrectionId) ??
    pendingCorrections[0] ??
    model?.corrections[0] ??
    null;
  const activeBreak = model?.activeEntry?.breaks.find((item) => !item.endedAt) ?? null;
  const selectedShift = model?.shifts.find((shift) => shift.id === selectedShiftId) ?? null;
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
          <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">Tenant-scoped attendance records could not be loaded safely. Retry before recording another punch.</p>
        </section>
      </PageFrame>
    );
  }

  async function perform(action: Promise<{ ok: boolean; message?: string }>, success: string) {
    setBusy(true);
    setNotice("");
    const response = await action;
    setBusy(false);
    if (!response.ok) {
      setNotice(response.message ?? "The timekeeping action could not be completed.");
      return false;
    }
    setNotice(success);
    router.refresh();
    return true;
  }

  async function submitCorrection(form: FormData) {
    if (!correctionEntry || !model) return;
    const clockedIn = String(form.get("clockedIn") || "");
    const clockedOut = String(form.get("clockedOut") || "");
    const jobRoleId = String(form.get("jobRoleId") || "");
    const originalIn = localInputValue(correctionEntry.clockedInAt, model.timeZone);
    const originalOut = localInputValue(correctionEntry.clockedOutAt, model.timeZone);
    const proposedClockedInLocal = clockedIn && clockedIn !== originalIn ? clockedIn : null;
    const proposedClockedOutLocal = clockedOut && clockedOut !== originalOut ? clockedOut : null;
    const proposedJobRoleId = jobRoleId !== correctionEntry.jobRoleId ? jobRoleId : null;
    if (!proposedClockedInLocal && !proposedClockedOutLocal && !proposedJobRoleId) {
      setNotice("Change at least one punch or job code before submitting.");
      return;
    }
    const scope = `time.correction.request:${correctionEntry.id}`;
    const payload = {
      timeEntryId: correctionEntry.id,
      proposedClockedInLocal,
      proposedClockedOutLocal,
      proposedJobRoleId,
      reason: String(form.get("reason") || ""),
    };
    const applied = await perform(
      requestTimeCorrectionAction({
        requestId: requestIdFor(scope, payload),
        ...payload,
      }),
      "Correction submitted for independent management review.",
    );
    if (applied) {
      rotateRequestId(scope);
      setCorrectionEntryId(null);
    }
  }

  async function submitMissedEntry(form: FormData) {
    const employeeId = String(form.get("employeeId") || "");
    const scheduledShiftId = String(form.get("shiftId") || "") || null;
    const scope = `time.missed-entry:${employeeId}:${scheduledShiftId ?? "unscheduled"}`;
    const payload = {
      locationId: workspace.activeLocation.id,
      employeeId,
      jobRoleId: String(form.get("jobRoleId") || ""),
      scheduledShiftId,
      clockedInLocal: String(form.get("clockedIn") || ""),
      clockedOutLocal: String(form.get("clockedOut") || ""),
      reason: String(form.get("reason") || ""),
    };
    const applied = await perform(
      recordMissedTimeEntryAction({
        requestId: requestIdFor(scope, payload),
        ...payload,
      }),
      "Verified missed shift recorded with manager-source audit evidence.",
    );
    if (applied) {
      rotateRequestId(scope);
      setMissedEmployeeId(null);
    }
  }

  async function submitClockIn() {
    const scope = "time.clock-in";
    const payload = {
      locationId: workspace.activeLocation.id,
      jobRoleId: selectedRoleId,
      scheduledShiftId: selectedShift?.id ?? null,
    };
    const applied = await perform(
      clockInAction({ requestId: requestIdFor(scope, payload), ...payload }),
      "Clock-in recorded using the server clock.",
    );
    if (applied) rotateRequestId(scope);
  }

  async function submitBreakStart() {
    if (!model?.activeEntry) return;
    const scope = `time.break-start:${model.activeEntry.id}`;
    const payload = { timeEntryId: model.activeEntry.id, isPaid: breakPaid };
    const applied = await perform(
      startBreakAction({ requestId: requestIdFor(scope, payload), ...payload }),
      `${breakPaid ? "Paid" : "Unpaid"} break started.`,
    );
    if (applied) rotateRequestId(scope);
  }

  const sessionMinutes = model.activeEntry
    ? Math.max(0, Math.floor(((now?.getTime() ?? new Date(model.activeEntry.clockedInAt).getTime()) - new Date(model.activeEntry.clockedInAt).getTime()) / 60_000) - model.activeEntry.unpaidBreakMinutes)
    : 0;

  return (
    <PageFrame width="wide">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="flex items-center gap-2"><StatusPill tone="neutral">Server-backed</StatusPill><span className="text-xs text-[var(--ink-faint)]">Server-timestamped · auditable</span></div><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Time clock</h2><p className="mt-1 text-[13px] text-[var(--ink-faint)]">Punches, breaks, exceptions, and approvals for {workspace.activeLocation.name}.</p></div>
        <span className="flex items-center gap-2 text-xs text-[var(--ink-faint)]"><MapPin className="size-3.5" />{model.timeZone}</span>
      </div>
      <RealtimeSyncStatus {...realtime} />

      <section className="relative mt-5 overflow-hidden rounded-[26px] bg-[var(--graphite)] p-5 text-white sm:p-7 lg:p-8" aria-label="Your live time clock">
        <div className="absolute inset-0 workspace-grid opacity-20" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div><div className="flex flex-wrap items-center gap-2"><StatusPill tone={model.activeEntry ? activeBreak ? "warning" : "positive" : "neutral"} dot={Boolean(model.activeEntry && !activeBreak)} className="bg-white/[0.08] text-white">{activeBreak ? `${activeBreak.isPaid ? "Paid" : "Unpaid"} break` : model.activeEntry ? "Clocked in" : "Ready"}</StatusPill><span className="text-xs text-white/55">{model.employee?.displayName ?? "No employee profile"}</span></div><p className="mt-5 text-xs tracking-[.12em] text-white/55 uppercase">Restaurant local time</p><p className="numeric mt-2 text-[clamp(2.7rem,7vw,5.5rem)] leading-none font-medium tracking-[-0.07em]">{clockLabel(now, model.timeZone)}</p><p className="mt-5 text-xs text-white/55">{model.activeEntry ? `${model.activeEntry.jobName} · session ${durationLabel(sessionMinutes)}` : `${workspace.activeLocation.name} · ${model.date}`}</p></div>
          <div className="flex max-w-xl flex-wrap items-center gap-2 lg:justify-end">
            {!model.activeEntry ? <><select aria-label="Job code" value={selectedRoleId} onChange={(event) => setSelectedRoleId(event.target.value)} disabled={!model.roles.length || busy} className="h-12 rounded-[14px] border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white"><option className="text-black" value="">Choose job code</option>{model.roles.map((role) => <option className="text-black" key={role.id} value={role.id}>{role.name}</option>)}</select><select aria-label="Scheduled shift" value={selectedShiftId} onChange={(event) => { const id = event.target.value; setSelectedShiftId(id); const shift = model.shifts.find((item) => item.id === id); if (shift) setSelectedRoleId(shift.jobRoleId); }} disabled={busy} className="h-12 rounded-[14px] border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white"><option className="text-black" value="">Unscheduled punch</option>{model.shifts.map((shift) => <option className="text-black" key={shift.id} value={shift.id}>{shift.startLabel} · {shift.jobName}</option>)}</select><Button variant="accent" size="lg" disabled={!model.employee || !selectedRoleId || busy} onClick={() => void submitClockIn()} >{busy ? <LoaderCircle className="size-4 animate-spin" /> : <LogIn className="size-4" />}Clock in</Button></> : null}
            {model.activeEntry && !activeBreak ? <><select aria-label="Break type" value={breakPaid ? "paid" : "unpaid"} onChange={(event) => setBreakPaid(event.target.value === "paid")} className="h-12 rounded-[14px] border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white"><option className="text-black" value="unpaid">Unpaid break</option><option className="text-black" value="paid">Paid break</option></select><Button variant="secondary" size="lg" className="border-white/15 bg-white/10 text-white hover:bg-white/15" disabled={busy} onClick={() => void submitBreakStart()}><Coffee className="size-4" />Start break</Button><Button variant="danger" size="lg" disabled={busy} onClick={() => void perform(clockOutAction({ timeEntryId: model.activeEntry!.id }), "Clock-out recorded and submitted.")}><LogOut className="size-4" />Clock out</Button></> : null}
            {model.activeEntry && activeBreak ? <Button variant="accent" size="lg" disabled={busy} onClick={() => void perform(endBreakAction({ breakId: activeBreak.id }), "Break ended using the server clock.")}><TimerReset className="size-4" />End break</Button> : null}
          </div>
        </div>
      </section>
      <p aria-live="polite" className={cn("mt-2 min-h-5 px-2 text-xs", notice.toLowerCase().includes("could not") || notice.toLowerCase().includes("change at least") ? "text-[var(--danger)]" : "text-[var(--positive)]")}>{notice}</p>

      <section className="mt-3 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Clocked in" value={String(model.roster.filter((row) => ["clocked_in", "on_break", "exception"].includes(row.status)).length + (model.activeEntry && !model.canManage ? 1 : 0))} detail={workspace.activeLocation.name} />
        <Metric label="On break" value={String(model.roster.filter((row) => row.status === "on_break").length + (activeBreak && !model.canManage ? 1 : 0))} detail="Paid and unpaid separated" />
        <Metric label="Pending corrections" value={String(pendingCorrections.length)} detail="Independent review" />
        <Metric label="Recent recorded" value={durationLabel(recordedMinutes)} detail="Visible entries · no policy inference" />
      </section>

      <div className="mt-8 grid gap-10 xl:grid-cols-[1.25fr_.75fr]">
        <section>
          <SectionHeading eyebrow="Attendance" title={model.canManage ? "Today’s roster" : "Your punch history"} detail={model.canManage ? `${model.roster.length} scheduled or active team members` : "Original and corrected entries remain traceable"} />
          {model.canManage ? <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)]">{model.roster.map((row, index) => <div key={row.employeeId} className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-[var(--line)] px-4 py-3.5 first:border-t-0 sm:grid-cols-[1fr_120px_150px]"><div className="flex min-w-0 items-center gap-3"><Avatar name={row.employeeName} index={index} /><div className="min-w-0"><p className="truncate text-xs font-semibold">{row.employeeName}</p><p className="mt-1 truncate text-xs text-[var(--ink-faint)]">{row.jobName}</p></div></div><span className="numeric hidden text-xs text-[var(--ink-faint)] sm:block">{row.shiftLabel ?? "Unscheduled"}</span><div className="flex items-center justify-end gap-2"><StatusPill tone={rosterTone[row.status]}>{row.status.replaceAll("_", " ")}</StatusPill>{row.status === "scheduled" && row.shiftId ? <button className="focus-ring rounded-lg p-2 text-[var(--ink-faint)] hover:bg-[var(--canvas-strong)] hover:text-[var(--ink)]" aria-label={`Record missed shift for ${row.employeeName}`} onClick={() => setMissedEmployeeId(row.employeeId)}><FileClock className="size-4" /></button> : null}</div></div>)}{!model.roster.length ? <p className="px-5 py-12 text-center text-xs text-[var(--ink-faint)]">No published shifts or active punches at this location.</p> : null}</div> : null}

          <div className={model.canManage ? "mt-9" : ""}><SectionHeading eyebrow="Audit trail" title="Your recent entries" detail="Unpaid breaks are excluded from recorded work; no overtime rule is assumed" /><div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)]">{model.recentEntries.map((entry) => <div key={entry.id} className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-[var(--line)] px-4 py-3.5 first:border-t-0 sm:grid-cols-[1fr_130px_120px_auto]"><div><p className="text-xs font-semibold">{entry.jobName}</p><p className="mt-1 text-xs text-[var(--ink-faint)]">{dateTimeLabel(entry.clockedInAt, model.timeZone)}–{entry.clockedOutLabel ?? "Open"}</p></div><span className="numeric hidden text-xs text-[var(--ink-faint)] sm:block">{durationLabel(entry.workedMinutes)}</span><StatusPill tone={entry.status === "open" ? "positive" : entry.status === "corrected" ? "warning" : "neutral"}>{entry.status}</StatusPill><button className="focus-ring rounded-lg p-2 text-[var(--ink-faint)] hover:bg-[var(--canvas-strong)] hover:text-[var(--ink)]" aria-label={`Request correction for ${dateTimeLabel(entry.clockedInAt, model.timeZone)}`} onClick={() => setCorrectionEntryId(entry.id)}><PencilLine className="size-4" /></button></div>)}{!model.recentEntries.length ? <p className="px-5 py-12 text-center text-xs text-[var(--ink-faint)]">No time entries are visible for your employee profile.</p> : null}</div></div>
        </section>

        <aside>
          <SectionHeading eyebrow="Corrections" title={model.canManage ? "Approval queue" : "Your requests"} detail="Decisions and original values are immutable" />
          <div className="space-y-2">{model.corrections.map((correction) => <button key={correction.id} onClick={() => setSelectedCorrectionId(correction.id)} className={cn("focus-ring w-full rounded-[16px] border p-4 text-left", selectedCorrection?.id === correction.id ? "border-[var(--accent)] bg-[var(--accent-soft)]/35" : "border-[var(--line)] bg-[var(--paper-strong)]")}><div className="flex items-center justify-between gap-3"><span className="text-xs font-semibold">{correction.employeeName}</span><StatusPill tone={correction.status === "pending" ? "warning" : correction.status === "approved" ? "positive" : "neutral"}>{correction.status}</StatusPill></div><p className="mt-2 line-clamp-2 text-xs leading-4 text-[var(--ink-faint)]">{correction.reason}</p></button>)}{!model.corrections.length ? <div className="rounded-[18px] border border-[var(--line)] p-6 text-center"><UserRoundCheck className="mx-auto size-5 text-[var(--positive)]" /><p className="mt-3 text-xs font-semibold">No correction requests</p></div> : null}</div>
          {selectedCorrection ? (
            <section className="mt-4 rounded-[18px] bg-[var(--canvas)] p-4">
              <div className="grid gap-3 text-xs sm:grid-cols-2 xl:grid-cols-1">
                <div><p className="font-semibold text-[var(--ink-faint)]">Original</p><p className="mt-1">{dateTimeLabel(selectedCorrection.originalClockedInAt, model.timeZone)} → {dateTimeLabel(selectedCorrection.originalClockedOutAt, model.timeZone)}</p></div>
                <div><p className="font-semibold text-[var(--ink-faint)]">Proposed</p><p className="mt-1">{dateTimeLabel(selectedCorrection.proposedClockedInAt ?? selectedCorrection.originalClockedInAt, model.timeZone)} → {dateTimeLabel(selectedCorrection.proposedClockedOutAt ?? selectedCorrection.originalClockedOutAt, model.timeZone)}</p></div>
              </div>
              {model.canManage &&
              selectedCorrection.status === "pending" &&
              selectedCorrection.requestedByUserId !== workspace.identity.userId ? (
                <>
                  <label className="mt-4 block"><span className="mb-1.5 block text-xs font-semibold">Decision note</span><textarea value={decisionNote} onChange={(event) => setDecisionNote(event.target.value)} rows={3} maxLength={2_000} className="w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-xs" /></label>
                  <div className="mt-3 flex justify-end gap-2"><Button variant="danger" size="sm" disabled={busy} onClick={() => void perform(approveTimeCorrectionAction({ correctionId: selectedCorrection.id, approve: false, decisionNote: decisionNote || null }), "Correction denied; original entry retained.")}><X className="size-3.5" />Deny</Button><Button variant="accent" size="sm" disabled={busy} onClick={() => void perform(approveTimeCorrectionAction({ correctionId: selectedCorrection.id, approve: true, decisionNote: decisionNote || null }), "Correction approved and applied with audit evidence.")}><Check className="size-3.5" />Approve</Button></div>
                </>
              ) : selectedCorrection.status === "pending" &&
                selectedCorrection.requestedByUserId === workspace.identity.userId ? (
                <p className="mt-4 flex items-center gap-2 text-xs text-[var(--warning)]"><ShieldCheck className="size-4" />A different manager must decide your request.</p>
              ) : null}
            </section>
          ) : null}
          <div className="mt-6 flex gap-3 border-t border-[var(--line)] pt-5 text-xs leading-4 text-[var(--ink-faint)]"><ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--accent-strong)]" /><p>Owner labor, break, and overtime policies are not configured, so this screen records facts without applying a legal or payroll threshold.</p></div>
        </aside>
      </div>

      {correctionEntry ? <CorrectionDialog entry={correctionEntry} model={model} busy={busy} onClose={() => setCorrectionEntryId(null)} onSubmit={(form) => void submitCorrection(form)} /> : null}
      {missedRow ? <MissedPunchDialog row={missedRow} model={model} workspace={workspace} busy={busy} onClose={() => setMissedEmployeeId(null)} onSubmit={(form) => void submitMissedEntry(form)} /> : null}
    </PageFrame>
  );
}
