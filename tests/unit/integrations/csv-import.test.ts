import { describe, expect, it } from "vitest";
import {
  decodeAndValidateManualCsv,
  MANUAL_CSV_MAX_BYTES,
  validateManualCsvText,
} from "@/lib/integrations/csv-import";

describe("manual CSV validation", () => {
  it("normalizes headers and parses quoted RFC-style cells", () => {
    const result = validateManualCsvText({
      importType: "toast_sales",
      text: '\uFEFFBusiness Date,Net Sales,Note\r\n2026-08-01,1250.45,"Dinner, patio"\r\n',
    });

    expect(result).toMatchObject({
      ok: true,
      headers: ["business_date", "net_sales", "note"],
      totalRows: 1,
      preview: [["2026-08-01", "1250.45", "Dinner, patio"]],
    });
  });

  it("requires the selected import contract before an upload is queued", () => {
    const result = validateManualCsvText({
      importType: "resy_reservations",
      text: "reservation_id,guest_name\nr-1,Amara\n",
    });

    expect(result).toEqual({
      ok: false,
      message:
        "Missing required reservations columns: reserved_at, party_size, status.",
    });
  });

  it("requires a contact method on every guest row", () => {
    const result = validateManualCsvText({
      importType: "guest_profiles",
      text: "display_name,email,phone\nNo Contact,,\n",
    });

    expect(result).toMatchObject({ ok: false, row: 2 });
  });

  it.each(["=HYPERLINK(\"https://bad.invalid\")", "+CMD", "@SUM(1,2)", "-EXEC()"])(
    "rejects spreadsheet formula content: %s",
    (formula) => {
      const escaped = formula.includes(",") ? `"${formula.replaceAll('"', '""')}"` : formula;
      const result = validateManualCsvText({
        importType: "inventory_items",
        text: `name,base_unit\n${escaped},each\n`,
      });
      expect(result).toMatchObject({ ok: false, row: 2, column: 1 });
    },
  );

  it("accepts negative numeric values without treating them as formulas", () => {
    const result = validateManualCsvText({
      importType: "toast_sales",
      text: "business_date,net_sales\n2026-08-01,-12.50\n",
    });
    expect(result).toMatchObject({ ok: true, totalRows: 1 });
  });

  it("rejects malformed quotes, duplicate headers, and uneven rows", () => {
    expect(
      validateManualCsvText({
        importType: "inventory_items",
        text: 'name,base_unit\n"Open,each\n',
      }),
    ).toMatchObject({ ok: false, row: 2 });
    expect(
      validateManualCsvText({
        importType: "inventory_items",
        text: "Name,name,base_unit\nA,A,each\n",
      }),
    ).toMatchObject({ ok: false, message: "CSV headers must be unique after normalization." });
    expect(
      validateManualCsvText({
        importType: "inventory_items",
        text: "name,base_unit\nA,each,extra\n",
      }),
    ).toMatchObject({ ok: false, row: 2 });
  });

  it("rejects invalid UTF-8 and files above the application memory limit", () => {
    expect(
      decodeAndValidateManualCsv({
        importType: "inventory_items",
        bytes: new Uint8Array([0xc3, 0x28]),
      }),
    ).toEqual({ ok: false, message: "The CSV must be valid UTF-8 text." });
    expect(
      decodeAndValidateManualCsv({
        importType: "inventory_items",
        bytes: new Uint8Array(MANUAL_CSV_MAX_BYTES + 1),
      }),
    ).toEqual({ ok: false, message: "Manual CSV imports are limited to 5 MB." });
  });
});
