"use server";

import { z } from "zod";
import { assertCondition, throwDatabaseError } from "@/data/errors";
import { executeWorkflowAction, type WorkflowContext } from "@/data/execute";
import { canViewChurchSquareStockAlerts } from "@/data/read-models/church-square-stock-alerts";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSquareStockPushEncryptionKey, churchSquareStockPushSubscription } from "@/lib/integrations/church-square-stock-push.server";
import { encryptPushSubscription, pushEndpointHash } from "@/lib/notifications/push-subscription";

const endpointInput = z.strictObject({ locationId: z.uuid(), endpointHash: z.string().regex(/^[0-9a-f]{64}$/) });
const registrationInput = z.strictObject({ locationId: z.uuid(), subscription: churchSquareStockPushSubscription });

async function requireChurchStockPushScope(context: WorkflowContext, locationId: string) {
  const session = await resolveWorkspaceSession();
  assertCondition(session.status === "ready" && session.context.activeLocation.id === locationId
    && session.context.identity.userId === context.actor.userId && canViewChurchSquareStockAlerts(session.context),
  "forbidden", "Church Street inventory access is required.");
}

export async function getChurchSquareStockPushDeviceAction(input: unknown) {
  return executeWorkflowAction({
    operation: "inventory.square_church.stock_push.get",
    schema: endpointInput, input, persists: false,
    run: async (context, device) => {
      await requireChurchStockPushScope(context, device.locationId);
      const { data, error } = await context.supabase.rpc("get_church_square_stock_push_device", {
        p_location_id: device.locationId, p_endpoint_hash: device.endpointHash,
      }).abortSignal(AbortSignal.timeout(5_000));
      if (error) throwDatabaseError(error, "The browser's stock alert setting could not be read.");
      assertCondition(typeof data === "boolean", "database", "The browser's stock alert setting was missing.");
      return data;
    },
  });
}

export async function saveChurchSquareStockPushDeviceAction(input: unknown) {
  return executeWorkflowAction({
    operation: "inventory.square_church.stock_push.save",
    schema: registrationInput, input,
    run: async (context, device) => {
      await requireChurchStockPushScope(context, device.locationId);
      const encryptionKey = churchSquareStockPushEncryptionKey();
      assertCondition(encryptionKey, "conflict", "Stock notifications are unavailable.");
      assertCondition(device.subscription.expirationTime === null || device.subscription.expirationTime > Date.now(),
        "conflict", "This browser's notification subscription has expired.");
      const encrypted = encryptPushSubscription(device.subscription, encryptionKey);
      const { data, error } = await context.supabase.rpc("save_church_square_stock_push_device", {
        p_location_id: device.locationId,
        p_endpoint_hash: pushEndpointHash(device.subscription.endpoint),
        p_encrypted_subscription: `\\x${encrypted.toString("hex")}`,
      }).abortSignal(AbortSignal.timeout(5_000));
      if (error) throwDatabaseError(error, "Stock notifications could not be enabled on this browser.");
      assertCondition(data === true, "conflict", "Stock notifications could not be enabled on this browser.");
      return data;
    },
  });
}

export async function removeChurchSquareStockPushDeviceAction(input: unknown) {
  return executeWorkflowAction({
    operation: "inventory.square_church.stock_push.remove",
    schema: endpointInput, input,
    run: async (context, device) => {
      await requireChurchStockPushScope(context, device.locationId);
      const { data, error } = await context.supabase.rpc("remove_church_square_stock_push_device", {
        p_location_id: device.locationId, p_endpoint_hash: device.endpointHash,
      }).abortSignal(AbortSignal.timeout(5_000));
      if (error) throwDatabaseError(error, "Stock notifications could not be turned off on this browser.");
      assertCondition(typeof data === "boolean", "database", "The updated stock alert setting was missing.");
      return true;
    },
  });
}
