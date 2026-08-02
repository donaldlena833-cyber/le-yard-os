const QUANTITY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,4})?$/;
const MONEY_PATTERN = /^(?:0|[1-9]\d*)(?:\.\d{1,2})?$/;

export function parseInventoryQuantity(value: string, options?: { allowZero?: boolean }) {
  const normalized = value.trim();
  if (!QUANTITY_PATTERN.test(normalized)) return null;
  const quantity = Number(normalized);
  if (!Number.isFinite(quantity) || quantity >= 1_000_000_000_000) return null;
  if (!options?.allowZero && quantity === 0) return null;
  return quantity;
}

export function parseInventoryMoneyToCents(value: string) {
  const normalized = value.trim();
  if (!MONEY_PATTERN.test(normalized)) return null;
  const [whole, fractional = ""] = normalized.split(".");
  const cents = Number(whole) * 100 + Number(fractional.padEnd(2, "0"));
  if (!Number.isSafeInteger(cents) || cents < 0) return null;
  return cents;
}
