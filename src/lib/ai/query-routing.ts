import type { ReportKind } from "@/types";

/**
 * Deterministic intent routing keeps connected evidence search usable without
 * sending restaurant data to an external model provider.
 */
export function reportKindForOperationsQuery(query: string): ReportKind {
  const normalized = query.normalize("NFKC").toLowerCase();

  if (/receipt|invoice|vendor bill/.test(normalized)) return "receipts";
  if (/expense/.test(normalized)) return "expenses";
  if (/vendor.{0,16}(price|cost)|price.{0,16}vendor/.test(normalized)) return "vendor_pricing";
  if (/waste|spoil|discard/.test(normalized)) return "waste";
  if (/\bcogs\b|cost of goods/.test(normalized)) return "cogs";
  if (/inventory|stock|\bpar\b|variance|\bcount(?:s|ed|ing)?\b/.test(normalized)) return "inventory_variance";
  if (/guest|vip|reservation|allerg|\bcrm\b/.test(normalized)) return "guest_activity";
  if (/\btip|gratuity|pool/.test(normalized)) return "tips";
  if (/payroll|export readiness/.test(normalized)) return "payroll";
  if (/overtime/.test(normalized)) return "overtime";
  if (/attendance|punch|clock|missed shift|late/.test(normalized)) return "attendance";
  if (normalized.includes("sales") && normalized.includes("labor")) return "sales_to_labor";
  if (/labor|hours? worked|timecard/.test(normalized)) return "labor";
  return "shift_performance";
}
