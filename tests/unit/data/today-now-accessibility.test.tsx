// @vitest-environment jsdom

import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { HostServiceNow } from "@/components/today/live-today-workspace";
import type {
  ServiceDayException,
  ServiceDayNowAction,
} from "@/data/read-models/service-day-snapshot";
import type { TodayReservationSlice } from "@/lib/actions/today-reservation-slice";

const slice: TodayReservationSlice = {
  serviceName: "Dinner",
  serviceWindow: "17:00–23:00",
  servicePhase: "in_service",
  timeZone: "America/New_York",
  covers: 42,
  seated: 18,
  reservationCount: 14,
  pendingHoldCount: 1,
  configurationReady: true,
  freshness: {
    source: "tenant_reservation_snapshot",
    observedAt: "2026-08-09T22:00:00.000Z",
    staleAt: "2026-08-09T22:01:00.000Z",
    maxAgeSeconds: 60,
    businessDate: "2026-08-09",
  },
  exceptions: [
    {
      id: "arrived",
      label: "Guests waiting to be seated",
      detail: "1 arrived party needs a seating decision.",
      count: 1,
      urgency: "urgent",
      destination: "/reservations?date=2026-08-09",
    },
  ],
};

const action: ServiceDayNowAction = {
  id: "reservations.run_service",
  label: "Open reservation book",
  description: "Review current service.",
  destination: "/reservations?date=2026-08-09",
  urgency: "urgent",
  analyticsName: "today_reservation_service_opened",
  offlinePolicy: "requires_network",
};

const exceptions: ServiceDayException[] = slice.exceptions.map(
  (exception, index) => ({
    ...exception,
    id: `reservations:${exception.id}`,
    source: "reservations",
    order: index + 1,
  }),
);

afterEach(() => cleanup());

describe("Host/service Today Now accessibility", () => {
  it("exposes a named region, dated links, freshness, and 48px dominant action", () => {
    const { container } = render(
      <HostServiceNow slice={slice} action={action} exceptions={exceptions} />,
    );

    expect(screen.getByRole("region", { name: /host service now/i })).toBeTruthy();
    const primaryAction = screen.getByRole("link", { name: "Open reservation book" });
    expect(primaryAction.getAttribute("href")).toBe("/reservations?date=2026-08-09");
    expect(primaryAction.className).toContain("min-h-12");
    expect(primaryAction.tabIndex).toBe(0);

    const exception = screen.getByRole("link", { name: /Guests waiting to be seated/i });
    expect(exception.getAttribute("href")).toBe("/reservations?date=2026-08-09");
    expect(exception.className).toContain("min-h-11");
    expect(exception.tabIndex).toBe(0);
    expect(container.querySelector("time")?.getAttribute("datetime")).toBe(
      slice.freshness.observedAt,
    );
    expect(screen.getByText(/not assigned as a staff exception/i)).toBeTruthy();
    expect(screen.queryByText(/verify pending reservations/i)).toBeNull();
    expect(screen.getByText(/does not enable public booking/i)).toBeTruthy();
  });
});
