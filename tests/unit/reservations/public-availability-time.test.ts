import { describe, expect, it } from "vitest";
import {
  reservationDurationFitsServiceWindow,
  resolveServiceShiftBookableWindow,
  resolveServiceShiftSlotPolicy,
  servicePeriodAcceptsPartySize,
  servicePeriodMinuteBounds,
  serviceSlotLocalDateTime,
} from "@/lib/reservations/public-availability-time";

describe("public availability service boundaries", () => {
  it("extends an overnight service end onto the next operating day", () => {
    expect(servicePeriodMinuteBounds("17:00", "02:00")).toEqual({
      startsAtMinutes: 17 * 60,
      endsAtMinutes: 26 * 60,
    });
    expect(servicePeriodMinuteBounds("09:00", "14:00")).toEqual({
      startsAtMinutes: 9 * 60,
      endsAtMinutes: 14 * 60,
    });
  });

  it("converts after-midnight cursors onto business date plus one", () => {
    expect(serviceSlotLocalDateTime("2026-08-09", 25 * 60 + 15)).toEqual({
      date: "2026-08-10",
      time: "01:15",
    });
  });

  it("filters parties against the selected service period's exact bounds", () => {
    expect(servicePeriodAcceptsPartySize(1, 2, 6)).toBe(false);
    expect(servicePeriodAcceptsPartySize(2, 2, 6)).toBe(true);
    expect(servicePeriodAcceptsPartySize(6, 2, 6)).toBe(true);
    expect(servicePeriodAcceptsPartySize(7, 2, 6)).toBe(false);
  });

  it("bounds spring-forward turns by elapsed time instead of wall minutes", () => {
    const springServiceEndsAt = "2026-03-08T07:30:00.000Z";
    expect(
      reservationDurationFitsServiceWindow(
        "2026-03-08T05:45:00.000Z",
        90,
        springServiceEndsAt,
      ),
    ).toBe(true);
    expect(
      reservationDurationFitsServiceWindow(
        "2026-03-08T06:15:00.000Z",
        90,
        springServiceEndsAt,
      ),
    ).toBe(false);
  });

  it("applies materialized buffers and rejects any turn overlapping a closure", () => {
    const exceptions = [
      {
        kind: "buffer_override" as const,
        startsAt: "2026-08-10T21:00:00.000Z",
        endsAt: "2026-08-11T07:00:00.000Z",
        pacingIntervalMinutes: null,
        pacingCoverLimit: null,
        openingBufferMinutes: 30,
        closingBufferMinutes: 45,
      },
      {
        kind: "closure" as const,
        startsAt: "2026-08-10T23:00:00.000Z",
        endsAt: "2026-08-11T00:00:00.000Z",
        pacingIntervalMinutes: null,
        pacingCoverLimit: null,
        openingBufferMinutes: null,
        closingBufferMinutes: null,
      },
    ];
    expect(
      resolveServiceShiftBookableWindow({
        startsAt: "2026-08-10T21:00:00.000Z",
        endsAt: "2026-08-11T07:00:00.000Z",
        exceptions,
      }),
    ).toEqual({
      startsAt: Date.parse("2026-08-10T21:30:00.000Z"),
      endsAt: Date.parse("2026-08-11T06:15:00.000Z"),
    });
    expect(
      resolveServiceShiftSlotPolicy({
        startsAt: Date.parse("2026-08-10T22:30:00.000Z"),
        endsAt: Date.parse("2026-08-11T00:00:00.000Z"),
        exceptions,
        pacingIntervalMinutes: 15,
        pacingCoverLimit: 20,
      }).isClosed,
    ).toBe(true);
  });

  it("uses a pacing override only for slots inside its effective interval", () => {
    const exceptions = [{
      kind: "pacing_override" as const,
      startsAt: "2026-08-11T00:00:00.000Z",
      endsAt: "2026-08-11T01:00:00.000Z",
      pacingIntervalMinutes: 30,
      pacingCoverLimit: 4,
      openingBufferMinutes: null,
      closingBufferMinutes: null,
    }];
    expect(resolveServiceShiftSlotPolicy({
      startsAt: Date.parse("2026-08-11T00:15:00.000Z"),
      endsAt: Date.parse("2026-08-11T01:45:00.000Z"),
      exceptions,
      pacingIntervalMinutes: 15,
      pacingCoverLimit: 20,
    })).toMatchObject({ pacingIntervalMinutes: 30, pacingCoverLimit: 4 });
    expect(resolveServiceShiftSlotPolicy({
      startsAt: Date.parse("2026-08-11T01:00:00.000Z"),
      endsAt: Date.parse("2026-08-11T02:30:00.000Z"),
      exceptions,
      pacingIntervalMinutes: 15,
      pacingCoverLimit: 20,
    })).toMatchObject({ pacingIntervalMinutes: 15, pacingCoverLimit: 20 });
  });
});
