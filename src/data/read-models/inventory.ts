import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/server";
import { localDateKey, readFailure, readSuccess, type LiveReadResult } from "./shared";

export interface LiveInventoryItem {
  id: string;
  name: string;
  sku: string | null;
  category: string;
  baseUnitId: string;
  unitSymbol: string;
  onHand: number;
  par: number | null;
  reorder: number | null;
  lastUnitCostCents: number | null;
  inventoryValueCents: number | null;
  lastMovementAt: string | null;
  compatibleUnitIds: string[];
}

export interface LiveInventoryUnit {
  id: string;
  name: string;
  symbol: string;
  dimension: string;
}

export interface LiveInventoryCount {
  id: string;
  status: string;
  countType: string;
  countedAt: string;
  countedByUserId: string;
  countedBy: string;
  approvedBy: string | null;
  approvedAt: string | null;
  notes: string | null;
  lines: Array<{
    id: string;
    inventoryItemId: string;
    unitId: string;
    expectedQuantity: number | null;
    countedQuantity: number;
    unitCostCents: number | null;
  }>;
}

export interface LiveInventoryVendor {
  id: string;
  name: string;
  contactName: string | null;
  email: string | null;
  phone: string | null;
  paymentTerms: string | null;
}

export interface LivePurchaseOrder {
  id: string;
  vendorId: string;
  vendorName: string;
  poNumber: string;
  status: string;
  orderedOn: string | null;
  expectedOn: string | null;
  subtotalCents: number;
  taxCents: number;
  shippingCents: number;
  totalCents: number;
  lineCount: number;
  lines: Array<{
    id: string;
    inventoryItemId: string;
    itemName: string;
    unitId: string;
    unitSymbol: string;
    quantity: number;
    receivedQuantity: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }>;
}

export interface LiveInventoryDelivery {
  id: string;
  vendorId: string;
  vendorName: string;
  purchaseOrderId: string | null;
  poNumber: string | null;
  deliveredAt: string;
  invoiceNumber: string | null;
  receivedBy: string;
  notes: string | null;
  lines: Array<{
    id: string;
    inventoryItemId: string;
    itemName: string;
    unitId: string;
    unitSymbol: string;
    quantity: number;
    acceptedQuantity: number;
    unitPriceCents: number;
    lotCode: string | null;
    expiresOn: string | null;
  }>;
}

export interface LiveWasteRecord {
  id: string;
  inventoryItemId: string;
  itemName: string;
  unitId: string;
  unitSymbol: string;
  quantity: number;
  reasonCode: string;
  estimatedCostCents: number | null;
  occurredAt: string;
  notes: string | null;
  status: string;
  recordedByUserId: string;
  recordedBy: string;
  reviewedBy: string | null;
  approvedAt: string | null;
  reviewNote: string | null;
}

export interface LiveInventoryTransfer {
  id: string;
  fromLocationId: string;
  fromLocationName: string;
  toLocationId: string;
  toLocationName: string;
  status: string;
  createdByUserId: string;
  createdBy: string;
  reviewedBy: string | null;
  reviewedAt: string | null;
  notes: string | null;
  reviewNote: string | null;
  createdAt: string;
  lines: Array<{
    id: string;
    inventoryItemId: string;
    itemName: string;
    unitId: string;
    unitSymbol: string;
    sentQuantity: number;
    receivedQuantity: number | null;
  }>;
}

export interface LiveRecipe {
  id: string;
  name: string;
  yieldQuantity: number;
  yieldUnit: string;
  menuPriceCents: number | null;
  ingredientCount: number;
  knownCostCents: number;
  missingCostCount: number;
}

