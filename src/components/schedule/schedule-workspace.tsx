"use client";

import {
  DndContext,
  PointerSensor,
  TouchSensor,
  closestCenter,
  useDraggable,
  useDroppable,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import { CSS } from "@dnd-kit/utilities";
import { AnimatePresence, motion } from "motion/react";
import {
  CalendarCheck2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CircleAlert,
  Copy,
  GripVertical,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { cn } from "@/lib/utils";

type Shift = {
  id: string;
  dayId: string;
  person: string;
  role: string;
  start: string;
  end: string;
  hours: number;
  cost: number;
  acknowledged: boolean;
  open?: boolean;
};

const days = [
  { id: "mon", label: "Mon", date: "3" },
  { id: "tue", label: "Tue", date: "4" },
  { id: "wed", label: "Wed", date: "5" },
  { id: "thu", label: "Thu", date: "6" },
  { id: "fri", label: "Fri", date: "7" },
  { id: "sat", label: "Sat", date: "8" },
  { id: "sun", label: "Sun", date: "9" },
];

const initialShifts: Shift[] = [
  { id: "s1", dayId: "mon", person: "Maya Chen", role: "Floor lead", start: "4:00p", end: "11:00p", hours: 7, cost: 168, acknowledged: true },
  { id: "s2", dayId: "mon", person: "Eli Brooks", role: "Bar", start: "4:30p", end: "11:30p", hours: 7, cost: 147, acknowledged: true },
  { id: "s3", dayId: "tue", person: "Sofia Vega", role: "Server", start: "5:00p", end: "10:30p", hours: 5.5, cost: 55, acknowledged: true },
  { id: "s4", dayId: "tue", person: "Noah Martin", role: "Kitchen", start: "2:00p", end: "10:00p", hours: 8, cost: 184, acknowledged: false },
  { id: "s5", dayId: "wed", person: "Ava Scott", role: "Host", start: "5:00p", end: "10:00p", hours: 5, cost: 80, acknowledged: true },
  { id: "s6", dayId: "thu", person: "Open shift", role: "Server", start: "5:00p", end: "11:00p", hours: 6, cost: 60, acknowledged: false, open: true },
  { id: "s7", dayId: "fri", person: "Maya Chen", role: "Floor lead", start: "4:00p", end: "12:00a", hours: 8, cost: 192, acknowledged: true },
  { id: "s8", dayId: "fri", person: "Eli Brooks", role: "Bar", start: "4:00p", end: "12:30a", hours: 8.5, cost: 178.5, acknowledged: false },
  { id: "s9", dayId: "sat", person: "Sofia Vega", role: "Server", start: "4:30p", end: "11:30p", hours: 7, cost: 70, acknowledged: true },
  { id: "s10", dayId: "sat", person: "Noah Martin", role: "Kitchen", start: "1:00p", end: "10:30p", hours: 9.5, cost: 218.5, acknowledged: true },
  { id: "s11", dayId: "sun", person: "Ava Scott", role: "Host", start: "4:30p", end: "9:30p", hours: 5, cost: 80, acknowledged: false },
];

const roleTone: Record<string, string> = {
  "Floor lead": "border-l-[#b56f27]",
  Bar: "border-l-[#6b8f7a]",
  Server: "border-l-[#967caf]",
  Kitchen: "border-l-[#bf675e]",
  Host: "border-l-[#4f88a1]",
};

function ShiftCard({ shift, onSelect }: { shift: Shift; onSelect: () => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: shift.id,
  });

  return (
    <motion.button
      ref={setNodeRef}
      layout
      style={{ transform: CSS.Translate.toString(transform) }}
      onClick={onSelect}
      className={cn(
        "focus-ring group relative w-full rounded-xl border border-[var(--line)] border-l-[3px] bg-[var(--paper-strong)] p-2.5 text-left shadow-[0_1px_0_rgba(0,0,0,.025)] transition-[border,box-shadow,opacity] hover:border-[var(--line-strong)] hover:shadow-sm",
        roleTone[shift.role] || "border-l-[var(--accent)]",
        shift.open && "border-dashed bg-[var(--accent-soft)]/30",
        isDragging && "z-50 opacity-70 shadow-xl",
      )}
      {...attributes}
      {...listeners}
    >
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-[10px] font-semibold">{shift.person}</span>
          <span className="mt-1 block text-[9px] text-[var(--ink-faint)]">{shift.role}</span>
        </span>
        <GripVertical className="size-3 text-[var(--ink-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
      </span>
      <span className="numeric mt-2 flex items-center justify-between text-[9px] text-[var(--ink-soft)]">
        <span>{shift.start}–{shift.end}</span>
        {shift.acknowledged ? (
          <Check aria-label="Acknowledged" className="size-3 text-[var(--positive)]" />
        ) : (
          <span aria-label="Awaiting acknowledgement" className="size-1.5 rounded-full bg-[var(--warning)]" />
        )}
      </span>
      {shift.hours > 6 ? <span className="mt-1 block text-[9px] text-[var(--ink-faint)]">30m unpaid break · manager timing</span> : null}
    </motion.button>
  );
}

function DayColumn({
  day,
  shifts,
  onSelect,
}: {
  day: (typeof days)[number];
  shifts: Shift[];
  onSelect: (shift: Shift) => void;
}) {
  const { isOver, setNodeRef } = useDroppable({ id: day.id });
  const hours = shifts.reduce((sum, shift) => sum + shift.hours, 0);

  return (
    <div className="min-w-[164px] border-r border-[var(--line)] last:border-r-0">
      <div className="sticky top-0 z-10 border-b border-[var(--line)] bg-[var(--paper)] px-3 py-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-semibold text-[var(--ink-soft)]">{day.label}</span>
          <span className={cn("numeric flex size-7 items-center justify-center rounded-full text-[11px] font-semibold", day.id === "sat" ? "bg-[var(--ink)] text-[var(--paper)]" : "text-[var(--ink)]")}>{day.date}</span>
        </div>
        <p className="numeric mt-2 text-[9px] text-[var(--ink-faint)]">{hours}h · {shifts.length} shifts</p>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-[450px] space-y-2 p-2.5 transition-colors",
          isOver && "bg-[var(--accent-soft)]/35",
        )}
      >
        {shifts.map((shift) => (
          <ShiftCard key={shift.id} shift={shift} onSelect={() => onSelect(shift)} />
        ))}
        {!shifts.length ? (
          <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-[var(--line)] text-[9px] text-[var(--ink-faint)]">Drop a shift here</div>
        ) : null}
      </div>
    </div>
  );
}

