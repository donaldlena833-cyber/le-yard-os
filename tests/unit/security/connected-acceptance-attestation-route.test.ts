import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONNECTED_ACCEPTANCE_PROTOCOL,
  CONNECTED_ACCEPTANCE_ATTESTATION_SCHEMA_VERSION,
  signConnectedAcceptanceProof,
} from "@/lib/security/connected-acceptance-attestation";

const mocks = vi.hoisted(() => ({ rpc: vi.fn() }));

vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ rpc: mocks.rpc }),
}));

const secret = "attestation-secret-value-".repeat(2);
const targetId = "11111111-1111-4111-8111-111111111111";
const fixtureId = "22222222-2222-4222-8222-222222222222";
const fixtureRevision = "reservation-matrix-v1";
const deploymentCommit = "a".repeat(40);
const previewOrigin = "https://le-yard-os-git-acceptance-example.vercel.app";
const originalEnvironment = { ...process.env };

function request(
  options: {
    origin?: string;
    authorization?: string;
    body?: Record<string, unknown>;
  } = {},
) {
  return new Request(
    `${options.origin ?? previewOrigin}/api/internal/connected-acceptance/attest`,
    {
      method: "POST",
      headers: {
        authorization: options.authorization ?? `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(
        options.body ?? {
          nonce: "n".repeat(43),
          targetId,
          expectedDeploymentCommit: deploymentCommit,
          expectedSchemaVersion:
            CONNECTED_ACCEPTANCE_ATTESTATION_SCHEMA_VERSION,
          fixtureId,
          fixtureRevision,
        },
      ),
    },
  );
}

function marker() {
  return {
    target_id: targetId,
    environment: "nonproduction_preview",
    schema_version: CONNECTED_ACCEPTANCE_ATTESTATION_SCHEMA_VERSION,
    fixture_id: fixtureId,
    fixture_revision: fixtureRevision,
    expires_at: new Date(Date.now() + 60_000).toISOString(),
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  process.env = { ...originalEnvironment };
  process.env.CONNECTED_ACCEPTANCE_ATTESTATION_ENABLED = "true";
  process.env.CONNECTED_ACCEPTANCE_ATTESTATION_SECRET = secret;
  process.env.CONNECTED_ACCEPTANCE_TARGET_ID = targetId;
  process.env.CONNECTED_ACCEPTANCE_FIXTURE_ID = fixtureId;
  process.env.CONNECTED_ACCEPTANCE_FIXTURE_REVISION = fixtureRevision;
  process.env.CONNECTED_ACCEPTANCE_SCHEMA_VERSION =
    CONNECTED_ACCEPTANCE_ATTESTATION_SCHEMA_VERSION;
  process.env.NEXT_PUBLIC_APP_URL = previewOrigin;
  process.env.VERCEL_ENV = "preview";
  process.env.VERCEL_GIT_COMMIT_SHA = deploymentCommit;
  mocks.rpc.mockResolvedValue({ data: [marker()], error: null });
});

describe("connected acceptance attestation route", () => {
  it("returns a nonce-bound proof only after the exact service marker resolves", async () => {
    const { POST } = await import(
      "@/app/api/internal/connected-acceptance/attest/route"
    );
    const response = await POST(request());
    const proof = await response.json();

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.rpc).toHaveBeenCalledWith(
      "service_connected_acceptance_marker",
      {
        p_target_id: targetId,
        p_schema_version: CONNECTED_ACCEPTANCE_ATTESTATION_SCHEMA_VERSION,
        p_fixture_id: fixtureId,
        p_fixture_revision: fixtureRevision,
      },
    );
    expect(proof).toMatchObject({
      protocol: CONNECTED_ACCEPTANCE_PROTOCOL,
      nonce: "n".repeat(43),
      targetId,
      deploymentCommit,
      schemaVersion: CONNECTED_ACCEPTANCE_ATTESTATION_SCHEMA_VERSION,
      fixtureId,
      fixtureRevision,
    });
    expect(proof.signature).toBe(
      signConnectedAcceptanceProof(
        {
          protocol: proof.protocol,
          nonce: proof.nonce,
          targetId: proof.targetId,
          deploymentCommit: proof.deploymentCommit,
          schemaVersion: proof.schemaVersion,
          fixtureId: proof.fixtureId,
          fixtureRevision: proof.fixtureRevision,
          issuedAt: proof.issuedAt,
        },
        secret,
      ),
    );
  });

  it("uses one generic no-store failure and never queries the marker for a bad secret", async () => {
    const { POST } = await import(
      "@/app/api/internal/connected-acceptance/attest/route"
    );
    const response = await POST(
      request({ authorization: `Bearer ${"wrong-secret-value-".repeat(2)}` }),
    );

    expect(response.status).toBe(404);
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it.each([
    ["a production Vercel environment", { VERCEL_ENV: "production" }],
    [
      "the explicit production hostname",
      {
        VERCEL_ENV: "preview",
        NEXT_PUBLIC_APP_URL: "https://le-yard-os.vercel.app",
      },
    ],
  ])("fails on %s before touching the marker", async (_label, overrides) => {
    Object.assign(process.env, overrides);
    const { POST } = await import(
      "@/app/api/internal/connected-acceptance/attest/route"
    );
    const response = await POST(
      request({ origin: process.env.NEXT_PUBLIC_APP_URL }),
    );

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
    expect(mocks.rpc).not.toHaveBeenCalled();
  });

  it("fails generically when the private marker is absent or stale", async () => {
    mocks.rpc.mockResolvedValue({ data: [], error: null });
    const { POST } = await import(
      "@/app/api/internal/connected-acceptance/attest/route"
    );
    const response = await POST(request());

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: "Not found" });
  });
});
