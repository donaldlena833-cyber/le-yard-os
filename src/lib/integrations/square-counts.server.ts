import "server-only";

import { z } from "zod";
import { churchSandwichBenchRecipes } from "../kitchen/church-sandwich-bench";
import { squareCustomIngredient, squareStandardIngredient, type ChurchSquareCatalogAllergens } from "./church-square-allergen-diagnostic";
import type { ChurchSquareItemPresentation, ChurchSquareVariationPresentation } from "./church-square-menu-diagnostic";
import { SQUARE_API_VERSION } from "./square-source";

const squareId = z.string().regex(/^[A-Za-z0-9_-]{1,100}$/);
const timestamp = z.iso.datetime({ offset: true }).max(34);
const decimalQuantity = z.string().max(26).regex(/^-?\d+(?:\.\d{1,5})?$/);
const addressSchema = z.object({
  street: z.string().trim().min(1).max(250),
  postalCode: z.string().regex(/^\d{5}(?:-\d{4})?$/),
  country: z.literal("US"),
});
const configurationSchema = z.strictObject({
  environment: z.enum(["sandbox", "production"]),
  accessToken: z.string().trim().regex(/^[!-~]{1,4096}$/),
  merchantId: squareId,
  locationId: squareId,
  testVariationId: squareId.optional(),
  address: addressSchema.optional(),
  timeZone: z.string().min(1).max(100),
  currency: z.literal("USD"),
});
const physicalCountRequest = z.strictObject({
  variationId: squareId,
  quantity: z.number().int().nonnegative(),
  occurredAt: timestamp,
  requestId: z.uuid(),
  teamMemberId: squareId.optional(),
});
const locationSchema = z.object({
  id: squareId,
  merchant_id: squareId,
  status: z.literal("ACTIVE"),
  currency: z.literal("USD"),
  timezone: z.string(),
  address: z.object({
    address_line_1: z.string().optional(),
    postal_code: z.string().optional(),
    country: z.string().optional(),
  }).optional(),
});
const merchantSchema = z.object({
  id: squareId,
  country: z.literal("US"),
  currency: z.literal("USD").optional(),
  status: z.literal("ACTIVE").optional(),
});
const catalogLocationSchema = z.object({
  id: squareId,
  type: z.string(),
  is_deleted: z.boolean().optional(),
  present_at_all_locations: z.boolean().optional(),
  absent_at_location_ids: z.array(squareId).optional(),
  present_at_location_ids: z.array(squareId).optional(),
});
const locationTrackingOverrideSchema = z.object({
  location_id: squareId,
  track_inventory: z.boolean().optional(),
});
function uniqueLocationOverrides(overrides: readonly { location_id: string }[] | undefined) {
  return !overrides || new Set(overrides.map(({ location_id }) => location_id)).size === overrides.length;
}
const variationSchema = catalogLocationSchema.extend({
  type: z.literal("ITEM_VARIATION"),
  item_variation_data: z.object({
    item_id: squareId,
    name: z.string().trim().min(1).max(2048),
    sku: z.string().max(255).optional(),
    track_inventory: z.boolean().optional(),
    sellable: z.boolean().optional(),
    stockable: z.boolean().optional(),
    stockable_conversion: z.unknown().optional(),
    measurement_unit_id: squareId.optional(),
    location_overrides: z.array(locationTrackingOverrideSchema).optional(),
  }),
});
const parentSchema = catalogLocationSchema.extend({
  type: z.literal("ITEM"),
  item_data: z.object({
    name: z.string().trim().min(1).max(2048),
    is_archived: z.boolean().optional(),
    variations: z.array(z.unknown()).max(250).optional(),
  }),
});
const exactParentSchema = parentSchema.extend({
  version: z.unknown().optional(),
  item_data: parentSchema.shape.item_data.extend({
    name: z.string().min(1).max(2048),
    product_type: z.unknown().optional(),
    food_and_beverage_details: z.unknown().optional(),
  }),
});
const exactVariationSchema = variationSchema.extend({
  item_variation_data: variationSchema.shape.item_variation_data.extend({
    name: z.string().min(1).max(2048).refine((name) => name.trim() && !/[\p{Cc}\p{Cf}]/u.test(name)),
    sku: z.string().max(255).regex(/^[^\p{Cc}\p{Cf}]*$/u).optional(),
    location_overrides: variationSchema.shape.item_variation_data.shape.location_overrides.refine(uniqueLocationOverrides),
  }),
});
const parentPresentationSchema = exactParentSchema.extend({
  item_data: exactParentSchema.shape.item_data.extend({
    image_ids: z.unknown().optional(),
    description: z.unknown().optional(),
    description_html: z.unknown().optional(),
    description_plaintext: z.unknown().optional(),
  }),
});
const variationPresentationSchema = exactVariationSchema.extend({
  item_variation_data: exactVariationSchema.shape.item_variation_data.extend({
    image_ids: z.unknown().optional(),
    sellable: z.unknown().optional(),
    location_overrides: z.array(locationTrackingOverrideSchema.extend({
      sold_out: z.unknown().optional(),
      sold_out_valid_until: z.unknown().optional(),
    })).optional().refine(uniqueLocationOverrides),
  }),
});
const physicalCountSchema = z.object({
  id: squareId,
  reference_id: z.string().max(255).optional(),
  catalog_object_id: squareId,
  catalog_object_type: z.literal("ITEM_VARIATION").optional(),
  location_id: squareId,
  state: z.string(),
  quantity: decimalQuantity,
  occurred_at: timestamp,
  team_member_id: squareId.optional(),
});
const currentCountSchema = z.object({
  catalog_object_id: squareId,
  catalog_object_type: z.literal("ITEM_VARIATION").optional(),
  location_id: squareId,
  state: z.string(),
  quantity: decimalQuantity,
  calculated_at: timestamp,
  is_estimated: z.boolean().optional(),
});
const maximumMappedCountIds = 200;
const mappedCountIds = z.array(squareId).max(maximumMappedCountIds).refine((ids) => new Set(ids).size === ids.length);
const mappedCountRows = z.array(currentCountSchema.extend({
  quantity: z.string().regex(/^-?\d{1,12}(?:\.\d{1,5})?$/),
  calculated_at: timestamp.regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/),
})).max(100).optional();
const currentCountsPath = "/v2/inventory/counts/batch-retrieve";
const envelopeSchema = z.object({
  cursor: z.string().max(4096).optional(),
  errors: z.array(z.unknown()).optional(),
}).passthrough();
const changeSchema = z.object({ type: z.string(), physical_count: z.unknown().optional() });
const hosts = { sandbox: "https://connect.squareupsandbox.com", production: "https://connect.squareup.com" } as const;
const DAY_MS = 86_400_000;
const CLAIM_CLOCK_SKEW_MS = 2_000;
const MAX_RESPONSE_BYTES = 2 * 1024 * 1024;
const MAX_PAGES = 10;
const MAX_VARIATIONS = 150;
const STOCK_TEST_SKU = "LY-OPS-STOCK-TEST";

