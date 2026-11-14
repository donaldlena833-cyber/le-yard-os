import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  ChurchSquarePayoutClient, ChurchSquarePayoutReadError, churchSquarePayoutConfiguration,
  type ChurchSquarePayoutConfiguration,
} from "@/lib/integrations/church-square-payouts.server";
import { SQUARE_API_VERSION } from "@/lib/integrations/square-source";

const window = { from: "2026-11-07T16:00:00.000Z", to: "2026-11-14T16:00:00.000Z" };
const config: ChurchSquarePayoutConfiguration = {
  environment: "production", accessToken: "SQUARE_SECRET_FOR_TESTS", merchantId: "CHURCH_MERCHANT", locationId: "CHURCH_SITE",
};
const church = {
  id: config.locationId,
  merchant_id: config.merchantId,
  status: "ACTIVE",
  currency: "USD",
  timezone: "America/New_York",
  address: { address_line_1: "140 Church St.", postal_code: "10007-0456", country: "US" },
};
const payout = {
  id: "po_example",
  status: "PAID",
  location_id: config.locationId,
  created_at: "2026-11-12T12:00:00Z",
  updated_at: "2026-11-12T23:00:00Z",
  arrival_date: "2026-11-14",
  amount_money: { amount: 10_273, currency_code: "USD" },
  destination: { type: "BANK_ACCOUNT", id: "ACCOUNT_SECRET_FOR_TESTS" },
  end_to_end_id: "BANK_REFERENCE_SECRET_FOR_TESTS",
  payout_fee: [{ amount_money: { amount: 100, currency_code: "USD" }, type: "TRANSFER_FEE" }],
};

function mockSquare(
  reply: () => Response | Promise<Response> = () => Response.json({ payouts: [payout] }),
  location = church,
  detail: { payout?: () => Response; entries?: () => Response } = {},
) {
  return vi.fn<typeof fetch>(async (resource) => {
    switch (new URL(String(resource)).pathname) {
      case `/v2/merchants/${config.merchantId}`:
        return Response.json({ merchant: { id: config.merchantId, country: "US", currency: "USD", status: "ACTIVE" } });
      case `/v2/locations/${config.locationId}`:
        return Response.json({ location });
      case "/v2/payouts":
        return reply();
      case `/v2/payouts/${payout.id}`:
        return detail.payout?.() ?? Response.json({ payout: { ...payout, type: "BATCH" } });
      case `/v2/payouts/${payout.id}/payout-entries`:
        return detail.entries?.() ?? Response.json({});
      default:
        throw new Error("Unexpected mock provider call");
    }
  });
}

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(new Date(window.to)));
afterEach(() => {
  vi.unstubAllEnvs();
  vi.useRealTimers();
});

