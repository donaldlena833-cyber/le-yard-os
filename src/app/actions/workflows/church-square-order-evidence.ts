"use server";

import { z } from "zod";
import { assertCondition, throwDatabaseError, WorkflowError } from "@/data/errors";
import { executeWorkflowAction, type WorkflowContext } from "@/data/execute";
import { verifyChurchSquareOrderWindowScope } from "@/data/read-models/church-square-order-window.server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSquareResourceId, type ChurchSquareOrder } from "@/lib/integrations/church-square-order-projection";
import { ChurchSquareOrderClient, churchSquareOrderConfiguration } from "@/lib/integrations/church-square-orders.server";
import { createAdminClient } from "@/lib/supabase/admin";

const lookupInput = z.strictObject({ orderId: z.string().trim().pipe(churchSquareResourceId) });
const recoveryInput = lookupInput.extend({
  checkedRevision: z.iso.datetime({ offset: true }),
  checkedVersion: z.number().int().nonnegative().safe().nullable(),
});
const marketplaceChannel = z.enum(["DOORDASH", "UBER_EATS", "GRUBHUB"]);
const marketplaceEvidence = z.enum(["merchant_order", "payout_statement"]);
const marketplaceInput = recoveryInput.extend({
  channel: marketplaceChannel,
  externalStoreId: z.string().trim().regex(/^[A-Za-z0-9_:-]{1,100}$/),
  externalOrderId: z.string().trim().regex(/^[A-Za-z0-9_:-]{12,100}$/),
  evidence: marketplaceEvidence,
});
const marketplaceLink = z.strictObject({
  channel: marketplaceChannel,
  storeReference: z.string().regex(/^[A-Za-z0-9_:-]{1,10}$/),
  orderReference: z.string().regex(/^[A-Za-z0-9_:-]{10}$/),
  recordedAt: z.iso.datetime({ offset: true }),
  evidence: marketplaceEvidence,
});
type MarketplaceObservation = { status: "linked"; link: z.infer<typeof marketplaceLink> }
  | { status: "unlinked" | "unavailable" };
const storedObservation = z.strictObject({
  updatedAt: z.iso.datetime({ offset: true }), matches: z.boolean(),
  recoveredAt: z.iso.datetime({ offset: true }).nullish().transform(value => value ?? null),
  source: z.enum(["webhook", "scheduled", "manual"]).nullish().transform(value => value ?? null),
  savedAt: z.iso.datetime({ offset: true }).nullish().transform(value => value ?? null),
});
const receiptFacts = z.object({
  squareCreatedAt: z.iso.datetime({ offset: true }), receivedAt: z.iso.datetime({ offset: true }),
  processedAt: z.iso.datetime({ offset: true }).nullable(), state: z.enum(["pending", "verified", "needs_review"]),
});
const signedReceipts = z.strictObject({
  order: receiptFacts.extend({ eventType: z.enum(["order.created", "order.updated", "order.fulfillment.updated"]) }).nullable(),
  payment: receiptFacts.extend({ eventType: z.enum(["payment.created", "payment.updated"]) }).nullable(),
});
type Observation = { status: "observed" } & z.infer<typeof storedObservation>
  | { status: "not_observed" | "unavailable" };

async function loadVerifiedOrder(context: WorkflowContext, orderId: string, write?: "recover" | "link") {
  const session = await resolveWorkspaceSession();
  assertCondition(session.status === "ready" && session.context.identity.userId === context.actor.userId
    && await verifyChurchSquareOrderWindowScope(session.context),
  "forbidden", "Church Street financial reports access is required.");
  const canRecover = session.context.capabilities.includes("manager_log.manage");
  if (write) {
    assertCondition(canRecover, "forbidden", write === "link"
      ? "Church Street Manager Log access is required to record a marketplace reference."
      : "Church Street Manager Log access is required to recover an order.");
  }
  const config = churchSquareOrderConfiguration();
  assertCondition(config, "conflict", "The Church Street Square connection is awaiting setup.");

  const order = await new ChurchSquareOrderClient(config).get("order", orderId).catch(() => {
    throw new WorkflowError("conflict", "Square could not verify that order for Church Street. Check the exact Square order ID and try again.");
  });
  return { order, checkedAt: new Date().toISOString(), locationId: session.context.activeLocation.id, config, canRecover };
}

type VerifiedOrder = Awaited<ReturnType<typeof loadVerifiedOrder>>;

function squareOrderScope({ locationId, config, order }: VerifiedOrder) {
  return {
    p_location_id: locationId, p_merchant_id: config.merchantId,
    p_square_location_id: config.locationId, p_order_id: order.id,
  };
}

