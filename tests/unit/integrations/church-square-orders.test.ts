import { describe, expect, it, vi } from "vitest";
import {
  ChurchSquareOrderClient,
  type ChurchSquareOrderConfiguration,
} from "@/lib/integrations/church-square-orders.server";
import { projectChurchSquareResource } from "@/lib/integrations/church-square-order-projection";

const config = {
  environment: "production",
  accessToken: "test-secret-do-not-echo",
  merchantId: "merchant",
  locationId: "church",
} satisfies ChurchSquareOrderConfiguration;

const timestamps = {
  created_at: "2026-10-11T14:20:00Z",
  updated_at: "2026-10-11T14:30:00Z",
};
const cash = (amount: number) => ({ amount, currency: "USD" });
const location = {
  id: "church",
  merchant_id: "merchant",
  status: "ACTIVE",
  timezone: "America/New_York",
  currency: "USD",
  address: { address_line_1: "140 Church St", postal_code: "10007", country: "US" },
};
const order = {
  ...timestamps,
  id: "order-id",
  location_id: "church",
  state: "OPEN",
  version: 4,
  source: { name: "DoorDash" },
  total_money: cash(1300),
  net_amounts: { total_money: cash(1275) },
  total_tax_money: cash(100),
  total_discount_money: cash(25),
  line_items: [{
    uid: "item-1",
    catalog_object_id: "variation",
    name: "PRIVATE customer custom item",
    note: "PRIVATE customer instructions",
    quantity: "2.5",
    total_money: cash(1200),
    modifiers: [{ uid: "modifier-1", catalog_object_id: "mocha", name: "PRIVATE modifier text", total_price_money: cash(100) }],
  }],
  fulfillments: [{
    uid: "delivery-1",
    type: "DELIVERY",
    state: "PREPARED",
    delivery_details: {
      placed_at: "2026-10-11T14:20:00Z",
      deliver_at: "2026-10-11T14:45:00Z",
      ready_at: "2026-10-11T14:25:00Z",
      note: "PRIVATE delivery instructions",
      recipient: { display_name: "PRIVATE customer", address: { address_line_1: "PRIVATE address" } },
    },
  }],
  tenders: [{ type: "CARD", payment_id: "payment-id", amount_money: cash(1300), card_details: { card: { last_4: "0808" } } }],
  refunds: [{ id: "refund_id" }],
  customer_id: "PRIVATE customer ID",
};

const payment = {
  ...timestamps,
  id: "payment-id",
  location_id: "church",
  status: "COMPLETED",
  order_id: "order-id",
  source_type: "CARD",
  amount_money: cash(1100),
  total_money: cash(1300),
  tip_money: cash(200),
  refunded_money: cash(300),
  card_details: { card: { fingerprint: "PRIVATE fingerprint" } },
  is_offline_payment: true,
  offline_payment_details: { client_created_at: "2026-10-10T14:00:00Z" },
  processing_fee: [{ amount_money: cash(33), type: "INITIAL" }, { amount_money: cash(-8), type: "ADJUSTMENT" }],
};
const refund = {
  ...timestamps, id: "refund_id", location_id: "church", status: "COMPLETED",
  order_id: "order-id", payment_id: "payment-id", amount_money: cash(300), reason: "PRIVATE refund reason",
};
const invoice = {
  ...timestamps, id: "inv:0-square_invoice", location_id: "church", order_id: "order-id", status: "PARTIALLY_PAID", version: 1,
  sale_or_service_date: "2026-11-11",
  primary_recipient: { email_address: "PRIVATE email address" },
  description: "PRIVATE invoice notes",
  payment_requests: [
    { uid: "req-deposit", request_type: "DEPOSIT", computed_amount_money: cash(500), total_completed_amount_money: cash(500) },
    { uid: "req-balance", request_type: "BALANCE", due_date: "2026-11-11", computed_amount_money: cash(2000) },
  ],
};

function provider(overrides: Record<string, unknown> = {}) {
  const routes: Record<string, unknown> = {
    "/v2/merchants/merchant": { merchant: { id: "merchant", country: "US", status: "ACTIVE" } },
    "/v2/locations/church": { location },
    "/v2/orders/order-id": { order },
    "/v2/payments/payment-id": { payment },
    "/v2/refunds/refund_id": { refund },
    "/v2/invoices/inv%3A0-square_invoice": { invoice },
    "/v2/orders/search": { orders: [order], cursor: "" },
    ...overrides,
  };
  return vi.fn(async (...args: Parameters<typeof fetch>) => {
    const path = new URL(String(args[0])).pathname;
    const body = routes[path];
    return body === undefined ? new Response(null, { status: 404 })
      : body instanceof Response ? body : Response.json(body);
  });
}

