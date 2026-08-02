import { describe, expect, it } from "vitest";
import { buildContentSecurityPolicy } from "@/lib/security/content-security-policy";

describe("content security policy", () => {
  it("creates a strict production policy around a request nonce", () => {
    const policy = buildContentSecurityPolicy({ nonce: "safe-nonce_123=" });

    expect(policy).toContain("script-src 'self' 'nonce-safe-nonce_123=' 'strict-dynamic'");
    expect(policy).toContain("script-src-attr 'none'");
    expect(policy).toContain("style-src 'self' 'nonce-safe-nonce_123='");
    expect(policy).toContain("object-src 'none'");
    expect(policy).toContain("frame-src 'none'");
    expect(policy).toContain("frame-ancestors 'none'");
    expect(policy).toContain("upgrade-insecure-requests");
    expect(policy).not.toContain("'unsafe-eval'");
    expect(policy).not.toContain("script-src 'self' 'unsafe-inline'");
  });

  it("allows only the configured Supabase HTTP and WebSocket origins", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "abc123",
      supabaseUrl: "https://tenant.supabase.co/rest/v1",
    });

    expect(policy).toContain("https://tenant.supabase.co");
    expect(policy).toContain("wss://tenant.supabase.co");
    expect(policy).not.toContain("/rest/v1");
  });

  it("adds the development evaluator without forcing HTTPS locally", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "abc123",
      development: true,
      supabaseUrl: "http://127.0.0.1:54321",
    });

    expect(policy).toContain("'unsafe-eval'");
    expect(policy).toContain("style-src 'self' 'unsafe-inline'");
    expect(policy).not.toContain("style-src 'self' 'nonce-abc123'");
    expect(policy).toContain("http://127.0.0.1:54321");
    expect(policy).toContain("ws://127.0.0.1:54321");
    expect(policy).not.toContain("upgrade-insecure-requests");
  });

  it("rejects a nonce that could append another directive", () => {
    expect(() =>
      buildContentSecurityPolicy({ nonce: "abc'; img-src *" }),
    ).toThrow("CSP nonce contains invalid characters.");
  });

  it("ignores non-HTTP external URLs", () => {
    const policy = buildContentSecurityPolicy({
      nonce: "abc123",
      supabaseUrl: "javascript:alert(1)",
    });

    expect(policy).not.toContain("javascript:");
  });
});
