import { describe, expect, it } from "vitest";
import {
  acknowledgeShiftInputSchema,
  approveCloseoutInputSchema,
  approveTimeCorrectionInputSchema,
  approveTipRunInputSchema,
  calculateTipRunInputSchema,
  clockInInputSchema,
  clockOutInputSchema,
  closeoutUploadUrlInputSchema,
  endBreakInputSchema,
  exportTipPayrollInputSchema,
  finalizeReceiptUploadInputSchema,
  finalizeCloseoutUploadInputSchema,
  markChatReadInputSchema,
  publishScheduleInputSchema,
  privateFileDownloadInputSchema,
  prepareTipRunInputSchema,
  receiptUploadUrlInputSchema,
  requestTimeCorrectionInputSchema,
  recordMissedTimeEntryInputSchema,
  requestReportExportInputSchema,
  reviewReceiptInputSchema,
  searchGuestsInputSchema,
  sendChatMessageInputSchema,
  startBreakInputSchema,
  submitCloseoutInputSchema,
  submitInventoryCountInputSchema,
} from "@/data/schemas";

const ids = {
  request: "11111111-1111-4111-8111-111111111111",
  organization: "22222222-2222-4222-8222-222222222222",
  location: "33333333-3333-4333-8333-333333333333",
  resource: "44444444-4444-4444-8444-444444444444",
  related: "55555555-5555-4555-8555-555555555555",
  unit: "66666666-6666-4666-8666-666666666666",
};

const closeout = {
  submissionId: ids.request,
  locationId: ids.location,
  businessDate: "2026-08-01",
  shiftLabel: "Dinner",
  grossSalesCents: 100_00,
  netSalesCents: 90_00,
  cashSalesCents: 20_00,
  cardSalesCents: 70_00,
  expectedCashCents: 20_00,
  actualCashCents: 19_95,
  covers: 40,
  compsCents: 2_00,
  voidsCents: 1_00,
  serviceChargesCents: 5_00,
  cardTipsCents: 18_00,
  cashTipsCents: 4_00,
  notes: "Balanced drawer",
};

