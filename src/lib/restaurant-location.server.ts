import "server-only";

import { createAdminClient } from "@/lib/supabase/admin";
import { matchesRestaurantLocation, restaurantLocationCode, restaurantOrganizationSlug } from "./restaurant-location";

export type RestaurantLocation = { organizationId: string; locationId: string; timezone: string };

export async function resolveRestaurantLocation(
  admin = createAdminClient(),
): Promise<RestaurantLocation> {
  const { data: organization, error: organizationError } = await admin
    .from("organizations")
    .select("id")
    .eq("slug", restaurantOrganizationSlug)
    .eq("status", "active")
    .maybeSingle();
  if (organizationError || !organization) throw new Error("The restaurant organization is unavailable.");

  const { data: location, error: locationError } = await admin
    .from("locations")
    .select("id,code,timezone")
    .eq("organization_id", organization.id)
    .eq("code", restaurantLocationCode)
    .eq("is_active", true)
    .maybeSingle();
  if (locationError || !location || !matchesRestaurantLocation(location)) {
    throw new Error("The Ninth Avenue restaurant location is unavailable.");
  }

  return { organizationId: organization.id, locationId: location.id, timezone: location.timezone };
}
