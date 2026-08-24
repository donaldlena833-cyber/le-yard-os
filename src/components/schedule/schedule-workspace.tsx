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
import { motion } from "motion/react";
import {
  CalendarCheck2,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  CircleAlert,
  Copy,
  GripVertical,
  Pencil,
  Plus,
  Send,
  Sparkles,
  X,
} from "lucide-react";
import { useMemo, useState, type DragEvent } from "react";
import { ObjectActionBar } from "@/components/actions/object-action-bar";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { ScheduleAgenda } from "@/components/schedule/schedule-agenda";
import { Avatar } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { Drawer } from "@/components/ui/drawer";
import { Metric, PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { Modal } from "@/components/ui/modal";
import { StatusPill } from "@/components/ui/status-pill";
import {
  resolveWorkMode,
  type ActionResolutionContext,
} from "@/lib/actions/action-registry";
import { demoIds } from "@/lib/demo";
import { cn } from "@/lib/utils";

type Shift = {
  id: string;
  dayId: string;
  personId: string | null;
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
  {
    id: "s1",
    dayId: "mon",
    personId: demoIds.people.maris,
    person: "Maris",
    role: "Floor lead",
    start: "4:00p",
    end: "11:00p",
    hours: 7,
    cost: 168,
    acknowledged: true,
  },
  {
    id: "s2",
    dayId: "mon",
    personId: demoIds.people.irini,
    person: "Irini",
    role: "Server",
    start: "4:30p",
    end: "11:30p",
    hours: 7,
    cost: 147,
    acknowledged: true,
  },
  {
    id: "s3",
    dayId: "tue",
    personId: demoIds.people.irini,
    person: "Irini",
    role: "Server",
    start: "5:00p",
    end: "10:30p",
    hours: 5.5,
    cost: 55,
    acknowledged: true,
  },
  {
    id: "s4",
    dayId: "tue",
    personId: demoIds.people.mateo,
    person: "Mateo",
    role: "Kitchen",
    start: "2:00p",
    end: "10:00p",
    hours: 8,
    cost: 184,
    acknowledged: false,
  },
  {
    id: "s5",
    dayId: "wed",
    personId: demoIds.people.donald,
    person: "Donald",
    role: "Floor lead",
    start: "5:00p",
    end: "10:00p",
    hours: 5,
    cost: 80,
    acknowledged: true,
  },
  {
    id: "s6",
    dayId: "thu",
    personId: null,
    person: "Open shift",
    role: "Server",
    start: "5:00p",
    end: "11:00p",
    hours: 6,
    cost: 60,
    acknowledged: false,
    open: true,
  },
  {
    id: "s7",
    dayId: "fri",
    personId: demoIds.people.maris,
    person: "Maris",
    role: "Floor lead",
    start: "4:00p",
    end: "12:00a",
    hours: 8,
    cost: 192,
    acknowledged: true,
  },
  {
    id: "s8",
    dayId: "fri",
    personId: demoIds.people.irini,
    person: "Irini",
    role: "Server",
    start: "4:00p",
    end: "12:30a",
    hours: 8.5,
    cost: 178.5,
    acknowledged: false,
  },
  {
    id: "s9",
    dayId: "sat",
    personId: demoIds.people.irini,
    person: "Irini",
    role: "Server",
    start: "4:30p",
    end: "11:30p",
    hours: 7,
    cost: 70,
    acknowledged: true,
  },
  {
    id: "s10",
    dayId: "sat",
    personId: demoIds.people.mateo,
    person: "Mateo",
    role: "Kitchen",
    start: "1:00p",
    end: "10:30p",
    hours: 9.5,
    cost: 218.5,
    acknowledged: true,
  },
  {
    id: "s11",
    dayId: "sun",
    personId: demoIds.people.donald,
    person: "Donald",
    role: "Floor lead",
    start: "4:30p",
    end: "9:30p",
    hours: 5,
    cost: 80,
    acknowledged: false,
  },
];

const roleTone: Record<string, string> = {
  "Floor lead": "border-l-[#b56f27]",
  Bar: "border-l-[#6b8f7a]",
  Server: "border-l-[#967caf]",
  Kitchen: "border-l-[#bf675e]",
  Host: "border-l-[#4f88a1]",
};

function ShiftCard({
  shift,
  onSelect,
  draggable = true,
}: {
  shift: Shift;
  onSelect: () => void;
  draggable?: boolean;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: shift.id,
      disabled: !draggable,
    });

  return (
    <motion.button
      ref={setNodeRef}
      layout
      style={{ transform: CSS.Translate.toString(transform) }}
      onClick={onSelect}
      className={cn(
        "focus-ring group relative min-h-11 w-full rounded-xl border border-[var(--line)] border-l-[3px] bg-[var(--paper-strong)] p-2.5 text-left shadow-[0_1px_0_rgba(0,0,0,.025)] transition-[border,box-shadow,opacity] hover:border-[var(--line-strong)] hover:shadow-sm",
        roleTone[shift.role] || "border-l-[var(--accent)]",
        shift.open && "border-dashed bg-[var(--accent-soft)]/30",
        isDragging && "z-50 opacity-70 shadow-xl",
      )}
      {...(draggable ? attributes : {})}
      {...(draggable ? listeners : {})}
    >
      <span className="flex items-start gap-2">
        <span className="min-w-0 flex-1">
          <span className="block truncate text-xs font-semibold">
            {shift.person}
          </span>
          <span className="mt-1 block text-xs text-[var(--ink-faint)]">
            {shift.role}
          </span>
        </span>
        {draggable ? (
          <GripVertical className="size-3 text-[var(--ink-faint)] opacity-0 transition-opacity group-hover:opacity-100" />
        ) : null}
      </span>
      <span className="numeric mt-2 flex items-center justify-between text-xs text-[var(--ink-soft)]">
        <span>
          {shift.start}–{shift.end}
        </span>
        {shift.acknowledged ? (
          <Check
            aria-label="Acknowledged"
            className="size-3 text-[var(--positive)]"
          />
        ) : (
          <span
            aria-label="Awaiting acknowledgement"
            className="size-1.5 rounded-full bg-[var(--warning)]"
          />
        )}
      </span>
      {shift.hours > 6 ? (
        <span className="mt-1 block text-xs text-[var(--ink-faint)]">
          30m unpaid break · manager timing
        </span>
      ) : null}
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
          <span className="text-xs font-semibold text-[var(--ink-soft)]">
            {day.label}
          </span>
          <span
            className={cn(
              "numeric flex size-7 items-center justify-center rounded-full text-[13px] font-semibold",
              day.id === "sat"
                ? "bg-[var(--ink)] text-[var(--paper)]"
                : "text-[var(--ink)]",
            )}
          >
            {day.date}
          </span>
        </div>
        <p className="numeric mt-2 text-xs text-[var(--ink-faint)]">
          {hours}h · {shifts.length} shifts
        </p>
      </div>
      <div
        ref={setNodeRef}
        className={cn(
          "min-h-[450px] space-y-2 p-2.5 transition-colors",
          isOver && "bg-[var(--accent-soft)]/35",
        )}
      >
        {shifts.map((shift) => (
          <ShiftCard
            key={shift.id}
            shift={shift}
            onSelect={() => onSelect(shift)}
          />
        ))}
        {!shifts.length ? (
          <div className="flex h-24 items-center justify-center rounded-xl border border-dashed border-[var(--line)] text-xs text-[var(--ink-faint)]">
            Drop a shift here
          </div>
        ) : null}
      </div>
    </div>
  );
}

