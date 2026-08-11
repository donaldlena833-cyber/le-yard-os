import { createBrowserClient } from "@supabase/ssr";
import { requireSupabasePublicEnv } from "@/lib/env";
import type { Database } from "@/types/database.generated";
import { REMEMBERED_SESSION_TTL_SECONDS } from "@/lib/auth/session-duration";

export function createClient() {
  const { url, publishableKey } = requireSupabasePublicEnv();
  return createBrowserClient<Database>(url, publishableKey, {
    cookieOptions: { maxAge: REMEMBERED_SESSION_TTL_SECONDS },
  });
}
