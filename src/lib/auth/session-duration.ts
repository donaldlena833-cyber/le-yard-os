export const STANDARD_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const REMEMBERED_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const CONNECTED_SESSION_DEADLINE_COOKIE =
  "__Host-le-yard-session-deadline";

export function sessionTtlSeconds(rememberFor30Days: boolean): number {
  return rememberFor30Days
    ? REMEMBERED_SESSION_TTL_SECONDS
    : STANDARD_SESSION_TTL_SECONDS;
}

export function sessionDeadlineValue(
  ttlSeconds: number,
  now = Date.now(),
): string {
  return String(Math.floor(now / 1_000) + ttlSeconds);
}

export function sessionSecondsRemaining(
  value: string | undefined,
  now = Date.now(),
): number | null {
  if (!value || !/^\d{10}$/.test(value)) return null;
  const deadline = Number(value);
  const current = Math.floor(now / 1_000);
  const remaining = deadline - current;
  if (
    !Number.isSafeInteger(deadline) ||
    remaining <= 0 ||
    remaining > REMEMBERED_SESSION_TTL_SECONDS
  ) {
    return null;
  }
  return remaining;
}

export function connectedSessionCookieOptions(ttlSeconds: number) {
  return {
    httpOnly: true,
    secure: true,
    sameSite: "lax" as const,
    path: "/",
    maxAge: ttlSeconds,
    priority: "high" as const,
  };
}
