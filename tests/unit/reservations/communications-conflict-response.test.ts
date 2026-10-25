import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ rpc: vi.fn(), schedule: vi.fn() }));
const org = "20000000-0000-4000-8000-000000000001";
const location = "30000000-0000-4000-8000-000000000001";
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => {
    const query = {
      eq: () => query, contains: () => query, order: () => query, limit: () => query,
      maybeSingle: async () => ({ data: {
        id: "40000000-0000-4000-8000-000000000001", organization_id: org,
        location_id: location, name: "Synthetic communications client",
        scopes: ["availability:read", "reservations:write"], is_active: true, expires_at: null,
      }, error: null }),
    };
    return { rpc: mocks.rpc, from: () => ({ select: () => query }) };
  },
}));
vi.mock("@/lib/communications.server", () => ({ resolveLeYardTenant: async () => ({ organizationId: org, locationId: location }) }));
vi.mock("@/lib/reservations/public-booking-policy.server", () => ({ assertPublicReservationInventoryEnabled: vi.fn() }));
vi.mock("@/lib/reservations/public-availability.server", () => ({ loadPublicAvailability: vi.fn() }));
vi.mock("@/lib/reservations/slot-token.server", () => ({ verifyBookingSlotToken: () => ({ locationId: location, partySize: 2, releaseId: "synthetic-release", businessDate: "2027-03-11", startsAt: "2027-03-11T23:00:00Z", durationMinutes: 75, tableIds: [] }) }));
vi.mock("@/lib/reservations/public-release-control.server", () => ({ loadPublicReleaseState: async () => ({ releaseId: "synthetic-release" }), assertPublicReleaseAllowsBusinessDate: vi.fn() }));
vi.mock("@/lib/reservations/delivery-readiness.server", () => ({ configuredReservationDeliveryAdapters: () => ["email"], assertApprovedReservationDeliveryChannel: vi.fn() }));
vi.mock("@/lib/reservations/message-delivery-trigger.server", () => ({ scheduleReservationMessageDelivery: mocks.schedule }));

import { communicationsCreateReservation } from "@/lib/communications-reservations.server";

function create() {
  return communicationsCreateReservation(new Request("https://os.example/api/internal/communications/agent/reservations", {
    method: "POST", headers: { "idempotency-key": "60000000-0000-4000-8000-000000000001" },
  }), { slotToken: "synthetic", partySize: 2, firstName: "Test", lastName: "Guest", email: "test@example.invalid", phone: "+12125550100" });
}
beforeEach(() => { mocks.rpc.mockReset(); mocks.schedule.mockReset(); });

describe("communications reservation conflict responses", () => {
  it.each(["PT409", "40001"])("requires review for %s without retrying or scheduling delivery", async code => {
    mocks.rpc.mockResolvedValue({ data: null, error: { code, message: "private evidence" } });
    await expect(create()).rejects.toMatchObject({ status: 409, code: "reservation_changed", message: expect.stringContaining("original request") });
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.rpc).toHaveBeenCalledWith("service_book_public_reservation", expect.objectContaining({ p_request_id: "60000000-0000-4000-8000-000000000001" }));
    expect(mocks.schedule).not.toHaveBeenCalled();
  });

  it("keeps a timeout outcome uncertain", async () => {
    const log = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      mocks.rpc.mockResolvedValue({ data: null, error: { code: "57014" } });
      await expect(create()).rejects.toMatchObject({ status: 503, code: "booking_unavailable" });
      expect(mocks.schedule).not.toHaveBeenCalled();
    } finally { log.mockRestore(); }
  });

  it("retains a confirmed positive result and schedules its existing delivery path once", async () => {
    const data = { reservationId: "70000000-0000-4000-8000-000000000001", status: "confirmed" };
    mocks.rpc.mockResolvedValue({ data, error: null });
    await expect(create()).resolves.toEqual(data);
    expect(mocks.rpc).toHaveBeenCalledTimes(1);
    expect(mocks.schedule).toHaveBeenCalledTimes(1);
  });
});
