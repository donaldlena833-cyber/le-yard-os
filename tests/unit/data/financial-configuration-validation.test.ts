import { describe, expect, it } from "vitest";
import {
  configureRetentionPolicyInputSchema,
  configureTipPolicyInputSchema,
  saveTipPolicyDraftInputSchema,
} from "@/data/financial-configuration-schemas";

const ids = {
  request: "10000000-0000-4000-8000-000000000001",
  policy: "20000000-0000-4000-8000-000000000001",
  organization: "30000000-0000-4000-8000-000000000001",
  location: "40000000-0000-4000-8000-000000000001",
  version: "50000000-0000-4000-8000-000000000001",
  role: "60000000-0000-4000-8000-000000000001",
};

function validDraft() {
  return {
    requestId: ids.request,
    policyId: ids.policy,
    policyVersionId: ids.version,
    distributionMethod: "weighted_hours" as const,
    effectiveFrom: "2026-08-01",
    effectiveTo: null,
    closeoutSources: ["card_tips", "cash_tips"] as const,
    eligibilityRules: [
      {
        jobRoleId: ids.role,
        eligible: true,
        points: 1.25,
        minimumMinutes: 30,
      },
    ],
  };
}

describe("financial configuration validation", () => {
  it("accepts explicit policy metadata without supplying any operating defaults", () => {
    const parsed = configureTipPolicyInputSchema.parse({
      requestId: ids.request,
      policyId: ids.policy,
      organizationId: ids.organization,
      locationId: ids.location,
      name: "  Dinner pool  ",
      description: null,
      isActive: true,
    });
    expect(parsed.name).toBe("Dinner pool");
    expect(parsed.description).toBeNull();
  });

  it("accepts a complete weighted-hours draft", () => {
    expect(saveTipPolicyDraftInputSchema.safeParse(validDraft()).success).toBe(true);
  });

  it.each([
    ["duplicate source", { closeoutSources: ["card_tips", "card_tips"] }],
    ["no eligible role", { eligibilityRules: [{ jobRoleId: ids.role, eligible: false, points: 0, minimumMinutes: 0 }] }],
    ["backward dates", { effectiveTo: "2026-07-31" }],
  ])("rejects %s", (_label, override) => {
    expect(
      saveTipPolicyDraftInputSchema.safeParse({ ...validDraft(), ...override }).success,
    ).toBe(false);
  });

  it("requires neutral weights for an hours-only policy", () => {
    expect(
      saveTipPolicyDraftInputSchema.safeParse({
        ...validDraft(),
        distributionMethod: "hours",
      }).success,
    ).toBe(false);
    expect(
      saveTipPolicyDraftInputSchema.safeParse({
        ...validDraft(),
        distributionMethod: "hours",
        eligibilityRules: [
          {
            jobRoleId: ids.role,
            eligible: true,
            points: 1,
            minimumMinutes: 30,
          },
        ],
      }).success,
    ).toBe(true);
  });

  it("records either a bounded window or an explicit no-auto-delete decision", () => {
    const base = {
      requestId: ids.request,
      policyId: ids.policy,
      organizationId: ids.organization,
      dataClass: "receipts_invoices",
      legalHold: false,
      notes: null,
    };
    expect(
      configureRetentionPolicyInputSchema.safeParse({
        ...base,
        retentionDays: 2_555,
      }).success,
    ).toBe(true);
    expect(
      configureRetentionPolicyInputSchema.safeParse({
        ...base,
        retentionDays: null,
      }).success,
    ).toBe(true);
    expect(
      configureRetentionPolicyInputSchema.safeParse({
        ...base,
        dataClass: "Receipts / invoices",
        retentionDays: 0,
      }).success,
    ).toBe(false);
  });
});