const employeeScheduleShifts = [
  {
    id: "irini-tonight",
    day: "Fri · Aug 8",
    date: "Tonight",
    time: "4:00–11:00 PM",
    hours: 7,
    role: "Server",
    covers: 86,
    status: "confirmed" as const,
  },
  {
    id: "irini-sat",
    day: "Sat · Aug 9",
    date: "Tomorrow",
    time: "4:30–11:30 PM",
    hours: 7,
    role: "Server",
    covers: 74,
    status: "published" as const,
  },
];

const employeeOpenShifts = [
  {
    id: "open-tue",
    day: "Tue · Aug 11",
    time: "5:00–11:00 PM",
    role: "Server",
    covers: 72,
  },
  {
    id: "open-fri",
    day: "Fri · Aug 14",
    time: "4:30–11:30 PM",
    role: "Server",
    covers: 86,
  },
];

const chefBackOfHouseShifts = [
  {
    id: "boh-fri",
    dayId: "fri",
    day: "Fri · Aug 8",
    time: "1:00–11:00 PM",
    role: "Line cook",
    people: "Mateo",
    status: "Ready",
  },
  {
    id: "boh-sat",
    dayId: "sat",
    day: "Sat · Aug 9",
    time: "12:00–11:30 PM",
    role: "Prep + line",
    people: "Mateo · Unassigned",
    status: "Needs coverage",
  },
  {
    id: "boh-sun",
    dayId: "sun",
    day: "Sun · Aug 10",
    time: "12:00–10:00 PM",
    role: "Prep + line",
    people: "Unassigned",
    status: "Open shift",
  },
];

