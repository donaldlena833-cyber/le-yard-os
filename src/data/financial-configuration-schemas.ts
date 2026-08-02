import { z } from "zod";

const uuid = z.string().uuid();
const isoDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Use an ISO date in YYYY-MM-DD format.")
  .refine(
    (value) => !Number.isNaN(Date.parse(`${value}T00:00:00Z`)),
    "Invalid date.",
  );
const optionalText = (maximum: number) =>
  z.string().trim().max(maximum).nullable().optional();

export const configureTipPolicyInputSchema = z
  .object({
    requestId: uuid,
    policyId: uuid,
    organizationId: uuid,
    locationId: uuid.nullable(),
    name: z.string().trim().min(1).max(120),
    description: optionalText(2_000),
    isActive: z.boolean(),
  })
  .strict();

export const saveTipPolicyDraftInputSchema = z
  .object({
    requestId: uuid,
    policyId: uuid,
    policyVersionId: uuid,
    distributionMethod: z.enum(["hours", "weighted_hours"]),
    effectiveFrom: isoDate,
    effectiveTo: isoDate.nullable(),
    closeoutSources: z
      .array(z.enum(["card_tips", "cash_tips", "service_charges"]))
      .min(1)
      .max(3),
    eligibilityRules: z
      .array(
        z
          .object({
            jobRoleId: uuid,
            eligible: z.boolean(),
            points: z.number().finite().min(0).max(1_000),
            minimumMinutes: z.number().int().min(0).max(1_440),
          })
          .strict(),
      )
      .min(1)
      .max(200),
  })
  .strict()
  .superRefine((value, context) => {
    if (value.effectiveTo && value.effectiveTo < value.effectiveFrom) {
      context.addIssue({
        code: "custom",
        path: ["effectiveTo"],
        message: "The end date cannot be before the start date.",
      });
    }
    if (new Set(value.closeoutSources).size !== value.closeoutSources.length) {
      context.addIssue({
        code: "custom",
        path: ["closeoutSources"],
        message: "Each closeout source may appear only once.",
      });
    }
    const roleIds = value.eligibilityRules.map((rule) => rule.jobRoleId);
    if (new Set(roleIds).size !== roleIds.length) {
      context.addIssue({
        code: "custom",
        path: ["eligibilityRules"],
        message: "Each job role may appear only once.",
      });
    }
    if (!value.eligibilityRules.some((rule) => rule.eligible)) {
      context.addIssue({
        code: "custom",
        path: ["eligibilityRules"],
        message: "At least one job role must be eligible.",
      });
    }
    for (const [index, rule] of value.eligibilityRules.entries()) {
      if (value.distributionMethod === "hours" && rule.points !== 1) {
        context.addIssue({
          code: "custom",
          path: ["eligibilityRules", index, "points"],
          message: "Hours-based policies use a weight of 1.",
        });
      }
      if (
        value.distributionMethod === "weighted_hours" &&
        rule.eligible &&
        rule.points <= 0
      ) {
        context.addIssue({
          code: "custom",
          path: ["eligibilityRules", index, "points"],
          message: "Eligible weighted roles need a positive weight.",
        });
      }
    }
  });

export const approveTipPolicyVersionInputSchema = z
  .object({ requestId: uuid, policyVersionId: uuid })
  .strict();

export const configureRetentionPolicyInputSchema = z
  .object({
    requestId: uuid,
    policyId: uuid,
    organizationId: uuid,
    dataClass: z
      .string()
      .trim()
      .toLowerCase()
      .regex(/^[a-z][a-z0-9_]{1,79}$/),
    retentionDays: z.number().int().min(1).max(36_500).nullable(),
    legalHold: z.boolean(),
    notes: optionalText(2_000),
  })
  .strict();

export type ConfigureTipPolicyInput = z.infer<
  typeof configureTipPolicyInputSchema
>;
export type SaveTipPolicyDraftInput = z.infer<
  typeof saveTipPolicyDraftInputSchema
>;
export type ApproveTipPolicyVersionInput = z.infer<
  typeof approveTipPolicyVersionInputSchema
>;
export type ConfigureRetentionPolicyInput = z.infer<
  typeof configureRetentionPolicyInputSchema
>;
