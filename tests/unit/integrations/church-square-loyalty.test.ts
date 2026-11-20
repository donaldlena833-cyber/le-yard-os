import { afterEach, describe, expect, it, vi } from "vitest";
import { ChurchSquareLoyaltyClient, readChurchSquareLoyalty } from "@/lib/integrations/church-square-loyalty.server";
import { loyaltyBirthday } from "@/lib/integrations/church-square-loyalty";
import type { SquareCountConfiguration } from "@/lib/integrations/square-counts.server";

const config: SquareCountConfiguration = {
  environment: "production", accessToken: "synthetic-secret", merchantId: "merchant", locationId: "church",
  currency: "USD", timeZone: "America/New_York",
  address: { street: "140 Church Street", postalCode: "10007", country: "US" },
};
const program = { id: "program", status: "ACTIVE", location_ids: ["church"], reward_tiers: [{ id: "tier", name: "Coffee", points: 9 }] };
const account = { id: "account", program_id: "program", customer_id: "customer", balance: 5,
  lifetime_points: 15, mapping: { phone_number: "+12125550100" }, enrolled_at: "2026-11-20T14:00:00Z" };

function provider(overrides: Record<string, unknown | Response> = {}) {
  const fixtures: Record<string, unknown | Response> = {
    "/v2/merchants/merchant": { merchant: { id: "merchant", country: "US", currency: "USD", status: "ACTIVE" } },
    "/v2/locations/church": { location: { id: "church", merchant_id: "merchant", status: "ACTIVE", currency: "USD", timezone: "America/New_York", address: { address_line_1: "140 Church St", postal_code: "10007", country: "US" } } },
    "/v2/loyalty/programs/main": { program },
    "/v2/loyalty/accounts/search": { loyalty_accounts: [account], cursor: "page2" },
    "/v2/customers/bulk-retrieve": { responses: { customer: { customer: { id: "customer", given_name: "Emma", family_name: "Test", birthday: "1987-02-14", email_address: "private@example.invalid", note: "PRIVATE NOTE", address: { address_line_1: "PRIVATE HOME" } } } } },
    ...overrides,
  };
  return vi.fn<typeof fetch>(async (url) => {
    const value = fixtures[new URL(String(url)).pathname];
    if (value === undefined) throw new Error("Unexpected provider request");
    return value instanceof Response ? value : Response.json(value);
  });
}

afterEach(() => vi.unstubAllEnvs());

describe("Square loyalty read boundary", () => {
  it("reads scoped accounts and returns only the allowed profile fields", async () => {
    const request = provider();
    const result = await new ChurchSquareLoyaltyClient(config, request).read();
    expect(result.status).toBe("active");
    expect(result.members[0]).toMatchObject({ name: "Emma Test", points: 5, birthday: "02-14", phoneSuffix: "0100", nextReward: { name: "Coffee", pointsRemaining: 4 } });
    expect(result.cursor).toBe("page2");
    expect(JSON.stringify(result)).not.toMatch(/1987|PRIVATE|example\.invalid|12125550100|synthetic-secret/);
    for (const [, init] of request.mock.calls) {
      expect(init?.cache).toBe("no-store");
      expect(init?.redirect).toBe("error");
    }
  });
  it("refuses a program at a different location before reading accounts", async () => {
    const request = provider({ "/v2/loyalty/programs/main": { program: { ...program, location_ids: ["elsewhere"] } } });
    await expect(new ChurchSquareLoyaltyClient(config, request).read()).rejects.toMatchObject({ reason: "not_configured" });
    expect(request.mock.calls.some(([url]) => String(url).includes("accounts"))).toBe(false);
  });
  it("refuses merchant/location scope drift before reading private loyalty data", async () => {
    const request = provider({ "/v2/locations/church": { location: { id: "other" } } });
    await expect(new ChurchSquareLoyaltyClient(config, request).read()).rejects.toThrow();
    expect(request.mock.calls.some(([url]) => String(url).includes("loyalty"))).toBe(false);
  });
  it("does not treat an inactive program as ready", async () => {
    const request = provider({ "/v2/loyalty/programs/main": { program: { ...program, status: "INACTIVE" } } });
    expect((await new ChurchSquareLoyaltyClient(config, request).read()).status).toBe("inactive");
    expect(request.mock.calls.some(([url]) => String(url).includes("accounts"))).toBe(false);
  });
  it("checks readiness without retrieving any customer or account data", async () => {
    const request = provider();
    expect(await new ChurchSquareLoyaltyClient(config, request).readiness()).toBe("active");
    expect(request.mock.calls).toHaveLength(3);
    expect(request.mock.calls.every(([url]) => !String(url).includes("customers") && !String(url).includes("accounts"))).toBe(true);
  });
  it("preserves points while making unavailable customer profiles explicit", async () => {
    const request = provider({ "/v2/customers/bulk-retrieve": new Response(null, { status: 403 }) });
    const result = await new ChurchSquareLoyaltyClient(config, request).read();
    expect(result.profilesComplete).toBe(false);
    expect(result.members[0]).toMatchObject({ name: "Loyalty member", birthday: null, profileAvailable: false, points: 5 });
  });
  it("does not attach a response for another customer", async () => {
    const result = await new ChurchSquareLoyaltyClient(config, provider({ "/v2/customers/bulk-retrieve": { responses: { customer: { customer: { id: "different", given_name: "Someone else" } } } } })).read();
    expect(result.members[0].profileAvailable).toBe(false);
    expect(JSON.stringify(result)).not.toContain("Someone else");
  });
  it("rejects a foreign program account", async () => {
    await expect(new ChurchSquareLoyaltyClient(config, provider({ "/v2/loyalty/accounts/search": { loyalty_accounts: [{ ...account, program_id: "other" }] } })).read()).rejects.toThrow();
  });
  it("passes exact search and pagination to Square in a bounded POST", async () => {
    const request = provider();
    await new ChurchSquareLoyaltyClient(config, request).read({ phone: "+12125550100", cursor: "page2" });
    const call = request.mock.calls.find(([url]) => String(url).endsWith("/accounts/search"))!;
    expect(JSON.parse(String(call[1]?.body))).toEqual({ limit: 20, cursor: "page2", query: { mappings: [{ phone_number: "+12125550100" }] } });
  });
  it("rejects a body above the provider response limit", async () => {
    await expect(new ChurchSquareLoyaltyClient(config, provider({ "/v2/loyalty/programs/main": new Response("{}", { headers: { "content-length": "1048577" } }) })).read()).rejects.toThrow();
  });
  it("keeps negative balances and identifies a shared seller program", async () => {
    const result = await new ChurchSquareLoyaltyClient(config, provider({
      "/v2/loyalty/programs/main": { program: { ...program, location_ids: ["church", "second"] } },
      "/v2/loyalty/accounts/search": { loyalty_accounts: [{ ...account, balance: -2 }] },
    })).read();
    expect(result.program?.sharedAcrossLocations).toBe(true);
    expect(result.members[0].nextReward?.pointsRemaining).toBe(11);
  });
  it("does not use production credentials outside the production Operations surface", async () => {
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await readChurchSquareLoyalty()).status).toBe("not_configured");
  });
  it("supports unknown birth years and rejects invalid month/day values", () => {
    expect(loyaltyBirthday("0000-02-29")).toBe("02-29");
    expect(loyaltyBirthday("1987-02-30")).toBeNull();
    expect(loyaltyBirthday("1987-13-01")).toBeNull();
  });
});
