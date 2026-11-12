export const restaurantOrganizationSlug = "le-yard";
export const restaurantLocationCode = "MAIN";

export function matchesRestaurantLocation(
  location: { id: string; code: string },
  configuredId = process.env.LE_YARD_LOCATION_ID?.trim(),
): boolean {
  return location.code === restaurantLocationCode &&
    (!configuredId || location.id === configuredId);
}