describe("workflow action schemas", () => {
  it("accepts valid inputs for every critical workflow", () => {
    const cases = [
      [publishScheduleInputSchema, { scheduleId: ids.resource, note: "Ready" }],
      [acknowledgeShiftInputSchema, { shiftId: ids.resource, note: null }],
      [
        sendChatMessageInputSchema,
        {
          requestId: ids.request,
          channelId: ids.resource,
          body: "Family meal at 4:00.",
          replyToId: null,
        },
      ],
      [markChatReadInputSchema, { channelId: ids.resource, lastReadMessageId: ids.related }],
      [
        clockInInputSchema,
        {
          requestId: ids.request,
          locationId: ids.location,
          jobRoleId: ids.related,
          scheduledShiftId: null,
        },
      ],
      [clockOutInputSchema, { timeEntryId: ids.resource }],
      [
        startBreakInputSchema,
        { requestId: ids.request, timeEntryId: ids.resource, isPaid: false },
      ],
      [endBreakInputSchema, { breakId: ids.resource }],
      [
        approveTimeCorrectionInputSchema,
        { correctionId: ids.resource, approve: true, decisionNote: "Verified" },
      ],
      [
        requestTimeCorrectionInputSchema,
        {
          requestId: ids.request,
          timeEntryId: ids.resource,
          proposedClockedOutLocal: "2026-08-01T23:15",
          reason: "I missed my clock-out after closing service.",
        },
      ],
      [
        recordMissedTimeEntryInputSchema,
        {
          requestId: ids.request,
          locationId: ids.location,
          employeeId: ids.resource,
          jobRoleId: ids.related,
          scheduledShiftId: ids.unit,
          clockedInLocal: "2026-08-01T16:00",
          clockedOutLocal: "2026-08-01T23:15",
          reason: "Manager verified the missed shift after service.",
        },
      ],
      [submitCloseoutInputSchema, closeout],
      [approveCloseoutInputSchema, { closeoutId: ids.resource, approved: true }],
      [
        closeoutUploadUrlInputSchema,
        {
          uploadId: ids.request,
          closeoutId: ids.resource,
          fileName: "cash-sheet.pdf",
          mimeType: "application/pdf",
          sizeBytes: 4_096,
        },
      ],
      [
        finalizeCloseoutUploadInputSchema,
        {
          closeoutId: ids.resource,
          objectPath: `${ids.organization}/${ids.location}/closeouts/${ids.resource}/${ids.request}-cash-sheet.pdf`,
          fileName: "cash-sheet.pdf",
          mimeType: "application/pdf",
          sizeBytes: 4_096,
        },
      ],
      [
        prepareTipRunInputSchema,
        {
          requestId: ids.request,
          closeoutId: ids.resource,
          policyVersionId: ids.related,
        },
      ],
      [calculateTipRunInputSchema, { tipRunId: ids.resource }],
      [approveTipRunInputSchema, { tipRunId: ids.resource }],
      [
        exportTipPayrollInputSchema,
        { requestId: ids.request, tipRunId: ids.resource },
      ],
      [
        reviewReceiptInputSchema,
        {
          receiptId: ids.resource,
          reviewStatus: "approved",
          totalCents: 12_34,
          documentDate: "2026-08-01",
        },
      ],
      [
        receiptUploadUrlInputSchema,
        {
          uploadId: ids.request,
          locationId: ids.location,
          fileName: "invoice.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
        },
      ],
      [
        finalizeReceiptUploadInputSchema,
        {
          requestId: ids.request,
          receiptId: ids.resource,
          objectPath: `${ids.organization}/${ids.location}/receipts/${ids.resource}/${ids.request}-invoice.pdf`,
          fileName: "invoice.pdf",
          mimeType: "application/pdf",
          sizeBytes: 2048,
        },
      ],
      [
        privateFileDownloadInputSchema,
        {
          bucket: "receipts",
          objectPath: `${ids.organization}/${ids.location}/receipts/${ids.resource}/${ids.request}-invoice.pdf`,
          downloadFileName: "invoice.pdf",
        },
      ],
      [
        submitInventoryCountInputSchema,
        {
          submissionId: ids.request,
          locationId: ids.location,
          countType: "cycle",
          lines: [
            {
              inventoryItemId: ids.resource,
              unitId: ids.unit,
              expectedQuantity: 8,
              countedQuantity: 7.5,
            },
          ],
        },
      ],
      [
        searchGuestsInputSchema,
        {
          organizationId: ids.organization,
          locationId: ids.location,
          query: "birthday august",
          limit: 25,
        },
      ],
      [
        requestReportExportInputSchema,
        {
          requestId: ids.request,
          organizationId: ids.organization,
          locationId: ids.location,
          reportType: "labor",
          periodStart: "2026-07-01",
          periodEnd: "2026-07-31",
          filters: { status: ["approved"] },
          exportType: "csv",
        },
      ],
    ] as const;

    for (const [schema, input] of cases) {
      expect(schema.safeParse(input).success).toBe(true);
    }
  });

  it("rejects browser-supplied tenant and actor IDs on resource-scoped commands", () => {
    expect(
      publishScheduleInputSchema.safeParse({
        scheduleId: ids.resource,
        organizationId: ids.organization,
      }).success,
    ).toBe(false);
    expect(
      acknowledgeShiftInputSchema.safeParse({
        shiftId: ids.resource,
        userId: ids.related,
      }).success,
    ).toBe(false);
    expect(
      sendChatMessageInputSchema.safeParse({
        requestId: ids.request,
        channelId: ids.resource,
        body: "Hello",
        authorId: ids.related,
      }).success,
    ).toBe(false);
  });

  it("requires UUID resource and idempotency keys", () => {
    expect(
      sendChatMessageInputSchema.safeParse({
        requestId: "retry-1",
        channelId: ids.resource,
        body: "Hello",
      }).success,
    ).toBe(false);
    expect(clockOutInputSchema.safeParse({ timeEntryId: "demo-id" }).success).toBe(false);
  });

  it("requires a meaningful local-time correction proposal", () => {
    expect(
      requestTimeCorrectionInputSchema.safeParse({
        requestId: ids.request,
        timeEntryId: ids.resource,
        reason: "The recorded punch is incorrect.",
      }).success,
    ).toBe(false);
    expect(
      requestTimeCorrectionInputSchema.safeParse({
        requestId: ids.request,
        timeEntryId: ids.resource,
        proposedClockedOutLocal: "2026-08-01 23:15",
        reason: "I missed my clock-out after closing service.",
      }).success,
    ).toBe(false);
  });

  it("rejects invalid financial values and impossible report ranges", () => {
    expect(
      submitCloseoutInputSchema.safeParse({ ...closeout, grossSalesCents: -1 }).success,
    ).toBe(false);
    expect(
      requestReportExportInputSchema.safeParse({
        requestId: ids.request,
        organizationId: ids.organization,
        reportType: "labor",
        periodStart: "2026-08-02",
        periodEnd: "2026-08-01",
        exportType: "csv",
      }).success,
    ).toBe(false);
  });

  it("rejects duplicate item-unit pairs within an inventory count", () => {
    const duplicate = {
      inventoryItemId: ids.resource,
      unitId: ids.unit,
      countedQuantity: 2,
    };
    const parsed = submitInventoryCountInputSchema.safeParse({
      submissionId: ids.request,
      locationId: ids.location,
      countType: "full",
      lines: [duplicate, duplicate],
    });
    expect(parsed.success).toBe(false);
  });

  it("enforces private receipt bucket constraints before signing", () => {
    const base = {
      uploadId: ids.request,
      locationId: ids.location,
      fileName: "receipt.exe",
      sizeBytes: 1024,
    };
    expect(
      receiptUploadUrlInputSchema.safeParse({ ...base, mimeType: "application/x-msdownload" })
        .success,
    ).toBe(false);
    expect(
      receiptUploadUrlInputSchema.safeParse({
        ...base,
        fileName: "receipt.pdf",
        mimeType: "application/pdf",
        sizeBytes: 52_428_801,
      }).success,
    ).toBe(false);
  });

  it("bounds search and chat payloads", () => {
    expect(
      searchGuestsInputSchema.safeParse({
        organizationId: ids.organization,
        locationId: ids.location,
        query: "x",
      }).success,
    ).toBe(false);
    expect(
      sendChatMessageInputSchema.safeParse({
        requestId: ids.request,
        channelId: ids.resource,
        body: " ",
      }).success,
    ).toBe(false);
  });
});