export type SquareCountConfiguration = z.input<typeof configurationSchema>;
export type SquarePhysicalCountInput = z.infer<typeof physicalCountRequest>;
export interface SquareTrackedVariation {
  variationId: string;
  itemId: string;
  itemName: string;
  variationName: string;
}
export interface SquareChurchSandwichCatalogVariation {
  id: string;
  name: string;
  sku: string | null;
  tracking: "tracked" | "untracked" | "default_off";
  presentation?: ChurchSquareVariationPresentation;
}
export type SquareChurchSandwichCatalogItem =
  | { name: string; status: "missing" | "ambiguous"; itemId: null; variations: [] }
  | {
    name: string; status: "matched"; itemId: string; variations: SquareChurchSandwichCatalogVariation[];
    allergens?: ChurchSquareCatalogAllergens; catalogVersion?: string | null; presentation?: ChurchSquareItemPresentation;
  };
export interface SquarePhysicalCountReceipt {
  status: "confirmed";
  variationId: string;
  locationId: string;
  quantity: number;
  occurredAt: string;
  physicalCountId: string;
  currentQuantity: string;
  calculatedAt: string;
}
export interface SquareMappedCurrentCount {
  variationId: string;
  quantity: string;
  calculatedAt: string;
}

type ErrorCode = "invalid_input" | "scope_mismatch" | "variation_ineligible" | "provider_unavailable" | "unconfirmed";

export class SquareCountError extends Error {
  constructor(message: string, readonly code: ErrorCode, readonly status?: number) {
    super(message);
    this.name = "SquareCountError";
  }
}

function parseProvider<T>(schema: z.ZodType<T>, value: unknown): T {
  const result = schema.safeParse(value);
  if (!result.success) throw new SquareCountError("Square returned an invalid inventory response.", "provider_unavailable");
  return result.data;
}

function normalizeStreet(street: string | undefined) {
  return street?.trim().toLowerCase().replace(/[.,]/g, "").replace(/\s+/g, " ").replace(/\bst$/, "street");
}

