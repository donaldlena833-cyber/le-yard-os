import { z } from "zod";

const uuid = z.string().uuid();
const nullableUuid = uuid.nullable().optional();
const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).nullable().optional();
const requiredText = (maximum: number) => z.string().trim().min(1).max(maximum);
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date in YYYY-MM-DD format.")
  .refine(
    (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    "Invalid date.",
  );
const nullableDate = isoDate.nullable().optional();
const clockTime = z
  .string()
  .regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use a 24-hour time in HH:mm format.");
const nullableClockTime = clockTime.nullable().optional();
const localDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T([01]\d|2[0-3]):[0-5]\d$/,
    "Use a local date and time in YYYY-MM-DDTHH:mm format.",
  );

export const saveAvailabilityInputSchema = z
  .object({
    requestId: uuid,
    employeeId: uuid,
    ruleId: nullableUuid,
    locationId: nullableUuid,
    weekday: z.number().int().min(0).max(6),
    availableFrom: nullableClockTime,
    availableUntil: nullableClockTime,
    isAvailable: z.boolean(),
    effectiveFrom: isoDate,
    effectiveTo: nullableDate,
    notes: optionalText(2_000),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "The end date cannot be before the start date.",
      });
    }
    if (value.isAvailable && (!value.availableFrom || !value.availableUntil)) {
      context.addIssue({
        code: "custom",
        path: ["availableFrom"],
        message: "Available rules require a start and end time.",
      });
    }
    if (!value.isAvailable && (value.availableFrom || value.availableUntil)) {
      context.addIssue({
        code: "custom",
        path: ["availableFrom"],
        message: "Unavailable rules cannot include working hours.",
      });
    }
  });

export const deleteAvailabilityInputSchema = z
  .object({ requestId: uuid, ruleId: uuid })
  .strict();

export const saveTimeOffInputSchema = z
  .object({
    requestId: uuid,
    employeeId: uuid,
    timeOffId: nullableUuid,
    locationId: uuid,
    startsAtLocal: localDateTime,
    endsAtLocal: localDateTime,
    reason: optionalText(2_000),
  })
  .strict()
  .refine((value) => value.endsAtLocal > value.startsAtLocal, {
    path: ["endsAtLocal"],
    message: "The end must be after the start.",
  });

export const cancelTimeOffInputSchema = z
  .object({ requestId: uuid, timeOffId: uuid })
  .strict();

export const decideTimeOffInputSchema = z
  .object({
    requestId: uuid,
    timeOffId: uuid,
    approve: z.boolean(),
    decisionNote: optionalText(2_000),
  })
  .strict()
  .refine(
    (value) => value.approve || Boolean(value.decisionNote?.trim()),
    {
      path: ["decisionNote"],
      message: "A decision note is required when declining time off.",
    },
  );

export const saveCertificationInputSchema = z
  .object({
    requestId: uuid,
    employeeId: uuid,
    certificationId: nullableUuid,
    certificationType: requiredText(240),
    issuer: optionalText(240),
    credentialNumber: optionalText(240),
    issuedOn: nullableDate,
    expiresOn: nullableDate,
    verified: z.boolean(),
  })
  .strict()
  .refine(
    (value) => !value.issuedOn || !value.expiresOn || value.expiresOn >= value.issuedOn,
    {
      path: ["expiresOn"],
      message: "The expiry date cannot be before the issue date.",
    },
  );

export const saveEmergencyContactInputSchema = z
  .object({
    requestId: uuid,
    employeeId: uuid,
    contactId: nullableUuid,
    name: requiredText(240),
    relationship: optionalText(120),
    phone: z
      .string()
      .trim()
      .min(7)
      .max(80)
      .refine(
        (value) => /^\+?[0-9()\-.\s]{7,80}$/.test(value),
        "Enter a valid phone number.",
      ),
    email: z.string().trim().email().max(320).nullable().optional(),
    isPrimary: z.boolean(),
  })
  .strict();

export const employeeDocumentMimeTypeSchema = z.enum([
  "application/pdf",
  "image/jpeg",
  "image/png",
  "image/webp",
]);

const employeeDocumentMetadata = {
  employeeId: uuid,
  locationId: uuid,
  documentType: requiredText(120),
  title: requiredText(240),
  mimeType: employeeDocumentMimeTypeSchema,
  sizeBytes: z.number().int().positive().max(25 * 1_048_576),
  employeeVisible: z.boolean(),
};

export const employeeDocumentUploadInputSchema = z
  .object({
    uploadId: uuid,
    ...employeeDocumentMetadata,
    fileName: requiredText(240),
  })
  .strict();

export const finalizeEmployeeDocumentInputSchema = z
  .object({
    requestId: uuid,
    ...employeeDocumentMetadata,
    objectPath: z.string().trim().min(1).max(1_024),
  })
  .strict();

export const updateEmployeeDocumentInputSchema = z
  .object({
    requestId: uuid,
    documentId: uuid,
    documentType: requiredText(120),
    title: requiredText(240),
    employeeVisible: z.boolean(),
  })
  .strict();

export type SaveAvailabilityInput = z.infer<typeof saveAvailabilityInputSchema>;
export type DeleteAvailabilityInput = z.infer<typeof deleteAvailabilityInputSchema>;
export type SaveTimeOffInput = z.infer<typeof saveTimeOffInputSchema>;
export type CancelTimeOffInput = z.infer<typeof cancelTimeOffInputSchema>;
export type DecideTimeOffInput = z.infer<typeof decideTimeOffInputSchema>;
export type SaveCertificationInput = z.infer<typeof saveCertificationInputSchema>;
export type SaveEmergencyContactInput = z.infer<
  typeof saveEmergencyContactInputSchema
>;
export type EmployeeDocumentUploadInput = z.infer<
  typeof employeeDocumentUploadInputSchema
>;
export type FinalizeEmployeeDocumentInput = z.infer<
  typeof finalizeEmployeeDocumentInputSchema
>;
export type UpdateEmployeeDocumentInput = z.infer<
  typeof updateEmployeeDocumentInputSchema
>;
