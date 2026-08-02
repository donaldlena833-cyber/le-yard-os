import "server-only";

import {
  assessPublicRuntimeConfiguration,
  assessServerRuntimeConfiguration,
  enableValidatedPlayground,
  requireSupabasePublicEnv,
} from "@/lib/env";
import { getPlaygroundAuthAssessment } from "@/lib/auth/playground-auth.server";

export function getServerRuntimeConfiguration() {
  const publicConfiguration = assessPublicRuntimeConfiguration({
    NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
    NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
    NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
      process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
    NODE_ENV: process.env.NODE_ENV,
  });

  const baseConfiguration = assessServerRuntimeConfiguration(
    publicConfiguration,
    process.env.SUPABASE_SECRET_KEY,
  );
  return enableValidatedPlayground(
    baseConfiguration,
    getPlaygroundAuthAssessment().ready,
  );
}

export function requireSupabaseServerEnv() {
  const configuration = getServerRuntimeConfiguration();
  if (configuration.mode !== "connected" || !configuration.ready) {
    throw new Error("Connected server configuration is unavailable.");
  }

  const publicConfiguration = requireSupabasePublicEnv();
  const secretKey = process.env.SUPABASE_SECRET_KEY?.trim();
  if (!secretKey) {
    throw new Error("Connected server configuration is unavailable.");
  }

  return { ...publicConfiguration, secretKey };
}
