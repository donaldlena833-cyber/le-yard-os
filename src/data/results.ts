import type { ZodError } from "zod";
import { WorkflowError } from "./errors";
import type { WorkflowActionResult } from "./types";

export function demoResult<T>(operation: string): WorkflowActionResult<T> {
  return {
    ok: true,
    persisted: false,
    mode: "demo",
    operation,
    message: "Demo preview only. No data was written.",
  };
}

export function liveResult<T>(
  data: T,
  persisted = true,
): WorkflowActionResult<T> {
  return { ok: true, persisted, mode: "live", data };
}

export function validationResult<T>(error: ZodError): WorkflowActionResult<T> {
  const flattened = error.flatten();
  const fieldErrors: Record<string, string[]> = {};

  for (const [field, messages] of Object.entries(
    flattened.fieldErrors as Record<string, string[] | undefined>,
  )) {
    if (messages?.length) fieldErrors[field] = messages;
  }

  return {
    ok: false,
    persisted: false,
    code: "validation",
    message: "Check the highlighted fields and try again.",
    fieldErrors,
  };
}

export function errorResult<T>(error: unknown): WorkflowActionResult<T> {
  if (error instanceof WorkflowError) {
    return {
      ok: false,
      persisted: false,
      code: error.code,
      message: error.message,
    };
  }

  return {
    ok: false,
    persisted: false,
    code: "database",
    message: "The request could not be completed. Try again.",
  };
}
