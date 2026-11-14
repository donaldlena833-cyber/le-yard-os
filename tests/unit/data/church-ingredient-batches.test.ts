import { expect, it } from "vitest";
import { zonedLocalToIso } from "@/data/read-models/local-time";
import { churchBatchLabelList, churchBatchMeasurement, churchBatchQueue, measureChurchIngredientBatchInput, recordChurchIngredientBatchInput, resolveChurchIngredientBatchInput, voidChurchIngredientBatchInput } from "@/lib/kitchen/church-ingredient-batches";

const batchId = "12345678-1234-4234-9234-1234567890ab";
const measurementId = "22345678-1234-4234-9234-1234567890ab";
const input = {
  requestId: batchId,
  ingredientKey: "French-style ham",
  evidenceRevision: 4,
  supplierLot: "LOT 07",
  batchCode: "HAM-A",
  handledAs: "prepped",
  handledAt: "2026-11-14T06:30:00-05:00",
  discardAt: "2026-11-14T11:31:00Z",
};

it("orders absolute batch times and rejects invalid identifiers or ambiguous local clocks", () => {
  expect(recordChurchIngredientBatchInput.safeParse(input).success).toBe(true);
  expect(recordChurchIngredientBatchInput.safeParse({ ...input, discardAt: "2026-11-14T11:20:00Z" }).success).toBe(false);
  expect(recordChurchIngredientBatchInput.safeParse({ ...input, supplierLot: "LOT\u202e7" }).success).toBe(false);
  expect(zonedLocalToIso("2026-11-01", "01:30", "America/New_York")).toBeNull();
  expect(zonedLocalToIso("2026-03-08", "02:30", "America/New_York")).toBeNull();
});

it("retains batch trace facts and rejects inconsistent or repeated void records", () => {
  const label = {
    ...input,
    id: batchId,
    supplierSku: "HAM SKU",
    storageRule: "See approved pack instruction",
    handlingRule: "See chef-reviewed prep rule",
    recordedAt: "2026-11-14T11:30:10Z",
    recordedByName: "Fixture chef",
    evidenceCurrent: false,
    voidedAt: "2026-11-14T11:30:20Z",
    voidReason: "Incorrect package lot",
    recordedBy: "private",
  };
  expect(churchBatchLabelList.parse([label])[0]).toMatchObject({
    id: batchId, evidenceCurrent: false, voidReason: "Incorrect package lot",
  });
  expect(churchBatchLabelList.parse([label])[0]).not.toHaveProperty("recordedBy");
  expect(churchBatchLabelList.safeParse([{ ...label, voidReason: null }]).success).toBe(false);
  expect(churchBatchLabelList.safeParse([label, label]).success).toBe(false);
  expect(voidChurchIngredientBatchInput.safeParse({ requestId: batchId, batchId, reason: " " }).success).toBe(false);

  const open = { ...label, voidedAt: null, voidReason: null };
  const disposition = { outcome: "discarded", resolvedAt: "2026-11-14T11:31:30Z", resolvedByName: "Fixture chef" };
  expect(churchBatchQueue.safeParse({ total: 51, batches: [open] }).success).toBe(true);
  expect(churchBatchQueue.safeParse({ total: 0, batches: [open] }).success).toBe(false);
  expect(churchBatchQueue.safeParse({ total: 1, batches: [{ ...open, disposition }] }).success).toBe(false);
  expect(churchBatchLabelList.safeParse([{ ...open, disposition }]).success).toBe(true);
  expect(churchBatchLabelList.safeParse([{ ...label, disposition }]).success).toBe(false);
  expect(resolveChurchIngredientBatchInput.safeParse({ requestId: batchId, batchId, outcome: "discarded" }).success).toBe(true);
  expect(resolveChurchIngredientBatchInput.safeParse({ requestId: batchId, batchId, outcome: "discarded", resolvedAt: disposition.resolvedAt }).success).toBe(false);
});

it("accepts a measured zero and rejects over-precision, wrong batches and fractional bread", () => {
  const measurement = {
    id: measurementId, batchId, quantity: 0, observedAt: "2026-11-14T11:30:13Z",
    recordedAt: "2026-11-14T11:30:14Z", recordedByName: "Fixture lead",
  };
  const write = {
    requestId: measurementId, batchId, expectedLatestId: null, quantity: 0,
    observedAt: measurement.observedAt,
  };
  expect(measureChurchIngredientBatchInput.safeParse(write).success).toBe(true);
  expect(measureChurchIngredientBatchInput.safeParse({ ...write, quantity: 34.567 }).success).toBe(true);
  expect(measureChurchIngredientBatchInput.safeParse({ ...write, quantity: 34.5678 }).success).toBe(false);
  expect(measureChurchIngredientBatchInput.safeParse({ ...write, quantity: -1 }).success).toBe(false);
  expect(churchBatchMeasurement.safeParse({ ...measurement, observedAt: "2026-11-14T11:30:15Z" }).success).toBe(false);
  const record = {
    ...input, id: batchId, supplierSku: "HAM SKU", evidenceCurrent: true,
    storageRule: "Approved pack instruction", handlingRule: "Reviewed prep rule",
    recordedAt: "2026-11-14T11:30:10Z", recordedByName: "Fixture chef",
    voidedAt: null, voidReason: null,
  };
  expect(churchBatchLabelList.parse([{ ...record, latestMeasurement: measurement }])[0].latestMeasurement).toEqual(measurement);
  expect(churchBatchLabelList.safeParse([{ ...record, latestMeasurement: { ...measurement, batchId: measurementId } }]).success).toBe(false);
  expect(churchBatchLabelList.safeParse([{ ...record, ingredientKey: "10-inch baguette", latestMeasurement: { ...measurement, quantity: 2.5 } }]).success).toBe(false);
});
