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
) {
  return vi.fn(async (resource: RequestInfo | URL, _init?: RequestInit) => {
    switch (new URL(String(resource)).pathname) {
      case `/v2/merchants/${config.merchantId}`:
        return Response.json({ merchant: { id: config.merchantId, country: "US", currency: "USD", status: "ACTIVE" } });
      case `/v2/locations/${config.locationId}`:
        return Response.json({ location });
      case "/v2/payouts":
        return reply();
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
