import "server-only";

import type { AppRole } from "@/types";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/server";
import {
  getActionDefinition,
  getAvailableActionsForSurface,
  isActionAuthorized,
  resolveWorkMode,
  type ActiveJobAssignmentDescriptor,
  type ActionOfflinePolicy,
  type ActionPrerequisite,
  type ActionUrgency,
  type WorkMode,
  type WorkspaceDestination,
} from "@/lib/actions/action-registry";
import { deriveTodayReservationSlice, type TodayReservationSlice } from "@/lib/actions/today-reservation-slice";
import { loadLiveReservations } from "./reservations";
import { loadLiveServiceControl, type LiveServiceControlModel } from "./service-control";
import { readFailure, readSuccess, type LiveReadResult } from "./shared";
import { loadLiveToday, type LiveTodayModel } from "./today";

export type ServiceDaySource =
  | "today"
  | "service_control"
  | "reservations"
  | "providers";

export type ServiceDaySourceState =
  | "fresh"
  | "unavailable"
  | "restricted";

export interface ServiceDaySourceFreshness {
  source: ServiceDaySource;
  state: ServiceDaySourceState;
  observedAt: string | null;
  staleAt: string | null;
  maxAgeSeconds: number | null;
}

export type ServiceDayProviderState =
  | "healthy"
  | "degraded"
  | "down"
  | "not_configured"
  | "restricted"
  | "unavailable";

export interface ServiceDayProvider {
  provider: string;
  displayName: string;
  state: "connected" | "degraded" | "disconnected" | "pending" | "disabled";
  syncFreshness: "current" | "stale" | "unknown" | "not_applicable";
  syncMaxAgeSeconds: number | null;
  lastSyncedAt: string | null;
  updatedAt: string;
}

export interface ServiceDayProviderHealth {
  state: ServiceDayProviderState;
  providers: ServiceDayProvider[];
}

export interface ServiceDayNowAction {
  id: string;
  label: string;
  description: string;
  destination: WorkspaceDestination;
  urgency: ActionUrgency;
  analyticsName: string;
  offlinePolicy: ActionOfflinePolicy;
}

export interface ServiceDayException {
  id: string;
  order: number;
  source: ServiceDaySource;
  label: string;
  detail: string;
  count: number;
  urgency: ActionUrgency;
  destination: WorkspaceDestination;
}

export interface ServiceDaySnapshot {
  scope: {
    organizationId: string;
    locationId: string;
    membershipId: string;
    role: AppRole;
    workMode: WorkMode;
    businessDate: string;
  };
  observedAt: string;
  activeJob: ActiveJobAssignmentDescriptor | null;
  today: LiveTodayModel;
  serviceControl: LiveReadResult<LiveServiceControlModel>;
  reservationSlice?: LiveReadResult<TodayReservationSlice>;
  nowAction: ServiceDayNowAction | null;
  orderedExceptions: ServiceDayException[];
  sourceFreshness: ServiceDaySourceFreshness[];
  realtime: {
    state: "snapshot_only";
    transport: "server_request";
    lastEventAt: null;
    detail: string;
  };
  providerHealth: ServiceDayProviderHealth;
}

type ProviderRow = {
  provider: string;
  display_name: string;
  status: string;
  last_synced_at: string | null;
  updated_at: string;
};

export interface ServiceDaySnapshotLoaders {
  loadToday(
    workspace: WorkspaceContextValue,
    observedAt?: string,
  ): Promise<LiveReadResult<LiveTodayModel>>;
  loadServiceControl(
    workspace: WorkspaceContextValue,
    businessDate?: string,
    observedAt?: string,
  ): Promise<LiveReadResult<LiveServiceControlModel>>;
  loadReservations: typeof loadLiveReservations;
  loadProviderHealth(
    workspace: WorkspaceContextValue,
  ): Promise<LiveReadResult<ServiceDayProviderHealth>>;
  now(): Date;
}

