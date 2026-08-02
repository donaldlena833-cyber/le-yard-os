"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import {
  AlertCircle,
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Check,
  CircleDot,
  GripVertical,
  Pencil,
  Plus,
  Send,
  UserRoundCheck,
  X,
} from "lucide-react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { type FormEvent, useState, useTransition } from "react";
import { acknowledgeShiftAction, publishScheduleAction } from "@/app/actions/workflows/schedule";
import {
  claimLiveOpenShiftAction,
  createLiveScheduleAction,
  createLiveShiftAction,
  decideLiveShiftSwapAction,
  editLiveShiftAction,
  moveLiveShiftAction,
  offerLiveShiftSwapAction,
  reopenLiveShiftAction,
  requestLiveShiftSwapAction,
  saveLiveScheduleTemplateAction,
} from "@/app/actions/workflows/live-schedule";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import type {
  LiveScheduleModel,
  LiveScheduleShift,
  LiveSwapRequest,
} from "@/data/read-models/schedule";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { cn } from "@/lib/utils";

type LiveResult =
  | { ok: true; persisted: boolean }
  | { ok: false; message: string };

function dateLabel(date: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone: "UTC",
    weekday: "short",
    month: "short",
    day: "numeric",
  }).format(new Date(`${date}T00:00:00Z`));
}

function ScheduleReadError({ message }: { message: string }) {
  return (
    <PageFrame>
      <section className="mx-auto mt-[8svh] max-w-xl rounded-[28px] border border-[var(--line)] bg-[var(--paper-strong)] p-7 text-center shadow-[var(--shadow-card)]">
        <AlertCircle className="mx-auto size-6 text-[var(--danger)]" />
        <h2 className="mt-4 text-xl font-medium tracking-[-0.04em]">Schedule unavailable</h2>
        <p className="mt-2 text-xs leading-5 text-[var(--ink-faint)]">{message}</p>
      </section>
    </PageFrame>
  );
}

function ShiftCard({
  shift,
  draggable,
  canManage,
  selfEmployeeId,
  published,
  busy,
  onEdit,
  onAction,
}: {
  shift: LiveScheduleShift;
  draggable: boolean;
  canManage: boolean;
  selfEmployeeId: string | null;
  published: boolean;
  busy: boolean;
  onEdit: () => void;
  onAction: (kind: "ack" | "claim" | "swap" | "reopen") => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: shift.id,
    disabled: !draggable,
  });
  const mine = Boolean(selfEmployeeId && shift.employeeId === selfEmployeeId);
  return (
    <article
      ref={setNodeRef}
      style={{ transform: CSS.Translate.toString(transform) }}
      className={cn(
        "rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-3 shadow-[0_5px_18px_rgba(25,28,24,.04)]",
        shift.isOpen && "border-[var(--accent)]/35 bg-[var(--accent-soft)]/25",
        isDragging && "z-20 opacity-70 shadow-xl",
      )}
    >
      <div className="flex items-start gap-2">
        {draggable ? <button type="button" aria-label={`Move ${shift.employeeName} shift`} className="focus-ring mt-0.5 cursor-grab rounded-md p-1 text-[var(--ink-faint)] active:cursor-grabbing" {...listeners} {...attributes}><GripVertical className="size-3.5" /></button> : null}
        <div className="min-w-0 flex-1">
          <div className="flex items-center justify-between gap-2"><p className="truncate text-[10px] font-semibold">{shift.employeeName}</p><StatusPill tone={shift.isOpen ? "accent" : shift.acknowledged ? "positive" : "neutral"}>{shift.isOpen ? "Open" : shift.status.replaceAll("_", " ")}</StatusPill></div>
          <p className="numeric mt-2 text-[10px] font-semibold">{shift.startLabel}–{shift.endLabel}</p>
          <p className="mt-1 truncate text-[9px] text-[var(--ink-faint)]">{shift.jobName}{shift.breakMinutes ? ` · ${shift.breakMinutes}m break` : ""}</p>
        </div>
        {draggable ? <button type="button" onClick={onEdit} className="focus-ring rounded-lg p-1.5 text-[var(--ink-faint)] hover:bg-[var(--canvas)]" aria-label="Edit shift"><Pencil className="size-3" /></button> : null}
      </div>
      {published ? (
        <div className="mt-3 flex flex-wrap gap-1.5">
          {mine && !shift.acknowledged && ["scheduled", "claimed"].includes(shift.status) ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => onAction("ack")}><Check className="size-3" /> Acknowledge</Button> : null}
          {mine && !shift.isOpen && ["scheduled", "claimed"].includes(shift.status) ? <Button size="sm" variant="quiet" disabled={busy} onClick={() => onAction("swap")}>Request swap</Button> : null}
          {shift.isOpen && selfEmployeeId ? <Button size="sm" variant="accent" disabled={busy} onClick={() => onAction("claim")}><UserRoundCheck className="size-3" /> Claim</Button> : null}
          {!shift.isOpen && canManage && ["scheduled", "claimed", "cancelled"].includes(shift.status) ? <Button size="sm" variant="quiet" disabled={busy} onClick={() => onAction("reopen")}>Reopen</Button> : null}
        </div>
      ) : null}
    </article>
  );
}

