import { afterEach, describe, expect, it } from "vitest";
import {
  createManualCsvUploadUrl,
  finalizeManualCsvImport,
} from "@/data/workflows/integrations";

const previousFlag = process.env.LE_YARD_MANUAL_CSV_PROCESSOR_ENABLED;

afterEach(() => {
  if (previousFlag === undefined) delete process.env.LE_YARD_MANUAL_CSV_PROCESSOR_ENABLED;
  else process.env.LE_YARD_MANUAL_CSV_PROCESSOR_ENABLED = previousFlag;
});

describe("manual CSV processor gate", () => {
  it("rejects upload preparation and finalization before touching tenant resources", async () => {
    process.env.LE_YARD_MANUAL_CSV_PROCESSOR_ENABLED = "false";
    const context = {} as never;
    const requestId = "50000000-0000-4000-8000-000000000001";
    const uploadId = "60000000-0000-4000-8000-000000000001";
    const locationId = "30000000-0000-4000-8000-000000000001";
    const base = {
      requestId,
      uploadId,
      locationId,
      importType: "toast_sales" as const,
      fileName: "sales.csv",
      mimeType: "text/csv" as const,
      sizeBytes: 48,
    };

    await expect(createManualCsvUploadUrl(context, base)).rejects.toMatchObject({
      code: "conflict",
      message: "Manual CSV import is unavailable until the server-side processor is deployed and verified.",
    });
    await expect(finalizeManualCsvImport(context, {
      ...base,
      objectPath: `${requestId}/${uploadId}/sales.csv`,
    })).rejects.toMatchObject({
      code: "conflict",
      message: "Manual CSV import is unavailable until the server-side processor is deployed and verified.",
    });
  });
});
