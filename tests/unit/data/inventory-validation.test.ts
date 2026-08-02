import { describe, expect, it } from "vitest";
import {
  approveInventoryCountInputSchema,
  configureInventoryCatalogInputSchema,
  createInventoryTransferInputSchema,
  createPurchaseOrderInputSchema,
  receiveInventoryDeliveryInputSchema,
  reviewInventoryTransferInputSchema,
  reviewWasteRecordInputSchema,
  submitInventoryCountInputSchema,
  submitWasteRecordInputSchema,
} from "@/data/schemas";
import {
  parseInventoryMoneyToCents,
  parseInventoryQuantity,
} from "@/lib/inventory/input-parsing";

const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  location: "22222222-2222-4222-8222-222222222222",
  count: "33333333-3333-4333-8333-333333333333",
  item: "44444444-4444-4444-8444-444444444444",
  unit: "55555555-5555-4555-8555-555555555555",
  vendor: "66666666-6666-4666-8666-666666666666",
  destination: "77777777-7777-4777-8777-777777777777",
  organization: "88888888-8888-4888-8888-888888888888",
};

describe("inventory workflow validation", () => {
  it("accepts an independently keyed inventory review decision", () => {
    expect(
      approveInventoryCountInputSchema.safeParse({
        requestId: ids.request,
        countId: ids.count,
        approve: true,
        note: "Verified against the shelf count.",
      }).success,
    ).toBe(true);
  });

  it("rejects browser-supplied actor and tenant scope on a review", () => {
    expect(
      approveInventoryCountInputSchema.safeParse({
        requestId: ids.request,
        countId: ids.count,
        approve: false,
        note: null,
        reviewerId: ids.item,
        organizationId: ids.location,
      }).success,
    ).toBe(false);
  });

  it("bounds database quantities to numeric(16,4) precision", () => {
    const count = (countedQuantity: number) =>
      submitInventoryCountInputSchema.safeParse({
        submissionId: ids.request,
        locationId: ids.location,
        countType: "full",
        notes: null,
        lines: [
          {
            inventoryItemId: ids.item,
            unitId: ids.unit,
            expectedQuantity: 8,
            countedQuantity,
          },
        ],
      });

    expect(count(7.125).success).toBe(true);
    expect(count(7.12345).success).toBe(false);
    expect(count(1_000_000_000_000).success).toBe(false);
  });

  it("parses money into integer cents without floating-point rounding", () => {
    expect(parseInventoryMoneyToCents("0")).toBe(0);
    expect(parseInventoryMoneyToCents("12.3")).toBe(1_230);
    expect(parseInventoryMoneyToCents("90071992547409.91")).toBe(9_007_199_254_740_991);
    expect(parseInventoryMoneyToCents("1.005")).toBeNull();
    expect(parseInventoryMoneyToCents("1e3")).toBeNull();
    expect(parseInventoryMoneyToCents("-1")).toBeNull();
  });

  it("parses canonical four-decimal quantities and rejects exponent input", () => {
    expect(parseInventoryQuantity("0.1250")).toBe(0.125);
    expect(parseInventoryQuantity("0", { allowZero: true })).toBe(0);
    expect(parseInventoryQuantity("0")).toBeNull();
    expect(parseInventoryQuantity("1.00001")).toBeNull();
    expect(parseInventoryQuantity("1e2")).toBeNull();
  });

  it("validates purchase and delivery lines with exact tenant resource ids", () => {
    const order = {
      requestId: ids.request,
      locationId: ids.location,
      vendorId: ids.vendor,
      poNumber: "PO-1042",
      orderedOn: "2026-08-01",
      expectedOn: "2026-08-02",
      taxCents: 125,
      shippingCents: 0,
      notes: null,
      lines: [{ inventoryItemId: ids.item, unitId: ids.unit, quantity: 2.5, unitPriceCents: 375, notes: null }],
    };
    expect(createPurchaseOrderInputSchema.safeParse(order).success).toBe(true);
    expect(createPurchaseOrderInputSchema.safeParse({ ...order, actorId: ids.item }).success).toBe(false);
    expect(createPurchaseOrderInputSchema.safeParse({ ...order, expectedOn: "2026-07-31" }).success).toBe(false);

    expect(receiveInventoryDeliveryInputSchema.safeParse({
      requestId: ids.destination,
      locationId: ids.location,
      vendorId: ids.vendor,
      purchaseOrderId: ids.request,
      deliveredAt: "2026-08-02T14:00:00.000Z",
      invoiceNumber: "INV-1042",
      notes: null,
      lines: [{ inventoryItemId: ids.item, unitId: ids.unit, quantity: 2.5, acceptedQuantity: 2, unitPriceCents: 375, lotCode: null, expiresOn: null }],
    }).success).toBe(true);
  });

  it("enforces observed waste and independent transfer decision payload shapes", () => {
    expect(submitWasteRecordInputSchema.safeParse({
      requestId: ids.request,
      locationId: ids.location,
      inventoryItemId: ids.item,
      unitId: ids.unit,
      quantity: 1.25,
      reasonCode: "quality_issue",
      occurredAt: "2026-08-02T16:00:00.000Z",
      notes: null,
    }).success).toBe(true);
    expect(reviewWasteRecordInputSchema.safeParse({ requestId: ids.destination, wasteRecordId: ids.request, approve: true, note: null, reviewerId: ids.item }).success).toBe(false);

    expect(createInventoryTransferInputSchema.safeParse({
      requestId: ids.request,
      fromLocationId: ids.location,
      toLocationId: ids.destination,
      notes: null,
      lines: [{ inventoryItemId: ids.item, unitId: ids.unit, sentQuantity: 2 }],
    }).success).toBe(true);
    expect(reviewInventoryTransferInputSchema.safeParse({
      requestId: ids.vendor,
      transferId: ids.request,
      approve: true,
      note: null,
      lines: [{ inventoryItemId: ids.item, unitId: ids.unit, receivedQuantity: 1.75 }],
    }).success).toBe(true);
    expect(reviewInventoryTransferInputSchema.safeParse({ requestId: ids.vendor, transferId: ids.request, approve: false, note: null, lines: [{ inventoryItemId: ids.item, unitId: ids.unit, receivedQuantity: 0 }] }).success).toBe(false);
  });

  it("validates every catalog command without accepting actor or organization ids", () => {
    const base = { requestId: ids.request, workspaceLocationId: ids.location };
    const ingredient = { inventoryItemId: ids.item, unitId: ids.unit, quantity: 4, wasteFactor: 0.1 };
    const commands = [
      { ...base, command: "unit.save", id: null, name: "Ounce", symbol: "oz", dimension: "mass", isBase: true, isActive: true },
      { ...base, command: "conversion.save", id: null, fromUnitId: ids.unit, toUnitId: ids.destination, inventoryItemId: null, multiplier: 16, isActive: true },
      { ...base, command: "category.save", id: null, name: "Produce", parentId: null, isActive: true },
      { ...base, command: "vendor.save", id: null, name: "Market", accountNumber: null, contactName: null, email: "orders@market.test", phone: null, paymentTerms: "Net 15", isActive: true },
      { ...base, command: "item.save", id: null, name: "Tomatoes", sku: "TOM", description: null, categoryId: null, baseUnitId: ids.unit, trackInventory: true, isActive: true },
      { ...base, command: "vendor_item.save", id: null, vendorId: ids.vendor, inventoryItemId: ids.item, purchaseUnitId: ids.unit, vendorSku: null, packQuantity: 12, lastPriceCents: 4200, priceEffectiveAt: "2026-08-01T12:00:00.000Z", isPreferred: true, isActive: true },
      { ...base, command: "par.set", locationId: ids.location, inventoryItemId: ids.item, parQuantity: 20, reorderQuantity: 8, effectiveFrom: "2026-08-01" },
      { ...base, command: "recipe.save", id: null, name: "Tomato salad", yieldQuantity: 1, yieldUnitId: ids.unit, menuPriceCents: 1800, isActive: true, ingredients: [ingredient] },
    ];
    for (const command of commands) {
      expect(configureInventoryCatalogInputSchema.safeParse(command).success).toBe(true);
    }
    expect(configureInventoryCatalogInputSchema.safeParse({ ...commands[0], actorId: ids.item }).success).toBe(false);
    expect(configureInventoryCatalogInputSchema.safeParse({ ...commands[0], organizationId: ids.organization }).success).toBe(false);
    expect(configureInventoryCatalogInputSchema.safeParse({ ...commands[6], reorderQuantity: 21 }).success).toBe(false);
    expect(configureInventoryCatalogInputSchema.safeParse({ ...commands[7], ingredients: [ingredient, ingredient] }).success).toBe(false);
  });
});
