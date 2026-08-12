"use client";

import {
  DndContext,
  KeyboardSensor,
  PointerSensor,
  TouchSensor,
  type DragEndEvent,
  type DragMoveEvent,
  type DragStartEvent,
  useDraggable,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import {
  AlertTriangle,
  Ban,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  MessageSquareText,
  Move,
  Plus,
  PencilLine,
  Share2,
  Settings2,
  Sparkles,
  UserRound,
  UsersRound,
  Utensils,
  X,
} from "lucide-react";
import { useRouter } from "next/navigation";
import {
  type FormEvent,
  type ReactNode,
  useId,
  useMemo,
  useRef,
  useState,
  useTransition,
} from "react";
import {
  moveReservationTableAction,
  saveReservationWithGuestAction,
  saveWaitlistEntryAction,
  seatWaitlistEntryAction,
  setReservationTableStatusAction,
  transitionReservationAction,
  transitionWaitlistEntryAction,
  assignReservationTablesAction,
} from "@/app/actions/workflows/reservations";
import { ObjectActionBar } from "@/components/actions/object-action-bar";
import { RealtimeSyncStatus } from "@/components/realtime/realtime-sync-status";
import {
  ReservationCancelDialog,
  ReservationEditDialog,
} from "@/components/reservations/reservation-lifecycle-dialogs";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { FormField } from "@/components/ui/form-field";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Modal } from "@/components/ui/modal";
import { ReadState } from "@/components/ui/read-state";
import {
  PageFrame,
  PageHeader,
  SectionHeading,
} from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { Surface } from "@/components/ui/surface";
import { ViewSwitcher } from "@/components/ui/view-switcher";
import type { LiveReadResult } from "@/data/read-models/shared";
import {
  addIsoDays,
  localDateTimeParts,
  zonedLocalToIso,
} from "@/data/read-models/local-time";
import {
  resolveWorkMode,
  type ActionResolutionContext,
} from "@/lib/actions/action-registry";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { useStableRequestIds } from "@/lib/idempotency/stable-request-id";
import { suggestTables } from "@/lib/reservations/availability";
import {
  floorNowMatchesInventoryDate,
  isReservationTableReadyForImmediateSeating,
} from "@/lib/reservations/floor-projection";
import type {
  ReservationHostModel,
  ReservationFloorTableSummary,
  ReservationInventoryAllocationSummary,
  ReservationPhysicalTableState,
  ReservationStatus,
  ReservationSummary,
} from "@/lib/reservations/model";
import {
  canAccessReservationHost,
  isReservationLifecycleOwnedByOs,
} from "@/lib/reservations/model";
import { useRealtimeInvalidation } from "@/lib/realtime/use-realtime-invalidation";
import { cn, formatMoney } from "@/lib/utils";

type BookMode = "reservation" | "walk_in";
const noReservationPostgresBindings = [] as const;
const reservationBroadcastEvents = ["INSERT", "UPDATE", "DELETE"] as const;
const assignableReservationStatuses = new Set<ReservationStatus>([
  "booked",
  "confirmed",
  "arrived",
]);
const fieldClass =
  "h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-base outline-none focus:border-[var(--accent)] sm:text-sm";
const stateStyles: Record<ReservationPhysicalTableState, string> = {
  available:
    "border-[#ded8ca] bg-[#f8f4e9] text-[#1c1d1a]",
  occupied:
    "border-[#94c0a0] bg-[#d6ead9] text-[#1e5f39]",
  needs_reset:
    "border-[#d4ae69] bg-[#f4dfae] text-[#73501f]",
  blocked:
    "border-[#5c5e58] bg-[#3d3f3a] text-[#aaa99f] opacity-75",
};

function availabilityTables(
  model: ReservationHostModel,
  mode: "interval" | "immediate" = "interval",
) {
  return model.floorNow.tables.map((table) => ({
    id: table.id,
    label: table.label,
    minCapacity: table.minCapacity,
    maxCapacity: table.maxCapacity,
    isBookable:
      mode === "interval"
        ? table.isBookable
        : isReservationTableReadyForImmediateSeating(table),
    isActive: true,
  }));
}

function availabilityAllocations(
  allocations: ReservationInventoryAllocationSummary[],
  excludedReservationId?: string,
) {
  return allocations
    .filter(
      (allocation) =>
        !excludedReservationId ||
        allocation.reservationId !== excludedReservationId,
    )
    .map((allocation) => ({
      tableId: allocation.tableId,
      startsAt: allocation.startsAt,
      endsAt: allocation.endsAt,
      expiresAt: allocation.expiresAt,
      isActive: true,
    }));
}

