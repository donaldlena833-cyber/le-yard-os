import { WorkflowError } from "./errors";

export type FinalReviewStatus = "approved" | "rejected";

/**
 * Prevents terminal review records from being reversed through the action layer.
 * Returns true when a retry already reached the requested terminal state.
 */
export function resolveTerminalReview(
  current: string,
  requested: FinalReviewStatus,
): { alreadyApplied: boolean } {
  if (current === requested) return { alreadyApplied: true };
  if (current === "approved" || current === "rejected") {
    throw new WorkflowError(
      "conflict",
      `This record is already ${current} and cannot be changed to ${requested}.`,
    );
  }
  return { alreadyApplied: false };
}

export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  if (value && typeof value === "object") {
    return `{${Object.entries(value)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, child]) => `${JSON.stringify(key)}:${canonicalJson(child)}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

