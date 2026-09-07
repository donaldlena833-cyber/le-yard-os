import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import {
  sha256,
  validateConnectedPreviewOrigin,
} from "./verify-connected-release-workflow-inputs.mjs";

export const CONNECTED_RELEASE_ROLE_MATRIX = [
  "Owner",
  "Manager",
  "Host",
  "ViewOnly",
  "OperateOnly",
  "Denied",
  "Expired",
  "CrossLocation",
];

const evidenceSchema = "le-yard-connected-acceptance-evidence-v1";
const attestationProtocol = "le-yard-connected-acceptance-v1";
const attestationSchemaFloor = "20260811091453";
const commitPattern = /^[0-9a-f]{40}$/;
const schemaVersionPattern = /^[0-9]{14}$/;
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const fixtureRevisionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const runNumberPattern = /^[1-9][0-9]*$/;
const allowedOutcomes = new Set([
  "success",
  "failure",
  "cancelled",
  "skipped",
  "not_run",
]);

function requiredString(value, name) {
  if (typeof value !== "string" || !value)
    throw new Error(`${name} is required.`);
  return value;
}

export function createConnectedAcceptanceEvidence(input) {
  const previewOrigin = validateConnectedPreviewOrigin(
    requiredString(input.previewOrigin, "previewOrigin"),
  );
  const sourceCommit = requiredString(input.sourceCommit, "sourceCommit");
  const schemaMigrationHead = requiredString(
    input.schemaMigrationHead,
    "schemaMigrationHead",
  );
  const targetId = requiredString(input.targetId, "targetId").toLowerCase();
  const fixtureId = requiredString(input.fixtureId, "fixtureId").toLowerCase();
  const fixtureRevision = requiredString(
    input.fixtureRevision,
    "fixtureRevision",
  );
  const outcome = requiredString(input.outcome, "outcome");
  const workflowRunId = requiredString(input.workflowRunId, "workflowRunId");
  const workflowRunAttempt = requiredString(
    input.workflowRunAttempt,
    "workflowRunAttempt",
  );
  const recordedAt = requiredString(input.recordedAt, "recordedAt");

  if (!commitPattern.test(sourceCommit))
    throw new Error("sourceCommit must be a lowercase 40-character Git SHA.");
  if (
    !schemaVersionPattern.test(schemaMigrationHead) ||
    schemaMigrationHead < attestationSchemaFloor
  )
    throw new Error("schemaMigrationHead must be an accepted 14-digit migration head.");
  if (!uuidPattern.test(targetId) || !uuidPattern.test(fixtureId))
    throw new Error("Target and fixture IDs must be UUIDs.");
  if (!fixtureRevisionPattern.test(fixtureRevision))
    throw new Error("fixtureRevision has an invalid format.");
  if (!allowedOutcomes.has(outcome))
    throw new Error("outcome is not a recognized GitHub step outcome.");
  if (
    !runNumberPattern.test(workflowRunId) ||
    !runNumberPattern.test(workflowRunAttempt)
  )
    throw new Error("Workflow run identifiers must be positive integers.");
  const recordedAtMilliseconds = new Date(recordedAt).valueOf();
  if (!Number.isFinite(recordedAtMilliseconds))
    throw new Error("recordedAt must be an ISO timestamp.");

  return {
    evidenceSchema,
    acceptanceMode: "release-acceptance",
    outcome,
    allReleaseAcceptanceChecksPassed: outcome === "success",
    sourceCommit,
    schemaMigrationHead,
    previewDeploymentBindingSha256: sha256(
      JSON.stringify([previewOrigin, sourceCommit]),
    ),
    databaseFixtureBindingSha256: sha256(
      JSON.stringify([
        schemaMigrationHead,
        targetId,
        fixtureId,
        fixtureRevision,
      ]),
    ),
    requiredRoleMatrix: [...CONNECTED_RELEASE_ROLE_MATRIX],
    executionContract: {
      attestationProtocol,
      attestationSchemaFloor,
      readOnlyBrowserMatrix: true,
      connectedSoakSessions: 14,
      authoritativeRefreshP95BudgetMs: 3000,
      mutationProbeEnabled: false,
      developerSmokeEvidence: false,
    },
    workflowRun: {
      id: workflowRunId,
      attempt: workflowRunAttempt,
    },
    recordedAt: new Date(recordedAtMilliseconds).toISOString(),
  };
}

function runCli() {
  const outputPath = resolve(
    requiredString(process.argv[2], "output path"),
  );
  const evidence = createConnectedAcceptanceEvidence({
    previewOrigin: process.env.EVIDENCE_PREVIEW_ORIGIN,
    sourceCommit: process.env.EVIDENCE_SOURCE_COMMIT,
    schemaMigrationHead: process.env.EVIDENCE_SCHEMA_MIGRATION_HEAD,
    targetId: process.env.EVIDENCE_TARGET_ID,
    fixtureId: process.env.EVIDENCE_FIXTURE_ID,
    fixtureRevision: process.env.EVIDENCE_FIXTURE_REVISION,
    outcome: process.env.EVIDENCE_OUTCOME,
    workflowRunId: process.env.GITHUB_RUN_ID,
    workflowRunAttempt: process.env.GITHUB_RUN_ATTEMPT,
    recordedAt: new Date().toISOString(),
  });
  mkdirSync(dirname(outputPath), { recursive: true });
  writeFileSync(outputPath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  try {
    runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown evidence failure.";
    process.stderr.write(`Connected acceptance evidence was not written: ${message}\n`);
    process.exitCode = 1;
  }
}
