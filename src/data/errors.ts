import type { WorkflowErrorCode } from "./types";

interface SupabaseErrorLike {
  code?: string;
  message?: string;
}

export class WorkflowError extends Error {
  constructor(
    public readonly code: WorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

export function isUniqueViolation(error: unknown): boolean {
  return isSupabaseError(error) && error.code === "23505";
}

export function throwDatabaseError(
  error: unknown,
  fallbackMessage = "The request could not be completed.",
): never {
  if (error instanceof WorkflowError) throw error;

  if (isSupabaseError(error)) {
    if (error.code === "42501") {
      throw new WorkflowError("forbidden", "You do not have access to perform this action.");
    }

    if (error.code === "P0002" || error.code === "PGRST116") {
      throw new WorkflowError("not_found", "The requested record was not found.");
    }

    if (error.code === "23505") {
      throw new WorkflowError("conflict", "This request conflicts with an existing record.");
    }

    if (error.code === "23514" || error.code === "22023") {
      throw new WorkflowError("conflict", error.message || fallbackMessage);
    }
  }

  throw new WorkflowError("database", fallbackMessage);
}

export function assertFound<T>(value: T | null | undefined, message: string): T {
  if (value == null) throw new WorkflowError("not_found", message);
  return value;
}

export function assertCondition(
  condition: unknown,
  code: WorkflowErrorCode,
  message: string,
): asserts condition {
  if (!condition) throw new WorkflowError(code, message);
}

function isSupabaseError(error: unknown): error is SupabaseErrorLike {
  return typeof error === "object" && error !== null;
}

