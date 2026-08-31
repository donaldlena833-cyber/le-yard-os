import { z } from "zod";
import {
  MANUAL_CSV_MAX_BYTES,
  manualCsvImportTypeValues,
} from "@/lib/integrations/csv-import";

const uuid = z.string().uuid();
const shortNote = z.string().trim().max(2_000).nullable().optional();
const longNote = z.string().trim().max(10_000).nullable().optional();
const cents = z.number().int().min(0).max(Number.MAX_SAFE_INTEGER);
const nullableCents = cents.nullable();
const quantity = z
  .number()
  .finite()
  .min(0)
  .lt(1_000_000_000_000)
  .refine(
    (value) =>
      Math.abs(value * 10_000 - Math.round(value * 10_000)) < 0.000_001,
    "Use no more than four decimal places.",
  );
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date in YYYY-MM-DD format.")
  .refine(
    (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    "Invalid date.",
  );
const localDateTime = z
  .string()
  .regex(
    /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/,
    "Use a local date and time in YYYY-MM-DDTHH:mm format.",
  );

const jsonObject = z
  .record(z.string(), z.unknown())
  .refine(
    (value) => JSON.stringify(value).length <= 32_768,
    "Filters must be 32 KB or smaller.",
  );

export const publishScheduleInputSchema = z
  .object({
    scheduleId: uuid,
    note: shortNote,
  })
  .strict();

export const acknowledgeShiftInputSchema = z
  .object({
    shiftId: uuid,
    note: shortNote,
  })
  .strict();

export const sendChatMessageInputSchema = z
  .object({
    requestId: uuid,
    channelId: uuid,
    body: z.string().trim().min(1).max(10_000),
    replyToId: uuid.nullable().optional(),
    isAnnouncement: z.boolean().default(false),
  })
  .strict();

export const markChatReadInputSchema = z
  .object({
    channelId: uuid,
    lastReadMessageId: uuid.nullable(),
  })
  .strict();

export const clockInInputSchema = z
  .object({
    requestId: uuid,
    locationId: uuid,
    jobRoleId: uuid,
    scheduledShiftId: uuid.nullable().optional(),
  })
  .strict();

export const clockOutInputSchema = z
  .object({
    timeEntryId: uuid,
  })
  .strict();

export const startBreakInputSchema = z
  .object({
    requestId: uuid,
    timeEntryId: uuid,
    isPaid: z.boolean(),
  })
  .strict();

export const endBreakInputSchema = z
  .object({
    breakId: uuid,
  })
  .strict();

export const approveTimeCorrectionInputSchema = z
  .object({
    correctionId: uuid,
    approve: z.boolean(),
    decisionNote: shortNote,
  })
  .strict();

export const requestTimeCorrectionInputSchema = z
  .object({
    requestId: uuid,
    timeEntryId: uuid,
    proposedClockedInLocal: localDateTime.nullable().optional(),
    proposedClockedOutLocal: localDateTime.nullable().optional(),
    proposedJobRoleId: uuid.nullable().optional(),
    reason: z.string().trim().min(8).max(2_000),
  })
  .strict()
  .refine(
    (value) =>
      Boolean(
        value.proposedClockedInLocal ||
        value.proposedClockedOutLocal ||
        value.proposedJobRoleId,
      ),
    { message: "Propose at least one punch or job-role correction." },
  );

export const recordMissedTimeEntryInputSchema = z
  .object({
    requestId: uuid,
    locationId: uuid,
    employeeId: uuid,
    jobRoleId: uuid,
    scheduledShiftId: uuid.nullable().optional(),
    clockedInLocal: localDateTime,
    clockedOutLocal: localDateTime,
    reason: z.string().trim().min(8).max(2_000),
  })
  .strict()
  .refine((value) => value.clockedOutLocal > value.clockedInLocal, {
    message: "The missed shift clock-out must be after clock-in.",
    path: ["clockedOutLocal"],
  });

export const submitCloseoutInputSchema = z
  .object({
    submissionId: uuid,
    locationId: uuid,
    businessDate: isoDate,
    shiftLabel: z.string().trim().min(1).max(80),
    grossSalesCents: cents,
    netSalesCents: cents,
    cashSalesCents: cents,
    cardSalesCents: cents,
    expectedCashCents: z
      .number()
      .int()
      .min(-Number.MAX_SAFE_INTEGER)
      .max(Number.MAX_SAFE_INTEGER),
    actualCashCents: nullableCents,
    covers: z.number().int().min(0).max(100_000),
    compsCents: cents,
    voidsCents: cents,
    serviceChargesCents: cents,
    cardTipsCents: cents,
    cashTipsCents: cents,
    notes: longNote,
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.grossSalesCents - value.compsCents - value.voidsCents !==
      value.netSalesCents
    ) {
      context.addIssue({
        code: "custom",
        path: ["netSalesCents"],
        message: "Gross sales less comps and voids must equal net sales.",
      });
    }
    if (value.cashSalesCents + value.cardSalesCents !== value.netSalesCents) {
      context.addIssue({
        code: "custom",
        path: ["cardSalesCents"],
        message: "Cash and card tenders must equal net sales.",
      });
    }
    if (
      value.actualCashCents !== null &&
      value.actualCashCents !== value.expectedCashCents &&
      (value.notes?.trim().length ?? 0) < 8
    ) {
      context.addIssue({
        code: "custom",
        path: ["notes"],
        message: "Explain the cash variance or link a recorded correction.",
      });
    }
  });

