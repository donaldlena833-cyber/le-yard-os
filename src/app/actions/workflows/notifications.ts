"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  removePushSubscriptionInputSchema,
  savePushSubscriptionInputSchema,
  setNotificationPreferenceInputSchema,
} from "@/data/notification-schemas";
import {
  removePushSubscription,
  savePushSubscription,
  setNotificationPreference,
} from "@/data/workflows/notifications";

async function runNotificationAction<T extends { ok: boolean; persisted: boolean }>(
  action: Promise<T>,
) {
  const result = await action;
  if (result.ok && result.persisted) revalidatePath("/settings");
  return result;
}

export async function setNotificationPreferenceAction(input: unknown) {
  return runNotificationAction(executeWorkflowAction({
    operation: "notification.preference.set",
    schema: setNotificationPreferenceInputSchema,
    input,
    run: setNotificationPreference,
  }));
}

export async function savePushSubscriptionAction(input: unknown) {
  return runNotificationAction(executeWorkflowAction({
    operation: "notification.push.save",
    schema: savePushSubscriptionInputSchema,
    input,
    run: savePushSubscription,
  }));
}

export async function removePushSubscriptionAction(input: unknown) {
  return runNotificationAction(executeWorkflowAction({
    operation: "notification.push.remove",
    schema: removePushSubscriptionInputSchema,
    input,
    run: removePushSubscription,
  }));
}
