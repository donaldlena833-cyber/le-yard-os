import { describe, expect, it, vi } from "vitest";
import { ChurchSquareLoyaltyClient } from "@/lib/integrations/church-square-loyalty.server";
import type { SquareCountConfiguration } from "@/lib/integrations/square-counts.server";
const config: SquareCountConfiguration = { environment: "production", accessToken: "synthetic-secret", merchantId: "merchant", locationId: "church",
  currency: "USD", timeZone: "America/New_York", address: { street: "140 Church Street", postalCode: "10007", country: "US" } };
const event = { id: "event", type: "ACCUMULATE_POINTS", loyalty_account_id: "account", location_id: "church",
  accumulate_points: { loyalty_program_id: "program", points: 5, order_id: "order" } };
const order = { id: "order", location_id: "church", state: "COMPLETED", closed_at: "2026-11-27T04:59:59Z",
  line_items: [{ catalog_object_id: "croissant" }], tenders: [{ payment_id: "payment" }] };
const payment = { id: "payment", location_id: "church", order_id: "order", status: "COMPLETED",
  amount_money: { amount: 500, currency: "USD" }, refunded_money: { amount: 0, currency: "USD" } };
function provider(overrides: Record<string, unknown> = {}) {
  const fixtures: Record<string, unknown> = {
    "/v2/merchants/merchant": { merchant: { id: "merchant", country: "US", currency: "USD", status: "ACTIVE" } },
    "/v2/locations/church": { location: { id: "church", merchant_id: "merchant", status: "ACTIVE", currency: "USD", timezone: "America/New_York", address: { address_line_1: "140 Church St", postal_code: "10007", country: "US" } } },
    "/v2/loyalty/programs/main": { program: { id: "program", status: "ACTIVE", location_ids: ["church"], reward_tiers: [] } },
    "/v2/loyalty/accounts/account": { loyalty_account: { id: "account", program_id: "program", customer_id: "customer", balance: 5, mapping: { phone_number: "+12125550100" } } },
    "/v2/loyalty/events/search": { events: [event] },
    "/v2/orders/batch-retrieve": { orders: [order] }, "/v2/payments/payment": { payment }, ...overrides,
  };
  return vi.fn<typeof fetch>(async url => {
    const fixture = fixtures[new URL(String(url)).pathname];
    if (!fixture) throw new Error("Unexpected request"); return Response.json(fixture);
  });
}
describe("purchase proof for daily treats", () => {
  it("uses the completed purchase date in New York and rechecks actual payment status", async () => {
    const request = provider();
    expect(await new ChurchSquareLoyaltyClient(config, request).regularsVisits("account")).toEqual([{ day: "2026-11-26", orderId: "order" }]);
    const search = request.mock.calls.find(([url]) => String(url).endsWith("events/search"))!;
    expect(JSON.parse(String(search[1]?.body)).query.filter.loyalty_account_filter).toEqual({ loyalty_account_id: "account" });
  });
  it("does not count a fully refunded or unpaid purchase", async () => {
    for (const change of [{ refunded_money: { amount: 500, currency: "USD" } }, { status: "APPROVED" }]) {
      expect(await new ChurchSquareLoyaltyClient(config, provider({ "/v2/payments/payment": { payment: { ...payment, ...change } } })).regularsVisits("account")).toEqual([]);
    }
  });
  it("allows a partial refund while a genuine paid purchase remains", async () => {
    expect(await new ChurchSquareLoyaltyClient(config, provider({ "/v2/payments/payment": { payment: { ...payment, refunded_money: { amount: 200, currency: "USD" } } } })).regularsVisits("account")).toHaveLength(1);
  });
  it("never counts manual points, another location or an unlinked purchase", async () => {
    for (const changed of [{ ...event, type: "ADJUST_POINTS" }, { ...event, location_id: "other" }, { ...event, accumulate_points: { loyalty_program_id: "program", points: 5 } }]) {
      expect(await new ChurchSquareLoyaltyClient(config, provider({ "/v2/loyalty/events/search": { events: [changed] } })).regularsVisits("account")).toEqual([]);
    }
  });
  it("fails closed when an order is missing, a cursor repeats, or a payment belongs elsewhere", async () => {
    for (const change of [{ "/v2/orders/batch-retrieve": { orders: [] } }, { "/v2/loyalty/events/search": { events: [event], cursor: "same-page" } },
      { "/v2/payments/payment": { payment: { ...payment, location_id: "elsewhere" } } }]) {
      await expect(new ChurchSquareLoyaltyClient(config, provider(change)).regularsVisits("account")).rejects.toThrow();
    }
  });
  it("refuses a foreign loyalty account and test-only purchases", async () => {
    await expect(new ChurchSquareLoyaltyClient(config, provider({ "/v2/loyalty/accounts/account": { loyalty_account: {
      id: "account", program_id: "foreign", customer_id: "customer", balance: 5, mapping: { phone_number: "+12125550100" },
    } } })).regularsVisits("account")).rejects.toThrow();
    expect(await new ChurchSquareLoyaltyClient({ ...config, testVariationId: "croissant" }, provider()).regularsVisits("account")).toEqual([]);
  });
});
