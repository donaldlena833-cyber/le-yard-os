import { createHash } from "node:crypto";
import {
  FixedWindowRateLimiter,
  type RateLimitDecision,
} from "@/lib/security/client-error-reporting";

interface PlaygroundLoginAttempt {
  identifier: string;
  vercelForwardedFor?: string | null;
  forwardedFor?: string | null;
}

function firstAddress(value: string | null | undefined): string | null {
  const first = value?.split(",")[0]?.trim();
  if (!first || first.length > 128 || /[\u0000-\u001f\u007f]/.test(first)) {
    return null;
  }
  return first;
}

function opaqueKey(scope: string, ...values: string[]): string {
  return createHash("sha256")
    .update([scope, ...values].join("\u0000"))
    .digest("hex");
}

/**
 * Per-instance hosted-playground login guard. Vercel may run more than one instance, so
 * this complements password hashing and platform controls rather than claiming
 * to be a distributed production rate limiter.
 */
export class PlaygroundLoginRateLimiter {
  private readonly addressLimiter: FixedWindowRateLimiter;
  private readonly credentialLimiter: FixedWindowRateLimiter;
  private readonly identifierLimiter: FixedWindowRateLimiter;

  constructor() {
    this.addressLimiter = new FixedWindowRateLimiter(20, 60_000, 10_000);
    this.credentialLimiter = new FixedWindowRateLimiter(
      8,
      15 * 60_000,
      10_000,
    );
    this.identifierLimiter = new FixedWindowRateLimiter(
      30,
      15 * 60_000,
      10_000,
    );
  }

  consume(
    attempt: PlaygroundLoginAttempt,
    now = Date.now(),
  ): RateLimitDecision {
    const address =
      firstAddress(attempt.vercelForwardedFor) ??
      firstAddress(attempt.forwardedFor) ??
      "unavailable";
    const identifier = attempt.identifier.normalize("NFKC").trim().toLowerCase();
    const addressDecision = this.addressLimiter.consume(
      opaqueKey("playground-login-address", address),
      now,
    );
    const credentialDecision = this.credentialLimiter.consume(
      opaqueKey("playground-login-pair", address, identifier),
      now,
    );
    const identifierDecision = this.identifierLimiter.consume(
      opaqueKey("playground-login-identifier", identifier),
      now,
    );

    if (
      addressDecision.allowed &&
      credentialDecision.allowed &&
      identifierDecision.allowed
    ) {
      return { allowed: true, retryAfterSeconds: 0 };
    }
    return {
      allowed: false,
      retryAfterSeconds: Math.max(
        addressDecision.retryAfterSeconds,
        credentialDecision.retryAfterSeconds,
        identifierDecision.retryAfterSeconds,
      ),
    };
  }
}
