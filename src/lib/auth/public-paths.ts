export const CONNECTED_ACCEPTANCE_ATTESTATION_PATH =
  "/api/internal/connected-acceptance/attest";

const publicPaths = new Set([
  "/sign-in",
  "/auth/callback",
  "/invite",
  "/api/health",
  "/api/health/email",
  "/api/internal/reservation-push",
  "/api/internal/reservation-messages",
  "/api/internal/integrations/toast-labor",
  CONNECTED_ACCEPTANCE_ATTESTATION_PATH,
  "/manifest.webmanifest",
  "/offline.html",
  "/sw.js",
]);

export function isPreAuthenticationRequestPath(pathname: string) {
  return pathname === CONNECTED_ACCEPTANCE_ATTESTATION_PATH;
}

export function isPublicRequestPath(pathname: string) {
  return publicPaths.has(pathname) || pathname.startsWith("/api/v1/");
}