describe("Square Church Street canonical order reads", () => {
  it("reads all relevant objects after one scope proof and retains only actionable facts", async () => {
    const request = provider();
    const client = new ChurchSquareOrderClient(config, request);
    const [sale, paid, refunded, catering] = await Promise.all([
      client.get("order", "order-id"), client.get("payment", "payment-id"),
      client.get("refund", "refund_id"), client.get("invoice", "inv:0-square_invoice"),
    ]);

    expect(sale).toMatchObject({
      kind: "order", id: "order-id", version: 4, sourceHint: "DOORDASH", totalCents: 1300,
      netTotalCents: 1275, taxCents: 100, discountCents: 25,
      lineItems: [{ variationId: "variation", quantity: "2.5", modifiers: [{ catalogModifierId: "mocha", totalCents: 100 }] }],
      fulfillments: [{ type: "DELIVERY", status: "PREPARED", readyAt: "2026-10-11T14:25:00Z", promisedAt: "2026-10-11T14:45:00Z" }],
      tenders: [{ paymentId: "payment-id" }], refundIds: ["refund_id"],
    });
    expect(paid).toMatchObject({
      status: "COMPLETED", amountCents: 1100, refundedCents: 300, orderId: "order-id",
      isOffline: true, offlineCreatedAt: "2026-10-10T14:00:00Z",
      processingFees: [{ amountCents: 33 }, { amountCents: -8 }],
    });
    expect(refunded).toMatchObject({ amountCents: 300, orderId: "order-id", paymentId: "payment-id" });
    expect(catering).toMatchObject({
      deposit: { state: "satisfied", dueCents: 500, completedCents: 500 },
      paymentRequests: [{ type: "DEPOSIT" }, { type: "BALANCE", dueDate: "2026-11-11", completedCents: null }],
    });
    expect(JSON.stringify([sale, paid, refunded, catering])).not.toMatch(/PRIVATE|0808|card_details|rawBody/);
    expect(request).toHaveBeenCalledTimes(6);
    expect(request.mock.calls.every(([url, init]) =>
      new URL(String(url)).origin === "https://connect.squareup.com" && init?.method === "GET"
        && init.redirect === "error" && new Headers(init.headers).get("Square-Version") === "2026-09-16",
    )).toBe(true);
  });

  it("rejects another store or an unexpected resource ID", async () => {
    const client = new ChurchSquareOrderClient(config, provider({
      "/v2/orders/order-id": { order: { ...order, location_id: "another-store" } },
      "/v2/payments/payment-id": { payment: { ...payment, id: "other-payment" } },
    }));
    await expect(client.get("order", "order-id")).rejects.toMatchObject({ code: "scope_mismatch" });
    await expect(client.get("payment", "payment-id")).rejects.toMatchObject({ code: "scope_mismatch" });
  });

  it("refuses the wrong physical site before reading commerce data and rejects forged routes", async () => {
    const request = provider({ "/v2/locations/church": { location: { ...location, address: { ...location.address, address_line_1: "42 Church St" } } } });
    const client = new ChurchSquareOrderClient(config, request);
    await expect(client.get("order", "../payments")).rejects.toMatchObject({ code: "invalid_input" });
    expect(request).toHaveBeenCalledTimes(0);
    await expect(client.get("order", "order-id")).rejects.toMatchObject({ code: "scope_mismatch" });
    expect(request).toHaveBeenCalledTimes(2);
  });

  it("searches a bounded updated window with exact location and treats the empty cursor as complete", async () => {
    const request = provider();
    const client = new ChurchSquareOrderClient(config, request);
    const result = await client.searchOrders({
      from: "2026-10-11T00:00:00Z", to: "2026-10-12T00:00:00Z", cursor: "previous",
    });
    expect(result.nextCursor).toBeNull();
    expect(result.orders.map(row => row.id)).toEqual(["order-id"]);
    const [url, init] = request.mock.calls.at(-1)!;
    expect(String(url)).toBe("https://connect.squareup.com/v2/orders/search");
    expect(init?.method).toBe("POST");
    expect(JSON.parse(String(init?.body))).toMatchObject({
      location_ids: ["church"], cursor: "previous",
      query: {
        filter: { date_time_filter: { updated_at: { start_at: "2026-10-11T00:00:00Z", end_at: "2026-10-12T00:00:00Z" } } },
        sort: { sort_field: "UPDATED_AT", sort_order: "ASC" },
      },
    });
    await expect(client.searchOrders({ from: "2026-10-01T00:00:00Z", to: "2026-10-12T00:00:00Z" })).rejects.toMatchObject({ code: "invalid_input" });
    await expect(client.searchOrders({ from: "2026-10-02T00:00:00Z", to: "2026-10-03T00:00:00Z" })).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("lists exact-location creation cohorts with an inclusive start and exclusive end", async () => {
    const from = "2026-10-11T14:20:00Z";
    const to = "2026-10-11T14:25:00.000000800Z";
    const request = provider({
      "/v2/payments": { payments: [payment, {
        ...payment, id: "just-inside", created_at: "2026-10-11T10:25:00.000000799-04:00",
      }, { ...payment, id: "excluded-at-end", created_at: "2026-10-11T10:25:00.000000800-04:00" }], cursor: "next+page=" },
      "/v2/refunds": { refunds: [refund], cursor: "" },
    });
    const client = new ChurchSquareOrderClient(config, request);
    const signal = new AbortController().signal;
    const [paymentPage, refundPage] = await Promise.all([
      client.listPayments({ from, to, cursor: "page+1=", direction: "DESC" }, signal),
      client.listRefunds({ from, to }, signal),
    ]);
    expect(paymentPage.nextCursor).toBe("next+page=");
    expect(paymentPage.payments.map(({ id }) => id)).toEqual(["payment-id", "just-inside"]);
    expect(refundPage).toMatchObject({ nextCursor: null, refunds: [{ id: "refund_id", amountCents: 300 }] });
    expect(JSON.stringify([paymentPage, refundPage])).not.toMatch(/PRIVATE|card_details|reason/);
    expect(request).toHaveBeenCalledTimes(4);
    const calls = request.mock.calls.map(([url, init]) => ({ url: new URL(String(url)), init }));
    const listed = calls.find(({ url }) => url.pathname === "/v2/payments")!;
    expect(Object.fromEntries(listed.url.searchParams)).toEqual({
      location_id: "church", begin_time: from, end_time: to, cursor: "page+1=", limit: "100", sort_order: "DESC",
    });
    expect(listed.init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
    expect(listed.init?.body).toBeUndefined();
    expect(calls.find(({ url }) => url.pathname === "/v2/refunds")?.url.searchParams.get("sort_order")).toBe("ASC");
  });

  it("fails closed on location, bounds, duplicate IDs, and cursor faults", async () => {
    const input = { from: "2026-10-11T00:00:00Z", to: "2026-10-12T00:00:00Z" };
    const client = new ChurchSquareOrderClient(config, provider({
      "/v2/payments": { payments: [payment, payment] },
      "/v2/refunds": { refunds: [{ ...refund, location_id: "other-location" }] },
    }));
    await expect(client.listPayments(input)).rejects.toMatchObject({ code: "invalid_response" });
    await expect(client.listRefunds(input)).rejects.toMatchObject({ code: "scope_mismatch" });
    const malformed = new ChurchSquareOrderClient(config, provider({
      "/v2/payments": { payments: [{ ...payment, created_at: "2026-10-10T23:59:59.999999999Z" }] },
      "/v2/refunds": { refunds: [], cursor: "same" },
    }));
    await expect(malformed.listPayments(input)).rejects.toMatchObject({ code: "invalid_response" });
    await expect(malformed.listRefunds({ ...input, cursor: "same" })).rejects.toMatchObject({ code: "invalid_response" });
    const wrongResult = new ChurchSquareOrderClient(config, provider({ "/v2/refunds": { payments: [] } }));
    await expect(wrongResult.listRefunds(input)).rejects.toMatchObject({ code: "invalid_response" });
    await expect(wrongResult.listPayments({ ...input, from: "2026-10-04T00:00:00Z" })).rejects.toMatchObject({ code: "invalid_input" });
  });

  it("uses the caller budget for activity reads", async () => {
    const mocked = provider();
    const request = vi.fn(async (input: Parameters<typeof fetch>[0], init?: RequestInit) => {
      if (new URL(String(input)).pathname === "/v2/payments") {
        expect(init?.signal).toBeInstanceOf(AbortSignal);
        return new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener("abort", () => reject(init.signal?.reason), { once: true });
        });
      }
      return mocked(input, init);
    });
    const abort = new AbortController();
    const client = new ChurchSquareOrderClient(config, request);
    const result = client.listPayments({ from: "2026-10-11T00:00:00Z", to: "2026-10-12T00:00:00Z" }, abort.signal);
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(3));
    abort.abort();
    await expect(result).rejects.toMatchObject({ code: "provider_unavailable" });
  });

  it("omits raw failure payloads and rejects unexpected currencies", async () => {
    const client = new ChurchSquareOrderClient(config, provider({
      "/v2/payments/payment-id": Response.json({ message: "sensitive response" }, { status: 403 }),
      "/v2/refunds/refund_id": { refund: { ...refund, amount_money: { amount: 11, currency: "CAD" } } },
    }));
    await expect(client.get("payment", "payment-id")).rejects.toMatchObject({
      message: "Square declined the read request.", code: "provider_unavailable", status: 403,
    });
    await expect(client.get("refund", "refund_id")).rejects.toMatchObject({ code: "invalid_resource" });
  });

  it("keeps only line classification and return presence from item and exchange details", () => {
    const scope = { locationId: "church" };
    const rawLine = order.line_items[0];
    const itemized = projectChurchSquareResource("order", {
      ...order,
      line_items: [
        { ...rawLine, item_type: "ITEM", quantity_unit: { measurement_unit: { custom_unit: { name: "PRIVATE_MEASURE" } } } },
        { ...rawLine, item_type: "FUTURE_TYPE", quantity_unit: null },
        { ...rawLine, item_type: null },
      ],
      returns: [{ source_order_id: "PRIVATE_EXCHANGE", return_line_items: [{ uid: "PRIVATE_RETURN" }] }],
    }, scope);
    expect(itemized).toMatchObject({
      lineItemsReported: true,
      hasReturns: true,
      lineItems: [
        { variationId: "variation", quantity: "2.5", itemType: "ITEM", hasQuantityUnit: true },
        { itemType: "FUTURE_TYPE", hasQuantityUnit: false },
        { itemType: null, hasQuantityUnit: false },
      ],
    });
    expect(JSON.stringify(itemized)).not.toMatch(/PRIVATE|quantity_unit|return_line_items|measurement_unit/);

    for (const [line_items, reported] of [[[], true], [null, false], [undefined, false]] as const) {
      expect(projectChurchSquareResource("order", { ...order, line_items, returns: [] }, scope))
        .toMatchObject({ lineItemsReported: reported, hasReturns: false, lineItems: [] });
    }
    expect(() => projectChurchSquareResource("order", {
      ...order, line_items: [{ ...rawLine, item_type: "arbitrary text" }],
    }, scope)).toThrow();
    expect(() => projectChurchSquareResource("order", {
      ...order, returns: Array.from({ length: 1001 }, () => ({})),
    }, scope)).toThrow();
  });

  it("distinguishes partial, unpaid and terminal invoice deposits", () => {
    const scope = { locationId: "church" };
    const deposit = invoice.payment_requests[0];
    for (const [amount, state] of [[0, "unpaid"], [499, "partial"], [500, "satisfied"]] as const) {
      const result = projectChurchSquareResource("invoice", {
        ...invoice, payment_requests: [{ ...deposit, total_completed_amount_money: cash(amount) }],
      }, scope);
      expect(result.deposit.state).toBe(state);
    }
    expect(projectChurchSquareResource("invoice", { ...invoice, status: "REFUNDED" }, scope).deposit.state).toBe("review_required");
    expect(projectChurchSquareResource("invoice", { ...invoice, payment_requests: [] }, scope).deposit.state).toBe("not_requested");
    expect(projectChurchSquareResource("invoice", { ...invoice, payment_requests: undefined }, scope).deposit.state).toBe("unknown");
    expect(projectChurchSquareResource("invoice", { ...invoice, payment_requests: [deposit, deposit] }, scope).deposit.state).toBe("review_required");
    const withoutVersion = projectChurchSquareResource("order", { ...order, version: undefined, source: { name: "a custom source" } }, scope);
    expect(withoutVersion).toMatchObject({ version: null, sourceHint: "UNKNOWN" });
  });
});