export const approveCloseoutInputSchema = z
  .object({
    closeoutId: uuid,
    approved: z.boolean(),
    note: shortNote,
  })
  .strict();

export const closeoutUploadUrlInputSchema = z
  .object({
    uploadId: uuid,
    closeoutId: uuid,
    fileName: z.string().trim().min(1).max(240),
    mimeType: z.enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ]),
    sizeBytes: z.number().int().positive().max(26_214_400),
  })
  .strict();

export const finalizeCloseoutUploadInputSchema = z
  .object({
    closeoutId: uuid,
    objectPath: z.string().trim().min(1).max(1_024),
    fileName: z.string().trim().min(1).max(240),
    mimeType: z.enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ]),
    sizeBytes: z.number().int().positive().max(26_214_400),
  })
  .strict();

export const prepareTipRunInputSchema = z
  .object({
    requestId: uuid,
    closeoutId: uuid,
    policyVersionId: uuid,
  })
  .strict();

export const calculateTipRunInputSchema = z.object({ tipRunId: uuid }).strict();

export const approveTipRunInputSchema = z.object({ tipRunId: uuid }).strict();

export const exportTipPayrollInputSchema = z
  .object({
    requestId: uuid,
    tipRunId: uuid,
  })
  .strict();

export const reviewReceiptInputSchema = z
  .object({
    receiptId: uuid,
    reviewStatus: z.enum(["in_review", "approved", "rejected"]),
    vendorId: uuid.nullable().optional(),
    expenseCategoryId: uuid.nullable().optional(),
    documentNumber: z.string().trim().max(160).nullable().optional(),
    documentDate: isoDate.nullable().optional(),
    totalCents: nullableCents.optional(),
    taxCents: nullableCents.optional(),
    paymentMethod: z.string().trim().max(120).nullable().optional(),
    notes: longNote,
  })
  .strict();

export const receiptUploadUrlInputSchema = z
  .object({
    uploadId: uuid,
    locationId: uuid,
    fileName: z.string().trim().min(1).max(240),
    mimeType: z.enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ]),
    sizeBytes: z.number().int().positive().max(52_428_800),
    source: z.enum(["upload", "camera"]).default("upload"),
  })
  .strict();

export const finalizeReceiptUploadInputSchema = z
  .object({
    requestId: uuid,
    receiptId: uuid,
    objectPath: z.string().trim().min(1).max(1_024),
    fileName: z.string().trim().min(1).max(240),
    mimeType: z.enum([
      "image/jpeg",
      "image/png",
      "image/webp",
      "application/pdf",
    ]),
    sizeBytes: z.number().int().positive().max(52_428_800),
  })
  .strict();

const csvFileName = z
  .string()
  .trim()
  .min(1)
  .max(240)
  .refine(
    (value) => value.toLowerCase().endsWith(".csv"),
    "Choose a .csv file.",
  );

export const manualCsvUploadUrlInputSchema = z
  .object({
    requestId: uuid,
    uploadId: uuid,
    locationId: uuid,
    importType: z.enum(manualCsvImportTypeValues),
    fileName: csvFileName,
    mimeType: z.literal("text/csv"),
    sizeBytes: z.number().int().positive().max(MANUAL_CSV_MAX_BYTES),
  })
  .strict();

