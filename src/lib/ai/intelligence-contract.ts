import { z } from "zod";

export const intelligenceEvidenceSchema = z.object({
  sourceTable: z.string().trim().min(1).max(120),
  sourceRecordId: z.string().trim().min(1).max(240),
  label: z.string().trim().min(1).max(240),
  excerpt: z.string().trim().min(1).max(2_000),
});

export const intelligenceCitationSchema = intelligenceEvidenceSchema.extend({
  relevance: z.number().min(0).max(1),
});

export const intelligenceTaskProposalSchema = z.object({
  kind: z.literal("task.create"),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(10_000).nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  assignedEmployeeId: z.null(),
  dueAt: z.iso.datetime({ offset: true }).nullable(),
});

export const ownerIntelligenceOutputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(4_000),
  confidence: z.number().min(0).max(1),
  citations: z.array(intelligenceCitationSchema).min(1).max(8),
  proposal: intelligenceTaskProposalSchema.nullable(),
});

export type IntelligenceEvidence = z.infer<typeof intelligenceEvidenceSchema>;
export type OwnerIntelligenceOutput = z.infer<typeof ownerIntelligenceOutputSchema>;
export type IntelligenceTaskProposal = z.infer<typeof intelligenceTaskProposalSchema>;

export const ownerIntelligenceJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "confidence", "citations", "proposal"],
  properties: {
    title: { type: "string", minLength: 1, maxLength: 160 },
    summary: { type: "string", minLength: 1, maxLength: 4_000 },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    citations: {
      type: "array",
      minItems: 1,
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceTable", "sourceRecordId", "label", "excerpt", "relevance"],
        properties: {
          sourceTable: { type: "string", minLength: 1, maxLength: 120 },
          sourceRecordId: { type: "string", minLength: 1, maxLength: 240 },
          label: { type: "string", minLength: 1, maxLength: 240 },
          excerpt: { type: "string", minLength: 1, maxLength: 2_000 },
          relevance: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    proposal: {
      anyOf: [
        { type: "null" },
        {
          type: "object",
          additionalProperties: false,
          required: ["kind", "title", "description", "priority", "assignedEmployeeId", "dueAt"],
          properties: {
            kind: { type: "string", enum: ["task.create"] },
            title: { type: "string", minLength: 1, maxLength: 240 },
            description: { anyOf: [{ type: "string", maxLength: 10_000 }, { type: "null" }] },
            priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
            assignedEmployeeId: { type: "null" },
            dueAt: {
              anyOf: [
                { type: "string", format: "date-time" },
                { type: "null" },
              ],
            },
          },
        },
      ],
    },
  },
} as const;

export type IntelligenceProposalEnvelope = {
  id: string;
  confirmationFingerprint: string;
  change: IntelligenceTaskProposal & { locationId: string };
  status: "pending" | "applied" | "reverted";
  taskId: string | null;
};

export type OwnerIntelligenceAnswer = Omit<OwnerIntelligenceOutput, "proposal"> & {
  runId: string;
  proposal: IntelligenceProposalEnvelope | null;
  model: string;
  sourceMode: "codex_subscription" | "sub2api_subscription";
};
