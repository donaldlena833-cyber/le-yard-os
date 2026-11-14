"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { assertCondition, throwDatabaseError } from "@/data/errors";
import { executeWorkflowAction } from "@/data/execute";
import { canViewChurchSquareStockAlerts } from "@/data/read-models/church-square-stock-alerts";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSquareWebhookConfiguration } from "@/lib/integrations/church-square-webhook.server";

const acknowledgment = z.object({
  acknowledgedAt: z.iso.datetime({ offset: true }),
  acknowledgedByName: z.string().min(1).refine((name) => Array.from(name).length <= 120),
});

export async function acknowledgeChurchSquareStockAlertAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "inventory.square_church.acknowledge_stock_alert",
    schema: z.strictObject({ itemId: z.uuid(), episodeId: z.uuid() }),
    input,
    run: async (context, alert) => {
      const session = await resolveWorkspaceSession();
      assertCondition(session.status === "ready" && session.context.identity.userId === context.actor.userId
        && canViewChurchSquareStockAlerts(session.context),
      "forbidden", "Church Street inventory count access is required.");
      assertCondition(churchSquareWebhookConfiguration(), "conflict", "The Church Street Square stock display is unavailable.");

      const { data, error } = await context.supabase.rpc("acknowledge_church_square_stock_alert", {
        p_location_id: session.context.activeLocation.id,
        p_item_id: alert.itemId,
        p_episode_id: alert.episodeId,
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "Square stock acknowledgment could not be saved.");
      const parsed = acknowledgment.safeParse(data);
      assertCondition(parsed.success, "database", "The stock acknowledgment could not be loaded.");
      return parsed.data;
    },
  });
  if (result.ok && result.persisted) revalidatePath("/inventory");
  return result;
}
