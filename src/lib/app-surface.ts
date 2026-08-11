export type AppSurface = "operations" | "host";

export function resolveAppSurface(value: string | undefined): AppSurface {
  return value?.trim().toLowerCase() === "host" ? "host" : "operations";
}

export const appSurface = resolveAppSurface(
  process.env.NEXT_PUBLIC_APP_SURFACE,
);

export const isHostSurface = appSurface === "host";

export const defaultWorkspacePath = isHostSurface
  ? "/reservations"
  : "/today";

const hostWorkspacePaths = [
  "/reservations",
  "/reservations/setup",
  "/guests",
] as const;

export function isDestinationAllowedForAppSurface(pathname: string): boolean {
  if (!isHostSurface) return true;
  return hostWorkspacePaths.some(
    (allowed) => pathname === allowed || pathname.startsWith(`${allowed}/`),
  );
}

export function isRequestPathAllowedForAppSurface(pathname: string): boolean {
  if (!isHostSurface) return true;
  if (
    pathname === "/" ||
    pathname === "/sign-in" ||
    pathname === "/invite" ||
    pathname.startsWith("/auth/") ||
    pathname.startsWith("/api/")
  ) {
    return true;
  }
  return isDestinationAllowedForAppSurface(pathname);
}

export const surfaceProductName = isHostSurface ? "Le Yard Host" : "Le Yard OS";
export const surfaceProductDetail = isHostSurface
  ? "Reservations & guest CRM"
  : "Operator workspace";