function presentAtLocation(catalogObject: z.infer<typeof catalogLocationSchema>, locationId: string) {
  if (catalogObject.is_deleted) return false;
  if (catalogObject.present_at_all_locations === false) {
    return catalogObject.present_at_location_ids?.includes(locationId) === true;
  }
  return !catalogObject.absent_at_location_ids?.includes(locationId);
}

function itemPresentAtLocation(item: z.infer<typeof parentSchema>, locationId: string) {
  return !item.item_data.is_archived && presentAtLocation(item, locationId);
}

const squareIngredient = z.discriminatedUnion("type", [
  z.object({ type: z.literal("STANDARD"), standard_name: squareStandardIngredient, custom_name: z.null().optional() }),
  z.object({ type: z.literal("CUSTOM"), custom_name: squareCustomIngredient, standard_name: z.null().optional() }),
]);
const squareFoodDetails = z.object({ ingredients: z.array(squareIngredient).max(50).nullish() });
const nonFoodProductTypes = new Set([
  "REGULAR", "GIFT_CARD", "APPOINTMENTS_SERVICE", "EVENT", "DIGITAL", "DONATION",
  "LEGACY_SQUARE_ONLINE_SERVICE", "LEGACY_SQUARE_ONLINE_MEMBERSHIP",
]);

function squareAllergenTags(item: z.infer<typeof exactParentSchema>): ChurchSquareCatalogAllergens {
  const { product_type: type, food_and_beverage_details: raw } = item.item_data;
  if (type !== "FOOD_AND_BEV") {
    return { status: raw == null && typeof type === "string" && nonFoodProductTypes.has(type) ? "unsupported" : "unavailable", standard: [], custom: [] };
  }
  if (raw == null) return { status: "empty", standard: [], custom: [] };
  const parsed = squareFoodDetails.safeParse(raw);
  if (!parsed.success) return { status: "unavailable", standard: [], custom: [] };
  const ingredients = parsed.data.ingredients ?? [];
  const standard = [...new Set(ingredients.flatMap((tag) => tag.type === "STANDARD" ? [tag.standard_name] : []))];
  const custom = [...new Set(ingredients.flatMap((tag) => tag.type === "CUSTOM" ? [tag.custom_name] : []))];
  return { status: standard.length || custom.length ? "configured" : "empty", standard, custom };
}

const catalogPhotoReferences = z.array(squareId).max(250);

function photoCount(value: unknown): number | null {
  if (value === undefined) return 0;
  const references = catalogPhotoReferences.safeParse(value);
  if (!references.success || new Set(references.data).size !== references.data.length) return null;
  return references.data.length;
}

function itemPresentation({ image_ids, description_plaintext, description, description_html }: z.infer<typeof parentPresentationSchema>["item_data"]): ChurchSquareItemPresentation {
  const fields = [
    [description_plaintext, 65_535], [description, 4_096], [description_html, 65_535],
  ] as const;
  const readable = fields.map(([value, maximum]) => {
    if (value === undefined) return "";
    return typeof value === "string" && Array.from(value).length <= maximum ? value.trim() : null;
  });
  const [plain, legacy, html] = readable;
  return {
    itemPhotoCount: photoCount(image_ids),
    description: plain || legacy ? "present" : html === "" && !readable.includes(null) ? "missing" : "unverified",
  };
}

const soldOutExpiration = z.iso.datetime({ offset: true }).max(35)
  .regex(/T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2})$/);

function squareSoldOutFlag(override: {
  location_id: string;
  sold_out?: unknown;
  sold_out_valid_until?: unknown;
} | undefined, now: number): ChurchSquareVariationPresentation["soldOut"] {
  if (override?.sold_out === false) return { status: "clear" };
  if (override?.sold_out !== true) return { status: "unverified" };
  if (override.sold_out_valid_until === undefined) return { status: "sold_out", validUntil: null };

  const validUntil = soldOutExpiration.safeParse(override.sold_out_valid_until);
  if (!validUntil.success) return { status: "expiration_unverified" };
  const expiresAt = Date.parse(validUntil.data);
  if (!Number.isFinite(expiresAt)) return { status: "expiration_unverified" };
  return { status: now > expiresAt ? "expired" : "sold_out", validUntil: validUntil.data };
}