function DayColumn({
  date,
  shifts,
  canDrag,
  canManage,
  selfEmployeeId,
  published,
  busy,
  onEdit,
  onAction,
}: {
  date: string;
  shifts: LiveScheduleShift[];
  canDrag: boolean;
  canManage: boolean;
  selfEmployeeId: string | null;
  published: boolean;
  busy: boolean;
  onEdit: (shift: LiveScheduleShift) => void;
  onAction: (shift: LiveScheduleShift, kind: "ack" | "claim" | "swap" | "reopen") => void;
}) {
  const { setNodeRef, isOver } = useDroppable({ id: date, disabled: !canDrag });
  return (
    <section ref={setNodeRef} className={cn("min-h-56 rounded-[18px] border border-[var(--line)] bg-[var(--canvas)] p-2.5 transition-colors", isOver && "border-[var(--accent)] bg-[var(--accent-soft)]/25")} aria-label={dateLabel(date)}>
      <div className="mb-2.5 flex items-center justify-between px-1"><h3 className="text-[10px] font-semibold">{dateLabel(date)}</h3><span className="numeric text-[9px] text-[var(--ink-faint)]">{shifts.length}</span></div>
      <div className="space-y-2">{shifts.map((shift) => <ShiftCard key={shift.id} shift={shift} draggable={canDrag} canManage={canManage} selfEmployeeId={selfEmployeeId} published={published} busy={busy} onEdit={() => onEdit(shift)} onAction={(kind) => onAction(shift, kind)} />)}{!shifts.length ? <div className="flex min-h-24 items-center justify-center rounded-xl border border-dashed border-[var(--line)] text-center text-[9px] text-[var(--ink-faint)]">No shifts</div> : null}</div>
    </section>
  );
}