function timeLabel(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateTimeLabel(value: string, timeZone: string) {
  return new Intl.DateTimeFormat("en-US", {
    timeZone,
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(value));
}

function dateTitle(value: string) {
  return new Intl.DateTimeFormat("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  }).format(new Date(`${value}T12:00:00Z`));
}

function statusTone(status: ReservationStatus) {
  if (["seated", "completed"].includes(status)) return "positive" as const;
  if (["arrived", "confirmed"].includes(status)) return "accent" as const;
  if (["cancelled", "no_show"].includes(status)) return "danger" as const;
  if (status === "pending_verification") return "warning" as const;
  return "neutral" as const;
}

function Dialog({
  title,
  detail,
  onClose,
  returnFocusTarget,
  children,
}: {
  title: string;
  detail: string;
  onClose: () => void;
  returnFocusTarget?: HTMLElement | null;
  children: ReactNode;
}) {
  const titleId = useId();

  return (
    <Modal
      open
      onClose={onClose}
      labelledBy={titleId}
      initialFocusSelector="[autofocus]"
      position="responsive-sheet"
      returnFocusTarget={returnFocusTarget}
      className="max-h-[94svh] max-w-xl overflow-y-auto rounded-t-[24px] border-0 p-5 sm:rounded-[24px] sm:p-7"
    >
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="eyebrow">Reservations</p>
          <h2
            id={titleId}
            className="mt-2 text-2xl font-semibold tracking-[-0.045em]"
          >
            {title}
          </h2>
          <p className="mt-2 text-sm text-[var(--ink-faint)]">{detail}</p>
        </div>
        <Button
          size="icon"
          variant="quiet"
          onClick={onClose}
          aria-label="Close"
        >
          <X className="size-4" />
        </Button>
      </div>
      {children}
    </Modal>
  );
}

function DraggableFloorTable({
  table,
  editing,
  occupyingReservation,
  isSelectedInterval,
  isSelected,
  onActivate,
}: {
  table: ReservationFloorTableSummary;
  editing: boolean;
  occupyingReservation: ReservationSummary | null;
  isSelectedInterval: boolean;
  isSelected: boolean;
  onActivate: () => void;
}) {
  const { attributes, listeners, setNodeRef, transform, isDragging } =
    useDraggable({
      id: table.id,
      disabled: !editing,
    });
  const dragTransform = transform
    ? ` translate3d(${transform.x}px, ${transform.y}px, 0)`
    : "";

  return (
    <button
      ref={setNodeRef}
      type="button"
      title={
        editing
          ? `Move table ${table.label}`
          : `Table ${table.label} · ${table.maxCapacity} seats · ${table.state.replaceAll("_", " ")} now${isSelectedInterval ? " · assigned to selected interval" : ""}`
      }
      onClick={() => {
        if (!editing) onActivate();
      }}
      {...(editing ? attributes : {})}
      {...(editing ? listeners : {})}
      className={cn(
        "absolute z-10 flex min-h-11 min-w-11 items-center justify-center border text-xs font-bold shadow-[0_8px_20px_rgba(0,0,0,.16)] transition-[box-shadow,filter] duration-150 focus:z-30 focus:outline-none focus:ring-2 focus:ring-[#d2a24b]",
        table.shape === "round" ? "rounded-full" : "rounded-[10px]",
        stateStyles[table.state],
        !editing && "hover:z-20 hover:brightness-[1.04]",
        editing && "cursor-grab touch-none ring-1 ring-white/25 active:cursor-grabbing",
        isDragging && "z-40 scale-[1.03] shadow-[0_18px_36px_rgba(0,0,0,.42)]",
        isSelectedInterval && "ring-2 ring-[#d2a24b] ring-offset-2 ring-offset-[#191b18]",
        isSelected && "ring-2 ring-white ring-offset-2 ring-offset-[#191b18]",
      )}
      style={{
        left: `${table.x * 100}%`,
        top: `${table.y * 100}%`,
        width: `${Math.max(table.width * 100, 8)}%`,
        height: `${Math.max(table.height * 100, 7)}%`,
        transform: `translate(-50%, -50%) rotate(${table.rotation}deg)${dragTransform}`,
      }}
    >
      <span>{table.label}</span>
      {editing ? (
        <Move className="absolute right-1 top-1 size-3 opacity-55" />
      ) : null}
      {occupyingReservation ? (
        <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-[#20221f] text-[8px] text-[#f8f4e9]">
          {occupyingReservation.partySize}
        </span>
      ) : null}
    </button>
  );
}

function FloorPlan({
  model,
  selected,
  onSelectReservation,
  onSelectTable,
  onAssignTable,
  selectedTableId,
  canAssignTables,
  editing,
  onMoveTable,
}: {
  model: ReservationHostModel;
  selected: ReservationSummary | null;
  onSelectReservation: (id: string) => void;
  onSelectTable: (id: string) => void;
  onAssignTable: (id: string) => void;
  selectedTableId: string | null;
  canAssignTables: boolean;
  editing: boolean;
  onMoveTable: (tableId: string, positionX: number, positionY: number) => void;
}) {
  const floorRef = useRef<HTMLDivElement>(null);
  const [guidePosition, setGuidePosition] = useState<{
    x: number;
    y: number;
  } | null>(null);
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 100, tolerance: 8 },
    }),
    useSensor(KeyboardSensor),
  );

  function projectedPosition(event: DragMoveEvent | DragEndEvent) {
    const table = model.floorNow.tables.find(
      (entry) => entry.id === String(event.active.id),
    );
    const bounds = floorRef.current?.getBoundingClientRect();
    if (!table || !bounds) return null;
    const halfWidth = Math.max(table.width, 0.08) / 2;
    const halfHeight = Math.max(table.height, 0.07) / 2;
    return {
      x: Math.max(
        halfWidth,
        Math.min(1 - halfWidth, table.x + event.delta.x / bounds.width),
      ),
      y: Math.max(
        halfHeight,
        Math.min(1 - halfHeight, table.y + event.delta.y / bounds.height),
      ),
    };
  }

  function handleDragStart(event: DragStartEvent) {
    const table = model.floorNow.tables.find(
      (entry) => entry.id === String(event.active.id),
    );
    if (table) setGuidePosition({ x: table.x, y: table.y });
  }

  function handleDragMove(event: DragMoveEvent) {
    setGuidePosition(projectedPosition(event));
  }

  function handleDragEnd(event: DragEndEvent) {
    const position = projectedPosition(event);
    setGuidePosition(null);
    if (!position) return;
    onMoveTable(
      String(event.active.id),
      Math.round(position.x * 1_000) / 1_000,
      Math.round(position.y * 1_000) / 1_000,
    );
  }

  return (
    <DndContext
      sensors={sensors}
      onDragStart={handleDragStart}
      onDragMove={handleDragMove}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setGuidePosition(null)}
    >
      <div
        ref={floorRef}
        className={cn(
          "relative mx-auto aspect-[3/4] w-full overflow-hidden rounded-[22px] border border-[#343630] bg-[#191b18] shadow-[inset_0_1px_0_rgba(255,255,255,.05),0_18px_45px_rgba(25,27,24,.14)] sm:aspect-[16/10]",
          editing && "ring-2 ring-[#d2a24b]/70 ring-offset-2",
        )}
      >
        <div className="absolute inset-x-[4%] top-[5%] h-[16%] rounded-[16px] border border-dashed border-[#484b44] bg-white/[.025]">
          <span className="absolute left-3 top-2 text-[9px] font-semibold uppercase tracking-[.18em] text-[#888b82]">
            Entry · host stand
          </span>
        </div>
        <div className="absolute bottom-[6%] left-[4%] top-[26%] w-[19%] rounded-[16px] border border-dashed border-[#3f423c] bg-white/[.018]">
          <span className="absolute bottom-3 left-3 text-[9px] font-semibold uppercase tracking-[.18em] text-[#a6a89f] [writing-mode:vertical-rl]">
            Service lane
          </span>
        </div>
        <div className="absolute bottom-[6%] left-[27%] right-[4%] top-[26%] rounded-[18px] border border-[#343730] bg-white/[.012]" />
        {guidePosition ? (
          <>
            <div
              className="pointer-events-none absolute inset-y-0 z-30 w-px bg-[#d2a24b]/60"
              style={{ left: `${guidePosition.x * 100}%` }}
            />
            <div
              className="pointer-events-none absolute inset-x-0 z-30 h-px bg-[#d2a24b]/60"
              style={{ top: `${guidePosition.y * 100}%` }}
            />
          </>
        ) : null}
        {model.floorNow.tables.map((table) => {
        const occupyingReservation = table.occupyingReservationId
          ? model.reservations.find(
              (entry) => entry.id === table.occupyingReservationId,
            ) ?? null
          : null;
        const isSelectedInterval = Boolean(
          selected?.tableIds.includes(table.id),
        );
        return (
          <DraggableFloorTable
            key={table.id}
            table={table}
            editing={editing}
            occupyingReservation={occupyingReservation}
            isSelectedInterval={isSelectedInterval}
            isSelected={selectedTableId === table.id}
            onActivate={() =>
              selected && canAssignTables
                ? onAssignTable(table.id)
                : occupyingReservation
                  ? onSelectReservation(occupyingReservation.id)
                  : onSelectTable(table.id)
            }
          />
        );
        })}
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-white/10 bg-[#242622]/90 px-3 py-1 text-[9px] font-semibold uppercase tracking-[.14em] text-[#a6a89f] backdrop-blur">
          {editing ? "Drag tables · positions save automatically" : "Floor now · verify on site"}
        </div>
      </div>
    </DndContext>
  );
}

