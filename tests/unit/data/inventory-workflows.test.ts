import { beforeEach, describe, expect, it, vi } from "vitest";
import type { WorkflowContext } from "@/data/execute";
import {
  configureInventoryCatalog,
  createInventoryTransfer,
  createPurchaseOrder,
  receiveInventoryDelivery,
  reviewInventoryTransfer,
  reviewWasteRecord,
  submitWasteRecord,
} from "@/data/workflows/inventory";

vi.mock("server-only", () => ({}));

const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  location: "33333333-3333-4333-8333-333333333333",
  destination: "44444444-4444-4444-8444-444444444444",
  vendor: "55555555-5555-4555-8555-555555555555",
  item: "66666666-6666-4666-8666-666666666666",
  unit: "77777777-7777-4777-8777-777777777777",
  record: "88888888-8888-4888-8888-888888888888",
  actor: "99999999-9999-4999-8999-999999999999",
  otherActor: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
};

function query(row: unknown) {
  const builder = {
    select: vi.fn(),
    eq: vi.fn(),
    maybeSingle: vi.fn(async () => ({ data: row, error: null })),
  };
  builder.select.mockReturnValue(builder);
  builder.eq.mockReturnValue(builder);
  return builder;
}

function context(role: "owner" | "admin" | "manager" | "employee" = "manager") {
  const rows: Record<string, unknown> = {
    locations: { id: ids.location, organization_id: ids.organization, is_active: true },
    waste_records: { id: ids.record, location_id: ids.location, recorded_by: ids.otherActor },
    inventory_transfers: { id: ids.record, to_location_id: ids.destination, created_by: ids.otherActor },
  };
  const rpc = vi.fn(async (name: string, args: Record<string, unknown>) => {
    void args;
    if (name === "configure_inventory_catalog") {
      return { data: { id: ids.record, command: "unit.save", replayed: false }, error: null };
    }
    return {
    data: {
      id: ids.record,
      status: name.includes("review") ? "approved" : "submitted",
      subtotal_cents: 750,
      delivered_at: "2026-08-02T14:00:00.000Z",
      purchase_order_id: ids.request,
      estimated_cost_cents: 250,
      approved_at: "2026-08-02T15:00:00.000Z",
      reviewed_at: "2026-08-02T15:00:00.000Z",
    },
      error: null,
    };
  });
  return {
    workflow: {
      supabase: { from: vi.fn((table: string) => query(rows[table])), rpc },
      actor: {
        userId: ids.actor,
        aal: "aal2",
        memberships: [{
          organizationId: ids.organization,
          role,
          locationIds: [ids.location, ids.destination],
          organizationWide: role === "owner" || role === "admin",
        }],
      },
    } as unknown as WorkflowContext,
    rpc,
  };
}