function ShiftDialog({
  schedule,
  shift,
  onClose,
  onSave,
  busy,
}: {
  schedule: LiveScheduleModel;
  shift: LiveScheduleShift | null;
  onClose: () => void;
  onSave: (payload: Record<string, unknown>) => void;
  busy: boolean;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-[3px]" onMouseDown={(event) => { if (event.currentTarget === event.target) onClose(); }}>
      <section role="dialog" aria-modal="true" aria-labelledby="shift-dialog-title" className="w-full max-w-lg rounded-[24px] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-float)] sm:p-7">
        <div className="flex items-start justify-between gap-4"><div><p className="eyebrow">Draft schedule</p><h3 id="shift-dialog-title" className="mt-2 text-xl font-medium tracking-[-0.04em]">{shift ? "Edit shift" : "Add shift"}</h3></div><Button size="icon" variant="quiet" onClick={onClose} aria-label="Close shift editor"><X className="size-4" /></Button></div>
        <form className="mt-6 grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); const form = new FormData(event.currentTarget); onSave({ scheduleId: schedule.schedule!.id, shiftId: shift?.id, employeeId: String(form.get("employeeId") || "") || null, jobRoleId: String(form.get("jobRoleId")), date: String(form.get("date")), startsAt: String(form.get("startsAt")), endsAt: String(form.get("endsAt")), breakMinutes: Number(form.get("breakMinutes") || 0), notes: String(form.get("notes") || "") || null, isOpen: form.get("isOpen") === "on" }); }}>
          <label><span className="mb-1.5 block text-[10px] font-semibold">Date</span><select name="date" defaultValue={shift?.date ?? schedule.weekDates[0]} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs">{schedule.weekDates.map((date) => <option key={date} value={date}>{dateLabel(date)}</option>)}</select></label>
          <label><span className="mb-1.5 block text-[10px] font-semibold">Job role</span><select name="jobRoleId" defaultValue={shift?.jobRoleId ?? schedule.jobRoles[0]?.id} required className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs">{schedule.jobRoles.map((role) => <option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
          <label><span className="mb-1.5 block text-[10px] font-semibold">Starts</span><input name="startsAt" type="time" required defaultValue={shift?.startLocal ?? "16:00"} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label>
          <label><span className="mb-1.5 block text-[10px] font-semibold">Ends</span><input name="endsAt" type="time" required defaultValue={shift?.endLocal ?? "22:00"} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label>
          <label><span className="mb-1.5 block text-[10px] font-semibold">Employee</span><select name="employeeId" defaultValue={shift?.employeeId ?? ""} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"><option value="">Unassigned</option>{schedule.employees.map((employee) => <option key={employee.id} value={employee.id}>{employee.name}</option>)}</select></label>
          <label><span className="mb-1.5 block text-[10px] font-semibold">Break minutes</span><input name="breakMinutes" type="number" min="0" max="720" defaultValue={shift?.breakMinutes ?? 0} className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label>
          <label className="sm:col-span-2 flex items-center gap-2 rounded-xl bg-[var(--canvas)] px-3 py-3 text-[10px]"><input name="isOpen" type="checkbox" defaultChecked={shift?.isOpen ?? false} className="size-4 accent-[var(--accent)]" />Make this an open, unassigned shift</label>
          <label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] font-semibold">Notes</span><textarea name="notes" rows={3} defaultValue={shift?.notes ?? ""} className="w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2 text-xs" /></label>
          <div className="flex justify-end gap-2 sm:col-span-2"><Button variant="quiet" onClick={onClose}>Cancel</Button><Button type="submit" variant="accent" disabled={busy || !schedule.jobRoles.length}>{busy ? "Saving…" : "Save shift"}</Button></div>
        </form>
      </section>
    </div>
  );
}

function SwapPanel({
  swaps,
  shifts,
  selfEmployeeId,
  canManage,
  busy,
  onOffer,
  onDecide,
}: {
  swaps: LiveSwapRequest[];
  shifts: LiveScheduleShift[];
  selfEmployeeId: string | null;
  canManage: boolean;
  busy: boolean;
  onOffer: (swap: LiveSwapRequest) => void;
  onDecide: (swap: LiveSwapRequest, offerId: string | null, approve: boolean) => void;
}) {
  const pending = swaps.filter((swap) => swap.status === "pending");
  return (
    <section className="mt-9">
      <SectionHeading eyebrow="Coverage workflow" title="Shift swaps" detail="Requests and offers remain pending until management decides" />
      <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
        {pending.map((swap) => {
          const shift = shifts.find((candidate) => candidate.id === swap.shiftId);
          const alreadyOffered = swap.offers.some((offer) => offer.employeeId === selfEmployeeId);
          return <article key={swap.id} className="grid gap-4 py-4 lg:grid-cols-[1fr_auto] lg:items-center"><div><div className="flex flex-wrap items-center gap-2"><p className="text-xs font-semibold">{swap.requestedByName}</p><StatusPill tone="warning">Pending</StatusPill></div><p className="mt-1 text-[10px] text-[var(--ink-faint)]">{shift ? `${shift.date} · ${shift.startLabel}–${shift.endLabel} · ${shift.jobName}` : "Shift details unavailable"}</p><p className="mt-2 text-[10px] leading-4">{swap.reason || "No reason supplied."}</p>{swap.offers.length ? <div className="mt-3 flex flex-wrap gap-2">{swap.offers.map((offer) => <StatusPill key={offer.id} tone="positive">{offer.employeeName} offered</StatusPill>)}</div> : <p className="mt-2 text-[9px] text-[var(--ink-faint)]">No coverage offers yet.</p>}</div><div className="flex flex-wrap gap-2">{selfEmployeeId && selfEmployeeId !== swap.requestedByEmployeeId && !alreadyOffered ? <Button size="sm" variant="secondary" disabled={busy} onClick={() => onOffer(swap)}>Offer to cover</Button> : null}{canManage ? <><Button size="sm" variant="danger" disabled={busy} onClick={() => onDecide(swap, null, false)}>Deny</Button>{swap.offers.map((offer) => <Button key={offer.id} size="sm" variant="accent" disabled={busy} onClick={() => onDecide(swap, offer.id, true)}>Approve {offer.employeeName}</Button>)}</> : null}</div></article>;
        })}
        {!pending.length ? <div className="px-5 py-10 text-center"><CircleDot className="mx-auto size-5 text-[var(--ink-faint)]" /><p className="mt-3 text-xs font-semibold">No pending swap requests</p><p className="mt-1 text-[10px] text-[var(--ink-faint)]">New employee requests will appear here.</p></div> : null}
      </div>
    </section>
  );
}

