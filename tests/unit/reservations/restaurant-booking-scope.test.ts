import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { authenticateBookingApiRequest } from "@/lib/reservations/api-auth.server";

const restaurant = {
  id: "restaurant-organization",
  slug: "le-yard",
  status: "active",
};
const ninthAvenue = {
  id: "ninth-avenue",
  code: "MAIN",
  organization_id: restaurant.id,
  timezone: "America/New_York",
  is_active: true,
};
const state = vi.hoisted(() => ({
  tables: {} as Record<string, Array<Record<string, unknown>>>,
  update: vi.fn(),
}));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    from(table: string) {
      let rows = state.tables[table] ?? [];
      const query = {
        select: () => query,
        update: state.update.mockReturnValue({
          eq: () => query,
        }),
        eq: (key: string, value: unknown) => {
          rows = rows.filter((row) => row[key] === value);
          return query;
        },
        maybeSingle: async () => ({ data: rows[0] ?? null, error: null }),
      };
      return query;
    },
  }),
}));

const bookingKey = "local-booking-key-for-test-only";
function authorize() {
  return authenticateBookingApiRequest(new Request("https://example.invalid/api/v1/availability", {
    headers: { Authorization: `Bearer ${bookingKey}` },
  }), "availability:read");
}

describe("public booking location binding", () => {
  beforeEach(async () => {
    const { sha256 } = await import("@/lib/reservations/api-auth.server");
    state.update.mockClear();
    vi.stubEnv("LE_YARD_LOCATION_ID", "");
    state.tables = {
      organizations: [restaurant],
      locations: [ninthAvenue],
      booking_api_clients: [{
        id: "booking-client",
        organization_id: restaurant.id,
        location_id: ninthAvenue.id,
        key_hash: sha256(bookingKey),
        is_active: true,
        expires_at: null,
        scopes: ["availability:read"],
        allowed_origins: [],
      }],
    };
  });
  afterEach(() => vi.unstubAllEnvs());

  it("accepts the existing Ninth Avenue client", async () => {
    await expect(authorize()).resolves.toMatchObject({
      organizationId: restaurant.id,
      locationId: ninthAvenue.id,
    });
  });

  it("rejects an otherwise valid key assigned to another tenant", async () => {
    Object.assign(state.tables.booking_api_clients[0], {
      organization_id: "church-organization",
      location_id: "church-street",
    });
    await expect(authorize()).rejects.toMatchObject({ status: 403 });
    expect(state.update).not.toHaveBeenCalled();
  });

  it("fails closed if the configured location disagrees with the canonical restaurant", async () => {
    vi.stubEnv("LE_YARD_LOCATION_ID", "church-street");
    await expect(authorize()).rejects.toMatchObject({ status: 503 });
    expect(state.update).not.toHaveBeenCalled();
  });
});
