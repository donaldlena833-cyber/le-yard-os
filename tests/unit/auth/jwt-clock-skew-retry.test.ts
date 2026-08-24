import { describe, expect, it, vi } from "vitest";
import {
  isJwtIssuedAtFutureError,
  retryJwtIssuedAtFuture,
} from "@/lib/auth/jwt-clock-skew-retry";

describe("JWT clock-skew recovery", () => {
  it("recognizes only the transient PostgREST future-token rejection", () => {
    expect(isJwtIssuedAtFutureError({ message: "JWT issued at future" })).toBe(true);
    expect(isJwtIssuedAtFutureError({ message: "jwt ISSUED at FUTURE" })).toBe(true);
    expect(isJwtIssuedAtFutureError({ message: "permission denied" })).toBe(false);
    expect(isJwtIssuedAtFutureError(null)).toBe(false);
  });

  it("waits once and retries the exact transient rejection", async () => {
    const operation = vi
      .fn()
      .mockResolvedValueOnce({ data: null, error: { message: "JWT issued at future" } })
      .mockResolvedValueOnce({ data: [{ id: "membership" }], error: null });
    const onRetry = vi.fn();

    const result = await retryJwtIssuedAtFuture(operation, {
      delayMs: 0,
      onRetry,
    });

    expect(result).toEqual({ data: [{ id: "membership" }], error: null });
    expect(operation).toHaveBeenCalledTimes(2);
    expect(onRetry).toHaveBeenCalledTimes(1);
  });

  it("does not retry authorization or data failures", async () => {
    const result = { data: null, error: { message: "permission denied" } };
    const operation = vi.fn().mockResolvedValue(result);

    await expect(
      retryJwtIssuedAtFuture(operation, { delayMs: 0 }),
    ).resolves.toBe(result);
    expect(operation).toHaveBeenCalledTimes(1);
  });

  it("stops after one retry when the skew rejection persists", async () => {
    const result = { data: null, error: { message: "JWT issued at future" } };
    const operation = vi.fn().mockResolvedValue(result);

    await expect(
      retryJwtIssuedAtFuture(operation, { delayMs: 0 }),
    ).resolves.toBe(result);
    expect(operation).toHaveBeenCalledTimes(2);
  });
});
