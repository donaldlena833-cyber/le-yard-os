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
const storedObservation = z.strictObject({
  updatedAt: z.iso.datetime({ offset: true }), matches: z.boolean(),
  recoveredAt: z.iso.datetime({ offset: true }).nullish().transform(value => value ?? null),
});
type Observation = { status: "observed" } & z.infer<typeof storedObservation>
  | { status: "not_observed" | "unavailable" };

async function loadVerifiedOrder(context: WorkflowContext, orderId: string, requireRecoveryAccess = false) {
  const session = await resolveWorkspaceSession();
  assertCondition(session.status === "ready" && session.context.identity.userId === context.actor.userId
    && await verifyChurchSquareOrderWindowScope(session.context),
  "forbidden", "Church Street financial reports access is required.");
  const canRecover = session.context.capabilities.includes("manager_log.manage");
  assertCondition(!requireRecoveryAccess || canRecover, "forbidden", "Church Street Manager Log access is required to recover an order.");
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
  let operations: Observation = { status: "unavailable" };
  try {
    const { data, error } = await context.supabase.rpc("get_church_square_order_evidence", {
      ...squareOrderScope(verified),
      p_square_updated_at: order.updatedAt,
      p_square_version: order.version,
    }).abortSignal(AbortSignal.timeout(6_000));
    if (error?.code === "42501") throw new WorkflowError("forbidden", "Church Street financial reports access is required.");
    if (!error && data === null) operations = { status: "not_observed" };
    if (!error && data !== null) {
      const parsed = storedObservation.safeParse(data);
      if (parsed.success) operations = { status: "observed", ...parsed.data };
    }
  } catch (error) {
    if (error instanceof WorkflowError) throw error;
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
      fulfillments: order.fulfillments.map(({ type, status, promisedAt, readyAt, handoffAt, completedAt, canceledAt, rejectedAt }) =>
        ({ type, status, promisedAt, readyAt, handoffAt, completedAt, canceledAt, rejectedAt })),
    },
    operations,
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
      const verified = await loadVerifiedOrder(context, orderId, true);
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
