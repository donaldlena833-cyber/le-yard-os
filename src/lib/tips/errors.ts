import type { TipValidationIssue } from "./types";

export class TipPoolValidationError extends Error {
  readonly issues: TipValidationIssue[];

  constructor(issues: TipValidationIssue[]) {
    const summary = issues.map((issue) => `${issue.path}: ${issue.message}`).join("; ");
    super(`Tip pool validation failed: ${summary}`);
    this.name = "TipPoolValidationError";
    this.issues = issues;
  }
}

export class TipPoolLockedError extends Error {
  readonly runId: string;
  readonly status: string;

  constructor(runId: string, status: string) {
    super(`Tip pool run "${runId}" is ${status} and cannot be changed.`);
    this.name = "TipPoolLockedError";
    this.runId = runId;
    this.status = status;
  }
}

export class TipPoolExportError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TipPoolExportError";
  }
}
