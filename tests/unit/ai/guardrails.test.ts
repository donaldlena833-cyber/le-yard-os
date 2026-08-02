import { describe, expect, it } from "vitest";
import { demoWorkspace } from "@/lib/demo";
import {
  canActorReadInsight,
  confidenceBand,
  guardedActionPolicy,
  validateCitations,
} from "@/lib/ai/guardrails";

const owner = {
  userId: demoWorkspace.people[0].id,
  organizationId: demoWorkspace.organizations[0].id,
  role: "owner" as const,
  membershipStatus: "active" as const,
  locationIds: demoWorkspace.locations.map((location) => location.id),
  organizationWide: true,
};

describe("AI guardrails", () => {
  it("requires evidence citations", () => {
    expect(validateCitations([])).toEqual({ valid: false, reason: "At least one source record is required." });
    expect(validateCitations(demoWorkspace.aiInsights[0].citations).valid).toBe(true);
  });

  it("never allows restricted actions to execute automatically", () => {
    expect(guardedActionPolicy("finalize_payroll")).toEqual({
      humanApprovalRequired: true,
      automaticExecutionAllowed: false,
    });
  });

  it("classifies confidence consistently", () => {
    expect(confidenceBand(0.91)).toBe("high");
    expect(confidenceBand(0.72)).toBe("medium");
    expect(confidenceBand(0.4)).toBe("low");
  });

  it("denies an insight from another tenant", () => {
    expect(canActorReadInsight(owner, demoWorkspace.aiInsights[0])).toBe(true);
    expect(canActorReadInsight({ ...owner, organizationId: "another-org" }, demoWorkspace.aiInsights[0])).toBe(false);
  });
});
