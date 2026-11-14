"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCondition } from "@/data/errors";
import { executeWorkflowAction, type WorkflowContext } from "@/data/execute";
import { configureChurchSquareCountItem, listTrackedChurchSquareVariations, sendChurchSquareCount } from "@/data/workflows/church-square-counts";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";

const workspaceInput = { organizationId: z.uuid(), locationId: z.uuid(), itemId: z.uuid() };

async function requireActiveChurchWorkspace(context: WorkflowContext, input: { organizationId: string; locationId: string }) {
  const session = await resolveWorkspaceSession();
  assertCondition(session.status === "ready" && session.context.mode === "live"
    && session.context.identity.userId === context.actor.userId
    && session.context.serviceSettings?.serviceModel === "counter"
    && session.context.organization.id === input.organizationId && session.context.activeLocation.id === input.locationId,
  "forbidden", "Switch to the Church Street workspace to use café stock counts.");
}

export async function configureChurchSquareCountItemAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.square_church.configure",
    schema: z.strictObject({
      organizationId: workspaceInput.organizationId, locationId: workspaceInput.locationId,
      variationId: z.string().trim().regex(/^[A-Za-z0-9_-]{1,100}$/),
    }),
    input,
    run: async (context, value) => {
      await requireActiveChurchWorkspace(context, value);
      return configureChurchSquareCountItem(context, value);
    },
  });
  if (result.ok && result.persisted) revalidatePath("/inventory");
  return result;
}

export async function listTrackedChurchSquareVariationsAction(input: unknown) {
  return executeWorkflowAction({
    operation: "inventory.square_church.list_tracked",
    schema: z.strictObject({ organizationId: workspaceInput.organizationId, locationId: workspaceInput.locationId }),
    input,
    persists: false,
    run: async (context, value) => {
      await requireActiveChurchWorkspace(context, value);
      return listTrackedChurchSquareVariations(context, value);
    },
  });
}

export async function sendChurchSquareCountAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.square_church.count",
    schema: z.strictObject({ ...workspaceInput, requestId: z.uuid(),
      quantity: z.string().regex(/^(?:0|[1-9]\d{0,5})$/), reason: z.string().trim().min(1).max(160) }),
    input,
    run: async (context, value) => {
      await requireActiveChurchWorkspace(context, value);
      return sendChurchSquareCount(context, value);
    },
  });
  revalidatePath("/inventory");
  return result;
}
