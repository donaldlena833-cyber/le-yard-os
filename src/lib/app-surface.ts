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

export function isDestinationAllowedForAppSurface(pathname: string): boolean {
  if (isPhoneSurface) return pathname === "/phone";
  if (!isHostSurface) return true;
  return hostWorkspacePaths.some((allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`));
}
export function isRequestPathAllowedForAppSurface(pathname: string): boolean {
  if (isPhoneSurface) {
    return ["/", "/sign-in", "/invite", "/phone", "/manifest.webmanifest", "/offline.html", "/offline.css", "/sw.js", "/api/health", "/api/phone", "/api/phone/media"].includes(pathname)
      || pathname.startsWith("/auth/") || pathname.startsWith("/api/twilio/")
      || pathname.startsWith("/api/internal/communications/") || pathname.startsWith("/icons/");
  }
  if (!isHostSurface) return true;
  if (pathname === "/" || pathname === "/sign-in" || pathname === "/invite" || pathname.startsWith("/auth/") || pathname.startsWith("/api/")) return true;
  return isDestinationAllowedForAppSurface(pathname);
}
export const surfaceProductName = isPhoneSurface ? "Le Yard Phone" : isHostSurface ? "Le Yard Host" : "Le Yard OS";
export const surfaceProductDetail = isPhoneSurface ? "Shared calls & messages" : isHostSurface ? "Reservations & guests" : "Restaurant operations";
