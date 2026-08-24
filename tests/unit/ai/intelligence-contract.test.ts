import { describe, expect, it } from "vitest";
import {
  validateAndCalibrateOwnerIntelligenceOutput,
  type IntelligenceEvidence,
} from "@/lib/ai/intelligence-contract";

const evidence: IntelligenceEvidence[] = [
  {
    sourceTable: "owner_request",
    sourceRecordId: "request-1",
    label: "Your instruction",
    excerpt: "Review labor exceptions.",
  },
  {
    sourceTable: "report_summary",
    sourceRecordId: "labor:2026-08-24T12:00:00Z",
    label: "Labor report",
    excerpt: "Exceptions: 2.",
  },
];

function output() {
  return {
    title: "Labor review",
    summary: "Two exceptions need review.",
    confidence: 0.99,
    citations: evidence.map((item) => ({ ...item, relevance: 1 })),
    proposal: null,
  };
}

describe("owner-intelligence evidence contract", () => {
  it("calibrates confidence deterministically without increasing it", () => {
    const calibrated = validateAndCalibrateOwnerIntelligenceOutput(
      output(),
      evidence,
    );
    expect(calibrated.confidence).toBe(0.79);
  });

  it("rejects fabricated, repeated, or rewritten citations", () => {
    expect(() =>
      validateAndCalibrateOwnerIntelligenceOutput(
        {
          ...output(),
          citations: [
            {
              ...output().citations[0],
              sourceRecordId: "not-authorized",
            },
          ],
        },
        evidence,
      ),
    ).toThrow(/outside the authorized context/);
    expect(() =>
      validateAndCalibrateOwnerIntelligenceOutput(
        { ...output(), citations: [output().citations[0], output().citations[0]] },
        evidence,
      ),
    ).toThrow(/repeated/);
    expect(() =>
      validateAndCalibrateOwnerIntelligenceOutput(
        {
          ...output(),
          citations: [{ ...output().citations[0], excerpt: "Changed fact." }],
        },
        evidence,
      ),
    ).toThrow(/changed the text/);
  });
});