export const finalizeManualCsvImportInputSchema = z
  .object({
    requestId: uuid,
    uploadId: uuid,
    locationId: uuid,
    importType: z.enum(manualCsvImportTypeValues),
    objectPath: z.string().trim().min(1).max(1_024),
    fileName: csvFileName,
    mimeType: z.literal("text/csv"),
    sizeBytes: z.number().int().positive().max(MANUAL_CSV_MAX_BYTES),
  })
  .strict();

export const retryIntegrationSyncInputSchema = z
  .object({
    requestId: uuid,
    syncJobId: uuid,
  })
  .strict();

export const privateFileDownloadInputSchema = z
  .object({
    bucket: z.enum([
      "profile-avatars",
      "employee-documents",
      "chat-attachments",
      "receipts",
      "closeouts",
      "inventory",
      "sops",
      "incidents",
      "reports",
      "imports",
      "checklists",
    ]),
    objectPath: z.string().trim().min(1).max(1_024),
    downloadFileName: z.string().trim().min(1).max(240).optional(),
  })
  .strict();

const inventoryCountLineSchema = z
  .object({
    inventoryItemId: uuid,
    unitId: uuid,
    expectedQuantity: quantity.nullable().optional(),
    countedQuantity: quantity,
    unitCostCents: nullableCents.optional(),
    notes: shortNote,
  })
  .strict();

export const submitInventoryCountInputSchema = z
  .object({
    submissionId: uuid,
    locationId: uuid,
    countType: z.enum(["full", "cycle", "spot"]),
    notes: longNote,
    lines: z.array(inventoryCountLineSchema).min(1).max(1_000),
  })
  .strict()
  .superRefine((value, context) => {
    const keys = new Set<string>();
    value.lines.forEach((line, index) => {
      const key = `${line.inventoryItemId}:${line.unitId}`;
      if (keys.has(key)) {
        context.addIssue({
          code: "custom",
          message: "Each item and unit combination may appear only once.",
          path: ["lines", index],
        });
      }
      keys.add(key);
    });
  });

export const approveInventoryCountInputSchema = z
  .object({
    requestId: uuid,
    countId: uuid,
    approve: z.boolean(),
    note: shortNote,
  })
  .strict();

const positiveInventoryQuantity = quantity.refine((value) => value > 0, {
  message: "Quantity must be greater than zero.",
});

const inventoryOrderLineSchema = z
  .object({
    inventoryItemId: uuid,
    unitId: uuid,
    quantity: positiveInventoryQuantity,
    unitPriceCents: cents,
    notes: shortNote,
  })
  .strict();

