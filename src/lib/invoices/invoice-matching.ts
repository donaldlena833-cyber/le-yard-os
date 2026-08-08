/**
 * Deterministic invoice intake primitives. They deliberately do not call an
 * AI provider: a future OCR/LLM adapter can feed the same line shape and the
 * manager review screen will remain unchanged.
 */

export type InvoiceCatalogItem = {
  id: string;
  name: string;
  sku?: string | null;
  aliases?: string[];
};

export type InvoiceLine = {
  description: string;
  quantity: number | null;
  unit: string | null;
  unitPriceCents: number | null;
  totalCents: number | null;
};

export type InvoiceInventorySuggestion = InvoiceLine & {
  inventoryItemId: string | null;
  inventoryItemName: string | null;
  confidence: number;
  reason: string;
};

function normalize(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

function tokenScore(left: string, right: string) {
  const leftTokens = new Set(normalize(left).split(" ").filter(Boolean));
  const rightTokens = new Set(normalize(right).split(" ").filter(Boolean));
  if (!leftTokens.size || !rightTokens.size) return 0;
  const intersection = [...leftTokens].filter((token) => rightTokens.has(token)).length;
  return intersection / Math.max(leftTokens.size, rightTokens.size);
}

function bestCatalogMatch(description: string, catalog: InvoiceCatalogItem[]) {
  const normalizedDescription = normalize(description);
  let best: { item: InvoiceCatalogItem; score: number; reason: string } | null = null;
  for (const item of catalog) {
    const candidates = [item.name, item.sku ?? "", ...(item.aliases ?? [])].filter(Boolean);
    for (const candidate of candidates) {
      const normalizedCandidate = normalize(candidate);
      const exact = normalizedDescription === normalizedCandidate;
      const contained = normalizedDescription.includes(normalizedCandidate) || normalizedCandidate.includes(normalizedDescription);
      const score = exact ? 1 : contained ? 0.92 : tokenScore(normalizedDescription, normalizedCandidate);
      if (!best || score > best.score) {
        best = { item, score, reason: exact ? "Exact catalog name" : contained ? "Name contains catalog term" : "Shared normalized terms" };
      }
    }
  }
  return best && best.score >= 0.42 ? best : null;
}

/** Match extracted invoice lines to current inventory catalog identities. */
export function suggestInvoiceInventoryMatches(
  lines: InvoiceLine[],
  catalog: InvoiceCatalogItem[],
): InvoiceInventorySuggestion[] {
  return lines.map((line) => {
    const match = bestCatalogMatch(line.description, catalog);
    return {
      ...line,
      inventoryItemId: match?.item.id ?? null,
      inventoryItemName: match?.item.name ?? null,
      confidence: match?.score ?? 0,
      reason: match?.reason ?? "No confident catalog match; manager selection required",
    };
  });
}

/**
 * Lightweight line recognizer for plain OCR text. Structured OCR can bypass
 * this function and pass normalized lines directly into the matcher.
 */
export function recognizeInvoiceLines(text: string, catalog: InvoiceCatalogItem[]): InvoiceInventorySuggestion[] {
  const lines: InvoiceLine[] = text
    .split(/[\n;|]+/)
    .map((line) => line.trim())
    .filter((line) => line.length > 2)
    .filter((line) => !/\b(invoice|receipt|subtotal|tax|total|date|vendor)\b/i.test(line))
    .map((description) => ({
      description: description.replace(/^[-*•]\s*/, "").trim(),
      quantity: null,
      unit: null,
      unitPriceCents: null,
      totalCents: null,
    }));
  return suggestInvoiceInventoryMatches(lines, catalog);
}

