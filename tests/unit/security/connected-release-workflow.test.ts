import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  CONNECTED_ACCEPTANCE_CONFIRMATION,
  CONNECTED_ACCEPTANCE_REPOSITORY,
  latestMigrationVersion,
  validateConnectedPreviewOrigin,
  validateConnectedReleaseWorkflowInputs,
} from "../../../scripts/verify-connected-release-workflow-inputs.mjs";
import {
  CONNECTED_RELEASE_ROLE_MATRIX,
  createConnectedAcceptanceEvidence,
} from "../../../scripts/write-connected-acceptance-evidence.mjs";
import { connectedAcceptanceRoles } from "../../connected/attestation-preflight";

const repositoryRoot = resolve(process.cwd());
const workflow = readFileSync(
  resolve(
    repositoryRoot,
    ".github/workflows/connected-preview-acceptance.yml",
  ),
  "utf8",
);
const commit = "b".repeat(40);
const previewOrigin =
  "https://le-yard-os-git-acceptance-example.vercel.app";
const targetId = "11111111-1111-4111-8111-111111111111";
const fixtureId = "22222222-2222-4222-8222-222222222222";
const migrationFileNames = [
  "202608010024_manager_recipe_edit.sql",
  "20260811091453_connected_acceptance_attestation.sql",
  "20260811092658_core_realtime_invalidation_and_reservation_payload_boundary.sql",
];

function validWorkflowInput() {
  return {
    repository: CONNECTED_ACCEPTANCE_REPOSITORY,
    eventName: "workflow_dispatch",
    githubSha: commit,
    requestedCommit: commit,
    checkoutCommit: commit,
    confirmation: CONNECTED_ACCEPTANCE_CONFIRMATION,
    previewUrl: previewOrigin,
    migrationFileNames,
  };
}

