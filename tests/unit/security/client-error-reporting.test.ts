import { describe, expect, it } from "vitest";
import {
  clientErrorFingerprint,
  FixedWindowRateLimiter,
  GENERIC_CLIENT_ERROR_MESSAGE,
  readBoundedJson,
  sanitizeClientErrorDigest,
} from "@/lib/security/client-error-reporting";

describe("client error reporting", () => {
  it("keeps only a constrained framework digest", () => {
    expect(sanitizeClientErrorDigest(" 123456789 ")).toBe("123456789");
    expect(sanitizeClientErrorDigest("safe_digest-1")).toBe("safe_digest-1");
    expect(sanitizeClientErrorDigest("database password=secret")).toBeNull();
    expect(sanitizeClientErrorDigest("<script>alert(1)</script>")).toBeNull();
  });

  it("uses a stable one-way fingerprint and a generic stored message", () => {
    expect(GENERIC_CLIENT_ERROR_MESSAGE).toBe("Workspace error boundary event");
    expect(clientErrorFingerprint("digest-1")).toMatch(/^[a-f0-9]{32}$/);
    expect(clientErrorFingerprint("digest-1")).toBe(
      clientErrorFingerprint("digest-1"),
    );
    expect(clientErrorFingerprint("digest-1")).not.toBe(
      clientErrorFingerprint("digest-2"),
    );
  });

  it("limits repeated writes and opens a new fixed window", () => {
    const limiter = new FixedWindowRateLimiter(2, 1_000);
    expect(limiter.consume("actor", 1_000)).toEqual({
      allowed: true,
      retryAfterSeconds: 0,
    });
    expect(limiter.consume("actor", 1_100).allowed).toBe(true);
    expect(limiter.consume("actor", 1_200)).toEqual({
      allowed: false,
      retryAfterSeconds: 1,
    });
    expect(limiter.consume("actor", 2_000).allowed).toBe(true);
  });

  it("stops reading an undeclared body at the byte ceiling", async () => {
    const oversized = new Request("https://ops.example/api/client-errors", {
      method: "POST",
      body: JSON.stringify({ digest: "x".repeat(2_000) }),
    });
    await expect(readBoundedJson(oversized, 512)).rejects.toThrow(
      "body_too_large",
    );
  });

  it("decodes a bounded JSON body", async () => {
    const request = new Request("https://ops.example/api/client-errors", {
      method: "POST",
      body: JSON.stringify({ digest: "safe_digest-1" }),
    });
    await expect(readBoundedJson(request, 512)).resolves.toEqual({
      digest: "safe_digest-1",
    });
  });
});