describe("extended inventory workflow RPC contracts", () => {
  beforeEach(() => vi.clearAllMocks());

  it("uses each frozen 015 RPC and maps only observation/resource inputs", async () => {
    const { workflow, rpc } = context();
    await createPurchaseOrder(workflow, {
      requestId: ids.request,
      locationId: ids.location,
      vendorId: ids.vendor,
      poNumber: "PO-1042",
      orderedOn: "2026-08-01",
      expectedOn: "2026-08-02",
      taxCents: 50,
      shippingCents: 0,
      notes: " Produce order ",
      lines: [{ inventoryItemId: ids.item, unitId: ids.unit, quantity: 2, unitPriceCents: 375, notes: null }],
    });
    await receiveInventoryDelivery(workflow, {
      requestId: ids.request,
      locationId: ids.location,
      vendorId: ids.vendor,
      purchaseOrderId: ids.record,
      deliveredAt: "2026-08-02T14:00:00.000Z",
      invoiceNumber: "INV-1042",
      notes: null,
      lines: [{ inventoryItemId: ids.item, unitId: ids.unit, quantity: 2, acceptedQuantity: 1.75, unitPriceCents: 375, lotCode: "LOT-1", expiresOn: "2026-08-09" }],
    });
    await submitWasteRecord(workflow, {
      requestId: ids.request,
      locationId: ids.location,
      inventoryItemId: ids.item,
      unitId: ids.unit,
      quantity: 0.5,
      reasonCode: "quality",
      occurredAt: "2026-08-02T14:30:00.000Z",
      notes: null,
    });
    await reviewWasteRecord(workflow, {
      requestId: ids.request,
      wasteRecordId: ids.record,
      approve: true,
      note: "Verified",
    });
    await createInventoryTransfer(workflow, {
      requestId: ids.request,
      fromLocationId: ids.location,
      toLocationId: ids.destination,
      notes: null,
      lines: [{ inventoryItemId: ids.item, unitId: ids.unit, sentQuantity: 3 }],
    });
    await reviewInventoryTransfer(workflow, {
      requestId: ids.request,
      transferId: ids.record,
      approve: true,
      note: "Received",
      lines: [{ inventoryItemId: ids.item, unitId: ids.unit, receivedQuantity: 2.75 }],
    });

    expect(rpc.mock.calls.map(([name]) => name)).toEqual([
      "create_purchase_order",
      "receive_inventory_delivery",
      "submit_waste_record",
      "review_waste_record",
      "create_inventory_transfer",
      "review_inventory_transfer",
    ]);
    expect(rpc.mock.calls.map(([, args]) => Object.keys(args).sort())).toEqual([
      ["p_expected_on", "p_lines", "p_location_id", "p_notes", "p_ordered_on", "p_po_number", "p_request_id", "p_shipping_cents", "p_tax_cents", "p_vendor_id"],
      ["p_delivered_at", "p_invoice_number", "p_lines", "p_location_id", "p_notes", "p_purchase_order_id", "p_request_id", "p_vendor_id"],
      ["p_inventory_item_id", "p_location_id", "p_notes", "p_occurred_at", "p_quantity", "p_reason_code", "p_request_id", "p_unit_id"],
      ["p_approve", "p_note", "p_request_id", "p_waste_record_id"],
      ["p_from_location_id", "p_lines", "p_notes", "p_request_id", "p_to_location_id"],
      ["p_approve", "p_lines", "p_note", "p_request_id", "p_transfer_id"],
    ]);
    expect(rpc.mock.calls[0][1].p_lines).toEqual([{ inventory_item_id: ids.item, unit_id: ids.unit, quantity: 2, unit_price_cents: 375, notes: null }]);
    expect(rpc.mock.calls[1][1].p_lines).toEqual([{ inventory_item_id: ids.item, unit_id: ids.unit, quantity: 2, accepted_quantity: 1.75, unit_price_cents: 375, lot_code: "LOT-1", expires_on: "2026-08-09" }]);
    expect(rpc.mock.calls[5][1].p_lines).toEqual([{ inventory_item_id: ids.item, unit_id: ids.unit, received_quantity: 2.75 }]);
    for (const [, args] of rpc.mock.calls) {
      expect(args).not.toHaveProperty("organization_id");
      expect(args).not.toHaveProperty("actor_id");
      expect(args).not.toHaveProperty("approved_by");
    }
  });

  it("blocks an employee before any critical command RPC is called", async () => {
    const { workflow, rpc } = context("employee");
    await expect(createPurchaseOrder(workflow, {
      requestId: ids.request,
      locationId: ids.location,
      vendorId: ids.vendor,
      poNumber: "PO-BLOCKED",
      orderedOn: null,
      expectedOn: null,
      taxCents: 0,
      shippingCents: 0,
      notes: null,
      lines: [{ inventoryItemId: ids.item, unitId: ids.unit, quantity: 1, unitPriceCents: 100, notes: null }],
    })).rejects.toMatchObject({ code: "forbidden" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("blocks self-review before waste or transfer decision RPCs", async () => {
    const { workflow, rpc } = context();
    const from = workflow.supabase.from as unknown as ReturnType<typeof vi.fn>;
    from.mockImplementation((table: string) => query(
      table === "locations"
        ? { id: ids.location, organization_id: ids.organization, is_active: true }
        : table === "waste_records"
          ? { id: ids.record, location_id: ids.location, recorded_by: ids.actor }
          : { id: ids.record, to_location_id: ids.destination, created_by: ids.actor },
    ));
    await expect(reviewWasteRecord(workflow, { requestId: ids.request, wasteRecordId: ids.record, approve: true, note: null })).rejects.toMatchObject({ code: "conflict" });
    await expect(reviewInventoryTransfer(workflow, { requestId: ids.request, transferId: ids.record, approve: true, note: null, lines: [{ inventoryItemId: ids.item, unitId: ids.unit, receivedQuantity: 1 }] })).rejects.toMatchObject({ code: "conflict" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("derives catalog tenant scope and requires the precise Manager capability", async () => {
    const { workflow, rpc } = context("admin");
    await configureInventoryCatalog(workflow, {
      requestId: ids.request,
      workspaceLocationId: ids.location,
      command: "unit.save",
      id: null,
      name: "Ounce",
      symbol: "oz",
      dimension: "mass",
      isBase: true,
      isActive: true,
    });
    expect(rpc).toHaveBeenCalledWith("configure_inventory_catalog", {
      p_request_id: ids.request,
      p_organization_id: ids.organization,
      p_command: "unit.save",
      p_payload: {
        id: null,
        name: "Ounce",
        symbol: "oz",
        dimension: "mass",
        isBase: true,
        isActive: true,
      },
    });

    const manager = context("manager");
    await expect(configureInventoryCatalog(manager.workflow, {
      requestId: ids.request,
      workspaceLocationId: ids.location,
      command: "unit.save",
      id: null,
      name: "Each",
      symbol: "ea",
      dimension: "count",
      isBase: true,
      isActive: true,
    })).rejects.toMatchObject({ code: "forbidden" });
    expect(manager.rpc).toHaveBeenCalledTimes(1);
    expect(manager.rpc).toHaveBeenCalledWith("has_capability", {
      p_capability_key: "inventory.unit.manage",
      p_location_id: ids.location,
      p_organization_id: ids.organization,
    });
    expect(manager.rpc).not.toHaveBeenCalledWith("configure_kitchen_foundation", expect.anything());
  });
});
