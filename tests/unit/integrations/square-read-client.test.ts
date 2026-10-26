import { createHmac } from "node:crypto";
import { describe, expect, it, vi } from "vitest";
import { SquareReadClient, squareSourceHash, verifySquareWebhookSignature } from "@/lib/integrations/square-read.server";
import { parseSquareSource, SQUARE_API_VERSION } from "@/lib/integrations/square-source";

const config = { environment: "sandbox" as const, accessToken: "fake-square-token", merchantId: "MERCHANT_TEST", locationId: "LOCATION_TEST", currency: "USD", timeZone: "America/New_York" };
const from = "2026-10-22T00:00:00Z", to = "2026-10-23T00:00:00Z";
const base = { id: "ORDER_TEST", location_id: config.locationId, created_at: "2020-01-01T14:00:00Z", updated_at: "2026-10-22T20:00:00Z" };
const order = { ...base, state: "COMPLETED", closed_at: "2020-01-01T15:00:00Z", total_money: { amount: 2351, currency: "USD" }, total_tax_money: { amount: 151, currency: "USD" }, total_tip_money: { amount: 200, currency: "USD" }, net_amounts: { total_money: { amount: 1851, currency: "USD" } } };
const payment = { ...base, id: "PAYMENT_TEST", status: "COMPLETED", source_type: "CARD", order_id: order.id, amount_money: { amount: 2151, currency: "USD" }, total_money: { amount: 2351, currency: "USD" }, tip_money: { amount: 200, currency: "USD" }, refunded_money: { amount: 500, currency: "USD" } };
const refund = { ...base, id: "REFUND_TEST", status: "COMPLETED", payment_id: payment.id, amount_money: { amount: 500, currency: "USD" } };
const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });
function mockRequest(overrides: Partial<Record<string, unknown>> = {}) {
  return vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
    const url = new URL(String(input));
    if (url.pathname.includes("merchants")) return json({ merchant: { id: config.merchantId, country: "US", status: "ACTIVE", ...overrides.merchant as object } });
    if (url.pathname.includes("locations")) return json({ location: { id: config.locationId, merchant_id: config.merchantId, status: "ACTIVE", currency: "USD", timezone: config.timeZone, ...overrides.location as object } });
    if (url.pathname === "/v2/orders/search") return json(overrides.orders ?? { orders: [order] });
    if (url.pathname === "/v2/payments") return json(overrides.payments ?? { payments: [payment] });
    if (url.pathname === "/v2/refunds") return json(overrides.refunds ?? { refunds: [refund] });
    throw Error("Unexpected endpoint " + url.pathname + " " + init?.method);
  });
}

