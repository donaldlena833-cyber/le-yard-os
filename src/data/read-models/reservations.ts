import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import type {
  ReservationHostModel,
  ReservationHostPermissions,
  ReservationInventoryAllocationState,
  ReservationInventoryAllocationSummary,
  ReservationLastRevisionSummary,
  ReservationPhysicalTableState,
  ReservationStatus,
  ReservationTableStatusEventState,
} from "@/lib/reservations/model";
import {
  canAccessReservationHost,
  deriveReservationHostPermissions,
} from "@/lib/reservations/model";
import { deriveReservationPacingBuckets } from "@/lib/reservations/pacing";
import {
  buildReservationServiceWindows,
  reservationInstantFallsInServiceWindows,
} from "@/lib/reservations/service-windows";
import {
  isReservationAllocationActiveAt,
  isReservationPhysicalStatusEvent,
  reservationTableAcceptsIntervalBookings,
  resolveReservationPhysicalTableState,
} from "@/lib/reservations/floor-projection";
import { createClient } from "@/lib/supabase/server";
import type { TableRow } from "@/types/database.generated";
import { readFailure, readSuccess, type LiveReadResult } from "./shared";
import { addIsoDays, zonedLocalToIso } from "./local-time";

type ReservationGuestSummary = {
  id: string;
  display_name: string;
  vip: boolean;
  visit_count: number;
};

type AuthorizedGuestDetails = {
  id: string;
  email?: string | null;
  phone?: string | null;
  allergies?: string | null;
  preferences?: string | null;
  lifetime_spend_cents?: number | null;
};

type ReservationAllocationRow = {
  id: string;
  table_id: string;
  reservation_id: string | null;
  starts_at: string;
  ends_at: string;
  expires_at: string | null;
  allocation_kind: string;
};

type ReservationStatusEventRow = Pick<
  TableRow<"table_status_events">,
  "id" | "occurred_at" | "reservation_id" | "status" | "table_id"
>;

type ReservationTableWithLatestStatus = TableRow<"reservation_tables"> & {
  table_status_events: ReservationStatusEventRow[];
};

type ReservationCapacityRow = {
  startsAt: string;
  partySize: number;
  kind: "reservation" | "hold";
};

type ReservationHostSnapshotRow = {
  id: string;
  guest_id: string | null;
  version: number;
  reserved_at: string;
  duration_minutes: number | null;
  party_size: number;
  status: string;
  table_label: string | null;
  special_requests: string | null;
  source: string;
  booking_channel: string;
  policy_evidence_captured: boolean;
  last_revision: unknown | null;
};

type ReservationRpc = {
  (
    name: "service_reservation_host_snapshot",
    args: {
      p_organization_id: string;
      p_location_id: string;
      p_from: string;
      p_to: string;
    },
  ): Promise<{
    data: ReservationHostSnapshotRow[] | null;
    error: { message: string } | null;
  }>;
  (
    name: "reservation_capacity_snapshot",
    args: {
      p_organization_id: string;
      p_location_id: string;
      p_from: string;
      p_to: string;
    },
  ): Promise<{
    data: ReservationCapacityRow[] | null;
    error: { message: string } | null;
  }>;
  (
    name: "service_reservation_guest_summaries",
    args: {
      p_organization_id: string;
      p_location_id: string;
      p_guest_ids: string[];
    },
  ): Promise<{
    data: ReservationGuestSummary[] | null;
    error: { message: string } | null;
  }>;
};

const physicalTableStates = [
  "available",
  "occupied",
  "needs_reset",
  "blocked",
] as const satisfies readonly ReservationPhysicalTableState[];

function projectLastRevision(
  value: unknown,
): ReservationLastRevisionSummary | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const revision = value as Record<string, unknown>;
  if (
    typeof revision.id !== "string" ||
    (revision.kind !== "staff_modified" &&
      revision.kind !== "staff_cancelled") ||
    typeof revision.version !== "number" ||
    typeof revision.changedAt !== "string" ||
    typeof revision.previousReservedAt !== "string" ||
    typeof revision.previousPartySize !== "number"
  ) {
    return null;
  }
  return {
    id: revision.id,
    kind: revision.kind,
    version: revision.version,
    changedAt: revision.changedAt,
    previousReservedAt: revision.previousReservedAt,
    previousPartySize: revision.previousPartySize,
  };
}

