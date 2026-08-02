type PublicEnvironmentKey =
  | "NEXT_PUBLIC_APP_URL"
  | "NEXT_PUBLIC_DEMO_MODE"
  | "NEXT_PUBLIC_SUPABASE_URL"
  | "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY"
  | "NEXT_PUBLIC_VAPID_PUBLIC_KEY"
  | "NODE_ENV";
type EnvironmentSource = Partial<Record<PublicEnvironmentKey, string | undefined>>;

export type RuntimeMode = "demo" | "connected" | "invalid";

export type RuntimeConfigurationIssue =
  | "app_url_missing"
  | "app_url_invalid"
  | "app_url_not_production_safe"
  | "demo_mode_missing"
  | "demo_mode_invalid"
  | "production_demo_mode_forbidden"
  | "playground_connected_configuration_forbidden"
  | "supabase_url_missing"
  | "supabase_url_invalid"
  | "supabase_url_not_production_safe"
  | "supabase_publishable_key_missing"
  | "supabase_secret_key_missing";

export interface PublicRuntimeConfiguration {
  ready: boolean;
  mode: RuntimeMode;
  appUrl: string | null;
  supabaseUrl: string | null;
  supabasePublishableKey: string | null;
  supabaseConfigurationPresent: boolean;
  issues: readonly RuntimeConfigurationIssue[];
  production: boolean;
}

export interface ServerRuntimeConfiguration extends PublicRuntimeConfiguration {
  supabaseSecretKeyPresent: boolean;
  playground: boolean;
}

function trimmed(value: string | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

function canonicalHttpOrigin(value: string | null): string | null {
  if (!value) return null;

  try {
    const parsed = new URL(value);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash) return null;
    if (parsed.pathname !== "/") return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

function isLocalHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized.endsWith(".local") ||
    normalized === "0.0.0.0" ||
    normalized.startsWith("127.") ||
    normalized === "::1" ||
    normalized === "host.docker.internal"
  );
}

function isProductionSafeOrigin(value: string): boolean {
  const parsed = new URL(value);
  return parsed.protocol === "https:" && !isLocalHostname(parsed.hostname);
}

/**
 * Pure configuration assessment used by runtime code and unit tests. There
 * are intentionally no implicit mode or origin defaults: missing values make
 * the deployment not ready instead of silently exposing the demo workspace.
 */
