import type {
  AICitation,
  AIInsight,
  AIRestrictedAction,
  EntityId,
} from "@/types";
import type { PermissionActor } from "@/lib/permissions";
import { isAllowed, requiresHumanApproval } from "@/lib/permissions";

export type ConfidenceBand = "high" | "medium" | "low";

export function confidenceBand(confidence: number): ConfidenceBand {
  if (confidence >= 0.9) return "high";
  if (confidence >= 0.7) return "medium";
  return "low";
}

export function canActorReadInsight(actor: PermissionActor, insight: AIInsight): boolean {
  if (!isAllowed(actor, "ai.use", { organizationId: insight.organizationId })) return false;
  return (
    actor.organizationWide ||
    insight.locationIds.length === 0 ||
    insight.locationIds.every((locationId) => actor.locationIds.includes(locationId))
  );
}

export function validateCitations(citations: readonly AICitation[]): {
  valid: boolean;
  reason: string | null;
} {
  if (citations.length === 0) return { valid: false, reason: "At least one source record is required." };
  const missingIdentity = citations.some(
    (citation) => !citation.entityId || !citation.entityType || !citation.label || !citation.occurredAt,
  );
  return missingIdentity
    ? { valid: false, reason: "Every citation must identify a source record and timestamp." }
    : { valid: true, reason: null };
}

export function guardedActionPolicy(action: AIRestrictedAction | null) {
  if (!action) {
    return {
      humanApprovalRequired: false,
      automaticExecutionAllowed: false,
    } as const;
  }
  return {
    humanApprovalRequired: requiresHumanApproval(action),
    automaticExecutionAllowed: false,
  } as const;
}

export type OperationsAnswer = {
  id: EntityId;
  title: string;
  summary: string;
  confidence: number;
  citations: AICitation[];
  proposedAction: AIRestrictedAction | null;
  sourceMode: "deterministic_demo" | "tenant_records";
};