const inventoryDeliveryLineSchema = z
  .object({
    inventoryItemId: uuid,
    unitId: uuid,
    quantity: positiveInventoryQuantity,
    acceptedQuantity: quantity,
    unitPriceCents: cents,
    lotCode: z.string().trim().max(120).nullable().optional(),
    expiresOn: isoDate.nullable().optional(),
    exceptionKind: z.enum([
      "none", "damaged", "rejected", "substituted", "missing", "unexpected", "short", "over",
    ]),
    exceptionNote: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict()
  .refine((value) => value.acceptedQuantity <= value.quantity, {
    message: "Accepted quantity cannot exceed delivered quantity.",
    path: ["acceptedQuantity"],
  })
  .refine(
    (value) => value.exceptionKind === "none" || Boolean(value.exceptionNote),
    { message: "Receiving exceptions require a note.", path: ["exceptionNote"] },
  );

const inventoryTransferLineSchema = z
  .object({
    inventoryItemId: uuid,
    unitId: uuid,
    sentQuantity: positiveInventoryQuantity,
  })
  .strict();

function uniqueInventoryLinePairs<
  T extends { inventoryItemId: string; unitId: string },
>(lines: T[]) {
  return (
    new Set(lines.map((line) => `${line.inventoryItemId}:${line.unitId}`))
      .size === lines.length
  );
}

export const createPurchaseOrderInputSchema = z
  .object({
    requestId: uuid,
    locationId: uuid,
    vendorId: uuid,
    poNumber: z.string().trim().min(1).max(80),
    orderedOn: isoDate.nullable().optional(),
    expectedOn: isoDate.nullable().optional(),
    taxCents: cents,
    shippingCents: cents,
    notes: z.string().trim().max(4_000).nullable().optional(),
    lines: z.array(inventoryOrderLineSchema).min(1).max(500),
  })
  .strict()
  .refine(
    (value) =>
      !value.orderedOn ||
      !value.expectedOn ||
      value.expectedOn >= value.orderedOn,
    {
      message: "Expected date cannot be before the order date.",
      path: ["expectedOn"],
    },
  )
  .refine((value) => uniqueInventoryLinePairs(value.lines), {
    message: "Each item and unit combination may appear only once.",
    path: ["lines"],
  });

export const reviewPurchaseOrderInputSchema = z
  .object({
    requestId: uuid,
    purchaseOrderId: uuid,
    approve: z.boolean(),
    note: z.string().trim().max(2_000).nullable().optional(),
  })
  .strict();

export const receiveInventoryDeliveryInputSchema = z
  .object({
    requestId: uuid,
    locationId: uuid,
    vendorId: uuid,
    purchaseOrderId: uuid.nullable().optional(),
    deliveredAt: z.string().datetime({ offset: true }),
    invoiceNumber: z.string().trim().max(120).nullable().optional(),
    notes: z.string().trim().max(4_000).nullable().optional(),
    lines: z.array(inventoryDeliveryLineSchema).min(1).max(500),
  })
  .strict()
  .refine((value) => uniqueInventoryLinePairs(value.lines), {
    message: "Each item and unit combination may appear only once.",
    path: ["lines"],
  });

export const reviewDeliveryExceptionsInputSchema = z.object({
  requestId: uuid,
  postingRequestId: uuid,
  deliveryId: uuid,
  approve: z.boolean(),
  note: z.string().trim().max(2_000).nullable().optional(),
}).strict();

export const submitWasteRecordInputSchema = z
  .object({
    requestId: uuid,
    locationId: uuid,
    inventoryItemId: uuid,
    unitId: uuid,
    quantity: positiveInventoryQuantity,
    reasonCode: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_]{0,63}$/),
    occurredAt: z.string().datetime({ offset: true }),
    notes: z.string().trim().max(4_000).nullable().optional(),
  })
  .strict();

export const reviewWasteRecordInputSchema = z
  .object({
    requestId: uuid,
    wasteRecordId: uuid,
    approve: z.boolean(),
    note: shortNote,
  })
  .strict();

export const createInventoryTransferInputSchema = z
  .object({
    requestId: uuid,
    fromLocationId: uuid,
    toLocationId: uuid,
    notes: z.string().trim().max(4_000).nullable().optional(),
    lines: z.array(inventoryTransferLineSchema).min(1).max(500),
  })
  .strict()
  .refine((value) => value.fromLocationId !== value.toLocationId, {
    message: "Source and destination must be different locations.",
    path: ["toLocationId"],
  })
  .refine((value) => uniqueInventoryLinePairs(value.lines), {
    message: "Each item and unit combination may appear only once.",
    path: ["lines"],
  });

export const reviewInventoryTransferInputSchema = z
  .object({
    requestId: uuid,
    transferId: uuid,
    approve: z.boolean(),
    note: shortNote,
    lines: z
      .array(
        z
          .object({
            inventoryItemId: uuid,
            unitId: uuid,
            receivedQuantity: quantity,
          })
          .strict(),
      )
      .max(500),
  })
  .strict()
  .refine(
    (value) =>
      value.approve ? value.lines.length > 0 : value.lines.length === 0,
    {
      message:
        "Approved transfers require received quantities; rejected transfers cannot include them.",
      path: ["lines"],
    },
  )
  .refine((value) => uniqueInventoryLinePairs(value.lines), {
    message: "Each item and unit combination may appear only once.",
    path: ["lines"],
  });

const catalogCommandBase = {
  requestId: uuid,
  workspaceLocationId: uuid,
};
const catalogId = uuid.nullable().optional();
const catalogName = z.string().trim().min(1).max(160);
const catalogOptionalText = (maximum: number) =>
  z.string().trim().max(maximum).nullable().optional();
const catalogPositiveQuantity = quantity.refine((value) => value > 0, {
  message: "Quantity must be greater than zero.",
});
const recipeQuantity = z
  .number()
  .finite()
  .positive()
  .lt(1_000_000_000_000)
  .refine(
    (value) =>
      Math.abs(value * 1_000_000 - Math.round(value * 1_000_000)) < 0.000_001,
    "Use no more than six decimal places.",
  );