describe("Church Street Square payout entries", () => {
  const charge = {
    id: "poe_charge", payout_id: payout.id, type: "CHARGE", effective_at: "2026-11-10T09:00:00-05:00",
    gross_amount_money: { amount: 100, currency: "USD" },
    fee_amount_money: { amount: 19, currency_code: "USD" }, net_amount_money: { amount: 81, currency_code: "USD" },
    type_charge_details: { payment_id: "PAYMENT_SECRET_FOR_TESTS" },
  };
  const refund = {
    id: "poe_refund", payout_id: payout.id, type: "REFUND", effective_at: "2026-11-11T16:00:00Z",
    gross_amount_money: { amount: -50, currency_code: "USD" },
    fee_amount_money: { amount: -2, currency_code: "USD" }, net_amount_money: { amount: -48, currency_code: "USD" },
    type_refund_details: { refund_id: "REFUND_SECRET_FOR_TESTS" },
  };

  function paths(request: ReturnType<typeof mockSquare>) {
    return request.mock.calls.map(([input]) => new URL(String(input)).pathname);
  }

  it("verifies the seller and exact payout before projecting signed USD entry facts and exact transaction IDs", async () => {
    const request = mockSquare(undefined, undefined, { entries: () => Response.json({
      payout_entries: [refund, charge, {
        id: "poe_fee", payout_id: payout.id, type: "DEPOSIT_FEE",
        gross_amount_money: { amount: -5, currency_code: "USD" }, fee_amount_money: { amount: 0, currency: "USD" },
      }], cursor: "SECRET_FOR_TESTS_CURSOR",
    }) });
    await expect(new ChurchSquarePayoutClient(config, request).getPayoutEntries(payout.id)).resolves.toEqual({
      payout: { id: payout.id, payoutType: "BATCH", status: "PAID", amountCents: 10_273,
        createdAt: payout.created_at, updatedAt: payout.updated_at, arrivalDate: payout.arrival_date },
      entries: [
        { reference: refund.id, type: "REFUND", effectiveAt: refund.effective_at, grossCents: -50, feeCents: -2, netCents: -48,
          transaction: { kind: "refund", refundId: "REFUND_SECRET_FOR_TESTS", paymentId: null } },
        { reference: charge.id, type: "CHARGE", effectiveAt: charge.effective_at, grossCents: 100, feeCents: 19, netCents: 81,
          transaction: { kind: "charge", paymentId: "PAYMENT_SECRET_FOR_TESTS" } },
        { reference: "poe_fee", type: "DEPOSIT_FEE", effectiveAt: null, grossCents: -5, feeCents: 0, netCents: null },
      ], hasMore: true,
    });
    expect(paths(request)).toEqual([
      `/v2/merchants/${config.merchantId}`, `/v2/locations/${config.locationId}`, `/v2/payouts/${payout.id}`,
      `/v2/payouts/${payout.id}/payout-entries`,
    ]);
    const [payoutRequest, entriesRequest] = request.mock.calls.slice(-2);
    expect(new URL(String(payoutRequest[0])).search).toBe("");
    expect(Object.fromEntries(new URL(String(entriesRequest[0])).searchParams)).toEqual({ sort_order: "DESC", limit: "50" });
    expect(entriesRequest[1]?.signal).toBe(payoutRequest[1]?.signal);
    expect(entriesRequest[1]).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
  });

  it("reads a refund's exact payment link and keeps unrelated nested details out of the projection", async () => {
    const request = mockSquare(undefined, undefined, { entries: () => Response.json({ payout_entries: [{
      ...refund,
      type_charge_details: charge.type_charge_details,
      type_refund_details: { refund_id: "REFUND_A", payment_id: "PAYMENT_A", private_detail: "PRIVATE_NESTED" },
    }] }) });
    const detail = await new ChurchSquarePayoutClient(config, request).getPayoutEntries(payout.id);
    expect(detail?.entries[0]?.transaction).toEqual({ kind: "refund", refundId: "REFUND_A", paymentId: "PAYMENT_A" });
    expect(JSON.stringify(detail)).not.toMatch(/PRIVATE_NESTED|PAYMENT_SECRET_FOR_TESTS/);
  });

  it.each([
    { ...charge, type_charge_details: { payment_id: "wrong/path" } },
    { ...charge, type_charge_details: { payment_id: 123 } },
    { ...charge, type_charge_details: null, type_refund_details: refund.type_refund_details },
    { ...refund, type_refund_details: { payment_id: "PAYMENT_A" } },
    { ...refund, type_refund_details: { refund_id: "REFUND_A", payment_id: "wrong/path" } },
    { ...charge, type: "PROCESSING_FEE" },
  ])("keeps amounts when exact transaction identity is missing, invalid, or the entry is an adjustment", async (entry) => {
    const request = mockSquare(undefined, undefined, { entries: () => Response.json({ payout_entries: [entry] }) });
    const detail = await new ChurchSquarePayoutClient(config, request).getPayoutEntries(payout.id);
    expect(detail?.entries).toEqual([{
      reference: entry.id, type: entry.type, effectiveAt: entry.effective_at,
      grossCents: entry.gross_amount_money.amount, feeCents: entry.fee_amount_money.amount, netCents: entry.net_amount_money.amount,
    }]);
  });

  it("returns an eligible negative SIMPLE withdrawal with no component request, as Square specifies", async () => {
    const request = mockSquare(undefined, undefined, {
      payout: () => Response.json({ payout: {
        ...payout, type: "SIMPLE", amount_money: { amount: -100, currency_code: "USD" }, created_at: window.from,
      } }),
    });
    await expect(new ChurchSquarePayoutClient(config, request).getPayoutEntries(payout.id)).resolves.toMatchObject({
      payout: { payoutType: "SIMPLE", amountCents: -100, createdAt: window.from }, entries: [], hasMore: false,
    });
    expect(paths(request)).toHaveLength(3);
  });

  it("retains provider entries from an unrecognized payout type without treating it as BATCH", async () => {
    const request = mockSquare(undefined, undefined, {
      payout: () => Response.json({ payout: { ...payout, type: "FUTURE_TYPE" } }),
      entries: () => Response.json({ payout_entries: [charge] }),
    });
    await expect(new ChurchSquarePayoutClient(config, request).getPayoutEntries(payout.id)).resolves.toMatchObject({
      payout: { payoutType: "UNKNOWN" }, entries: [{ reference: charge.id }], hasMore: false,
    });
  });

  it.each([
    ["a missing payout", () => Response.json({ errors: [{ detail: "SECRET_FOR_TESTS" }] }, { status: 404 })],
    ["a different site", () => Response.json({ payout: { ...payout, location_id: "OTHER_LOCATION" } })],
    ["an older payout", () => Response.json({ payout: { ...payout, created_at: "2026-11-07T15:59:59.999Z" } })],
    ["a future payout", () => Response.json({ payout: { ...payout, created_at: "2026-11-14T16:00:00.001Z" } })],
  ])("returns no information or entries for %s", async (_label, get) => {
    const request = mockSquare(undefined, undefined, { payout: get });
    await expect(new ChurchSquarePayoutClient(config, request).getPayoutEntries(payout.id)).resolves.toBeNull();
    expect(paths(request)).toHaveLength(3);
  });

  it("rejects malformed input, wrong seller and mismatched parent before looking up entries", async () => {
    const invalid = mockSquare();
    await expect(new ChurchSquarePayoutClient(config, invalid).getPayoutEntries("../../wrong")).rejects.toMatchObject({ code: "invalid_input" });
    expect(invalid).not.toHaveBeenCalled();
    const otherSeller = mockSquare(undefined, { ...church, merchant_id: "OTHER_MERCHANT" });
    await expect(new ChurchSquarePayoutClient(config, otherSeller).getPayoutEntries(payout.id)).rejects.toMatchObject({ code: "scope_mismatch" });
    expect(paths(otherSeller)).toHaveLength(2);
    const parent = mockSquare(undefined, undefined, { payout: () => Response.json({ payout: { ...payout, id: "WRONG" } }) });
    await expect(new ChurchSquarePayoutClient(config, parent).getPayoutEntries(payout.id)).rejects.toMatchObject({ code: "scope_mismatch" });
    expect(paths(parent)).toHaveLength(3);
  });

  it.each([
    ["wrong payout", { payout_entries: [{ ...charge, payout_id: "OTHER_PAYOUT" }] }, "scope_mismatch"],
    ["duplicate IDs", { payout_entries: [charge, { ...refund, id: charge.id }] }, "scope_mismatch"],
    ["foreign currency", { payout_entries: [{ ...charge, gross_amount_money: { amount: 91, currency_code: "EUR" } }] }, "invalid_response"],
    ["conflicting currencies", { payout_entries: [{ ...charge, fee_amount_money: { amount: 91, currency: "USD", currency_code: "EUR" } }] }, "invalid_response"],
    ["fractional integer cents", { payout_entries: [{ ...charge, net_amount_money: { amount: 2.5, currency: "USD" } }] }, "invalid_response"],
    ["invalid effective date", { payout_entries: [{ ...charge, effective_at: "2026-11-12" }] }, "invalid_response"],
    ["more than 50 entries", { payout_entries: Array.from({ length: 51 }, (_, index) => ({ ...charge, id: `ROW_${index}` })) }, "invalid_response"],
  ])("rejects %s without returning a partial response", async (_label, body, code) => {
    const request = mockSquare(undefined, undefined, { entries: () => Response.json(body) });
    await expect(new ChurchSquarePayoutClient(config, request).getPayoutEntries(payout.id)).rejects.toMatchObject({ code });
  });

  it.each([401, 403, 404, 429])("preserves safe HTTP %s from entry collection failures", async (status) => {
    const request = mockSquare(undefined, undefined, { entries: () => Response.json({ detail: "SECRET_FOR_TESTS" }, { status }) });
    const result = new ChurchSquarePayoutClient(config, request).getPayoutEntries(payout.id);
    await expect(result).rejects.toMatchObject({ code: "provider_unavailable", status });
    await expect(result).rejects.not.toThrow(/SECRET_FOR_TESTS/);
  });
});

