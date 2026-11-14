// The warehouse and dashboard should receive only these allowlisted facts.
// Money uses USD minor units. Null means Square didn't supply the amount.
import { z } from "zod";

export const churchSquareResourceId = z.string().regex(/^[A-Za-z0-9_:-]{1,192}$/);
export const churchSquareResourceKind = z.enum(["order", "payment", "refund", "invoice"]);
export type ChurchSquareResourceKind = z.infer<typeof churchSquareResourceKind>;

const instant = z.iso.datetime({ offset: true });
const date = z.iso.date();
const money = z.object({ amount: z.number().int().safe(), currency: z.literal("USD") });
const quantity = z.string().regex(/^\d{1,12}(?:\.\d{1,10})?$/);
const openEnum = z.string().regex(/^[A-Z][A-Z0-9_]{0,49}$/);
const fields = {
  id: churchSquareResourceId,
  location_id: churchSquareResourceId,
  created_at: instant,
  updated_at: instant,
};
const moneyField = money.nullish();

const orderStates = ["OPEN", "COMPLETED", "CANCELED", "DRAFT"] as const;
const paymentStates = ["APPROVED", "PENDING", "COMPLETED", "CANCELED", "FAILED"] as const;
const refundStates = ["PENDING", "COMPLETED", "REJECTED", "FAILED"] as const;
export const churchSquareInvoiceStates = [
  "DRAFT", "UNPAID", "SCHEDULED", "PARTIALLY_PAID", "PAID", "PARTIALLY_REFUNDED",
  "REFUNDED", "CANCELED", "FAILED", "PAYMENT_PENDING",
] as const;
const fulfillmentTypes = ["PICKUP", "DELIVERY", "SHIPMENT"] as const;
const fulfillmentStates = ["PROPOSED", "RESERVED", "PREPARED", "COMPLETED", "CANCELED", "FAILED"] as const;
const tenderTypes = ["CARD", "CASH", "THIRD_PARTY_CARD", "SQUARE_GIFT_CARD", "NO_SALE", "OTHER"] as const;
const paymentSources = [
  "CARD", "BANK_ACCOUNT", "WALLET", "BUY_NOW_PAY_LATER", "SQUARE_ACCOUNT", "CASH", "EXTERNAL",
] as const;
const feeTypes = ["INITIAL", "ADJUSTMENT"] as const;
const requestTypes = ["DEPOSIT", "BALANCE", "INSTALLMENT"] as const;

function known<T extends string>(value: string, values: readonly T[]): T | "UNKNOWN" {
  return values.includes(value as T) ? value as T : "UNKNOWN";
}

function cents(value?: { amount: number } | null): number | null {
  return value?.amount ?? null;
}

const modifier = z.object({
  uid: churchSquareResourceId.nullish(),
  catalog_object_id: churchSquareResourceId.nullish(),
  quantity: quantity.nullish(),
  total_price_money: moneyField,
});

const line = z.object({
  uid: churchSquareResourceId.nullish(),
  catalog_object_id: churchSquareResourceId.nullish(),
  catalog_version: z.number().int().nonnegative().safe().nullish(),
  item_type: openEnum.nullish(),
  quantity,
  quantity_unit: z.unknown().optional(),
  total_money: moneyField,
  total_tax_money: moneyField,
  total_discount_money: moneyField,
  modifiers: z.array(modifier).max(500).nullish(),
});

const fulfillmentDates = z.object({
  placed_at: instant.nullish(),
  ready_at: instant.nullish(),
  completed_at: instant.nullish(),
  canceled_at: instant.nullish(),
  rejected_at: instant.nullish(),
});
const fulfillment = z.object({
  uid: churchSquareResourceId.nullish(),
  type: openEnum,
  state: openEnum.nullish(),
  pickup_details: fulfillmentDates.extend({ pickup_at: instant.nullish(), picked_up_at: instant.nullish() }).nullish(),
  delivery_details: fulfillmentDates.extend({ deliver_at: instant.nullish(), delivered_at: instant.nullish() }).nullish(),
  shipment_details: fulfillmentDates.extend({ shipped_at: instant.nullish() }).nullish(),
});

