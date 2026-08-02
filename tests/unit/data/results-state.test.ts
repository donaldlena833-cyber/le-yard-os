import { describe, expect, it } from "vitest";
import { z } from "zod";
import { WorkflowError } from "@/data/errors";
import {
  demoResult,
  errorResult,
  liveResult,
  validationResult,
} from "@/data/results";
import { canonicalJson, resolveTerminalReview } from "@/data/state";

describe("workflow results", () => {
  it("makes demo non-persistence explicit", () => {
    expect(demoResult("schedule.publish")).toEqual({
      ok: true,
      persisted: false,
      mode: "demo",
      operation: "schedule.publish",
      message: "Demo preview only. No data was written.",
    });
  });

  it("distinguishes live reads from live writes", () => {
    expect(liveResult({ count: 1 }, false)).toMatchObject({
      ok: true,
      persisted: false,
      mode: "live",
    });
    expect(liveResult({ id: "saved" })).toMatchObject({
      ok: true,
      persisted: true,
      mode: "live",
    });
  });

  it("returns field-level Zod failures", () => {
    const parsed = z.object({ name: z.string().min(2) }).safeParse({ name: "" });
    if (parsed.success) throw new Error("Expected validation to fail");
    expect(validationResult(parsed.error)).toMatchObject({
      ok: false,
      persisted: false,
      code: "validation",
      fieldErrors: { name: expect.any(Array) },
    });
  });

  it("does not leak unknown exception messages", () => {
    expect(errorResult(new Error("database connection secret"))).toEqual({
      ok: false,
      persisted: false,
      code: "database",
      message: "The request could not be completed. Try again.",
    });
  });
});

describe("terminal state and idempotency helpers", () => {
  it("treats a repeated terminal decision as already applied", () => {
    expect(resolveTerminalReview("approved", "approved")).toEqual({
      alreadyApplied: true,
    });
  });

  it("prevents reversing a terminal review", () => {
    expect(() => resolveTerminalReview("approved", "rejected")).toThrowError(
      WorkflowError,
    );
  });

  it("allows a pending review to advance", () => {
    expect(resolveTerminalReview("pending", "approved")).toEqual({
      alreadyApplied: false,
    });
  });

  it("canonicalizes object key order for retry comparison", () => {
    expect(canonicalJson({ b: 2, a: { d: 4, c: 3 } })).toBe(
      canonicalJson({ a: { c: 3, d: 4 }, b: 2 }),
    );
  });
});

