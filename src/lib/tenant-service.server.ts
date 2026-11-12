import "server-only";

import type { UserScopedSupabaseClient } from "@/data/types";
import { parseTenantServiceSettings } from "./tenant-service";

export async function resolveTenantServiceSettings(
  supabase: UserScopedSupabaseClient,
  organizationId: string,
) {
  const { data, error } = await supabase
    .from("organization_settings")
    .select("feature_flags")
    .eq("organization_id", organizationId)
    .maybeSingle();
  if (error) throw error;
  return parseTenantServiceSettings(data?.feature_flags);
}