describe("connected preview release workflow", () => {
  it("has only a manual trigger and keeps protected acceptance out of forks and pushes", () => {
    expect(workflow).toMatch(/^on:\n  workflow_dispatch:/m);
    expect(workflow).not.toMatch(
      /^\s{2}(?:push|pull_request|pull_request_target|schedule|workflow_run):/m,
    );
    expect(workflow).toContain("permissions:\n  contents: read");
    expect(workflow).toContain(
      "github.repository == 'donaldlena833-cyber/le-yard-os'",
    );
    expect(workflow).toContain("environment:\n      name: connected-preview-acceptance");

    const unprivilegedContract = workflow.match(
      /  contract:\n([\s\S]*?)\n  acceptance:/,
    )?.[1];
    expect(unprivilegedContract).toBeDefined();
    expect(unprivilegedContract).not.toContain("secrets.");
    expect(unprivilegedContract).not.toContain("vars.");
    expect(unprivilegedContract).not.toContain(
      "environment:\n      name: connected-preview-acceptance",
    );
  });

  it("checks out and attests the exact dispatch commit and local migration head", () => {
    expect(workflow).toContain("ref: ${{ inputs.commit_sha }}");
    expect(workflow).toContain(
      "ref: ${{ needs.contract.outputs.commit_sha }}",
    );
    expect(workflow).toContain("persist-credentials: false");
    expect(workflow).toContain(
      "E2E_CONNECTED_EXPECTED_DEPLOYMENT_COMMIT: ${{ needs.contract.outputs.commit_sha }}",
    );
    expect(workflow).toContain(
      "E2E_CONNECTED_EXPECTED_SCHEMA_VERSION: ${{ needs.contract.outputs.schema_version }}",
    );
    expect(workflow).toContain(
      "E2E_CONNECTED_TARGET_ID: ${{ vars.CONNECTED_PREVIEW_TARGET_ID }}",
    );
    expect(workflow).toContain(
      "E2E_CONNECTED_FIXTURE_ID: ${{ vars.CONNECTED_PREVIEW_FIXTURE_ID }}",
    );
    expect(workflow).toContain("npm run test:e2e:connected");
    expect(workflow).not.toContain("test:e2e:connected:smoke");
    expect(workflow).toContain('E2E_CONNECTED_ENABLE_MUTATIONS: "false"');
    expect(workflow).not.toMatch(/\bvercel\s+(?:deploy|promote|--prod)\b/);
    expect(workflow).not.toMatch(/\bsupabase\s+(?:db push|migration up)\b/);
  });

  it("requires every release role from protected environment secrets", () => {
    expect(CONNECTED_RELEASE_ROLE_MATRIX).toEqual([
      ...connectedAcceptanceRoles,
    ]);
    for (const role of CONNECTED_RELEASE_ROLE_MATRIX) {
      const secretPrefix = role.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
      expect(workflow).toContain(
        `secrets.CONNECTED_PREVIEW_${secretPrefix}_EMAIL`,
      );
      expect(workflow).toContain(
        `secrets.CONNECTED_PREVIEW_${secretPrefix}_PASSWORD`,
      );
    }
  });

  it("validates repository, event, immutable commit, canonical preview, and migration head", () => {
    expect(validateConnectedReleaseWorkflowInputs(validWorkflowInput())).toMatchObject({
      previewOrigin,
      commitSha: commit,
      schemaVersion: "20260811092658",
    });
    expect(latestMigrationVersion(migrationFileNames)).toBe("20260811092658");

    for (const patch of [
      { repository: "someone/le-yard-os" },
      { eventName: "push" },
      { requestedCommit: "main" },
      { githubSha: "c".repeat(40) },
      { checkoutCommit: "c".repeat(40) },
      { confirmation: "yes" },
    ]) {
      expect(() =>
        validateConnectedReleaseWorkflowInputs({
          ...validWorkflowInput(),
          ...patch,
        }),
      ).toThrow();
    }
  });

  it("rejects live, local, custom, insecure, and non-canonical targets", () => {
    const denied = [
      "https://le-yard-os.vercel.app",
      "https://le-yard.vercel.app",
      "https://leyardnyc.com",
      "https://www.leyardnyc.com",
      "http://preview-example.vercel.app",
      "https://localhost",
      "https://127.0.0.1",
      "https://preview.example.com",
      "https://preview-example.vercel.app:444",
      "https://preview-example.vercel.app:443",
      "https://preview-example.vercel.app/a",
      "https://preview-example.vercel.app/",
      "https://preview-example.vercel.app?branch=main",
      "https://PREVIEW-example.vercel.app",
      " https://preview-example.vercel.app",
    ];
    for (const origin of denied)
      expect(() => validateConnectedPreviewOrigin(origin)).toThrow();
  });

  it("writes allowlisted evidence with hashed deployment and fixture bindings only", () => {
    const evidence = createConnectedAcceptanceEvidence({
      previewOrigin,
      sourceCommit: commit,
      schemaMigrationHead: "20260811092658",
      targetId,
      fixtureId,
      fixtureRevision: "role-matrix-v1",
      outcome: "success",
      workflowRunId: "12345",
      workflowRunAttempt: "2",
      recordedAt: "2026-08-11T12:00:00.000Z",
    });
    const serialized = JSON.stringify(evidence);

    expect(Object.keys(evidence).sort()).toEqual(
      [
        "acceptanceMode",
        "allReleaseAcceptanceChecksPassed",
        "databaseFixtureBindingSha256",
        "evidenceSchema",
        "executionContract",
        "outcome",
        "previewDeploymentBindingSha256",
        "recordedAt",
        "requiredRoleMatrix",
        "schemaMigrationHead",
        "sourceCommit",
        "workflowRun",
      ].sort(),
    );
    expect(evidence.requiredRoleMatrix).toEqual([...connectedAcceptanceRoles]);
    expect(evidence.previewDeploymentBindingSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.databaseFixtureBindingSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(evidence.allReleaseAcceptanceChecksPassed).toBe(true);
    expect(evidence.executionContract).toMatchObject({
      connectedSoakSessions: 14,
      authoritativeRefreshP95BudgetMs: 3_000,
    });
    expect(serialized).not.toContain(previewOrigin);
    expect(serialized).not.toContain(new URL(previewOrigin).hostname);
    expect(serialized).not.toContain(targetId);
    expect(serialized).not.toContain(fixtureId);
    expect(serialized).not.toContain("role-matrix-v1");
    expect(serialized).not.toMatch(/(?:email|password|secret)/i);
  });

  it("never turns a failed or unstarted run into passing evidence", () => {
    for (const outcome of ["failure", "cancelled", "skipped", "not_run"]) {
      const evidence = createConnectedAcceptanceEvidence({
        previewOrigin,
        sourceCommit: commit,
        schemaMigrationHead: "20260811092658",
        targetId,
        fixtureId,
        fixtureRevision: "role-matrix-v1",
        outcome,
        workflowRunId: "1",
        workflowRunAttempt: "1",
        recordedAt: "2026-08-11T12:00:00.000Z",
      });
      expect(evidence.allReleaseAcceptanceChecksPassed).toBe(false);
    }
  });
});
