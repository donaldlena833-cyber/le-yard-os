export interface ContentSecurityPolicyOptions {
  nonce: string;
  development?: boolean;
  supabaseUrl?: string;
}

const safeNoncePattern = /^[A-Za-z0-9+/=_-]+$/;

function externalOrigins(value?: string): string[] {
  if (!value) return [];

  try {
    const url = new URL(value);
    if (url.protocol !== "https:" && url.protocol !== "http:") return [];

    const socketProtocol = url.protocol === "https:" ? "wss:" : "ws:";
    const socketOrigin = `${socketProtocol}//${url.host}`;
    return [url.origin, socketOrigin];
  } catch {
    return [];
  }
}

/**
 * Builds the per-request browser policy used by Proxy. The nonce is generated
 * at the request boundary; this function deliberately accepts only a CSP-safe
 * token so a malformed value can never append a directive.
 */
export function buildContentSecurityPolicy({
  nonce,
  development = false,
  supabaseUrl,
}: ContentSecurityPolicyOptions): string {
  if (!safeNoncePattern.test(nonce)) {
    throw new Error("CSP nonce contains invalid characters.");
  }

  const connectedOrigins = externalOrigins(supabaseUrl);
  const assetSources = ["'self'", "blob:", "data:", ...connectedOrigins];
  const directives = [
    "default-src 'self'",
    `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'${development ? " 'unsafe-eval'" : ""}`,
    "script-src-attr 'none'",
    development
      ? "style-src 'self' 'unsafe-inline'"
      : `style-src 'self' 'nonce-${nonce}'`,
    // Motion and responsive React components use generated style attributes.
    // This exception does not permit inline scripts or un-nonced <style> tags.
    "style-src-attr 'unsafe-inline'",
    "font-src 'self' data:",
    `img-src ${assetSources.join(" ")}`,
    `media-src ${assetSources.join(" ")}`,
    `connect-src ${["'self'", ...connectedOrigins].join(" ")}`,
    "worker-src 'self' blob:",
    "manifest-src 'self'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
    ...(development ? [] : ["upgrade-insecure-requests"]),
  ];

  return `${directives.join("; ")};`;
}