const catalogRecipeIngredientSchema = z
  .object({
    inventoryItemId: uuid,
    unitId: uuid,
    quantity: recipeQuantity,
    wasteFactor: z
      .number()
      .finite()
      .min(0)
      .lt(1)
      .refine(
        (value) =>
          Math.abs(value * 1_000_000 - Math.round(value * 1_000_000)) <
          0.000_001,
        "Use no more than six decimal places.",
      ),
  })
  .strict();

export const configureInventoryCatalogInputSchema = z.discriminatedUnion(
  "command",
  [
    z
      .object({
        ...catalogCommandBase,
        command: z.literal("unit.save"),
        id: catalogId,
        name: z.string().trim().min(1).max(120),
        symbol: z.string().trim().min(1).max(24),
        dimension: z.enum(["count", "mass", "volume", "length"]),
        isBase: z.boolean(),
        isActive: z.boolean(),
      })
      .strict(),
    z
      .object({
        ...catalogCommandBase,
        command: z.literal("conversion.save"),
        id: catalogId,
        fromUnitId: uuid,
        toUnitId: uuid,
        inventoryItemId: uuid.nullable().optional(),
        multiplier: z
          .number()
          .finite()
          .positive()
          .lt(1_000_000_000_000)
          .refine(
            (value) =>
              Math.abs(value * 100_000_000 - Math.round(value * 100_000_000)) <
              0.000_001,
            "Use no more than eight decimal places.",
          ),
        isActive: z.boolean(),
      })
      .strict()
      .refine((value) => value.fromUnitId !== value.toUnitId, {
        message: "Conversion units must be different.",
        path: ["toUnitId"],
      }),
    z
      .object({
        ...catalogCommandBase,
        command: z.literal("category.save"),
        id: catalogId,
        name: z.string().trim().min(1).max(120),
        parentId: uuid.nullable().optional(),
        isActive: z.boolean(),
      })
      .strict(),
    z
      .object({
        ...catalogCommandBase,
        command: z.literal("vendor.save"),
        id: catalogId,
        name: catalogName,
        accountNumber: catalogOptionalText(120),
        contactName: catalogOptionalText(160),
        email: z
          .string()
          .trim()
          .toLowerCase()
          .email()
          .max(320)
          .nullable()
          .optional(),
        phone: catalogOptionalText(80),
        paymentTerms: catalogOptionalText(160),
        isActive: z.boolean(),
      })
      .strict(),
    z
      .object({
        ...catalogCommandBase,
        command: z.literal("item.save"),
        id: catalogId,
        name: catalogName,
        sku: catalogOptionalText(120),
        description: catalogOptionalText(4_000),
        categoryId: uuid.nullable().optional(),
        baseUnitId: uuid,
        trackInventory: z.boolean(),
        isActive: z.boolean(),
      })
      .strict(),
    z
      .object({
        ...catalogCommandBase,
        command: z.literal("vendor_item.save"),
        id: catalogId,
        vendorId: uuid,
        inventoryItemId: uuid,
        purchaseUnitId: uuid,
        vendorSku: catalogOptionalText(120),
        packQuantity: catalogPositiveQuantity,
        lastPriceCents: nullableCents.optional(),
        priceEffectiveAt: z.string().datetime({ offset: true }),
        isPreferred: z.boolean(),
        isActive: z.boolean(),
      })
      .strict(),
    z
      .object({
        ...catalogCommandBase,
        command: z.literal("par.set"),
        locationId: uuid,
        inventoryItemId: uuid,
        parQuantity: quantity,
        reorderQuantity: quantity.nullable().optional(),
        effectiveFrom: isoDate,
      })
      .strict()
      .refine(
        (value) =>
          value.reorderQuantity == null ||
          value.reorderQuantity <= value.parQuantity,
        {
          message: "Reorder quantity cannot exceed par.",
          path: ["reorderQuantity"],
        },
      ),
    z
      .object({
        ...catalogCommandBase,
        command: z.literal("recipe.save"),
        id: catalogId,
        name: catalogName,
        yieldQuantity: catalogPositiveQuantity,
        yieldUnitId: uuid,
        menuPriceCents: nullableCents.optional(),
        isActive: z.boolean(),
        ingredients: z.array(catalogRecipeIngredientSchema).max(500),
      })
      .strict()
      .superRefine((value, context) => {
        if (value.isActive && value.ingredients.length === 0) {
          context.addIssue({
            code: "custom",
            message: "Active recipes require an ingredient.",
            path: ["ingredients"],
          });
        }
        const itemIds = value.ingredients.map(
          (ingredient) => ingredient.inventoryItemId,
        );
        if (new Set(itemIds).size !== itemIds.length) {
          context.addIssue({
            code: "custom",
            message: "Each inventory item may appear once.",
            path: ["ingredients"],
          });
        }
      }),
  ],
);

