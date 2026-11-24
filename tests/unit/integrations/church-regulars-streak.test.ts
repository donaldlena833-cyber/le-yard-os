import { describe, expect, it } from "vitest";
import { regularsJourney, regularsLocalDay, type RegularsClaim } from "@/lib/integrations/church-regulars-streak";

const now = new Date("2026-12-01T15:00:00Z");
const visits = (dates: string[]) => dates.map((day, i) => ({ day, orderId: `order-${i}` }));
const claim = (overrides: Partial<RegularsClaim> = {}): RegularsClaim => ({
  id: "claimed", milestone: 3, cycleStart: "2026-11-25", cycleEnd: "2026-11-27", earnedOn: "2026-11-27",
  status: "fulfilled", reservedAt: "2026-11-27T15:00:00Z", fulfilledAt: "2026-11-27T15:01:00Z", itemLabel: "Almond Croissant", ...overrides,
});

describe("Le Yard daily ritual", () => {
  it("counts New York calendar days, including DST, rather than rolling 24-hour windows", () => {
    expect(regularsLocalDay(new Date("2026-12-01T04:59:59Z"))).toBe("2026-11-30");
    expect(regularsLocalDay(new Date("2026-12-01T05:00:00Z"))).toBe("2026-12-01");
    expect(regularsLocalDay(new Date("2027-03-15T03:59:59Z"))).toBe("2027-03-14");
  });
  it("never turns three same-day transactions into a three-day treat", () => {
    const result = regularsJourney(visits(["2026-11-30", "2026-11-30", "2026-11-30"]), [], now);
    expect(result.currentStreak).toBe(1); expect(result.rewards).toEqual([]);
  });
  it("requires consecutive days and retains already earned treats after a missed day", () => {
    const result = regularsJourney(visits(["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-28"]), [], now);
    expect(result.currentStreak).toBe(0); expect(result.rewards.map(r => r.milestone)).toEqual([3]);
    expect(result.rewards[0].earnedOn).toBe("2026-11-26");
  });
  it("earns the croissant and mystery once in an ongoing seven-day streak", () => {
    const result = regularsJourney(visits(Array.from({ length: 7 }, (_, i) => `2026-11-${25 + i}`.replace("2026-11-31", "2026-12-01"))), [], now);
    expect(result.currentStreak).toBe(7); expect(result.rewards.map(r => r.milestone)).toEqual([3, 7]);
    expect(result.rewards[1].orderIds).toHaveLength(7);
  });
  it("does not issue another reward when late evidence extends the start of a redeemed cycle", () => {
    const result = regularsJourney(visits(["2026-11-24", "2026-11-25", "2026-11-26", "2026-11-27"]), [claim()], now);
    expect(result.rewards[0].claim?.status).toBe("fulfilled");
  });
  it("allows a fresh streak after a gap while keeping its claim separate", () => {
    const result = regularsJourney(visits(["2026-11-25", "2026-11-26", "2026-11-27", "2026-11-29", "2026-11-30", "2026-12-01"]), [claim()], now);
    expect(result.rewards).toHaveLength(2); expect(result.rewards[1].claim).toBeNull();
  });
  it("flags a redeemed reward whose qualifying history no longer survives a refund", () => {
    const result = regularsJourney(visits(["2026-11-25", "2026-11-27"]), [claim()], now);
    expect(result.rewards).toEqual([]); expect(result.reviewClaims).toHaveLength(1);
  });
  it("keeps yesterday's streak alive and rejects pre-program and future dates", () => {
    const result = regularsJourney(visits(["2026-11-23", "2026-11-29", "2026-11-30", "2026-12-02"]), [], now);
    expect(result.currentStreak).toBe(2); expect(result.visitedToday).toBe(false); expect(result.rewards).toEqual([]);
  });
});