export interface LiveInventoryCatalog {
  units: Array<LiveInventoryUnit & {
    isBase: boolean;
    isActive: boolean;
    updatedAt: string;
  }>;
  conversions: Array<{
    id: string;
    fromUnitId: string;
    toUnitId: string;
    inventoryItemId: string | null;
    multiplier: number;
    isActive: boolean;
    updatedAt: string;
  }>;
  categories: Array<{
    id: string;
    name: string;
    parentId: string | null;
    isActive: boolean;
    updatedAt: string;
  }>;
  vendors: Array<LiveInventoryVendor & {
    accountNumber: string | null;
    isActive: boolean;
  }>;
  items: Array<{
    id: string;
    name: string;
    sku: string | null;
    description: string | null;
    categoryId: string | null;
    baseUnitId: string;
    trackInventory: boolean;
    isActive: boolean;
  }>;
  vendorItems: Array<{
    id: string;
    vendorId: string;
    inventoryItemId: string;
    purchaseUnitId: string;
    vendorSku: string | null;
    packQuantity: number;
    lastPriceCents: number | null;
    isPreferred: boolean;
    isActive: boolean;
  }>;
  pars: Array<{
    id: string;
    locationId: string;
    inventoryItemId: string;
    parQuantity: number;
    reorderQuantity: number | null;
    effectiveFrom: string;
  }>;
  recipes: Array<{
    id: string;
    name: string;
    yieldQuantity: number;
    yieldUnitId: string;
    menuPriceCents: number | null;
    isActive: boolean;
    ingredients: Array<{
      inventoryItemId: string;
      unitId: string;
      quantity: number;
      wasteFactor: number;
    }>;
  }>;
}

export interface LiveInventoryModel {
  date: string;
  timeZone: string;
  currencyCode: string;
  items: LiveInventoryItem[];
  units: LiveInventoryUnit[];
  locations: Array<{ id: string; name: string }>;
  counts: LiveInventoryCount[];
  vendors: LiveInventoryVendor[];
  orders: LivePurchaseOrder[];
  deliveries: LiveInventoryDelivery[];
  waste: LiveWasteRecord[];
  transfers: LiveInventoryTransfer[];
  recipes: LiveRecipe[];
  catalog?: LiveInventoryCatalog;
}

