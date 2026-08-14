import { describe, expect, it } from "vitest";
import { resolveSelectedReservationDate } from "@/lib/reservations/selected-date";

describe("resolveSelectedReservationDate", () => {
  it("uses the authenticated location date at a non-Eastern boundary", () => {
    const observedAt = new Date("2026-08-10T07:30:00.000Z");

    expect(resolveSelectedReservationDate(undefined, "Pacific/Honolulu", observedAt)).toBe(
      "2026-08-09",
    );
    expect(resolveSelectedReservationDate(undefined, "Asia/Tokyo", observedAt)).toBe(
      "2026-08-10",
    );
  });

  it("preserves a valid explicit date and rejects normalized-looking invalid dates", () => {
    const observedAt = new Date("2026-08-10T07:30:00.000Z");

    expect(resolveSelectedReservationDate("2026-08-12", "Pacific/Honolulu", observedAt)).toBe(
      "2026-08-12",
    );
    expect(resolveSelectedReservationDate("2026-02-30", "Pacific/Honolulu", observedAt)).toBe(
      "2026-08-09",
    );
  });
});
