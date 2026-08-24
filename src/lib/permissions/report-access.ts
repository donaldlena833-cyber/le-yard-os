import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import type { OperationalCapability } from "@/lib/permissions/capabilities";
import type { ReportKind } from "@/types";

export const REPORT_CAPABILITY_BY_KIND = {
  labor: "reports.operational.view",
  attendance: "reports.operational.view",
  overtime: "reports.operational.view",
  tips: "reports.financial.view",
  payroll: "reports.financial.view",
  sales_to_labor: "reports.financial.view",
  receipts: "reports.financial.view",
  expenses: "reports.financial.view",
  inventory_variance: "reports.operational.view",
  cogs: "reports.financial.view",
  waste: "reports.operational.view",
  vendor_pricing: "reports.operational.view",
  shift_performance: "reports.operational.view",
  guest_activity: "reports.operational.view",
} as const satisfies Record<ReportKind, OperationalCapability>;

export function requiredReportCapability(
  kind: ReportKind,
): OperationalCapability {
  return REPORT_CAPABILITY_BY_KIND[kind];
}

export function canAccessReportKind(
  workspace: Pick<WorkspaceContextValue, "capabilities">,
  kind: ReportKind,
): boolean {
  return workspace.capabilities.includes(requiredReportCapability(kind));
}

export function accessibleReportKinds(
  workspace: Pick<WorkspaceContextValue, "capabilities">,
): ReportKind[] {
  return (Object.keys(REPORT_CAPABILITY_BY_KIND) as ReportKind[]).filter((kind) =>
    canAccessReportKind(workspace, kind),
  );
}
