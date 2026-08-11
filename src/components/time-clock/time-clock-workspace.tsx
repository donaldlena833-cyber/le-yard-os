"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  AlertTriangle,
  BadgeCheck,
  ChevronRight,
  CircleAlert,
  Coffee,
  FileClock,
  History,
  LogIn,
  LogOut,
  MapPin,
  PencilLine,
  ShieldCheck,
  TimerReset,
  UserCheck,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { demoIds, demoWorkspace } from "@/lib/demo";
import { cn } from "@/lib/utils";
import type { TimecardCorrection } from "@/types";

type ClockState = "out" | "working" | "break";
type AuditItem = {
  id: string;
  title: string;
  detail: string;
  occurredAt: string;
  tone: "positive" | "warning" | "neutral";
};

function useCurrentTime() {
  const [time, setTime] = useState<Date | null>(null);
  useEffect(() => {
    const update = () => setTime(new Date());
    const initial = window.setTimeout(update, 0);
    const timer = window.setInterval(update, 1_000);
    return () => {
      window.clearTimeout(initial);
      window.clearInterval(timer);
    };
  }, []);
  return time;
}

function formatDuration(totalSeconds: number) {
  const hours = Math.floor(totalSeconds / 3_600);
  const minutes = Math.floor((totalSeconds % 3_600) / 60);
  const seconds = totalSeconds % 60;
  return [hours, minutes, seconds]
    .map((value) => String(value).padStart(2, "0"))
    .join(":");
}

function formatTime(value: Date | null, timeZone: string) {
  return value
    ? new Intl.DateTimeFormat("en-US", {
        hour: "numeric",
        minute: "2-digit",
        second: "2-digit",
        timeZone,
      }).format(value)
    : "—:—:—";
}