describe("Square read-only source protocol", () => {
  it("pins host/version, verifies merchant/location, preserves POS orders without numeric versions and reads late updates to older sales", async () => {
    const request = mockRequest(), rows = await new SquareReadClient(config, request).readWindow(from, to);
    expect(rows).toHaveLength(3); expect(rows[0].objectVersion).toBeNull(); expect(rows[0].facts.created_at).toBe("2020-01-01T14:00:00Z");
    expect(rows.map(r => r.kind)).toEqual(["order", "payment", "refund"]);
    for (const [input, init] of request.mock.calls) {
      expect(String(input)).toMatch(/^https:\/\/connect\.squareupsandbox\.com\//);
      expect(new Headers(init?.headers).get("Square-Version")).toBe(SQUARE_API_VERSION);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer fake-square-token");
      expect(init?.redirect).toBe("error"); expect(init?.cache).toBe("no-store");
      if (String(input).includes("orders/search")) expect(JSON.parse(String(init?.body))).toMatchObject({ location_ids: [config.locationId], query: { filter: { date_time_filter: { updated_at: { start_at: from, end_at: to } } }, sort: { sort_field: "UPDATED_AT" } } });
      else expect(init?.method).toBe("GET");
      if (/\/(payments|refunds)\?/.test(String(input))) { const q = new URL(String(input)).searchParams; expect(q.get("begin_time")).toBe("1970-01-01T00:00:00.000Z"); expect(q.get("updated_at_begin_time")).toBe(from); expect(q.get("updated_at_end_time")).toBe(to); }
    }
  });
  it("retains distinct order/payment/refund amounts and strips guest/card/receipt data", async () => {
    const request = mockRequest({ payments: { payments: [{ ...payment, card_details: { card: { last_4: "1111" } }, note: "PRIVATE GUEST", buyer_email_address: "fake@example.invalid", receipt_url: "https://example.invalid" }] } });
    const rows = await new SquareReadClient(config, request).readWindow(from, to);
    expect(rows[1].facts).toMatchObject({ total_money: { amount: 2351 }, refunded_money: { amount: 500 } });
    expect(JSON.stringify(rows)).not.toMatch(/PRIVATE GUEST|1111|buyer_email|receipt_url/);
    expect(rows[2].facts).toMatchObject({ amount_money: { amount: 500 } });
  });
  it("preserves unknown monetary fields as absent instead of invented zero totals", () => {
    const snapshot = parseSquareSource("order", { ...base, state: "DRAFT" }, config);
    expect(snapshot.facts).not.toHaveProperty("total_money");
  });
  it.each([
    { merchant: { id: "OTHER_MERCHANT" } }, { location: { merchant_id: "OTHER_MERCHANT" } },
    { location: { id: "OTHER_LOCATION" } }, { location: { status: "INACTIVE" } },
    { location: { currency: "EUR" } }, { location: { timezone: "UTC" } },
  ])("refuses an account/location mapping mismatch before sales reads: %j", async change => {
    const request = mockRequest(change); await expect(new SquareReadClient(config, request).readWindow(from, to)).rejects.toThrow(/approved scope/);
    expect(request.mock.calls.some(([u]) => String(u).includes("orders/search"))).toBe(false);
  });
  it.each([
    { ...order, location_id: "OTHER_LOCATION" }, { ...order, total_money: { amount: 9007199254740992, currency: "USD" } },
    { ...order, total_money: { amount: 1.25, currency: "USD" } }, { ...order, total_tax_money: { amount: 1, currency: "EUR" } },
    { ...order, updated_at: "2026-10-21T20:00:00Z" }, { ...order, updated_at: "not-a-date" },
  ])("rejects out-of-scope, unsafe or out-of-window facts: %j", async changed => {
    await expect(new SquareReadClient(config, mockRequest({ orders: { orders: [changed] } })).readWindow(from, to)).rejects.toThrow();
  });
  it("uses all original filters on pagination and deduplicates an exact repeated version", async () => {
    const request = mockRequest(); request.mockImplementation(async (input, init) => {
      const url = String(input);
      if (url.includes("merchants")) return json({ merchant: { id: config.merchantId, country: "US" } });
      if (url.includes("locations")) return json({ location: { id: config.locationId, merchant_id: config.merchantId, status: "ACTIVE", currency: "USD", timezone: config.timeZone } });
      if (url.includes("orders/search")) { const body = JSON.parse(String(init?.body)); expect(body.location_ids).toEqual([config.locationId]); expect(body.query.filter.date_time_filter.updated_at).toEqual({ start_at: from, end_at: to }); return json({ orders: [order], ...(body.cursor ? {} : { cursor: "page_2" }) }); }
      return json({});
    });
    expect(await new SquareReadClient(config, request).readWindow(from, to)).toHaveLength(1);
  });
  it.each([
    { orders: [order], cursor: "same_cursor" }, { orders: [order, { ...order, total_money: { amount: 42, currency: "USD" } }] },
    { orders: [order], errors: [{ code: "SCOPE_ERROR", detail: "secret should not be emitted" }] },
  ])("never accepts repeated cursors, conflicting versions or partial-error pages", async response => {
    await expect(new SquareReadClient(config, mockRequest({ orders: response })).readWindow(from, to)).rejects.toThrow();
  });
  it("keeps provider error payloads out of the thrown error and does not retry failed reads silently", async () => {
    const request = vi.fn(async () => json({ token: "provider-secret" }, 429));
    await expect(new SquareReadClient(config, request).readWindow(from, to)).rejects.toThrow("Square read request failed (429).");
    expect(request).toHaveBeenCalledTimes(1);
  });
  it("rejects future/oversized/reversed ranges and invalid configuration before transport", async () => {
    const request = mockRequest(), client = new SquareReadClient(config, request);
    for (const range of [[to, from], ["2026-08-01T00:00:00Z", to], ["2040-01-01T00:00:00Z", "2040-01-02T00:00:00Z"]]) await expect(client.readWindow(range[0], range[1])).rejects.toThrow();
    expect(request).not.toHaveBeenCalled();
    expect(() => new SquareReadClient({ ...config, accessToken: " " }, request)).toThrow();
    expect(() => new SquareReadClient({ ...config, environment: "other" as "sandbox" }, request)).toThrow();
  });
  it("hashes sanitized facts deterministically", () => { expect(squareSourceHash({ z: 1, a: [2] })).toBe(squareSourceHash({ a: [2], z: 1 })); });
});

describe("Square webhook signature", () => {
  const notificationUrl = "https://example.invalid/api/square?site=test", signatureKey = "fake-only-signature-key", rawBody = Buffer.from('{"event_id":"evt-test","name":"caf\u00e9"}');
  const signature = createHmac("sha256", signatureKey).update(notificationUrl).update(rawBody).digest("base64");
  it("checks exact URL and UTF-8 raw bytes with constant-length digest comparison", () => {
    expect(verifySquareWebhookSignature({ notificationUrl, signatureKey, rawBody, signature })).toBe(true);
    expect(verifySquareWebhookSignature({ notificationUrl: notificationUrl + "2", signatureKey, rawBody, signature })).toBe(false);
    expect(verifySquareWebhookSignature({ notificationUrl, signatureKey, rawBody: Buffer.from('{ "event_id":"evt-test","name":"caf\u00e9"}'), signature })).toBe(false);
  });
  it.each([null, "", "invalid", "A".repeat(43) + "="])("refuses absent/malformed/incorrect signatures", value => {
    expect(verifySquareWebhookSignature({ notificationUrl, signatureKey, rawBody, signature: value })).toBe(false);
  });
});