export async function loadLiveInventory(
  workspace: WorkspaceContextValue,
): Promise<LiveReadResult<LiveInventoryModel>> {
  if (workspace.role === "employee") return readFailure("Management access is required.");
  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const locationId = workspace.activeLocation.id;
    const [locationResult, organizationResult] = await Promise.all([
      supabase
        .from("locations")
        .select("timezone")
        .eq("organization_id", organizationId)
        .eq("id", locationId)
        .single(),
      supabase
        .from("organizations")
        .select("currency_code")
        .eq("id", organizationId)
        .single(),
    ]);
    const location = locationResult.data;
    const organization = organizationResult.data;
    if (locationResult.error || organizationResult.error || !location || !organization) {
      return readFailure();
    }
    const date = localDateKey(new Date(), location.timezone);

    const [
      itemResult,
      unitResult,
      conversionResult,
      categoryResult,
      onHandResult,
      parResult,
      countResult,
      vendorResult,
      vendorItemResult,
      orderResult,
      deliveryResult,
      wasteResult,
      transferResult,
      recipeResult,
      priceResult,
      locationChoiceResult,
    ] = await Promise.all([
        supabase
          .from("inventory_items")
          .select("id, category_id, base_unit_id, name, sku, description, track_inventory, is_active")
          .eq("organization_id", organizationId)
          .order("name"),
        supabase
          .from("measurement_units")
          .select("*")
          .eq("organization_id", organizationId)
          .order("name"),
        supabase
          .from("unit_conversions")
          .select("*")
          .eq("organization_id", organizationId),
        supabase
          .from("inventory_categories")
          .select("*")
          .eq("organization_id", organizationId),
        supabase
          .from("inventory_on_hand")
          .select("inventory_item_id, quantity_on_hand, last_movement_at")
          .eq("organization_id", organizationId)
          .eq("location_id", locationId),
        supabase
          .from("inventory_par_levels")
          .select("id, location_id, inventory_item_id, par_quantity, reorder_quantity, effective_from")
          .eq("organization_id", organizationId)
          .order("effective_from", { ascending: false }),
        supabase
          .from("inventory_counts")
          .select("id, status, count_type, counted_at, counted_by, approved_by, approved_at, notes")
          .eq("organization_id", organizationId)
          .eq("location_id", locationId)
          .order("counted_at", { ascending: false })
          .limit(24),
        supabase
          .from("vendors")
          .select("id, name, account_number, contact_name, email, phone, payment_terms, is_active")
          .eq("organization_id", organizationId)
          .order("name"),
        supabase
          .from("vendor_items")
          .select("*")
          .eq("organization_id", organizationId)
          .order("created_at"),
        supabase
          .from("purchase_orders")
          .select("id, vendor_id, po_number, status, ordered_on, expected_on, subtotal_cents, tax_cents, shipping_cents")
          .eq("organization_id", organizationId)
          .eq("location_id", locationId)
          .order("created_at", { ascending: false })
          .limit(40),
        supabase
          .from("deliveries")
          .select("id, vendor_id, purchase_order_id, delivered_at, invoice_number, received_by, notes")
          .eq("organization_id", organizationId)
          .eq("location_id", locationId)
          .order("delivered_at", { ascending: false })
          .limit(40),
        supabase
          .from("waste_records")
          .select("id, inventory_item_id, unit_id, quantity, reason_code, estimated_cost_cents, occurred_at, notes, status, recorded_by, approved_by, approved_at, review_note")
          .eq("organization_id", organizationId)
          .eq("location_id", locationId)
          .order("occurred_at", { ascending: false })
          .limit(80),
        supabase
          .from("inventory_transfers")
          .select("id, from_location_id, to_location_id, status, created_by, reviewed_by, reviewed_at, notes, review_note, created_at")
          .eq("organization_id", organizationId)
          .or(`from_location_id.eq.${locationId},to_location_id.eq.${locationId}`)
          .order("created_at", { ascending: false })
          .limit(60),
        supabase
          .from("recipes")
          .select("id, name, yield_quantity, yield_unit_id, menu_price_cents, is_active")
          .eq("organization_id", organizationId)
          .order("name"),
        supabase
          .from("item_price_history")
          .select("inventory_item_id, unit_id, unit_price_cents, effective_at")
          .eq("organization_id", organizationId)
          .order("effective_at", { ascending: false })
          .limit(2_000),
        supabase
          .from("locations")
          .select("id, name")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("name"),
      ]);
    if ([
      itemResult,
      unitResult,
      conversionResult,
      categoryResult,
      onHandResult,
      parResult,
      countResult,
      vendorResult,
      vendorItemResult,
      orderResult,
      deliveryResult,
      wasteResult,
      transferResult,
      recipeResult,
      priceResult,
      locationChoiceResult,
    ].some((queryResult) => queryResult.error)) {
      return readFailure();
    }

    const unitRows = (unitResult.data ?? []) as unknown as Array<{
      id: string;
      name: string;
      symbol: string;
      dimension: string;
      is_base: boolean;
      is_active: boolean;
      updated_at: string;
    }>;
    const conversionRows = (conversionResult.data ?? []) as unknown as Array<{
      id: string;
      from_unit_id: string;
      to_unit_id: string;
      item_id: string | null;
      multiplier: number | string;
      is_active: boolean;
      updated_at: string;
    }>;
    const categoryRows = (categoryResult.data ?? []) as unknown as Array<{
      id: string;
      name: string;
      parent_id: string | null;
      is_active: boolean;
      updated_at: string;
    }>;
    const vendorItemRows = (vendorItemResult.data ?? []) as unknown as Array<{
      id: string;
      vendor_id: string;
      inventory_item_id: string;
      purchase_unit_id: string;
      vendor_sku: string | null;
      pack_quantity: number | string;
      last_price_cents: number | null;
      is_preferred: boolean;
      is_active: boolean;
    }>;

    const countIds = (countResult.data ?? []).map((count) => count.id);
    const orderIds = (orderResult.data ?? []).map((order) => order.id);
    const deliveryIds = (deliveryResult.data ?? []).map((delivery) => delivery.id);
    const transferIds = (transferResult.data ?? []).map((transfer) => transfer.id);
    const recipeIds = (recipeResult.data ?? []).map((recipe) => recipe.id);
    const profileIds = [
      ...(countResult.data ?? []).flatMap((row) =>
        row.approved_by ? [row.counted_by, row.approved_by] : [row.counted_by],
      ),
      ...(deliveryResult.data ?? []).map((row) => row.received_by),
      ...(wasteResult.data ?? []).flatMap((row) =>
        row.approved_by ? [row.recorded_by, row.approved_by] : [row.recorded_by],
      ),
      ...(transferResult.data ?? []).flatMap((row) =>
        row.reviewed_by ? [row.created_by, row.reviewed_by] : [row.created_by],
      ),
    ];
    const emptyResult = Promise.resolve({ data: [], error: null });
    const [
      countLineResult,
      orderLineResult,
      orderDeliveryResult,
      transferLineResult,
      ingredientResult,
      profileResult,
    ] = await Promise.all([
      countIds.length
        ? supabase
            .from("inventory_count_lines")
            .select("id, inventory_count_id, inventory_item_id, unit_id, expected_quantity, counted_quantity, unit_cost_cents")
            .eq("organization_id", organizationId)
            .in("inventory_count_id", countIds)
        : emptyResult,
      orderIds.length
        ? supabase
            .from("purchase_order_lines")
            .select("id, purchase_order_id, inventory_item_id, unit_id, quantity, unit_price_cents, line_total_cents")
            .eq("organization_id", organizationId)
            .in("purchase_order_id", orderIds)
        : emptyResult,
      orderIds.length
        ? supabase
            .from("deliveries")
            .select("id, purchase_order_id")
            .eq("organization_id", organizationId)
            .in("purchase_order_id", orderIds)
        : emptyResult,
      transferIds.length
        ? supabase
            .from("inventory_transfer_lines")
            .select("id, transfer_id, inventory_item_id, unit_id, sent_quantity, received_quantity")
            .eq("organization_id", organizationId)
            .in("transfer_id", transferIds)
        : emptyResult,
      recipeIds.length
        ? supabase
            .from("recipe_ingredients")
            .select("recipe_id, inventory_item_id, unit_id, quantity, waste_factor")
            .eq("organization_id", organizationId)
            .in("recipe_id", recipeIds)
        : emptyResult,
      profileIds.length
        ? supabase
            .from("profiles")
            .select("id, display_name, preferred_name")
            .in("id", [...new Set(profileIds)])
        : emptyResult,
    ]);
    if (
      countLineResult.error ||
      orderLineResult.error ||
      orderDeliveryResult.error ||
      transferLineResult.error ||
      ingredientResult.error ||
      profileResult.error
    ) {
      return readFailure();
    }

    const allDeliveryIds = [...new Set([
      ...deliveryIds,
      ...(orderDeliveryResult.data ?? []).map((delivery) => delivery.id),
    ])];
    const deliveryLineResult = allDeliveryIds.length
      ? await supabase
          .from("delivery_lines")
          .select("id, delivery_id, inventory_item_id, unit_id, quantity, accepted_quantity, unit_price_cents, lot_code, expires_on")
          .eq("organization_id", organizationId)
          .in("delivery_id", allDeliveryIds)
      : { data: [], error: null };
    if (deliveryLineResult.error) return readFailure();

    const units = new Map(unitRows.map((unit) => [unit.id, unit]));
    const categories = new Map(categoryRows.map((category) => [category.id, category.name]));
    const onHand = new Map((onHandResult.data ?? []).map((row) => [row.inventory_item_id, row]));
    const currentPar = new Map<
      string,
      NonNullable<typeof parResult.data>[number]
    >();
    for (const par of parResult.data ?? []) {
      if (
        par.location_id === locationId &&
        par.effective_from <= date &&
        !currentPar.has(par.inventory_item_id)
      ) currentPar.set(par.inventory_item_id, par);
    }
    const latestPrice = new Map<
      string,
      NonNullable<typeof priceResult.data>[number]
    >();
    for (const price of priceResult.data ?? []) {
      const key = `${price.inventory_item_id}:${price.unit_id}`;
      if (!latestPrice.has(key)) latestPrice.set(key, price);
    }
    const vendors = new Map((vendorResult.data ?? []).map((vendor) => [vendor.id, vendor]));
    const items = new Map((itemResult.data ?? []).map((item) => [item.id, item]));
    const locations = new Map(
      (locationChoiceResult.data ?? []).map((locationOption) => [locationOption.id, locationOption.name]),
    );
    const profiles = new Map(
      (profileResult.data ?? []).map((profile) => [
        profile.id,
        profile.preferred_name?.trim() || profile.display_name,
      ]),
    );

    return readSuccess({
      date,
      timeZone: location.timezone,
      currencyCode: organization.currency_code,
      items: (itemResult.data ?? [])
        .filter((item) => item.is_active && item.track_inventory)
        .map((item) => {
        const movement = onHand.get(item.id);
        const par = currentPar.get(item.id);
        const price = latestPrice.get(`${item.id}:${item.base_unit_id}`);
        const quantity = Number(movement?.quantity_on_hand ?? 0);
        const cost = price ? Number(price.unit_price_cents) : null;
        const compatibleUnitIds = new Set([item.base_unit_id]);
        for (const conversion of conversionRows) {
          if (!conversion.is_active) continue;
          if (conversion.item_id !== null && conversion.item_id !== item.id) continue;
          if (conversion.from_unit_id === item.base_unit_id) {
            compatibleUnitIds.add(conversion.to_unit_id);
          }
          if (conversion.to_unit_id === item.base_unit_id) {
            compatibleUnitIds.add(conversion.from_unit_id);
          }
        }
        return {
          id: item.id,
          name: item.name,
          sku: item.sku,
          category: item.category_id ? categories.get(item.category_id) ?? "Uncategorized" : "Uncategorized",
          baseUnitId: item.base_unit_id,
          unitSymbol: units.get(item.base_unit_id)?.symbol ?? "unit",
          onHand: quantity,
          par: par ? Number(par.par_quantity) : null,
          reorder: par?.reorder_quantity == null ? null : Number(par.reorder_quantity),
          lastUnitCostCents: cost,
          inventoryValueCents: cost === null ? null : Math.round(quantity * cost),
          lastMovementAt: movement?.last_movement_at ?? null,
          compatibleUnitIds: [...compatibleUnitIds],
        };
      }),
      units: unitRows.filter((unit) => unit.is_active).map((unit) => ({
        id: unit.id,
        name: unit.name,
        symbol: unit.symbol,
        dimension: unit.dimension,
      })),
      locations: (locationChoiceResult.data ?? []).map((locationOption) => ({
        id: locationOption.id,
        name: locationOption.name,
      })),
      counts: (countResult.data ?? []).map((count) => ({
        id: count.id,
        status: count.status,
        countType: count.count_type,
        countedAt: count.counted_at,
        countedByUserId: count.counted_by,
        countedBy: profiles.get(count.counted_by) ?? "Management",
        approvedBy: count.approved_by ? profiles.get(count.approved_by) ?? "Management" : null,
        approvedAt: count.approved_at,
        notes: count.notes,
        lines: (countLineResult.data ?? [])
          .filter((line) => line.inventory_count_id === count.id)
          .map((line) => ({
            id: line.id,
            inventoryItemId: line.inventory_item_id,
            unitId: line.unit_id,
            expectedQuantity: line.expected_quantity == null ? null : Number(line.expected_quantity),
            countedQuantity: Number(line.counted_quantity),
            unitCostCents: line.unit_cost_cents == null ? null : Number(line.unit_cost_cents),
          })),
      })),
      vendors: (vendorResult.data ?? []).filter((vendor) => vendor.is_active).map((vendor) => ({
        id: vendor.id,
        name: vendor.name,
        contactName: vendor.contact_name,
        email: vendor.email,
        phone: vendor.phone,
        paymentTerms: vendor.payment_terms,
      })),
      orders: (orderResult.data ?? []).map((order) => ({
        id: order.id,
        vendorId: order.vendor_id,
        vendorName: vendors.get(order.vendor_id)?.name ?? "Vendor",
        poNumber: order.po_number,
        status: order.status,
        orderedOn: order.ordered_on,
        expectedOn: order.expected_on,
        subtotalCents: Number(order.subtotal_cents),
        taxCents: Number(order.tax_cents),
        shippingCents: Number(order.shipping_cents),
        totalCents: Number(order.subtotal_cents) + Number(order.tax_cents) + Number(order.shipping_cents),
        lineCount: (orderLineResult.data ?? []).filter((line) => line.purchase_order_id === order.id).length,
        lines: (orderLineResult.data ?? [])
          .filter((line) => line.purchase_order_id === order.id)
          .map((line) => {
            const matchingDeliveryIds = new Set(
              (orderDeliveryResult.data ?? [])
                .filter((delivery) => delivery.purchase_order_id === order.id)
                .map((delivery) => delivery.id),
            );
            const receivedQuantity = (deliveryLineResult.data ?? [])
              .filter((deliveryLine) =>
                matchingDeliveryIds.has(deliveryLine.delivery_id) &&
                deliveryLine.inventory_item_id === line.inventory_item_id &&
                deliveryLine.unit_id === line.unit_id,
              )
              .reduce((sum, deliveryLine) => sum + Number(deliveryLine.accepted_quantity), 0);
            return {
              id: line.id,
              inventoryItemId: line.inventory_item_id,
              itemName: items.get(line.inventory_item_id)?.name ?? "Inventory item",
              unitId: line.unit_id,
              unitSymbol: units.get(line.unit_id)?.symbol ?? "unit",
              quantity: Number(line.quantity),
              receivedQuantity,
              unitPriceCents: Number(line.unit_price_cents),
              lineTotalCents: Number(line.line_total_cents),
            };
          }),
      })),
      deliveries: (deliveryResult.data ?? []).map((delivery) => {
        const order = delivery.purchase_order_id
          ? (orderResult.data ?? []).find((candidate) => candidate.id === delivery.purchase_order_id)
          : null;
        return {
          id: delivery.id,
          vendorId: delivery.vendor_id,
          vendorName: vendors.get(delivery.vendor_id)?.name ?? "Vendor",
          purchaseOrderId: delivery.purchase_order_id,
          poNumber: order?.po_number ?? null,
          deliveredAt: delivery.delivered_at,
          invoiceNumber: delivery.invoice_number,
          receivedBy: profiles.get(delivery.received_by) ?? "Management",
          notes: delivery.notes,
          lines: (deliveryLineResult.data ?? [])
            .filter((line) => line.delivery_id === delivery.id)
            .map((line) => ({
              id: line.id,
              inventoryItemId: line.inventory_item_id,
              itemName: items.get(line.inventory_item_id)?.name ?? "Inventory item",
              unitId: line.unit_id,
              unitSymbol: units.get(line.unit_id)?.symbol ?? "unit",
              quantity: Number(line.quantity),
              acceptedQuantity: Number(line.accepted_quantity),
              unitPriceCents: Number(line.unit_price_cents),
              lotCode: line.lot_code,
              expiresOn: line.expires_on,
            })),
        };
      }),
      waste: (wasteResult.data ?? []).map((record) => ({
        id: record.id,
        inventoryItemId: record.inventory_item_id,
        itemName: items.get(record.inventory_item_id)?.name ?? "Inventory item",
        unitId: record.unit_id,
        unitSymbol: units.get(record.unit_id)?.symbol ?? "unit",
        quantity: Number(record.quantity),
        reasonCode: record.reason_code,
        estimatedCostCents: record.estimated_cost_cents == null ? null : Number(record.estimated_cost_cents),
        occurredAt: record.occurred_at,
        notes: record.notes,
        status: record.status,
        recordedByUserId: record.recorded_by,
        recordedBy: profiles.get(record.recorded_by) ?? "Management",
        reviewedBy: record.approved_by ? profiles.get(record.approved_by) ?? "Management" : null,
        approvedAt: record.approved_at,
        reviewNote: record.review_note,
      })),
      transfers: (transferResult.data ?? []).map((transfer) => ({
        id: transfer.id,
        fromLocationId: transfer.from_location_id,
        fromLocationName: locations.get(transfer.from_location_id) ?? "Source location",
        toLocationId: transfer.to_location_id,
        toLocationName: locations.get(transfer.to_location_id) ?? "Destination location",
        status: transfer.status,
        createdByUserId: transfer.created_by,
        createdBy: profiles.get(transfer.created_by) ?? "Management",
        reviewedBy: transfer.reviewed_by
          ? profiles.get(transfer.reviewed_by) ?? "Management"
          : null,
        reviewedAt: transfer.reviewed_at,
        notes: transfer.notes,
        reviewNote: transfer.review_note,
        createdAt: transfer.created_at,
        lines: (transferLineResult.data ?? [])
          .filter((line) => line.transfer_id === transfer.id)
          .map((line) => ({
            id: line.id,
            inventoryItemId: line.inventory_item_id,
            itemName: items.get(line.inventory_item_id)?.name ?? "Inventory item",
            unitId: line.unit_id,
            unitSymbol: units.get(line.unit_id)?.symbol ?? "unit",
            sentQuantity: Number(line.sent_quantity),
            receivedQuantity: line.received_quantity == null
              ? null
              : Number(line.received_quantity),
          })),
      })),
      recipes: (recipeResult.data ?? []).filter((recipe) => recipe.is_active).map((recipe) => {
        const ingredients = (ingredientResult.data ?? []).filter((row) => row.recipe_id === recipe.id);
        let knownCostCents = 0;
        let missingCostCount = 0;
        for (const ingredient of ingredients) {
          const price = latestPrice.get(`${ingredient.inventory_item_id}:${ingredient.unit_id}`);
          if (!price) {
            missingCostCount += 1;
            continue;
          }
          knownCostCents += Math.round(
            Number(ingredient.quantity) *
              Number(price.unit_price_cents) /
              (1 - Number(ingredient.waste_factor)),
          );
        }
        return {
          id: recipe.id,
          name: recipe.name,
          yieldQuantity: Number(recipe.yield_quantity),
          yieldUnit: units.get(recipe.yield_unit_id)?.symbol ?? "unit",
          menuPriceCents: recipe.menu_price_cents == null ? null : Number(recipe.menu_price_cents),
          ingredientCount: ingredients.length,
          knownCostCents,
          missingCostCount,
        };
      }),
      catalog: {
        units: unitRows.map((unit) => ({
          id: unit.id,
          name: unit.name,
          symbol: unit.symbol,
          dimension: unit.dimension,
          isBase: unit.is_base,
          isActive: unit.is_active,
          updatedAt: unit.updated_at,
        })),
        conversions: conversionRows.map((conversion) => ({
          id: conversion.id,
          fromUnitId: conversion.from_unit_id,
          toUnitId: conversion.to_unit_id,
          inventoryItemId: conversion.item_id,
          multiplier: Number(conversion.multiplier),
          isActive: conversion.is_active,
          updatedAt: conversion.updated_at,
        })),
        categories: categoryRows.map((category) => ({
          id: category.id,
          name: category.name,
          parentId: category.parent_id,
          isActive: category.is_active,
          updatedAt: category.updated_at,
        })),
        vendors: (vendorResult.data ?? []).map((vendor) => ({
          id: vendor.id,
          name: vendor.name,
          accountNumber: vendor.account_number,
          contactName: vendor.contact_name,
          email: vendor.email,
          phone: vendor.phone,
          paymentTerms: vendor.payment_terms,
          isActive: vendor.is_active,
        })),
        items: (itemResult.data ?? []).map((item) => ({
          id: item.id,
          name: item.name,
          sku: item.sku,
          description: item.description,
          categoryId: item.category_id,
          baseUnitId: item.base_unit_id,
          trackInventory: item.track_inventory,
          isActive: item.is_active,
        })),
        vendorItems: vendorItemRows.map((vendorItem) => ({
          id: vendorItem.id,
          vendorId: vendorItem.vendor_id,
          inventoryItemId: vendorItem.inventory_item_id,
          purchaseUnitId: vendorItem.purchase_unit_id,
          vendorSku: vendorItem.vendor_sku,
          packQuantity: Number(vendorItem.pack_quantity),
          lastPriceCents: vendorItem.last_price_cents == null
            ? null
            : Number(vendorItem.last_price_cents),
          isPreferred: vendorItem.is_preferred,
          isActive: vendorItem.is_active,
        })),
        pars: (parResult.data ?? []).map((par) => ({
          id: par.id,
          locationId: par.location_id,
          inventoryItemId: par.inventory_item_id,
          parQuantity: Number(par.par_quantity),
          reorderQuantity: par.reorder_quantity == null ? null : Number(par.reorder_quantity),
          effectiveFrom: par.effective_from,
        })),
        recipes: (recipeResult.data ?? []).map((recipe) => ({
          id: recipe.id,
          name: recipe.name,
          yieldQuantity: Number(recipe.yield_quantity),
          yieldUnitId: recipe.yield_unit_id,
          menuPriceCents: recipe.menu_price_cents == null
            ? null
            : Number(recipe.menu_price_cents),
          isActive: recipe.is_active,
          ingredients: (ingredientResult.data ?? [])
            .filter((ingredient) => ingredient.recipe_id === recipe.id)
            .map((ingredient) => ({
              inventoryItemId: ingredient.inventory_item_id,
              unitId: ingredient.unit_id,
              quantity: Number(ingredient.quantity),
              wasteFactor: Number(ingredient.waste_factor),
            })),
        })),
      },
    });
  } catch {
    return readFailure();
  }
}
