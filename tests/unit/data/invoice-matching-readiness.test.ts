import { describe, expect, it } from "vitest";
import { suggestInvoiceInventoryMatches } from "@/lib/invoices/invoice-matching";

const catalog = [
  { id: "roma", name: "Roma tomatoes", sku: "ROMA-12", aliases: ["Roma tomato case"] },
  { id: "cherry", name: "Cherry tomatoes" },
];
const line = (description: string) => ({
  description, quantity: 2, unit: "case", unitPriceCents: 3000, totalCents: 6000,
});

describe("receiving invoice match safety", () => {
  it.each(["", "   ", "---", "•"])("leaves unusable extracted text %j unmatched", (description) => {
    expect(suggestInvoiceInventoryMatches([line(description)], catalog)[0]).toMatchObject({
      inventoryItemId: null, confidence: 0, totalCents: 6000,
    });
  });
  it("requires a human to resolve equally plausible inventory identities, independent of catalog order", () => {
    for (const items of [catalog, [...catalog].reverse()]) {
      expect(suggestInvoiceInventoryMatches([line("tomatoes")], items)[0].inventoryItemId).toBeNull();
    }
  });
  it.each(["Roma tomatoes", "ROMA-12", "Roma tomato case"])("retains unambiguous exact name, SKU and alias matching for %s", (description) => {
    expect(suggestInvoiceInventoryMatches([line(description)], catalog)[0]).toMatchObject({
      inventoryItemId: "roma", confidence: 1, totalCents: 6000,
    });
  });
  it("ignores malformed catalog aliases rather than suggesting an unrelated item", () => {
    expect(suggestInvoiceInventoryMatches([line("Butter")], [{id: "unknown", name: "---"}])[0].inventoryItemId).toBeNull();
  });
});
