import { createHash } from "node:crypto";

export const GENERIC_CLIENT_ERROR_MESSAGE = "Workspace error boundary event";
const SAFE_DIGEST = /^[A-Za-z0-9_-]{1,128}$/;

export function sanitizeClientErrorDigest(
  value: string | null | undefined,
): string | null {
  const normalized = value?.trim();
  return normalized && SAFE_DIGEST.test(normalized) ? normalized : null;
}

export function clientErrorFingerprint(digest: string | null): string {
  return createHash("sha256")
    .update(`workspace_error_boundary:${digest ?? "unavailable"}`)
    .digest("hex")
    .slice(0, 32);
}

export interface RateLimitDecision {
  allowed: boolean;
  retryAfterSeconds: number;
}

interface RateLimitEntry {
  count: number;
  windowStartedAt: number;
}

/**
 * Small per-instance flood guard. It protects the service-role diagnostic
 * write path without retaining submitted error text or network identifiers.
 */
export class FixedWindowRateLimiter {
  private readonly entries = new Map<string, RateLimitEntry>();

  constructor(
    private readonly limit = 5,
    private readonly windowMs = 60_000,
    private readonly maximumEntries = 5_000,
  ) {}

  consume(key: string, now = Date.now()): RateLimitDecision {
    const existing = this.entries.get(key);
    if (!existing || now - existing.windowStartedAt >= this.windowMs) {
      this.prune(now);
      this.entries.set(key, { count: 1, windowStartedAt: now });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (existing.count >= this.limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(
          1,
          Math.ceil((existing.windowStartedAt + this.windowMs - now) / 1_000),
        ),
      };
    }

    existing.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  }

  private prune(now: number) {
    if (this.entries.size < this.maximumEntries) return;

    this.entries.forEach((entry, key) => {
      if (now - entry.windowStartedAt >= this.windowMs) this.entries.delete(key);
    });

    if (this.entries.size >= this.maximumEntries) {
      const oldestKey = this.entries.keys().next().value as string | undefined;
      if (oldestKey) this.entries.delete(oldestKey);
    }
  }
}

export function clientErrorRateLimitKey(
  organizationId: string,
  userId: string,
): string {
  return createHash("sha256")
    .update(`${organizationId}:${userId}`)
    .digest("hex");
}

/** Reads an untrusted request body without buffering beyond the byte ceiling. */
export async function readBoundedJson(
  request: Request,
  maximumBytes: number,
): Promise<unknown> {
  const declaredLength = Number(request.headers.get("content-length"));
  if (Number.isFinite(declaredLength) && declaredLength > maximumBytes) {
    throw new Error("body_too_large");
  }
  if (!request.body) return null;

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      totalBytes += value.byteLength;
      if (totalBytes > maximumBytes) {
        await reader.cancel("body_too_large");
        throw new Error("body_too_large");
      }
      chunks.push(value);
    }
  } finally {
    reader.releaseLock();
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  chunks.forEach((chunk) => {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  });

  try {
    return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(bytes));
  } catch {
    return null;
  }
}