const employeeScheduleShifts = [
  { id: "irini-tonight", day: "Fri · Aug 8", date: "Tonight", time: "4:00–11:00 PM", hours: 7, role: "Server", covers: 86, status: "confirmed" as const },
  { id: "irini-sat", day: "Sat · Aug 9", date: "Tomorrow", time: "4:30–11:30 PM", hours: 7, role: "Server", covers: 74, status: "published" as const },
];

const employeeOpenShifts = [
  { id: "open-tue", day: "Tue · Aug 11", time: "5:00–11:00 PM", role: "Server", covers: 72 },
  { id: "open-fri", day: "Fri · Aug 14", time: "4:30–11:30 PM", role: "Server", covers: 86 },
];

const chefBackOfHouseShifts = [
  { id: "boh-fri", dayId: "fri", day: "Fri · Aug 8", time: "1:00–11:00 PM", role: "Line cook", people: "Leo M. · Priya S.", status: "Ready" },
  { id: "boh-sat", dayId: "sat", day: "Sat · Aug 9", time: "12:00–11:30 PM", role: "Prep + line", people: "Sam O. · Leo M.", status: "Needs coverage" },
  { id: "boh-sun", dayId: "sun", day: "Sun · Aug 10", time: "12:00–10:00 PM", role: "Prep + line", people: "Priya S. · Open", status: "Open shift" },
];

