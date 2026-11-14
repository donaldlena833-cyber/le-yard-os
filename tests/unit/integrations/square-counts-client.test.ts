import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SquareCountClient, type SquareCountConfiguration, type SquarePhysicalCountInput } from "@/lib/integrations/square-counts.server";
import { SQUARE_API_VERSION } from "@/lib/integrations/square-source";

const now = "2026-11-14T14:50:00.000Z";
const occurredAt = "2026-11-14T14:48:02.000Z";
const config: SquareCountConfiguration = {
  environment: "production",
  accessToken: "TOKEN_NOT_IN_ERRORS",
  locationId: "CHURCH_LOCATION",
  merchantId: "CHURCH_MERCHANT",
  timeZone: "America/New_York",
  currency: "USD",
  address: { street: "140 Church Street", postalCode: "10007", country: "US" },
};
const input: SquarePhysicalCountInput = {
  variationId: "CROISSANT_VARIATION",
  quantity: 0,
  occurredAt,
  requestId: "d0ecfc05-172f-423c-aa78-96d9ca236c2f",
  teamMemberId: "CHEF_TEAM_ID",
};
const variationData = { item_id: "CROISSANT_ITEM", name: "Regular", track_inventory: true };
const baseParent = { type: "ITEM", id: "CROISSANT_ITEM", item_data: { name: "Croissant" } };
const baseLocation = {
  id: config.locationId, merchant_id: config.merchantId, status: "ACTIVE",
  currency: config.currency, timezone: config.timeZone,
  address: { address_line_1: "140 Church St.", postal_code: "10007-1234", country: "US" },
};
const physicalCount = {
  id: "SQUARE_PHYSICAL_1",
  catalog_object_id: input.variationId,
  catalog_object_type: "ITEM_VARIATION",
  location_id: config.locationId,
  reference_id: input.requestId,
  state: "IN_STOCK",
  quantity: "0.00000",
  occurred_at: "2026-11-14T09:48:02-05:00",
  team_member_id: input.teamMemberId,
};
const currentCount = {
  catalog_object_id: input.variationId,
  catalog_object_type: "ITEM_VARIATION",
  location_id: config.locationId,
  state: "IN_STOCK",
  quantity: "8",
  calculated_at: "2026-11-14T14:49:00Z",
};
const urls = {
  catalog: "/v2/catalog/list",
  write: "/v2/inventory/changes/batch-create",
  history: "/v2/inventory/changes/batch-retrieve",
  current: "/v2/inventory/counts/batch-retrieve",
};
const change = (count: object = physicalCount) => ({ type: "PHYSICAL_COUNT", physical_count: count });
const respond = (value: unknown, status = 200) => new Response(JSON.stringify(value), { status });

function mockSquare(options: {
  location?: typeof baseLocation;
  variation?: Record<string, unknown>;
  parent?: object;
  catalog?: (search: URLSearchParams) => Response;
  write?: () => Response | Promise<Response>;
  history?: (request: RequestInit | undefined) => Response | Promise<Response>;
  current?: (request: RequestInit | undefined) => Response | Promise<Response>;
} = {}) {
  return vi.fn(async (resource: RequestInfo | URL, request?: RequestInit) => {
    const url = new URL(String(resource));
    if (url.pathname === `/v2/merchants/${config.merchantId}`) {
      return respond({ merchant: { id: config.merchantId, country: "US" } });
    }
    if (url.pathname === `/v2/locations/${config.locationId}`) {
      return respond({ location: options.location ?? baseLocation });
    }
    if (url.pathname === `/v2/catalog/object/${input.variationId}`) {
      expect(url.searchParams.get("include_related_objects")).toBe("true");
      return respond({
        object: { type: "ITEM_VARIATION", id: input.variationId, item_variation_data: variationData, ...options.variation },
        related_objects: [options.parent ?? baseParent],
      });
    }
    if (url.pathname === urls.catalog) return options.catalog?.(url.searchParams) ?? respond({});
    if (url.pathname === urls.write) return options.write?.() ?? respond({ counts: [{ ...currentCount, quantity: "0" }] });
    if (url.pathname === urls.history) return options.history?.(request) ?? respond({ changes: [change()] });
    if (url.pathname === urls.current) return options.current?.(request) ?? respond({ counts: [currentCount] });
    throw new Error("Unexpected request path");
  });
}