describe("Church Street Square payout client", () => {
  it("uses the configured location and exact creation bounds, projects signed USD and returns only allowlisted payout facts", async () => {
    const request = mockSquare(() => Response.json({ payouts: [
      payout,
      {
        id: "po_debit", location_id: config.locationId, status: "SENT", created_at: "2026-11-13T05:00:00-05:00",
        amount_money: { amount: -109, currency: "USD" }, destination: { id: "card" },
      },
      { id: "po_unspecified", location_id: config.locationId, status: "FUTURE_STATE", created_at: window.from },
    ], cursor: "provider next+page" }));
    const result = await new ChurchSquarePayoutClient(config, request).listPayouts({ ...window, cursor: "prior+page=" });
    expect(result).toEqual({ nextCursor: "provider next+page", payouts: [
      { id: "po_debit", status: "SENT", amountCents: -109, createdAt: "2026-11-13T05:00:00-05:00", updatedAt: null, arrivalDate: null },
      { id: payout.id, status: "PAID", amountCents: 10_273, createdAt: payout.created_at, updatedAt: payout.updated_at, arrivalDate: payout.arrival_date },
      { id: "po_unspecified", status: "UNKNOWN", amountCents: null, createdAt: window.from, updatedAt: null, arrivalDate: null },
    ] });
    const providerURLs = request.mock.calls.map(([url]) => new URL(String(url)));
    expect(providerURLs.map((url) => url.pathname)).toEqual(["/v2/merchants/CHURCH_MERCHANT", "/v2/locations/CHURCH_SITE", "/v2/payouts"]);
    expect(Object.fromEntries(providerURLs[2].searchParams)).toEqual({
      location_id: config.locationId, begin_time: window.from, end_time: window.to, sort_order: "DESC", limit: "50", cursor: "prior+page=",
    });
    for (const [url, init] of request.mock.calls) {
      expect(new URL(String(url)).host).toBe("connect.squareup.com");
      expect(init).toMatchObject({ method: "GET", cache: "no-store", redirect: "error" });
      expect(init?.signal).toBeInstanceOf(AbortSignal);
      expect(new Headers(init?.headers).get("Square-Version")).toBe(SQUARE_API_VERSION);
    }
  });

  it("returns an empty page in sandbox and does not assume anything about payouts at the site", async () => {
    const request = mockSquare(() => Response.json({ cursor: "" }));
    await expect(new ChurchSquarePayoutClient({ ...config, environment: "sandbox" }, request).listPayouts(window))
      .resolves.toEqual({ payouts: [], nextCursor: null });
    expect(request.mock.calls.every(([url]) => new URL(String(url)).host === "connect.squareupsandbox.com")).toBe(true);
  });

  it.each([
    { ...window, from: "2026-11-06T16:00:00.000Z" },
    { ...window, to: "2026-11-14T16:00:00.001Z" },
    { ...window, to: window.from },
    { ...window, cursor: "invalid\u0000cursor" },
  ])("rejects invalid or expired-forward boundaries before a provider call", async (input) => {
    const request = mockSquare();
    await expect(new ChurchSquarePayoutClient(config, request).listPayouts(input)).rejects.toMatchObject({ code: "invalid_input" });
    expect(request).not.toHaveBeenCalled();
  });

  it.each([
    { ...church, merchant_id: "OTHER_MERCHANT" },
    { ...church, address: { ...church.address, address_line_1: "858 Ninth Avenue" } },
  ])("does not fetch payouts when production merchant or physical site verification fails", async (location) => {
    const request = mockSquare(undefined, location);
    await expect(new ChurchSquarePayoutClient(config, request).listPayouts(window)).rejects.toMatchObject({ code: "scope_mismatch" });
    expect(request.mock.calls.map(([url]) => new URL(String(url)).pathname)).not.toContain("/v2/payouts");
  });

  it.each([
    ["wrong location", { payouts: [{ ...payout, location_id: "OTHER_SITE" }] }, "scope_mismatch"],
    ["wrong currency", { payouts: [{ ...payout, amount_money: { amount: 100, currency_code: "EUR" } }] }, "invalid_response"],
    ["conflicting currencies", { payouts: [{ ...payout, amount_money: { amount: 100, currency: "EUR", currency_code: "USD" } }] }, "invalid_response"],
    ["fractional money", { payouts: [{ ...payout, amount_money: { amount: 100.5, currency_code: "USD" } }] }, "invalid_response"],
    ["unsafe integer money", { payouts: [{ ...payout, amount_money: { amount: Number.MAX_SAFE_INTEGER + 1, currency_code: "USD" } }] }, "invalid_response"],
    ["out-of-window date", { payouts: [{ ...payout, created_at: "2026-11-07T15:59:59.999Z" }] }, "invalid_response"],
    ["duplicate ID", { payouts: [payout, payout] }, "invalid_response"],
    ["over page limit", { payouts: Array.from({ length: 51 }, (_, i) => ({ ...payout, id: `po_${i}` })) }, "invalid_response"],
    ["invalid cursor", { payouts: [payout], cursor: "\u202Ecursor" }, "invalid_response"],
    ["mixed with provider errors", { payouts: [payout], errors: [{ detail: "ACCOUNT_SECRET_FOR_TESTS" }] }, "invalid_response"],
  ])("rejects %s without returning partial data or provider details", async (_label, body, code) => {
    const request = mockSquare(() => Response.json(body));
    const list = new ChurchSquarePayoutClient(config, request).listPayouts(window);
    await expect(list).rejects.toMatchObject({ code });
    await expect(list).rejects.not.toThrow(/SECRET_FOR_TESTS/);
  });

  it("rejects a provider cursor identical to the preceding-page cursor", async () => {
    const request = mockSquare(() => Response.json({ payouts: [payout], cursor: "same" }));
    await expect(new ChurchSquarePayoutClient(config, request).listPayouts({ ...window, cursor: "same" }))
      .rejects.toMatchObject({ code: "invalid_response" });
  });

  it.each([401, 403, 429, 500])("returns an opaque typed HTTP %s error from the payout endpoint", async (status) => {
    const request = mockSquare(() => Response.json({ errors: [{ secret: config.accessToken }] }, { status }));
    const list = new ChurchSquarePayoutClient(config, request).listPayouts(window);
    await expect(list).rejects.toBeInstanceOf(ChurchSquarePayoutReadError);
    await expect(list).rejects.toMatchObject({ code: "provider_unavailable", status });
    await expect(list).rejects.not.toThrow(/SECRET_FOR_TESTS/);
  });

  it("rejects oversized responses and does not reveal transport details", async () => {
    const large = mockSquare(() => new Response("x".repeat(1024 * 1024 + 1)));
    await expect(new ChurchSquarePayoutClient(config, large).listPayouts(window)).rejects.toMatchObject({ code: "response_too_large" });
    const broken = mockSquare(() => { throw new Error(config.accessToken); });
    const list = new ChurchSquarePayoutClient(config, broken).listPayouts(window);
    await expect(list).rejects.toMatchObject({ code: "provider_unavailable" });
    await expect(list).rejects.not.toThrow(/SECRET_FOR_TESTS/);
  });

  it("reuses the existing production Operations Church Square configuration gate", () => {
    vi.stubEnv("VERCEL_ENV", "production");
    vi.stubEnv("SQUARE_CHURCH_ACCESS_TOKEN", config.accessToken);
    vi.stubEnv("SQUARE_CHURCH_MERCHANT_ID", config.merchantId);
    vi.stubEnv("SQUARE_CHURCH_LOCATION_ID", config.locationId);
    vi.stubEnv("LE_YARD_CHURCH_SQUARE_ORDER_READ_ENABLED", "false");
    expect(churchSquarePayoutConfiguration()).toBeUndefined();
    vi.stubEnv("LE_YARD_CHURCH_SQUARE_ORDER_READ_ENABLED", "true");
    expect(churchSquarePayoutConfiguration()).toEqual(config);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect(churchSquarePayoutConfiguration()).toBeUndefined();
  });
});
