import { randomBytes } from "node:crypto";
import {
  CONNECTED_ACCEPTANCE_ENVIRONMENT,
  CONNECTED_ACCEPTANCE_PROTOCOL,
  CONNECTED_ACCEPTANCE_ATTESTATION_SCHEMA_VERSION,
  constantTimeSignatureMatches,
  isExplicitlyDeniedProductionHost,
  isLoopbackHostname,
  parseConnectedAcceptanceRequest,
  signConnectedAcceptanceProof,
  type ConnectedAcceptanceProof,
} from "../../src/lib/security/connected-acceptance-attestation";

export type ConnectedTestMode = "release-acceptance" | "developer-smoke";

export const connectedAcceptanceRoles = [
  "Owner",
  "Manager",
  "Host",
  "ViewOnly",
  "OperateOnly",
  "Denied",
  "Expired",
  "CrossLocation",
] as const;

export type AcceptanceRole = (typeof connectedAcceptanceRoles)[number];

export function credentialVariableNames(
  role: AcceptanceRole | "Employee",
): [string, string] {
  const prefix = role.replace(/([a-z])([A-Z])/g, "$1_$2").toUpperCase();
  return [
    `E2E_CONNECTED_${prefix}_EMAIL`,
    `E2E_CONNECTED_${prefix}_PASSWORD`,
  ];
}

export const releaseFixtureVariableNames = [
  ...connectedAcceptanceRoles.flatMap(credentialVariableNames),
  "E2E_CONNECTED_EXPECTED_ORGANIZATION_NAME",
  "E2E_CONNECTED_EXPECTED_LOCATION_NAME",
] as const;

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const commitPattern = /^[0-9a-f]{40}$/;
const fixtureRevisionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const schemaVersionPattern = /^[0-9]{14}$/;

function requiredValue(
  environment: NodeJS.ProcessEnv,
  name: string,
  options: { trim?: boolean } = {},
) {
  const raw = environment[name];
  const value = options.trim === false ? raw : raw?.trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
}

function canonicalOrigin(value: string) {
  const parsed = new URL(value);
  if (
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash ||
    parsed.username ||
    parsed.password
  )
    throw new Error("E2E_CONNECTED_APP_URL must be a canonical origin.");
  return parsed;
}

export function connectedTestMode(
  environment: NodeJS.ProcessEnv = process.env,
): ConnectedTestMode {
  const mode = environment.E2E_CONNECTED_MODE;
  if (mode !== "release-acceptance" && mode !== "developer-smoke")
    throw new Error(
      "E2E_CONNECTED_MODE must be release-acceptance or developer-smoke. Use the named npm scripts; smoke evidence is never release acceptance.",
    );
  return mode;
}

export function validateConnectedConfigTarget(
  environment: NodeJS.ProcessEnv = process.env,
) {
  const mode = connectedTestMode(environment);
  const parsed = canonicalOrigin(
    requiredValue(environment, "E2E_CONNECTED_APP_URL"),
  );

  if (mode === "developer-smoke") {
    if (!isLoopbackHostname(parsed.hostname))
      throw new Error(
        "Developer smoke mode is restricted to loopback application origins and can never target a deployment.",
      );
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:")
      throw new Error("Developer smoke mode requires HTTP or HTTPS.");
    return { mode, origin: parsed.origin } as const;
  }

  if (parsed.protocol !== "https:")
    throw new Error("Release connected acceptance requires HTTPS.");
  if (
    isLoopbackHostname(parsed.hostname) ||
    isExplicitlyDeniedProductionHost(parsed.hostname)
  )
    throw new Error(
      "Release connected acceptance refuses local and explicit production targets.",
    );
  if (
    requiredValue(environment, "E2E_CONNECTED_ENVIRONMENT") !==
    CONNECTED_ACCEPTANCE_ENVIRONMENT
  )
    throw new Error(
      `E2E_CONNECTED_ENVIRONMENT must equal ${CONNECTED_ACCEPTANCE_ENVIRONMENT}.`,
    );
  return { mode, origin: parsed.origin } as const;
}

function parseProof(value: unknown): ConnectedAcceptanceProof | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const proof = value as Record<string, unknown>;
  const keys = Object.keys(proof).sort();
  const expectedKeys = [
    "deploymentCommit",
    "fixtureId",
    "fixtureRevision",
    "issuedAt",
    "nonce",
    "protocol",
    "schemaVersion",
    "signature",
    "targetId",
  ].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  )
    return null;
  if (
    proof.protocol !== CONNECTED_ACCEPTANCE_PROTOCOL ||
    typeof proof.nonce !== "string" ||
    typeof proof.targetId !== "string" ||
    typeof proof.deploymentCommit !== "string" ||
    typeof proof.schemaVersion !== "string" ||
    typeof proof.fixtureId !== "string" ||
    typeof proof.fixtureRevision !== "string" ||
    typeof proof.issuedAt !== "string" ||
    typeof proof.signature !== "string"
  )
    return null;
  return proof as ConnectedAcceptanceProof;
}

