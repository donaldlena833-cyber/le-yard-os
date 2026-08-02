import { z } from "zod";

const uuid = z.string().uuid();
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
const isoInstant = z.string().datetime({ offset: true });
const nullableInstant = isoInstant.nullable().optional();
const taskStatus = z.enum(["open", "in_progress", "blocked", "completed", "cancelled"]);

export const createTaskInputSchema = z
  .object({
    requestId: uuid,
    locationId: uuid,
    title: requiredText(240),
    description: optionalText(10_000),
    priority: z.enum(["low", "normal", "high", "urgent"]),
    assignedEmployeeId: uuid.nullable().optional(),
    dueAt: nullableInstant,
  })
  .strict();

export const transitionTaskInputSchema = z
  .object({
    requestId: uuid,
    taskId: uuid,
    status: taskStatus,
    note: optionalText(2_000),
  })
  .strict();

export const startChecklistRunInputSchema = z
  .object({
    requestId: uuid,
    locationId: uuid,
    templateId: uuid,
    businessDate: isoDate,
    assignedEmployeeId: uuid.nullable().optional(),
  })
  .strict();

export const recordChecklistResponseInputSchema = z
  .object({
    requestId: uuid,
    runId: uuid,
    templateItemId: uuid,
    response: z
      .json()
      .refine((value) => value !== null, "A checklist response is required.")
      .refine(
        (value) => JSON.stringify(value).length <= 20_000,
        "The checklist response is too large.",
      ),
    storagePath: z.string().trim().min(1).max(1_000).nullable().optional(),
    notes: optionalText(2_000),
  })
  .strict();

export const checklistEvidenceUploadInputSchema = z
  .object({
    uploadId: uuid,
    runId: uuid,
    templateItemId: uuid,
    fileName: requiredText(240),
    mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]),
    sizeBytes: z.number().int().positive().max(25 * 1_048_576),
  })
  .strict();

const checklistAuthoringItemSchema = z
  .object({
    label: requiredText(500),
    instructions: optionalText(5_000),
    responseType: z.enum(["checkbox", "text", "number", "photo", "temperature"]),
    required: z.boolean(),
    validation: z.record(z.string(), z.json()).default({}),
  })
  .strict();

export const createChecklistTemplateVersionInputSchema = z
  .object({
    requestId: uuid,
    locationId: uuid,
    name: requiredText(240),
    checklistType: z.enum(["opening", "closing", "safety", "cleaning", "custom"]),
    items: z.array(checklistAuthoringItemSchema).min(1).max(100),
  })
  .strict();

export const publishChecklistTemplateInputSchema = z
  .object({ requestId: uuid, templateId: uuid })
  .strict();

export const completeChecklistRunInputSchema = z
  .object({
    requestId: uuid,
    runId: uuid,
    note: optionalText(2_000),
  })
  .strict();

export const acknowledgeSopInputSchema = z
  .object({
    requestId: uuid,
    sopVersionId: uuid,
  })
  .strict();

const sopBody = requiredText(100_000);
const sopChangeSummary = optionalText(2_000);

export const createSopDraftInputSchema = z
  .object({
    requestId: uuid,
    locationId: uuid,
    title: requiredText(240),
    category: optionalText(120),
    requiresAcknowledgement: z.boolean(),
    body: sopBody,
    changeSummary: sopChangeSummary,
  })
  .strict();

export const createSopVersionInputSchema = z
  .object({
    requestId: uuid,
    sopDocumentId: uuid,
    body: sopBody,
    changeSummary: sopChangeSummary,
  })
  .strict();

export const updateSopDraftInputSchema = z
  .object({
    requestId: uuid,
    sopVersionId: uuid,
    body: sopBody,
    changeSummary: sopChangeSummary,
  })
  .strict();

export const publishSopVersionInputSchema = z
  .object({ requestId: uuid, sopVersionId: uuid })
  .strict();

export const createMaintenanceRequestInputSchema = z
  .object({
    requestId: uuid,
    locationId: uuid,
    title: requiredText(240),
    description: requiredText(10_000),
    category: optionalText(120),
    priority: z.enum(["low", "normal", "high", "emergency"]),
    assignedTo: optionalText(240),
    vendorId: uuid.nullable().optional(),
    dueAt: nullableInstant,
  })
  .strict();

const nullableCents = z
  .number()
  .int()
  .min(0)
  .max(Number.MAX_SAFE_INTEGER)
  .nullable()
  .optional();

export const setMaintenanceStatusInputSchema = z
  .object({
    requestId: uuid,
    maintenanceRequestId: uuid,
    status: taskStatus,
    assignedTo: optionalText(240),
    vendorId: uuid.nullable().optional(),
    estimatedCostCents: nullableCents,
    actualCostCents: nullableCents,
    dueAt: nullableInstant,
    note: optionalText(2_000),
  })
  .strict();

export const createIncidentInputSchema = z
  .object({
    requestId: uuid,
    locationId: uuid,
    incidentType: requiredText(120),
    severity: z.enum(["low", "medium", "high", "critical"]),
    description: requiredText(20_000),
    occurredAt: isoInstant,
    involvedEmployeeIds: z.array(uuid).max(100).default([]),
    guestId: uuid.nullable().optional(),
  })
  .strict();

export const setIncidentStatusInputSchema = z
  .object({
    requestId: uuid,
    incidentId: uuid,
    status: z.enum(["open", "investigating", "resolved", "closed"]),
    followUp: optionalText(10_000),
  })
  .strict();

export type CreateTaskInput = z.infer<typeof createTaskInputSchema>;
export type TransitionTaskInput = z.infer<typeof transitionTaskInputSchema>;
export type StartChecklistRunInput = z.infer<typeof startChecklistRunInputSchema>;
export type RecordChecklistResponseInput = z.infer<
  typeof recordChecklistResponseInputSchema
>;
export type ChecklistEvidenceUploadInput = z.infer<
  typeof checklistEvidenceUploadInputSchema
>;
export type CreateChecklistTemplateVersionInput = z.infer<
  typeof createChecklistTemplateVersionInputSchema
>;
export type PublishChecklistTemplateInput = z.infer<
  typeof publishChecklistTemplateInputSchema
>;
export type CompleteChecklistRunInput = z.infer<typeof completeChecklistRunInputSchema>;
export type AcknowledgeSopInput = z.infer<typeof acknowledgeSopInputSchema>;
export type CreateSopDraftInput = z.infer<typeof createSopDraftInputSchema>;
export type CreateSopVersionInput = z.infer<typeof createSopVersionInputSchema>;
export type UpdateSopDraftInput = z.infer<typeof updateSopDraftInputSchema>;
export type PublishSopVersionInput = z.infer<typeof publishSopVersionInputSchema>;
export type CreateMaintenanceRequestInput = z.infer<
  typeof createMaintenanceRequestInputSchema
>;
export type SetMaintenanceStatusInput = z.infer<typeof setMaintenanceStatusInputSchema>;
export type CreateIncidentInput = z.infer<typeof createIncidentInputSchema>;
export type SetIncidentStatusInput = z.infer<typeof setIncidentStatusInputSchema>;
export type OperationsTaskStatus = z.infer<typeof taskStatus>;
