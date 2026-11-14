import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ session: vi.fn(), from: vi.fn() }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/lib/supabase/server", () => ({ createClient: async () => ({ from: mocks.from }) }));

import { GET } from "@/app/api/workspace/church-square-orders/route";
import { isPublicRequestPath } from "@/lib/auth/public-paths";
import { churchSquareOrderWindowPath } from "@/lib/integrations/church-square-order-window";

const workspace = {
  mode: "live",
  role: "manager",
  capabilities: ["reports.financial.view"],
  serviceSettings: { serviceModel: "counter" },
  organization: { id: "workspace-org" },
  activeLocation: { id: "workspace-location" },
};

const request = (query = "") => new Request("https://example.invalid" + churchSquareOrderWindowPath + query);
const fulfillmentTimes = {
  ready: "2026-11-13T17:02:00Z",
  scheduled: "2026-11-13T17:20:00Z",
  delivered: "2026-11-13T17:24:00Z",
  canceled: "2026-11-13T17:05:00Z",
};

function scopedRows(locationFound = true) {
  const select = vi.fn().mockReturnThis();
  const eq = vi.fn().mockReturnThis();
  mocks.from.mockImplementation(table => ({
    select, eq,
    maybeSingle: async () => ({ data: table === "organizations" || locationFound ? { id: "found" } : null, error: null }),
  }));
  return { select, eq };
}

function stubProvider() {
  const provider = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const path = new URL(String(input)).pathname;
    if (path === "/v2/merchants/square-merchant") {
      return Response.json({ merchant: { id: "square-merchant", country: "US", status: "ACTIVE" } });
    }
    if (path === "/v2/locations/square-location") {
      return Response.json({ location: {
        id: "square-location",
        merchant_id: "square-merchant",
        status: "ACTIVE",
        timezone: "America/New_York",
        currency: "USD",
        address: { address_line_1: "140 Church St", postal_code: "10007", country: "US" },
      } });
    }
    if (path !== "/v2/orders/search" || init?.method !== "POST") return new Response(null, { status: 500 });
    const { query } = JSON.parse(String(init.body));
    const updatedAt = query.filter.date_time_filter.updated_at.end_at;
    return Response.json({
      cursor: "square-cursor",
      orders: [{
        id: "full-order-id-9876543210", location_id: "square-location",
        created_at: updatedAt, updated_at: updatedAt,
        state: "COMPLETED", source: { name: "Grubhub" },
        total_money: { amount: 1799, currency: "USD" },
        line_items: [{ name: "PRIVATE content", quantity: "1" }],
        ticket_name: "PRIVATE customer",
        fulfillments: [{
          uid: "private-delivery-uid",
          type: "DELIVERY",
          state: "COMPLETED",
          delivery_details: {
            deliver_at: fulfillmentTimes.scheduled,
            ready_at: fulfillmentTimes.ready,
            delivered_at: fulfillmentTimes.delivered,
            recipient: { display_name: "PRIVATE name", address: { address_line_1: "PRIVATE address" } },
            note: "PRIVATE note",
          },
        }, {
          type: "PICKUP",
          state: "CANCELED",
          pickup_details: { canceled_at: fulfillmentTimes.canceled },
        }],
      }, {
        id: "other-order-id", location_id: "square-location", created_at: updatedAt, updated_at: updatedAt,
      }],
    });
  });
  vi.stubGlobal("fetch", provider);
  return provider;
}

beforeEach(() => {
  vi.resetAllMocks();
  mocks.session.mockResolvedValue({ status: "ready", context: workspace });
  vi.stubEnv("LE_YARD_CHURCH_SQUARE_ORDER_READ_ENABLED", "true");
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("SQUARE_CHURCH_ACCESS_TOKEN", "test-token");
  vi.stubEnv("SQUARE_CHURCH_MERCHANT_ID", "square-merchant");
  vi.stubEnv("SQUARE_CHURCH_LOCATION_ID", "square-location");
});
afterEach(() => { vi.unstubAllEnvs(); vi.unstubAllGlobals(); });

describe("Church Square order window", () => {
  it("denies unauthenticated, non-management and wrong-tenant requests before reaching Square", async () => {
    const fetch = stubProvider();
    expect(isPublicRequestPath(churchSquareOrderWindowPath)).toBe(false);
    mocks.session.mockResolvedValueOnce({ status: "unauthenticated" });
    expect((await GET(request())).status).toBe(401);
    mocks.session.mockResolvedValueOnce({ status: "ready", context: { ...workspace, role: "employee" } });
    expect((await GET(request())).status).toBe(403);
    mocks.session.mockResolvedValueOnce({ status: "ready", context: { ...workspace, capabilities: [] } });
    expect((await GET(request())).status).toBe(403);
    expect(mocks.from).not.toHaveBeenCalled();
    scopedRows(false);
    expect((await GET(request())).status).toBe(403);
    expect(fetch).not.toHaveBeenCalled();
  });

  it("rejects client scope overrides and stops before Square while disabled", async () => {
    const fetch = stubProvider();
    expect((await GET(request("?location=something-else"))).status).toBe(400);
    expect(mocks.session).not.toHaveBeenCalled();
    scopedRows();
    vi.stubEnv("VERCEL_ENV", "preview");
    const response = await GET(request());
    expect(response.status).toBe(503);
    expect(await response.json()).toEqual({ status: "setup_pending" });
    expect(fetch).not.toHaveBeenCalled();
  });

  it("makes one bounded Church Square query and returns only the permitted summary", async () => {
    const fetch = stubProvider();
    const { eq } = scopedRows();
    const response = await GET(request());
    expect(response.status).toBe(200);
    expect(response.headers.get("Cache-Control")).toContain("private, no-store");
    expect(response.headers.get("Vary")).toBe("Cookie");
    expect(eq.mock.calls).toEqual([
      ["id", "workspace-org"], ["slug", "le-yard-church-street"], ["status", "active"],
      ["id", "workspace-location"], ["organization_id", "workspace-org"], ["code", "CHURCH"], ["is_active", true],
    ]);
    expect(fetch).toHaveBeenCalledTimes(3);
    const body = JSON.parse(String(fetch.mock.lastCall?.[1]?.body));
    const period = body.query.filter.date_time_filter.updated_at;
    expect(Date.parse(period.end_at) - Date.parse(period.start_at)).toBe(24 * 60 * 60 * 1000);
    expect(body).toEqual({
      location_ids: ["square-location"], return_entries: false, limit: 50,
      query: { filter: { date_time_filter: { updated_at: period } }, sort: { sort_field: "UPDATED_AT", sort_order: "DESC" } },
    });
    expect(await response.json()).toEqual({
      checkedAt: period.end_at, hasMore: true,
      orders: [
        {
          reference: "9876543210", source: "GRUBHUB", status: "COMPLETED",
          updatedAt: period.end_at, totalCents: 1799,
          fulfillments: [
            {
              type: "DELIVERY", status: "COMPLETED",
              promisedAt: fulfillmentTimes.scheduled, readyAt: fulfillmentTimes.ready,
              handoffAt: fulfillmentTimes.delivered, completedAt: null, canceledAt: null, rejectedAt: null,
            },
            {
              type: "PICKUP", status: "CANCELED",
              promisedAt: null, readyAt: null, handoffAt: null, completedAt: null,
              canceledAt: fulfillmentTimes.canceled, rejectedAt: null,
            },
          ],
        },
        {
          reference: "r-order-id", source: "UNKNOWN", status: "UNKNOWN",
          updatedAt: period.end_at, totalCents: null, fulfillments: [],
        },
      ],
    });
  });
});
