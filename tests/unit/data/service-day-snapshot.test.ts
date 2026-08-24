import { describe, expect, it } from "vitest";
import {
  composeServiceDaySnapshot,
  deriveProviderHealth,
  loadLiveServiceDaySnapshot,
  type ServiceDaySnapshotLoaders,
} from "@/data/read-models/service-day-snapshot";
import type { LiveServiceControlModel } from "@/data/read-models/service-control";
import type { LiveReadResult } from "@/data/read-models/shared";
import type { LiveTodayModel } from "@/data/read-models/today";
import type { TodayReservationSlice } from "@/lib/actions/today-reservation-slice";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";

const workspace: WorkspaceContextValue = {
  mode: "live",
  identity: {
    userId: "10000000-0000-4000-8000-000000000004",
    displayName: "Morgan Manager",
    email: "morgan@example.invalid",
    aal: "aal1",
  },
  organization: {
    id: "20000000-0000-4000-8000-000000000001",
    name: "Le Yard",
  },
  activeLocation: {
    id: "30000000-0000-4000-8000-000000000001",
    organizationId: "20000000-0000-4000-8000-000000000001",
    name: "Downtown",
    isPrimary: true,
    timeZone: "America/New_York",
  },
  locations: [],
  availableWorkspaces: [],
  membershipId: "21000000-0000-4000-8000-000000000004",
  role: "manager",
  organizationWide: false,
  capabilities: ["reservations.view", "integrations.manage"],
  activeJob: {
    name: "Host",
    code: "HOST",
    department: "Front of house",
  },
};

const today: LiveTodayModel = {
  date: "2026-08-09",
  timeZone: "America/New_York",
  currencyCode: "USD",
  shifts: [
    {
      id: "shift-1",
      employeeId: "employee-1",
      employeeName: "Morgan Manager",
      jobName: "Host",
      department: "Front of house",
      startsAt: "2026-08-09T21:00:00.000Z",
      endsAt: "2026-08-10T03:00:00.000Z",
      startLabel: "5:00 PM",
      endLabel: "11:00 PM",
      status: "scheduled",
      isOpen: false,
      clockedIn: true,
    },
  ],
  scheduledCount: 2,
  openShiftCount: 1,
  clockedInCount: 1,
  openPunchCount: 1,
  tasks: [
    {
      id: "task-1",
      title: "Resolve blocked handoff",
      priority: "urgent",
      status: "blocked",
      dueAt: "2026-08-09T22:30:00.000Z",
      assigneeName: "Morgan Manager",
    },
  ],
  openTaskCount: 1,
  announcements: [],
  closeout: null,
  pendingInventoryCounts: 0,
  configuredParLevels: 0,
  currentEmployeeId: "employee-1",
};

const serviceControl: LiveServiceControlModel = {
  date: "2026-08-09",
  timeZone: "America/New_York",
  canManageAvailability: true,
      canManageLog: true,
      canManagePreshift: true,
      availabilitySubjects: [],
      availability: [
    {
      id: "availability-1",
      subjectId: "10000000-0000-4000-8000-000000000101",
      subjectType: "menu_item",
      subjectLabel: "Steak frites",
      status: "eighty_sixed",
      estimatedPortions: 0,
      reason: "Sold out",
      effectiveAt: "2026-08-09T22:00:00.000Z",
      expectedRestorationAt: null,
      notes: null,
    },
  ],
  managerLog: [],
  preshifts: [],
};

const reservationSlice: TodayReservationSlice = {
  serviceName: "Dinner",
  serviceWindow: "17:00–23:00",
  servicePhase: "in_service",
  timeZone: "America/New_York",
  covers: 42,
  seated: 18,
  reservationCount: 14,
  pendingHoldCount: 0,
  configurationReady: true,
  freshness: {
    source: "tenant_reservation_snapshot",
    observedAt: "2026-08-09T22:00:00.000Z",
    staleAt: "2026-08-09T22:01:00.000Z",
    maxAgeSeconds: 60,
    businessDate: "2026-08-09",
  },
  exceptions: [
    {
      id: "arrived",
      label: "Guests waiting to be seated",
      detail: "1 arrived party needs a seating decision.",
      count: 1,
      urgency: "urgent",
      destination: "/reservations?date=2026-08-09",
    },
  ],
};

