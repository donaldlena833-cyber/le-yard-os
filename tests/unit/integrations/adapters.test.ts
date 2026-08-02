import { describe, expect, it } from "vitest";
import {
  retryDelayMinutes,
  sanitizeIntegrationError,
} from "@/lib/integrations/adapters";

describe("integration adapter safety", () => {
  it.each([
    ["token=abc123", "token=[redacted]"],
    ['provider said {"token":"abc123"}', 'provider said {"token=[redacted]"}'],
    ["Authorization: Bearer eyJ.secret.signature", "Authorization: Bearer [redacted]"],
    ["api_key:super-secret", "api_key=[redacted]"],
    ["refresh_token=refresh-value", "refresh_token=[redacted]"],
  ])("redacts credential-like provider errors", (input, expected) => {
    expect(sanitizeIntegrationError(input)).toBe(expected);
  });

  it("bounds retry delay and browser-visible error length", () => {
    expect(retryDelayMinutes(-10)).toBe(5);
    expect(retryDelayMinutes(100)).toBe(720);
    expect(sanitizeIntegrationError("x".repeat(900))).toHaveLength(500);
  });
});