function CorrectionDialog({
  open,
  onClose,
  onSubmit,
}: {
  open: boolean;
  onClose: () => void;
  onSubmit: (formData: FormData) => void;
}) {
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="correction-title"
            className="w-full max-w-lg rounded-[24px] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-float)] sm:p-7"
            initial={{ y: 12, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 8, scale: 0.98 }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="flex size-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                  <PencilLine className="size-4" />
                </span>
                <h3
                  id="correction-title"
                  className="mt-4 text-xl font-medium tracking-[-0.04em]"
                >
                  Request a punch correction
                </h3>
                <p className="mt-1 text-[13px] leading-5 text-[var(--ink-faint)]">
                  Your original punch stays in the audit trail. A manager must
                  approve every change.
                </p>
              </div>
              <Button
                variant="quiet"
                size="icon"
                aria-label="Close correction request"
                onClick={onClose}
              >
                <X className="size-4" />
              </Button>
            </div>
            <form action={onSubmit} className="mt-6 grid gap-4 sm:grid-cols-2">
              <label>
                <span className="mb-1.5 block text-xs font-semibold">
                  Business date
                </span>
                <input
                  required
                  name="businessDate"
                  type="date"
                  defaultValue="2026-08-01"
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"
                />
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-semibold">
                  Punch to correct
                </span>
                <select
                  name="punchKind"
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"
                >
                  <option value="clock_out">Missed clock-out</option>
                  <option value="clock_in">Missed clock-in</option>
                  <option value="break_start">Break start</option>
                  <option value="break_end">Break end</option>
                </select>
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold">
                  Correct time
                </span>
                <input
                  required
                  name="correctTime"
                  type="time"
                  defaultValue="23:15"
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold">
                  What happened?
                </span>
                <textarea
                  required
                  minLength={8}
                  name="reason"
                  rows={4}
                  placeholder="Add enough context for the approving manager."
                  className="w-full resize-none rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-3 text-xs placeholder:text-[var(--ink-faint)]"
                />
              </label>
              <div className="sm:col-span-2 rounded-xl bg-[var(--canvas)] px-3.5 py-3 text-xs leading-4 text-[var(--ink-faint)]">
                <span className="flex items-center gap-2 font-semibold text-[var(--ink-soft)]">
                  <History className="size-3.5" />
                  Immutable history
                </span>
                <p className="mt-1">
                  Submitting adds a pending request; it does not rewrite the
                  original punch.
                </p>
              </div>
              <div className="mt-1 flex justify-end gap-2 sm:col-span-2">
                <Button variant="quiet" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" variant="accent">
                  Submit for approval
                </Button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}

export function TimeClockWorkspace() {
  const workspace = useWorkspaceContext();
  const currentUserId = workspace.identity.userId;
  const currentDisplayName = workspace.identity.displayName;
  const now = useCurrentTime();
  const [locationId, setLocationId] = useState<string>(
    demoIds.locations.garden,
  );
  const [clockState, setClockState] = useState<ClockState>("out");
  const [clockedInAt, setClockedInAt] = useState<number | null>(null);
  const [breakStartedAt, setBreakStartedAt] = useState<number | null>(null);
  const [breakType, setBreakType] = useState<"paid" | "unpaid">("unpaid");
  const [correctionDialogOpen, setCorrectionDialogOpen] = useState(false);
  const [corrections, setCorrections] = useState<TimecardCorrection[]>(
    demoWorkspace.timecardCorrections,
  );
  const [selectedCorrectionId, setSelectedCorrectionId] = useState<
    string | null
  >(demoWorkspace.timecardCorrections[0]?.id ?? null);
  const [notice, setNotice] = useState("");
  const [auditItems, setAuditItems] = useState<AuditItem[]>([
    {
      id: "audit-view-correction",
      title: "Correction requested",
      detail: "Leo M. · clock-out · manager review pending",
      occurredAt: "9:10 AM",
      tone: "warning",
    },
    {
      id: "audit-priya-approve",
      title: "Timecard approved",
      detail: "Priya S. · 7h 02m recorded",
      occurredAt: "10:00 AM",
      tone: "positive",
    },
    {
      id: "audit-aisha-clock",
      title: "Clock-in recorded",
      detail: `Aisha R. · ${demoWorkspace.locations[0]?.name ?? "Primary location"} kiosk`,
      occurredAt: "1:56 PM",
      tone: "neutral",
    },
  ]);

  const elapsedSeconds =
    clockedInAt && now
      ? Math.max(0, Math.floor((now.getTime() - clockedInAt) / 1_000))
      : 0;
  const breakSeconds =
    breakStartedAt && now
      ? Math.max(0, Math.floor((now.getTime() - breakStartedAt) / 1_000))
      : 0;
  const selectedCorrection =
    corrections.find((correction) => correction.id === selectedCorrectionId) ??
    null;
  const selectedCorrectionTimecard = selectedCorrection
    ? demoWorkspace.timecards.find(
        (timecard) => timecard.id === selectedCorrection.timecardId,
      )
    : null;
  const pendingCorrections = corrections.filter(
    (correction) => correction.status === "pending",
  );

  const roster = useMemo(() => {
    const shifts = demoWorkspace.shifts.filter(
      (shift) => shift.locationId === locationId && shift.personId,
    );
    return shifts.map((shift) => {
      const person = demoWorkspace.people.find(
        (candidate) => candidate.id === shift.personId,
      )!;
      const job = demoWorkspace.jobRoles.find(
        (candidate) => candidate.id === shift.jobRoleId,
      )!;
      const openTimecard = demoWorkspace.timecards.find(
        (timecard) =>
          timecard.personId === person.id && timecard.status === "open",
      );
      const flagged = corrections.some(
        (correction) =>
          correction.requestedBy === person.id &&
          correction.status === "pending",
      );
      return { person, job, shift, openTimecard, flagged };
    });
  }, [corrections, locationId]);

  function appendAudit(title: string, detail: string, tone: AuditItem["tone"]) {
    const occurredAt = new Intl.DateTimeFormat("en-US", {
      hour: "numeric",
      minute: "2-digit",
      timeZone: location.timezone,
    }).format(new Date());
    setAuditItems((current) => [
      { id: `audit-${Date.now()}`, title, detail, occurredAt, tone },
      ...current,
    ]);
  }

  function clockIn() {
    const timestamp = now?.getTime();
    if (timestamp === undefined) return;
    setClockedInAt(timestamp);
    setClockState("working");
    setNotice("Clock-in recorded at this device and added to the audit trail.");
    appendAudit(
      "Clock-in recorded",
      `${currentDisplayName} · Owner operator · ${location.name.replace(" — Demo", "")}`,
      "positive",
    );
  }

  function clockOut() {
    setClockState("out");
    setClockedInAt(null);
    setBreakStartedAt(null);
    setNotice(
      `Clock-out recorded. Session total: ${formatDuration(elapsedSeconds)}.`,
    );
    appendAudit(
      "Clock-out recorded",
      `${currentDisplayName} · ${formatDuration(elapsedSeconds)} session`,
      "positive",
    );
  }

  function startBreak() {
    if (!now) return;
    setBreakStartedAt(now.getTime());
    setClockState("break");
    setNotice(`${breakType === "paid" ? "Paid" : "Unpaid"} break started.`);
    appendAudit(
      "Break started",
      `${currentDisplayName} · ${breakType} break`,
      "neutral",
    );
  }

  function endBreak() {
    setClockState("working");
    setBreakStartedAt(null);
    setNotice(`Break ended after ${formatDuration(breakSeconds)}.`);
    appendAudit(
      "Break ended",
      `${currentDisplayName} · ${formatDuration(breakSeconds)}`,
      "positive",
    );
  }

  function submitCorrection(formData: FormData) {
    const businessDate = String(formData.get("businessDate"));
    const correctTime = String(formData.get("correctTime"));
    const reason = String(formData.get("reason"));
    const correction: TimecardCorrection = {
      id: `correction-demo-${businessDate}-${correctTime.replace(":", "")}-${corrections.length + 1}`,
      organizationId: demoIds.organization,
      locationId,
      timecardId:
        demoWorkspace.timecards.find(
          (timecard) => timecard.personId === currentUserId,
        )?.id ?? `timecard-${currentUserId}-demo`,
      requestedBy: currentUserId,
      requestedClockInAt: null,
      requestedClockOutAt: `${businessDate}T${correctTime}:00-04:00`,
      reason,
      status: "pending",
      reviewedBy: null,
      reviewedAt: null,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setCorrections((current) => [correction, ...current]);
    setSelectedCorrectionId(correction.id);
    setCorrectionDialogOpen(false);
    setNotice(
      "Correction submitted for manager approval. The original punch is unchanged.",
    );
    appendAudit(
      "Correction requested",
      `${currentDisplayName} · ${businessDate} · ${correctTime}`,
      "warning",
    );
  }

  function reviewCorrection(status: "approved" | "declined") {
    if (!selectedCorrection) return;
    setCorrections((current) =>
      current.map((correction) =>
        correction.id === selectedCorrection.id
          ? {
              ...correction,
              status,
              reviewedBy: currentUserId,
              reviewedAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            }
          : correction,
      ),
    );
    const person = demoWorkspace.people.find(
      (candidate) => candidate.id === selectedCorrection.requestedBy,
    );
    setNotice(`${person?.displayName ?? "Correction"} was ${status}.`);
    appendAudit(
      `Correction ${status}`,
      `${person?.displayName ?? "Team member"} · original punch retained`,
      status === "approved" ? "positive" : "warning",
    );
  }

  const location = demoWorkspace.locations.find(
    (candidate) => candidate.id === locationId,
  )!;
  const clockedCount = roster.filter((entry) => entry.openTimecard).length;
  const missedPunchCount = corrections.filter(
    (correction) => correction.status === "pending",
  ).length;

  return (
    <PageFrame width="wide">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill tone="positive" dot>
              Live attendance
            </StatusPill>
            <span className="text-xs text-[var(--ink-faint)]">
              Kiosk and mobile punches
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">
            Time, without the guesswork
          </h2>
          <p className="mt-1 text-[13px] text-[var(--ink-faint)]">
            Every punch, break, correction, and approval leaves a clear record.
          </p>
        </div>
        <label>
          <span className="sr-only">Location</span>
          <select
            value={locationId}
            onChange={(event) => setLocationId(event.target.value)}
            className="h-10 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-3 text-xs font-semibold"
          >
            {demoWorkspace.locations.map((item) => (
              <option key={item.id} value={item.id}>
                {item.name.replace(" — Demo", "")}
              </option>
            ))}
          </select>
        </label>
      </div>

      <section
        className="relative mt-5 overflow-hidden rounded-[26px] bg-[var(--graphite)] p-5 text-white sm:p-7 lg:p-8"
        aria-label="Your time clock"
      >
        <div className="absolute inset-0 workspace-grid opacity-20" />
        <div className="relative grid gap-8 lg:grid-cols-[1fr_auto] lg:items-end">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <StatusPill
                tone={
                  clockState === "working"
                    ? "positive"
                    : clockState === "break"
                      ? "warning"
                      : "neutral"
                }
                dot={clockState === "working"}
                className="bg-white/[0.08] text-white"
              >
                {clockState === "working"
                  ? "Clocked in"
                  : clockState === "break"
                    ? `${breakType} break`
                    : "Ready to clock in"}
              </StatusPill>
              <span className="flex items-center gap-1.5 text-xs text-white/55">
                <MapPin className="size-3.5" />
                {location.name.replace(" — Demo", "")}
              </span>
            </div>
            <p className="mt-5 text-[13px] tracking-[0.12em] text-white/55 uppercase">
              Local time
            </p>
            <p
              className="numeric mt-2 text-[clamp(2.7rem,7vw,5.5rem)] leading-none font-medium tracking-[-0.07em]"
              aria-live="off"
            >
              {formatTime(now, location.timezone)}
            </p>
            <div className="mt-5 flex flex-wrap items-center gap-x-6 gap-y-2 text-xs text-white/55">
              <span>{currentDisplayName} · Owner operator</span>
              <span>
                Session{" "}
                <strong className="numeric font-semibold text-white/80">
                  {formatDuration(elapsedSeconds)}
                </strong>
              </span>
              {clockState === "break" ? (
                <span>
                  Break{" "}
                  <strong className="numeric font-semibold text-white/80">
                    {formatDuration(breakSeconds)}
                  </strong>
                </span>
              ) : null}
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-2 lg:max-w-[390px] lg:justify-end">
            {clockState === "out" ? (
              <Button variant="accent" size="lg" onClick={clockIn}>
                <LogIn className="size-4" /> Clock in
              </Button>
            ) : null}
            {clockState === "working" ? (
              <>
                <label className="sr-only" htmlFor="break-type">
                  Break type
                </label>
                <select
                  id="break-type"
                  value={breakType}
                  onChange={(event) =>
                    setBreakType(event.target.value as "paid" | "unpaid")
                  }
                  className="h-12 rounded-[14px] border border-white/15 bg-white/10 px-3 text-xs font-semibold text-white"
                >
                  <option className="text-black" value="unpaid">
                    Unpaid break
                  </option>
                  <option className="text-black" value="paid">
                    Paid break
                  </option>
                </select>
                <Button
                  variant="secondary"
                  size="lg"
                  className="border-white/15 bg-white/10 text-white hover:bg-white/15"
                  onClick={startBreak}
                >
                  <Coffee className="size-4" /> Start break
                </Button>
                <Button variant="danger" size="lg" onClick={clockOut}>
                  <LogOut className="size-4" /> Clock out
                </Button>
              </>
            ) : null}
            {clockState === "break" ? (
              <Button variant="accent" size="lg" onClick={endBreak}>
                <TimerReset className="size-4" /> End break
              </Button>
            ) : null}
            <Button
              variant="quiet"
              size="sm"
              className="text-white/65 hover:bg-white/10 hover:text-white"
              onClick={() => setCorrectionDialogOpen(true)}
            >
              <PencilLine className="size-3.5" /> Request correction
            </Button>
          </div>
        </div>
      </section>
      <p
        aria-live="polite"
        className="mt-2 min-h-5 px-2 text-xs text-[var(--positive)]"
      >
        {notice}
      </p>

      <section
        aria-label="Time clock metrics"
        className="mt-3 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0"
      >
        <Metric
          label="Clocked in"
          value={`${clockedCount}/${roster.length}`}
          detail={`${location.name.replace(" — Demo", "")} roster`}
        />
        <Metric
          label="On break"
          value={clockState === "break" ? "1" : "0"}
          detail="Paid and unpaid tracked"
        />
        <Metric
          label="Missed punches"
          value={String(missedPunchCount)}
          detail="Human approval required"
          trend={{
            label: missedPunchCount ? "Review" : "Clear",
            tone: missedPunchCount ? "negative" : "positive",
          }}
        />
        <Metric
          label="Projected OT"
          value="2.1h"
          detail="Forecast only · policy pending"
          trend={{ label: "Watch", tone: "neutral" }}
        />
      </section>

      <div className="mt-8 grid gap-9 xl:grid-cols-[1.35fr_.8fr] xl:gap-12">
        <section>
          <SectionHeading
            eyebrow="Live roster"
            title="Today’s attendance"
            detail={`${roster.length} scheduled at ${location.name.replace(" — Demo", "")}`}
            action={
              <StatusPill tone="positive" dot>
                Realtime
              </StatusPill>
            }
          />
          <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--paper)]">
            <div className="grid grid-cols-[1fr_auto] bg-[var(--canvas-strong)] px-4 py-2.5 text-xs font-semibold tracking-[0.12em] text-[var(--ink-faint)] uppercase sm:grid-cols-[1fr_130px_120px]">
              <span>Team member</span>
              <span className="hidden sm:block">Shift</span>
              <span className="text-right">Live status</span>
            </div>
            {roster.map((entry, index) => {
              const startsAt = new Intl.DateTimeFormat("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: location.timezone,
              }).format(new Date(entry.shift.startsAt));
              const endsAt = new Intl.DateTimeFormat("en-US", {
                hour: "numeric",
                minute: "2-digit",
                timeZone: location.timezone,
              }).format(new Date(entry.shift.endsAt));
              return (
                <div
                  key={entry.shift.id}
                  className="grid grid-cols-[1fr_auto] items-center gap-3 border-t border-[var(--line)] px-4 py-3.5 sm:grid-cols-[1fr_130px_120px]"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={entry.person.displayName} index={index} />
                    <div className="min-w-0">
                      <p className="truncate text-xs font-semibold">
                        {entry.person.displayName}
                      </p>
                      <p className="mt-1 truncate text-xs text-[var(--ink-faint)]">
                        {entry.job.name}
                      </p>
                    </div>
                    {entry.flagged ? (
                      <CircleAlert
                        className="size-3.5 text-[var(--warning)]"
                        aria-label="Punch correction pending"
                      />
                    ) : null}
                  </div>
                  <p className="numeric hidden text-xs text-[var(--ink-faint)] sm:block">
                    {startsAt}–{endsAt}
                  </p>
                  <div className="flex justify-end">
                    <StatusPill
                      tone={
                        entry.openTimecard
                          ? "positive"
                          : entry.shift.status === "acknowledged"
                            ? "neutral"
                            : "warning"
                      }
                      dot={Boolean(entry.openTimecard)}
                    >
                      {entry.openTimecard
                        ? `In ${new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: location.timezone }).format(new Date(entry.openTimecard.clockedInAt))}`
                        : entry.shift.status === "acknowledged"
                          ? "Scheduled"
                          : "Unconfirmed"}
                    </StatusPill>
                  </div>
                </div>
              );
            })}
            {!roster.length ? (
              <div className="px-5 py-12 text-center text-xs text-[var(--ink-faint)]">
                No shifts scheduled at this location.
              </div>
            ) : null}
          </div>

          <div className="mt-9">
            <SectionHeading
              eyebrow="Compliance watch"
              title="Overtime & exceptions"
              detail="Forecasts are informational until owners configure labor policies"
            />
            <div className="grid gap-3 md:grid-cols-2">
              <article className="rounded-[18px] border border-[var(--warning)]/20 bg-[var(--warning-soft)]/45 p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--warning-soft)] text-[var(--warning)]">
                    <AlertTriangle className="size-4" />
                  </span>
                  <StatusPill tone="warning">Forecast</StatusPill>
                </div>
                <h3 className="mt-4 text-xs font-semibold">
                  Leo M. · projected 41.2h
                </h3>
                <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">
                  Projection includes scheduled shifts at both locations. Review
                  before publishing changes; no overtime policy is enforced in
                  demo mode.
                </p>
              </article>
              <article className="rounded-[18px] border border-[var(--line)] bg-[var(--paper)] p-4">
                <div className="flex items-start justify-between gap-3">
                  <span className="flex size-9 items-center justify-center rounded-xl bg-[var(--canvas-strong)] text-[var(--ink-faint)]">
                    <Coffee className="size-4" />
                  </span>
                  <StatusPill tone="neutral">Policy needed</StatusPill>
                </div>
                <h3 className="mt-4 text-xs font-semibold">
                  Break rules are not configured
                </h3>
                <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">
                  Punches record paid and unpaid breaks, but the app will not
                  invent eligibility, timing, or exception rules.
                </p>
              </article>
            </div>
          </div>
        </section>

        <aside>
          <SectionHeading
            eyebrow="Manager queue"
            title={`${pendingCorrections.length} correction${pendingCorrections.length === 1 ? "" : "s"} pending`}
            detail="Original punches remain immutable"
          />
          <div className="overflow-hidden rounded-[18px] border border-[var(--line)] bg-[var(--paper)]">
            {corrections.map((correction) => {
              const person = demoWorkspace.people.find(
                (candidate) => candidate.id === correction.requestedBy,
              );
              return (
                <button
                  key={correction.id}
                  type="button"
                  onClick={() => setSelectedCorrectionId(correction.id)}
                  aria-pressed={selectedCorrectionId === correction.id}
                  className={cn(
                    "focus-ring flex w-full items-center gap-3 border-b border-[var(--line)] px-4 py-3.5 text-left last:border-0 hover:bg-[var(--paper-strong)]",
                    selectedCorrectionId === correction.id &&
                      "bg-[var(--paper-strong)]",
                  )}
                >
                  <Avatar
                    name={person?.displayName ?? "Team member"}
                    size="sm"
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-xs font-semibold">
                      {person?.displayName ?? "Team member"}
                    </span>
                    <span className="mt-1 block truncate text-xs text-[var(--ink-faint)]">
                      Requested clock-out correction
                    </span>
                  </span>
                  <StatusPill
                    tone={
                      correction.status === "approved"
                        ? "positive"
                        : correction.status === "declined"
                          ? "danger"
                          : "warning"
                    }
                  >
                    {correction.status}
                  </StatusPill>
                  <ChevronRight className="size-3.5 text-[var(--ink-faint)]" />
                </button>
              );
            })}
          </div>

          {selectedCorrection ? (
            <motion.div
              layout
              className="mt-3 rounded-[18px] border border-[var(--line)] bg-[var(--paper-strong)] p-4"
            >
              <div className="flex items-center gap-2">
                <FileClock className="size-4 text-[var(--accent)]" />
                <p className="text-xs font-semibold">Correction detail</p>
              </div>
              <dl className="mt-4 space-y-3 text-xs">
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--ink-faint)]">
                    Original clock-out
                  </dt>
                  <dd className="numeric font-semibold">
                    {selectedCorrectionTimecard?.clockedOutAt
                      ? new Intl.DateTimeFormat("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: location.timezone,
                        }).format(
                          new Date(selectedCorrectionTimecard.clockedOutAt),
                        )
                      : "Missing"}
                  </dd>
                </div>
                <div className="flex justify-between gap-4">
                  <dt className="text-[var(--ink-faint)]">
                    Requested clock-out
                  </dt>
                  <dd className="numeric font-semibold">
                    {selectedCorrection.requestedClockOutAt
                      ? new Intl.DateTimeFormat("en-US", {
                          hour: "numeric",
                          minute: "2-digit",
                          timeZone: location.timezone,
                        }).format(
                          new Date(selectedCorrection.requestedClockOutAt),
                        )
                      : "—"}
                  </dd>
                </div>
                <div>
                  <dt className="text-[var(--ink-faint)]">Reason</dt>
                  <dd className="mt-1.5 leading-4">
                    {selectedCorrection.reason}
                  </dd>
                </div>
              </dl>
              {selectedCorrection.status === "pending" ? (
                <div className="mt-5 flex gap-2">
                  <Button
                    className="flex-1"
                    variant="secondary"
                    size="sm"
                    onClick={() => reviewCorrection("declined")}
                  >
                    Decline
                  </Button>
                  <Button
                    className="flex-1"
                    variant="accent"
                    size="sm"
                    onClick={() => reviewCorrection("approved")}
                  >
                    <BadgeCheck className="size-3.5" /> Approve
                  </Button>
                </div>
              ) : (
                <p className="mt-5 flex items-center gap-2 rounded-xl bg-[var(--canvas)] px-3 py-2.5 text-xs text-[var(--ink-faint)]">
                  <ShieldCheck className="size-3.5" />
                  Reviewed by an authorized human. Audit history retained.
                </p>
              )}
            </motion.div>
          ) : null}

          <section className="mt-9">
            <SectionHeading
              eyebrow="Audit trail"
              title="Latest time events"
              action={<History className="size-4 text-[var(--ink-faint)]" />}
            />
            <ol className="border-y border-[var(--line)]">
              {auditItems.slice(0, 5).map((item) => (
                <li
                  key={item.id}
                  className="flex items-start gap-3 border-b border-[var(--line)] px-1 py-3.5 last:border-0"
                >
                  <span
                    className={cn(
                      "mt-1 size-2 rounded-full",
                      item.tone === "positive"
                        ? "bg-[var(--positive)]"
                        : item.tone === "warning"
                          ? "bg-[var(--warning)]"
                          : "bg-[var(--ink-faint)]",
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p className="text-xs font-semibold">{item.title}</p>
                    <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">
                      {item.detail}
                    </p>
                  </div>
                  <time className="numeric shrink-0 text-xs text-[var(--ink-faint)]">
                    {item.occurredAt}
                  </time>
                </li>
              ))}
            </ol>
          </section>
        </aside>
      </div>

      <div className="mt-8 flex items-start gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-xs leading-4 text-[var(--ink-faint)]">
        <UserCheck className="mt-0.5 size-4 shrink-0 text-[var(--positive)]" />
        <span>
          Manager review is required for corrections; original records remain
          unchanged.
        </span>
      </div>
      <CorrectionDialog
        open={correctionDialogOpen}
        onClose={() => setCorrectionDialogOpen(false)}
        onSubmit={submitCorrection}
      />
    </PageFrame>
  );
}