function canCountVariation(
  variation: z.infer<typeof variationSchema>,
  { locationId, testVariationId }: Pick<SquareCountConfiguration, "locationId" | "testVariationId">,
) {
  const data = variation.item_variation_data;
  const overrides = data.location_overrides?.filter((override) => override.location_id === locationId) ?? [];
  const tracked = overrides[0]?.track_inventory ?? data.track_inventory;
  if (overrides.length > 1 || tracked !== true || data.stockable_conversion != null || data.measurement_unit_id) {
    return false;
  }
  if (variation.id === testVariationId || data.sku === STOCK_TEST_SKU) {
    return variation.id === testVariationId && data.sku === STOCK_TEST_SKU
      && data.sellable === false && data.stockable === true;
  }
  return data.sellable !== false && data.stockable !== false;
}

function trackedVariationLabels(item: z.infer<typeof parentSchema>, variation: z.infer<typeof variationSchema>): SquareTrackedVariation {
  const cleanLabel = (name: string) => name.replace(/[\p{Cc}\p{Cf}]/gu, " ").replace(/\s+/g, " ").trim().slice(0, 255);
  return {
    variationId: variation.id,
    itemId: item.id,
    itemName: cleanLabel(item.item_data.name),
    variationName: cleanLabel(variation.item_variation_data.name),
  };
}

async function readJson(response: Response): Promise<unknown> {
  if (!response.body) throw new SquareCountError("Square returned an empty inventory response.", "provider_unavailable");
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      size += next.value.byteLength;
      if (size > MAX_RESPONSE_BYTES) throw new SquareCountError("Square inventory response exceeded the size limit.", "provider_unavailable");
      chunks.push(next.value);
    }
    return JSON.parse(Buffer.concat(chunks).toString("utf8")) as unknown;
  } catch {
    await reader.cancel().catch(() => {});
    throw new SquareCountError("Square returned an unreadable or oversized inventory response.", "provider_unavailable");
  } finally {
    reader.releaseLock();
  }
}

export class SquareCountClient {
  private readonly configuration: z.infer<typeof configurationSchema>;

  constructor(configuration: SquareCountConfiguration, private readonly request: typeof fetch = fetch) {
    const parsed = configurationSchema.safeParse(configuration);
    if (!parsed.success || (parsed.data.environment === "production" && !parsed.data.address)) {
      throw new SquareCountError("An exact Square merchant and location configuration is required.", "invalid_input");
    }
    this.configuration = parsed.data;
  }

  private async call(path: string, options?: { body: object }, deadline?: AbortSignal) {
    const provider = this.configuration;
    const requestTimeout = AbortSignal.timeout(10_000);
    let response: Response;
    try {
      response = await this.request(hosts[provider.environment] + path, {
        method: options ? "POST" : "GET",
        headers: {
          authorization: `Bearer ${provider.accessToken}`,
          "Square-Version": SQUARE_API_VERSION,
          accept: "application/json",
          ...(options ? { "content-type": "application/json" } : {}),
        },
        ...(options ? { body: JSON.stringify(options.body) } : {}),
        cache: "no-store",
        redirect: "error",
        signal: deadline ? AbortSignal.any([deadline, requestTimeout]) : requestTimeout,
      });
    } catch {
      throw new SquareCountError("Square inventory transport failed.", "provider_unavailable");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      throw new SquareCountError("Square refused the inventory request.", "provider_unavailable", response.status);
    }
    const envelope = parseProvider(envelopeSchema, await readJson(response));
    if (envelope.errors?.length) {
      throw new SquareCountError("Square returned inventory errors.", "provider_unavailable");
    }
    return envelope;
  }

  async verifyScope(deadline?: AbortSignal): Promise<void> {
    const expected = this.configuration;
    const [merchantResult, locationResult] = await Promise.all([
      this.call(`/v2/merchants/${expected.merchantId}`, undefined, deadline),
      this.call(`/v2/locations/${expected.locationId}`, undefined, deadline),
    ]);
    const merchant = merchantSchema.safeParse(merchantResult.merchant);
    const location = locationSchema.safeParse(locationResult.location);
    if (!merchant.success || !location.success || merchant.data.id !== expected.merchantId
      || location.data.id !== expected.locationId || location.data.merchant_id !== expected.merchantId
      || location.data.timezone !== expected.timeZone) {
      throw new SquareCountError("Square did not verify the approved merchant and active location.", "scope_mismatch");
    }
    if (expected.address) {
      const actual = location.data.address;
      if (actual?.country !== expected.address.country
        || !/^\d{5}(?:-\d{4})?$/.test(actual.postal_code?.trim() ?? "")
        || actual.postal_code?.trim().slice(0, 5) !== expected.address.postalCode.slice(0, 5)
        || normalizeStreet(actual.address_line_1) !== normalizeStreet(expected.address.street)) {
        throw new SquareCountError("The Square location address does not match the approved site.", "scope_mismatch");
      }
    }
  }

