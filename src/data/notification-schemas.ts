import { z } from "zod";

const uuid = z.string().uuid();
const httpsEndpoint = z.string().trim().url().max(2_048).refine(
  (value) => new URL(value).protocol === "https:",
  "Push endpoints must use HTTPS.",
);

export const notificationTypeSchema = z.enum([
  "schedule_published",
  "shift_assigned",
  "shift_swap_decided",
  "time_correction_decided",
  "time_off_decided",
  "task_assigned",
]);

export const setNotificationPreferenceInputSchema = z
  .object({
    requestId: uuid,
    organizationId: uuid,
    notificationType: notificationTypeSchema,
    inApp: z.boolean(),
    email: z.boolean(),
    push: z.boolean(),
    quietHours: z.record(z.string(), z.json()).default({}),
  })
  .strict();

export const savePushSubscriptionInputSchema = z
  .object({
    requestId: uuid,
    organizationId: uuid,
    subscription: z
      .object({
        endpoint: httpsEndpoint,
        expirationTime: z.number().int().positive().nullable(),
        keys: z
          .object({
            p256dh: z.string().trim().min(20).max(512),
            auth: z.string().trim().min(8).max(256),
          })
          .strict(),
      })
      .strict(),
    deviceLabel: z.string().trim().max(120).nullable().optional(),
  })
  .strict();

export const removePushSubscriptionInputSchema = z
  .object({
    requestId: uuid,
    organizationId: uuid,
    endpointHash: z.string().regex(/^[0-9a-f]{64}$/u),
  })
  .strict();

export type SetNotificationPreferenceInput = z.infer<
  typeof setNotificationPreferenceInputSchema
>;
export type SavePushSubscriptionInput = z.infer<
  typeof savePushSubscriptionInputSchema
>;
export type RemovePushSubscriptionInput = z.infer<
  typeof removePushSubscriptionInputSchema
>;
