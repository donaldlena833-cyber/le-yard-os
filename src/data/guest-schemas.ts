import { z } from "zod";

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date in YYYY-MM-DD format.")
  .refine((value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)), "Invalid date.");
const nullableText = (maximum: number) =>
  z.string().trim().max(maximum).nullable().optional();

export const saveGuestInputSchema = z
  .object({
    requestId: uuid,
    organizationId: uuid,
    guestId: uuid.nullable().optional(),
    firstName: nullableText(120),
    lastName: nullableText(120),
    displayName: z.string().trim().min(1).max(240),
    email: z.string().trim().email().max(320).nullable().optional(),
    phone: nullableText(80),
    birthday: isoDate.nullable().optional(),
    vip: z.boolean(),
    preferences: nullableText(10_000),
    allergies: nullableText(10_000),
    notes: nullableText(10_000),
  })
  .strict();

export const addGuestNoteInputSchema = z
  .object({
    requestId: uuid,
    organizationId: uuid,
    guestId: uuid,
    locationId: uuid.nullable().optional(),
    note: z.string().trim().min(1).max(10_000),
    sensitive: z.boolean().default(false),
  })
  .strict();

export const recordGuestConsentInputSchema = z
  .object({
    requestId: uuid,
    organizationId: uuid,
    guestId: uuid,
    channel: z.enum(["email", "sms", "phone", "profiling", "other"]),
    status: z.enum(["granted", "revoked"]),
    evidenceNote: nullableText(2_000),
  })
  .strict();

export const mergeGuestInputSchema = z
  .object({
    requestId: uuid,
    organizationId: uuid,
    sourceGuestId: uuid,
    targetGuestId: uuid,
    matchScore: z.number().finite().min(0).max(1).nullable().optional(),
    reasons: z
      .array(z.string().trim().min(1).max(500))
      .max(100)
      .default([]),
  })
  .strict()
  .refine((value) => value.sourceGuestId !== value.targetGuestId, {
    message: "Choose two different guest profiles.",
    path: ["targetGuestId"],
  })
  .refine((value) => JSON.stringify(value.reasons).length <= 20_000, {
    message: "Merge reasons must be 20 KB or smaller.",
    path: ["reasons"],
  });

export type SaveGuestInput = z.infer<typeof saveGuestInputSchema>;
export type AddGuestNoteInput = z.infer<typeof addGuestNoteInputSchema>;
export type RecordGuestConsentInput = z.infer<
  typeof recordGuestConsentInputSchema
>;
export type MergeGuestInput = z.infer<typeof mergeGuestInputSchema>;
