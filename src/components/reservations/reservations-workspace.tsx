"use client";

import {
  AlertTriangle,
  CalendarPlus,
  Check,
  ChevronLeft,
  ChevronRight,
  Circle,
  Clock3,
  MessageSquareText,
  Plus,
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
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  saveReservationWithGuestAction,
  saveWaitlistEntryAction,
  seatWaitlistEntryAction,
  setReservationTableStatusAction,
  transitionReservationAction,
  transitionWaitlistEntryAction,
  assignReservationTablesAction,
} from "@/app/actions/workflows/reservations";
import { ObjectActionBar } from "@/components/actions/object-action-bar";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { InlineNotice } from "@/components/ui/inline-notice";
import { Modal } from "@/components/ui/modal";
import { ReadState } from "@/components/ui/read-state";
import {
  Metric,
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
  ReservationInventoryAllocationSummary,
  ReservationPhysicalTableState,
  ReservationStatus,
  ReservationSummary,
} from "@/lib/reservations/model";
import { canAccessReservationHost } from "@/lib/reservations/model";
import { createClient } from "@/lib/supabase/client";
import { cn, formatMoney } from "@/lib/utils";

type BookMode = "reservation" | "walk_in";
const fieldClass =
  "h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-base outline-none focus:border-[var(--accent)] sm:text-sm";
