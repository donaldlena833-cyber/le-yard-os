import { describe, expect, it } from "vitest";
import {
  REMEMBERED_SESSION_TTL_SECONDS,
  STANDARD_SESSION_TTL_SECONDS,
  sessionDeadlineValue,
  sessionSecondsRemaining,
  sessionTtlSeconds,
} from "@/lib/auth/session-duration";

describe("connected session duration", () => {
  it("uses an 8-hour default and an explicit 30-day remembered window", () => {
    expect(sessionTtlSeconds(false)).toBe(STANDARD_SESSION_TTL_SECONDS);
    expect(sessionTtlSeconds(true)).toBe(REMEMBERED_SESSION_TTL_SECONDS);
  });

  it("tracks an absolute deadline without extending it during refresh", () => {
    const now = 2_000_000_000_000;
    const deadline = sessionDeadlineValue(STANDARD_SESSION_TTL_SECONDS, now);
    expect(sessionSecondsRemaining(deadline, now)).toBe(
      STANDARD_SESSION_TTL_SECONDS,
    );
    expect(sessionSecondsRemaining(deadline, now + 60_000)).toBe(
      STANDARD_SESSION_TTL_SECONDS - 60,
    );
  });

  it("fails closed for missing, expired, malformed, or overlong deadlines", () => {
    const now = 2_000_000_000_000;
    expect(sessionSecondsRemaining(undefined, now)).toBeNull();
    expect(sessionSecondsRemaining("not-a-deadline", now)).toBeNull();
    expect(sessionSecondsRemaining(String(now / 1_000 - 1), now)).toBeNull();
    expect(
      sessionSecondsRemaining(
        String(now / 1_000 + REMEMBERED_SESSION_TTL_SECONDS + 1),
        now,
      ),
    ).toBeNull();
  });
});
