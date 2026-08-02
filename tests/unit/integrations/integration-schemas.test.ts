import { describe, expect, it } from "vitest";
import {
  finalizeManualCsvImportInputSchema,
  manualCsvUploadUrlInputSchema,
  retryIntegrationSyncInputSchema,
} from "@/data/schemas";

const ids = {
  request: "10000000-0000-4000-8000-000000000001",
  upload: "20000000-0000-4000-8000-000000000001",
  location: "30000000-0000-4000-8000-000000000001",
  sync: "40000000-0000-4000-8000-000000000001",
  organization: "50000000-0000-4000-8000-000000000001",
};

describe("integration action schemas", () => {
  it("accepts bounded CSV upload and retry commands", () => {
    const upload = {
      requestId: ids.request,
      uploadId: ids.upload,
      locationId: ids.location,
      importType: "toast_sales",
      fileName: "sales.csv",
      mimeType: "text/csv",
      sizeBytes: 4_096,
    };
    expect(manualCsvUploadUrlInputSchema.safeParse(upload).success).toBe(true);
    expect(
      finalizeManualCsvImportInputSchema.safeParse({
        ...upload,
        objectPath: `${ids.organization}/${ids.location}/imports/${ids.request}/${ids.upload}-sales.csv`,
      }).success,
    ).toBe(true);
    expect(
      retryIntegrationSyncInputSchema.safeParse({
        requestId: ids.request,
        syncJobId: ids.sync,
      }).success,
    ).toBe(true);
  });

  it("rejects unsupported files, oversized content, and browser-supplied actors", () => {
    const upload = {
      requestId: ids.request,
      uploadId: ids.upload,
      locationId: ids.location,
      importType: "toast_sales",
      fileName: "payload.xlsx",
      mimeType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      sizeBytes: 4_096,
    };
    expect(manualCsvUploadUrlInputSchema.safeParse(upload).success).toBe(false);
    expect(
      manualCsvUploadUrlInputSchema.safeParse({
        ...upload,
        fileName: "sales.csv",
        mimeType: "text/csv",
        sizeBytes: 5 * 1_048_576 + 1,
      }).success,
    ).toBe(false);
    expect(
      retryIntegrationSyncInputSchema.safeParse({
        requestId: ids.request,
        syncJobId: ids.sync,
        actorId: ids.upload,
      }).success,
    ).toBe(false);
  });
});
