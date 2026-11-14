import "server-only";

import { appSurface } from "@/lib/app-surface";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { ChurchSquareOrderClient, churchSquareOrderConfiguration } from "@/lib/integrations/church-square-orders.server";
import {
  churchSquareOrderWindowHours,
  churchSquareOrderWindowLimit,
  type ChurchSquareOrderWindowResponse,
} from "@/lib/integrations/church-square-order-window";
import { createClient } from "@/lib/supabase/server";

const managementRoles = new Set(["owner", "admin", "manager"]);

export function canRequestChurchSquareOrderWindow(
  workspace: Pick<WorkspaceContextValue, "mode" | "role" | "capabilities" | "serviceSettings">,
) {
  return appSurface === "operations"
    && workspace.mode === "live"
    && workspace.serviceSettings?.serviceModel === "counter"
    && managementRoles.has(workspace.role)
    && workspace.capabilities.includes("reports.financial.view");
}

export async function verifyChurchSquareOrderWindowScope(workspace: WorkspaceContextValue) {
  if (!canRequestChurchSquareOrderWindow(workspace)) return false;
  const client = await createClient();
  const [organization, location] = await Promise.all([
    client.from("organizations")
      .select("id")
      .eq("id", workspace.organization.id)
      .eq("slug", "le-yard-church-street")
      .eq("status", "active")
      .maybeSingle(),
    client.from("locations")
      .select("id")
      .eq("id", workspace.activeLocation.id)
      .eq("organization_id", workspace.organization.id)
      .eq("code", "CHURCH")
      .eq("is_active", true)
      .maybeSingle(),
  ]);

  if (organization.error || location.error) throw new Error("Church Street workspace lookup failed.");
  return Boolean(organization.data && location.data);
}

export async function loadChurchSquareOrderWindow(): Promise<ChurchSquareOrderWindowResponse | null> {
  const config = churchSquareOrderConfiguration();
  if (!config) return null;
  const now = Date.now();
  const checkedAt = new Date(now).toISOString();
  const result = await new ChurchSquareOrderClient(config).searchOrders({
    from: new Date(now - churchSquareOrderWindowHours * 60 * 60 * 1000).toISOString(),
    to: checkedAt,
    direction: "DESC",
  });
  return {
    checkedAt,
    hasMore: Boolean(result.nextCursor) || result.orders.length > churchSquareOrderWindowLimit,
    orders: result.orders.slice(0, churchSquareOrderWindowLimit).map(order => ({
      reference: order.id.slice(-10),
      source: order.sourceHint,
      status: order.status,
      updatedAt: order.updatedAt,
      totalCents: order.totalCents,
    })),
  };
}