const prepPositiveQuantity = quantity.refine((value) => value > 0, {
  message: "Quantity must be greater than zero.",
});

export const savePrepTaskInputSchema = z
  .object({
    requestId: uuid,
    taskId: uuid,
    locationId: uuid,
    businessDate: isoDate,
    servicePeriod: z.enum(["prep", "lunch", "dinner", "all_day"]),
    station: z.string().trim().min(1).max(80),
    recipeId: uuid.nullable().optional(),
    outputInventoryItemId: uuid.nullable().optional(),
    targetQuantity: prepPositiveQuantity,
    targetUnitId: uuid,
    dueAt: z.string().datetime({ offset: true }),
    assigneeUserId: uuid.nullable().optional(),
    note: shortNote,
    expectedVersion: z.number().int().positive().nullable().optional(),
  })
  .strict()
  .refine((value) => value.recipeId || value.outputInventoryItemId, {
    message: "Choose a recipe or finished inventory item.",
    path: ["recipeId"],
  });

export const transitionPrepTaskInputSchema = z
  .object({
    requestId: uuid,
    taskId: uuid,
    expectedVersion: z.number().int().positive(),
    command: z.enum(["publish", "start"]),
  })
  .strict();

export const previewPrepCompletionInputSchema = z
  .object({
    taskId: uuid,
    actualYield: prepPositiveQuantity,
  })
  .strict();

export const completePrepTaskInputSchema = z
  .object({
    requestId: uuid,
    taskId: uuid,
    expectedVersion: z.number().int().positive(),
    actualYield: prepPositiveQuantity,
    overrideInsufficient: z.boolean(),
    completionNote: shortNote,
  })
  .strict();

export const correctPrepCompletionInputSchema = z
  .object({
    requestId: uuid,
    taskId: uuid,
    expectedVersion: z.number().int().positive(),
    correctionNote: z.string().trim().min(8).max(2_000),
  })
  .strict();

export const recordInventoryItemCostInputSchema = z
  .object({
    requestId: uuid,
    locationId: uuid,
    inventoryItemId: uuid,
    unitId: uuid,
    priceQuantity: recipeQuantity,
    unitPriceCents: cents,
    effectiveAt: z.string().datetime({ offset: true }),
    notes: shortNote,
  })
  .strict();

export const searchGuestsInputSchema = z
  .object({
    organizationId: uuid,
    locationId: uuid,
    query: z.string().trim().min(2).max(200),
    limit: z.number().int().min(1).max(100).default(25),
  })
  .strict();

export const reportTypes = [
  "labor",
  "attendance",
  "overtime",
  "tips",
  "payroll",
  "sales_labor",
  "receipts",
  "expenses",
  "inventory_variance",
  "cogs",
  "waste",
  "vendor_pricing",
  "shift_performance",
  "guest_activity",
] as const;

export const requestReportExportInputSchema = z
  .object({
    requestId: uuid,
    organizationId: uuid,
    locationId: uuid.nullable().optional(),
    savedReportId: uuid.nullable().optional(),
    reportType: z.enum(reportTypes),
    periodStart: isoDate.nullable().optional(),
    periodEnd: isoDate.nullable().optional(),
    filters: jsonObject.default({}),
    exportType: z.enum(["csv", "pdf", "xlsx", "json"]),
  })
  .strict()
  .superRefine((value, context) => {
    if (
      value.periodStart &&
      value.periodEnd &&
      value.periodEnd < value.periodStart
    ) {
      context.addIssue({
        code: "custom",
        message: "The end date cannot be before the start date.",
        path: ["periodEnd"],
      });
    }
  });