function inventoryAllocationState(
  allocationKind: string,
): ReservationInventoryAllocationState {
  if (allocationKind === "hold") return "tentative";
  if (allocationKind === "assignment") return "committed";
  return "blocked";
}

function projectInventoryAllocation(
  allocation: ReservationAllocationRow,
): ReservationInventoryAllocationSummary {
  return {
    id: allocation.id,
    tableId: allocation.table_id,
    reservationId: allocation.reservation_id,
    startsAt: allocation.starts_at,
    endsAt: allocation.ends_at,
    expiresAt: allocation.expires_at,
    state: inventoryAllocationState(allocation.allocation_kind),
  };
}

function chunks<T>(values: readonly T[], size: number): T[][] {
  const output: T[][] = [];
  for (let index = 0; index < values.length; index += size)
    output.push(values.slice(index, index + size));
  return output;
}

export async function loadLiveReservations(
  workspace: WorkspaceContextValue,
  businessDate: string,
  options: {
    observedAt?: string;
    observationBusinessDate?: string;
    observationServicePeriodId?: string | null;
  } = {},
): Promise<LiveReadResult<ReservationHostModel>> {
  const permissions: ReservationHostPermissions =
    deriveReservationHostPermissions(workspace.capabilities);
  if (!canAccessReservationHost(permissions))
    return readFailure(
      "Reservation access is not assigned for this location and service date.",
    );

  const observedAt = options.observedAt ?? new Date().toISOString();
  const observedAtMs = new Date(observedAt).valueOf();
  const supabase = await createClient();
  const { organization, activeLocation } = workspace;
  const hasCompleteObservationContext =
    Boolean(options.observationBusinessDate) &&
    options.observationServicePeriodId !== undefined;
  const observationBusinessDatePromise = hasCompleteObservationContext
    ? Promise.resolve({
        data: {
          businessDate: options.observationBusinessDate!,
          servicePeriodId: options.observationServicePeriodId ?? null,
        },
        error: null,
      })
    : supabase
        .rpc("service_day_business_date", {
          p_organization_id: organization.id,
          p_location_id: activeLocation.id,
          p_observed_at: observedAt,
        })
        .single();
  const [
    locationResult,
    organizationResult,
    periodResult,
    observationBusinessDateResult,
  ] = await Promise.all([
    supabase
      .from("locations")
      .select("timezone")
      .eq("organization_id", organization.id)
      .eq("id", activeLocation.id)
      .single(),
    supabase
      .from("organizations")
      .select("currency_code")
      .eq("id", organization.id)
      .single(),
    supabase
      .from("reservation_service_periods")
      .select("*")
      .eq("organization_id", organization.id)
      .eq("location_id", activeLocation.id)
      .eq("is_active", true)
      .lte("effective_from", businessDate)
      .or(`effective_to.is.null,effective_to.gte.${businessDate}`)
      .order("starts_local"),
    observationBusinessDatePromise,
  ]);
  if (
    locationResult.error ||
    organizationResult.error ||
    periodResult.error ||
    observationBusinessDateResult.error ||
    !observationBusinessDateResult.data?.businessDate
  )
    return readFailure("The location service clock could not be loaded.");
  const timeZone = locationResult.data.timezone;
  const calendarStartsAt = zonedLocalToIso(businessDate, "00:00", timeZone);
  const calendarEndsAt = zonedLocalToIso(
    addIsoDays(businessDate, 1),
    "00:00",
    timeZone,
  );
  if (!calendarStartsAt || !calendarEndsAt)
    return readFailure("That service date could not be resolved.");
  const serviceWindows = buildReservationServiceWindows({
    businessDate,
    timeZone,
    periods: (periodResult.data ?? []).map((period) => ({
      id: period.id,
      name: period.name,
      daysOfWeek: period.days_of_week,
      startsLocal: period.starts_local,
      endsLocal: period.ends_local,
      pacingIntervalMinutes: period.pacing_interval_minutes,
      pacingCoverLimit: period.pacing_cover_limit,
    })),
  });
  const selectedService =
    (observationBusinessDateResult.data.businessDate === businessDate &&
    observationBusinessDateResult.data.servicePeriodId
      ? serviceWindows.find(
          (window) =>
            window.id ===
            observationBusinessDateResult.data.servicePeriodId,
        )
      : null) ?? serviceWindows[0] ?? null;
  const reservationWindowStartsAt =
    serviceWindows[0]?.startsAt ?? calendarStartsAt;
  const reservationWindowEndsAt = serviceWindows.length
    ? new Date(
        Math.max(
          ...serviceWindows.map((window) => new Date(window.endsAt).valueOf()),
        ),
      ).toISOString()
    : calendarEndsAt;
  if (
    new Date(reservationWindowEndsAt).valueOf() -
      new Date(reservationWindowStartsAt).valueOf() >
    30 * 60 * 60_000
  ) {
    return readFailure("The configured service window exceeds the safe preview.");
  }
  const capacityWindowStartsAt = serviceWindows.length
    ? new Date(
        Math.min(
          ...serviceWindows.map(
            (window) =>
              new Date(window.startsAt).valueOf() -
              window.pacingIntervalMinutes * 60_000,
          ),
        ),
      ).toISOString()
    : reservationWindowStartsAt;
  const capacityWindowEndsAt = serviceWindows.length
    ? new Date(
        Math.max(
          ...serviceWindows.map(
            (window) =>
              new Date(window.endsAt).valueOf() +
              window.pacingIntervalMinutes * 60_000,
          ),
        ),
      ).toISOString()
    : reservationWindowEndsAt;
  if (
    new Date(capacityWindowEndsAt).valueOf() -
      new Date(capacityWindowStartsAt).valueOf() >
    30 * 60 * 60_000
  ) {
    return readFailure("The configured pacing window exceeds the safe preview.");
  }
  const reservationRpc = supabase.rpc.bind(
    supabase,
  ) as unknown as ReservationRpc;

  const [
    settingsResult,
    areaResult,
    tableResult,
    reservationResult,
    allocationResult,
    floorAllocationResult,
    waitlistResult,
    waitlistDeliveryResult,
    combinationResult,
    memberResult,
    capacityResult,
  ] = await Promise.all([
    supabase
      .from("reservation_settings")
      .select("*")
      .eq("organization_id", organization.id)
      .eq("location_id", activeLocation.id)
      .maybeSingle(),
    supabase
      .from("dining_areas")
      .select("id,name")
      .eq("organization_id", organization.id)
      .eq("location_id", activeLocation.id)
      .eq("is_active", true)
      .order("sort_order"),
    supabase
      .from("reservation_tables")
      .select(
        `*,table_status_events!table_status_events_organization_id_table_id_fkey(id,table_id,reservation_id,status,occurred_at)`,
      )
      .eq("organization_id", organization.id)
      .eq("location_id", activeLocation.id)
      .eq("is_active", true)
      .in("table_status_events.status", [...physicalTableStates])
      .lte("table_status_events.occurred_at", observedAt)
      .order("occurred_at", {
        referencedTable: "table_status_events",
        ascending: false,
      })
      .order("id", {
        referencedTable: "table_status_events",
        ascending: false,
      })
      .limit(1, { referencedTable: "table_status_events" })
      .order("label"),
    reservationRpc("service_reservation_host_snapshot", {
      p_organization_id: organization.id,
      p_location_id: activeLocation.id,
      p_from: reservationWindowStartsAt,
      p_to: reservationWindowEndsAt,
    }),
    supabase
      .from("reservation_table_allocations")
      .select("*")
      .eq("organization_id", organization.id)
      .eq("location_id", activeLocation.id)
      .eq("is_active", true)
      .lt("starts_at", reservationWindowEndsAt)
      .gt("ends_at", reservationWindowStartsAt),
    supabase
      .from("reservation_table_allocations")
      .select("*")
      .eq("organization_id", organization.id)
      .eq("location_id", activeLocation.id)
      .eq("is_active", true)
      .lte("starts_at", observedAt)
      .gt("ends_at", observedAt),
    supabase
      .from("waitlist_entries")
      .select("*")
      .eq("organization_id", organization.id)
      .eq("location_id", activeLocation.id)
      .in("status", ["waiting", "notified", "accepted"])
      .order("created_at"),
    supabase
      .from("reservation_message_outbox")
      .select("waitlist_entry_id,status,created_at")
      .eq("organization_id", organization.id)
      .eq("location_id", activeLocation.id)
      .eq("template_key", "waitlist_table_ready")
      .not("waitlist_entry_id", "is", null)
      .order("created_at", { ascending: false }),
    supabase
      .from("reservation_table_combinations")
      .select("*")
      .eq("organization_id", organization.id)
      .eq("location_id", activeLocation.id)
      .eq("is_active", true),
    supabase
      .from("reservation_table_combination_members")
      .select("combination_id,table_id,sort_order")
      .eq("organization_id", organization.id),
    reservationRpc("reservation_capacity_snapshot", {
      p_organization_id: organization.id,
      p_location_id: activeLocation.id,
      p_from: capacityWindowStartsAt,
      p_to: capacityWindowEndsAt,
    }),
  ]);
  const reservationReadResults = [
    ["settings", settingsResult],
    ["areas", areaResult],
    ["tables", tableResult],
    ["reservations", reservationResult],
    ["allocations", allocationResult],
    ["floor_allocations", floorAllocationResult],
    ["waitlist", waitlistResult],
    ["waitlist_delivery", waitlistDeliveryResult],
    ["combinations", combinationResult],
    ["combination_members", memberResult],
    ["capacity", capacityResult],
  ] as const;
  const failedReservationReads = reservationReadResults
    .filter(([, result]) => result.error)
    .map(([source, result]) => ({
      source,
      message: result.error?.message ?? "unknown_error",
    }));
  if (failedReservationReads.length) {
    console.error("reservation_book_read_failed", {
      organizationId: organization.id,
      locationId: activeLocation.id,
      businessDate,
      failures: failedReservationReads,
    });
    return readFailure(
      "The reservation book could not be loaded from the live workspace.",
    );
  }

  const reservationRows = (reservationResult.data ?? []).filter(
    (reservation) =>
      !serviceWindows.length ||
      reservationInstantFallsInServiceWindows(
        reservation.reserved_at,
        serviceWindows,
      ),
  );
  const guestIds = [
    ...new Set(
      reservationRows
        .map((reservation) => reservation.guest_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const summaryResults = guestIds.length
    ? await Promise.all(
        chunks(guestIds, 100).map((guestIdChunk) =>
          reservationRpc("service_reservation_guest_summaries", {
            p_organization_id: organization.id,
            p_location_id: activeLocation.id,
            p_guest_ids: guestIdChunk,
          }),
        ),
      )
    : [];
  if (summaryResults.some((result) => result.error))
    return readFailure("Guest context could not be loaded for this service.");

  const canReadGuestContact = workspace.capabilities.includes("guest.manage");
  const canReadSensitiveGuestContext = workspace.capabilities.includes(
    "guest.sensitive_notes.view",
  );
  const [contactResult, sensitiveResult] = await Promise.all([
    guestIds.length && canReadGuestContact
      ? supabase.rpc("service_guest_profiles", {
          p_organization_id: organization.id,
          p_location_id: activeLocation.id,
          p_query: null,
          p_limit: Math.min(guestIds.length, 1_000),
          p_guest_ids: guestIds,
        })
      : Promise.resolve({ data: [], error: null }),
    guestIds.length && canReadSensitiveGuestContext
      ? supabase.rpc("service_guest_sensitive_profiles", {
          p_organization_id: organization.id,
          p_location_id: activeLocation.id,
          p_guest_ids: guestIds,
        })
      : Promise.resolve({ data: [], error: null }),
  ]);
  if (contactResult.error || sensitiveResult.error)
    return readFailure(
      "Authorized guest details could not be loaded for this service.",
    );
  const detailById = new Map<string, AuthorizedGuestDetails>();
  for (const guest of contactResult.data ?? []) {
    if (!guest.id) continue;
    detailById.set(guest.id, {
      ...detailById.get(guest.id),
      id: guest.id,
      email: guest.email,
      phone: guest.phone,
    });
  }
  for (const guest of sensitiveResult.data ?? []) {
    if (!guest.id) continue;
    detailById.set(guest.id, {
      ...detailById.get(guest.id),
      id: guest.id,
      allergies: guest.allergies,
      preferences: guest.preferences,
      lifetime_spend_cents: guest.lifetime_spend_cents,
    });
  }
  const guestById = new Map(
    summaryResults
      .flatMap((result) => result.data ?? [])
      .map((guest) => [guest.id, guest]),
  );
  const intervalAllocationRows = (allocationResult.data ?? []).filter(
    (allocation) =>
      !allocation.expires_at ||
      new Date(allocation.expires_at).valueOf() > observedAtMs,
  );
  const floorAllocationRows = (floorAllocationResult.data ?? []).filter(
    (allocation) =>
      isReservationAllocationActiveAt(
        projectInventoryAllocation(allocation),
        observedAt,
      ),
  );
  const intervalAllocations = intervalAllocationRows.map(
    projectInventoryAllocation,
  );
  const floorActiveAllocations = floorAllocationRows.map(
    projectInventoryAllocation,
  );
  const tableRows = (tableResult.data ?? []) as unknown as
    ReservationTableWithLatestStatus[];
  const tableById = new Map(tableRows.map((table) => [table.id, table]));
  const reservations = reservationRows.map((reservation) => {
    const guest = reservation.guest_id
      ? guestById.get(reservation.guest_id)
      : null;
    const details = reservation.guest_id
      ? detailById.get(reservation.guest_id)
      : null;
    const assigned = intervalAllocationRows.filter(
      (allocation) =>
        allocation.reservation_id === reservation.id &&
        allocation.allocation_kind === "assignment",
    );
    const lastRevision = projectLastRevision(reservation.last_revision);
    return {
      id: reservation.id,
      version: reservation.version,
      startsAt: reservation.reserved_at,
      durationMinutes: reservation.duration_minutes ?? 90,
      partySize: reservation.party_size,
      status: reservation.status as ReservationStatus,
      source: reservation.source,
      bookingChannel: reservation.booking_channel,
      tableLabel:
        reservation.table_label ??
        (assigned
          .map((allocation) => tableById.get(allocation.table_id)?.label)
          .filter(Boolean)
          .join(" + ") ||
          null),
      tableIds: assigned.map((allocation) => allocation.table_id),
      specialRequests: reservation.special_requests,
      policyEvidenceCaptured: reservation.policy_evidence_captured,
      lastRevision,
      guest: {
        id: guest?.id ?? null,
        displayName:
          guest?.display_name ??
          (reservation.booking_channel === "walk_in"
            ? "Walk-in guest"
            : "Guest"),
        email: canReadGuestContact ? (details?.email ?? null) : null,
        phone: canReadGuestContact ? (details?.phone ?? null) : null,
        vip: guest?.vip ?? false,
        allergies: canReadSensitiveGuestContext
          ? (details?.allergies ?? null)
          : null,
        preferences: canReadSensitiveGuestContext
          ? (details?.preferences ?? null)
          : null,
        visitCount: guest?.visit_count ?? 0,
        lifetimeSpendCents: canReadSensitiveGuestContext
          ? Number(details?.lifetime_spend_cents ?? 0)
          : 0,
      },
    };
  });
  const latestPhysicalStatus = new Map<string, ReservationStatusEventRow>();
  for (const table of tableRows) {
    const event = (table.table_status_events ?? []).find((candidate) =>
      isReservationPhysicalStatusEvent(
        candidate.status as ReservationTableStatusEventState,
      ),
    );
    if (event) latestPhysicalStatus.set(table.id, event);
  }
  const currentAllocationByTable = new Map(
    floorActiveAllocations.map((allocation) => [
      allocation.tableId,
      allocation,
    ]),
  );
  const floorTables = tableRows.map((table) => {
    const statusEvent = latestPhysicalStatus.get(table.id) ?? null;
    const currentAllocation = currentAllocationByTable.get(table.id) ?? null;
    const state = resolveReservationPhysicalTableState({
      latestStatus:
        (statusEvent?.status as ReservationTableStatusEventState | undefined) ??
        null,
      currentAllocationState: currentAllocation?.state ?? null,
    });
    return {
      id: table.id,
      areaId: table.dining_area_id,
      label: table.label,
      minCapacity: table.min_capacity,
      maxCapacity: table.max_capacity,
      isBookable: reservationTableAcceptsIntervalBookings(
        table.is_bookable,
        (statusEvent?.status as ReservationPhysicalTableState | undefined) ??
          null,
      ),
      x: Number(table.position_x),
      y: Number(table.position_y),
      width: Number(table.width),
      height: Number(table.height),
      rotation: Number(table.rotation_degrees),
      shape: table.shape,
      state,
      occupyingReservationId:
        state === "occupied"
          ? (statusEvent?.reservation_id ??
            (currentAllocation?.state === "committed"
              ? currentAllocation.reservationId
              : null))
          : null,
      lastChangedAt: statusEvent?.occurred_at ?? null,
    };
  });
  const active = reservations.filter(
    (reservation) =>
      !["cancelled", "expired", "no_show", "pending_verification"].includes(
        reservation.status,
      ),
  );
  const covers = active.reduce(
    (sum, reservation) => sum + reservation.partySize,
    0,
  );
  const seated = active
    .filter((reservation) =>
      ["seated", "completed"].includes(reservation.status),
    )
    .reduce((sum, reservation) => sum + reservation.partySize, 0);
  // Keep the complete extended capacity snapshot. The database pacing
  // invariant uses a rolling [slot - interval, slot + interval) window, so a
  // commitment just before service can still consume the first service slot.
  const capacityRows = capacityResult.data ?? [];
  const pacing = serviceWindows.flatMap((window) =>
    deriveReservationPacingBuckets({
      serviceStartsAt: window.startsAt,
      serviceEndsAt: window.endsAt,
      intervalMinutes: window.pacingIntervalMinutes,
      coverLimit: window.pacingCoverLimit,
      capacity: capacityRows,
      timeZone,
    }),
  );
  const settings = settingsResult.data;
  return readSuccess({
    permissions,
    businessDate,
    timeZone,
    currencyCode: organizationResult.data.currency_code,
    serviceName: selectedService?.name ?? "Dinner",
    serviceWindow: selectedService
      ? `${selectedService.startsLocal.slice(0, 5)}–${selectedService.endsLocal.slice(0, 5)}`
      : "Not configured",
    reservations,
    floorNow: {
      observedAt,
      businessDateAtObservation:
        observationBusinessDateResult.data.businessDate,
      tables: floorTables,
      activeAllocations: floorActiveAllocations,
    },
    intervalInventory: {
      windowStartsAt: reservationWindowStartsAt,
      windowEndsAt: reservationWindowEndsAt,
      allocations: intervalAllocations,
    },
    combinations: (combinationResult.data ?? []).map((combination) => ({
      id: combination.id,
      label: combination.label,
      minCapacity: combination.min_capacity,
      maxCapacity: combination.max_capacity,
      tableIds: (memberResult.data ?? [])
        .filter((member) => member.combination_id === combination.id)
        .sort((left, right) => left.sort_order - right.sort_order)
        .map((member) => member.table_id),
      isActive: combination.is_active,
    })),
    waitlist: (waitlistResult.data ?? []).map((entry) => ({
      id: entry.id,
      displayName: entry.display_name,
      partySize: entry.party_size,
      quotedWaitMinutes: entry.quoted_wait_minutes,
      status: entry.status,
      deliveryStatus: (() => {
        const statuses = (waitlistDeliveryResult.data ?? [])
          .filter((message) => message.waitlist_entry_id === entry.id)
          .map((message) => message.status);
        if (statuses.some((status) => status === "sent" || status === "delivered")) return "sent" as const;
        if (statuses.includes("sending")) return "sending" as const;
        if (statuses.includes("queued")) return "queued" as const;
        if (statuses.includes("failed")) return "failed" as const;
        return null;
      })(),
      notes: entry.notes,
      createdAt: entry.created_at,
    })),
    metrics: {
      covers,
      seated,
      remaining: covers - seated,
      waitlist: (waitlistResult.data ?? []).length,
      pendingHoldCount: capacityRows.filter((entry) => entry.kind === "hold")
        .length,
    },
    pacing,
    configuration: {
      ready: Boolean(
        settings?.approved_at && floorTables.length && serviceWindows.length,
      ),
      onlineBookingEnabled: settings?.online_booking_enabled ?? false,
      messagingEnabled: settings?.guest_messaging_enabled ?? false,
      staffPushEnabled: settings?.staff_push_enabled ?? false,
      tableCount: floorTables.length,
      seatCount: floorTables.reduce(
        (sum, table) => sum + table.maxCapacity,
        0,
      ),
    },
  });
}
