import "server-only";

import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { requireSupabasePublicEnv } from "@/lib/env";
import type { Database } from "@/types/database.generated";
import { REMEMBERED_SESSION_TTL_SECONDS } from "@/lib/auth/session-duration";

export async function createClient(options?: { cookieMaxAge?: number }) {
  const cookieStore = await cookies();
  const { url, publishableKey } = requireSupabasePublicEnv();

  return createServerClient<Database>(url, publishableKey, {
    cookieOptions: {
      maxAge: options?.cookieMaxAge ?? REMEMBERED_SESSION_TTL_SECONDS,
    },
    cookies: {
      getAll() {
        return cookieStore.getAll();
      },
      setAll(cookiesToSet) {
        try {
          cookiesToSet.forEach(({ name, value, options }) => {
            cookieStore.set(name, value, options);
          });
        } catch {
          // Server Components cannot write cookies. The root proxy refreshes them.
        }
      },
    },
  });
}
