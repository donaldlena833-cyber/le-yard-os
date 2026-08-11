import { describe, expect, it } from "vitest";
import {
  deriveServicePhase,
  deriveTodayReservationSlice,
} from "@/lib/actions/today-reservation-slice";
import type { ReservationHostModel } from "@/lib/reservations/model";

const model: ReservationHostModel = {
  permissions: {
    view: true,
    operate: true,
    override: false,
    configure: false,
  },
  businessDate: "2026-08-09",
  timeZone: "America/New_York",
  currencyCode: "USD",
  serviceName: "Dinner",
  serviceWindow: "17:00–23:00",
  reservations: [
    {
      id: "pending",
      startsAt: "2026-08-09T22:00:00.000Z",
      durationMinutes: 90,
      partySize: 2,
      status: "pending_verification",
      source: "direct",
      bookingChannel: "internal",
      tableLabel: null,
      tableIds: [],
      specialRequests: null,
      guest: {
        id: null,
        displayName: "Pending guest",
        email: null,
        phone: null,
        vip: false,
        allergies: null,
        preferences: null,
        visitCount: 0,
        lifetimeSpendCents: 0,
      },
    },
    {
      id: "arrived",
      startsAt: "2026-08-09T22:15:00.000Z",
      durationMinutes: 90,
      partySize: 4,
      status: "arrived",
      source: "phone",
      bookingChannel: "internal",
      tableLabel: null,
      tableIds: [],
      specialRequests: null,
      guest: {
        id: "guest-1",
        displayName: "Arrived guest",
        email: null,
        phone: null,
        vip: false,
        allergies: null,
        preferences: null,
        visitCount: 1,
        lifetimeSpendCents: 0,
      },
    },
  ],
  floorNow: {
    observedAt: "2026-08-09T22:00:00.000Z",
    businessDateAtObservation: "2026-08-09",
    tables: [],
    activeAllocations: [],
  },
  intervalInventory: {
    windowStartsAt: "2026-08-09T04:00:00.000Z",
    windowEndsAt: "2026-08-10T04:00:00.000Z",
    allocations: [],
  },
  combinations: [],
  waitlist: [
    {
      id: "wait-1",
      displayName: "Waiting guest",
      partySize: 2,
      quotedWaitMinutes: 20,
      status: "waiting",
      notes: null,
      createdAt: "2026-08-09T22:00:00.000Z",
    },
  ],
  metrics: {
    covers: 6,
    seated: 0,
    remaining: 6,
    waitlist: 1,
    pendingHoldCount: 2,
  },
  pacing: [
    {
      startsAt: "2026-08-09T22:00:00.000Z",
      label: "6:00 PM",
      covers: 8,
      limit: 6,
    },
  ],
  configuration: {
    ready: false,
    onlineBookingEnabled: false,
    messagingEnabled: false,
    tableCount: 0,
    seatCount: 0,
  },
};

describe("Today reservation snapshot adapter", () => {
  it("reports phase and freshness in the restaurant timezone", () => {
    expect(deriveServicePhase(model, "2026-08-09T20:00:00.000Z")).toBe(
      "pre_service",
    );
    expect(deriveServicePhase(model, "2026-08-09T22:00:00.000Z")).toBe(
      "in_service",
    );
    expect(deriveServicePhase(model, "2026-08-10T03:30:00.000Z")).toBe(
      "post_service",
    );

    const slice = deriveTodayReservationSlice(model, "2026-08-09T22:00:00.000Z");
    expect(slice.freshness).toEqual({
      source: "tenant_reservation_snapshot",
      observedAt: "2026-08-09T22:00:00.000Z",
      staleAt: "2026-08-09T22:01:00.000Z",
      maxAgeSeconds: 60,
      businessDate: "2026-08-09",
    });
  });

  it("keeps an overnight service in service after midnight on its opening date", () => {
    const overnight = { ...model, serviceWindow: "17:00–02:00" };

    expect(deriveServicePhase(overnight, "2026-08-10T04:01:00.000Z")).toBe(
      "in_service",
    );
    expect(deriveServicePhase(overnight, "2026-08-10T06:00:00.000Z")).toBe(
      "post_service",
    );
    expect(deriveServicePhase(overnight, "2026-08-11T04:01:00.000Z")).toBe(
      "off_hours",
    );
  });

  it("keeps guest-owned pending holds neutral and dates every staff exception link", () => {
    const slice = deriveTodayReservationSlice(model, "2026-08-09T22:00:00.000Z");

    expect(slice.pendingHoldCount).toBe(2);
    expect(slice.exceptions.map((exception) => exception.id)).toEqual([
      "setup",
      "arrived",
      "unassigned",
      "waitlist",
      "pacing",
    ]);
    expect(slice.exceptions.map((exception) => exception.label).join(" ")).not.toMatch(
      /verify pending/i,
    );
    expect(slice.exceptions.every((exception) => exception.destination === "/reservations?date=2026-08-09")).toBe(true);
  });
});
