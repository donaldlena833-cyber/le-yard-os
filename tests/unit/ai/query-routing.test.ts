import { describe, expect, it } from "vitest";
import { reportKindForOperationsQuery } from "@/lib/ai/query-routing";

describe("connected operations query routing", () => {
  it.each([
    ["Which receipts still need review?", "receipts"],
    ["Show vendor price changes", "vendor_pricing"],
    ["What stock variance do we have?", "inventory_variance"],
    ["Any recorded overtime?", "overtime"],
    ["How do sales compare with labor?", "sales_to_labor"],
    ["Which VIP guests visited?", "guest_activity"],
    ["Summarize the tip pool", "tips"],
    ["What needs attention before service?", "shift_performance"],
  ])("routes %s to %s", (query, kind) => {
    expect(reportKindForOperationsQuery(query)).toBe(kind);
  });
});
