import { describe, expect, it } from "vitest";
import {
  buildServiceShiftBoundaryOptions,
  createDemoServiceShiftManagement,
  serviceShiftExceptionLabel,
} from "@/lib/reservations/service-shift-management";

describe("service-shift management projection", () => {
  it("builds exact overnight boundary choices from server-owned instants", () => {
    const options = buildServiceShiftBoundaryOptions(
      {
        startsAt: "2026-08-11T21:00:00.000Z",
        endsAt: "2026-08-12T06:00:00.000Z",
      },
      "America/New_York",
      60,
    );

    expect(options).toHaveLength(10);
    expect(options[0]).toMatchObject({
      value: "2026-08-11T21:00:00.000Z",
    });
    expect(options.at(-1)).toMatchObject({
      value: "2026-08-12T06:00:00.000Z",
    });
    expect(options[0]?.label).toContain("Tue");
    expect(options.at(-1)?.label).toContain("Wed");
  });

  it("fails closed on invalid or unbounded boundary inputs", () => {
    expect(
      buildServiceShiftBoundaryOptions(
        { startsAt: "invalid", endsAt: "2026-08-12T06:00:00.000Z" },
        "America/New_York",
      ),
    ).toEqual([]);
    expect(
      buildServiceShiftBoundaryOptions(
        {
          startsAt: "2026-08-12T06:00:00.000Z",
          endsAt: "2026-08-11T21:00:00.000Z",
        },
        "America/New_York",
      ),
    ).toEqual([]);
  });

  it("keeps the demo service offline and exposes clear exception labels", () => {
    const model = createDemoServiceShiftManagement(
      "2026-08-11",
      "America/New_York",
    );
    expect(model.shifts).toHaveLength(1);
    expect(model.shifts[0]?.onlineEnabled).toBe(false);
    expect(serviceShiftExceptionLabel("closure")).toBe("Closure");
    expect(serviceShiftExceptionLabel("pacing_override")).toBe(
      "Pacing override",
    );
    expect(serviceShiftExceptionLabel("buffer_override")).toBe(
      "Booking buffer override",
    );
  });
});
