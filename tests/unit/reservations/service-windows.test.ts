import { describe, expect, it } from "vitest";
import {
  buildReservationServiceWindows,
  reservationInstantFallsInServiceWindows,
} from "@/lib/reservations/service-windows";

describe("reservation service windows", () => {
  it("excludes prior-night records and includes this dinner's after-midnight records", () => {
    const windows = buildReservationServiceWindows({
      businessDate: "2026-08-09",
      timeZone: "America/New_York",
      periods: [
        {
          id: "brunch",
          name: "Brunch",
          daysOfWeek: [0],
          startsLocal: "10:00:00",
          endsLocal: "14:00:00",
          pacingIntervalMinutes: 30,
          pacingCoverLimit: 20,
        },
        {
          id: "dinner",
          name: "Dinner",
          daysOfWeek: [0],
          startsLocal: "17:00:00",
          endsLocal: "02:00:00",
          pacingIntervalMinutes: 15,
          pacingCoverLimit: 14,
        },
      ],
    });

    expect(windows.map((window) => window.id)).toEqual(["brunch", "dinner"]);
    expect(
      reservationInstantFallsInServiceWindows(
        "2026-08-09T04:30:00.000Z",
        windows,
      ),
    ).toBe(false);
    expect(
      reservationInstantFallsInServiceWindows(
        "2026-08-10T04:30:00.000Z",
        windows,
      ),
    ).toBe(true);
  });

  it("fails closed when a service boundary is nonexistent or ambiguous", () => {
    const period = {
      id: "dst-service",
      name: "DST service",
      daysOfWeek: [0],
      pacingIntervalMinutes: 15,
      pacingCoverLimit: 14,
    };

    expect(
      buildReservationServiceWindows({
        businessDate: "2026-03-08",
        timeZone: "America/New_York",
        periods: [
          { ...period, startsLocal: "02:30:00", endsLocal: "04:00:00" },
        ],
      }),
    ).toEqual([]);
    expect(
      buildReservationServiceWindows({
        businessDate: "2026-11-01",
        timeZone: "America/New_York",
        periods: [
          { ...period, startsLocal: "01:30:00", endsLocal: "03:00:00" },
        ],
      }),
    ).toEqual([]);
  });
});
