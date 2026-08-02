export const MANUAL_CSV_MAX_BYTES = 5 * 1_048_576;
export const MANUAL_CSV_MAX_ROWS = 10_000;
export const MANUAL_CSV_MAX_COLUMNS = 100;
export const MANUAL_CSV_MAX_CELL_CHARACTERS = 20_000;

export const manualCsvImportTypeValues = [
  "toast_sales",
  "resy_reservations",
  "guest_profiles",
  "inventory_items",
] as const;

export type ManualCsvImportType = (typeof manualCsvImportTypeValues)[number];

export interface ManualCsvImportDefinition {
  label: string;
  sourceLabel: string;
  description: string;
  requiredHeaders: readonly string[];
  oneOfHeaders?: readonly string[];
}

export const manualCsvImportDefinitions: Record<
  ManualCsvImportType,
  ManualCsvImportDefinition
> = {
  toast_sales: {
    label: "Sales summary",
    sourceLabel: "Toast / POS CSV",
    description: "Daily sales evidence. This does not enable live Toast API access.",
    requiredHeaders: ["business_date", "net_sales"],
  },
  resy_reservations: {
    label: "Reservations",
    sourceLabel: "Resy / reservations CSV",
    description: "Reservation evidence queued for the guest import processor.",
    requiredHeaders: [
      "reservation_id",
      "reserved_at",
      "guest_name",
      "party_size",
      "status",
    ],
  },
  guest_profiles: {
    label: "Guest profiles",
    sourceLabel: "Guest CSV",
    description: "Guest records with an explicit contact field for review and deduplication.",
    requiredHeaders: ["display_name"],
    oneOfHeaders: ["email", "phone"],
  },
  inventory_items: {
    label: "Inventory items",
    sourceLabel: "Inventory CSV",
    description: "Item catalog rows using the restaurant's existing unit vocabulary.",
    requiredHeaders: ["name", "base_unit"],
  },
};

export interface ManualCsvValidationSuccess {
  ok: true;
  headers: string[];
  totalRows: number;
  preview: string[][];
}

export interface ManualCsvValidationFailure {
  ok: false;
  message: string;
  row?: number;
  column?: number;
}

export type ManualCsvValidationResult =
  | ManualCsvValidationSuccess
  | ManualCsvValidationFailure;

function normalizedHeader(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
}

function isBlankRow(row: readonly string[]): boolean {
  return row.every((cell) => !cell.trim());
}

function hasSpreadsheetFormula(value: string): boolean {
  const candidate = value.replace(/^[\t\r\n ]+/, "");
  if (!candidate) return false;
  if (/^[=+@]/.test(candidate)) return true;
  if (!candidate.startsWith("-")) return false;
  return !/^-\d+(?:\.\d+)?(?:e[+-]?\d+)?$/i.test(candidate);
}

function parseCsv(text: string): ManualCsvValidationFailure | string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;
  let closedQuote = false;

  const pushCell = () => {
    row.push(cell);
    cell = "";
    closedQuote = false;
  };
  const pushRow = () => {
    pushCell();
    rows.push(row);
    row = [];
  };

  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else {
        cell += character;
      }
    } else if (closedQuote) {
      if (character === ",") pushCell();
      else if (character === "\n") pushRow();
      else if (character === "\r" && text[index + 1] === "\n") {
        pushRow();
        index += 1;
      } else if (character !== " " && character !== "\t") {
        return {
          ok: false,
          message: "A quoted CSV cell contains unexpected text after its closing quote.",
          row: rows.length + 1,
          column: row.length + 1,
        };
      }
    } else if (character === '"') {
      if (cell.length) {
        return {
          ok: false,
          message: "A quote appears inside an unquoted CSV cell.",
          row: rows.length + 1,
          column: row.length + 1,
        };
      }
      quoted = true;
    } else if (character === ",") {
      pushCell();
    } else if (character === "\n") {
      pushRow();
    } else if (character === "\r" && text[index + 1] === "\n") {
      pushRow();
      index += 1;
    } else {
      cell += character;
    }

    if (cell.length > MANUAL_CSV_MAX_CELL_CHARACTERS) {
      return {
        ok: false,
        message: `CSV cells are limited to ${MANUAL_CSV_MAX_CELL_CHARACTERS.toLocaleString()} characters.`,
        row: rows.length + 1,
        column: row.length + 1,
      };
    }
    if (row.length > MANUAL_CSV_MAX_COLUMNS) {
      return {
        ok: false,
        message: `CSV files are limited to ${MANUAL_CSV_MAX_COLUMNS} columns.`,
        row: rows.length + 1,
      };
    }
    if (rows.length > MANUAL_CSV_MAX_ROWS + 1) {
      return {
        ok: false,
        message: `CSV files are limited to ${MANUAL_CSV_MAX_ROWS.toLocaleString()} data rows.`,
      };
    }
  }

  if (quoted) {
    return {
      ok: false,
      message: "The CSV ends inside an unclosed quoted cell.",
      row: rows.length + 1,
      column: row.length + 1,
    };
  }
  if (cell || row.length) pushRow();
  return rows;
}