export type PublishScheduleInput = z.infer<typeof publishScheduleInputSchema>;
export type AcknowledgeShiftInput = z.infer<typeof acknowledgeShiftInputSchema>;
export type SendChatMessageInput = z.infer<typeof sendChatMessageInputSchema>;
export type MarkChatReadInput = z.infer<typeof markChatReadInputSchema>;
export type ClockInInput = z.infer<typeof clockInInputSchema>;
export type ClockOutInput = z.infer<typeof clockOutInputSchema>;
export type StartBreakInput = z.infer<typeof startBreakInputSchema>;
export type EndBreakInput = z.infer<typeof endBreakInputSchema>;
export type ApproveTimeCorrectionInput = z.infer<
  typeof approveTimeCorrectionInputSchema
>;
export type RequestTimeCorrectionInput = z.infer<
  typeof requestTimeCorrectionInputSchema
>;
export type RecordMissedTimeEntryInput = z.infer<
  typeof recordMissedTimeEntryInputSchema
>;
export type SubmitCloseoutInput = z.infer<typeof submitCloseoutInputSchema>;
export type ApproveCloseoutInput = z.infer<typeof approveCloseoutInputSchema>;
export type CloseoutUploadUrlInput = z.infer<
  typeof closeoutUploadUrlInputSchema
>;
export type FinalizeCloseoutUploadInput = z.infer<
  typeof finalizeCloseoutUploadInputSchema
>;
export type PrepareTipRunInput = z.infer<typeof prepareTipRunInputSchema>;
export type CalculateTipRunInput = z.infer<typeof calculateTipRunInputSchema>;
export type ApproveTipRunInput = z.infer<typeof approveTipRunInputSchema>;
export type ExportTipPayrollInput = z.infer<typeof exportTipPayrollInputSchema>;
export type ReviewReceiptInput = z.infer<typeof reviewReceiptInputSchema>;
export type ReceiptUploadUrlInput = z.infer<typeof receiptUploadUrlInputSchema>;
export type FinalizeReceiptUploadInput = z.infer<
  typeof finalizeReceiptUploadInputSchema
>;
export type ManualCsvUploadUrlInput = z.infer<
  typeof manualCsvUploadUrlInputSchema
>;
export type FinalizeManualCsvImportInput = z.infer<
  typeof finalizeManualCsvImportInputSchema
>;
export type RetryIntegrationSyncInput = z.infer<
  typeof retryIntegrationSyncInputSchema
>;
export type PrivateFileDownloadInput = z.infer<
  typeof privateFileDownloadInputSchema
>;
export type SubmitInventoryCountInput = z.infer<
  typeof submitInventoryCountInputSchema
>;
export type ApproveInventoryCountInput = z.infer<
  typeof approveInventoryCountInputSchema
>;
export type CreatePurchaseOrderInput = z.infer<
  typeof createPurchaseOrderInputSchema
>;
export type ReviewPurchaseOrderInput = z.infer<
  typeof reviewPurchaseOrderInputSchema
>;
export type ReceiveInventoryDeliveryInput = z.infer<
  typeof receiveInventoryDeliveryInputSchema
>;
export type ReviewDeliveryExceptionsInput = z.infer<
  typeof reviewDeliveryExceptionsInputSchema
>;
export type SubmitWasteRecordInput = z.infer<
  typeof submitWasteRecordInputSchema
>;
export type ReviewWasteRecordInput = z.infer<
  typeof reviewWasteRecordInputSchema
>;
export type CreateInventoryTransferInput = z.infer<
  typeof createInventoryTransferInputSchema
>;
export type ReviewInventoryTransferInput = z.infer<
  typeof reviewInventoryTransferInputSchema
>;
export type ConfigureInventoryCatalogInput = z.infer<
  typeof configureInventoryCatalogInputSchema
>;
export type RecordInventoryItemCostInput = z.infer<
  typeof recordInventoryItemCostInputSchema
>;
export type SavePrepTaskInput = z.infer<typeof savePrepTaskInputSchema>;
export type TransitionPrepTaskInput = z.infer<
  typeof transitionPrepTaskInputSchema
>;
export type PreviewPrepCompletionInput = z.infer<
  typeof previewPrepCompletionInputSchema
>;
export type CompletePrepTaskInput = z.infer<
  typeof completePrepTaskInputSchema
>;
export type CorrectPrepCompletionInput = z.infer<
  typeof correctPrepCompletionInputSchema
>;
export type SearchGuestsInput = z.infer<typeof searchGuestsInputSchema>;
export type RequestReportExportInput = z.infer<
  typeof requestReportExportInputSchema
>;
