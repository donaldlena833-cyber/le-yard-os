const publicPaths = new Set([
  "/sign-in",
  "/auth/callback",
  "/invite",
  "/api/health",
  "/api/internal/reservation-push",
  "/api/internal/reservation-messages",
  "/manifest.webmanifest",
  "/offline.html",
  "/sw.js",
]);

export function isPublicRequestPath(pathname: string) {
  return publicPaths.has(pathname) || pathname.startsWith("/api/v1/");
}
