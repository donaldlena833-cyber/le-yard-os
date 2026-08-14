import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ after: vi.fn() }));

vi.mock("server-only", () => ({}));
vi.mock("next/server", () => ({ after: mocks.after }));

import {
  scheduleReservationMessageDelivery,
  triggerReservationMessageDelivery,
} from "@/lib/reservations/message-delivery-trigger.server";

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllEnvs();
  mocks.after.mockReset();
});

describe("reservation message delivery trigger", () => {
  it("accepts a successful worker response without logging secret material", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));

    await expect(
      triggerReservationMessageDelivery(
        new URL("https://os.example/api/internal/reservation-messages"),
        "s".repeat(32),
        fetcher,
      ),
    ).resolves.toEqual({ status: "accepted" });
    expect(warn).not.toHaveBeenCalled();
    expect(fetcher).toHaveBeenCalledWith(
      expect.any(URL),
      expect.objectContaining({
        method: "POST",
        headers: { authorization: `Bearer ${"s".repeat(32)}` },
      }),
    );
  });

  it("records a bounded non-2xx outcome without logging the worker URL or secret", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 503 }));

    await expect(
      triggerReservationMessageDelivery(
        new URL("https://os.example/api/internal/reservation-messages"),
        "secret-material-that-must-not-appear",
        fetcher,
      ),
    ).resolves.toEqual({ status: "rejected", httpStatus: 503 });
    expect(warn).toHaveBeenCalledWith(
      "reservation_message_delivery_trigger_rejected",
      { httpStatus: 503 },
    );
    expect(JSON.stringify(warn.mock.calls)).not.toContain("secret-material");
    expect(JSON.stringify(warn.mock.calls)).not.toContain("os.example");
  });

  it("makes a missing scheduler secret visible without scheduling work", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    vi.stubEnv("RESERVATION_DELIVERY_SECRET", "");

    scheduleReservationMessageDelivery(
      new Request("https://os.example/api/v1/reservations"),
    );

    expect(mocks.after).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      "reservation_message_delivery_trigger_skipped",
      { reason: "delivery_secret_unavailable" },
    );
  });
});
