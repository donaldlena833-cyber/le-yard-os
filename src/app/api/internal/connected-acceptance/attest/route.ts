import { createAdminClient } from "@/lib/supabase/admin";
import {
  CONNECTED_ACCEPTANCE_ENVIRONMENT,
  CONNECTED_ACCEPTANCE_PROTOCOL,
  constantTimeSecretMatches,
  isExplicitlyDeniedProductionHost,
  parseConnectedAcceptanceRequest,
  signConnectedAcceptanceProof,
  type ConnectedAcceptanceProof,
} from "@/lib/security/connected-acceptance-attestation";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const failureHeaders = {
  "cache-control": "no-store, max-age=0",
  "content-type": "application/json; charset=utf-8",
  "x-content-type-options": "nosniff",
};

function unavailable() {
  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: failureHeaders,
  });
}

function bearerSecret(request: Request) {
  const authorization = request.headers.get("authorization") ?? "";
  if (authorization.length > 600) return "";
  return authorization.match(/^Bearer ([A-Za-z0-9_-]{43,128})$/)?.[1] ?? "";
}

function canonicalOrigin(value: string | undefined) {
  if (!value) return null;
  try {
    const parsed = new URL(value);
    if (
      parsed.protocol !== "https:" ||
      parsed.pathname !== "/" ||
      parsed.search ||
      parsed.hash ||
      parsed.username ||
      parsed.password
    )
      return null;
    return parsed.origin;
  } catch {
    return null;
  }
}

type MarkerRow = {
  target_id: string;
  environment: string;
  schema_version: string;
  fixture_id: string;
  fixture_revision: string;
  expires_at: string;
};

type MarkerRpc = (
  name: "service_connected_acceptance_marker",
  args: {
    p_target_id: string;
    p_schema_version: string;
    p_fixture_id: string;
    p_fixture_revision: string;
  },
) => Promise<{ data: MarkerRow[] | null; error: unknown }>;

export async function POST(request: Request) {
  const expectedSecret =
    process.env.CONNECTED_ACCEPTANCE_ATTESTATION_SECRET ?? "";
  const providedSecret = bearerSecret(request);

  // Always perform the digest comparison before evaluating the remaining
  // contract. Every failure below intentionally has the same public shape.
  const secretMatches = constantTimeSecretMatches(
    expectedSecret,
    providedSecret,
  );

  let body: unknown = null;
  try {
    const declaredLength = Number(request.headers.get("content-length") ?? "0");
    if (!Number.isFinite(declaredLength) || declaredLength > 4_096)
      return unavailable();
    const raw = await request.text();
    if (new TextEncoder().encode(raw).byteLength > 4_096)
      return unavailable();
    body = JSON.parse(raw) as unknown;
  } catch {
    return unavailable();
  }

  const input = parseConnectedAcceptanceRequest(body);
  const requestUrl = new URL(request.url);
  const configuredOrigin = canonicalOrigin(process.env.NEXT_PUBLIC_APP_URL);
  const deploymentCommit = process.env.VERCEL_GIT_COMMIT_SHA ?? "";
  const configuredTargetId = (
    process.env.CONNECTED_ACCEPTANCE_TARGET_ID ?? ""
  ).toLowerCase();
  const configuredFixtureId = (
    process.env.CONNECTED_ACCEPTANCE_FIXTURE_ID ?? ""
  ).toLowerCase();
  const configuredFixtureRevision =
    process.env.CONNECTED_ACCEPTANCE_FIXTURE_REVISION ?? "";
  const configuredSchemaVersion =
    process.env.CONNECTED_ACCEPTANCE_SCHEMA_VERSION ?? "";

  if (
    !secretMatches ||
    process.env.CONNECTED_ACCEPTANCE_ATTESTATION_ENABLED !== "true" ||
    process.env.VERCEL_ENV !== "preview" ||
    isExplicitlyDeniedProductionHost(requestUrl.hostname) ||
    configuredOrigin !== requestUrl.origin ||
    !input ||
    input.targetId !== configuredTargetId ||
    input.fixtureId !== configuredFixtureId ||
    input.fixtureRevision !== configuredFixtureRevision ||
    input.expectedDeploymentCommit !== deploymentCommit ||
    input.expectedSchemaVersion !== configuredSchemaVersion
  )
    return unavailable();

  let marker: MarkerRow | undefined;
  try {
    const rpc = createAdminClient().rpc as unknown as MarkerRpc;
    const result = await rpc("service_connected_acceptance_marker", {
      p_target_id: input.targetId,
      p_schema_version: input.expectedSchemaVersion,
      p_fixture_id: input.fixtureId,
      p_fixture_revision: input.fixtureRevision,
    });
    if (result.error || result.data?.length !== 1) return unavailable();
    marker = result.data[0];
  } catch {
    return unavailable();
  }

  if (
    !marker ||
    marker.target_id.toLowerCase() !== input.targetId ||
    marker.environment !== CONNECTED_ACCEPTANCE_ENVIRONMENT ||
    marker.schema_version !== input.expectedSchemaVersion ||
    marker.fixture_id.toLowerCase() !== input.fixtureId ||
    marker.fixture_revision !== input.fixtureRevision ||
    !Number.isFinite(new Date(marker.expires_at).valueOf()) ||
    new Date(marker.expires_at).valueOf() <= Date.now()
  )
    return unavailable();

  const unsignedProof: Omit<ConnectedAcceptanceProof, "signature"> = {
    protocol: CONNECTED_ACCEPTANCE_PROTOCOL,
    nonce: input.nonce,
    targetId: input.targetId,
    deploymentCommit,
    schemaVersion: input.expectedSchemaVersion,
    fixtureId: input.fixtureId,
    fixtureRevision: input.fixtureRevision,
    issuedAt: new Date().toISOString(),
  };
  const proof: ConnectedAcceptanceProof = {
    ...unsignedProof,
    signature: signConnectedAcceptanceProof(unsignedProof, expectedSecret),
  };

  return Response.json(proof, {
    status: 200,
    headers: {
      "cache-control": "no-store, max-age=0",
      "x-content-type-options": "nosniff",
    },
  });
}
