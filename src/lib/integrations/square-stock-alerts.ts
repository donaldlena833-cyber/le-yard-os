import type { ChurchSquareStockAlert } from "@/data/read-models/church-square-stock-alerts";

export const squareStockAlertThreshold = 5;

export function isSquareStockLow(quantity: string): boolean {
  return /^-?\d+(?:\.\d{1,5})?$/.test(quantity) && Number(quantity) <= squareStockAlertThreshold;
}

export function formatSquareStockQuantity(quantity: string): string {
  return quantity.includes(".") ? quantity.replace(/0+$/, "").replace(/\.$/, "") : quantity;
}

export function pendingSquareStockAlerts(
  alerts: readonly ChurchSquareStockAlert[],
  dismissedEpisodes: readonly string[],
): ChurchSquareStockAlert[] {
  const dismissed = new Set(dismissedEpisodes);
  return alerts.filter((alert) => !dismissed.has(alert.episode));
}

export function readSquareStockAlertDismissals(value: string): string[] {
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.filter((entry): entry is string => typeof entry === "string") : [];
  } catch {
    return [];
  }
}