function ChefScheduleWorkspace({
  managerMode = false,
  onBackToFoh,
}: {
  managerMode?: boolean;
  onBackToFoh?: () => void;
}) {
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
    setShifts((current) =>
      current.map((item) =>
        item.id === draggedId ? { ...item, dayId, day } : item,
      ),
    );
    setNotice(
      `${shift.role} moved to ${day}. Publish the BOH schedule when the change is ready.`,
    );
    setDraggedId(null);
  }

  return (
    <PageFrame width="full" className="max-w-[1400px]">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill tone={published ? "positive" : "warning"} dot>
              {published ? "Published" : "Draft"}
            </StatusPill>
            <span className="text-xs text-[var(--ink-faint)]">
              Le Yard · Back of house
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">
            {managerMode ? "BOH schedule" : "Kitchen schedule"}
          </h2>
          <p className="mt-1 text-[13px] text-[var(--ink-faint)]">
            Build the BOH plan, assign coverage, and publish the schedule.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {managerMode && onBackToFoh ? (
            <Button variant="secondary" size="sm" onClick={onBackToFoh}>
              <ChevronLeft className="size-3.5" /> FOH schedule
            </Button>
          ) : null}
          <Button
            variant="accent"
            size="sm"
            onClick={() => {
              setPublished(true);
              setNotice(
                "Back-of-house schedule published. The team can now see their shifts.",
              );
            }}
          >
            <Send className="size-3.5" /> Publish BOH schedule
          </Button>
        </div>
      </div>
      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-xl bg-[var(--positive-soft)] px-3.5 py-3 text-xs text-[var(--positive)]"
        >
          {notice}
        </p>
      ) : null}
      <section className="mt-7 grid gap-8 lg:grid-cols-[1.4fr_.6fr]">
        <div>
          <SectionHeading
            eyebrow="Back of house"
            title="Aug 8–10 service plan"
            detail="Drag a kitchen shift between days to adjust the BOH plan."
          />
          <div className="grid gap-3 md:grid-cols-3">
            {[
              { id: "fri", label: "Fri · Aug 8" },
              { id: "sat", label: "Sat · Aug 9" },
              { id: "sun", label: "Sun · Aug 10" },
            ].map((day) => (
              <div
                key={day.id}
                onDragOver={(event) => event.preventDefault()}
                onDrop={(event) => moveShift(event, day.id)}
                className="min-h-48 rounded-[18px] border border-dashed border-[var(--line-strong)] bg-[var(--canvas)] p-2.5"
              >
                <div className="flex items-center justify-between px-1.5 pb-2">
                  <p className="text-xs font-semibold">{day.label}</p>
                  <span className="text-xs text-[var(--ink-faint)]">
                    Drop here
                  </span>
                </div>
                {shifts
                  .filter((shift) => shift.dayId === day.id)
                  .map((shift) => (
                    <div
                      key={shift.id}
                      draggable
                      onDragStart={() => setDraggedId(shift.id)}
                      onDragEnd={() => setDraggedId(null)}
                      className="mb-2 cursor-grab rounded-[14px] border border-[var(--line)] bg-[var(--paper-strong)] p-3 shadow-sm active:cursor-grabbing"
                    >
                      <div className="flex items-start justify-between gap-2">
                        <p className="text-[13px] font-semibold">
                          {shift.role}
                        </p>
                        <span className="text-xs text-[var(--ink-faint)]">
                          Drag
                        </span>
                      </div>
                      <p className="mt-1 text-xs text-[var(--ink-faint)]">
                        {shift.time}
                      </p>
                      <p className="mt-2 text-xs text-[var(--ink-faint)]">
                        {shift.people}
                      </p>
                      <p className="mt-2 text-xs text-[var(--ink-faint)]">
                        30m unpaid break · manager timing
                      </p>
                      <div className="mt-2">
                        <StatusPill
                          tone={
                            shift.status === "Ready" ? "positive" : "warning"
                          }
                        >
                          {shift.status}
                        </StatusPill>
                      </div>
                    </div>
                  ))}
              </div>
            ))}
          </div>
        </div>
        <aside>
          <SectionHeading
            eyebrow="Coverage"
            title="Kitchen staffing"
            detail="Current BOH coverage before publishing."
          />
          <div className="border-y border-[var(--line)]">
            <div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-4 first:border-0">
              <span className="text-[13px] text-[var(--ink-faint)]">
                Line coverage
              </span>
              <StatusPill tone="positive">2 / 2</StatusPill>
            </div>
            <div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-4">
              <span className="text-[13px] text-[var(--ink-faint)]">
                Prep coverage
              </span>
              <StatusPill tone="warning">1 open</StatusPill>
            </div>
            <div className="flex items-center justify-between border-t border-[var(--line)] px-3 py-4">
              <span className="text-[13px] text-[var(--ink-faint)]">
                Recipes to review
              </span>
              <StatusPill tone="neutral">2</StatusPill>
            </div>
          </div>
        </aside>
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
    setNotice(
      `${kind} time-off request sent to Donald and Maris for approval.`,
    );
    setPanel(null);
  }

  function blockAvailability(kind: "Lunch" | "Dinner") {
    setNotice(
      `${kind} availability blocked for this week. Managers will see the update before publishing.`,
    );
    setPanel(null);
  }

  return (
    <PageFrame width="full" className="max-w-[1400px]">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill tone="positive" dot>
              Published
            </StatusPill>
            <span className="text-xs text-[var(--ink-faint)]">
              Le Yard · Aug 3–9
            </span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">
            Your schedule
          </h2>
          <p className="mt-1 text-[13px] text-[var(--ink-faint)]">
            See your shifts, offer coverage, and tell managers when you are
            unavailable.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setPanel("availability")}
          >
            <Clock3 className="size-3.5" /> Block availability
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={() => setPanel("time-off")}
          >
            <CalendarCheck2 className="size-3.5" /> Request time off
          </Button>
        </div>
      </div>

      {notice ? (
        <p
          role="status"
          className="mt-4 rounded-xl bg-[var(--positive-soft)] px-3.5 py-3 text-xs text-[var(--positive)]"
        >
          {notice}
        </p>
      ) : null}

      <section className="mt-7">
        <SectionHeading
          eyebrow="Priority"
          title="Open shifts & swaps"
          detail="Pick up a shift if it works for you. It is not yours until a manager approves it."
        />
        <div className="border-y border-[var(--line)]">
          {employeeOpenShifts.map((shift) => {
            const pending = claimPending === shift.id;
            return (
              <div
                key={shift.id}
                className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] px-3 py-4 first:border-0"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                  <CalendarCheck2 className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold">
                    {shift.day} · {shift.role}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    {shift.time} · {shift.covers} covers scheduled
                  </p>
                </div>
                {pending ? (
                  <StatusPill tone="warning">
                    Pending manager approval
                  </StatusPill>
                ) : (
                  <Button
                    variant="secondary"
                    size="sm"
                    onClick={() => {
                      setClaimPending(shift.id);
                      setNotice(
                        "Pickup request sent. Donald or Maris must approve it before the shift is added to your schedule.",
                      );
                    }}
                  >
                    Ask to pick up
                  </Button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8">
        <SectionHeading
          eyebrow="Your shifts"
          title="This week at Le Yard"
          detail="Covers are shown for service planning; pay is in Earnings."
        />
        <div className="border-y border-[var(--line)]">
          {employeeScheduleShifts.map((shift) => {
            const pending = releasePending === shift.id;
            return (
              <div
                key={shift.id}
                className="flex flex-wrap items-center gap-4 border-t border-[var(--line)] px-3 py-4 first:border-0"
              >
                <span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-[var(--canvas-strong)] text-[var(--ink-faint)]">
                  <CalendarCheck2 className="size-4" />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-semibold">
                    {shift.day} · {shift.role}
                  </p>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    {shift.time} · {shift.covers} covers scheduled
                  </p>
                  {shift.hours > 6 ? (
                    <p className="mt-1 text-xs text-[var(--ink-faint)]">
                      30m unpaid break · manager timing
                    </p>
                  ) : null}
                </div>
                {pending ? (
                  <StatusPill tone="warning">
                    Release pending approval
                  </StatusPill>
                ) : shift.status === "confirmed" ? (
                  <>
                    <StatusPill tone="positive">Confirmed</StatusPill>
                    <Button
                      variant="quiet"
                      size="sm"
                      onClick={() => {
                        setReleasePending(shift.id);
                        setNotice(
                          "Release request sent. The shift remains yours until Donald or Maris approves the release.",
                        );
                      }}
                    >
                      Release shift
                    </Button>
                  </>
                ) : (
                  <StatusPill tone="neutral">Published</StatusPill>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <section className="mt-8 grid gap-8 lg:grid-cols-2">
        <div>
          <SectionHeading
            eyebrow="Availability"
            title="Block a part of a day"
            detail="Lunch and dinner can be blocked separately."
          />
          <div className="border-y border-[var(--line)]">
            <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-3 py-4 first:border-0">
              <div>
                <p className="text-xs font-semibold">Wed · Aug 12</p>
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  Lunch · 11:00 AM–3:00 PM
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => blockAvailability("Lunch")}
              >
                Block lunch
              </Button>
            </div>
            <div className="flex items-center justify-between gap-3 border-t border-[var(--line)] px-3 py-4">
              <div>
                <p className="text-xs font-semibold">Sun · Aug 16</p>
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  Dinner · 4:00–11:00 PM
                </p>
              </div>
              <Button
                variant="secondary"
                size="sm"
                onClick={() => blockAvailability("Dinner")}
              >
                Block dinner
              </Button>
            </div>
          </div>
        </div>
        <div>
          <SectionHeading
            eyebrow="Approval trail"
            title="Requests stay visible"
            detail="You will see the decision here when a manager reviews it."
          />
          <div className="border-y border-[var(--line)]">
            <div className="flex items-center gap-3 px-3 py-4">
              <StatusPill tone="warning">Example</StatusPill>
              <p className="text-xs leading-4 text-[var(--ink-faint)]">
                Release and pickup requests never silently change your schedule.
              </p>
            </div>
          </div>
        </div>
      </section>

      {panel ? (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/25 px-4 backdrop-blur-[3px]"
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) setPanel(null);
          }}
        >
          <div
            role="dialog"
            aria-modal="true"
            className="w-full max-w-md rounded-[22px] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-float)]"
          >
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow">
                  {panel === "time-off" ? "Time off" : "Availability"}
                </p>
                <h3 className="mt-2 text-lg font-semibold">
                  {panel === "time-off"
                    ? "Tell managers when you need off"
                    : "Block a partial shift"}
                </h3>
              </div>
              <Button
                variant="quiet"
                size="icon"
                aria-label="Close request"
                onClick={() => setPanel(null)}
              >
                <X className="size-4" />
              </Button>
            </div>
            {panel === "time-off" ? (
              <div className="mt-6 grid gap-2">
                <Button
                  variant="secondary"
                  onClick={() => requestTimeOff("Full day")}
                >
                  Full day · Aug 15
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => requestTimeOff("Lunch")}
                >
                  Lunch · Aug 15
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => requestTimeOff("Dinner")}
                >
                  Dinner · Aug 15
                </Button>
              </div>
            ) : (
              <div className="mt-6 grid gap-2">
                <Button
                  variant="secondary"
                  onClick={() => blockAvailability("Lunch")}
                >
                  Block lunch · Aug 12
                </Button>
                <Button
                  variant="secondary"
                  onClick={() => blockAvailability("Dinner")}
                >
                  Block dinner · Aug 16
                </Button>
              </div>
            )}
          </div>
        </div>
      ) : null}
    </PageFrame>
  );
}

function ManagerScheduleWorkspace() {
  const workspace = useWorkspaceContext();
  const [scheduleView, setScheduleView] = useState<"foh" | "boh">("foh");
  const [shifts, setShifts] = useState(initialShifts);
  const [selected, setSelected] = useState<Shift | null>(null);
  const [published, setPublished] = useState(false);
  const [shiftEditor, setShiftEditor] = useState<Shift | "new" | null>(null);
  const [reopenShift, setReopenShift] = useState<Shift | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 7 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 180, tolerance: 5 },
    }),
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
  const agendaDays = days.map((day) => {
    const dayShifts = shifts.filter((shift) => shift.dayId === day.id);
    const hours = dayShifts.reduce((sum, shift) => sum + shift.hours, 0);
    return {
      id: day.id,
      label: `${day.label} · Aug ${day.date}`,
      detail: `${hours.toFixed(hours % 1 ? 1 : 0)}h · ${dayShifts.filter((shift) => shift.open).length} open`,
      items: dayShifts,
    };
  });
  const scheduleActionContext: ActionResolutionContext = {
    role: workspace.role,
    persona: workspace.persona,
    workMode: resolveWorkMode(workspace, workspace.activeJob),
    capabilities: workspace.capabilities,
    servicePhase: "off_hours",
    satisfiedPrerequisites: ["active_workspace", "selected_shift"],
  };

  if (scheduleView === "boh") {
    return (
      <ChefScheduleWorkspace
        managerMode
        onBackToFoh={() => setScheduleView("foh")}
      />
    );
  }

  function onDragEnd(event: DragEndEvent) {
    const targetDay = event.over?.id;
    if (!targetDay || !days.some((day) => day.id === targetDay)) return;
    setShifts((current) =>
      current.map((shift) =>
        shift.id === event.active.id
          ? { ...shift, dayId: String(targetDay) }
          : shift,
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
    if (shiftEditor && shiftEditor !== "new") {
      const updated = {
        ...shiftEditor,
        dayId,
        personId:
          person === "Donald"
            ? demoIds.people.donald
            : person === "Maris"
              ? demoIds.people.maris
              : person === "Irini"
                ? demoIds.people.irini
                : person === "Mateo"
                  ? demoIds.people.mateo
                  : null,
        person,
        role,
        start,
        end,
        open: person === "Open shift",
      };
      setShifts((current) =>
        current.map((shift) => (shift.id === updated.id ? updated : shift)),
      );
      setSelected(updated);
    } else {
      setShifts((current) => [
        ...current,
        {
          id: `shift-${Date.now()}`,
          dayId,
          personId:
            person === "Donald"
              ? demoIds.people.donald
              : person === "Maris"
                ? demoIds.people.maris
                : person === "Irini"
                  ? demoIds.people.irini
                  : person === "Mateo"
                    ? demoIds.people.mateo
                    : null,
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
    }
    setPublished(false);
    setShiftEditor(null);
  }

  function confirmReopenShift() {
    if (!reopenShift) return;
    const reopened = {
      ...reopenShift,
      personId: null,
      person: "Open shift",
      acknowledged: false,
      open: true,
    };
    setShifts((current) =>
      current.map((shift) => (shift.id === reopened.id ? reopened : shift)),
    );
    setSelected(reopened);
    setReopenShift(null);
  }

  return (
    <PageFrame width="full" className="max-w-[1700px]">
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <div className="flex items-center gap-2">
            <StatusPill tone={published ? "positive" : "warning"} dot>
              {published ? "Published" : "Draft changes"}
            </StatusPill>
            <span className="text-xs text-[var(--ink-faint)]">Version 12</span>
          </div>
          <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">
            Dinner schedule
          </h2>
          <p className="mt-1 text-[13px] text-[var(--ink-faint)]">
            Drag shifts between days. Publishing creates a new auditable
            version.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="quiet" size="sm" aria-label="Previous week">
            <ChevronLeft className="size-3" />
          </Button>
          <Button variant="secondary" size="sm">
            This week
          </Button>
          <Button variant="quiet" size="sm" aria-label="Next week">
            <ChevronRight className="size-3" />
          </Button>
          <Button variant="secondary" size="sm">
            <Copy className="size-3.5" /> Templates
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setScheduleView("boh")}
          >
            <Copy className="size-3.5" /> BOH schedule
          </Button>
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setShiftEditor("new")}
          >
            <Plus className="size-3.5" /> Add shift
          </Button>
          <Button
            variant="accent"
            size="sm"
            onClick={() => setPublished(true)}
            disabled={published}
          >
            <Send className="size-3.5" />{" "}
            {published ? "Published" : "Publish schedule"}
          </Button>
        </div>
      </div>

      <section
        aria-label="Schedule metrics"
        className="mt-5 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0"
      >
        <Metric
          label="Scheduled hours"
          value={`${totals.hours}h`}
          detail={`Across ${shifts.length} shift blocks`}
        />
        <Metric
          label="Estimated labor"
          value={`$${totals.cost.toLocaleString()}`}
          detail="Before payroll burden"
          trend={{ label: "21.8%", tone: "neutral" }}
        />
        <Metric
          label="Open shifts"
          value={String(totals.open)}
          detail="Claimable by eligible staff"
          trend={{
            label: totals.open ? "Needs fill" : "Covered",
            tone: totals.open ? "negative" : "positive",
          }}
        />
        <Metric
          label="Acknowledgements"
          value={`${shifts.length - totals.pending}/${shifts.length}`}
          detail={`${totals.pending} people pending`}
        />
      </section>

      <div className="mt-5 flex items-center justify-between gap-3 rounded-xl bg-[var(--warning-soft)] px-3.5 py-2.5 text-xs text-[var(--warning)]">
        <span className="flex items-center gap-2">
          <CircleAlert className="size-3.5" /> Long shifts automatically carry a
          30m unpaid break for manager timing.
        </span>
        <button className="font-semibold underline decoration-current/30 underline-offset-2">
          Review
        </button>
      </div>

      <DndContext
        id="demo-schedule-dnd"
        sensors={sensors}
        collisionDetection={closestCenter}
        onDragEnd={onDragEnd}
      >
        <section
          aria-label="Weekly schedule board"
          className="mt-5 hidden overflow-x-auto rounded-[18px] border border-[var(--line)] bg-[var(--paper)] md:block"
        >
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
        <ScheduleAgenda
          days={agendaDays}
          getItemKey={(shift) => shift.id}
          label="Weekly schedule agenda"
          className="mt-5 md:hidden"
          renderItem={(shift) => (
            <ShiftCard
              shift={shift}
              draggable={false}
              onSelect={() => setSelected(shift)}
            />
          )}
        />
      </DndContext>

      <div className="mt-6 flex flex-wrap items-center gap-x-5 gap-y-2 text-xs text-[var(--ink-faint)]">
        {Object.entries(roleTone).map(([role, color]) => (
          <span key={role} className="flex items-center gap-1.5">
            <span className={cn("h-3 w-0.5 rounded-full border-l-2", color)} />
            {role}
          </span>
        ))}
        <span className="ml-auto flex items-center gap-1.5">
          <Check className="size-3 text-[var(--positive)]" /> Acknowledged
        </span>
      </div>

      <Drawer
        open={Boolean(selected)}
        onClose={() => setSelected(null)}
        labelledBy="demo-shift-detail-title"
        width="md"
        className="p-5 sm:p-7"
      >
        {selected ? (
          <>
            <div className="flex items-start justify-between">
              <div>
                <p className="eyebrow">Shift detail</p>
                <h3
                  id="demo-shift-detail-title"
                  className="mt-3 text-xl font-medium tracking-[-0.04em]"
                >
                  {selected.person}
                </h3>
              </div>
              <Button
                variant="quiet"
                size="icon"
                aria-label="Close shift"
                onClick={() => setSelected(null)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <div className="mt-7 flex items-center gap-3 border-y border-[var(--line)] py-4">
              <Avatar name={selected.person} size="lg" />
              <div>
                <p className="text-sm font-semibold">{selected.role}</p>
                <p className="numeric mt-1 text-[13px] text-[var(--ink-faint)]">
                  {selected.start}–{selected.end} · {selected.hours} hours
                </p>
              </div>
            </div>
            <dl className="mt-6 space-y-4 text-xs">
              <div className="flex justify-between">
                <dt className="text-[var(--ink-faint)]">Day</dt>
                <dd className="font-semibold">
                  {days.find((day) => day.id === selected.dayId)?.label}, Aug{" "}
                  {days.find((day) => day.id === selected.dayId)?.date}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--ink-faint)]">Labor estimate</dt>
                <dd className="numeric font-semibold">
                  ${selected.cost.toFixed(2)}
                </dd>
              </div>
              <div className="flex justify-between">
                <dt className="text-[var(--ink-faint)]">Status</dt>
                <dd>
                  <StatusPill
                    tone={selected.acknowledged ? "positive" : "warning"}
                  >
                    {selected.acknowledged
                      ? "Acknowledged"
                      : "Awaiting response"}
                  </StatusPill>
                </dd>
              </div>
            </dl>
            <ObjectActionBar
              entity="schedule_shift"
              state={
                published ? (selected.open ? "open" : "scheduled") : "draft"
              }
              context={scheduleActionContext}
              handlers={{
                ...(!published
                  ? {
                      "schedule_shift.edit": () => {
                        setShiftEditor(selected);
                        setSelected(null);
                      },
                    }
                  : {}),
                ...(published && !selected.open
                  ? { "schedule_shift.reopen": () => setReopenShift(selected) }
                  : {}),
              }}
              icons={{
                "schedule_shift.edit": <Pencil className="size-3.5" />,
                "schedule_shift.reopen": <CircleAlert className="size-3.5" />,
              }}
              variants={{
                "schedule_shift.edit": "secondary",
                "schedule_shift.reopen": "quiet",
              }}
              ariaLabels={{
                "schedule_shift.edit": `Edit ${selected.person} shift`,
                "schedule_shift.reopen": `Reopen ${selected.person} shift for coverage`,
              }}
              label={`${selected.person} shift actions`}
              className="mt-7 flex flex-wrap gap-2"
              size="sm"
            />
            {!selected.acknowledged &&
            selected.personId === workspace.identity.userId ? (
              <div className="mt-8 rounded-[16px] bg-[var(--accent-soft)]/50 p-4">
                <p className="text-xs font-semibold">Your acknowledgement</p>
                <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">
                  Confirm only the shift assigned to your identity.
                </p>
                <Button
                  className="mt-4 w-full"
                  variant="accent"
                  onClick={() => {
                    setShifts((current) =>
                      current.map((shift) =>
                        shift.id === selected.id
                          ? { ...shift, acknowledged: true }
                          : shift,
                      ),
                    );
                    setSelected((current) =>
                      current ? { ...current, acknowledged: true } : current,
                    );
                  }}
                >
                  <CalendarCheck2 className="size-4" /> Acknowledge shift
                </Button>
              </div>
            ) : !selected.acknowledged && selected.personId ? (
              <div
                role="note"
                className="mt-8 rounded-[16px] border border-[var(--line)] bg-[var(--canvas-strong)] p-4"
              >
                <p className="text-xs font-semibold">Employee attestation required</p>
                <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">
                  Only {selected.person} can acknowledge this shift. Managers can review or
                  reopen coverage, but cannot attest for the employee.
                </p>
              </div>
            ) : null}
          </>
        ) : null}
      </Drawer>

      <Modal
        open={Boolean(shiftEditor)}
        onClose={() => setShiftEditor(null)}
        labelledBy="demo-shift-editor-title"
        initialFocusSelector="[data-demo-shift-editor-first]"
        position="responsive-sheet"
        className="max-w-lg rounded-b-none p-5 sm:rounded-[22px] sm:p-6"
      >
        {shiftEditor ? (
          <>
            <div className="flex items-center justify-between">
              <div>
                <p className="eyebrow">Schedule</p>
                <h3
                  id="demo-shift-editor-title"
                  className="mt-2 text-lg font-semibold"
                >
                  {shiftEditor === "new" ? "Add a shift" : "Edit shift"}
                </h3>
              </div>
              <Button
                variant="quiet"
                size="icon"
                aria-label="Close shift editor"
                onClick={() => setShiftEditor(null)}
              >
                <X className="size-4" />
              </Button>
            </div>
            <form action={addShift} className="mt-6 grid gap-4 sm:grid-cols-2">
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold">
                  Team member
                </span>
                <select
                  data-demo-shift-editor-first
                  name="person"
                  defaultValue={
                    shiftEditor === "new" ? "Open shift" : shiftEditor.person
                  }
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-base sm:text-xs"
                >
                  <option>Open shift</option>
                  <option>Donald</option>
                  <option>Maris</option>
                  <option>Irini</option>
                  <option>Mateo</option>
                </select>
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-semibold">Day</span>
                <select
                  name="dayId"
                  defaultValue={
                    shiftEditor === "new" ? "mon" : shiftEditor.dayId
                  }
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-base sm:text-xs"
                >
                  {days.map((day) => (
                    <option key={day.id} value={day.id}>
                      {day.label}, Aug {day.date}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-semibold">Role</span>
                <select
                  name="role"
                  defaultValue={
                    shiftEditor === "new" ? "Server" : shiftEditor.role
                  }
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-base sm:text-xs"
                >
                  {Object.keys(roleTone).map((role) => (
                    <option key={role}>{role}</option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-semibold">
                  Starts
                </span>
                <input
                  name="start"
                  defaultValue={
                    shiftEditor === "new" ? "5:00p" : shiftEditor.start
                  }
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-base sm:text-xs"
                />
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-semibold">Ends</span>
                <input
                  name="end"
                  defaultValue={
                    shiftEditor === "new" ? "11:00p" : shiftEditor.end
                  }
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-base sm:text-xs"
                />
              </label>
              <div className="mt-2 flex justify-end gap-2 sm:col-span-2">
                <Button variant="quiet" onClick={() => setShiftEditor(null)}>
                  Cancel
                </Button>
                <Button type="submit" variant="accent">
                  <Plus className="size-3.5" />{" "}
                  {shiftEditor === "new" ? "Add shift" : "Save changes"}
                </Button>
              </div>
            </form>
          </>
        ) : null}
      </Modal>

      <ConfirmActionDialog
        open={Boolean(reopenShift)}
        labelledBy="demo-reopen-shift-title"
        title="Reopen this shift for coverage?"
        description={
          reopenShift
            ? `${reopenShift.person} will be removed and the ${reopenShift.start}–${reopenShift.end} shift will become open.`
            : ""
        }
        confirmLabel="Reopen shift"
        onClose={() => setReopenShift(null)}
        onConfirm={confirmReopenShift}
      />

      <div className="mt-8 flex items-center gap-3 rounded-[16px] border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-xs text-[var(--ink-faint)]">
        <Sparkles className="size-4 shrink-0 text-[var(--accent)]" />
        <span className="flex-1">
          Schedule note: every shift longer than six hours carries a 30m unpaid
          break; managers approve when it falls.
        </span>
        <Button variant="quiet" size="sm">
          Review suggestion
        </Button>
      </div>
    </PageFrame>
  );
}

export function ScheduleWorkspace() {
  const workspace = useWorkspaceContext();
  if (workspace.role === "employee") return <EmployeeScheduleWorkspace />;
  if (["owner", "admin", "manager"].includes(workspace.role))
    return <ManagerScheduleWorkspace />;
  if (workspace.persona === "chef") return <ChefScheduleWorkspace />;
  return <ManagerScheduleWorkspace />;
}