const sourceMaxAgeSeconds: Record<ServiceDaySource, number> = {
  today: 60,
  service_control: 60,
  reservations: 60,
  providers: 300,
};

const providerSyncMaxAgeSeconds: Readonly<Record<string, number>> = {
  toast: 15 * 60,
  resy: 15 * 60,
  payroll: 24 * 60 * 60,
  accounting: 24 * 60 * 60,
  csv: 24 * 60 * 60,
  manual: 24 * 60 * 60,
  other: 60 * 60,
};

const urgencyOrder: Record<ActionUrgency, number> = {
  critical: 0,
  urgent: 1,
  attention: 2,
  routine: 3,
};

const sourceOrder: Record<ServiceDaySource, number> = {
  reservations: 0,
  service_control: 1,
  today: 2,
  providers: 3,
};

function providerState(value: string): ServiceDayProvider["state"] {
  if (
    value === "connected" ||
    value === "degraded" ||
    value === "disconnected" ||
    value === "pending" ||
    value === "disabled"
  ) {
    return value;
  }
  return "degraded";
}

export function deriveProviderHealth(
  rows: readonly ProviderRow[],
  observedAt = new Date(),
): ServiceDayProviderHealth {
  const observedAtMs = observedAt.valueOf();
  const providers = rows.map((row) => {
    const state = providerState(row.status);
    const syncThresholdSeconds =
      providerSyncMaxAgeSeconds[row.provider] ?? providerSyncMaxAgeSeconds.other;
    const syncMaxAgeSeconds = state === "disabled"
      ? null
      : syncThresholdSeconds;
    const lastSyncedAtMs = row.last_synced_at
      ? new Date(row.last_synced_at).valueOf()
      : Number.NaN;
    const syncFreshness = state === "disabled"
      ? "not_applicable" as const
      : !Number.isFinite(lastSyncedAtMs) || !Number.isFinite(observedAtMs)
        ? "unknown" as const
        : observedAtMs - lastSyncedAtMs <= syncThresholdSeconds * 1_000
          ? "current" as const
          : "stale" as const;
    return {
      provider: row.provider,
      displayName: row.display_name,
      state,
      syncFreshness,
      syncMaxAgeSeconds,
      lastSyncedAt: row.last_synced_at,
      updatedAt: row.updated_at,
    };
  });
  const active = providers.filter((provider) => provider.state !== "disabled");
  if (!active.length) return { state: "not_configured", providers };
  const connected = active.filter((provider) => provider.state === "connected").length;
  const impaired = active.filter((provider) =>
    provider.state === "degraded" || provider.state === "disconnected",
  ).length;
  if (
    connected === active.length
    && active.every((provider) => provider.syncFreshness === "current")
  ) return { state: "healthy", providers };
  if (!connected && impaired) return { state: "down", providers };
  return { state: "degraded", providers };
}

async function loadLiveProviderHealth(
  workspace: WorkspaceContextValue,
): Promise<LiveReadResult<ServiceDayProviderHealth>> {
  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const locationId = workspace.activeLocation.id;
    const { data, error } = await supabase.rpc("service_day_provider_health", {
      p_organization_id: organizationId,
      p_location_id: locationId,
    });
    if (error?.code === "42501") {
      return readSuccess({ state: "restricted", providers: [] });
    }
    if (error) return readFailure("Provider health could not be loaded.");
    return readSuccess(deriveProviderHealth((data ?? []) as ProviderRow[], new Date()));
  } catch {
    return readFailure("Provider health could not be loaded.");
  }
}

const defaultLoaders: ServiceDaySnapshotLoaders = {
  loadToday: loadLiveToday,
  loadServiceControl: loadLiveServiceControl,
  loadReservations: loadLiveReservations,
  loadProviderHealth: loadLiveProviderHealth,
  now: () => new Date(),
};

async function safeRead<T>(read: () => Promise<LiveReadResult<T>>): Promise<LiveReadResult<T>> {
  try {
    return await read();
  } catch {
    return readFailure();
  }
}

