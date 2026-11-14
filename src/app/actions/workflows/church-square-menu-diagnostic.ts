"use server";

import { z } from "zod";
import { assertCondition, throwDatabaseError, WorkflowError } from "@/data/errors";
import { executeWorkflowAction, type WorkflowContext } from "@/data/execute";
import { stockItemId } from "@/data/workflows/church-square-counts";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSquareCountConfiguration } from "@/lib/integrations/church-square-configuration.server";
import type {
  ChurchSquareMenuDiagnostic,
  ChurchSquareMenuDiagnosticItem,
  ChurchSquareMenuDiagnosticVariation,
} from "@/lib/integrations/church-square-menu-diagnostic";
import { SquareCountClient } from "@/lib/integrations/square-counts.server";
import { churchSandwichBenchRecipes } from "@/lib/kitchen/church-sandwich-bench";

const mappedItems = z.array(z.object({
  id: z.uuid(),
  lastConfirmedObservedAt: z.iso.datetime({ offset: true }).nullish(),
}));

async function menuDiagnostic(context: WorkflowContext): Promise<ChurchSquareMenuDiagnostic> {
  const session = await resolveWorkspaceSession();
  assertCondition(session.status === "ready" && session.context.mode === "live"
    && session.context.identity.userId === context.actor.userId && session.context.serviceSettings?.serviceModel === "counter",
  "forbidden", "Switch to the Church Street workspace to check Square tracking.");
  assertCondition(session.context.role === "owner" || session.context.role === "admin",
    "forbidden", "Church Street owner or admin access is required to check the Square catalog.");

  const locationId = session.context.activeLocation.id;
  // This authenticated procedure verifies the exact active Church tenant,
  // location and user's count authority before any request to Square.
  const { data, error } = await context.supabase.rpc("list_church_square_count_items", {
    p_location_id: locationId,
  }).abortSignal(AbortSignal.timeout(6_000));
  if (error) throwDatabaseError(error, "The café’s active count mappings could not be checked.");
  const parsed = mappedItems.safeParse(data);
  const mappingById = parsed.success ? new Map(parsed.data.map((item) => [item.id, item])) : null;

  const config = churchSquareCountConfiguration();
  assertCondition(config, "conflict", "Square stock counts are waiting for the café API connection.");
  try {
    const catalog = await new SquareCountClient(config).verifyChurchSandwichCatalog({ includePresentation: true });
    const checkedAt = new Date().toISOString();
    const byName = new Map(catalog.map((item) => [item.name, item]));
    const items: ChurchSquareMenuDiagnosticItem[] = churchSandwichBenchRecipes.map(({ key, name }) => {
      const item = byName.get(name);
      if (!item) throw new WorkflowError("database", "The Square check could not verify the six sandwich rows.");
      if (item.status !== "matched") return { key, name, status: item.status, itemId: null, variations: [] };

      return {
        key, name, status: item.status, itemId: item.itemId,
        presentation: {
          itemPhotoCount: item.presentation?.itemPhotoCount ?? null,
          description: item.presentation?.description ?? "unverified",
        },
        variations: item.variations.map((variation): ChurchSquareMenuDiagnosticVariation => {
          const mapping = mappingById?.get(stockItemId(locationId, variation.id));
          return {
            id: variation.id, name: variation.name, sku: variation.sku, tracking: variation.tracking,
            presentation: {
              photoCount: variation.presentation?.photoCount ?? null,
              sellability: variation.presentation?.sellability ?? "unspecified",
              soldOut: variation.presentation?.soldOut ?? { status: "unverified" },
            },
            mapping: mappingById ? (mapping ? "mapped" : "unmapped") : "unknown",
            openingCount: mappingById ? (mapping?.lastConfirmedObservedAt ? "confirmed" : "unrecorded") : "unknown",
          };
        }),
      };
    });
    return { checkedAt, items };
  } catch {
    throw new WorkflowError("conflict", "Square could not verify the café’s sandwich catalog. Check the connection and try again.");
  }
}

export async function getChurchSquareMenuDiagnosticAction() {
  return executeWorkflowAction({
    operation: "inventory.square_church.menu_diagnostic",
    schema: z.undefined(),
    input: undefined,
    persists: false,
    run: menuDiagnostic,
  });
}