function ChefScheduleWorkspace() {
  const [published, setPublished] = useState(false);
  const [notice, setNotice] = useState("");
  const [shifts, setShifts] = useState(chefBackOfHouseShifts);
  const [draggedId, setDraggedId] = useState<string | null>(null);

  function moveShift(event: DragEvent<HTMLDivElement>, dayId: string) {
    event.preventDefault();
    if (!draggedId) return;
    const shift = shifts.find((item) => item.id === draggedId);
    if (!shift || shift.dayId === dayId) return;
    const day = shifts.find((item) => item.dayId === dayId)?.day ?? dayId;
    setShifts((current) => current.map((item) => item.id === draggedId ? { ...item, dayId, day } : item));
    setNotice(`${shift.role} moved to ${day}. Publish the BOH schedule when the change is ready.`);
    setDraggedId(null);
  }

  return (
    <PageFrame width="full" className="max-w-[1400px]">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="flex items-center gap-2"><StatusPill tone={published ? "positive" : "warning"} dot>{published ? "Published" : "Draft"}</StatusPill><span className="text-[10px] text-[var(--ink-faint)]">Le Yard · Back of house</span></div><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Kitchen schedule</h2><p className="mt-1 text-[11px] text-[var(--ink-faint)]">Build the BOH plan, assign coverage, and publish the schedule.</p></div>
        <Button variant="accent" size="sm" onClick={() => { setPublished(true); setNotice("Back-of-house schedule published. The team can now see their shifts."); }}><Send className="size-3.5" /> Publish BOH schedule</Button>
      </div>
      {notice ? <p role="status" className="mt-4 rounded-xl bg-[var(--positive-soft)] px-3.5 py-3 text-[10px] text-[var(--positive)]">{notice}</p> : null}
      <section className="mt-7 grid gap-8 lg:grid-cols-[1.4fr_.6fr]">
        <div><SectionHeading eyebrow="Back of house" title="Aug 8–10 service plan" detail="Drag a kitchen shift between days to adjust the BOH plan." /><div className="grid gap-3 md:grid-cols-3">{[{ id: "fri", label: "Fri · Aug 8" }, { id: "sat", label: "Sat · Aug 9" }, { id: "sun", label: "Sun · Aug 10" }].map((day) => <div key={day.id} onDragOver={(event) => event.preventDefault()} onDrop={(event) => moveShift(event, day.id)} className="min-h-48 rounded-[18px] border border-dashed border-[var(--line-strong)] bg-[var(--canvas)] p-2.5"><div className="flex items-center justify-between px-1.5 pb-2"><p className="text-[10px] font-semibold">{day.label}</p><span className="text-[9px] text-[var(--ink-faint)]">Drop here</span></div>{shifts.filter((shift) => shift.dayId === day.id).map((shift) => <div key={shift.id} draggable onDragStart={() => setDraggedId(shift.id)} onDragEnd={() => setDraggedId(null)} className="mb-2 cursor-grab rounded-[14px] border border-[var(--line)] bg-[var(--paper-strong)] p-3 shadow-sm active:cursor-grabbing"><div className="flex items-start justify-between gap-2"><p className="text-[11px] font-semibold">{shift.role}</p><span className="text-[9px] text-[var(--ink-faint)]">Drag</span></div><p className="mt-1 text-[10px] text-[var(--ink-faint)]">{shift.time}</p><p className="mt-2 text-[9px] text-[var(--ink-faint)]">{shift.people}</p><p className="mt-2 text-[9px] text-[var(--ink-faint)]">30m unpaid break · manager timing</p><div className="mt-2"><StatusPill tone={shift.status === "Ready" ? "positive" : "warning"}>{shift.status}</StatusPill></div></div>)}</div>)}</div></div>
        <aside><SectionHeading eyebrow="Coverage" title="Kitchen staffing" detail="Current BOH coverage before publishing." /><div className="border-y border-[var(--line)]"><div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-4 first:border-0"><span className="text-[11px] text-[var(--ink-faint)]">Line coverage</span><StatusPill tone="positive">2 / 2</StatusPill></div><div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-4"><span className="text-[11px] text-[var(--ink-faint)]">Prep coverage</span><StatusPill tone="warning">1 open</StatusPill></div><div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-4"><span className="text-[11px] text-[var(--ink-faint)]">Recipes to review</span><StatusPill tone="neutral">2</StatusPill></div></div></aside>
      </section>
    </PageFrame>
  );
}

