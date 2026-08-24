import { z } from "zod";

export const intelligenceEvidenceSchema = z.object({
  sourceTable: z.string().trim().min(1).max(120),
  sourceRecordId: z.string().trim().min(1).max(240),
  label: z.string().trim().min(1).max(240),
  excerpt: z.string().trim().min(1).max(2_000),
}).strict();

export const intelligenceCitationSchema = intelligenceEvidenceSchema.extend({
  relevance: z.number().min(0).max(1),
}).strict();

export const intelligenceTaskProposalSchema = z.object({
  kind: z.literal("task.create"),
  title: z.string().trim().min(1).max(240),
  description: z.string().trim().max(10_000).nullable(),
  priority: z.enum(["low", "normal", "high", "urgent"]),
  assignedEmployeeId: z.null(),
  dueAt: z.iso.datetime({ offset: true }).nullable(),
}).strict();

export const ownerIntelligenceOutputSchema = z.object({
  title: z.string().trim().min(1).max(160),
  summary: z.string().trim().min(1).max(4_000),
  confidence: z.number().min(0).max(1),
  citations: z.array(intelligenceCitationSchema).min(1).max(8),
  proposal: intelligenceTaskProposalSchema.nullable(),
}).strict();

export type IntelligenceEvidence = z.infer<typeof intelligenceEvidenceSchema>;
export type OwnerIntelligenceOutput = z.infer<typeof ownerIntelligenceOutputSchema>;
export type IntelligenceTaskProposal = z.infer<typeof intelligenceTaskProposalSchema>;

function evidenceKey(evidence: IntelligenceEvidence) {
  return `${evidence.sourceTable}\u0000${evidence.sourceRecordId}`;
}

/**
 * Enforces that every citation is an exact extract from the authorized input
 * envelope, then caps provider confidence using a deterministic evidence rule.
 * Confidence is never increased above the provider's own estimate.
 */
export function validateAndCalibrateOwnerIntelligenceOutput(
  value: unknown,
  evidence: readonly IntelligenceEvidence[],
): OwnerIntelligenceOutput {
  const output = ownerIntelligenceOutputSchema.parse(value);
  const allowed = new Map(evidence.map((item) => [evidenceKey(item), item]));
  const seen = new Set<string>();
  for (const citation of output.citations) {
    const key = evidenceKey(citation);
    const source = allowed.get(key);
    if (!source) {
      throw new Error(
        "The intelligence response cited evidence outside the authorized context.",
      );
    }
    if (seen.has(key)) {
      throw new Error("The intelligence response repeated a citation.");
    }
    if (citation.label !== source.label || citation.excerpt !== source.excerpt) {
      throw new Error(
        "The intelligence response changed the text of an authorized citation.",
      );
    }
    seen.add(key);
  }
  const operationalCitationCount = output.citations.filter(
    (citation) => citation.sourceTable !== "owner_request",
  ).length;
  const hasReportSummary = output.citations.some(
    (citation) => citation.sourceTable === "report_summary",
  );
  const confidenceCeiling = Math.min(
    0.95,
    0.65 + Math.min(operationalCitationCount, 3) * 0.08 +
      (hasReportSummary ? 0.06 : 0),
  );
  return {
    ...output,
    confidence: Math.round(Math.min(output.confidence, confidenceCeiling) * 100) / 100,
  };
}

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
