import { existsSync } from "node:fs";
import { Codex } from "@openai/codex-sdk";

const codexPath = process.env.LE_YARD_CODEX_BINARY_PATH?.trim()
  || "/Applications/ChatGPT.app/Contents/Resources/codex";
if (!existsSync(codexPath)) {
  throw new Error("The official Codex subscription runtime is not installed.");
}

const schema = {
  type: "object",
  additionalProperties: false,
  required: ["title", "summary", "confidence", "citations", "proposal"],
  properties: {
    title: { type: "string" },
    summary: { type: "string" },
    confidence: { type: "number", minimum: 0, maximum: 1 },
    citations: {
      type: "array",
      minItems: 1,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["sourceTable", "sourceRecordId", "label", "excerpt", "relevance"],
        properties: {
          sourceTable: { type: "string" },
          sourceRecordId: { type: "string" },
          label: { type: "string" },
          excerpt: { type: "string" },
          relevance: { type: "number", minimum: 0, maximum: 1 },
        },
      },
    },
    proposal: {
      type: "object",
      additionalProperties: false,
      required: ["kind", "title", "description", "priority", "assignedEmployeeId", "dueAt"],
      properties: {
        kind: { type: "string", enum: ["task.create"] },
        title: { type: "string" },
        description: { type: ["string", "null"] },
        priority: { type: "string", enum: ["low", "normal", "high", "urgent"] },
        assignedEmployeeId: { type: "null" },
        dueAt: { type: "null" },
      },
    },
  },
};

const codex = new Codex({
  codexPathOverride: codexPath,
  config: { suppress_unstable_features_warning: true, features: { chronicle: false } },
});
const thread = codex.startThread({
  model: "gpt-5.6-luna",
  modelReasoningEffort: "low",
  sandboxMode: "read-only",
  workingDirectory: "/private/tmp",
  skipGitRepoCheck: true,
  networkAccessEnabled: false,
  webSearchMode: "disabled",
  approvalPolicy: "never",
});
const result = await thread.run(
  `Return a concise structured answer using only this evidence. Draft the requested task, but do not execute anything.
OWNER_QUESTION: Create a high-priority task to review tomorrow's pickup list.
EVIDENCE_JSON: [{"sourceTable":"owner_request","sourceRecordId":"subscription-smoke-test","label":"Your instruction","excerpt":"Create a high-priority task to review tomorrow's pickup list."}]`,
  { outputSchema: schema },
);
const blockedItem = result.items.find((item) =>
  ["command_execution", "file_change", "mcp_tool_call", "web_search"].includes(item.type),
);
if (blockedItem) throw new Error(`Codex attempted a blocked tool: ${blockedItem.type}`);
const output = JSON.parse(result.finalResponse);
if (
  output?.proposal?.kind !== "task.create"
  || output?.proposal?.priority !== "high"
  || output?.proposal?.assignedEmployeeId !== null
  || output?.citations?.[0]?.sourceRecordId !== "subscription-smoke-test"
) {
  throw new Error(`Codex returned an invalid owner proposal contract: ${result.finalResponse}`);
}
process.stdout.write(JSON.stringify({
  ok: true,
  model: "gpt-5.6-luna",
  auth: "ChatGPT subscription",
  sandbox: "read-only",
  proposalKind: output.proposal.kind,
  toolCalls: 0,
  usage: result.usage,
}) + "\n");
