import "server-only";

import { assertFound, throwDatabaseError, WorkflowError } from "../errors";
import type { WorkflowContext } from "../execute";
import type {
  RemovePushSubscriptionInput,
  SavePushSubscriptionInput,
  SetNotificationPreferenceInput,
} from "../notification-schemas";
import { requireOrganizationAccess } from "../policy";
import {
  encryptPushSubscription,
  pushEndpointHash,
} from "@/lib/notifications/push-subscription";

export async function setNotificationPreference(
  context: WorkflowContext,
  input: SetNotificationPreferenceInput,
) {
  requireOrganizationAccess(context.actor, input.organizationId);
  const { data, error } = await context.supabase.rpc("set_notification_preference", {
    p_request_id: input.requestId,
    p_organization_id: input.organizationId,
    p_notification_type: input.notificationType,
    p_in_app: input.inApp,
    p_email: input.email,
    p_push: input.push,
    p_quiet_hours: input.quietHours,
  });
  if (error) throwDatabaseError(error, "The notification preference could not be saved.");
  const preference = assertFound(data, "The saved notification preference was not returned.");
  return {
    id: preference.id,
    notificationType: preference.notification_type,
    inApp: preference.in_app,
    email: preference.email,
    push: preference.push,
  };
}

export async function savePushSubscription(
  context: WorkflowContext,
  input: SavePushSubscriptionInput,
) {
  requireOrganizationAccess(context.actor, input.organizationId);
  let encrypted: Buffer;
  try {
    encrypted = encryptPushSubscription(input.subscription);
  } catch {
    throw new WorkflowError(
      "conflict",
      "Secure browser subscription storage is not configured for this deployment.",
    );
  }
  const endpointHash = pushEndpointHash(input.subscription.endpoint);
  const { data, error } = await context.supabase.rpc("save_push_subscription", {
    p_request_id: input.requestId,
    p_organization_id: input.organizationId,
    p_endpoint_hash: endpointHash,
    p_encrypted_subscription: `\\x${encrypted.toString("hex")}`,
    p_device_label: input.deviceLabel?.trim() || null,
  });
  if (error) throwDatabaseError(error, "The browser subscription could not be stored.");
  const subscription = assertFound(data, "The stored browser subscription was not returned.");
  return {
    id: subscription.id,
    endpointHash: subscription.endpoint_hash,
    deviceLabel: subscription.device_label,
  };
}

export async function removePushSubscription(
  context: WorkflowContext,
  input: RemovePushSubscriptionInput,
) {
  requireOrganizationAccess(context.actor, input.organizationId);
  const endpointHash = input.endpointHash;
  const { data, error } = await context.supabase.rpc("remove_push_subscription", {
    p_request_id: input.requestId,
    p_organization_id: input.organizationId,
    p_endpoint_hash: endpointHash,
  });
  if (error) throwDatabaseError(error, "The browser subscription could not be removed.");
  return { removed: Boolean(data), endpointHash };
}
