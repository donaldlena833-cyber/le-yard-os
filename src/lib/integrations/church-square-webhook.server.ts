import "server-only";

import { z } from "zod";
import { appSurface } from "@/lib/app-surface";

export const churchSquareWebhookUrl = "https://operations.leyardny.com/api/integrations/square/webhook";

const squareId = z.string().regex(/^[A-Za-z0-9_:-]{1,192}$/);
const isoInstant = z.iso.datetime({ offset: true });
const configuration = z.object({
  signatureKey: z.string().min(16).max(512),
  merchantId: squareId,
  squareLocationId: squareId,
});

export function churchSquareWebhookConfiguration() {
  if (
    appSurface !== "operations" ||
    process.env.VERCEL_ENV !== "production" ||
    process.env.LE_YARD_CHURCH_SQUARE_WEBHOOK_ENABLED?.trim() !== "true"
  ) return undefined;
  const result = configuration.safeParse({
    signatureKey: process.env.SQUARE_CHURCH_WEBHOOK_SIGNATURE_KEY?.trim(),
    merchantId: process.env.SQUARE_CHURCH_MERCHANT_ID?.trim(),
    squareLocationId: process.env.SQUARE_CHURCH_LOCATION_ID?.trim(),
  });
  return result.success ? result.data : undefined;
}

const eventHeaders = z.object({
  merchant_id: squareId,
  location_id: squareId.optional(),
  event_id: squareId,
  type: z.string().min(1).max(100),
  created_at: isoInstant,
});

const stockCount = z.object({
  location_id: squareId,
  catalog_object_id: squareId,
  catalog_object_type: z.literal("ITEM_VARIATION"),
  state: z.literal("IN_STOCK"),
  quantity: z.string().regex(/^-?\d{1,12}(?:\.\d{1,5})?$/),
  calculated_at: isoInstant,
  is_estimated: z.literal(false).optional(),
});

const dataEnvelope = z.object({
  id: z.union([squareId, z.literal("")]).optional(),
  object: z.record(z.string(), z.unknown()),
});

const stockCollection = z.object({ inventory_counts: z.array(z.unknown()).max(2000) });
const scopedResource = z.object({
  id: squareId.optional(),
  location_id: squareId,
  order_id: squareId.optional(),
});

const resourceObjects = {
  "order.created": "order_created",
  "order.updated": "order_updated",
  "order.fulfillment.updated": "order_fulfillment_updated",
  "payment.created": "payment",
  "payment.updated": "payment",
  "refund.created": "refund",
  "refund.updated": "refund",
  "invoice.published": "invoice",
  "invoice.updated": "invoice",
  "invoice.payment_made": "invoice",
  "invoice.refunded": "invoice",
  "invoice.canceled": "invoice",
} as const;

type InventoryObservation = { variationId: string; quantity: string; calculatedAt: string };
type Receipt = {
  eventId: string;
  eventType: string;
  createdAt: string;
  resourceId: string;
  relatedOrderId?: string;
  inventory: InventoryObservation[];
};

/**
 * Keep an allowlist of identifiers and inventory facts. Full Square order,
 * invoice and payment objects can contain contact and payment information.
 */
export function prepareChurchSquareWebhook(
  input: unknown,
  scope: { merchantId: string; squareLocationId: string },
): Receipt | "ignore" {
  const event = eventHeaders.parse(input);
  if (event.merchant_id !== scope.merchantId) return "ignore";
  if (event.location_id && event.location_id !== scope.squareLocationId) return "ignore";

  const receipt = { eventId: event.event_id, eventType: event.type, createdAt: event.created_at };
  if (event.type === "inventory.count.updated") {
    const data = dataEnvelope.parse((input as { data?: unknown }).data);
    const { inventory_counts: observations } = stockCollection.parse(data.object);
    const inventory = observations.flatMap((observation) => {
      const result = stockCount.safeParse(observation);
      if (!result.success || result.data.location_id !== scope.squareLocationId) return [];
      return [{
        variationId: result.data.catalog_object_id,
        quantity: result.data.quantity,
        calculatedAt: result.data.calculated_at,
      }];
    });
    return inventory.length ? { ...receipt, resourceId: data.id || event.event_id, inventory } : "ignore";
  }

  if (!Object.hasOwn(resourceObjects, event.type)) return "ignore";
  const objectKey = resourceObjects[event.type as keyof typeof resourceObjects];
  const data = dataEnvelope.parse((input as { data?: unknown }).data);
  const resource = scopedResource.parse(data.object[objectKey]);
  if (resource.location_id !== scope.squareLocationId) return "ignore";

  const isOrder = event.type.startsWith("order.");
  const resourceId = isOrder ? resource.order_id : resource.id;
  // The signed payment.created example has a distinct envelope ID. The worker
  // verifies the nested Payment ID and location against Square's Payments API.
  if (!resourceId || (event.type !== "payment.created" && resourceId !== data.id)) return "ignore";
  return { ...receipt, resourceId, relatedOrderId: isOrder ? undefined : resource.order_id, inventory: [] };
}