function currentJob(
  workspace: WorkspaceContextValue,
  today: LiveTodayModel,
  observedAt: string,
): ActiveJobAssignmentDescriptor | null {
  const observedAtMs = new Date(observedAt).valueOf();
  const employeeShifts = today.currentEmployeeId
    ? today.shifts.filter(
        (candidate) =>
          candidate.employeeId === today.currentEmployeeId && !candidate.isOpen,
      )
    : [];
  const shift =
    employeeShifts.find((candidate) => candidate.clockedIn) ??
    employeeShifts.find(
      (candidate) =>
        new Date(candidate.startsAt).valueOf() <= observedAtMs &&
        new Date(candidate.endsAt).valueOf() > observedAtMs,
    );
  return shift
    ? { name: shift.jobName, department: shift.department }
    : workspace.activeJob ?? null;
}

function canReadReservations(
  workspace: WorkspaceContextValue,
  activeJob: ActiveJobAssignmentDescriptor | null,
): boolean {
  return isActionAuthorized(getActionDefinition("navigate.reservations"), {
    role: workspace.role,
    persona: workspace.persona,
    workMode: resolveWorkMode(workspace, activeJob),
    capabilities: workspace.capabilities,
  });
}

function freshness(
  source: ServiceDaySource,
  state: ServiceDaySourceState,
  observedAt: string,
): ServiceDaySourceFreshness {
  if (state !== "fresh") {
    return {
      source,
      state,
      observedAt: null,
      staleAt: null,
      maxAgeSeconds: null,
    };
  }
  const maxAgeSeconds = sourceMaxAgeSeconds[source];
  return {
    source,
    state,
    observedAt,
    staleAt: new Date(new Date(observedAt).getTime() + maxAgeSeconds * 1_000).toISOString(),
    maxAgeSeconds,
  };
}

type PendingException = Omit<ServiceDayException, "order">;

