const publicPaths = new Set([
  "/sign-in",
  "/auth/callback",
  "/invite",
  "/api/health",
  "/manifest.webmanifest",
  "/offline.html",
  "/sw.js",
]);

export function isPublicRequestPath(pathname: string) {
  return publicPaths.has(pathname);
}
