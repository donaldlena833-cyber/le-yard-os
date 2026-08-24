import { describe, expect, it } from "vitest";
import {
  accessibleReportKinds,
  canAccessReportKind,
  requiredReportCapability,
} from "@/lib/permissions/report-access";

describe("report-kind authorization", () => {
  it("keeps operational and financial report kinds separate", () => {
    const operationsOnly = { capabilities: ["reports.operational.view"] as const };
    expect(canAccessReportKind(operationsOnly, "labor")).toBe(true);
    expect(canAccessReportKind(operationsOnly, "inventory_variance")).toBe(true);
    expect(canAccessReportKind(operationsOnly, "tips")).toBe(false);
    expect(canAccessReportKind(operationsOnly, "payroll")).toBe(false);
    expect(canAccessReportKind(operationsOnly, "cogs")).toBe(false);
    expect(accessibleReportKinds(operationsOnly)).not.toContain("expenses");
  });

  it("requires financial capability for every money-bearing report", () => {
    for (const kind of [
      "tips",
      "payroll",
      "sales_to_labor",
      "receipts",
      "expenses",
      "cogs",
    ] as const) {
      expect(requiredReportCapability(kind)).toBe("reports.financial.view");
    }
  });
});