function orderedExceptions({
  today,
  serviceControl,
  reservationSlice,
  providerHealth,
}: {
  today: LiveTodayModel;
  serviceControl: LiveReadResult<LiveServiceControlModel>;
  reservationSlice?: LiveReadResult<TodayReservationSlice>;
  providerHealth: ServiceDayProviderHealth;
}): ServiceDayException[] {
  const pending: PendingException[] = [];
  if (today.operatingService?.state === "closed") {
    pending.push({
      id: "today:service_closed",
      source: "today",
      label: `${today.operatingService.name ?? "Service"} is closed`,
      detail: "A dated closure applies to the current service. Review the reservation book before seating or accepting inventory.",
      count: 1,
      urgency: "critical",
      destination: `/reservations?date=${today.date}`,
    });
  }
  if (reservationSlice?.ok) {
    pending.push(
      ...reservationSlice.data.exceptions.map((exception) => ({
        ...exception,
        id: `reservations:${exception.id}`,
        source: "reservations" as const,
      })),
    );
  } else if (reservationSlice) {
    pending.push({
      id: "reservations:unavailable",
      source: "reservations",
      label: "Reservation snapshot unavailable",
      detail: "Open the service book and refresh before making a seating decision.",
      count: 1,
      urgency: "urgent",
      destination: `/reservations?date=${today.date}`,
    });
  }

  if (serviceControl.ok) {
    const availability = serviceControl.data.availability.filter(
      (item) => item.status === "eighty_sixed" || item.status === "running_low",
    );
    if (availability.length) {
      pending.push({
        id: "service_control:availability",
        source: "service_control",
        label: "Service availability needs attention",
        detail: `${availability.length} item${availability.length === 1 ? " is" : "s are"} running low or unavailable.`,
        count: availability.length,
        urgency: availability.some((item) => item.status === "eighty_sixed")
          ? "urgent"
          : "attention",
        destination: "/service",
      });
    }
  } else {
    pending.push({
      id: "service_control:unavailable",
      source: "service_control",
      label: "Service control unavailable",
      detail: "Availability and pre-shift state could not be refreshed.",
      count: 1,
      urgency: "attention",
      destination: "/service",
    });
  }

  if (today.openShiftCount) {
    pending.push({
      id: "today:open_shifts",
      source: "today",
      label: "Open shifts need coverage",
      detail: `${today.openShiftCount} published shift${today.openShiftCount === 1 ? " is" : "s are"} still open.`,
      count: today.openShiftCount,
      urgency: "attention",
      destination: "/schedule",
    });
  }
  const blockedTasks = today.tasks.filter(
    (task) => task.status === "blocked" || task.priority === "urgent",
  );
  if (blockedTasks.length) {
    pending.push({
      id: "today:blocked_tasks",
      source: "today",
      label: "Blocked or urgent work",
      detail: `${blockedTasks.length} visible task${blockedTasks.length === 1 ? " needs" : "s need"} attention.`,
      count: blockedTasks.length,
      urgency: "urgent",
      destination: "/tasks",
    });
  }

  if (providerHealth.state === "down" || providerHealth.state === "degraded") {
    pending.push({
      id: `providers:${providerHealth.state}`,
      source: "providers",
      label: providerHealth.state === "down" ? "Provider connections are down" : "Provider sync evidence is degraded",
      detail: "Connection state or upstream data age is not current enough to trust synchronized records.",
      count: Math.max(1, providerHealth.providers.filter((provider) =>
        provider.state !== "connected" && provider.state !== "disabled",
      ).length),
      urgency: providerHealth.state === "down" ? "urgent" : "attention",
      destination: "/integrations",
    });
  } else if (providerHealth.state === "unavailable") {
    pending.push({
      id: "providers:unavailable",
      source: "providers",
      label: "Provider health unavailable",
      detail: "Synchronized source health could not be verified for this snapshot.",
      count: 1,
      urgency: "attention",
      destination: "/integrations",
    });
  }

  return pending
    .sort(
      (left, right) =>
        urgencyOrder[left.urgency] - urgencyOrder[right.urgency] ||
        sourceOrder[left.source] - sourceOrder[right.source] ||
        left.id.localeCompare(right.id),
    )
    .slice(0, 8)
    .map((exception, index) => ({ ...exception, order: index + 1 }));
}

