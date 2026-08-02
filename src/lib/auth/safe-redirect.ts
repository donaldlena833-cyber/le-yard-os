const INTERNAL_ORIGIN = "https://internal.invalid";
const CONTROL_CHARACTERS = /[\u0000-\u001f\u007f-\u009f]/;
const ENCODED_CONTROL_OR_BACKSLASH = /%(?:0[0-9a-f]|1[0-9a-f]|7f|c2%8[0-9a-f]|5c)/i;

function hasUnsafeDecodedForm(value: string): boolean {
  let decoded = value;

  for (let index = 0; index < 3; index += 1) {
    if (
      !decoded.startsWith("/") ||
      decoded.startsWith("//") ||
      decoded.includes("\\") ||
      CONTROL_CHARACTERS.test(decoded)
    ) {
      return true;
    }

    try {
      const next = decodeURIComponent(decoded);
      if (next === decoded) break;
      decoded = next;
    } catch {
      return true;
    }
  }

  return false;
}

/**
 * Accepts only an origin-relative application path. Network-path references,
 * encoded redirect tricks, backslashes, control characters, and absolute URLs
 * all fall back to the known-safe workspace landing page.
 */
export function safeInternalRedirect(
  value: string | null | undefined,
  fallback = "/today",
): string {
  if (!value || ENCODED_CONTROL_OR_BACKSLASH.test(value)) return fallback;
  if (hasUnsafeDecodedForm(value)) return fallback;

  try {
    const candidate = new URL(value, INTERNAL_ORIGIN);
    if (candidate.origin !== INTERNAL_ORIGIN) return fallback;
    if (candidate.username || candidate.password) return fallback;
    const normalized = `${candidate.pathname}${candidate.search}${candidate.hash}`;
    if (
      ENCODED_CONTROL_OR_BACKSLASH.test(normalized) ||
      hasUnsafeDecodedForm(normalized)
    ) {
      return fallback;
    }
    return normalized;
  } catch {
    return fallback;
  }
}
