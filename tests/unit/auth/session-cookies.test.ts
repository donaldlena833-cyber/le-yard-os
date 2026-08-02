import { describe, expect, it } from "vitest";
import { isSupabaseAuthCookieName } from "@/lib/auth/session-cookies";

describe("Supabase auth cookie detection", () => {
  it.each([
    "sb-projectref-auth-token",
    "sb-project-ref-auth-token.0",
    "sb-project-ref-auth-token.12",
    "sb-projectref-auth-token-code-verifier",
  ])("recognizes %s", (name) => {
    expect(isSupabaseAuthCookieName(name)).toBe(true);
  });

  it.each([
    "session",
    "sb-projectref-preferences",
    "other-auth-token",
    "sb-../../-auth-token",
    "sb-projectref-auth-token.attacker",
  ])("does not delete unrelated cookie %s", (name) => {
    expect(isSupabaseAuthCookieName(name)).toBe(false);
  });
});
