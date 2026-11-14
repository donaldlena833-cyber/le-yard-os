import "server-only";

import { appSurface } from "@/lib/app-surface";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import type { ChurchSquareOrder } from "@/lib/integrations/church-square-order-projection";
import { ChurchSquareOrderClient, churchSquareOrderConfiguration } from "@/lib/integrations/church-square-orders.server";
import { summarizeChurchSquareSandwichMix } from "@/lib/integrations/church-square-sandwich-mix.server";
import {
  churchSquareOrderWindowHours,
  churchSquareOrderWindowLimit,
  type ChurchSquareOrderWindowResponse,
} from "@/lib/integrations/church-square-order-window";
import type { SquareChurchSandwichCatalogItem } from "@/lib/integrations/square-counts.server";
import { churchSandwichBenchRecipes, type ChurchSandwichRecipeKey } from "@/lib/kitchen/church-sandwich-bench";
import { createClient } from "@/lib/supabase/server";

const managementRoles = new Set(["owner", "admin", "manager"]);

function uniqueOrderSnapshots(orders: readonly ChurchSquareOrder[]): ChurchSquareOrder[] {
  const seen = new Map<string, ChurchSquareOrder>();
  for (const order of orders) {
    const prior = seen.get(order.id);
    if (!prior) {
      seen.set(order.id, order);
    } else if (JSON.stringify(prior) !== JSON.stringify(order)) {
      // The provider client has already scoped and normalized each row. A
      // conflicting duplicate makes this entire reporting window ambiguous.
      throw new Error("Square returned inconsistent order snapshots.");
    }
  }
  return [...seen.values()];
}

function regularSandwichVariationMap(catalog: readonly SquareChurchSandwichCatalogItem[]) {
  const mapping = new Map<string, ChurchSandwichRecipeKey>();
  for (const { key, name } of churchSandwichBenchRecipes) {
    const item = catalog.find((entry) => entry.name === name);
    const regular = item?.status === "matched" ? item.variations.filter((variation) => variation.name === "Regular") : [];
    if (regular.length !== 1 || mapping.has(regular[0].id)) return null;
    mapping.set(regular[0].id, key);
  }
  return mapping;
}

function sandwichMix(catalog: readonly SquareChurchSandwichCatalogItem[] | null, sample: readonly ChurchSquareOrder[]):
  NonNullable<ChurchSquareOrderWindowResponse["itemMix"]> {
  const variations = catalog ? regularSandwichVariationMap(catalog) : null;
  if (!variations) return { status: "unavailable" };
  try {
    return summarizeChurchSquareSandwichMix(sample, variations);
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
    return { status: "unavailable" };
  }
}

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
  const square = new ChurchSquareOrderClient(config);
  const [result, catalog] = await Promise.all([
    square.searchOrders({
      from: new Date(now - churchSquareOrderWindowHours * 60 * 60 * 1000).toISOString(),
      to: checkedAt,
      direction: "DESC",
    }),
    square.verifySandwichCatalog().catch(() => null),
  ]);
  // Suffixes are display-only and can collide across distinct provider orders.
  const orders = uniqueOrderSnapshots(result.orders);
  const sample = orders.slice(0, churchSquareOrderWindowLimit);
  return {
    checkedAt,
    hasMore: Boolean(result.nextCursor) || orders.length > churchSquareOrderWindowLimit,
    itemMix: sandwichMix(catalog, sample),
    orders: sample.map(order => ({
      reference: order.id.slice(-10),
      // Square's OrderSource is a display name, often the originating app.
      source: order.sourceHint,
      status: order.status,
      updatedAt: order.updatedAt,
      totalCents: order.totalCents,
      fulfillments: order.fulfillments.map(fulfillment => ({
        type: fulfillment.type,
        status: fulfillment.status,
        promisedAt: fulfillment.promisedAt,
        readyAt: fulfillment.readyAt,
        handoffAt: fulfillment.handoffAt,
        completedAt: fulfillment.completedAt,
        canceledAt: fulfillment.canceledAt,
        rejectedAt: fulfillment.rejectedAt,
      })),
    })),
  };
}