  private async *catalogItems(deadline?: AbortSignal): AsyncGenerator<unknown> {
    const seen = new Set<string>();
    let cursor: string | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const query = new URLSearchParams({ types: "ITEM", ...(cursor ? { cursor } : {}) });
      const response = await this.call(`/v2/catalog/list?${query}`, undefined, deadline);
      const objects = parseProvider(z.array(z.unknown()).max(100).optional(), response.objects) ?? [];
      yield* objects;
      cursor = response.cursor;
      if (!cursor) return;
      if (seen.has(cursor)) break;
      seen.add(cursor);
    }
    throw new SquareCountError("Square catalog pagination could not be completed.", "provider_unavailable");
  }

  async listTrackedVariations(): Promise<SquareTrackedVariation[]> {
    await this.verifyScope();
    const { locationId } = this.configuration;
    const trackedVariations = new Map<string, SquareTrackedVariation>();
    for await (const object of this.catalogItems()) {
      const item = parseProvider(parentSchema, object);
      if (!itemPresentAtLocation(item, locationId)) continue;
      for (const objectVariation of item.item_data.variations ?? []) {
        const variation = parseProvider(variationSchema, objectVariation);
        if (variation.item_variation_data.item_id !== item.id) {
          throw new SquareCountError("Square returned an inconsistent parent item.", "scope_mismatch");
        }
        if (!presentAtLocation(variation, locationId) || !canCountVariation(variation, this.configuration)) continue;
        const option = trackedVariationLabels(item, variation);
        if (!option.itemName || !option.variationName || trackedVariations.has(option.variationId)) {
          throw new SquareCountError("Square returned an ambiguous catalog variation.", "scope_mismatch");
        }
        trackedVariations.set(option.variationId, option);
        if (trackedVariations.size > MAX_VARIATIONS) {
          throw new SquareCountError("More than 150 tracked Square variations matched this location.", "provider_unavailable");
        }
      }
    }
    return [...trackedVariations.values()].sort((first, second) =>
      first.itemName.localeCompare(second.itemName, "en-US")
      || first.variationName.localeCompare(second.variationName, "en-US")
      || first.variationId.localeCompare(second.variationId));
  }

  async verifyChurchSandwichCatalog({ includeAllergens = false, includePresentation = false }: {
    includeAllergens?: boolean;
    includePresentation?: boolean;
  } = {}): Promise<SquareChurchSandwichCatalogItem[]> {
    const deadline = AbortSignal.timeout(22_000);
    await this.verifyScope(deadline);
    const checkedAt = Date.now();
    const { locationId } = this.configuration;
    const items = new Map<string, SquareChurchSandwichCatalogItem>(churchSandwichBenchRecipes.map(({ name }) => [name, {
      name, status: "missing", itemId: null, variations: [],
    }]));
    const catalogIds = new Set<string>();
    let variationCount = 0;
    for await (const object of this.catalogItems(deadline)) {
      const item = includePresentation ? parseProvider(parentPresentationSchema, object) : parseProvider(exactParentSchema, object);
      const name = item.item_data.name;
      if (catalogIds.has(item.id)) {
        throw new SquareCountError("Square returned a duplicate catalog ID.", "scope_mismatch");
      }
      catalogIds.add(item.id);
      const previous = items.get(name);
      if (!previous || !itemPresentAtLocation(item, locationId)) continue;

      const variations: SquareChurchSandwichCatalogVariation[] = [];
      for (const raw of item.item_data.variations ?? []) {
        const variation = includePresentation ? parseProvider(variationPresentationSchema, raw) : parseProvider(exactVariationSchema, raw);
        const data = variation.item_variation_data;
        if (data.item_id !== item.id || catalogIds.has(variation.id)) {
          throw new SquareCountError("Square returned an inconsistent or duplicate catalog variation.", "scope_mismatch");
        }
        catalogIds.add(variation.id);
        if (!presentAtLocation(variation, locationId)) continue;
        if (++variationCount > MAX_VARIATIONS) {
          throw new SquareCountError("Square returned too many sandwich variations to verify.", "provider_unavailable");
        }
        const override = data.location_overrides?.find(({ location_id }) => location_id === locationId);
        const tracked = override?.track_inventory ?? data.track_inventory;
        variations.push({
          id: variation.id,
          name: data.name,
          sku: data.sku?.trim() ? data.sku : null,
          // Square disables tracking when neither the variation nor its location sets it.
          tracking: tracked === undefined ? "default_off" : tracked ? "tracked" : "untracked",
          ...(includePresentation ? { presentation: {
            photoCount: photoCount("image_ids" in data ? data.image_ids : undefined),
            sellability: data.sellable === true ? "sellable" : data.sellable === false ? "not_sellable" : "unspecified",
            soldOut: squareSoldOutFlag(override, checkedAt),
          } } : {}),
        });
      }

      items.set(name, previous.status === "missing" ? {
        name, status: "matched", itemId: item.id, variations: variations.sort((first, second) =>
          first.name.localeCompare(second.name, "en-US") || first.id.localeCompare(second.id)),
        ...(includeAllergens ? {
          allergens: squareAllergenTags(item),
          catalogVersion: typeof item.version === "number" && Number.isSafeInteger(item.version) && item.version > 0
            ? String(item.version) : null,
        } : {}),
        ...(includePresentation ? { presentation: itemPresentation(item.item_data) } : {}),
      } : { name, status: "ambiguous", itemId: null, variations: [] });
    }
    return [...items.values()];
  }

  async verifyTrackedVariation(variationId: string): Promise<SquareTrackedVariation> {
    if (!squareId.safeParse(variationId).success) {
      throw new SquareCountError("An exact Square variation ID is required.", "invalid_input");
    }
    await this.verifyScope();
    return this.getTrackedVariation(variationId);
  }

  private async getTrackedVariation(variationId: string) {
    const locationId = this.configuration.locationId;
    const response = await this.call(`/v2/catalog/object/${variationId}?include_related_objects=true`);
    const variation = variationSchema.safeParse(response.object);
    if (!variation.success || variation.data.id !== variationId || !presentAtLocation(variation.data, locationId)) {
      throw new SquareCountError("Square did not return an active variation at the approved location.", "variation_ineligible");
    }
    const { item_id: itemId } = variation.data.item_variation_data;
    const relatedObjects = parseProvider(z.array(z.unknown()).max(100).optional(), response.related_objects) ?? [];
    const parents = relatedObjects
      .map((object) => parentSchema.safeParse(object))
      .flatMap((result) => result.success && result.data.id === itemId ? [result.data] : []);
    if (parents.length !== 1 || !itemPresentAtLocation(parents[0], locationId)) {
      throw new SquareCountError("The Square variation must have one active parent item at this location.", "variation_ineligible");
    }
    if (!canCountVariation(variation.data, this.configuration)) {
      throw new SquareCountError("The Square variation must track directly counted, whole units and be eligible at this location.", "variation_ineligible");
    }
    const option = trackedVariationLabels(parents[0], variation.data);
    if (!option.itemName || !option.variationName) {
      throw new SquareCountError("Square did not return the item and variation names.", "variation_ineligible");
    }
    return option;
  }

  private parseInput(input: SquarePhysicalCountInput) {
    const parsed = physicalCountRequest.safeParse(input);
    if (!parsed.success) throw new SquareCountError("Supply a whole, nonnegative count, a variation and an observation time.", "invalid_input");
    return parsed.data;
  }

  private verifyObservationAge(occurredAt: string, allowedClockSkew: number) {
    const age = Date.now() - Date.parse(occurredAt);
    if (age < -allowedClockSkew || age >= DAY_MS) {
      throw new SquareCountError("Square physical counts must have been observed within the past 24 hours.", "invalid_input");
    }
  }

  private matchingPhysicalCount(
    changes: unknown,
    input: SquarePhysicalCountInput,
    requireWriteReference: boolean,
  ): z.infer<typeof physicalCountSchema> | undefined {
    const rows = parseProvider(z.array(changeSchema).max(100).optional(), changes) ?? [];
    let matching: z.infer<typeof physicalCountSchema> | undefined;
    for (const row of rows) {
      if (row.type !== "PHYSICAL_COUNT") {
        if (!requireWriteReference) throw new SquareCountError("Square inventory history returned an unexpected change type.", "scope_mismatch");
        continue;
      }
      const count = parseProvider(physicalCountSchema, row.physical_count);
      if (count.catalog_object_id !== input.variationId || count.location_id !== this.configuration.locationId) {
        throw new SquareCountError("Square returned a count outside the approved variation or location.", "scope_mismatch");
      }
      if (count.reference_id !== input.requestId && !requireWriteReference) continue;
      if (matching || count.reference_id !== input.requestId || count.state !== "IN_STOCK"
        || BigInt(count.quantity.split(".")[0]) !== BigInt(input.quantity)
        || /[1-9]/.test(count.quantity.split(".")[1] ?? "")
        || !sameObservation(count.occurred_at, input.occurredAt)
        || (input.teamMemberId !== undefined && count.team_member_id !== input.teamMemberId)) {
        throw new SquareCountError("Square physical count receipt did not match the submitted observation.", "scope_mismatch");
      }
      matching = count;
    }
    return matching;
  }

  private matchingCurrentCount(counts: unknown, input: SquarePhysicalCountInput) {
    const rows = parseProvider(z.array(currentCountSchema).max(100).optional(), counts) ?? [];
    let matching: z.infer<typeof currentCountSchema> | undefined;
    for (const count of rows) {
      if (count.catalog_object_id !== input.variationId || count.location_id !== this.configuration.locationId) {
        throw new SquareCountError("Square returned inventory outside the approved variation or location.", "scope_mismatch");
      }
      if (count.state !== "IN_STOCK") continue;
      if (matching || count.is_estimated === true) {
        throw new SquareCountError("Square current inventory was ambiguous.", "scope_mismatch");
      }
      matching = count;
    }
    return matching;
  }

  private async retrievePhysicalCount(input: SquarePhysicalCountInput) {
    const filter = {
      catalog_object_ids: [input.variationId],
      location_ids: [this.configuration.locationId],
      types: ["PHYSICAL_COUNT"],
      // The receipt was generated after the observation. Use a lower bound that preserves the exact event.
      updated_after: new Date(Date.parse(input.occurredAt) - 1_000).toISOString(),
      limit: 100,
    };
    let cursor: string | undefined;
    const seen = new Set<string>();
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.call("/v2/inventory/changes/batch-retrieve", {
        body: { ...filter, ...(cursor ? { cursor } : {}) },
      });
      const matching = this.matchingPhysicalCount(response.changes, input, false);
      if (matching) return matching;
      cursor = response.cursor;
      if (!cursor) return undefined;
      if (seen.has(cursor)) break;
      seen.add(cursor);
    }
    throw new SquareCountError("Square inventory history pagination could not be completed.", "unconfirmed");
  }

  private async confirm(
    input: SquarePhysicalCountInput,
    writeResponse?: z.infer<typeof envelopeSchema>,
  ): Promise<SquarePhysicalCountReceipt | null> {
    this.matchingCurrentCount(writeResponse?.counts, input);
    const physical = this.matchingPhysicalCount(writeResponse?.changes, input, true)
      ?? await this.retrievePhysicalCount(input);
    if (!physical) return null;
    // The idempotent write response can be replayed after other sales or counts.
    const current = await this.retrieveCurrentCount(input);
    if (!current) return null;
    return {
      status: "confirmed",
      variationId: input.variationId,
      locationId: this.configuration.locationId,
      quantity: input.quantity,
      occurredAt: physical.occurred_at,
      physicalCountId: physical.id,
      currentQuantity: current.quantity,
      calculatedAt: current.calculated_at,
    };
  }

  private async retrieveCurrentCount(input: SquarePhysicalCountInput) {
    let cursor: string | undefined;
    const seen = new Set<string>();
    let matching: z.infer<typeof currentCountSchema> | undefined;
    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.call(currentCountsPath, {
        body: { catalog_object_ids: [input.variationId], location_ids: [this.configuration.locationId],
          states: ["IN_STOCK"], ...(cursor ? { cursor } : {}) },
      });
      const current = this.matchingCurrentCount(response.counts, input);
      if (current && matching) throw new SquareCountError("Square returned duplicate current inventory counts.", "scope_mismatch");
      matching ??= current;
      cursor = response.cursor;
      if (!cursor) return matching && Date.parse(matching.calculated_at) >= Date.parse(input.occurredAt) ? matching : undefined;
      if (seen.has(cursor)) break;
      seen.add(cursor);
    }
    throw new SquareCountError("Square current inventory pagination could not be completed.", "unconfirmed");
  }

  /** Read only the current Square-observed counts for the caller's active variation mappings. */
  async retrieveMappedCurrentCounts(variationIds: readonly string[]): Promise<SquareMappedCurrentCount[]> {
    const ids = mappedCountIds.safeParse(variationIds);
    if (!ids.success) {
      throw new SquareCountError("Supply up to 200 distinct Square variation IDs.", "invalid_input");
    }
    if (!ids.data.length) return [];

    const deadline = AbortSignal.timeout(15_000);
    await this.verifyScope(deadline);
    const locationId = this.configuration.locationId;
    const requested = new Set(ids.data);
    const observations = new Map<string, SquareMappedCurrentCount>();
    const seenCursors = new Set<string>();
    let cursor: string | undefined;

    for (let page = 0; page < MAX_PAGES; page++) {
      const response = await this.call(currentCountsPath, { body: {
        catalog_object_ids: ids.data,
        location_ids: [locationId],
        states: ["IN_STOCK"],
        limit: 100,
        ...(cursor ? { cursor } : {}),
      } }, deadline);
      const rows = parseProvider(mappedCountRows, response.counts) ?? [];
      const maximumCalculatedAt = Date.now() + 60_000;
      for (const row of rows) {
        const variationId = row.catalog_object_id;
        if (!requested.has(variationId) || row.location_id !== locationId || row.state !== "IN_STOCK") {
          throw new SquareCountError("Square returned inventory outside the approved variations, location or state.", "scope_mismatch");
        }
        const calculatedAt = Date.parse(row.calculated_at);
        if (!Number.isFinite(calculatedAt) || calculatedAt > maximumCalculatedAt) {
          throw new SquareCountError("Square returned an invalid inventory calculation time.", "provider_unavailable");
        }
        if (row.is_estimated) continue;
        if (observations.has(variationId)) {
          throw new SquareCountError("Square returned duplicate current inventory counts.", "scope_mismatch");
        }
        observations.set(variationId, { variationId, quantity: row.quantity, calculatedAt: row.calculated_at });
      }

      cursor = response.cursor;
      if (!cursor) return [...observations.values()];
      if (seenCursors.has(cursor)) break;
      seenCursors.add(cursor);
    }
    throw new SquareCountError("Square current inventory pagination could not be completed.", "provider_unavailable");
  }

  /** Read-only reconciliation for an earlier submission, including after the write window closes. */
  async confirmPhysicalCount(input: SquarePhysicalCountInput): Promise<SquarePhysicalCountReceipt | null> {
    const validated = this.parseInput(input);
    await this.verifyScope();
    return this.confirm(validated);
  }

  async writePhysicalCount(
    input: SquarePhysicalCountInput,
    beforeWrite?: () => Promise<void>,
    { databaseClaimed = false }: { databaseClaimed?: boolean } = {},
  ): Promise<SquarePhysicalCountReceipt> {
    const validated = this.parseInput(input);
    // The server can lag the clock that recorded the trusted database claim.
    const allowedClockSkew = databaseClaimed && beforeWrite ? CLAIM_CLOCK_SKEW_MS : 0;
    this.verifyObservationAge(validated.occurredAt, allowedClockSkew);
    await this.verifyTrackedVariation(validated.variationId);
    this.verifyObservationAge(validated.occurredAt, allowedClockSkew);

    const body = {
      idempotency_key: validated.requestId,
      ignore_unchanged_counts: false,
      changes: [{
        type: "PHYSICAL_COUNT",
        physical_count: {
          reference_id: validated.requestId,
          catalog_object_id: validated.variationId,
          state: "IN_STOCK",
          location_id: this.configuration.locationId,
          quantity: String(validated.quantity),
          occurred_at: validated.occurredAt,
          ...(validated.teamMemberId ? { team_member_id: validated.teamMemberId } : {}),
        },
      }],
    };
    await beforeWrite?.();

    let result: z.infer<typeof envelopeSchema> | undefined;
    let status: number | undefined;
    try {
      result = await this.call("/v2/inventory/changes/batch-create", { body });
    } catch (error) {
      status = error instanceof SquareCountError ? error.status : undefined;
      // The write might have reached Square. Check history without sending another write.
    }
    try {
      const receipt = await this.confirm(validated, result);
      if (receipt) return receipt;
    } catch (error) {
      status ??= error instanceof SquareCountError ? error.status : undefined;
    }
    throw new SquareCountError("Square did not confirm this physical count. Reconcile or retry with the same request identity.", "unconfirmed", status);
  }
}

function sameObservation(left: string, right: string) {
  return Date.parse(left) === Date.parse(right)
    && (left.match(/\.(\d+)(?:Z|[+-])/i)?.[1] ?? "").replace(/0+$/, "")
      === (right.match(/\.(\d+)(?:Z|[+-])/i)?.[1] ?? "").replace(/0+$/, "");
}
