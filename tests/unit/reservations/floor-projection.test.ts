import { describe, expect, it } from "vitest";
import { setReservationTableStatusInputSchema } from "@/data/reservation-schemas";
import { localDateKey } from "@/data/read-models/local-time";
import { suggestTables } from "@/lib/reservations/availability";
import { createDemoReservationModel } from "@/lib/reservations/demo";
import {
  floorNowMatchesInventoryDate,
  isReservationAllocationActiveAt,
  isReservationPhysicalStatusEvent,
  isReservationTableReadyForImmediateSeating,
  latestReservationPhysicalStatus,
  reservationTableAcceptsIntervalBookings,
  resolveReservationPhysicalTableState,
} from "@/lib/reservations/floor-projection";

const observedAt = "2026-08-10T22:00:00.000Z";

function interval(overrides: {
  startsAt: string;
  endsAt: string;
  expiresAt?: string | null;
}) {
  return {
    startsAt: overrides.startsAt,
    endsAt: overrides.endsAt,
    expiresAt: overrides.expiresAt ?? null,
  };
}

describe("reservation floor-now projection", () => {
  it("uses a half-open interval boundary at the observation instant", () => {
    expect(
      isReservationAllocationActiveAt(
        interval({
          startsAt: observedAt,
          endsAt: "2026-08-10T23:00:00.000Z",
        }),
        observedAt,
      ),
    ).toBe(true);
    expect(
      isReservationAllocationActiveAt(
        interval({
          startsAt: "2026-08-10T21:00:00.000Z",
          endsAt: observedAt,
        }),
        observedAt,
      ),
    ).toBe(false);
    expect(
      isReservationAllocationActiveAt(
        interval({
          startsAt: "2026-08-10T21:00:00.000Z",
          endsAt: "2026-08-10T23:00:00.000Z",
          expiresAt: observedAt,
        }),
        observedAt,
      ),
    ).toBe(false);
  });

  it("applies only a currently overlapping timed block to floor color", () => {
    const futureBlock = interval({
      startsAt: "2026-08-10T23:00:00.000Z",
      endsAt: "2026-08-11T00:00:00.000Z",
    });
    expect(isReservationAllocationActiveAt(futureBlock, observedAt)).toBe(
      false,
    );
    expect(
      resolveReservationPhysicalTableState({
        latestStatus: "available",
        currentAllocationState: null,
      }),
    ).toBe("available");
    expect(
      resolveReservationPhysicalTableState({
        latestStatus: "available",
        currentAllocationState: "blocked",
      }),
    ).toBe("blocked");
  });

  it("does not treat a hold, assignment, or legacy upcoming event as physical occupancy", () => {
    for (const allocationState of ["tentative", "committed"] as const) {
      expect(
        resolveReservationPhysicalTableState({
          latestStatus: null,
          currentAllocationState: allocationState,
        }),
      ).toBe("available");
    }
    expect(
      resolveReservationPhysicalTableState({
        latestStatus: "reserved_upcoming",
        currentAllocationState: null,
      }),
    ).toBe("available");
    expect(isReservationPhysicalStatusEvent("reserved_upcoming")).toBe(false);
    expect(isReservationPhysicalStatusEvent("occupied")).toBe(true);
  });

  it("does not let a legacy upcoming event reopen a physically blocked table", () => {
    const latestPhysical = latestReservationPhysicalStatus([
      "reserved_upcoming",
      "blocked",
      "available",
    ]);
    expect(latestPhysical).toBe("blocked");
    expect(reservationTableAcceptsIntervalBookings(true, latestPhysical)).toBe(
      false,
    );
  });

  it("requires a physically ready table for immediate seating", () => {
    expect(
      isReservationTableReadyForImmediateSeating({
        isBookable: true,
        state: "available",
      }),
    ).toBe(true);
    for (const state of ["occupied", "needs_reset", "blocked"] as const) {
      expect(
        isReservationTableReadyForImmediateSeating({
          isBookable: true,
          state,
        }),
      ).toBe(false);
    }
    expect(
      isReservationTableReadyForImmediateSeating({
        isBookable: false,
        state: "available",
      }),
    ).toBe(false);
  });

  it("protects the whole immediate turn with interval inventory", () => {
    const suggestions = suggestTables({
      partySize: 2,
      startsAt: observedAt,
      durationMinutes: 90,
      now: observedAt,
      tables: [
        {
          id: "table-1",
          label: "1",
          minCapacity: 1,
          maxCapacity: 2,
          isBookable: true,
          isActive: true,
        },
      ],
      allocations: [
        {
          tableId: "table-1",
          startsAt: "2026-08-10T22:30:00.000Z",
          endsAt: "2026-08-10T23:30:00.000Z",
          isActive: true,
        },
      ],
    });
    expect(suggestions).toEqual([]);
  });

  it("refuses to combine a future day inventory with the current floor", () => {
    expect(floorNowMatchesInventoryDate("2026-08-10", "2026-08-10")).toBe(
      true,
    );
    expect(floorNowMatchesInventoryDate("2026-08-10", "2026-08-11")).toBe(
      false,
    );
  });

  it("keeps demo future assignments and blocks out of the physical projection", () => {
    const model = createDemoReservationModel(
      localDateKey(new Date(), "America/New_York"),
    );
    const futureReservationTable = model.floorNow.tables.find(
      (table) => table.id === "demo-table-10",
    );
    const futureBlockedTable = model.floorNow.tables.find(
      (table) => table.id === "demo-table-17",
    );
    const occupiedTable = model.floorNow.tables.find(
      (table) => table.id === "demo-table-9",
    );

    expect(futureReservationTable?.state).toBe("available");
    expect(
      model.intervalInventory.allocations.some(
        (allocation) =>
          allocation.tableId === futureReservationTable?.id &&
          allocation.state === "committed",
      ),
    ).toBe(true);
    expect(futureBlockedTable?.state).toBe("available");
    expect(
      model.intervalInventory.allocations.some(
        (allocation) =>
          allocation.tableId === futureBlockedTable?.id &&
          allocation.state === "blocked",
      ),
    ).toBe(true);
    expect(occupiedTable).toMatchObject({
      state: "occupied",
      occupyingReservationId: "demo-reservation-4",
    });
  });

  it("rejects future inventory language from the physical-status command", () => {
    const shared = {
      requestId: "11111111-1111-4111-8111-111111111111",
      tableId: "22222222-2222-4222-8222-222222222222",
      note: null,
      reservationId: null,
    };
    expect(
      setReservationTableStatusInputSchema.safeParse({
        ...shared,
        status: "available",
      }).success,
    ).toBe(true);
    expect(
      setReservationTableStatusInputSchema.safeParse({
        ...shared,
        status: "reserved_upcoming",
      }).success,
    ).toBe(false);
  });
});
