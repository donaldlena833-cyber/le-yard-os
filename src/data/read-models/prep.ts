import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { hasAnyCapability } from "@/lib/permissions/capabilities";
import { createClient } from "@/lib/supabase/server";
import { localDateKey, readFailure, readSuccess, type LiveReadResult } from "./shared";

export interface LivePrepTask {
  id: string;
  businessDate: string;
  servicePeriod: "prep" | "lunch" | "dinner" | "all_day";
  station: string;
  recipeId: string | null;
  recipeName: string | null;
  outputInventoryItemId: string | null;
  outputItemName: string | null;
  targetQuantity: number;
  targetUnitId: string;
  targetUnitSymbol: string;
  dueAt: string;
  assigneeUserId: string | null;
  assigneeName: string | null;
  state: "draft" | "published" | "in_progress" | "completed" | "corrected" | "cancelled";
  actualYield: number | null;
  note: string | null;
  stockOverride: boolean;
  stockWarnings: unknown[];
  version: number;
  completionNote: string | null;
  correctionNote: string | null;
}

export interface LivePrepModel {
  date: string;
  timeZone: string;
  tasks: LivePrepTask[];
  recipes: Array<{ id: string; name: string; yieldQuantity: number; yieldUnitId: string }>;
  outputItems: Array<{ id: string; name: string; baseUnitId: string }>;
  units: Array<{ id: string; name: string; symbol: string }>;
  assignees: Array<{ userId: string; name: string }>;
}

export async function loadLivePrep(
  workspace: WorkspaceContextValue,
): Promise<LiveReadResult<LivePrepModel>> {
  if (
    workspace.role !== "owner" &&
    workspace.role !== "admin" &&
    !hasAnyCapability(workspace.capabilities, ["prep.manage", "prep.complete"])
  ) {
    return readFailure("A prep capability is required at this location.");
  }
  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const locationId = workspace.activeLocation.id;
    const { data: location, error: locationError } = await supabase
      .from("locations")
      .select("timezone")
      .eq("organization_id", organizationId)
      .eq("id", locationId)
      .single();
    if (locationError || !location) return readFailure();
    const date = localDateKey(new Date(), location.timezone);
    const [taskResult, recipeResult, itemResult, unitResult, membershipResult] =
      await Promise.all([
        supabase
          .from("prep_tasks")
          .select(
            "id, business_date, service_period, station, recipe_id, output_inventory_item_id, target_quantity, target_unit_id, due_at, assignee_user_id, state, actual_yield, note, completion_note, stock_override, stock_warnings, version, correction_note",
          )
          .eq("organization_id", organizationId)
          .eq("location_id", locationId)
          .eq("business_date", date)
          .order("due_at"),
        supabase
          .from("recipes")
          .select("id, name, yield_quantity, yield_unit_id")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("inventory_items")
          .select("id, name, base_unit_id")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .eq("track_inventory", true)
          .order("name"),
        supabase
          .from("measurement_units")
          .select("id, name, symbol")
          .eq("organization_id", organizationId)
          .eq("is_active", true)
          .order("name"),
        supabase
          .from("location_memberships")
          .select("user_id")
          .eq("organization_id", organizationId)
          .eq("location_id", locationId),
      ]);
    if (
      taskResult.error ||
      recipeResult.error ||
      itemResult.error ||
      unitResult.error ||
      membershipResult.error
    ) {
      return readFailure();
    }
    const userIds = (membershipResult.data ?? []).map((row) => row.user_id);
    const profileResult = userIds.length
      ? await supabase
          .from("profiles")
          .select("id, display_name, preferred_name")
          .in("id", userIds)
      : { data: [], error: null };
    if (profileResult.error) return readFailure();

    const recipes = (recipeResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      yieldQuantity: Number(row.yield_quantity),
      yieldUnitId: row.yield_unit_id,
    }));
    const items = (itemResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      baseUnitId: row.base_unit_id,
    }));
    const units = (unitResult.data ?? []).map((row) => ({
      id: row.id,
      name: row.name,
      symbol: row.symbol,
    }));
    const recipeById = new Map(recipes.map((recipe) => [recipe.id, recipe]));
    const itemById = new Map(items.map((item) => [item.id, item]));
    const unitById = new Map(units.map((unit) => [unit.id, unit]));
    const profileById = new Map(
      (profileResult.data ?? []).map((profile) => [
        profile.id,
        profile.preferred_name || profile.display_name,
      ]),
    );

    return readSuccess({
      date,
      timeZone: location.timezone,
      recipes,
      outputItems: items,
      units,
      assignees: userIds
        .map((userId) => ({ userId, name: profileById.get(userId) ?? "Team member" }))
        .sort((left, right) => left.name.localeCompare(right.name)),
      tasks: (taskResult.data ?? []).map((row) => ({
        id: row.id,
        businessDate: row.business_date,
        servicePeriod: row.service_period as LivePrepTask["servicePeriod"],
        station: row.station,
        recipeId: row.recipe_id,
        recipeName: row.recipe_id ? recipeById.get(row.recipe_id)?.name ?? "Recipe" : null,
        outputInventoryItemId: row.output_inventory_item_id,
        outputItemName: row.output_inventory_item_id
          ? itemById.get(row.output_inventory_item_id)?.name ?? "Finished batch"
          : null,
        targetQuantity: Number(row.target_quantity),
        targetUnitId: row.target_unit_id,
        targetUnitSymbol: unitById.get(row.target_unit_id)?.symbol ?? "unit",
        dueAt: row.due_at,
        assigneeUserId: row.assignee_user_id,
        assigneeName: row.assignee_user_id
          ? profileById.get(row.assignee_user_id) ?? "Team member"
          : null,
        state: row.state as LivePrepTask["state"],
        actualYield: row.actual_yield == null ? null : Number(row.actual_yield),
        note: row.note,
        completionNote: row.completion_note,
        stockOverride: row.stock_override,
        stockWarnings: Array.isArray(row.stock_warnings) ? row.stock_warnings : [],
        version: row.version,
        correctionNote: row.correction_note,
      })),
    });
  } catch {
    return readFailure();
  }
}
