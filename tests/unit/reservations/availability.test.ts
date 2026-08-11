import { describe, expect, it } from "vitest";
import { isPacingAvailable, selectTurnDuration, suggestTables } from "@/lib/reservations/availability";

const tables = [
  { id: "t2", label: "2", minCapacity: 1, maxCapacity: 2, isBookable: true, isActive: true },
  { id: "t4a", label: "4A", minCapacity: 2, maxCapacity: 4, isBookable: true, isActive: true },
  { id: "t4b", label: "4B", minCapacity: 2, maxCapacity: 4, isBookable: true, isActive: true },
];

describe("reservation availability", () => {
  it("chooses the least wasteful single table before a combination", () => {
    const result = suggestTables({
      partySize: 2,
      startsAt: "2026-08-10T23:00:00Z",
      durationMinutes: 90,
      tables,
      combinations: [{ id: "c1", label: "4A + 4B", minCapacity: 2, maxCapacity: 8, tableIds: ["t4a", "t4b"], isActive: true }],
      allocations: [],
    });
    expect(result.map((entry) => entry.label)).toEqual(["2", "4A", "4B", "4A + 4B"]);
  });

  it("excludes overlapping and unexpired held tables", () => {
    const result = suggestTables({
      partySize: 2,
      startsAt: "2026-08-10T23:00:00Z",
      durationMinutes: 90,
      now: "2026-08-10T22:00:00Z",
      tables,
      allocations: [{ tableId: "t2", startsAt: "2026-08-10T22:30:00Z", endsAt: "2026-08-11T00:00:00Z", expiresAt: "2026-08-10T22:10:00Z", isActive: true }],
    });
    expect(result.some((entry) => entry.tableIds.includes("t2"))).toBe(false);
  });

  it("does not let an expired hold block a table at read time", () => {
    const result = suggestTables({
      partySize: 2,
      startsAt: "2026-08-10T23:00:00Z",
      durationMinutes: 90,
      now: "2026-08-10T22:00:00Z",
      tables,
      allocations: [
        {
          tableId: "t2",
          startsAt: "2026-08-10T22:30:00Z",
          endsAt: "2026-08-11T00:00:00Z",
          expiresAt: "2026-08-10T21:59:59Z",
          isActive: true,
        },
      ],
    });
    expect(result.some((entry) => entry.tableIds.includes("t2"))).toBe(true);
  });

  it("enforces pacing and party-specific turn rules", () => {
    expect(isPacingAvailable({ startsAt: "2026-08-10T23:00:00Z", partySize: 4, intervalMinutes: 15, coverLimit: 10, reservations: [{ startsAt: "2026-08-10T23:05:00Z", partySize: 7, status: "booked" }] })).toBe(false);
    expect(selectTurnDuration(5, 90, [{ minPartySize: 5, maxPartySize: 8, durationMinutes: 120 }])).toBe(120);
  });
});
