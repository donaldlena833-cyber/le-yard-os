import { createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import {
  LE_YARD_MENU_VERSION,
  menuCategories,
  menuIngredients,
  menuRecipes,
} from "./data/le-yard-opening-menu-v1.mjs";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const email = process.env.LE_YARD_IMPORT_EMAIL;
const password = process.env.LE_YARD_IMPORT_PASSWORD;

if (!url || !publishableKey || !email || !password) {
  throw new Error(
    "NEXT_PUBLIC_SUPABASE_URL, NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY, LE_YARD_IMPORT_EMAIL, and LE_YARD_IMPORT_PASSWORD are required.",
  );
}

function stableUuid(kind, name) {
  const bytes = createHash("sha256")
    .update(`${LE_YARD_MENU_VERSION}:${kind}:${name}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = bytes.toString("hex");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function fail(error, context) {
  if (error) throw new Error(`${context}: ${error.message}`);
}

const supabase = createClient(url, publishableKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: authData, error: authError } = await supabase.auth.signInWithPassword({
  email,
  password,
});
fail(authError, "Menu importer authentication failed");
if (!authData.user) throw new Error("Menu importer did not receive an authenticated user.");

const { data: memberships, error: membershipError } = await supabase
  .from("organization_memberships")
  .select("organization_id, role, status")
  .eq("user_id", authData.user.id)
  .eq("status", "active");
fail(membershipError, "Active organization membership could not be loaded");

const managerMembership = memberships?.find((membership) => membership.role === "manager");
if (!managerMembership) {
  throw new Error("Use an active Manager/Chef account for this import.");
}

const organizationId = managerMembership.organization_id;
const { data: locationMemberships, error: locationMembershipError } = await supabase
  .from("location_memberships")
  .select("location_id, is_primary")
  .eq("organization_id", organizationId)
  .eq("user_id", authData.user.id);
fail(locationMembershipError, "Location membership could not be loaded");

const orderedLocationMemberships = [...(locationMemberships ?? [])].sort(
  (left, right) => Number(right.is_primary) - Number(left.is_primary),
);
const locationId = orderedLocationMemberships[0]?.location_id;
if (!locationId) throw new Error("The importing Chef has no active location assignment.");

const { data: locations, error: locationError } = await supabase
  .from("locations")
  .select("id, name, is_active")
  .eq("organization_id", organizationId)
  .eq("id", locationId)
  .eq("is_active", true)
  .limit(1);
fail(locationError, "Active location could not be loaded");
if (!locations?.length) throw new Error("The importing location is not active.");

const { data: units, error: unitError } = await supabase
  .from("measurement_units")
  .select("id, name, symbol, dimension, is_active")
  .eq("organization_id", organizationId)
  .eq("is_active", true);
fail(unitError, "Measurement units could not be loaded");
const grams = units?.find((unit) => unit.symbol.toLowerCase() === "g");
const piece = units?.find((unit) => unit.symbol.toLowerCase() === "pcs");
if (!grams || !piece) throw new Error("Active gram (g) and piece (pcs) units are required.");

const summary = { categoriesCreated: 0, itemsCreated: 0, recipesCreated: 0, skipped: 0 };

const { data: existingCategories, error: categoryReadError } = await supabase
  .from("inventory_categories")
  .select("id, name, is_active")
  .eq("organization_id", organizationId);
fail(categoryReadError, "Inventory categories could not be loaded");
const categoryByName = new Map((existingCategories ?? []).map((category) => [category.name, category]));

for (const name of menuCategories) {
  if (categoryByName.has(name)) {
    summary.skipped += 1;
    continue;
  }
  const requestId = stableUuid("category", name);
  const { data, error } = await supabase.rpc("configure_kitchen_foundation", {
    p_request_id: requestId,
    p_organization_id: organizationId,
    p_location_id: locationId,
    p_command: "category.save",
    p_payload: { id: null, name, parentId: null, isActive: true },
  });
  fail(error, `Category ${name} could not be created`);
  categoryByName.set(name, { id: String(data.id), name, is_active: true });
  summary.categoriesCreated += 1;
}

const { data: existingItems, error: itemReadError } = await supabase
  .from("inventory_items")
  .select("id, name, category_id, base_unit_id, is_active")
  .eq("organization_id", organizationId);
fail(itemReadError, "Inventory items could not be loaded");
const itemByName = new Map((existingItems ?? []).map((item) => [item.name, item]));

for (const item of menuIngredients) {
  if (itemByName.has(item.name)) {
    summary.skipped += 1;
    continue;
  }
  const categoryId = categoryByName.get(item.category)?.id;
  if (!categoryId) throw new Error(`Missing category ${item.category} for ${item.name}.`);
  const requestId = stableUuid("item", item.name);
  const { data, error } = await supabase.rpc("configure_operational_inventory_catalog", {
    p_request_id: requestId,
    p_organization_id: organizationId,
    p_location_id: locationId,
    p_command: "item.save",
    p_payload: {
      id: null,
      name: item.name,
      sku: null,
      description: item.description,
      categoryId,
      baseUnitId: grams.id,
      trackInventory: true,
      isActive: true,
    },
  });
  fail(error, `Ingredient ${item.name} could not be created`);
  itemByName.set(item.name, {
    id: String(data.id),
    name: item.name,
    category_id: categoryId,
    base_unit_id: grams.id,
    is_active: true,
  });
  summary.itemsCreated += 1;
}

const { data: existingRecipes, error: recipeReadError } = await supabase
  .from("recipes")
  .select("id, name")
  .eq("organization_id", organizationId);
fail(recipeReadError, "Recipes could not be loaded");
const recipeByName = new Map((existingRecipes ?? []).map((recipe) => [recipe.name, recipe]));

for (const recipe of menuRecipes) {
  if (recipeByName.has(recipe.name)) {
    summary.skipped += 1;
    continue;
  }
  const ingredients = recipe.ingredients.map((entry) => {
    const item = itemByName.get(entry.name);
    if (!item) throw new Error(`Recipe ${recipe.name} references missing item ${entry.name}.`);
    return {
      inventoryItemId: item.id,
      unitId: grams.id,
      quantity: entry.grams,
      wasteFactor: entry.wasteFactor,
    };
  });
  const requestId = stableUuid("recipe", recipe.name);
  const { data, error } = await supabase.rpc("save_manager_recipe", {
    p_request_id: requestId,
    p_workspace_location_id: locationId,
    p_recipe_id: null,
    p_name: recipe.name,
    p_yield_quantity: 1,
    p_yield_unit_id: piece.id,
    p_menu_price_cents: recipe.menuPriceCents,
    p_is_active: true,
    p_ingredients: ingredients,
  });
  fail(error, `Recipe ${recipe.name} could not be created`);
  recipeByName.set(recipe.name, { id: String(data.id), name: recipe.name });
  summary.recipesCreated += 1;
}

await supabase.auth.signOut();

process.stdout.write(`${JSON.stringify({
  menuVersion: LE_YARD_MENU_VERSION,
  organizationId,
  locationId,
  locationName: locations[0].name,
  ingredientCount: menuIngredients.length,
  recipeCount: menuRecipes.length,
  ...summary,
})}\n`);