const order = z.object({
  ...fields,
  version: z.number().int().nonnegative().safe().nullish(),
  state: openEnum.nullish(),
  closed_at: instant.nullish(),
  source: z.object({ name: z.string().max(500).nullish() }).nullish(),
  total_money: moneyField,
  net_amounts: z.object({ total_money: moneyField }).nullish(),
  total_tax_money: moneyField,
  total_tip_money: moneyField,
  total_discount_money: moneyField,
  total_service_charge_money: moneyField,
  line_items: z.array(line).max(1000).nullish(),
  returns: z.array(z.unknown()).max(1000).nullish(),
  fulfillments: z.array(fulfillment).max(100).nullish(),
  tenders: z.array(z.object({
    payment_id: churchSquareResourceId.nullish(),
    type: openEnum,
    amount_money: moneyField,
    tip_money: moneyField,
  })).max(1000).nullish(),
  refunds: z.array(z.object({ id: churchSquareResourceId })).max(1000).nullish(),
});

const payment = z.object({
  ...fields,
  status: openEnum,
  order_id: churchSquareResourceId.nullish(),
  source_type: openEnum,
  amount_money: moneyField,
  total_money: moneyField,
  tip_money: moneyField,
  refunded_money: moneyField,
  is_offline_payment: z.boolean().nullish(),
  offline_payment_details: z.object({ client_created_at: instant.nullish() }).nullish(),
  processing_fee: z.array(z.object({
    amount_money: money,
    type: openEnum.nullish(),
    effective_at: instant.nullish(),
  })).max(100).nullish(),
});

const refund = z.object({
  ...fields,
  status: openEnum,
  order_id: churchSquareResourceId.nullish(),
  payment_id: churchSquareResourceId.nullish(),
  amount_money: money,
});

const paymentRequest = z.object({
  uid: churchSquareResourceId.nullish(),
  request_type: openEnum,
  due_date: date.nullish(),
  computed_amount_money: moneyField,
  total_completed_amount_money: moneyField,
});

const invoice = z.object({
  ...fields,
  status: openEnum,
  order_id: churchSquareResourceId,
  version: z.number().int().nonnegative().safe().nullish(),
  sale_or_service_date: date.nullish(),
  payment_requests: z.array(paymentRequest).max(100).nullish(),
});

function base<T extends ChurchSquareResourceKind>(kind: T, value: z.infer<z.ZodObject<typeof fields>> & { version?: number | null }) {
  return {
    kind,
    id: value.id,
    locationId: value.location_id,
    version: value.version ?? null,
    createdAt: value.created_at,
    updatedAt: value.updated_at,
    currency: "USD" as const,
  };
}

/** A mutable, display-only hint. Marketplace statements or confirmed provider references establish attribution. */
function sourceHint(name?: string | null) {
  const compact = name?.toLowerCase().replace(/[^a-z0-9]/g, "");
  if (compact === "doordash") return "DOORDASH" as const;
  if (compact === "ubereats") return "UBER_EATS" as const;
  if (compact === "grubhub") return "GRUBHUB" as const;
  if (compact === "squareonline") return "SQUARE_ONLINE" as const;
  if (compact === "squarepointofsale" || compact === "squarepos") return "SQUARE_POS" as const;
  if (compact === "squareinvoices") return "SQUARE_INVOICES" as const;
  return "UNKNOWN" as const;
}

