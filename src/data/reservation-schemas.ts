import { z } from "zod";

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable();
const shortText = z.string().trim().max(2_000).nullable();

export const saveReservationInputSchema = z.object({
  requestId: uuid,
  locationId: uuid,
  reservationId: nullableUuid,
  guestId: nullableUuid,
  reservedAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(720),
  partySize: z.number().int().min(1).max(100),
  specialRequests: shortText,
  source: z.enum(["manual", "phone", "walk_in"]),
  tableIds: z.array(uuid).max(12),
});

export const saveReservationWithGuestInputSchema = z.object({
  requestId: uuid,
  locationId: uuid,
  displayName: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(320).nullable(),
  phone: z.string().trim().min(7).max(80).nullable(),
  reservedAt: z.iso.datetime({ offset: true }),
  durationMinutes: z.number().int().min(15).max(720),
  partySize: z.number().int().min(1).max(100),
  specialRequests: shortText,
  source: z.enum(["manual", "phone", "walk_in"]),
  tableIds: z.array(uuid).max(12),
});

export const transitionReservationInputSchema = z.object({
  requestId: uuid,
  reservationId: uuid,
  targetStatus: z.enum([
    "booked",
    "confirmed",
    "arrived",
    "seated",
    "completed",
    "cancelled",
    "no_show",
  ]),
  note: z.string().trim().max(2_000).nullable(),
});

export const assignReservationTablesInputSchema = z.object({
  requestId: uuid,
  reservationId: uuid,
  tableIds: z.array(uuid).min(1).max(12),
  overrideNote: z.string().trim().min(3).max(1_000).nullable(),
});

export const saveWaitlistEntryInputSchema = z.object({
  requestId: uuid,
  locationId: uuid,
  guestId: nullableUuid,
  displayName: z.string().trim().min(1).max(160),
  email: z.string().trim().email().max(320).nullable(),
  phone: z.string().trim().min(7).max(80),
  partySize: z.number().int().min(1).max(100),
  desiredFrom: z.iso.datetime({ offset: true }).nullable(),
  desiredTo: z.iso.datetime({ offset: true }).nullable(),
  quotedWaitMinutes: z.number().int().min(0).max(1_440).nullable(),
  notes: shortText,
});

export const transitionWaitlistEntryInputSchema = z.object({
  requestId: uuid,
  waitlistEntryId: uuid,
  targetStatus: z.enum(["notified", "accepted", "expired", "cancelled"]),
  note: z.string().trim().max(1_000).nullable(),
});

export const seatWaitlistEntryInputSchema = z.object({
  requestId: uuid,
  waitlistEntryId: uuid,
  tableIds: z.array(uuid).min(1).max(8),
  durationMinutes: z.number().int().min(15).max(720),
});

export const setReservationTableStatusInputSchema = z.object({
  requestId: uuid,
  tableId: uuid,
  status: z.enum([
    "available",
    "occupied",
    "needs_reset",
    "blocked",
  ]),
  note: z.string().trim().max(1_000).nullable(),
  reservationId: nullableUuid,
});

export const installReservationDraftInputSchema = z.object({
  requestId: uuid,
  locationId: uuid,
});

export const approveReservationDraftInputSchema = z.object({
  requestId: uuid,
  locationId: uuid,
  enableOnline: z.boolean(),
  enableMessaging: z.boolean(),
  enableStaffPush: z.boolean(),
  verificationNote: z.string().trim().min(12).max(1_000),
  verifiedOnSite: z.literal(true),
});

export const configureServiceShiftExceptionInputSchema = z
  .object({
    requestId: uuid,
    organizationId: uuid,
    locationId: uuid,
    serviceShiftId: uuid,
    exceptionKind: z.enum([
      "closure",
      "pacing_override",
      "buffer_override",
    ]),
    effectiveStartsAt: z.iso.datetime({ offset: true }),
    effectiveEndsAt: z.iso.datetime({ offset: true }),
    pacingIntervalMinutes: z
      .number()
      .int()
      .refine((value) => [5, 10, 15, 20, 30, 60].includes(value))
      .nullable(),
    pacingCoverLimit: z.number().int().min(1).max(10_000).nullable(),
    openingBufferMinutes: z.number().int().min(0).max(360).nullable(),
    closingBufferMinutes: z.number().int().min(0).max(360).nullable(),
    reason: z.string().trim().min(4).max(1_000),
    active: z.literal(true),
  })
  .superRefine((input, context) => {
    if (
      new Date(input.effectiveEndsAt).valueOf() <=
      new Date(input.effectiveStartsAt).valueOf()
    ) {
      context.addIssue({
        code: "custom",
        path: ["effectiveEndsAt"],
        message: "The end must be after the start.",
      });
    }
    const pacingFieldsComplete =
      input.pacingIntervalMinutes !== null && input.pacingCoverLimit !== null;
    const pacingFieldsPresent =
      input.pacingIntervalMinutes !== null || input.pacingCoverLimit !== null;
    const bufferFieldsComplete =
      input.openingBufferMinutes !== null && input.closingBufferMinutes !== null;
    const bufferFieldsPresent =
      input.openingBufferMinutes !== null || input.closingBufferMinutes !== null;
    if (
      (input.exceptionKind === "pacing_override" && !pacingFieldsComplete) ||
      (input.exceptionKind !== "pacing_override" && pacingFieldsPresent) ||
      (input.exceptionKind === "buffer_override" && !bufferFieldsComplete) ||
      (input.exceptionKind !== "buffer_override" && bufferFieldsPresent) ||
      (input.exceptionKind === "closure" &&
        (pacingFieldsPresent || bufferFieldsPresent))
    ) {
      context.addIssue({
        code: "custom",
        path: ["exceptionKind"],
        message: "The exception fields do not match its type.",
      });
    }
  });

export const revokeServiceShiftExceptionInputSchema = z.object({
  requestId: uuid,
  exceptionId: uuid,
  reason: z.string().trim().min(4).max(1_000),
});

export type SaveReservationInput = z.infer<typeof saveReservationInputSchema>;
export type SaveReservationWithGuestInput = z.infer<
  typeof saveReservationWithGuestInputSchema
>;
export type TransitionReservationInput = z.infer<
  typeof transitionReservationInputSchema
>;
export type AssignReservationTablesInput = z.infer<
  typeof assignReservationTablesInputSchema
>;
export type SaveWaitlistEntryInput = z.infer<
  typeof saveWaitlistEntryInputSchema
>;
export type TransitionWaitlistEntryInput = z.infer<
  typeof transitionWaitlistEntryInputSchema
>;
export type SeatWaitlistEntryInput = z.infer<
  typeof seatWaitlistEntryInputSchema
>;
export type SetReservationTableStatusInput = z.infer<
  typeof setReservationTableStatusInputSchema
>;
export type InstallReservationDraftInput = z.infer<
  typeof installReservationDraftInputSchema
>;
export type ApproveReservationDraftInput = z.infer<
  typeof approveReservationDraftInputSchema
>;
export type ConfigureServiceShiftExceptionInput = z.infer<
  typeof configureServiceShiftExceptionInputSchema
>;
export type RevokeServiceShiftExceptionInput = z.infer<
  typeof revokeServiceShiftExceptionInputSchema
>;