export function LiveScheduleWorkspace({
  workspace,
  model,
}: {
  workspace: WorkspaceContextValue;
  model: { ok: true; data: LiveScheduleModel } | { ok: false; message: string };
}) {
  if (!model.ok) return <ScheduleReadError message={model.message} />;
  return <LiveScheduleContent workspace={workspace} data={model.data} />;
}

function LiveScheduleContent({ workspace, data }: { workspace: WorkspaceContextValue; data: LiveScheduleModel }) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [notice, setNotice] = useState<{ tone: "success" | "error"; text: string } | null>(null);
  const [shiftDialog, setShiftDialog] = useState<LiveScheduleShift | "new" | null>(null);
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 6 } }), useSensor(KeyboardSensor));
  const draft = data.schedule?.status === "draft";
  const published = data.schedule?.status === "published";

  function run(label: string, operation: () => Promise<LiveResult>, onSuccess?: () => void) {
    setNotice(null);
    startTransition(async () => {
      const result = await operation();
      if (!result.ok) setNotice({ tone: "error", text: result.message });
      else {
        setNotice({ tone: "success", text: label });
        onSuccess?.();
        router.refresh();
      }
    });
  }

  function runStable(
    label: string,
    scope: string,
    payload: Record<string, unknown>,
    operation: (requestId: string) => Promise<LiveResult>,
    onSuccess?: () => void,
  ) {
    run(
      label,
      () => operation(requestIdFor(scope, payload)),
      () => {
        rotateRequestId(scope);
        onSuccess?.();
      },
    );
  }

  function onDragEnd(event: DragEndEvent) {
    const shift = data.shifts.find((candidate) => candidate.id === event.active.id);
    const targetDate = typeof event.over?.id === "string" ? event.over.id : null;
    if (!shift || !targetDate || shift.date === targetDate) return;
    run("Shift moved.", () => moveLiveShiftAction({ shiftId: shift.id, targetDate }));
  }

  function shiftAction(shift: LiveScheduleShift, kind: "ack" | "claim" | "swap" | "reopen") {
    if (kind === "ack") run("Shift acknowledged.", () => acknowledgeShiftAction({ shiftId: shift.id, note: null }));
    if (kind === "claim") {
      const scope = `schedule.shift.claim:${shift.id}`;
      const payload = { shiftId: shift.id };
      runStable("Open shift claimed.", scope, payload, (requestId) => claimLiveOpenShiftAction({ requestId, ...payload }));
    }
    if (kind === "reopen" && window.confirm("Reopen this shift and remove its current assignee?")) {
      const scope = `schedule.shift.reopen:${shift.id}`;
      const payload = { shiftId: shift.id };
      runStable("Shift reopened for coverage.", scope, payload, (requestId) => reopenLiveShiftAction({ requestId, ...payload }));
    }
    if (kind === "swap") {
      const response = window.prompt("Why do you need to swap this shift? (optional)");
      if (response === null) return;
      const reason = response.trim() || null;
      const scope = `schedule.shift.swap-request:${shift.id}`;
      const payload = { shiftId: shift.id, reason };
      runStable("Swap request sent for management review.", scope, payload, (requestId) => requestLiveShiftSwapAction({ requestId, ...payload }));
    }
  }

  function saveScheduleTemplate() {
    const name = window.prompt("Template name")?.trim();
    if (!name || !data.schedule) return;
    const scope = `schedule.template.save:${data.schedule.id}`;
    const payload = { scheduleId: data.schedule.id, name };
    runStable("Reusable schedule template saved.", scope, payload, (requestId) =>
      saveLiveScheduleTemplateAction({ requestId, ...payload }),
    );
  }

  function createNewVersion() {
    const scope = `schedule.create:${workspace.activeLocation.id}:${data.weekStart}`;
    const payload = {
      locationId: workspace.activeLocation.id,
      weekStart: data.weekStart,
      templateId: null,
    };
    runStable("New draft version created.", scope, payload, (requestId) =>
      createLiveScheduleAction({ requestId, ...payload }),
    );
  }

  function submitSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const scope = `schedule.create:${workspace.activeLocation.id}:${data.weekStart}`;
    const payload = {
      locationId: workspace.activeLocation.id,
      weekStart: data.weekStart,
      templateId: String(form.get("templateId") || "") || null,
    };
    runStable("Draft schedule created.", scope, payload, (requestId) =>
      createLiveScheduleAction({ requestId, ...payload }),
    );
  }

  function offerSwap(swap: LiveSwapRequest) {
    const scope = `schedule.swap.offer:${swap.id}`;
    const payload = { swapRequestId: swap.id, message: null };
    runStable("Coverage offer sent.", scope, payload, (requestId) =>
      offerLiveShiftSwapAction({ requestId, ...payload }),
    );
  }

  function decideSwap(swap: LiveSwapRequest, offerId: string | null, approve: boolean) {
    const scope = `schedule.swap.decide:${swap.id}:${offerId ?? "deny"}`;
    const payload = { swapRequestId: swap.id, offerId, approve };
    runStable(
      approve ? "Swap approved and shift reassigned." : "Swap request denied.",
      scope,
      payload,
      (requestId) => decideLiveShiftSwapAction({ requestId, ...payload }),
    );
  }

  function saveShift(payload: Record<string, unknown>) {
    if (!data.schedule) return;
    if (shiftDialog === "new") {
      const createPayload = { ...payload };
      delete createPayload.shiftId;
      const scope = `schedule.shift.create:${data.schedule.id}`;
      runStable(
        "Shift added.",
        scope,
        createPayload,
        (requestId) => createLiveShiftAction({ requestId, ...createPayload }),
        () => setShiftDialog(null),
      );
      return;
    }
    const editPayload = { ...payload };
    delete editPayload.scheduleId;
    run("Shift updated.", () => editLiveShiftAction(editPayload), () => setShiftDialog(null));
  }

  const activeShifts = data.shifts.filter((shift) => shift.status !== "cancelled");
  const hours = activeShifts.reduce((sum, shift) => sum + Math.max(0, (new Date(shift.endsAt).getTime() - new Date(shift.startsAt).getTime()) / 3_600_000 - shift.breakMinutes / 60), 0);

  return (
    <PageFrame width="full" className="max-w-[1680px]">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="flex flex-wrap items-center gap-2"><StatusPill tone={published ? "positive" : draft ? "warning" : "neutral"} dot={published}>{published ? "Published" : draft ? "Draft" : "No schedule"}</StatusPill><span className="text-[10px] text-[var(--ink-faint)]">Live · {workspace.activeLocation.name}</span></div><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Schedule the week clearly</h2><p className="mt-1 text-[11px] text-[var(--ink-faint)]">Restaurant-local time · {data.timeZone}{data.schedule ? ` · version ${data.schedule.version}` : ""}</p></div>
        <div className="flex flex-wrap gap-2">{data.canManage && draft ? <Button variant="secondary" onClick={() => setShiftDialog("new")}><Plus className="size-4" /> Add shift</Button> : null}{data.canManage && draft && data.shifts.length ? <Button variant="quiet" disabled={isPending} onClick={saveScheduleTemplate}>Save template</Button> : null}{data.canManage && draft ? <Button variant="accent" disabled={!data.shifts.length || isPending} onClick={() => run("Schedule published.", () => publishScheduleAction({ scheduleId: data.schedule!.id, note: null }))}><Send className="size-4" /> Publish</Button> : null}{data.canManage && published ? <Button variant="secondary" disabled={isPending} onClick={createNewVersion}><Plus className="size-4" /> New version</Button> : null}</div>
      </div>

      <div className="mt-5 flex items-center justify-between gap-3 border-y border-[var(--line)] py-3"><Link href={`/schedule?week=${data.previousWeek}`} className="focus-ring inline-flex min-h-9 items-center gap-1 rounded-xl px-3 text-xs font-semibold hover:bg-[var(--canvas)]"><ArrowLeft className="size-3.5" /> Previous</Link><div className="text-center"><p className="text-xs font-semibold">Week of {dateLabel(data.weekStart)}</p><p className="mt-1 text-[9px] text-[var(--ink-faint)]">{data.weekStart}–{data.weekDates[6]}</p></div><Link href={`/schedule?week=${data.nextWeek}`} className="focus-ring inline-flex min-h-9 items-center gap-1 rounded-xl px-3 text-xs font-semibold hover:bg-[var(--canvas)]">Next <ArrowRight className="size-3.5" /></Link></div>

      <section aria-label="Schedule metrics" className="grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-b border-[var(--line)] sm:grid-cols-4 sm:divide-y-0"><Metric label="Shifts" value={String(activeShifts.length)} detail={`${activeShifts.filter((shift) => shift.isOpen).length} open`} /><Metric label="Scheduled hours" value={`${hours.toFixed(1)}h`} detail="After planned breaks" /><Metric label="Acknowledged" value={`${activeShifts.filter((shift) => shift.acknowledged).length}/${activeShifts.filter((shift) => !shift.isOpen).length}`} detail="Assigned shifts" /><Metric label="Swap requests" value={String(data.swaps.filter((swap) => swap.status === "pending").length)} detail="Awaiting a decision" /></section>

      {!data.schedule ? <section className="mt-8 rounded-[24px] border border-dashed border-[var(--line-strong)] bg-[var(--paper-strong)] p-7 text-center"><CalendarDays className="mx-auto size-7 text-[var(--ink-faint)]" /><h3 className="mt-4 text-lg font-medium tracking-[-0.035em]">No schedule is visible for this week</h3><p className="mx-auto mt-2 max-w-md text-xs leading-5 text-[var(--ink-faint)]">{data.canManage ? "Start a clean draft or apply a reusable template. Nothing is published until you explicitly approve it." : "Management has not published a schedule in your location scope."}</p>{data.canManage ? <form className="mx-auto mt-6 flex max-w-md flex-col gap-3 sm:flex-row" onSubmit={submitSchedule}><select name="templateId" className="h-11 min-w-0 flex-1 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"><option value="">Blank schedule</option>{data.templates.map((template) => <option key={template.id} value={template.id}>{template.name} · {template.shiftCount} shifts</option>)}</select><Button type="submit" variant="accent" disabled={isPending}><Plus className="size-4" /> Create draft</Button></form> : null}</section> : (
        <DndContext id={`live-schedule-dnd-${data.schedule.id}`} sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}><div className="mt-7 grid gap-3 sm:grid-cols-2 lg:grid-cols-4 2xl:grid-cols-7">{data.weekDates.map((date) => <DayColumn key={date} date={date} shifts={data.shifts.filter((shift) => shift.date === date)} canDrag={Boolean(data.canManage && draft)} canManage={data.canManage} selfEmployeeId={data.selfEmployeeId} published={published} busy={isPending} onEdit={(shift) => setShiftDialog(shift)} onAction={shiftAction} />)}</div></DndContext>
      )}

      {data.schedule ? <SwapPanel swaps={data.swaps} shifts={data.shifts} selfEmployeeId={data.selfEmployeeId} canManage={data.canManage} busy={isPending} onOffer={offerSwap} onDecide={decideSwap} /> : null}

      {notice ? <div aria-live="polite" role="status" className={cn("fixed right-4 bottom-20 z-40 max-w-sm rounded-2xl px-4 py-3 text-xs shadow-lg lg:bottom-5", notice.tone === "success" ? "bg-[var(--positive)] text-white" : "bg-[var(--danger)] text-white")}>{notice.text}</div> : null}
      {shiftDialog && data.schedule ? <ShiftDialog schedule={data} shift={shiftDialog === "new" ? null : shiftDialog} busy={isPending} onClose={() => setShiftDialog(null)} onSave={saveShift} /> : null}
    </PageFrame>
  );
}