function EmployeeScheduleWorkspace() {
  const [releasePending, setReleasePending] = useState<string | null>(null);
  const [claimPending, setClaimPending] = useState<string | null>(null);
  const [panel, setPanel] = useState<"time-off" | "availability" | null>(null);
  const [notice, setNotice] = useState("");

  function requestTimeOff(kind: "Full day" | "Lunch" | "Dinner") {
    setNotice(`${kind} time-off request sent to Donald and Maris for approval.`);
    setPanel(null);
  }

  function blockAvailability(kind: "Lunch" | "Dinner") {
    setNotice(`${kind} availability blocked for this week. Managers will see the update before publishing.`);
    setPanel(null);
  }

  return (
    <PageFrame width="full" className="max-w-[1400px]">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div><div className="flex items-center gap-2"><StatusPill tone="positive" dot>Published</StatusPill><span className="text-[10px] text-[var(--ink-faint)]">Le Yard · Aug 3–9</span></div><h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Your schedule</h2><p className="mt-1 text-[11px] text-[var(--ink-faint)]">See your shifts, offer coverage, and tell managers when you are unavailable.</p></div>
        <div className="flex flex-wrap gap-2"><Button variant="secondary" size="sm" onClick={() => setPanel("availability")}><Clock3 className="size-3.5" /> Block availability</Button><Button variant="accent" size="sm" onClick={() => setPanel("time-off")}><CalendarCheck2 className="size-3.5" /> Request time off</Button></div>
      </div>

      {notice ? <p role="status" className="mt-4 rounded-xl bg-[var(--positive-soft)] px-3.5 py-3 text-[10px] text-[var(--positive)]">{notice}</p> : null}

      <section className="mt-7">
        <SectionHeading eyebrow="Priority" title="Open shifts & swaps" detail="Pick up a shift if it works for you. It is not yours until a manager approves it." />
        <div className="border-y border-[var(--line)]">
          {employeeOpenShifts.map((shift) => {
            const pending = claimPending === shift.id;
            return <div key={shift.id} className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] px-3 py-4 first:border-0"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]"><CalendarCheck2 className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{shift.day} · {shift.role}</p><p className="mt-1 text-[10px] text-[var(--ink-faint)]">{shift.time} · {shift.covers} covers scheduled</p></div>{pending ? <StatusPill tone="warning">Pending manager approval</StatusPill> : <Button variant="secondary" size="sm" onClick={() => { setClaimPending(shift.id); setNotice("Pickup request sent. Donald or Maris must approve it before the shift is added to your schedule."); }}>Ask to pick up</Button>}</div>;
          })}
        </div>
      </section>

      <section className="mt-8">
        <SectionHeading eyebrow="Your shifts" title="This week at Le Yard" detail="Covers are shown for service planning; pay is in Earnings." />
        <div className="border-y border-[var(--line)]">
          {employeeScheduleShifts.map((shift) => {
            const pending = releasePending === shift.id;
            return <div key={shift.id} className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] px-3 py-4 first:border-0"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)] text-[var(--ink-faint)]"><CalendarCheck2 className="size-4" /></span><div className="min-w-0 flex-1"><p className="text-xs font-semibold">{shift.day} · {shift.role}</p><p className="mt-1 text-[10px] text-[var(--ink-faint)]">{shift.time} · {shift.covers} covers scheduled</p>{shift.hours > 6 ? <p className="mt-1 text-[9px] text-[var(--ink-faint)]">30m unpaid break · manager timing</p> : null}</div>{pending ? <StatusPill tone="warning">Release pending approval</StatusPill> : shift.status === "confirmed" ? <><StatusPill tone="positive">Confirmed</StatusPill><Button variant="quiet" size="sm" onClick={() => { setReleasePending(shift.id); setNotice("Release request sent. The shift remains yours until Donald or Maris approves the release."); }}>Release shift</Button></> : <StatusPill tone="neutral">Published</StatusPill>}</div>;
          })}
        </div>
      </section>

      <section className="mt-8 grid gap-8 lg:grid-cols-2">
        <div><SectionHeading eyebrow="Availability" title="Block a part of a day" detail="Lunch and dinner can be blocked separately." /><div className="border-y border-[var(--line)]"><div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-3 py-4 first:border-0"><div><p className="text-xs font-semibold">Wed · Aug 12</p><p className="mt-1 text-[10px] text-[var(--ink-faint)]">Lunch · 11:00 AM–3:00 PM</p></div><Button variant="secondary" size="sm" onClick={() => blockAvailability("Lunch")}>Block lunch</Button></div><div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-3 py-4"><div><p className="text-xs font-semibold">Sun · Aug 16</p><p className="mt-1 text-[10px] text-[var(--ink-faint)]">Dinner · 4:00–11:00 PM</p></div><Button variant="secondary" size="sm" onClick={() => blockAvailability("Dinner")}>Block dinner</Button></div></div></div>
        <div><SectionHeading eyebrow="Approval trail" title="Requests stay visible" detail="You will see the decision here when a manager reviews it." /><div className="border-y border-[var(--line)]"><div className="flex items-center gap-3 px-3 py-4"><StatusPill tone="warning">Example</StatusPill><p className="text-[10px] leading-4 text-[var(--ink-faint)]">Release and pickup requests never silently change your schedule.</p></div></div></div>
      </section>

      {panel ? <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-blur-[3px]" onMouseDown={(event) => { if (event.currentTarget === event.target) setPanel(null); }}><div role="dialog" aria-modal="true" className="w-full max-w-md rounded-[22px] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-float)]"><div className="flex items-start justify-between"><div><p className="eyebrow">{panel === "time-off" ? "Time off" : "Availability"}</p><h3 className="mt-2 text-lg font-semibold">{panel === "time-off" ? "Tell managers when you need off" : "Block a partial shift"}</h3></div><Button variant="quiet" size="icon" aria-label="Close request" onClick={() => setPanel(null)}><X className="size-4" /></Button></div>{panel === "time-off" ? <div className="mt-6 grid gap-2"><Button variant="secondary" onClick={() => requestTimeOff("Full day")}>Full day · Aug 15</Button><Button variant="secondary" onClick={() => requestTimeOff("Lunch")}>Lunch · Aug 15</Button><Button variant="secondary" onClick={() => requestTimeOff("Dinner")}>Dinner · Aug 15</Button></div> : <div className="mt-6 grid gap-2"><Button variant="secondary" onClick={() => blockAvailability("Lunch")}>Block lunch · Aug 12</Button><Button variant="secondary" onClick={() => blockAvailability("Dinner")}>Block dinner · Aug 16</Button></div>}</div></div> : null}
    </PageFrame>
  );
}

