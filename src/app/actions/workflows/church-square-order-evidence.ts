"use server";

import { z } from "zod";
import { assertCondition, WorkflowError } from "@/data/errors";
import { executeWorkflowAction, type WorkflowContext } from "@/data/execute";
import { verifyChurchSquareOrderWindowScope } from "@/data/read-models/church-square-order-window.server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSquareResourceId } from "@/lib/integrations/church-square-order-projection";
import { ChurchSquareOrderClient, churchSquareOrderConfiguration } from "@/lib/integrations/church-square-orders.server";

const lookupInput = z.strictObject({ orderId: z.string().trim().pipe(churchSquareResourceId) });
const storedObservation = z.strictObject({ updatedAt: z.iso.datetime({ offset: true }), matches: z.boolean() });
type Observation = { status: "observed"; updatedAt: string; matches: boolean }
  | { status: "not_observed" | "unavailable" };

async function readOrderEvidence(context: WorkflowContext, { orderId }: z.infer<typeof lookupInput>) {
  const session = await resolveWorkspaceSession();
  assertCondition(session.status === "ready" && session.context.identity.userId === context.actor.userId
    && await verifyChurchSquareOrderWindowScope(session.context),
  "forbidden", "Church Street financial reports access is required.");
  const config = churchSquareOrderConfiguration();
  assertCondition(config, "conflict", "The Church Street Square connection is awaiting setup.");

  const order = await new ChurchSquareOrderClient(config).get("order", orderId).catch(() => {
    throw new WorkflowError("conflict", "Square could not verify that order for Church Street. Check the exact Square order ID and try again.");
  });
  const checkedAt = new Date().toISOString();

  let operations: Observation = { status: "unavailable" };
  try {
    const { data, error } = await context.supabase.rpc("get_church_square_order_evidence", {
      p_location_id: session.context.activeLocation.id,
      p_merchant_id: config.merchantId,
      p_square_location_id: config.locationId,
      p_order_id: order.id,
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
    square: {
      source: order.sourceHint,
      status: order.status,
      createdAt: order.createdAt,
      updatedAt: order.updatedAt,
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
    run: readOrderEvidence,
  });
}
