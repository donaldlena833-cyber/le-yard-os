export const INVENTORY_COUNT_DRAFT_SCHEMA_VERSION = 2;
export const INVENTORY_COUNT_DRAFT_MAX_AGE_MS = 12 * 60 * 60 * 1_000;

export interface InventoryCountDraftItem {
  id: string;
  baseUnitId: string;
}

export interface InventoryCountDraftContext {
  organizationId: string;
  locationId: string;
  userId: string;
  businessDate: string;
  items: readonly InventoryCountDraftItem[];
}

export interface InventoryCountDraftV2 {
  schemaVersion: typeof INVENTORY_COUNT_DRAFT_SCHEMA_VERSION;
  submissionId: string;
  organizationId: string;
  locationId: string;
  userId: string;
  businessDate: string;
  catalogRevision: string;
  values: Record<string, string>;
  notes: string;
  updatedAt: string;
  expiresAt: string;
}

export type InventoryCountDraftReadResult =
  | { status: "none" }
  | { status: "restored"; draft: InventoryCountDraftV2 }
  | {
      status:
        | "invalid"
        | "expired"
        | "scope_mismatch"
        | "business_date_mismatch"
        | "catalog_changed";
      message: string;
    };

export function inventoryCountCatalogRevision(
  items: readonly InventoryCountDraftItem[],
): string {
  return items
    .map((item) => `${item.id}:${item.baseUnitId}`)
    .sort()
    .join("|");
}

export function createInventoryCountDraft(
  context: InventoryCountDraftContext,
  input: { submissionId: string; values: Record<string, string>; notes: string },
  now = new Date(),
): InventoryCountDraftV2 {
  const updatedAt = now.toISOString();
  return {
    schemaVersion: INVENTORY_COUNT_DRAFT_SCHEMA_VERSION,
    submissionId: input.submissionId,
    organizationId: context.organizationId,
    locationId: context.locationId,
    userId: context.userId,
    businessDate: context.businessDate,
    catalogRevision: inventoryCountCatalogRevision(context.items),
    values: Object.fromEntries(
      context.items.map((item) => [item.id, input.values[item.id] ?? ""]),
    ),
    notes: input.notes,
    updatedAt,
    expiresAt: new Date(now.valueOf() + INVENTORY_COUNT_DRAFT_MAX_AGE_MS).toISOString(),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function readInventoryCountDraft(
  raw: string | null,
  context: InventoryCountDraftContext,
  now = new Date(),
): InventoryCountDraftReadResult {
  if (!raw) return { status: "none" };

  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { status: "invalid", message: "The saved count draft was unreadable and was not restored." };
  }
  if (!isRecord(value)) {
    return { status: "invalid", message: "The saved count draft was invalid and was not restored." };
  }

  const values = value.values;
  if (
    value.schemaVersion !== INVENTORY_COUNT_DRAFT_SCHEMA_VERSION ||
    typeof value.submissionId !== "string" ||
    !value.submissionId ||
    typeof value.organizationId !== "string" ||
    typeof value.locationId !== "string" ||
    typeof value.userId !== "string" ||
    typeof value.businessDate !== "string" ||
    typeof value.catalogRevision !== "string" ||
    typeof value.notes !== "string" ||
    typeof value.updatedAt !== "string" ||
    typeof value.expiresAt !== "string" ||
    !isRecord(values) ||
    Object.values(values).some((entry) => typeof entry !== "string")
  ) {
    return { status: "invalid", message: "The saved count draft failed validation and was not restored." };
  }

  if (
    value.organizationId !== context.organizationId ||
    value.locationId !== context.locationId ||
    value.userId !== context.userId
  ) {
    return { status: "scope_mismatch", message: "A draft from another workspace or user was rejected." };
  }
  if (value.businessDate !== context.businessDate) {
    return { status: "business_date_mismatch", message: "The saved count is from a different business date and was not restored." };
  }
  if (value.catalogRevision !== inventoryCountCatalogRevision(context.items)) {
    return { status: "catalog_changed", message: "The inventory catalog changed after this draft was saved. Start a fresh count against the current items and units." };
  }

  const updatedAt = Date.parse(value.updatedAt);
  const expiresAt = Date.parse(value.expiresAt);
  if (
    !Number.isFinite(updatedAt) ||
    !Number.isFinite(expiresAt) ||
    updatedAt > now.valueOf() + 5 * 60 * 1_000 ||
    expiresAt <= now.valueOf() ||
    now.valueOf() - updatedAt > INVENTORY_COUNT_DRAFT_MAX_AGE_MS
  ) {
    return { status: "expired", message: "The saved count draft expired and was not restored." };
  }

  return {
    status: "restored",
    draft: value as unknown as InventoryCountDraftV2,
  };
}