const stateStyles: Record<ReservationPhysicalTableState, string> = {
  available:
    "border-[var(--line-strong)] bg-[var(--paper-strong)] text-[var(--ink)]",
  occupied:
    "border-[color-mix(in_srgb,var(--positive)_40%,var(--line))] bg-[var(--positive-soft)] text-[var(--positive)]",
  needs_reset:
    "border-[color-mix(in_srgb,var(--warning)_40%,var(--line))] bg-[var(--warning-soft)] text-[var(--warning)]",
  blocked:
    "border-[var(--line-strong)] bg-[var(--canvas-strong)] text-[var(--ink-faint)] opacity-65",
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

function FloorPlan({
  model,
  selected,
  onSelectReservation,
  onSelectTable,
  onAssignTable,
  selectedTableId,
  canAssignTables,
}: {
  model: ReservationHostModel;
  selected: ReservationSummary | null;
  onSelectReservation: (id: string) => void;
  onSelectTable: (id: string) => void;
  onAssignTable: (id: string) => void;
  selectedTableId: string | null;
  canAssignTables: boolean;
}) {
  return (
    <div className="relative mx-auto aspect-[3/4] w-full max-w-[560px] overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--canvas-strong)] shadow-[0_1px_0_rgba(255,255,255,.7)_inset]">
      <div className="absolute inset-x-[8%] top-[3%] h-[14%] rounded-[18px] border border-dashed border-[var(--line-strong)] bg-[var(--paper)]/35">
        <span className="absolute left-3 top-2 text-[9px] font-semibold uppercase tracking-[.16em] text-[var(--ink-faint)]">
          Entry · register
        </span>
      </div>
      <div className="absolute bottom-[2%] left-[6%] top-[20%] w-[23%] rounded-[18px] border border-dashed border-[var(--line)] bg-[var(--paper)]/20">
        <span className="absolute bottom-3 left-3 text-[9px] font-semibold uppercase tracking-[.16em] text-[var(--ink-faint)] [writing-mode:vertical-rl]">
          Service lane
        </span>
      </div>
      <div className="absolute inset-x-[32%] bottom-[2%] top-[20%] rounded-[22px] border border-[var(--line)] bg-[var(--paper)]/25" />
      {model.floorNow.tables.map((table) => {
        const occupyingReservation = table.occupyingReservationId
          ? model.reservations.find(
              (entry) => entry.id === table.occupyingReservationId,
            )
          : null;
        const isSelectedInterval = Boolean(
          selected?.tableIds.includes(table.id),
        );
        return (
          <button
            key={table.id}
            type="button"
            title={`Table ${table.label} · ${table.maxCapacity} seats · ${table.state.replaceAll("_", " ")} now${isSelectedInterval ? " · assigned to selected interval" : ""}`}
            onClick={() =>
              selected && canAssignTables
                ? onAssignTable(table.id)
                : occupyingReservation
                  ? onSelectReservation(occupyingReservation.id)
                  : onSelectTable(table.id)
            }
            className={cn(
              "absolute z-10 flex min-h-11 min-w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center border text-xs font-bold shadow-sm transition duration-150 hover:z-20 hover:scale-105 focus:z-20 focus:outline-none focus:ring-2 focus:ring-[var(--accent)]",
              table.shape === "round" ? "rounded-full" : "rounded-[10px]",
              stateStyles[table.state],
              isSelectedInterval &&
                "ring-2 ring-[var(--ink)] ring-offset-2 ring-offset-[var(--canvas-strong)]",
              selectedTableId === table.id &&
                "ring-2 ring-[var(--accent)] ring-offset-2 ring-offset-[var(--canvas-strong)]",
            )}
            style={{
              left: `${table.x * 100}%`,
              top: `${table.y * 100}%`,
              width: `${Math.max(table.width * 100, 9)}%`,
              height: `${Math.max(table.height * 100, 6)}%`,
              rotate: `${table.rotation}deg`,
            }}
          >
            <span>{table.label}</span>
            {occupyingReservation ? (
              <span className="absolute -right-1.5 -top-1.5 flex size-4 items-center justify-center rounded-full bg-[var(--ink)] text-[8px] text-[var(--paper)]">
                {occupyingReservation.partySize}
              </span>
            ) : null}
          </button>
        );
      })}
      <div className="absolute bottom-3 left-1/2 -translate-x-1/2 rounded-full border border-[var(--line)] bg-[var(--paper-strong)]/90 px-3 py-1 text-[9px] font-semibold uppercase tracking-[.14em] text-[var(--ink-faint)] backdrop-blur">
        Floor now · verify on site
      </div>
    </div>
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
  const model = result.ok ? result.data : null;
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [filter, setFilter] = useState<
    "all" | "upcoming" | "arrived" | "seated"
  >("all");
  const [mobileView, setMobileView] = useState<"book" | "floor" | "service">(
    "book",
  );
  const [bookMode, setBookMode] = useState<BookMode | null>(null);
  const [waitlistOpen, setWaitlistOpen] = useState(false);
  const [noShowConfirmOpen, setNoShowConfirmOpen] = useState(false);
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

  function showMobileView(view: "book" | "floor" | "service") {
    setMobileView(view);
    if (
      typeof window === "undefined" ||
      typeof window.matchMedia !== "function" ||
      !window.matchMedia("(max-width: 1279px)").matches
    )
      return;
    window.requestAnimationFrame(() =>
      mobileViewAnchorRef.current?.scrollIntoView({ block: "start" }),
    );
  }

  useEffect(() => {
    if (workspace.mode !== "live") return;
    const supabase = createClient();
    const channel = supabase.channel(
      `reservations:${workspace.organization.id}:${workspace.activeLocation.id}`,
      { config: { private: true } },
    );
    for (const event of ["INSERT", "UPDATE", "DELETE"])
      channel.on("broadcast", { event }, () => router.refresh());
    channel.subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [
    router,
    workspace.activeLocation.id,
    workspace.mode,
    workspace.organization.id,
  ]);

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
      router.refresh();
    }
  }

  async function assignTables(tableIds: string[], label: string) {
    if (!canOperate) {
      setMessage("Table assignment requires reservation operating access.");
      return;
    }
    if (!selected || workspace.mode === "demo") {
      if (selected)
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
      router.refresh();
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
    if (!suggestions[0]) {
      setMessage("No approved table or combination is available.");
      return;
    }
    await assignTables(suggestions[0].tableIds, suggestions[0].label);
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
      router.refresh();
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
    const partySize = Number(data.get("partySize"));
    const durationMinutes = Number(data.get("durationMinutes"));
    const suggestions = suggestTables({
      partySize,
      startsAt: tentative,
      durationMinutes,
      tables: availabilityTables(readyModel),
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
      response.ok ? "Reservation saved and table suggested." : response.message,
    );
    if (response.ok) {
      rotateRequestId(reservationScope);
      setBookMode(null);
      router.refresh();
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
      router.refresh();
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
      router.refresh();
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
    if (!suggestions[0]) {
      setMessage(
        "No approved table or combination is available for this party right now.",
      );
      return;
    }
    if (workspace.mode === "demo") {
      setMessage(`Demo: party seated at ${suggestions[0].label}.`);
      return;
    }
    const payload = {
      waitlistEntryId: entryId,
      tableIds: suggestions[0].tableIds,
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
        ? `Party seated at ${suggestions[0].label}.`
        : response.message,
    );
    if (response.ok) {
      rotateRequestId(scope);
      router.refresh();
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

      {message ? (
        <div
          role="status"
          className="mt-4 flex items-center justify-between rounded-xl border border-[var(--line)] bg-[var(--paper-strong)] px-4 py-3 text-sm"
        >
          <span>{message}</span>
          <button
            type="button"
            onClick={() => setMessage("")}
            aria-label="Dismiss reservation notice"
            className="focus-ring -m-2 flex size-11 shrink-0 items-center justify-center rounded-lg"
          >
            <X className="size-4" />
          </button>
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
      <div className="mt-4 grid grid-cols-2 divide-x divide-y divide-[var(--line)] border-y border-[var(--line)] sm:grid-cols-4 sm:divide-y-0">
        <Metric
          label="Booked covers"
          value={String(model.metrics.covers)}
          detail="Excludes holds and cancellations"
        />
        <Metric
          label="Seated"
          value={String(model.metrics.seated)}
          detail={`${model.metrics.remaining} covers remaining`}
        />
        <Metric
          label="Waitlist"
          value={String(model.metrics.waitlist)}
          detail="Active and notified"
        />
        <Metric
          label="Online"
          value={model.configuration.onlineBookingEnabled ? "Live" : "Off"}
          detail={
            model.configuration.messagingEnabled
              ? "Guest messaging on"
              : "Messaging off"
          }
        />
      </div>

      <div ref={mobileViewAnchorRef} className="scroll-mt-20 xl:hidden">
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

      <div className="mt-4 grid gap-6 xl:mt-7 xl:grid-cols-[minmax(270px,.85fr)_minmax(400px,1.2fr)_minmax(210px,.65fr)]">
        <section
          id="reservation-book-region"
          aria-label="Reservation day book"
          className={cn("min-w-0", mobileView !== "book" && "hidden xl:block")}
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
          className={cn("min-w-0", mobileView !== "floor" && "hidden xl:block")}
        >
          <SectionHeading
            eyebrow="Physical room"
            title="Floor now"
            detail={
              selected
                ? `The outline shows ${selected.guest.displayName}’s selected interval; table color still means physical state now.`
                : "Table colors show observed physical state, never future availability."
            }
          />
          <FloorPlan
            model={model}
            selected={selected}
            selectedTableId={selectedTableId}
            onSelectReservation={(reservationId) => {
              setSelectedId(reservationId);
              setSelectedTableId(null);
              showMobileView("service");
            }}
            onSelectTable={(tableId) => {
              setSelectedTableId(tableId);
              setSelectedId(null);
            }}
            onAssignTable={assignTable}
            canAssignTables={canOperate}
          />
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
            "min-w-0",
            mobileView !== "service" && "hidden xl:block",
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
                  onClick={() => setSelectedId(null)}
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
                  "reservation.arrive": () => transition("arrived"),
                  "reservation.seat": () => transition("seated"),
                  "reservation.complete": () => transition("completed"),
                  "reservation.suggest_table": assignBestFit,
                  "reservation.share": shareReservation,
                  "reservation.no_show": () => setNoShowConfirmOpen(true),
                }}
                icons={{
                  "reservation.arrive": <Check className="size-4" />,
                  "reservation.seat": <Utensils className="size-4" />,
                  "reservation.complete": <Check className="size-4" />,
                  "reservation.share": <Share2 className="size-4" />,
                }}
                variants={{
                  "reservation.arrive": "accent",
                  "reservation.seat": "accent",
                  "reservation.complete": "accent",
                  "reservation.suggest_table": "secondary",
                  "reservation.share": "quiet",
                  "reservation.no_show": "quiet",
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
            <label>
              <span className="mb-1.5 block text-xs font-semibold">
                Turn time
              </span>
              <select
                className={fieldClass}
                name="durationMinutes"
                defaultValue="90"
              >
                <option value="60">1 hour</option>
                <option value="90">1½ hours</option>
                <option value="120">2 hours</option>
                <option value="150">2½ hours</option>
              </select>
            </label>
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
