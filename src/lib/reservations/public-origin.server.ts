import "server-only";

function isLocalHostname(hostname: string) {
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

export function canonicalReservationPublicSiteOrigin(
  value = process.env.RESERVATION_PUBLIC_SITE_URL,
  production = process.env.NODE_ENV === "production",
) {
  const normalized = value?.trim();
  if (!normalized) return null;
  try {
    const parsed = new URL(normalized);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      return null;
    if (parsed.username || parsed.password || parsed.search || parsed.hash)
      return null;
    if (parsed.pathname !== "/") return null;
    const local = isLocalHostname(parsed.hostname);
    if (production && (parsed.protocol !== "https:" || local)) return null;
    if (!production && parsed.protocol === "http:" && !local) return null;
    return parsed.origin;
  } catch {
    return null;
  }
}