function ManagerScheduleWorkspace() {
  const [shifts, setShifts] = useState(initialShifts);
  const [selected, setSelected] = useState<Shift | null>(null);
  const [published, setPublished] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, { activationConstraint: { delay: 180, tolerance: 5 } }),
  );

  const totals = useMemo(
    () => ({
      hours: shifts.reduce((sum, shift) => sum + shift.hours, 0),
      cost: shifts.reduce((sum, shift) => sum + shift.cost, 0),
      pending: shifts.filter((shift) => !shift.acknowledged).length,
      open: shifts.filter((shift) => shift.open).length,
    }),
    [shifts],
  );

  function onDragEnd(event: DragEndEvent) {
    const targetDay = event.over?.id;
    if (!targetDay || !days.some((day) => day.id === targetDay)) return;
    setShifts((current) =>
      current.map((shift) =>
        shift.id === event.active.id ? { ...shift, dayId: String(targetDay) } : shift,
      ),
    );
    setPublished(false);
  }

  function addShift(formData: FormData) {
    const person = String(formData.get("person") || "Open shift");
    const role = String(formData.get("role") || "Server");
    const dayId = String(formData.get("dayId") || "mon");
    const start = String(formData.get("start") || "5:00p");
    const end = String(formData.get("end") || "11:00p");
    setShifts((current) => [
      ...current,
      {
        id: `shift-${Date.now()}`,
        dayId,
        person,
        role,
        start,
        end,
        hours: 6,
        cost: role === "Kitchen" ? 138 : 72,
        acknowledged: false,
        open: person === "Open shift",
      },
    ]);
    setPublished(false);
    setAddOpen(false);
  }

  return (
    <PageFrame width="full" className="max-w-[1700px]">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill tone={published ? "positive" : "warning"} dot>
              {published ? "Published" : "Draft changes"}
            </StatusPill>
            <span className="text-[10px] text-[var(--ink-faint)]">Version 12</span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">Dinner schedule</h2>
          <p className="mt-1 text-[11px] text-[var(--ink-faint)]">Drag shifts between days. Publishing creates a new auditable version.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="quiet" size="sm" aria-label="Previous week"><ChevronLeft className="size-3" /></Button>
          <Button variant="secondary" size="sm">This week</Button>
          <Button variant="quiet" size="sm" aria-label="Next week"><ChevronRight className="size-3" /></Button>
          <Button variant="secondary" size="sm"><Copy className="size-3.5" /> Templates</Button>
          <Button variant="secondary" size="sm" onClick={() => setAddOpen(true)}><Plus className="size-3.5" /> Add shift</Button>
          <Button variant="accent" size="sm" onClick={() => setPublished(true)} disabled={published}><Send className="size-3.5" /> {published ? "Published" : "Publish schedule"}</Button>
        </div>
      </div>

      <section aria-label="Schedule metrics" className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric label="Scheduled hours" value={`${totals.hours}h`} detail="Across 11 shift blocks" />
        <Metric label="Estimated labor" value={`$${totals.cost.toLocaleString()}`} detail="Before payroll burden" trend={{ label: "21.8%", tone: "neutral" }} />
        <Metric label="Open shifts" value={String(totals.open)} detail="Claimable by eligible staff" trend={{ label: totals.open ? "Needs fill" : "Covered", tone: totals.open ? "negative" : "positive" }} />
        <Metric label="Acknowledgements" value={`${shifts.length - totals.pending}/${shifts.length}`} detail={`${totals.pending} people pending`} />
      </section>

      <div className="mt-5 flex items-center justify-between gap-3 rounded-xl bg-[var(--warning-soft)] px-3.5 py-2.5 text-[10px] text-[var(--warning)]">
        <span className="flex items-center gap-2"><CircleAlert className="size-3.5" /> One overtime warning: Noah reaches 42.5 projected hours.</span>
        <button className="font-semibold underline decoration-current/30 underline-offset-2">Review</button>
      </div>

      <DndContext id="demo-schedule-dnd" sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <section className="mt-5 overflow-x-auto rounded-[18px] border border-[var(--line)] bg-[var(--paper)]">
          <div className="grid min-w-[1148px] grid-cols-7">
            {days.map((day) => (
              <DayColumn
                key={day.id}
                day={day}
                shifts={shifts.filter((shift) => shift.dayId === day.id)}
                onSelect={setSelected}
              />
            ))}
          </div>
        </section>
      </DndContext>

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-[9px] text-[var(--ink-faint)]">
        {Object.entries(roleTone).map(([role, color]) => (
          <span key={role} className="flex items-center gap-1.5"><span className={cn("h-3 w-0.5 rounded-full border-l-2", color)} />{role}</span>
        ))}
        <span className="ml-auto flex items-center gap-1.5"><Check className="size-3 text-[var(--positive)]" /> Acknowledged</span>
      </div>

      <AnimatePresence>
        {selected ? (
          <motion.div className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[2px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setSelected(null); }}>
            <motion.aside className="absolute inset-y-0 right-0 w-[min(92vw,430px)] overflow-y-auto bg-[var(--paper-strong)] p-5 shadow-2xl sm:p-7" initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", stiffness: 360, damping: 36 }}>
              <div className="flex items-start justify-between">
                <div><p className="eyebrow">Shift detail</p><h3 className="mt-3 text-xl font-medium tracking-[-0.04em]">{selected.person}</h3></div>
                <Button variant="quiet" size="icon" aria-label="Close shift" onClick={() => setSelected(null)}><X className="size-4" /></Button>
              </div>
              <div className="mt-7 flex items-center gap-3 border-y border-[var(--line)] py-4">
                <Avatar name={selected.person} size="lg" />
                <div><p className="text-sm font-semibold">{selected.role}</p><p className="numeric mt-1 text-[11px] text-[var(--ink-faint)]">{selected.start}–{selected.end} · {selected.hours} hours</p></div>
              </div>
              <dl className="mt-6 space-y-4 text-xs">
                <div className="flex justify-between"><dt className="text-[var(--ink-faint)]">Day</dt><dd className="font-semibold">{days.find((day) => day.id === selected.dayId)?.label}, Aug {days.find((day) => day.id === selected.dayId)?.date}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--ink-faint)]">Labor estimate</dt><dd className="numeric font-semibold">${selected.cost.toFixed(2)}</dd></div>
                <div className="flex justify-between"><dt className="text-[var(--ink-faint)]">Status</dt><dd><StatusPill tone={selected.acknowledged ? "positive" : "warning"}>{selected.acknowledged ? "Acknowledged" : "Awaiting response"}</StatusPill></dd></div>
              </dl>
              {!selected.acknowledged ? (
                <div className="mt-8 rounded-[16px] bg-[var(--accent-soft)]/50 p-4">
                  <p className="text-xs font-semibold">Employee preview</p>
                  <p className="mt-1 text-[10px] leading-4 text-[var(--ink-faint)]">Use this to verify the acknowledgement flow in demo mode.</p>
                  <Button className="mt-4 w-full" variant="accent" onClick={() => { setShifts((current) => current.map((shift) => shift.id === selected.id ? { ...shift, acknowledged: true } : shift)); setSelected((current) => current ? { ...current, acknowledged: true } : current); }}><CalendarCheck2 className="size-4" /> Acknowledge shift</Button>
                </div>
              ) : null}
            </motion.aside>
          </motion.div>
        ) : null}

        {addOpen ? (
          <motion.div className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-blur-[3px]" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onMouseDown={(event) => { if (event.target === event.currentTarget) setAddOpen(false); }}>
            <motion.div role="dialog" aria-modal="true" aria-label="Add shift" className="w-full max-w-lg rounded-[22px] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-float)] sm:p-6" initial={{ y: 12, scale: .98 }} animate={{ y: 0, scale: 1 }} exit={{ y: 8, scale: .98 }}>
              <div className="flex items-center justify-between"><div><p className="eyebrow">Schedule</p><h3 className="mt-2 text-lg font-semibold">Add a shift</h3></div><Button variant="quiet" size="icon" onClick={() => setAddOpen(false)}><X className="size-4" /></Button></div>
              <form action={addShift} className="mt-6 grid gap-4 sm:grid-cols-2">
                <label className="sm:col-span-2"><span className="mb-1.5 block text-[10px] font-semibold">Team member</span><select name="person" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"><option>Open shift</option><option>Maya Chen</option><option>Eli Brooks</option><option>Sofia Vega</option><option>Noah Martin</option><option>Ava Scott</option></select></label>
                <label><span className="mb-1.5 block text-[10px] font-semibold">Day</span><select name="dayId" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs">{days.map((day) => <option key={day.id} value={day.id}>{day.label}, Aug {day.date}</option>)}</select></label>
                <label><span className="mb-1.5 block text-[10px] font-semibold">Role</span><select name="role" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs">{Object.keys(roleTone).map((role) => <option key={role}>{role}</option>)}</select></label>
                <label><span className="mb-1.5 block text-[10px] font-semibold">Starts</span><input name="start" defaultValue="5:00p" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label>
                <label><span className="mb-1.5 block text-[10px] font-semibold">Ends</span><input name="end" defaultValue="11:00p" className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs" /></label>
                <div className="mt-2 flex justify-end gap-2 sm:col-span-2"><Button variant="quiet" onClick={() => setAddOpen(false)}>Cancel</Button><Button type="submit" variant="accent"><Plus className="size-3.5" /> Add shift</Button></div>
              </form>
            </motion.div>
          </motion.div>
        ) : null}
      </AnimatePresence>

      <div className="mt-8 flex items-center gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-[10px] text-[var(--ink-faint)]">
        <Sparkles className="size-4 shrink-0 text-[var(--accent)]" />
        <span className="flex-1">Staffing insight: Saturday’s bar is covered, but adding one support shift from 7–9 PM would reduce projected ticket time by 4 minutes.</span>
        <Button variant="quiet" size="sm">Review suggestion</Button>
      </div>
    </PageFrame>
  );
}

export function ScheduleWorkspace() {
  const workspace = useWorkspaceContext();
  if (workspace.role === "employee") return <EmployeeScheduleWorkspace />;
  if (workspace.persona === "chef") return <ChefScheduleWorkspace />;
  return <ManagerScheduleWorkspace />;
}
