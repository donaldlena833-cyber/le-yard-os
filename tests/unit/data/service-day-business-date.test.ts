import { describe, expect, it } from "vitest";
import {
  resolveBusinessDateFromActiveShifts,
  shiftBelongsToResolvedServiceDay,
} from "@/lib/service-day/business-date";

describe("resolveBusinessDateFromActiveShifts", () => {
  it("keeps an active after-midnight shift on its opening business date", () => {
    expect(resolveBusinessDateFromActiveShifts(
      "2026-08-10T04:01:00.000Z",
      "America/New_York",
      "2026-08-10",
      [{
        startsAt: "2026-08-09T21:00:00.000Z",
        endsAt: "2026-08-10T06:00:00.000Z",
      }],
    )).toBe("2026-08-09");
  });

  it("uses the location calendar date when no shift overlaps now", () => {
    expect(resolveBusinessDateFromActiveShifts(
      "2026-08-10T16:00:00.000Z",
      "America/New_York",
      "2026-08-10",
      [{
        startsAt: "2026-08-09T21:00:00.000Z",
        endsAt: "2026-08-10T06:00:00.000Z",
      }],
    )).toBe("2026-08-10");
  });
});

describe("shiftBelongsToResolvedServiceDay", () => {
  it("keeps an after-midnight relief shift in the opening-date service", () => {
    expect(
      shiftBelongsToResolvedServiceDay(
        {
          startsAt: "2026-08-10T04:30:00.000Z",
          endsAt: "2026-08-10T07:30:00.000Z",
        },
        "America/New_York",
        {
          businessDate: "2026-08-09",
          startsAt: "2026-08-09T21:00:00.000Z",
          endsAt: "2026-08-10T06:00:00.000Z",
        },
      ),
    ).toBe(true);
  });

  it("does not pull a next-day shift into the prior service at a week boundary", () => {
    expect(
      shiftBelongsToResolvedServiceDay(
        {
          startsAt: "2026-08-10T07:00:00.000Z",
          endsAt: "2026-08-10T12:00:00.000Z",
        },
        "America/New_York",
        {
          businessDate: "2026-08-09",
          startsAt: "2026-08-09T21:00:00.000Z",
          endsAt: "2026-08-10T06:00:00.000Z",
        },
      ),
    ).toBe(false);
  });

  it("uses absolute overlap through a fall-back service interval", () => {
    expect(
      shiftBelongsToResolvedServiceDay(
        {
          startsAt: "2026-11-01T06:30:00.000Z",
          endsAt: "2026-11-01T09:00:00.000Z",
        },
        "America/New_York",
        {
          businessDate: "2026-11-01",
          startsAt: "2026-11-01T04:30:00.000Z",
          endsAt: "2026-11-01T08:30:00.000Z",
        },
      ),
    ).toBe(true);
  });
});
