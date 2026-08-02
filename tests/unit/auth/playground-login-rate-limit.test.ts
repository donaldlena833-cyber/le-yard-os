import { describe, expect, it } from "vitest";
import { PlaygroundLoginRateLimiter } from "@/lib/auth/playground-login-rate-limit";

describe("playground login rate limit", () => {
  it("limits repeated guesses for one address and identifier", () => {
    const limiter = new PlaygroundLoginRateLimiter();
    const attempt = {
      identifier: "Owner-One",
      vercelForwardedFor: "203.0.113.9",
    };

    for (let index = 0; index < 8; index += 1) {
      expect(limiter.consume(attempt, 1_000).allowed).toBe(true);
    }
    const blocked = limiter.consume(attempt, 1_000);
    expect(blocked.allowed).toBe(false);
    expect(blocked.retryAfterSeconds).toBe(900);
  });

  it("normalizes usernames but separates distinct network addresses", () => {
    const limiter = new PlaygroundLoginRateLimiter();

    for (let index = 0; index < 8; index += 1) {
      limiter.consume(
        { identifier: " OWNER-ONE ", vercelForwardedFor: "203.0.113.9" },
        1_000,
      );
    }
    expect(
      limiter.consume(
        { identifier: "owner-one", vercelForwardedFor: "203.0.113.9" },
        1_000,
      ).allowed,
    ).toBe(false);
    expect(
      limiter.consume(
        { identifier: "owner-one", vercelForwardedFor: "203.0.113.10" },
        1_000,
      ).allowed,
    ).toBe(true);
  });

  it("caps one identifier across changing addresses on the same instance", () => {
    const limiter = new PlaygroundLoginRateLimiter();
    for (let index = 0; index < 30; index += 1) {
      expect(
        limiter.consume(
          {
            identifier: "owner-one",
            vercelForwardedFor: `203.0.113.${index + 1}`,
          },
          1_000,
        ).allowed,
      ).toBe(true);
    }
    expect(
      limiter.consume(
        {
          identifier: "owner-one",
          vercelForwardedFor: "198.51.100.90",
        },
        1_000,
      ).allowed,
    ).toBe(false);
  });
});
