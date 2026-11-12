import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import type { OperationalCapability } from "@/lib/permissions/capabilities";
import type { ReportKind } from "@/types";
import { isTenantFeatureEnabled } from "@/lib/tenant-service";

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
  workspace: Pick<WorkspaceContextValue, "capabilities" | "serviceSettings">,
  kind: ReportKind,
): boolean {
  if (kind === "guest_activity" && !isTenantFeatureEnabled(workspace, "guestCrm")) return false;
  if ((kind === "tips" || kind === "payroll") && !isTenantFeatureEnabled(workspace, "tips")) return false;
  return workspace.capabilities.includes(requiredReportCapability(kind));
}

export function accessibleReportKinds(
  workspace: Pick<WorkspaceContextValue, "capabilities" | "serviceSettings">,
): ReportKind[] {
  return (Object.keys(REPORT_CAPABILITY_BY_KIND) as ReportKind[]).filter((kind) =>
    canAccessReportKind(workspace, kind),
  );
}