export function validateManualCsvText({
  text,
  importType,
}: {
  text: string;
  importType: ManualCsvImportType;
}): ManualCsvValidationResult {
  const withoutBom = text.startsWith("\uFEFF") ? text.slice(1) : text;
  if (!withoutBom.trim()) return { ok: false, message: "The CSV file is empty." };
  if (/\0/.test(withoutBom)) {
    return { ok: false, message: "The CSV contains a null byte and cannot be processed safely." };
  }

  const parsed = parseCsv(withoutBom);
  if (!Array.isArray(parsed)) return parsed;
  const rows = parsed.filter((candidate) => !isBlankRow(candidate));
  if (rows.length < 2) {
    return { ok: false, message: "The CSV needs a header row and at least one data row." };
  }

  const headers = rows[0].map(normalizedHeader);
  if (!headers.length || headers.length > MANUAL_CSV_MAX_COLUMNS) {
    return { ok: false, message: `CSV files support 1–${MANUAL_CSV_MAX_COLUMNS} columns.` };
  }
  if (headers.some((header) => !header)) {
    return { ok: false, message: "Every CSV column needs a non-empty header." };
  }
  if (new Set(headers).size !== headers.length) {
    return { ok: false, message: "CSV headers must be unique after normalization." };
  }

  const definition = manualCsvImportDefinitions[importType];
  const missing = definition.requiredHeaders.filter((header) => !headers.includes(header));
  if (missing.length) {
    return {
      ok: false,
      message: `Missing required ${definition.label.toLowerCase()} column${missing.length === 1 ? "" : "s"}: ${missing.join(", ")}.`,
    };
  }
  if (definition.oneOfHeaders && !definition.oneOfHeaders.some((header) => headers.includes(header))) {
    return {
      ok: false,
      message: `Include at least one contact column: ${definition.oneOfHeaders.join(" or ")}.`,
    };
  }

  const dataRows = rows.slice(1);
  if (dataRows.length > MANUAL_CSV_MAX_ROWS) {
    return {
      ok: false,
      message: `CSV files are limited to ${MANUAL_CSV_MAX_ROWS.toLocaleString()} data rows.`,
    };
  }

  for (let rowIndex = 0; rowIndex < dataRows.length; rowIndex += 1) {
    const candidate = dataRows[rowIndex];
    if (candidate.length !== headers.length) {
      return {
        ok: false,
        message: `Row ${rowIndex + 2} has ${candidate.length} cells; ${headers.length} were expected.`,
        row: rowIndex + 2,
      };
    }
    for (let columnIndex = 0; columnIndex < candidate.length; columnIndex += 1) {
      const value = candidate[columnIndex];
      if (/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value)) {
        return {
          ok: false,
          message: "The CSV contains an unsupported control character.",
          row: rowIndex + 2,
          column: columnIndex + 1,
        };
      }
      if (hasSpreadsheetFormula(value)) {
        return {
          ok: false,
          message: "Spreadsheet formulas are not accepted in import cells.",
          row: rowIndex + 2,
          column: columnIndex + 1,
        };
      }
    }

    if (importType === "guest_profiles") {
      const emailIndex = headers.indexOf("email");
      const phoneIndex = headers.indexOf("phone");
      if (
        (emailIndex < 0 || !candidate[emailIndex]?.trim()) &&
        (phoneIndex < 0 || !candidate[phoneIndex]?.trim())
      ) {
        return {
          ok: false,
          message: "Every guest row needs an email address or phone number.",
          row: rowIndex + 2,
        };
      }
    }
  }

  return {
    ok: true,
    headers,
    totalRows: dataRows.length,
    preview: dataRows.slice(0, 3).map((row) => row.map((cell) => cell.trim().slice(0, 120))),
  };
}

export function decodeAndValidateManualCsv({
  bytes,
  importType,
}: {
  bytes: Uint8Array;
  importType: ManualCsvImportType;
}): ManualCsvValidationResult {
  if (!bytes.length) return { ok: false, message: "The CSV file is empty." };
  if (bytes.length > MANUAL_CSV_MAX_BYTES) {
    return {
      ok: false,
      message: `Manual CSV imports are limited to ${MANUAL_CSV_MAX_BYTES / 1_048_576} MB.`,
    };
  }
  try {
    return validateManualCsvText({
      text: new TextDecoder("utf-8", { fatal: true }).decode(bytes),
      importType,
    });
  } catch {
    return { ok: false, message: "The CSV must be valid UTF-8 text." };
  }
}