describe("ServiceDaySnapshot", () => {
  it("binds scope, resolves one Now action, and orders cross-source exceptions", () => {
    const snapshot = composeServiceDaySnapshot({
      workspace,
      observedAt: "2026-08-09T22:00:00.000Z",
      today,
      serviceControl: { ok: true, data: serviceControl },
      reservationSlice: { ok: true, data: reservationSlice },
      providerHealth: {
        state: "down",
        providers: [
          {
            provider: "resy",
            displayName: "Reservations",
            state: "disconnected",
            syncFreshness: "unknown",
            syncMaxAgeSeconds: 900,
            lastSyncedAt: null,
            updatedAt: "2026-08-09T21:55:00.000Z",
          },
        ],
      },
    });

    expect(snapshot.scope).toEqual({
      organizationId: workspace.organization.id,
      locationId: workspace.activeLocation.id,
      membershipId: workspace.membershipId,
      role: "manager",
      workMode: "host_service",
      businessDate: "2026-08-09",
    });
    expect(snapshot.nowAction).toMatchObject({
      id: "reservations.run_service",
      destination: "/reservations?date=2026-08-09",
      offlinePolicy: "requires_network",
    });
    expect(snapshot.orderedExceptions.slice(0, 4).map((exception) => exception.id)).toEqual([
      "reservations:arrived",
      "service_control:availability",
      "today:blocked_tasks",
      "providers:down",
    ]);
    expect(snapshot.orderedExceptions.map((exception) => exception.order)).toEqual([
      1, 2, 3, 4, 5,
    ]);
    expect(snapshot.sourceFreshness).toEqual([
      {
        source: "today",
        state: "fresh",
        observedAt: "2026-08-09T22:00:00.000Z",
        staleAt: "2026-08-09T22:01:00.000Z",
        maxAgeSeconds: 60,
      },
      {
        source: "service_control",
        state: "fresh",
        observedAt: "2026-08-09T22:00:00.000Z",
        staleAt: "2026-08-09T22:01:00.000Z",
        maxAgeSeconds: 60,
      },
      {
        source: "reservations",
        state: "fresh",
        observedAt: "2026-08-09T22:00:00.000Z",
        staleAt: "2026-08-09T22:01:00.000Z",
        maxAgeSeconds: 60,
      },
      {
        source: "providers",
        state: "fresh",
        observedAt: "2026-08-09T22:00:00.000Z",
        staleAt: "2026-08-09T22:05:00.000Z",
        maxAgeSeconds: 300,
      },
    ]);
    expect(snapshot.realtime).toMatchObject({
      state: "snapshot_only",
      transport: "server_request",
      lastEventAt: null,
    });
  });

  it("surfaces a materialized closure as critical and suppresses the service Now action", () => {
    const snapshot = composeServiceDaySnapshot({
      workspace,
      observedAt: "2026-08-09T22:00:00.000Z",
      today: {
        ...today,
        operatingService: {
          source: "materialized_service_shift",
          name: "Dinner",
          startsAt: "2026-08-09T21:00:00.000Z",
          endsAt: "2026-08-10T03:00:00.000Z",
          state: "closed",
        },
      },
      serviceControl: { ok: true, data: serviceControl },
      reservationSlice: { ok: true, data: reservationSlice },
      providerHealth: { state: "healthy", providers: [] },
    });

    expect(snapshot.nowAction).toBeNull();
    expect(snapshot.orderedExceptions[0]).toMatchObject({
      id: "today:service_closed",
      urgency: "critical",
      destination: "/reservations?date=2026-08-09",
    });
  });

  it("normalizes provider rows without exposing configuration or credentials", () => {
    expect(
      deriveProviderHealth(
        [
          {
            provider: "toast",
            display_name: "POS",
            status: "connected",
            last_synced_at: "2026-08-09T21:00:00.000Z",
            updated_at: "2026-08-09T21:00:00.000Z",
          },
          {
            provider: "resy",
            display_name: "Reservations",
            status: "pending",
            last_synced_at: null,
            updated_at: "2026-08-09T21:30:00.000Z",
          },
        ],
        new Date("2026-08-09T22:00:00.000Z"),
      ),
    ).toEqual({
      state: "degraded",
      providers: [
        {
          provider: "toast",
          displayName: "POS",
          state: "connected",
          syncFreshness: "stale",
          syncMaxAgeSeconds: 900,
          lastSyncedAt: "2026-08-09T21:00:00.000Z",
          updatedAt: "2026-08-09T21:00:00.000Z",
        },
        {
          provider: "resy",
          displayName: "Reservations",
          state: "pending",
          syncFreshness: "unknown",
          syncMaxAgeSeconds: 900,
          lastSyncedAt: null,
          updatedAt: "2026-08-09T21:30:00.000Z",
        },
      ],
    });
    expect(deriveProviderHealth([])).toEqual({
      state: "not_configured",
      providers: [],
    });
  });

  it("does not call a connected provider healthy without current sync evidence", () => {
    const row = {
      provider: "resy",
      display_name: "Reservations",
      status: "connected",
      updated_at: "2026-08-09T21:55:00.000Z",
    };

    expect(deriveProviderHealth(
      [{ ...row, last_synced_at: null }],
      new Date("2026-08-09T22:00:00.000Z"),
    )).toMatchObject({
      state: "degraded",
      providers: [{ syncFreshness: "unknown", syncMaxAgeSeconds: 900 }],
    });
    expect(deriveProviderHealth(
      [{ ...row, last_synced_at: "2026-08-09T20:00:00.000Z" }],
      new Date("2026-08-09T22:00:00.000Z"),
    )).toMatchObject({
      state: "degraded",
      providers: [{ syncFreshness: "stale" }],
    });
    expect(deriveProviderHealth(
      [{ ...row, last_synced_at: "2026-08-09T21:55:00.000Z" }],
      new Date("2026-08-09T22:00:00.000Z"),
    )).toMatchObject({
      state: "healthy",
      providers: [{ syncFreshness: "current" }],
    });
  });

  it("does not let a later shift override the effective active job", () => {
    const snapshot = composeServiceDaySnapshot({
      workspace,
      observedAt: "2026-08-09T22:00:00.000Z",
      today: {
        ...today,
        shifts: [
          {
            ...today.shifts[0],
            jobName: "Line Cook",
            department: "Back of house",
            startsAt: "2026-08-10T21:00:00.000Z",
            endsAt: "2026-08-11T03:00:00.000Z",
            clockedIn: false,
          },
        ],
      },
      serviceControl: { ok: true, data: serviceControl },
      reservationSlice: { ok: true, data: reservationSlice },
      providerHealth: { state: "not_configured", providers: [] },
    });

    expect(snapshot.activeJob).toEqual(workspace.activeJob);
    expect(snapshot.scope.workMode).toBe("host_service");
    expect(snapshot.nowAction?.id).toBe("reservations.run_service");
  });

  it("redacts provider health when the capability-scoped read is not authorized", () => {
    const snapshot = composeServiceDaySnapshot({
      workspace,
      observedAt: "2026-08-09T22:00:00.000Z",
      today,
      serviceControl: { ok: true, data: serviceControl },
      reservationSlice: { ok: true, data: reservationSlice },
      providerHealth: {
        state: "restricted",
        providers: [
          {
            provider: "other",
            displayName: "Management-only provider",
            state: "disconnected",
            syncFreshness: "unknown",
            syncMaxAgeSeconds: 3600,
            lastSyncedAt: null,
            updatedAt: "2026-08-09T21:55:00.000Z",
          },
        ],
      },
    });

    expect(snapshot.providerHealth).toEqual({ state: "restricted", providers: [] });
    expect(snapshot.orderedExceptions.some((exception) => exception.source === "providers")).toBe(false);
    expect(snapshot.sourceFreshness.find((source) => source.source === "providers")?.state).toBe(
      "restricted",
    );
  });

  it("starts independent scoped reads before the Today-dependent reservation read", async () => {
    const calls: string[] = [];
    let resolveToday!: (result: LiveReadResult<LiveTodayModel>) => void;
    const todayGate = new Promise<LiveReadResult<LiveTodayModel>>((resolve) => {
      resolveToday = resolve;
    });
    const loaders: ServiceDaySnapshotLoaders = {
      loadToday: async (receivedWorkspace) => {
        expect(receivedWorkspace).toBe(workspace);
        calls.push("today");
        return todayGate;
      },
      loadServiceControl: async (receivedWorkspace) => {
        expect(receivedWorkspace).toBe(workspace);
        calls.push("service");
        return { ok: true, data: serviceControl };
      },
      loadProviderHealth: async (receivedWorkspace) => {
        expect(receivedWorkspace).toBe(workspace);
        calls.push("providers");
        return { ok: true, data: { state: "healthy", providers: [] } };
      },
      loadReservations: async (receivedWorkspace, businessDate) => {
        expect(receivedWorkspace).toBe(workspace);
        expect(businessDate).toBe(today.date);
        calls.push("reservations");
        return { ok: false, message: "Reservation read unavailable." };
      },
      now: () => new Date("2026-08-09T22:00:00.000Z"),
    };

    const resultPromise = loadLiveServiceDaySnapshot(workspace, loaders);
    await Promise.resolve();
    expect(calls).toEqual(["today", "service", "providers"]);
    resolveToday({ ok: true, data: today });
    const result = await resultPromise;

    expect(calls).toEqual(["today", "service", "providers", "reservations"]);
    expect(result.ok && result.data.scope.locationId).toBe(workspace.activeLocation.id);
    expect(result.ok && result.data.sourceFreshness.find(
      (source) => source.source === "reservations",
    )?.state).toBe("unavailable");
  });

  it("uses the protected provider RPC but never starts a restricted reservation read", async () => {
    const deniedWorkspace: WorkspaceContextValue = {
      ...workspace,
      role: "manager",
      capabilities: [],
      activeJob: {
        name: "Server",
        code: "SERVER",
        department: "Front of house",
      },
    };
    let providerReadCount = 0;
    let reservationReadCount = 0;
    const loaders: ServiceDaySnapshotLoaders = {
      loadToday: async () => ({ ok: true, data: { ...today, shifts: [], currentEmployeeId: null } }),
      loadServiceControl: async () => ({ ok: true, data: serviceControl }),
      loadProviderHealth: async () => {
        providerReadCount += 1;
        return { ok: true, data: { state: "restricted", providers: [] } };
      },
      loadReservations: async () => {
        reservationReadCount += 1;
        return { ok: false, message: "must not run" };
      },
      now: () => new Date("2026-08-09T22:00:00.000Z"),
    };

    const result = await loadLiveServiceDaySnapshot(deniedWorkspace, loaders);

    expect(providerReadCount).toBe(1);
    expect(reservationReadCount).toBe(0);
    expect(result.ok && result.data.providerHealth).toEqual({
      state: "restricted",
      providers: [],
    });
    expect(result.ok && result.data.nowAction).toBeNull();
    expect(result.ok && result.data.sourceFreshness.filter(
      (source) => source.state === "restricted",
    ).map((source) => source.source)).toEqual(["reservations", "providers"]);
  });
});