function projectFulfillment(value: z.infer<typeof fulfillment>) {
  const detail = value.type === "PICKUP" ? value.pickup_details
    : value.type === "DELIVERY" ? value.delivery_details
      : value.type === "SHIPMENT" ? value.shipment_details : undefined;
  const promisedAt = value.type === "PICKUP" ? value.pickup_details?.pickup_at
    : value.type === "DELIVERY" ? value.delivery_details?.deliver_at : undefined;
  const handoffAt = value.type === "PICKUP" ? value.pickup_details?.picked_up_at
    : value.type === "DELIVERY" ? value.delivery_details?.delivered_at
      : value.type === "SHIPMENT" ? value.shipment_details?.shipped_at : undefined;
  return {
    id: value.uid ?? null,
    type: known(value.type, fulfillmentTypes),
    status: known(value.state ?? "UNKNOWN", fulfillmentStates),
    placedAt: detail?.placed_at ?? null,
    promisedAt: promisedAt ?? null,
    readyAt: detail?.ready_at ?? null,
    handoffAt: handoffAt ?? null,
    completedAt: detail?.completed_at ?? null,
    canceledAt: detail?.canceled_at ?? null,
    rejectedAt: detail?.rejected_at ?? null,
  };
}

function projectOrder(value: z.infer<typeof order>) {
  return {
    ...base("order", value),
    status: known(value.state ?? "UNKNOWN", orderStates),
    closedAt: value.closed_at ?? null,
    sourceHint: sourceHint(value.source?.name),
    totalCents: cents(value.total_money),
    netTotalCents: cents(value.net_amounts?.total_money),
    taxCents: cents(value.total_tax_money),
    tipCents: cents(value.total_tip_money),
    discountCents: cents(value.total_discount_money),
    serviceChargeCents: cents(value.total_service_charge_money),
    lineItemsReported: Array.isArray(value.line_items),
    hasReturns: Boolean(value.returns?.length),
    lineItems: (value.line_items ?? []).map(item => ({
      id: item.uid ?? null,
      variationId: item.catalog_object_id ?? null,
      catalogVersion: item.catalog_version ?? null,
      itemType: item.item_type ?? null,
      quantity: item.quantity,
      hasQuantityUnit: item.quantity_unit != null,
      totalCents: cents(item.total_money),
      taxCents: cents(item.total_tax_money),
      discountCents: cents(item.total_discount_money),
      modifiers: (item.modifiers ?? []).map(detail => ({
        id: detail.uid ?? null,
        catalogModifierId: detail.catalog_object_id ?? null,
        quantity: detail.quantity ?? null,
        totalCents: cents(detail.total_price_money),
      })),
    })),
    fulfillments: (value.fulfillments ?? []).map(projectFulfillment),
    tenders: (value.tenders ?? []).map(tender => ({
      paymentId: tender.payment_id ?? null,
      source: known(tender.type, tenderTypes),
      amountCents: cents(tender.amount_money),
      tipCents: cents(tender.tip_money),
    })),
    refundIds: [...new Set((value.refunds ?? []).map(item => item.id))],
  };
}

function projectPayment(value: z.infer<typeof payment>) {
  return {
    ...base("payment", value),
    status: known(value.status, paymentStates),
    orderId: value.order_id ?? null,
    source: known(value.source_type, paymentSources),
    amountCents: cents(value.amount_money),
    totalCents: cents(value.total_money),
    tipCents: cents(value.tip_money),
    refundedCents: cents(value.refunded_money),
    isOffline: value.is_offline_payment ?? null,
    offlineCreatedAt: value.offline_payment_details?.client_created_at ?? null,
    processingFees: (value.processing_fee ?? []).map(fee => ({
      amountCents: fee.amount_money.amount,
      type: fee.type ? known(fee.type, feeTypes) : null,
      effectiveAt: fee.effective_at ?? null,
    })),
  };
}

function projectRefund(value: z.infer<typeof refund>) {
  return {
    ...base("refund", value),
    status: known(value.status, refundStates),
    orderId: value.order_id ?? null,
    paymentId: value.payment_id ?? null,
    amountCents: value.amount_money.amount,
  };
}

type DepositState = "not_requested" | "unknown" | "unpaid" | "partial" | "satisfied" | "review_required";