function requestsTo(mock: ReturnType<typeof mockSquare>, path: string) {
  return mock.mock.calls.filter(([resource]) => new URL(String(resource)).pathname === path);
}

beforeEach(() => vi.useFakeTimers({ toFake: ["Date"] }).setSystemTime(new Date(now)));
afterEach(() => vi.useRealTimers());

describe("Square physical count client", () => {
  it("lists only tracked, whole variations with a live parent at the verified location across pages", async () => {
    const row = (id: string, overrides?: Record<string, unknown>) => ({
      id, type: "ITEM_VARIATION", item_variation_data: variationData, ...overrides,
    });
    const cafeItem = {
      ...baseParent, item_data: { ...baseParent.item_data, name: " Croissant\u0000 Plate  ", variations: [
        row("TRACKED", { item_variation_data: { ...variationData, name: "With\u202E jam" } }),
        row("UNTRACKED_HERE", { item_variation_data: { ...variationData, location_overrides: [
          { location_id: config.locationId, track_inventory: false },
        ] } }),
        row("ANOTHER_LOCATION", { absent_at_location_ids: [config.locationId] }),
        row("NOT_WHOLE", { item_variation_data: { ...variationData, measurement_unit_id: "CUP" } }),
      ] },
    };
    const unavailableItem = {
      id: "OTHER_ITEM", type: "ITEM",
      present_at_all_locations: false, present_at_location_ids: ["OTHER_LOCATION"],
      item_data: { name: "Avoid", variations: [row("NOT_PRESENT", {
        item_variation_data: { ...variationData, item_id: "OTHER_ITEM" },
      })] },
    };
    const otherCafeItem = {
      id: "BAGUETTE_ITEM", type: "ITEM", item_data: { name: "Baguette", variations: [
        row("BAGUETTE_VARIATION", { item_variation_data: { ...variationData, item_id: "BAGUETTE_ITEM" } }),
      ] },
    };
    const request = mockSquare({ catalog: (query) => {
      expect(query.get("types")).toBe("ITEM");
      return query.get("cursor") === "page two"
        ? respond({ objects: [otherCafeItem] })
        : respond({ objects: [cafeItem, unavailableItem], cursor: "page two" });
    } });
    await expect(new SquareCountClient(config, request).listTrackedVariations()).resolves.toEqual([
      { itemId: "BAGUETTE_ITEM", itemName: "Baguette", variationId: "BAGUETTE_VARIATION", variationName: "Regular" },
      { itemId: baseParent.id, itemName: "Croissant Plate", variationId: "TRACKED", variationName: "With jam" },
    ]);
    expect(requestsTo(request, urls.catalog)).toHaveLength(2);
    expect(request.mock.calls.every(([, init]) => init?.method === "GET")).toBe(true);
  });

  it("refuses to show a partial or duplicated catalog as the eligible list", async () => {
    const rows = Array.from({ length: 151 }, (_, index) => ({
      id: `TRACKED_${index}`, type: "ITEM_VARIATION", item_variation_data: variationData,
    }));
    const oversized = mockSquare({ catalog: () => respond({
      objects: [{ ...baseParent, item_data: { ...baseParent.item_data, variations: rows } }],
    }) });
    await expect(new SquareCountClient(config, oversized).listTrackedVariations()).rejects.toMatchObject({ code: "provider_unavailable" });
    const duplicate = mockSquare({ catalog: () => respond({
      objects: [{ ...baseParent, item_data: { ...baseParent.item_data, variations: [rows[0], rows[0]] } }],
    }) });
    await expect(new SquareCountClient(config, duplicate).listTrackedVariations()).rejects.toMatchObject({ code: "scope_mismatch" });
  });

  it("writes one zero count at the verified location and proves the observation before exposing current stock", async () => {
    const request = mockSquare();
    const client = new SquareCountClient(config, request);
    const receipt = await client.writePhysicalCount(input);

    const writes = requestsTo(request, urls.write);
    expect(writes).toHaveLength(1);
    expect(JSON.parse(String(writes[0][1]?.body))).toEqual({
      idempotency_key: input.requestId,
      ignore_unchanged_counts: false,
      changes: [{ type: "PHYSICAL_COUNT", physical_count: {
        catalog_object_id: input.variationId, location_id: config.locationId,
        reference_id: input.requestId, state: "IN_STOCK", quantity: "0",
        occurred_at: input.occurredAt, team_member_id: input.teamMemberId,
      } }],
    });
    for (const [url, init] of request.mock.calls) {
      expect(new URL(String(url)).hostname).toBe("connect.squareup.com");
      expect(new Headers(init?.headers).get("Square-Version")).toBe(SQUARE_API_VERSION);
      expect(new Headers(init?.headers).get("authorization")).toBe(`Bearer ${config.accessToken}`);
      expect(init?.redirect).toBe("error");
    }
    const reads = requestsTo(request, urls.current);
    expect(JSON.parse(String(reads[0][1]?.body))).toEqual({
      catalog_object_ids: [input.variationId], location_ids: [config.locationId], states: ["IN_STOCK"],
    });
    expect(receipt).toMatchObject({
      status: "confirmed", variationId: input.variationId, locationId: config.locationId,
      quantity: 0, physicalCountId: physicalCount.id, currentQuantity: "8",
    });
  });

  it("checks a mapped variation using the Sandbox host and a location tracking override", async () => {
    const request = mockSquare({
      variation: { item_variation_data: {
        ...variationData, track_inventory: false, location_overrides: [{ location_id: config.locationId, track_inventory: true }],
      } },
    });
    const client = new SquareCountClient({ ...config, environment: "sandbox", address: undefined }, request);
    await expect(client.verifyTrackedVariation(input.variationId)).resolves.toEqual({
      itemId: "CROISSANT_ITEM", itemName: "Croissant", variationId: input.variationId, variationName: "Regular",
    });
    expect(request.mock.calls.every(([url]) => new URL(String(url)).hostname === "connect.squareupsandbox.com")).toBe(true);
    expect(requestsTo(request, urls.write)).toHaveLength(0);
  });

  it.each([
    { variation: { absent_at_location_ids: [config.locationId] } },
    { variation: { item_variation_data: { ...variationData, location_overrides: [{ location_id: config.locationId, track_inventory: false }] } } },
    { variation: { item_variation_data: { ...variationData, stockable: false } } },
    { parent: { ...baseParent, present_at_all_locations: false, present_at_location_ids: ["OTHER_LOCATION"] } },
    { parent: { ...baseParent, item_data: { ...baseParent.item_data, is_archived: true } } },
  ])("refuses ineligible catalog variations before writing", async (result) => {
    const request = mockSquare(result);
    await expect(new SquareCountClient(config, request).writePhysicalCount(input)).rejects.toMatchObject({ code: "variation_ineligible" });
    expect(requestsTo(request, urls.write)).toHaveLength(0);
  });

  it("rejects the wrong physical address even if all Square identifiers match", async () => {
    const request = mockSquare({ location: { ...baseLocation, address: { ...baseLocation.address, address_line_1: "858 Ninth Avenue" } } });
    await expect(new SquareCountClient(config, request).writePhysicalCount(input)).rejects.toMatchObject({ code: "scope_mismatch" });
    expect(requestsTo(request, urls.write)).toHaveLength(0);
  });

  it("rejects fractional counts and stale or future observations before any Square request", async () => {
    const request = mockSquare();
    const client = new SquareCountClient(config, request);
    for (const invalid of [
      { quantity: 0.5 }, { quantity: -1 }, { quantity: Number.MAX_SAFE_INTEGER + 1 },
      { occurredAt: "2026-11-13T14:49:59Z" }, { occurredAt: "2026-11-14T14:50:01Z" },
    ]) {
      await expect(client.writePhysicalCount({ ...input, ...invalid })).rejects.toMatchObject({ code: "invalid_input" });
    }
    expect(request).not.toHaveBeenCalled();
  });

  it("reconciles a transport failure through the same reference and never dispatches a second write", async () => {
    const request = mockSquare({
      write: async () => { throw new Error(config.accessToken); },
      history: (options) => {
        const filter = JSON.parse(String(options?.body));
        return filter.cursor
          ? respond({ changes: [change()] })
          : respond({ changes: [change({ ...physicalCount, id: "PRIOR_COUNT", reference_id: "other-reference" })], cursor: "page_2" });
      },
    });
    await expect(new SquareCountClient(config, request).writePhysicalCount(input)).resolves.toMatchObject({ status: "confirmed", physicalCountId: physicalCount.id });
    expect(requestsTo(request, urls.write)).toHaveLength(1);
    expect(requestsTo(request, urls.history)).toHaveLength(2);
  });

  it("abandons the write when the caller cannot persist its dispatch record", async () => {
    const request = mockSquare();
    const callbackFailure = new Error("Stored count claim is no longer valid");
    const markDispatched = vi.fn(async () => {
      expect(request.mock.calls).toHaveLength(3);
      throw callbackFailure;
    });
    await expect(new SquareCountClient(config, request).writePhysicalCount(input, markDispatched)).rejects.toBe(callbackFailure);
    expect(markDispatched).toHaveBeenCalledOnce();
    expect(requestsTo(request, urls.write)).toHaveLength(0);
  });

  it.each([
    change({ ...physicalCount, reference_id: "another-reference" }),
    change({ ...physicalCount, quantity: "1" }),
    change({ ...physicalCount, location_id: "OTHER_LOCATION" }),
    change({ ...physicalCount, occurred_at: "2026-11-14T14:48:02.000002Z" }),
  ])("does not accept an inconsistent mutation receipt", async (inconsistent) => {
    const request = mockSquare({ write: () => respond({ changes: [inconsistent] }) });
    await expect(new SquareCountClient(config, request).writePhysicalCount(input)).rejects.toMatchObject({ code: "unconfirmed" });
    expect(requestsTo(request, urls.current)).toHaveLength(0);
  });

  it("does not treat an equal current count or an error body as proof of the requested write", async () => {
    const request = mockSquare({
      write: () => respond({ token: config.accessToken }, 401),
      history: () => respond({ changes: [change({ ...physicalCount, reference_id: "some-other-request" })] }),
      current: () => respond({ counts: [{ ...currentCount, quantity: "0" }] }),
    });
    const error = await new SquareCountClient(config, request).writePhysicalCount(input).catch((value: unknown) => value);
    expect(error).toMatchObject({ code: "unconfirmed", status: 401 });
    expect(String(error)).not.toContain(config.accessToken);
    expect(requestsTo(request, urls.current)).toHaveLength(0);
  });

  it("can reconcile an earlier exact count read-only after the write window", async () => {
    vi.setSystemTime(new Date("2026-11-17T00:00:00Z"));
    const request = mockSquare();
    await expect(new SquareCountClient(config, request).confirmPhysicalCount(input)).resolves.toMatchObject({ status: "confirmed" });
    expect(requestsTo(request, urls.write)).toHaveLength(0);
  });

  it("leaves the operation unconfirmed when the stock readback is stale or from another location", async () => {
    for (const counts of [
      [{ ...currentCount, calculated_at: "2026-11-14T14:45:00Z" }],
      [{ ...currentCount, location_id: "OTHER_LOCATION" }],
    ]) {
      const request = mockSquare({ current: () => respond({ counts }) });
      await expect(new SquareCountClient(config, request).writePhysicalCount(input)).rejects.toMatchObject({ code: "unconfirmed" });
      expect(requestsTo(request, urls.write)).toHaveLength(1);
    }
  });
});