export function assessPublicRuntimeConfiguration(
  source: EnvironmentSource,
): PublicRuntimeConfiguration {
  const issues: RuntimeConfigurationIssue[] = [];
  const production = source.NODE_ENV === "production";
  const rawMode = trimmed(source.NEXT_PUBLIC_DEMO_MODE);
  const mode: RuntimeMode =
    rawMode === "true" ? "demo" : rawMode === "false" ? "connected" : "invalid";

  if (!rawMode) issues.push("demo_mode_missing");
  else if (mode === "invalid") issues.push("demo_mode_invalid");
  else if (production && mode === "demo") {
    issues.push("production_demo_mode_forbidden");
  }

  const rawAppUrl = trimmed(source.NEXT_PUBLIC_APP_URL);
  const appUrl = canonicalHttpOrigin(rawAppUrl);
  if (!rawAppUrl) issues.push("app_url_missing");
  else if (!appUrl) issues.push("app_url_invalid");
  else if (production && !isProductionSafeOrigin(appUrl)) {
    issues.push("app_url_not_production_safe");
  }

  const rawSupabaseUrl = trimmed(source.NEXT_PUBLIC_SUPABASE_URL);
  const supabaseUrl = canonicalHttpOrigin(rawSupabaseUrl);
  const supabasePublishableKey = trimmed(
    source.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
  const supabaseConfigurationPresent = Boolean(
    rawSupabaseUrl || supabasePublishableKey,
  );

  if (mode === "connected") {
    if (!rawSupabaseUrl) issues.push("supabase_url_missing");
    else if (!supabaseUrl) issues.push("supabase_url_invalid");
    if (!supabasePublishableKey) issues.push("supabase_publishable_key_missing");

    if (production && supabaseUrl && !isProductionSafeOrigin(supabaseUrl)) {
      issues.push("supabase_url_not_production_safe");
    }
  }

  return {
    ready: issues.length === 0,
    mode,
    appUrl,
    supabaseUrl,
    supabasePublishableKey,
    supabaseConfigurationPresent,
    issues,
    production,
  };
}

/** Adds server-only Supabase readiness without exposing the credential. */
export function assessServerRuntimeConfiguration(
  publicConfiguration: PublicRuntimeConfiguration,
  supabaseSecretKey: string | undefined,
): ServerRuntimeConfiguration {
  const supabaseSecretKeyPresent = Boolean(trimmed(supabaseSecretKey));
  const issues = [...publicConfiguration.issues];

  if (
    publicConfiguration.mode === "connected" &&
    !supabaseSecretKeyPresent &&
    !issues.includes("supabase_secret_key_missing")
  ) {
    issues.push("supabase_secret_key_missing");
  }

  return {
    ...publicConfiguration,
    ready: issues.length === 0,
    issues,
    supabaseSecretKeyPresent,
    supabaseConfigurationPresent:
      publicConfiguration.supabaseConfigurationPresent ||
      supabaseSecretKeyPresent,
    playground: false,
  };
}

/**
 * Removes the production demo prohibition only for a separately validated,
 * explicitly targeted Vercel playground. The auth assessment accepts only the
 * `preview`/Preview and `production-playground`/Production pairs. Every other
 * public/server issue remains fail-closed.
 */
export function enableValidatedPlayground(
  configuration: ServerRuntimeConfiguration,
  playgroundReady: boolean,
): ServerRuntimeConfiguration {
  const playground =
    playgroundReady &&
    configuration.production &&
    configuration.mode === "demo";
  if (!playground) return configuration;

  const issues = configuration.issues.filter(
    (issue) => issue !== "production_demo_mode_forbidden",
  );
  if (configuration.supabaseConfigurationPresent) {
    issues.push("playground_connected_configuration_forbidden");
  }
  return {
    ...configuration,
    ready: issues.length === 0,
    issues,
    playground: true,
  };
}

/** @deprecated Use enableValidatedPlayground for either explicit Vercel target. */
export const enableValidatedPreviewPlayground = enableValidatedPlayground;

export const publicRuntimeConfiguration = assessPublicRuntimeConfiguration({
  NEXT_PUBLIC_APP_URL: process.env.NEXT_PUBLIC_APP_URL,
  NEXT_PUBLIC_DEMO_MODE: process.env.NEXT_PUBLIC_DEMO_MODE,
  NEXT_PUBLIC_SUPABASE_URL: process.env.NEXT_PUBLIC_SUPABASE_URL,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY: process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY,
  NODE_ENV: process.env.NODE_ENV,
});

/**
 * Backward-compatible, browser-safe values. The invalid origin is a sentinel,
 * never a readiness fallback; the proxy blocks an invalid configuration.
 */
export const publicEnv = {
  NEXT_PUBLIC_APP_URL:
    publicRuntimeConfiguration.appUrl ?? "http://invalid.local",
  NEXT_PUBLIC_DEMO_MODE:
    publicRuntimeConfiguration.mode === "demo" ? "true" : "false",
  NEXT_PUBLIC_SUPABASE_URL:
    publicRuntimeConfiguration.supabaseUrl ?? undefined,
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY:
    publicRuntimeConfiguration.supabasePublishableKey ?? undefined,
  NEXT_PUBLIC_VAPID_PUBLIC_KEY:
    trimmed(process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY) ?? undefined,
} as const;

export const isDemoMode = publicRuntimeConfiguration.mode === "demo";

export const isSupabaseConfigured = Boolean(
  publicRuntimeConfiguration.supabaseUrl &&
    publicRuntimeConfiguration.supabasePublishableKey,
);

export function requireSupabasePublicEnv() {
  if (
    !publicRuntimeConfiguration.supabaseUrl ||
    !publicRuntimeConfiguration.supabasePublishableKey
  ) {
    throw new Error("Supabase public configuration is unavailable.");
  }

  return {
    url: publicRuntimeConfiguration.supabaseUrl,
    publishableKey: publicRuntimeConfiguration.supabasePublishableKey,
  };
}
