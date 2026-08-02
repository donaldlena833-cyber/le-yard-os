import "server-only";

import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { requireSupabaseServerEnv } from "@/lib/env.server";
import type { Database } from "@/types/database.generated";

export function createAdminClient() {
  const { url, secretKey } = requireSupabaseServerEnv();
  return createSupabaseClient<Database>(url, secretKey, {
    auth: {
      autoRefreshToken: false,
      persistSession: false,
      detectSessionInUrl: false,
    },
  });
}
