export const CONNECTED_ACCEPTANCE_ATTESTATION_PATH =
  "/api/internal/connected-acceptance/attest";

// These exact routes authenticate the provider at the route boundary with
// Twilio's signature (or the dedicated agent-tool secret), not browser cookies.
// Do not allow the entire /api/twilio prefix: outbound staff calling must retain
// session authentication and tenant membership checks.
const providerAuthenticatedPaths = new Set([
  "/api/twilio/readiness",
  "/api/twilio/voice/incoming",
  "/api/twilio/voice/screen",
  "/api/twilio/voice/screen-result",
  "/api/twilio/voice/result",
  "/api/twilio/voice/missed-consent",
  "/api/twilio/voice/voicemail",
  "/api/twilio/voice/status",
  "/api/twilio/voice/outbound-bridge",
  "/api/twilio/voice/outbound-connect",
  "/api/twilio/voice/outbound-result",
  "/api/twilio/sms/incoming",
  "/api/twilio/sms/status",
  "/api/internal/communications/agent/availability",
  "/api/internal/communications/agent/reservations",
  "/api/internal/communications/agent/transfer-human",
]);

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
  return publicPaths.has(pathname) || providerAuthenticatedPaths.has(pathname) || pathname.startsWith("/api/v1/");
}
