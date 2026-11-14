import "server-only";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

const quantity = z.union([z.string(), z.number()]);
const countItemSchema = z.object({
  id: z.uuid(),
  label: z.string(),
  pendingRequestId: z.uuid().nullish(),
  pendingQuantity: quantity.nullish(),
  pendingReason: z.string().nullish(),
  pendingObservedAt: z.string().nullish(),
  lastConfirmedQuantity: quantity.nullish(),
  lastConfirmedObservedAt: z.string().nullish(),
});
export type ChurchSquareCountItem = z.infer<typeof countItemSchema>;

export async function loadChurchSquareCountItems(locationId: string): Promise<ChurchSquareCountItem[] | null> {
  const client = await createClient();
  const { data, error } = await client.rpc("list_church_square_count_items", { p_location_id: locationId });
  if (error) return null;
  const result = z.array(countItemSchema).safeParse(data);
  return result.success ? result.data : null;
}