export function composeServiceDaySnapshot({
  workspace,
  observedAt,
  today,
  serviceControl,
  reservationSlice,
  providerHealth,
}: {
  workspace: WorkspaceContextValue;
  observedAt: string;
  today: LiveTodayModel;
  serviceControl: LiveReadResult<LiveServiceControlModel>;
  reservationSlice?: LiveReadResult<TodayReservationSlice>;
  providerHealth: ServiceDayProviderHealth;
}): ServiceDaySnapshot {
  const activeJob = currentJob(workspace, today, observedAt);
  const workMode = resolveWorkMode(workspace, activeJob);
  const scopedProviderHealth: ServiceDayProviderHealth = providerHealth.state === "restricted"
    ? { state: "restricted", providers: [] }
    : providerHealth;
  const reservationReady = reservationSlice?.ok === true;
  const satisfiedPrerequisites: ActionPrerequisite[] = ["active_workspace"];
  if (reservationReady) {
    satisfiedPrerequisites.push(
      "reservation_snapshot",
      reservationSlice.data.configurationReady
        ? "reservation_setup_ready"
        : "reservation_setup_needed",
    );
  }
  const reservationPhase = reservationSlice?.ok
    ? reservationSlice.data.servicePhase
    : "off_hours";
  const action = getAvailableActionsForSurface("today_now", {
    role: workspace.role,
    persona: workspace.persona,
    workMode,
    capabilities: workspace.capabilities,
    servicePhase: reservationPhase,
    satisfiedPrerequisites,
  })[0];
  const nowAction = action && reservationSlice?.ok
    && today.operatingService?.state !== "closed"
    ? {
        id: action.id,
        label: action.label,
        description: action.description,
        destination: `${action.destination}?date=${reservationSlice.data.freshness.businessDate}` as WorkspaceDestination,
        urgency: action.urgency,
        analyticsName: action.analyticsName,
        offlinePolicy: action.offlinePolicy,
      }
    : null;
  const reservationState: ServiceDaySourceState = reservationSlice
    ? reservationSlice.ok
      ? "fresh"
      : "unavailable"
    : "restricted";
  const providerState: ServiceDaySourceState = scopedProviderHealth.state === "restricted"
    ? "restricted"
    : scopedProviderHealth.state === "unavailable"
      ? "unavailable"
      : "fresh";

  return {
    scope: {
      organizationId: workspace.organization.id,
      locationId: workspace.activeLocation.id,
      membershipId: workspace.membershipId,
      role: workspace.role,
      workMode,
      businessDate: today.date,
    },
    observedAt,
    activeJob,
    today,
    serviceControl,
    reservationSlice,
    nowAction,
    orderedExceptions: orderedExceptions({
      today,
      serviceControl,
      reservationSlice,
      providerHealth: scopedProviderHealth,
    }),
    sourceFreshness: [
      freshness("today", "fresh", observedAt),
      freshness(
        "service_control",
        serviceControl.ok ? "fresh" : "unavailable",
        observedAt,
      ),
      freshness("reservations", reservationState, observedAt),
      freshness("providers", providerState, observedAt),
    ],
    realtime: {
      state: "snapshot_only",
      transport: "server_request",
      lastEventAt: null,
      detail:
        "The server snapshot remains authoritative; connected clients may attach scoped invalidation and refresh this route.",
    },
    providerHealth: scopedProviderHealth,
  };
}

export async function loadLiveServiceDaySnapshot(
  workspace: WorkspaceContextValue,
  loaders: ServiceDaySnapshotLoaders = defaultLoaders,
): Promise<LiveReadResult<ServiceDaySnapshot>> {
  const observedAt = loaders.now().toISOString();
  const todayPromise = safeRead(() => loaders.loadToday(workspace, observedAt));
  const serviceControlPromise = safeRead(() =>
    loaders.loadServiceControl(workspace, undefined, observedAt),
  );
  const providerHealthPromise = safeRead(() => loaders.loadProviderHealth(workspace));

  const todayResult = await todayPromise;
  if (!todayResult.ok) {
    await Promise.all([serviceControlPromise, providerHealthPromise]);
    return readFailure(todayResult.message);
  }

  const activeJob = currentJob(workspace, todayResult.data, observedAt);
  const reservationAuthorized = canReadReservations(workspace, activeJob);
  const reservationPromise = reservationAuthorized
    ? safeRead(() =>
        loaders.loadReservations(workspace, todayResult.data.date, {
          observedAt,
        }),
      )
    : Promise.resolve(null);
  const [loadedServiceControl, providerHealthResult, reservationResult] = await Promise.all([
    serviceControlPromise,
    providerHealthPromise,
    reservationPromise,
  ]);
  const serviceControl = loadedServiceControl.ok
    && loadedServiceControl.data.date !== todayResult.data.date
    ? readFailure<LiveServiceControlModel>("Service control returned a different business date.")
    : loadedServiceControl;
  const reservationSlice = reservationResult
    ? reservationResult.ok
      ? readSuccess(deriveTodayReservationSlice(reservationResult.data, observedAt))
      : readFailure<TodayReservationSlice>(reservationResult.message)
    : undefined;
  const providerHealth = providerHealthResult.ok
    ? providerHealthResult.data
    : { state: "unavailable" as const, providers: [] };

  return readSuccess(
    composeServiceDaySnapshot({
      workspace,
      observedAt,
      today: todayResult.data,
      serviceControl,
      reservationSlice,
      providerHealth,
    }),
  );
}
