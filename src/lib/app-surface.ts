export type AppSurface = "operations" | "host" | "phone";

export function resolveAppSurface(value: string | undefined): AppSurface {
  const surface = value?.trim().toLowerCase();
  return surface === "host" || surface === "phone" ? surface : "operations";
}
export const appSurface = resolveAppSurface(process.env.NEXT_PUBLIC_APP_SURFACE);
export const isHostSurface = appSurface === "host";
export const isPhoneSurface = appSurface === "phone";
export const defaultWorkspacePath = isPhoneSurface ? "/phone" : isHostSurface ? "/reservations" : "/today";
const hostWorkspacePaths = ["/reservations", "/reservations/setup", "/guests"] as const;
const phoneWorkspacePaths = ["/phone", "/messages"] as const;

export function isDestinationAllowedForAppSurface(pathname: string): boolean {
  if (isPhoneSurface) {
    // Navigation actions can include the conversation query from an SMS alert.
    const destinationPathname = pathname.split(/[?#]/, 1)[0];
    return phoneWorkspacePaths.some((allowed) => destinationPathname === allowed);
  }
  if (!isHostSurface) return true;
  return hostWorkspacePaths.some((allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`));
}
export function isRequestPathAllowedForAppSurface(pathname: string): boolean {
  if (isPhoneSurface) {
    return [
      "/", "/sign-in", "/invite", ...phoneWorkspacePaths,
      "/le-yard-messages.vcf", "/manifest.webmanifest", "/offline.html", "/offline.css", "/sw.js",
      "/api/health", "/api/phone", "/api/phone/media", "/api/phone/attachments",
      "/api/communications/groups", "/api/communications/pilot",
    ].includes(pathname)
      || pathname.startsWith("/auth/") || pathname.startsWith("/api/twilio/")
      || pathname.startsWith("/api/internal/communications/") || pathname.startsWith("/icons/");
  }
  if (!isHostSurface) return true;
  if (pathname === "/" || pathname === "/sign-in" || pathname === "/invite" || pathname.startsWith("/auth/") || pathname.startsWith("/api/")) return true;
  return isDestinationAllowedForAppSurface(pathname);
}
export const surfaceProductName = isPhoneSurface ? "Le Yard Phone" : isHostSurface ? "Le Yard Host" : "Le Yard OS";
export const surfaceProductDetail = isPhoneSurface ? "Shared calls & messages" : isHostSurface ? "Reservations & guests" : "Restaurant operations";
