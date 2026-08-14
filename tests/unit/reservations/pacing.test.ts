import { describe, expect, it } from "vitest";
import { deriveReservationPacingBuckets } from "@/lib/reservations/pacing";

describe("reservation pacing projection", () => {
  it.each([
    {
      intervalMinutes: 30,
      first: "2026-08-09T21:45:00.000Z",
      second: "2026-08-09T22:15:00.000Z",
    },
    {
      intervalMinutes: 15,
      first: "2026-08-09T21:55:00.000Z",
      second: "2026-08-09T22:05:00.000Z",
    },
  ])(
    "catches the rolling $intervalMinutes-minute limit that hourly grouping misses",
    ({ intervalMinutes, first, second }) => {
      const buckets = deriveReservationPacingBuckets({
        serviceStartsAt: "2026-08-09T21:00:00.000Z",
        serviceEndsAt: "2026-08-09T23:00:00.000Z",
        intervalMinutes,
        coverLimit: 10,
        timeZone: "America/New_York",
        capacity: [
          { startsAt: first, partySize: 6 },
          { startsAt: second, partySize: 6 },
        ],
      });

      const sixPm = buckets.find(
        (bucket) => bucket.startsAt === "2026-08-09T22:00:00.000Z",
      );
      expect(sixPm).toMatchObject({ covers: 12, limit: 10 });
      expect(
        new Set(
          [first, second].map((value) => new Date(value).getUTCHours()),
        ).size,
      ).toBe(2);
    },
  );

  it("continues service slots through an overnight end instant", () => {
    const buckets = deriveReservationPacingBuckets({
      serviceStartsAt: "2026-08-09T21:00:00.000Z",
      serviceEndsAt: "2026-08-10T06:00:00.000Z",
      intervalMinutes: 30,
      coverLimit: 14,
      timeZone: "America/New_York",
      capacity: [],
    });

    expect(buckets.at(-1)?.startsAt).toBe("2026-08-10T05:30:00.000Z");
  });

  it("preserves exact first- and last-slot rolling boundaries", () => {
    const buckets = deriveReservationPacingBuckets({
      serviceStartsAt: "2026-08-09T21:00:00.000Z",
      serviceEndsAt: "2026-08-09T23:00:00.000Z",
      intervalMinutes: 30,
      coverLimit: 20,
      timeZone: "America/New_York",
      capacity: [
        { startsAt: "2026-08-09T20:45:00.000Z", partySize: 3 },
        { startsAt: "2026-08-09T22:59:59.999Z", partySize: 5 },
        { startsAt: "2026-08-09T23:00:00.000Z", partySize: 7 },
      ],
    });

    expect(buckets[0]).toMatchObject({
      startsAt: "2026-08-09T21:00:00.000Z",
      covers: 3,
    });
    expect(buckets.at(-1)).toMatchObject({
      startsAt: "2026-08-09T22:30:00.000Z",
      covers: 5,
    });
  });
});