function projectDeposit(requests: NonNullable<z.infer<typeof invoice>["payment_requests"]>, status: string) {
  const deposits = requests.filter(request => request.request_type === "DEPOSIT");
  const deposit = deposits.length === 1 ? deposits[0] : undefined;
  const dueCents = cents(deposit?.computed_amount_money);
  const completedCents = cents(deposit?.total_completed_amount_money);
  let state: DepositState;
  if (deposits.length === 0) state = "not_requested";
  else if (deposits.length !== 1 || !["UNPAID", "PARTIALLY_PAID", "PAID", "PAYMENT_PENDING"].includes(status)) state = "review_required";
  else if (dueCents === null || dueCents <= 0 || completedCents === null || completedCents < 0) state = "unknown";
  else if (completedCents === 0) state = "unpaid";
  else if (completedCents < dueCents) state = "partial";
  else state = "satisfied";
  return { state, dueCents, completedCents };
}

function projectInvoice(value: z.infer<typeof invoice>) {
  return {
    ...base("invoice", value),
    status: known(value.status, churchSquareInvoiceStates),
    orderId: value.order_id,
    serviceDate: value.sale_or_service_date ?? null,
    deposit: value.payment_requests == null
      ? { state: "unknown" as const, dueCents: null, completedCents: null }
      : projectDeposit(value.payment_requests, value.status),
    paymentRequests: (value.payment_requests ?? []).map(request => ({
      id: request.uid ?? null,
      type: known(request.request_type, requestTypes),
      dueDate: request.due_date ?? null,
      dueCents: cents(request.computed_amount_money),
      completedCents: cents(request.total_completed_amount_money),
    })),
  };
}

const projectors = { order, payment, refund, invoice } as const;
export type ChurchSquareOrder = ReturnType<typeof projectOrder>;
export type ChurchSquarePayment = ReturnType<typeof projectPayment>;
export type ChurchSquareRefund = ReturnType<typeof projectRefund>;
export type ChurchSquareInvoice = ReturnType<typeof projectInvoice>;
export type ChurchSquareResource = ChurchSquareOrder | ChurchSquarePayment | ChurchSquareRefund | ChurchSquareInvoice;

export class ChurchSquareProjectionError extends Error {
  constructor(message: string, readonly code: "invalid_resource" | "scope_mismatch") {
    super(message);
    this.name = "ChurchSquareProjectionError";
  }
}

type ExpectedScope = { locationId: string; id?: string };

export function projectChurchSquareResource(kind: "order", raw: unknown, scope: ExpectedScope): ChurchSquareOrder;
export function projectChurchSquareResource(kind: "payment", raw: unknown, scope: ExpectedScope): ChurchSquarePayment;
export function projectChurchSquareResource(kind: "refund", raw: unknown, scope: ExpectedScope): ChurchSquareRefund;
export function projectChurchSquareResource(kind: "invoice", raw: unknown, scope: ExpectedScope): ChurchSquareInvoice;
export function projectChurchSquareResource(kind: ChurchSquareResourceKind, raw: unknown, scope: ExpectedScope): ChurchSquareResource;
export function projectChurchSquareResource(kind: ChurchSquareResourceKind, raw: unknown, scope: ExpectedScope): ChurchSquareResource {
  const scopeResult = z.object({ id: churchSquareResourceId, location_id: churchSquareResourceId }).safeParse(raw);
  if (!scopeResult.success || scopeResult.data.location_id !== scope.locationId
    || (scope.id !== undefined && scopeResult.data.id !== scope.id)) {
    throw new ChurchSquareProjectionError("Square resource did not match the requested ID and Church Street location.", "scope_mismatch");
  }
  const result = projectors[kind].safeParse(raw);
  if (!result.success || Date.parse(result.data.updated_at) < Date.parse(result.data.created_at)) {
    throw new ChurchSquareProjectionError("Square returned invalid resource fields.", "invalid_resource");
  }
  // Use each schema's stripped object so free-text names, notes, card data,
  // addresses, and contacts never enter the projection or error messages.
  if (kind === "order") return projectOrder(result.data as z.infer<typeof order>);
  if (kind === "payment") return projectPayment(result.data as z.infer<typeof payment>);
  if (kind === "refund") return projectRefund(result.data as z.infer<typeof refund>);
  return projectInvoice(result.data as z.infer<typeof invoice>);
}
