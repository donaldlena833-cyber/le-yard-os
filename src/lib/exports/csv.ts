function protectSpreadsheetFormula(value: string): string {
  return /^[\u0000-\u0020]*[=+\-@]/.test(value) ? `'${value}` : value;
}

/** RFC 4180-style field escaping with spreadsheet formula neutralization. */
export function escapeCsvField(value: string): string {
  const protectedValue = protectSpreadsheetFormula(value);
  return /[",\r\n]/.test(protectedValue)
    ? `"${protectedValue.replaceAll('"', '""')}"`
    : protectedValue;
}

export function encodeCsvRows(rows: readonly (readonly string[])[]): string {
  return `${rows
    .map((row) => row.map((value) => escapeCsvField(value)).join(","))
    .join("\r\n")}\r\n`;
}