function assertReleaseFixtures(environment: NodeJS.ProcessEnv) {
  const missing = releaseFixtureVariableNames.filter((name) => {
    const value = environment[name];
    return name.endsWith("_PASSWORD") ? !value : !value?.trim();
  });
  if (missing.length)
    throw new Error(
      `Release connected acceptance requires every role/location fixture. Missing: ${missing.join(", ")}`,
    );

  if (environment.E2E_CONNECTED_ENABLE_MUTATIONS === "true") {
    const missingMutationValues = [
      ...credentialVariableNames("Employee"),
      "E2E_CONNECTED_MUTATION_HOST",
      "E2E_CONNECTED_RUN_ID",
      "E2E_CONNECTED_CHAT_CHANNEL_NAME",
    ].filter((name) => !environment[name]?.trim());
    if (missingMutationValues.length)
      throw new Error(
        `Connected mutation mode is missing: ${missingMutationValues.join(", ")}`,
      );
  }
}

export async function runConnectedPreflight(
  environment: NodeJS.ProcessEnv = process.env,
  fetchImplementation: typeof fetch = fetch,
) {
  const target = validateConnectedConfigTarget(environment);
  if (target.mode === "developer-smoke") {
    environment.E2E_CONNECTED_PREFLIGHT_COMPLETE =
      `developer-smoke:${target.origin}`;
    process.stdout.write(
      "CONNECTED DEVELOPER SMOKE: loopback-only; this run is not release acceptance.\n",
    );
    return;
  }

  const secret = requiredValue(
    environment,
    "E2E_CONNECTED_ATTESTATION_SECRET",
    { trim: false },
  );
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(secret))
    throw new Error(
      "E2E_CONNECTED_ATTESTATION_SECRET must be a 43-128 character base64url secret.",
    );
  const targetId = requiredValue(environment, "E2E_CONNECTED_TARGET_ID");
  const expectedDeploymentCommit = requiredValue(
    environment,
    "E2E_CONNECTED_EXPECTED_DEPLOYMENT_COMMIT",
  );
  const expectedSchemaVersion = requiredValue(
    environment,
    "E2E_CONNECTED_EXPECTED_SCHEMA_VERSION",
  );
  const fixtureId = requiredValue(environment, "E2E_CONNECTED_FIXTURE_ID");
  const fixtureRevision = requiredValue(
    environment,
    "E2E_CONNECTED_FIXTURE_REVISION",
  );
  if (!uuidPattern.test(targetId) || !uuidPattern.test(fixtureId))
    throw new Error("Connected target and fixture IDs must be UUIDs.");
  if (!commitPattern.test(expectedDeploymentCommit))
    throw new Error(
      "E2E_CONNECTED_EXPECTED_DEPLOYMENT_COMMIT must be the exact 40-character lowercase Git commit.",
    );
  if (
    !schemaVersionPattern.test(expectedSchemaVersion) ||
    expectedSchemaVersion < CONNECTED_ACCEPTANCE_ATTESTATION_SCHEMA_VERSION
  )
    throw new Error(
      `E2E_CONNECTED_EXPECTED_SCHEMA_VERSION must be the exact latest 14-digit migration version and cannot predate ${CONNECTED_ACCEPTANCE_ATTESTATION_SCHEMA_VERSION}.`,
    );
  if (!fixtureRevisionPattern.test(fixtureRevision))
    throw new Error("E2E_CONNECTED_FIXTURE_REVISION has an invalid format.");

  const requestBody = {
    nonce: randomBytes(32).toString("base64url"),
    targetId: targetId.toLowerCase(),
    expectedDeploymentCommit,
    expectedSchemaVersion,
    fixtureId: fixtureId.toLowerCase(),
    fixtureRevision,
  };
  if (!parseConnectedAcceptanceRequest(requestBody))
    throw new Error("The connected attestation request is invalid.");

  const response = await fetchImplementation(
    `${target.origin}/api/internal/connected-acceptance/attest`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${secret}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(requestBody),
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (
    response.status !== 200 ||
    !response.headers.get("cache-control")?.includes("no-store")
  )
    throw new Error(
      "Connected acceptance attestation failed before any user credential was read.",
    );

  let proof: ConnectedAcceptanceProof | null = null;
  try {
    proof = parseProof(await response.json());
  } catch {
    proof = null;
  }
  const issuedAt = proof ? new Date(proof.issuedAt).valueOf() : Number.NaN;
  const expectedSignature = proof
    ? signConnectedAcceptanceProof(
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
      )
    : "";
  const now = Date.now();
  if (
    !proof ||
    proof.nonce !== requestBody.nonce ||
    proof.targetId !== requestBody.targetId ||
    proof.deploymentCommit !== expectedDeploymentCommit ||
    proof.schemaVersion !== expectedSchemaVersion ||
    proof.fixtureId !== requestBody.fixtureId ||
    proof.fixtureRevision !== fixtureRevision ||
    !Number.isFinite(issuedAt) ||
    issuedAt > now + 5_000 ||
    now - issuedAt > 30_000 ||
    !constantTimeSignatureMatches(expectedSignature, proof.signature)
  )
    throw new Error(
      "Connected acceptance returned an invalid or stale proof before any user credential was read.",
    );

  // Role passwords and tenant/location fixture values are intentionally not
  // touched until the nonce-bound deployment/database proof is verified.
  assertReleaseFixtures(environment);
  environment.E2E_CONNECTED_PREFLIGHT_COMPLETE = `release:${proof.signature}`;
  process.stdout.write(
    "CONNECTED RELEASE ACCEPTANCE: exact preview deployment, private database marker, schema, and fixture attested.\n",
  );
}