async function readOrderEvidence(context: WorkflowContext, verified: VerifiedOrder) {
  const { order, checkedAt, canRecover } = verified;
  const scope = squareOrderScope(verified);
  const [stored, receiptRead, marketplaceRead] = await Promise.allSettled([
    context.supabase.rpc("get_church_square_order_evidence", {
      ...scope, p_square_updated_at: order.updatedAt, p_square_version: order.version,
    }).abortSignal(AbortSignal.timeout(6_000)),
    context.supabase.rpc("get_church_square_order_receipt_evidence", scope).abortSignal(AbortSignal.timeout(6_000)),
    context.supabase.rpc("get_church_square_marketplace_link", scope).abortSignal(AbortSignal.timeout(6_000)),
  ]);
  if ([stored, receiptRead, marketplaceRead].some(result => result.status === "fulfilled" && result.value.error?.code === "42501")) {
    throw new WorkflowError("forbidden", "Church Street financial reports access is required.");
  }
  let operations: Observation = { status: "unavailable" };
  if (stored.status === "fulfilled" && !stored.value.error) {
    const { data } = stored.value;
    if (data === null) {
      operations = { status: "not_observed" };
    } else {
      const parsed = storedObservation.safeParse(data);
      if (parsed.success) operations = { status: "observed", ...parsed.data };
    }
  }
  const receipts = signedReceipts.safeParse(receiptRead.status === "fulfilled" && !receiptRead.value.error
    ? receiptRead.value.data : undefined);
  let marketplace: MarketplaceObservation = { status: "unavailable" };
  if (marketplaceRead.status === "fulfilled" && !marketplaceRead.value.error) {
    const data = marketplaceRead.value.data;
    if (data === null) {
      marketplace = { status: "unlinked" };
    } else {
      const link = marketplaceLink.safeParse(data);
      if (link.success) marketplace = { status: "linked", link: link.data };
    }
  }

  return {
    reference: order.id.slice(-10),
    checkedAt,
    canRecover,
    square: {
      source: order.sourceHint,
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
      version: order.version,
      fulfillments: order.fulfillments.map(({ type, status, promisedAt, readyAt, handoffAt, completedAt, canceledAt, rejectedAt,
        placedAt, acceptedAt, scheduleType, courierPickupAt }) =>
        ({ type, status, promisedAt, readyAt, handoffAt, completedAt, canceledAt, rejectedAt,
          ...(placedAt ? { placedAt } : {}), ...(acceptedAt ? { acceptedAt } : {}),
          ...(scheduleType && scheduleType !== "UNKNOWN" ? { scheduleType } : {}),
          ...(courierPickupAt ? { courierPickupAt } : {}) })),
    },
    operations,
    marketplace,
    canLinkMarketplace: canRecover && operations.status === "observed" && operations.matches
      && marketplace.status !== "unavailable",
    ...(receipts.success ? { receipts: receipts.data } : {}),
  };
}

export async function lookupChurchSquareOrderEvidenceAction(input: unknown) {
  return executeWorkflowAction({
    operation: "church-square.order-evidence.lookup",
    schema: lookupInput,
    input,
    persists: false,
    run: async (context, { orderId }) => readOrderEvidence(context, await loadVerifiedOrder(context, orderId)),
  });
}

export async function recoverChurchSquareOrderEvidenceAction(input: unknown) {
  return executeWorkflowAction({
    operation: "church-square.order-evidence.recover",
    schema: recoveryInput,
    input,
    run: async (context, { orderId, checkedRevision, checkedVersion }) => {
      const verified = await loadVerifiedOrder(context, orderId, "recover");
      const order: ChurchSquareOrder = verified.order;
      assertCondition(order.updatedAt === checkedRevision && order.version === checkedVersion,
        "stale", "Square updated this order. Check it again before recovering it.");
      const { data, error } = await createAdminClient().rpc("service_recover_church_square_order", {
        ...squareOrderScope(verified),
        p_actor_id: context.actor.userId,
        p_facts: order,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "The Church Street order could not be recovered. Check the order again.");
      assertCondition(typeof data === "boolean", "database", "The recovery result could not be confirmed. Check the order again.");
      const result = await readOrderEvidence(context, verified);
      if (result.operations.status === "observed" && !result.operations.matches) {
        throw new WorkflowError("stale", "Operations has a different version of this order. Check it again.");
      }
      assertCondition(result.operations.status === "observed", "database", "The recovered order could not be read back. Check the order again.");
      return result;
    },
  });
}

export async function saveChurchSquareMarketplaceLinkAction(input: unknown) {
  return executeWorkflowAction({
    operation: "church-square.order-evidence.marketplace",
    schema: marketplaceInput,
    input,
    run: async (context, value) => {
      const verified = await loadVerifiedOrder(context, value.orderId, "link");
      const { order } = verified;
      assertCondition(order.updatedAt === value.checkedRevision && order.version === value.checkedVersion,
        "stale", "Square updated this order. Check it again before saving a marketplace reference.");

      const { data, error } = await createAdminClient().rpc("service_save_church_square_marketplace_link", {
        ...squareOrderScope(verified),
        p_actor_id: context.actor.userId,
        p_square_updated_at: order.updatedAt,
        p_square_version: order.version,
        p_channel: value.channel,
        p_external_store_id: value.externalStoreId,
        p_external_order_id: value.externalOrderId,
        p_evidence: value.evidence,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error?.code === "23505") {
        throw new WorkflowError("conflict", "One of these orders already has a different marketplace link.");
      }
      if (error) throwDatabaseError(error, "The marketplace reference could not be saved. Check the order before retrying.");
      const link = marketplaceLink.safeParse(data);
      assertCondition(link.success, "database", "The marketplace reference could not be confirmed. Check the order before retrying.");
      const result = await readOrderEvidence(context, verified);
      assertCondition(result.marketplace.status === "linked", "database",
        "The marketplace reference could not be read back. Check the order before retrying.");
      return result;
    },
  });
}