export function ReservationsWorkspace({
  workspace,
  result,
}: {
  workspace: WorkspaceContextValue;
  result: LiveReadResult<ReservationHostModel>;
}) {
  const router = useRouter();
  const incomingModel = result.ok ? result.data : null;
  const [modelState, setModelState] = useState(() => ({
    source: incomingModel,
    value: incomingModel,
  }));
  const [isReconciling, startReconciliation] = useTransition();
  if (modelState.source !== incomingModel) {
    setModelState({ source: incomingModel, value: incomingModel });
  }
  const model =
    modelState.source === incomingModel ? modelState.value : incomingModel;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [assignmentMode, setAssignmentMode] = useState(false);
  const [layoutEditing, setLayoutEditing] = useState(false);
  const [movingTableId, setMovingTableId] = useState<string | null>(null);
  const [lastTableMove, setLastTableMove] = useState<{
    tableId: string;
    label: string;
    from: { x: number; y: number };
  } | null>(null);
  const [filter, setFilter] = useState<
    "all" | "upcoming" | "arrived" | "seated"
  >("all");
  const [mobileView, setMobileView] = useState<"book" | "floor" | "service">(
    "book",
  );
  const [bookMode, setBookMode] = useState<BookMode | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [noShowConfirmOpen, setNoShowConfirmOpen] = useState(false);
  const [editReservationTarget, setEditReservationTarget] =
    useState<ReservationSummary | null>(null);
  const [cancelReservationTarget, setCancelReservationTarget] =
    useState<ReservationSummary | null>(null);
  const [dialogTrigger, setDialogTrigger] = useState<HTMLElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const mobileViewAnchorRef = useRef<HTMLDivElement>(null);
  const operationPermissionId = useId();
  const currentBookPermissionId = useId();
  const configurationPermissionId = useId();
  const noShowConfirmTitleId = useId();
  const { requestIdFor, rotateRequestId } = useStableRequestIds();
  const selected =
    model?.reservations.find((reservation) => reservation.id === selectedId) ??
    null;
  const selectedTable =
    model?.floorNow.tables.find((table) => table.id === selectedTableId) ??
    null;
  const editReservation =
    model?.reservations.find(
      (reservation) => reservation.id === editReservationTarget?.id,
    ) ?? editReservationTarget;
  const cancellationReservation =
    model?.reservations.find(
      (reservation) => reservation.id === cancelReservationTarget?.id,
    ) ?? cancelReservationTarget;
  const selectedLifecycleOwned = selected
    ? isReservationLifecycleOwnedByOs(selected)
    : false;
  const floorMatchesBook = model
    ? floorNowMatchesInventoryDate(
        model.floorNow.businessDateAtObservation,
        model.businessDate,
      )
    : false;
  const filtered = useMemo(
    () =>
      (model?.reservations ?? []).filter(
        (reservation) =>
          filter === "all" ||
          (filter === "upcoming"
            ? ["pending_verification", "booked", "confirmed"].includes(
                reservation.status,
              )
            : reservation.status === filter),
      ),
    [filter, model],
  );
  const realtime = useRealtimeInvalidation({
    enabled:
      workspace.mode === "live" &&
      Boolean(model && canAccessReservationHost(model.permissions)),
    channelName: `reservations:${workspace.organization.id}:${workspace.activeLocation.id}`,
    bindings: noReservationPostgresBindings,
    broadcastEvents: reservationBroadcastEvents,
    privateChannel: true,
    organizationId: workspace.organization.id,
    locationId: workspace.activeLocation.id,
  });

  function updateModel(
    update: (current: ReservationHostModel) => ReservationHostModel,
  ) {
    setModelState((current) =>
      current.value
        ? { ...current, value: update(current.value) }
        : current,
    );
  }

  function reconcileInBackground() {
    startReconciliation(() => router.refresh());
  }

  function updateReservationStatus(
    reservationId: string,
    status: ReservationStatus,
  ) {
    updateModel((current) => {
      const reservation = current.reservations.find(
        (entry) => entry.id === reservationId,
      );
      if (!reservation) return current;
      const tableIds = new Set(reservation.tableIds);
      const tables = current.floorNow.tables.map((table) => {
        if (!tableIds.has(table.id)) return table;
        if (status === "seated") {
          return {
            ...table,
            state: "occupied" as const,
            occupyingReservationId: reservationId,
          };
        }
        if (status === "completed" && table.occupyingReservationId === reservationId) {
          return {
            ...table,
            state: "needs_reset" as const,
            occupyingReservationId: null,
          };
        }
        return table;
      });
      return {
        ...current,
        reservations: current.reservations.map((entry) =>
          entry.id === reservationId ? { ...entry, status } : entry,
        ),
        floorNow: { ...current.floorNow, tables },
      };
    });
  }

  function updateReservationTables(
    reservationId: string,
    tableIds: string[],
  ) {
    updateModel((current) => {
      const labels = tableIds
        .map(
          (tableId) =>
            current.floorNow.tables.find((table) => table.id === tableId)?.label,
        )
        .filter((label): label is string => Boolean(label));
      return {
        ...current,
        reservations: current.reservations.map((entry) =>
          entry.id === reservationId
            ? {
                ...entry,
                tableIds,
                tableLabel: labels.length ? labels.join(" + ") : null,
              }
            : entry,
        ),
      };
    });
  }

  function updatePhysicalTableStatus(
    tableId: string,
    status: ReservationPhysicalTableState,
    reservationId: string | null,
  ) {
    updateModel((current) => ({
      ...current,
      floorNow: {
        ...current.floorNow,
        tables: current.floorNow.tables.map((table) =>
          table.id === tableId
            ? {
                ...table,
                state: status,
                occupyingReservationId:
                  status === "occupied"
                    ? reservationId
                    : status === "available"
                      ? null
                      : table.occupyingReservationId,
                lastChangedAt: new Date().toISOString(),
              }
            : table,
        ),
      },
    }));
  }

  function updateTablePosition(
    tableId: string,
    positionX: number,
    positionY: number,
  ) {
    updateModel((current) => ({
      ...current,
      floorNow: {
        ...current.floorNow,
        tables: current.floorNow.tables.map((table) =>
          table.id === tableId
            ? { ...table, x: positionX, y: positionY }
            : table,
        ),
      },
    }));
  }

  async function moveTable(
    tableId: string,
    positionX: number,
    positionY: number,
    recordUndo = true,
  ) {
    if (!model?.permissions.configure) {
      setMessage("Moving floor tables requires reservation configuration access.");
      return;
    }
    const table = model.floorNow.tables.find((entry) => entry.id === tableId);
    if (!table || (table.x === positionX && table.y === positionY)) return;
    const previous = { x: table.x, y: table.y };
    updateTablePosition(tableId, positionX, positionY);
    setMovingTableId(tableId);
    setMessage(`Table ${table.label} moved. Saving position…`);
    if (workspace.mode === "demo") {
      setMovingTableId(null);
      if (recordUndo)
        setLastTableMove({ tableId, label: table.label, from: previous });
      setMessage(`Table ${table.label} moved. Position saved.`);
      return;
    }
    const payload = { tableId, positionX, positionY };
    const scope = `reservation-table-move-${tableId}`;
    const response = await moveReservationTableAction({
      ...payload,
      requestId: requestIdFor(scope, payload),
    });
    setMovingTableId(null);
    if (!response.ok) {
      updateTablePosition(tableId, previous.x, previous.y);
      if (recordUndo) setLastTableMove(null);
      setMessage(response.message);
      return;
    }
    rotateRequestId(scope);
    if (recordUndo)
      setLastTableMove({ tableId, label: table.label, from: previous });
    setMessage(`Table ${table.label} moved. Position saved.`);
    reconcileInBackground();
  }

  function beginTableAssignment() {
    if (!selected) return;
    if (!assignableReservationStatuses.has(selected.status)) {
      setMessage(
        "Only booked, confirmed, or arrived reservations can use ordinary table assignment.",
      );
      return;
    }
    setAssignmentMode(true);
    setSelectedTableId(null);
    setMessage(`Choose a table for ${selected.guest.displayName}, or use best fit.`);
    showMobileView("floor");
  }

  function showMobileView(view: "book" | "floor" | "service") {
    setMobileView(view);
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function" ||
      !window.matchMedia("(max-width: 1023px)").matches
    )
      return;
    window.requestAnimationFrame(() =>
      mobileViewAnchorRef.current?.scrollIntoView({ block: "start" }),
    );
  }

  if (!model)
    return (
      <PageFrame>
        <ReadState
          state="unavailable"
          title="Reservation book unavailable"
          description={result.ok ? "Try again." : result.message}
          detail="No covers, guest context, pacing, waitlist, or floor state was estimated."
          icon={<AlertTriangle className="size-5" />}
        />
      </PageFrame>
    );
  if (!canAccessReservationHost(model.permissions))
    return (
      <PageFrame>
        <ReadState
          state="restricted"
          title="Reservation access not assigned"
          description="Your current job assignment has no reservation capability at this location."
          detail="Ask a workspace administrator to review the effective location assignment."
          icon={<AlertTriangle className="size-5" />}
        />
      </PageFrame>
    );
  const readyModel = model;
  const canOperate = model.permissions.operate;
  const isCurrentBook = floorMatchesBook;
  const operationDescription = canOperate ? undefined : operationPermissionId;
  const currentBookDescription = isCurrentBook
    ? undefined
    : currentBookPermissionId;
  const waitlistActionDescription =
    [operationDescription, currentBookDescription].filter(Boolean).join(" ") ||
    undefined;
  const floorActionDescription = waitlistActionDescription;
  const configurationDescription = model.permissions.configure
    ? undefined
    : configurationPermissionId;
  const objectActionContext: ActionResolutionContext = {
    role: workspace.role,
    persona: workspace.persona,
    workMode: resolveWorkMode(workspace, workspace.activeJob),
    capabilities: workspace.capabilities,
    servicePhase: "off_hours",
    satisfiedPrerequisites: ["active_workspace", "selected_reservation"],
  };

  async function transition(targetStatus: ReservationStatus) {
    if (!selected) return;
    if (!canOperate || !isCurrentBook) {
      setMessage(
        !canOperate
          ? "This reservation book is read only for your current assignment."
          : "Open today’s reservation book before changing current-service guest status.",
      );
      return;
    }
    if (workspace.mode === "demo") {
      updateReservationStatus(selected.id, targetStatus);
      setMessage(
        `Demo: ${selected.guest.displayName} moved to ${targetStatus.replaceAll("_", " ")}.`,
      );
      return;
    }
    const payload = { reservationId: selected.id, targetStatus, note: null };
    setBusy(true);
    setMessage("");
    const response = await transitionReservationAction({
      ...payload,
      requestId: requestIdFor(`reservation-transition-${selected.id}`, payload),
    });
    setBusy(false);
    setMessage(response.ok ? "Reservation updated." : response.message);
    if (response.ok) {
      rotateRequestId(`reservation-transition-${selected.id}`);
      updateReservationStatus(selected.id, targetStatus);
      reconcileInBackground();
    }
  }

  async function assignTables(tableIds: string[], label: string) {
    if (!canOperate) {
      setMessage("Table assignment requires reservation operating access.");
      return;
    }
    if (!selected) return;
    if (selected.status === "seated") {
      setAssignmentMode(false);
      setMessage(
        "A seated party cannot be reassigned without an atomic physical table move.",
      );
      return;
    }
    if (workspace.mode === "demo") {
      updateReservationTables(selected.id, tableIds);
      setAssignmentMode(false);
      setMessage(`Demo: ${label} assigned to ${selected.guest.displayName}.`);
      return;
    }
    const payload = {
      reservationId: selected.id,
      tableIds,
      overrideNote: null,
    };
    setBusy(true);
    const response = await assignReservationTablesAction({
      ...payload,
      requestId: requestIdFor(`reservation-assign-${selected.id}`, payload),
    });
    setBusy(false);
    setMessage(response.ok ? "Table assignment saved." : response.message);
    if (response.ok) {
      rotateRequestId(`reservation-assign-${selected.id}`);
      updateReservationTables(selected.id, tableIds);
      setAssignmentMode(false);
      reconcileInBackground();
    }
  }

  async function assignTable(tableId: string) {
    if (!selected) return;
    const table = readyModel.floorNow.tables.find(
      (entry) => entry.id === tableId,
    );
    if (!table || !table.isBookable) {
      setMessage("That table is not open for reservation inventory.");
      return;
    }
    const availableAtSelectedInterval = suggestTables({
      partySize: selected.partySize,
      startsAt: selected.startsAt,
      durationMinutes: selected.durationMinutes,
      tables: availabilityTables(readyModel).filter(
        (candidate) => candidate.id === tableId,
      ),
      allocations: availabilityAllocations(
        readyModel.intervalInventory.allocations,
        selected.id,
      ),
      now: readyModel.floorNow.observedAt,
    }).some((suggestion) => suggestion.tableIds[0] === tableId);
    if (!availableAtSelectedInterval) {
      setMessage(
        `Table ${table.label} is unavailable for this reservation’s exact interval.`,
      );
      return;
    }
    await assignTables([tableId], `Table ${table.label}`);
  }

  async function assignBestFit() {
    if (!selected) return;
    const suggestions = suggestTables({
      partySize: selected.partySize,
      startsAt: selected.startsAt,
      durationMinutes: selected.durationMinutes,
      tables: availabilityTables(readyModel),
      combinations: readyModel.combinations,
      allocations: availabilityAllocations(
        readyModel.intervalInventory.allocations,
        selected.id,
      ),
      now: readyModel.floorNow.observedAt,
    });
    const suggestion = suggestions[0];
    if (!suggestion) {
      setMessage("No approved table or combination is available.");
      return;
    }
    await assignTables(suggestion.tableIds, suggestion.label);
  }

  async function setTableStatus(status: ReservationPhysicalTableState) {
    if (!selectedTable) return;
    if (!canOperate || !isCurrentBook) {
      setMessage(
        !canOperate
          ? "Table status changes require reservation operating access."
          : "Open today’s reservation book before changing the current physical floor.",
      );
      return;
    }
    if (workspace.mode === "demo") {
      updatePhysicalTableStatus(
        selectedTable.id,
        status,
        status === "occupied" ? selectedTable.occupyingReservationId : null,
      );
      setMessage(
        `Demo: table ${selectedTable.label} moved to ${status.replaceAll("_", " ")}.`,
      );
      return;
    }
    const payload = {
      tableId: selectedTable.id,
      status,
      note:
        status === "blocked"
          ? "Blocked from the host stand"
          : status === "needs_reset"
            ? "Marked for reset from the host stand"
            : "Returned to service from the host stand",
      reservationId: selectedTable.occupyingReservationId,
    };
    const scope = `reservation-table-status-${selectedTable.id}`;
    setBusy(true);
    const response = await setReservationTableStatusAction({
      ...payload,
      requestId: requestIdFor(scope, payload),
    });
    setBusy(false);
    setMessage(
      response.ok
        ? `Table ${selectedTable.label} is ${status.replaceAll("_", " ")}.`
        : response.message,
    );
    if (response.ok) {
      rotateRequestId(scope);
      updatePhysicalTableStatus(
        selectedTable.id,
        status,
        status === "occupied" ? selectedTable.occupyingReservationId : null,
      );
      reconcileInBackground();
    }
  }

  async function shareReservation() {
    if (!selected) return;
    const summary = `${selected.guest.displayName} · ${selected.partySize} guests · ${dateTitle(readyModel.businessDate)} at ${timeLabel(selected.startsAt, readyModel.timeZone)}${selected.tableLabel ? ` · Table ${selected.tableLabel}` : " · Unassigned"}`;
    try {
      if (navigator.share) {
        await navigator.share({ title: "Le Yard reservation", text: summary });
        setMessage("Reservation shared through this device.");
      } else {
        await navigator.clipboard.writeText(summary);
        setMessage("Reservation summary copied.");
      }
    } catch (error) {
      if (error instanceof DOMException && error.name === "AbortError") return;
      setMessage("This device could not share the reservation summary.");
    }
  }

  async function submitBooking(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canOperate) {
      setMessage(
        "Creating a reservation requires reservation operating access.",
      );
      return;
    }
    const data = new FormData(event.currentTarget);
    const displayName = String(data.get("displayName") ?? "").trim();
    const partySize = Number(data.get("partySize"));
    const durationMinutes = Number(data.get("durationMinutes"));
    if (
      !Number.isInteger(durationMinutes) ||
      durationMinutes < 15 ||
      durationMinutes > 720
    ) {
      setMessage("Turn time must be a whole number from 15 to 720 minutes.");
      return;
    }
    if (workspace.mode === "demo") {
      setMessage(
        `Demo: ${displayName} added to the ${bookMode === "walk_in" ? "walk-in book" : "day book"}.`,
      );
      setBookMode(null);
      return;
    }
    setBusy(true);
    setMessage("");
    const nowParts = localDateTimeParts(
      new Date().toISOString(),
      readyModel.timeZone,
    );
    const time =
      bookMode === "walk_in" ? nowParts.time : String(data.get("time"));
    const localDate =
      bookMode === "walk_in" ? nowParts.date : String(data.get("date"));
    const tentative = zonedLocalToIso(localDate, time, readyModel.timeZone);
    if (!tentative) {
      setBusy(false);
      setMessage(
        "That local reservation time does not exist. Choose another time.",
      );
      return;
    }
    const suggestions = suggestTables({
      partySize,
      startsAt: tentative,
      durationMinutes,
      tables: availabilityTables(
        readyModel,
        bookMode === "walk_in" ? "immediate" : "interval",
      ),
      combinations: readyModel.combinations,
      allocations: availabilityAllocations(
        readyModel.intervalInventory.allocations,
      ),
      now: readyModel.floorNow.observedAt,
    });
    const payload = {
      locationId: workspace.activeLocation.id,
      displayName,
      email: String(data.get("email") || "").trim() || null,
      phone: String(data.get("phone") || "").trim() || null,
      reservedAt: tentative,
      durationMinutes,
      partySize,
      specialRequests: String(data.get("notes") || "").trim() || null,
      source:
        bookMode === "walk_in" ? ("walk_in" as const) : ("manual" as const),
      tableIds: suggestions[0]?.tableIds ?? [],
    };
    const reservationScope = `reservation-create-${displayName}`;
    const response = await saveReservationWithGuestAction({
      ...payload,
      requestId: requestIdFor(reservationScope, payload),
    });
    setBusy(false);
    setMessage(
      response.ok
        ? bookMode === "walk_in"
          ? "Walk-in added. Assign or adjust the table from the current floor when ready."
          : "Reservation saved and table suggested."
        : response.message,
    );
    if (response.ok) {
      rotateRequestId(reservationScope);
      setBookMode(null);
      reconcileInBackground();
    }
  }

  async function submitWaitlist(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!canOperate || !isCurrentBook) {
      setMessage(
        !canOperate
          ? "Waitlist changes require reservation operating access."
          : "Open today’s reservation book before changing the live waitlist.",
      );
      return;
    }
    const data = new FormData(event.currentTarget);
    if (workspace.mode === "demo") {
      setMessage(
        `Demo: ${String(data.get("displayName"))} added to the waitlist.`,
      );
      setWaitlistOpen(false);
      return;
    }
    const payload = {
      locationId: workspace.activeLocation.id,
      guestId: null,
      displayName: String(data.get("displayName")),
      email: String(data.get("email") || "").trim() || null,
      phone: String(data.get("phone") || "").trim(),
      partySize: Number(data.get("partySize")),
      desiredFrom: null,
      desiredTo: null,
      quotedWaitMinutes: Number(data.get("quotedWaitMinutes")),
      notes: String(data.get("notes") || "").trim() || null,
    };
    setBusy(true);
    const response = await saveWaitlistEntryAction({
      ...payload,
      requestId: requestIdFor("waitlist-create", payload),
    });
    setBusy(false);
    setMessage(response.ok ? "Guest added to waitlist." : response.message);
    if (response.ok) {
      rotateRequestId("waitlist-create");
      setWaitlistOpen(false);
      reconcileInBackground();
    }
  }

  async function notifyWaitlist(
    entryId: string,
    targetStatus: "notified" | "accepted" | "expired" | "cancelled",
  ) {
    if (!canOperate || !isCurrentBook) {
      setMessage(
        !canOperate
          ? "Waitlist changes require reservation operating access."
          : "Open today’s reservation book before changing the live waitlist.",
      );
      return;
    }
    if (workspace.mode === "demo") {
      updateModel((current) => ({
        ...current,
        waitlist: current.waitlist.map((entry) =>
          entry.id === entryId ? { ...entry, status: targetStatus } : entry,
        ),
      }));
      setMessage(`Demo: waitlist guest moved to ${targetStatus}.`);
      return;
    }
    const payload = { waitlistEntryId: entryId, targetStatus, note: null };
    const scope = `waitlist-transition-${entryId}`;
    setBusy(true);
    const response = await transitionWaitlistEntryAction({
      ...payload,
      requestId: requestIdFor(scope, payload),
    });
    setBusy(false);
    setMessage(
      response.ok
        ? `Waitlist guest moved to ${targetStatus}.`
        : response.message,
    );
    if (response.ok) {
      rotateRequestId(scope);
      updateModel((current) => ({
        ...current,
        waitlist: current.waitlist.map((entry) =>
          entry.id === entryId ? { ...entry, status: targetStatus } : entry,
        ),
      }));
      reconcileInBackground();
    }
  }

  async function seatWaitlist(entryId: string, partySize: number) {
    if (!canOperate || !isCurrentBook) {
      setMessage(
        !canOperate
          ? "Seating a waitlist party requires reservation operating access."
          : "Open today’s reservation book before seating a waitlist party. Future interval inventory cannot be combined with the current physical floor.",
      );
      return;
    }
    const startsAt = readyModel.floorNow.observedAt;
    const durationMinutes = partySize >= 5 ? 120 : 90;
    const suggestions = suggestTables({
      partySize,
      startsAt,
      durationMinutes,
      tables: availabilityTables(readyModel, "immediate"),
      combinations: readyModel.combinations,
      allocations: availabilityAllocations(
        readyModel.intervalInventory.allocations,
      ),
      now: readyModel.floorNow.observedAt,
    });
    const suggestion = suggestions[0];
    if (!suggestion) {
      setMessage(
        "No approved table or combination is available for this party right now.",
      );
      return;
    }
    if (workspace.mode === "demo") {
      const reservationId = `demo-reservation-${entryId}`;
      updateModel((current) => {
        const entry = current.waitlist.find((item) => item.id === entryId);
        if (!entry) return current;
        const startsAt = current.floorNow.observedAt;
        const endsAt = new Date(
          new Date(startsAt).valueOf() + durationMinutes * 60_000,
        ).toISOString();
        const labels = suggestion.tableIds
          .map(
            (tableId) =>
              current.floorNow.tables.find((table) => table.id === tableId)
                ?.label,
          )
          .filter((label): label is string => Boolean(label));
        const allocations = suggestion.tableIds.map((tableId) => ({
          id: `demo-allocation-${entryId}-${tableId}`,
          tableId,
          reservationId,
          startsAt,
          endsAt,
          expiresAt: null,
          state: "committed" as const,
        }));
        return {
          ...current,
          reservations: [
            ...current.reservations,
            {
              id: reservationId,
              version: 1,
              startsAt,
              durationMinutes,
              partySize: entry.partySize,
              status: "seated" as const,
              source: "walk_in",
              bookingChannel: "staff",
              tableLabel: labels.join(" + "),
              tableIds: suggestion.tableIds,
              specialRequests: entry.notes,
              policyEvidenceCaptured: false,
              lastRevision: null,
              guest: {
                id: null,
                displayName: entry.displayName,
                email: null,
                phone: null,
                vip: false,
                allergies: null,
                preferences: null,
                visitCount: 0,
                lifetimeSpendCents: 0,
              },
            },
          ],
          waitlist: current.waitlist.filter((item) => item.id !== entryId),
          floorNow: {
            ...current.floorNow,
            tables: current.floorNow.tables.map((table) =>
              suggestion.tableIds.includes(table.id)
                ? {
                    ...table,
                    state: "occupied" as const,
                    occupyingReservationId: reservationId,
                    lastChangedAt: startsAt,
                  }
                : table,
            ),
            activeAllocations: [
              ...current.floorNow.activeAllocations,
              ...allocations,
            ],
          },
          intervalInventory: {
            ...current.intervalInventory,
            allocations: [
              ...current.intervalInventory.allocations,
              ...allocations,
            ],
          },
          metrics: {
            ...current.metrics,
            covers: current.metrics.covers + entry.partySize,
            seated: current.metrics.seated + entry.partySize,
            waitlist: Math.max(0, current.metrics.waitlist - 1),
          },
        };
      });
      setSelectedId(reservationId);
      setSelectedTableId(null);
      showMobileView("service");
      setMessage(`Demo: party seated at ${suggestion.label}.`);
      return;
    }
    const payload = {
      waitlistEntryId: entryId,
      tableIds: suggestion.tableIds,
      durationMinutes,
    };
    const scope = `waitlist-seat-${entryId}`;
    setBusy(true);
    const response = await seatWaitlistEntryAction({
      ...payload,
      requestId: requestIdFor(scope, payload),
    });
    setBusy(false);
    setMessage(
      response.ok
        ? `Party seated at ${suggestion.label}.`
        : response.message,
    );
    if (response.ok) {
      rotateRequestId(scope);
      updateModel((current) => ({
        ...current,
        waitlist: current.waitlist.filter((entry) => entry.id !== entryId),
      }));
      reconcileInBackground();
    }
  }

  return (
    <PageFrame width="full" className="max-w-[1800px]">
      <PageHeader
        eyebrow={`${workspace.activeLocation.name} · ${model.serviceName}`}
        title={dateTitle(model.businessDate)}
        detail={`${model.serviceWindow} · ${model.configuration.tableCount} tables · ${model.configuration.seatCount} seats`}
        status={
          <StatusPill
            tone={model.configuration.ready ? "positive" : "warning"}
            dot
          >
            {model.configuration.ready ? "Service ready" : "Setup needed"}
          </StatusPill>
        }
        actions={
          <>
            <Button
              variant="secondary"
              size="icon"
              onClick={() =>
                router.push(
                  `/reservations?date=${addIsoDays(model.businessDate, -1)}`,
                )
              }
              aria-label="Previous day"
            >
              <ChevronLeft className="size-4" />
            </Button>
            <Button
              variant="secondary"
              onClick={() => router.push("/reservations")}
            >
              Today
            </Button>
            <Button
              variant="secondary"
              size="icon"
              onClick={() =>
                router.push(
                  `/reservations?date=${addIsoDays(model.businessDate, 1)}`,
                )
              }
              aria-label="Next day"
            >
              <ChevronRight className="size-4" />
            </Button>
            <Button
              variant="secondary"
              disabled={busy || !canOperate || !isCurrentBook}
              aria-describedby={waitlistActionDescription}
              onClick={(event) => {
                setDialogTrigger(event.currentTarget);
                setWaitlistOpen(true);
              }}
            >
              <Clock3 className="size-4" />
              Waitlist
            </Button>
            <Button
              variant="accent"
              disabled={busy || !canOperate}
              aria-describedby={operationDescription}
              onClick={(event) => {
                setDialogTrigger(event.currentTarget);
                setBookMode("reservation");
              }}
            >
              <Plus className="size-4" />
              Book
            </Button>
          </>
        }
      />
      <RealtimeSyncStatus
        {...realtime}
        isRefreshing={realtime.isRefreshing || isReconciling}
      />

      {message ? (
        <div
          role="status"
          className="mt-4 flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-3 text-sm"
        >
          <span>{message}</span>
          <div className="flex items-center gap-1">
            {lastTableMove ? (
              <Button
                variant="quiet"
                size="sm"
                disabled={Boolean(movingTableId)}
                onClick={() => {
                  const move = lastTableMove;
                  setLastTableMove(null);
                  void moveTable(
                    move.tableId,
                    move.from.x,
                    move.from.y,
                    false,
                  );
                }}
              >
                Undo
              </Button>
            ) : null}
            <button
              type="button"
              onClick={() => {
                setMessage("");
                setLastTableMove(null);
              }}
              aria-label="Dismiss reservation notice"
              className="focus-ring -m-2 flex size-11 shrink-0 items-center justify-center rounded-lg"
            >
              <X className="size-4" />
            </button>
          </div>
        </div>
      ) : null}
      {!canOperate ? (
        <InlineNotice
          id={operationPermissionId}
          className="mt-4"
          title="Read-only reservation access"
        >
          You can review this book, guest context, pacing, and the floor.
          Creating or changing service records requires the exact
          reservations.operate capability for this location.
        </InlineNotice>
      ) : null}
      {!isCurrentBook ? (
        <InlineNotice
          id={currentBookPermissionId}
          className="mt-4"
          tone="warning"
          title="Current-service actions are paused"
        >
          This selected date is not today at the restaurant. The displayed
          waitlist and physical floor remain today’s live state; open Today
          before adding a walk-in, changing a table status, or notifying,
          accepting, seating, or removing a waitlist party.
        </InlineNotice>
      ) : null}
      {!model.configuration.ready ? (
        <div className="mt-4 flex flex-col gap-3 rounded-2xl border border-[color-mix(in_srgb,var(--warning)_30%,var(--line))] bg-[var(--warning-soft)] p-4 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <p className="text-sm font-semibold">
              Finish and approve reservation setup
            </p>
            <p className="mt-1 text-xs text-[var(--ink-faint)]">
              Online booking remains fail-closed until service rules and the
              draft floor are approved.
            </p>
          </div>
          <Button
            variant="secondary"
            disabled={!model.permissions.configure}
            aria-describedby={configurationDescription}
            onClick={() => router.push("/reservations/setup")}
          >
            <Settings2 className="size-4" />
            Configuration
          </Button>
          {!model.permissions.configure ? (
            <span id={configurationPermissionId} className="sr-only">
              Reservation configuration requires the exact
              reservations.configure capability for this location.
            </span>
          ) : null}
        </div>
      ) : null}
      <div className="mt-4 flex flex-wrap items-center gap-x-5 gap-y-2 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 py-3 text-xs">
        <span className="font-semibold text-[var(--ink)]">
          {model.metrics.covers} covers
        </span>
        <span className="text-[var(--ink-faint)]">
          {model.metrics.seated} seated · {model.metrics.remaining} remaining
        </span>
        <span className="text-[var(--ink-faint)]">
          {model.metrics.waitlist} waitlist
        </span>
        <span className="ml-auto flex items-center gap-2 text-[var(--ink-faint)]">
          <span
            className={cn(
              "size-2 rounded-full",
              model.configuration.onlineBookingEnabled
                ? "bg-[var(--positive)]"
                : "bg-[var(--ink-faint)]",
            )}
          />
          Online booking {model.configuration.onlineBookingEnabled ? "live" : "off"}
        </span>
      </div>

      <div ref={mobileViewAnchorRef} className="scroll-mt-20 lg:hidden">
        <ViewSwitcher
          value={mobileView}
          onValueChange={showMobileView}
          label="Reservation workspace view"
          className="mt-6"
          items={[
            {
              id: "book",
              label: "Book",
              badge: model.reservations.length,
              controls: "reservation-book-region",
            },
            {
              id: "floor",
              label: "Floor",
              badge: model.floorNow.tables.length,
              controls: "reservation-floor-region",
            },
            {
              id: "service",
              label: "Service",
              badge: model.waitlist.length,
              controls: "reservation-service-region",
            },
          ]}
        />
      </div>

      <div className="mt-4 grid gap-5 lg:mt-6 lg:grid-cols-[300px_minmax(0,1fr)]">
        <section
          id="reservation-book-region"
          aria-label="Reservation day book"
          className={cn(
            "min-w-0 lg:row-span-2",
            mobileView !== "book" && "hidden lg:block",
          )}
        >
          <SectionHeading
            eyebrow="Day book"
            title={`${filtered.length} reservations`}
            action={
              <Button
                variant="secondary"
                size="sm"
                disabled={busy || !canOperate || !isCurrentBook}
                aria-describedby={waitlistActionDescription}
                onClick={(event) => {
                  setDialogTrigger(event.currentTarget);
                  setBookMode("walk_in");
                }}
              >
                <UserRound className="size-4" />
                Walk-in
              </Button>
            }
          />
          <div className="mb-3 flex gap-1 overflow-x-auto rounded-xl bg-[var(--canvas-strong)] p-1">
            {(["all", "upcoming", "arrived", "seated"] as const).map(
              (value) => (
                <button
                  key={value}
                  onClick={() => setFilter(value)}
                  className={cn(
                    "focus-ring min-h-11 rounded-lg px-3 text-xs font-semibold capitalize",
                    filter === value
                      ? "bg-[var(--paper-strong)] text-[var(--ink)] shadow-sm"
                      : "text-[var(--ink-faint)]",
                  )}
                >
                  {value}
                </button>
              ),
            )}
          </div>
          <div className="space-y-2">
            {filtered.map((reservation) => (
              <button
                key={reservation.id}
                onClick={() => {
                  setSelectedId(reservation.id);
                  setSelectedTableId(null);
                  setAssignmentMode(false);
                  showMobileView("service");
                }}
                className={cn(
                  "grid w-full grid-cols-[62px_1fr_auto] items-center gap-3 rounded-2xl border p-3 text-left transition hover:border-[var(--line-strong)] hover:bg-[var(--paper-strong)]",
                  selectedId === reservation.id
                    ? "border-[var(--accent)] bg-[var(--accent-soft)]/30"
                    : "border-transparent bg-[var(--paper)]",
                )}
              >
                <div>
                  <p className="numeric text-sm font-bold">
                    {timeLabel(reservation.startsAt, model.timeZone)}
                  </p>
                  <p className="mt-1 text-[10px] text-[var(--ink-faint)]">
                    {reservation.durationMinutes}m
                  </p>
                </div>
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <p className="truncate text-sm font-semibold">
                      {reservation.guest.displayName}
                    </p>
                    {reservation.guest.vip ? (
                      <Sparkles className="size-3.5 shrink-0 text-[var(--accent-strong)]" />
                    ) : null}
                  </div>
                  <p className="mt-1 truncate text-xs text-[var(--ink-faint)]">
                    {reservation.partySize} guests ·{" "}
                    {reservation.tableLabel
                      ? `Table ${reservation.tableLabel}`
                      : "Unassigned"}
                  </p>
                </div>
                <StatusPill tone={statusTone(reservation.status)} size="sm">
                  {reservation.status.replaceAll("_", " ")}
                </StatusPill>
              </button>
            ))}
            {!filtered.length ? (
              <ReadState
                compact
                state="empty"
                title="No reservations in this view"
                description="Choose another status filter or add a reservation."
              />
            ) : null}
          </div>
        </section>

        <section
          id="reservation-floor-region"
          aria-label="Reservation floor"
          className={cn("min-w-0", mobileView !== "floor" && "hidden lg:block")}
        >
          <SectionHeading
            eyebrow="Dining room"
            title="Floor plan"
            detail={
              layoutEditing
                ? "Drag any table with a finger or pointer. Every move saves automatically."
                : assignmentMode && selected
                ? `Assignment mode · choose a table for ${selected.guest.displayName}, or cancel below.`
                : selected
                ? `The outline shows ${selected.guest.displayName}’s selected interval; table color still means physical state now.`
                : "Table colors show observed physical state, never future availability."
            }
            action={
              <Button
                variant={layoutEditing ? "accent" : "secondary"}
                size="sm"
                disabled={Boolean(movingTableId) || !model.permissions.configure}
                aria-describedby={configurationDescription}
                onClick={() => {
                  setLayoutEditing((current) => !current);
                  setAssignmentMode(false);
                  setSelectedTableId(null);
                  setMessage(
                    layoutEditing
                      ? "Floor editing finished."
                      : "Floor editing on. Drag a table to move it.",
                  );
                }}
              >
                {layoutEditing ? <Check className="size-4" /> : <Move className="size-4" />}
                {layoutEditing ? "Done" : "Edit floor"}
              </Button>
            }
          />
          <FloorPlan
            model={model}
            selected={selected}
            selectedTableId={selectedTableId}
            onSelectReservation={(reservationId) => {
              setSelectedId(reservationId);
              setSelectedTableId(null);
              setAssignmentMode(false);
              showMobileView("service");
            }}
            onSelectTable={(tableId) => {
              setSelectedTableId(tableId);
              setSelectedId(null);
              setAssignmentMode(false);
            }}
            onAssignTable={assignTable}
            canAssignTables={Boolean(
              canOperate &&
                assignmentMode &&
                selected &&
                assignableReservationStatuses.has(selected.status),
            )}
            editing={layoutEditing}
            onMoveTable={moveTable}
          />
          {assignmentMode && selected ? (
            <InlineNotice
              tone="info"
              title={`Assign a table to ${selected.guest.displayName}`}
              className="mt-3"
            >
              <p>
                Choose one available table on the floor, or let the exact-interval
                inventory select the best approved fit.
              </p>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  size="sm"
                  variant="secondary"
                  disabled={busy}
                  onClick={assignBestFit}
                >
                  Use best fit
                </Button>
                <Button
                  size="sm"
                  variant="quiet"
                  disabled={busy}
                  onClick={() => {
                    setAssignmentMode(false);
                    setMessage("Table assignment cancelled.");
                  }}
                >
                  Cancel assignment
                </Button>
              </div>
            </InlineNotice>
          ) : null}
          <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 py-2.5 text-[10px] leading-4 text-[var(--ink-faint)]">
            <strong className="text-[var(--ink-soft)]">
              Observed {timeLabel(model.floorNow.observedAt, model.timeZone)}.
            </strong>{" "}
            {model.floorNow.businessDateAtObservation !== model.businessDate
              ? `This remains the current physical floor while you review ${dateTitle(model.businessDate)}. `
              : ""}
            {model.intervalInventory.allocations.length} inventory interval
            {model.intervalInventory.allocations.length === 1 ? "" : "s"}{" "}
            (assignments, holds, and timed blocks){" "}
            {model.intervalInventory.allocations.length === 1 ? "is" : "are"}{" "}
            evaluated by exact overlap for this service date and do not recolor
            the floor.
          </div>
          {selectedTable ? (
            <Surface variant="outlined" padding="sm" className="mt-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-xs font-semibold">
                    Table {selectedTable.label} · {selectedTable.maxCapacity}{" "}
                    seats
                  </p>
                  <p className="mt-1 text-[10px] capitalize text-[var(--ink-faint)]">
                    {selectedTable.state.replaceAll("_", " ")}
                  </p>
                </div>
                <button
                  type="button"
                  className="focus-ring -m-1 flex size-11 items-center justify-center rounded-lg text-[var(--ink-faint)] hover:bg-[var(--canvas-strong)]"
                  onClick={() => setSelectedTableId(null)}
                  aria-label="Close table controls"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="mt-3 flex flex-wrap gap-2">
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || !canOperate || !isCurrentBook}
                  aria-describedby={floorActionDescription}
                  onClick={() => setTableStatus("available")}
                >
                  Ready
                </Button>
                <Button
                  variant="secondary"
                  size="sm"
                  disabled={busy || !canOperate || !isCurrentBook}
                  aria-describedby={floorActionDescription}
                  onClick={() => setTableStatus("needs_reset")}
                >
                  Needs reset
                </Button>
                <Button
                  variant="danger"
                  size="sm"
                  disabled={busy || !canOperate || !isCurrentBook}
                  aria-describedby={floorActionDescription}
                  onClick={() => setTableStatus("blocked")}
                >
                  Block
                </Button>
              </div>
            </Surface>
          ) : null}
          <div className="mt-4 flex flex-wrap justify-center gap-3 text-[10px] font-semibold text-[var(--ink-faint)]">
            {(["available", "occupied", "needs_reset", "blocked"] as const).map(
              (state) => (
                <span
                  key={state}
                  className="flex items-center gap-1.5 capitalize"
                >
                  <Circle
                    className={cn(
                      "size-2.5 fill-current",
                      state === "available" && "text-[var(--ink-faint)]",
                      state === "occupied" && "text-[var(--positive)]",
                      state === "needs_reset" && "text-[var(--warning)]",
                      state === "blocked" && "text-[var(--ink-soft)]",
                    )}
                  />
                  {state.replaceAll("_", " ")}
                </span>
              ),
            )}
          </div>
        </section>

        <aside
          id="reservation-service-region"
          aria-label="Reservation service context"
          className={cn(
            "min-w-0 lg:col-start-2",
            mobileView !== "service" && "hidden lg:block",
          )}
        >
          <SectionHeading eyebrow="Service pulse" title="Pacing & context" />
          <Surface variant="outlined" padding="md">
            <p className="text-xs font-semibold">Covers by hour</p>
            <div className="mt-5 flex h-28 items-end gap-2">
              {model.pacing.map((bucket) => (
                <div
                  key={bucket.startsAt}
                  className="flex flex-1 flex-col items-center gap-2"
                >
                  <span className="text-[10px] font-bold">{bucket.covers}</span>
                  <div
                    className={cn(
                      "w-full rounded-t-md",
                      bucket.covers > bucket.limit
                        ? "bg-[var(--danger)]"
                        : "bg-[var(--accent)]",
                    )}
                    style={{
                      height: `${Math.max(8, Math.min(100, (bucket.covers / bucket.limit) * 100))}%`,
                    }}
                  />
                  <span className="text-[9px] text-[var(--ink-faint)]">
                    {bucket.label}
                  </span>
                </div>
              ))}
            </div>
            <p className="mt-4 text-[10px] text-[var(--ink-faint)]">
              Target: up to {model.pacing[0]?.limit ?? 0} covers per pacing
              interval.
            </p>
          </Surface>
          {selected ? (
            <Surface variant="raised" padding="md" className="mt-4">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="eyebrow">Guest context</p>
                  <h3 className="mt-2 text-xl font-semibold tracking-[-0.035em]">
                    {selected.guest.displayName}
                  </h3>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">
                    {selected.guest.visitCount} visits ·{" "}
                    {formatMoney(
                      selected.guest.lifetimeSpendCents,
                      model.currencyCode,
                    )}{" "}
                    lifetime
                  </p>
                </div>
                <Button
                  size="icon"
                  variant="quiet"
                  onClick={() => {
                    setSelectedId(null);
                    setAssignmentMode(false);
                  }}
                  aria-label="Close guest context"
                >
                  <X className="size-4" />
                </Button>
              </div>
              <div className="mt-5 grid grid-cols-2 gap-2">
                <div className="rounded-xl bg-[var(--canvas)] p-3">
                  <p className="text-[10px] text-[var(--ink-faint)]">Party</p>
                  <p className="mt-1 text-sm font-bold">
                    {selected.partySize} at{" "}
                    {timeLabel(selected.startsAt, model.timeZone)}
                  </p>
                </div>
                <div className="rounded-xl bg-[var(--canvas)] p-3">
                  <p className="text-[10px] text-[var(--ink-faint)]">Table</p>
                  <p className="mt-1 text-sm font-bold">
                    {selected.tableLabel ?? "Unassigned"}
                  </p>
                </div>
              </div>
              {selected.guest.allergies ? (
                <div className="mt-3 rounded-xl bg-[var(--danger-soft)] p-3 text-xs">
                  <strong className="block text-[var(--danger)]">
                    Allergy · verify verbally
                  </strong>
                  <span className="mt-1 block">{selected.guest.allergies}</span>
                </div>
              ) : null}
              {selected.guest.preferences ? (
                <p className="mt-3 rounded-xl bg-[var(--accent-soft)] p-3 text-xs leading-5">
                  <strong>Hospitality notes</strong>
                  <br />
                  {selected.guest.preferences}
                </p>
              ) : null}
              {selected.specialRequests ? (
                <p className="mt-3 text-xs leading-5 text-[var(--ink-faint)]">
                  <MessageSquareText className="mr-1.5 inline size-3.5" />
                  {selected.specialRequests}
                </p>
              ) : null}
              <ObjectActionBar
                entity="reservation"
                state={selected.status}
                context={objectActionContext}
                label={`Actions for ${selected.guest.displayName}`}
                className="mt-5 grid grid-cols-2 gap-2"
                busy={busy}
                unauthorizedDescriptionId={operationPermissionId}
                handlers={{
                  ...(canOperate && selectedLifecycleOwned
                    ? {
                        "reservation.edit": () =>
                          setEditReservationTarget(selected),
                        "reservation.cancel": () =>
                          setCancelReservationTarget(selected),
                      }
                    : {}),
                  "reservation.arrive": () => transition("arrived"),
                  "reservation.seat": () => transition("seated"),
                  "reservation.complete": () => transition("completed"),
                  "reservation.suggest_table": beginTableAssignment,
                  "reservation.share": shareReservation,
                  "reservation.no_show": () => setNoShowConfirmOpen(true),
                }}
                icons={{
                  "reservation.edit": <PencilLine className="size-4" />,
                  "reservation.arrive": <Check className="size-4" />,
                  "reservation.seat": <Utensils className="size-4" />,
                  "reservation.complete": <Check className="size-4" />,
                  "reservation.share": <Share2 className="size-4" />,
                  "reservation.cancel": <Ban className="size-4" />,
                }}
                variants={{
                  "reservation.edit": "secondary",
                  "reservation.arrive": "accent",
                  "reservation.seat": "accent",
                  "reservation.complete": "accent",
                  "reservation.suggest_table": "secondary",
                  "reservation.share": "quiet",
                  "reservation.no_show": "quiet",
                  "reservation.cancel": "danger",
                }}
                disabled={{
                  "reservation.arrive": !isCurrentBook,
                  "reservation.seat": !isCurrentBook,
                  "reservation.complete": !isCurrentBook,
                  "reservation.no_show": !isCurrentBook,
                }}
                describedBy={{
                  "reservation.arrive": currentBookDescription,
                  "reservation.seat": currentBookDescription,
                  "reservation.complete": currentBookDescription,
                  "reservation.no_show": currentBookDescription,
                }}
              />
              {!selectedLifecycleOwned ? (
                <InlineNotice
                  tone="info"
                  title="Managed by an external reservation source"
                  className="mt-4"
                >
                  This record is read-only in Le Yard OS until source writer
                  ownership is approved. Edit or cancel it in the owning source
                  and reconcile the change here.
                </InlineNotice>
              ) : null}
              <div className="mt-4 rounded-xl border border-[var(--line)] bg-[var(--canvas)] p-3 text-xs leading-5 text-[var(--ink-faint)]">
                <p className="font-semibold text-[var(--ink-soft)]">
                  Current record · version {selected.version}
                </p>
                {selected.lastRevision ? (
                  <p className="mt-1">
                    Last staff {selected.lastRevision.kind === "staff_cancelled" ? "cancellation" : "edit"} recorded {dateTimeLabel(selected.lastRevision.changedAt, model.timeZone)}. Previous commitment: {dateTimeLabel(selected.lastRevision.previousReservedAt, model.timeZone)} for {selected.lastRevision.previousPartySize} guests.
                  </p>
                ) : (
                  <p className="mt-1">No prior staff revision is attached to this record.</p>
                )}
                <p className="mt-1">
                  {selected.policyEvidenceCaptured
                    ? "Materialized service and policy evidence is attached to the latest revision."
                    : "No staff policy evidence has been captured for this reservation yet."}
                </p>
              </div>
            </Surface>
          ) : (
            <Surface variant="inset" padding="lg" className="mt-4 text-center">
              <UsersRound className="mx-auto size-6 text-[var(--ink-faint)]" />
              <p className="mt-3 text-sm font-semibold">Select a guest</p>
              <p className="mt-1 text-xs leading-5 text-[var(--ink-faint)]">
                Guest history, notes, status actions, and table assignment will
                appear here.
              </p>
            </Surface>
          )}
          <Surface variant="outlined" padding="md" className="mt-4">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-xs font-semibold">Waitlist</p>
                <p className="mt-1 text-[10px] text-[var(--ink-faint)]">
                  {floorMatchesBook
                    ? "Live quote order"
                    : "Open today’s book to seat from the current floor"}
                </p>
              </div>
              <Button
                variant="quiet"
                size="sm"
                disabled={busy || !canOperate || !isCurrentBook}
                aria-describedby={waitlistActionDescription}
                onClick={(event) => {
                  setDialogTrigger(event.currentTarget);
                  setWaitlistOpen(true);
                }}
              >
                Add
              </Button>
            </div>
            <div className="mt-3 divide-y divide-[var(--line)]">
              {model.waitlist.map((entry) => (
                <div key={entry.id} className="py-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-xs font-semibold">
                        {entry.displayName} · {entry.partySize}
                      </p>
                      <p className="mt-1 text-[10px] text-[var(--ink-faint)]">
                        {entry.status} {entry.notes ? `· ${entry.notes}` : ""}
                      </p>
                    </div>
                    <StatusPill
                      tone={entry.status === "notified" ? "accent" : "neutral"}
                      size="sm"
                    >
                      {entry.quotedWaitMinutes ?? "—"}m
                    </StatusPill>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1.5">
                    {entry.status === "waiting" ? (
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={busy || !canOperate || !isCurrentBook}
                        aria-describedby={waitlistActionDescription}
                        onClick={() => notifyWaitlist(entry.id, "notified")}
                      >
                        Notify
                      </Button>
                    ) : null}
                    {entry.status === "notified" ? (
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={busy || !canOperate || !isCurrentBook}
                        aria-describedby={waitlistActionDescription}
                        onClick={() => notifyWaitlist(entry.id, "accepted")}
                      >
                        Accept
                      </Button>
                    ) : null}
                    {["waiting", "notified", "accepted"].includes(
                      entry.status,
                    ) ? (
                      <Button
                        variant="accent"
                        size="sm"
                        disabled={busy || !canOperate || !isCurrentBook}
                        aria-describedby={waitlistActionDescription}
                        onClick={() => seatWaitlist(entry.id, entry.partySize)}
                      >
                        Seat now
                      </Button>
                    ) : null}
                    {["waiting", "notified", "accepted"].includes(
                      entry.status,
                    ) ? (
                      <Button
                        variant="quiet"
                        size="sm"
                        disabled={busy || !canOperate || !isCurrentBook}
                        aria-describedby={waitlistActionDescription}
                        onClick={() => notifyWaitlist(entry.id, "cancelled")}
                      >
                        Remove
                      </Button>
                    ) : null}
                  </div>
                </div>
              ))}
              {!model.waitlist.length ? (
                <ReadState
                  compact
                  state="empty"
                  title="No active waitlist"
                  description="New waiting parties will appear here in quote order."
                  className="rounded-none border-x-0 border-b-0 shadow-none"
                />
              ) : null}
            </div>
          </Surface>
        </aside>
      </div>

      {bookMode ? (
        <Dialog
          title={bookMode === "walk_in" ? "Add walk-in" : "New reservation"}
          detail="Guest context and the best-fitting available table are saved together."
          onClose={() => setBookMode(null)}
          returnFocusTarget={dialogTrigger}
        >
          <form
            onSubmit={submitBooking}
            className="mt-6 grid grid-cols-2 gap-4"
          >
            <label className="col-span-2">
              <span className="mb-1.5 block text-xs font-semibold">
                Guest name
              </span>
              <input
                className={fieldClass}
                name="displayName"
                required
                autoFocus
              />
            </label>
            <label className="col-span-2 sm:col-span-1">
              <span className="mb-1.5 block text-xs font-semibold">Email</span>
              <input className={fieldClass} name="email" type="email" />
            </label>
            <label className="col-span-2 sm:col-span-1">
              <span className="mb-1.5 block text-xs font-semibold">Phone</span>
              <input className={fieldClass} name="phone" type="tel" />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold">Party</span>
              <input
                className={fieldClass}
                name="partySize"
                type="number"
                min="1"
                max="100"
                defaultValue="2"
                required
              />
            </label>
            <FormField
              id="reservation-book-duration"
              label="Turn time"
              description="Whole minutes from 15 to 720. Service policy is checked when saved."
              required
            >
              <input
                name="durationMinutes"
                type="number"
                inputMode="numeric"
                min="15"
                max="720"
                step="1"
                defaultValue="90"
              />
            </FormField>
            <label>
              <span className="mb-1.5 block text-xs font-semibold">Date</span>
              <input
                className={fieldClass}
                name="date"
                type="date"
                defaultValue={model.businessDate}
                required
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold">Time</span>
              <input
                className={fieldClass}
                name="time"
                type="time"
                defaultValue="19:00"
                disabled={bookMode === "walk_in"}
                required={bookMode !== "walk_in"}
              />
            </label>
            <label className="col-span-2">
              <span className="mb-1.5 block text-xs font-semibold">
                Requests and notes
              </span>
              <textarea
                className="min-h-24 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-base outline-none focus:border-[var(--accent)] sm:text-sm"
                name="notes"
              />
            </label>
            <div className="col-span-2 mt-2 flex justify-end gap-2">
              <Button variant="quiet" onClick={() => setBookMode(null)}>
                Cancel
              </Button>
              <Button
                variant="accent"
                type="submit"
                disabled={busy || !canOperate}
                aria-describedby={operationDescription}
              >
                <CalendarPlus className="size-4" />
                {busy
                  ? "Saving…"
                  : bookMode === "walk_in"
                    ? "Add walk-in"
                    : "Save reservation"}
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
      {waitlistOpen ? (
        <Dialog
          title="Add to waitlist"
          detail="Capture the quote now; offer and seating transitions stay in the service trail."
          onClose={() => setWaitlistOpen(false)}
          returnFocusTarget={dialogTrigger}
        >
          <form
            onSubmit={submitWaitlist}
            className="mt-6 grid grid-cols-2 gap-4"
          >
            <label className="col-span-2">
              <span className="mb-1.5 block text-xs font-semibold">
                Guest name
              </span>
              <input
                className={fieldClass}
                name="displayName"
                required
                autoFocus
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold">
                Mobile phone
              </span>
              <input className={fieldClass} name="phone" type="tel" required />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold">
                Email{" "}
                <span className="font-normal text-[var(--ink-faint)]">
                  optional
                </span>
              </span>
              <input className={fieldClass} name="email" type="email" />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold">Party</span>
              <input
                className={fieldClass}
                name="partySize"
                type="number"
                min="1"
                defaultValue="2"
                required
              />
            </label>
            <label>
              <span className="mb-1.5 block text-xs font-semibold">
                Quoted wait
              </span>
              <div className="relative">
                <input
                  className={cn(fieldClass, "pr-12")}
                  name="quotedWaitMinutes"
                  type="number"
                  min="0"
                  defaultValue="20"
                  required
                />
                <span className="absolute right-3 top-3 text-xs text-[var(--ink-faint)]">
                  min
                </span>
              </div>
            </label>
            <label className="col-span-2">
              <span className="mb-1.5 block text-xs font-semibold">Notes</span>
              <textarea
                className="min-h-20 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] p-3 text-base sm:text-sm"
                name="notes"
              />
            </label>
            <div className="col-span-2 flex justify-end gap-2">
              <Button variant="quiet" onClick={() => setWaitlistOpen(false)}>
                Cancel
              </Button>
              <Button
                variant="accent"
                type="submit"
                disabled={busy || !canOperate || !isCurrentBook}
                aria-describedby={waitlistActionDescription}
              >
                Add guest
              </Button>
            </div>
          </form>
        </Dialog>
      ) : null}
      {editReservation &&
      canOperate &&
      isReservationLifecycleOwnedByOs(editReservation) ? (
        <ReservationEditDialog
          workspace={workspace}
          model={model}
          reservation={editReservation}
          onClose={() => setEditReservationTarget(null)}
          onCompleted={(nextMessage) => {
            setMessage(nextMessage);
            reconcileInBackground();
          }}
        />
      ) : null}
      {cancellationReservation &&
      canOperate &&
      isReservationLifecycleOwnedByOs(cancellationReservation) ? (
        <ReservationCancelDialog
          workspace={workspace}
          model={model}
          reservation={cancellationReservation}
          onClose={() => setCancelReservationTarget(null)}
          onCompleted={(nextMessage) => {
            setMessage(nextMessage);
            updateReservationStatus(cancellationReservation.id, "cancelled");
            reconcileInBackground();
          }}
        />
      ) : null}
      <ConfirmActionDialog
        open={noShowConfirmOpen && Boolean(selected)}
        labelledBy={noShowConfirmTitleId}
        title="Mark this reservation as a no-show?"
        description={
          selected
            ? `${selected.guest.displayName} will leave the active service queue and the change will be recorded in the reservation history.`
            : "The reservation will leave the active service queue."
        }
        confirmLabel="Mark no-show"
        busy={busy}
        onClose={() => setNoShowConfirmOpen(false)}
        onConfirm={async () => {
          await transition("no_show");
          setNoShowConfirmOpen(false);
        }}
      />
    </PageFrame>
  );
}
