import {
  createHash,
  createHmac,
  timingSafeEqual,
} from "node:crypto";

export const CONNECTED_ACCEPTANCE_ATTESTATION_SCHEMA_VERSION = "20260811091453";
export const CONNECTED_ACCEPTANCE_ENVIRONMENT = "nonproduction_preview";
export const CONNECTED_ACCEPTANCE_PROTOCOL = "le-yard-connected-acceptance-v1";

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const commitPattern = /^[0-9a-f]{40}$/;
const noncePattern = /^[A-Za-z0-9_-]{43}$/;
const fixtureRevisionPattern = /^[A-Za-z0-9][A-Za-z0-9._-]{0,79}$/;
const schemaVersionPattern = /^[0-9]{14}$/;

const deniedProductionHosts = new Set([
  "le-yard-os.vercel.app",
  "le-yard.vercel.app",
]);

export type ConnectedAcceptanceRequest = {
  nonce: string;
  targetId: string;
  expectedDeploymentCommit: string;
  expectedSchemaVersion: string;
  fixtureId: string;
  fixtureRevision: string;
};

export type ConnectedAcceptanceProof = {
  protocol: typeof CONNECTED_ACCEPTANCE_PROTOCOL;
  nonce: string;
  targetId: string;
  deploymentCommit: string;
  schemaVersion: string;
  fixtureId: string;
  fixtureRevision: string;
  issuedAt: string;
  signature: string;
};

export function isExplicitlyDeniedProductionHost(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  return (
    deniedProductionHosts.has(normalized) ||
    normalized === "leyardnyc.com" ||
    normalized.endsWith(".leyardnyc.com")
  );
}

export function isLoopbackHostname(hostname: string) {
  const normalized = hostname.trim().toLowerCase().replace(/\.$/, "");
  return (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "::1" ||
    normalized.startsWith("127.")
  );
}

export function parseConnectedAcceptanceRequest(
  value: unknown,
): ConnectedAcceptanceRequest | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  const expectedKeys = [
    "expectedDeploymentCommit",
    "expectedSchemaVersion",
    "fixtureId",
    "fixtureRevision",
    "nonce",
    "targetId",
  ].sort();
  if (
    keys.length !== expectedKeys.length ||
    keys.some((key, index) => key !== expectedKeys[index])
  )
    return null;

  const {
    nonce,
    targetId,
    expectedDeploymentCommit,
    expectedSchemaVersion,
    fixtureId,
    fixtureRevision,
  } = candidate;
  if (
    typeof nonce !== "string" ||
    !noncePattern.test(nonce) ||
    typeof targetId !== "string" ||
    !uuidPattern.test(targetId) ||
    typeof expectedDeploymentCommit !== "string" ||
    !commitPattern.test(expectedDeploymentCommit) ||
    typeof expectedSchemaVersion !== "string" ||
    !schemaVersionPattern.test(expectedSchemaVersion) ||
    expectedSchemaVersion < CONNECTED_ACCEPTANCE_ATTESTATION_SCHEMA_VERSION ||
    typeof fixtureId !== "string" ||
    !uuidPattern.test(fixtureId) ||
    typeof fixtureRevision !== "string" ||
    !fixtureRevisionPattern.test(fixtureRevision)
  )
    return null;

  return {
    nonce,
    targetId: targetId.toLowerCase(),
    expectedDeploymentCommit,
    expectedSchemaVersion,
    fixtureId: fixtureId.toLowerCase(),
    fixtureRevision,
  };
}

export function canonicalConnectedAcceptanceProof(
  proof: Omit<ConnectedAcceptanceProof, "signature">,
) {
  return JSON.stringify([
    proof.protocol,
    proof.nonce,
    proof.targetId,
    proof.deploymentCommit,
    proof.schemaVersion,
    proof.fixtureId,
    proof.fixtureRevision,
    proof.issuedAt,
  ]);
}

export function signConnectedAcceptanceProof(
  proof: Omit<ConnectedAcceptanceProof, "signature">,
  secret: string,
) {
  return createHmac("sha256", secret)
    .update(canonicalConnectedAcceptanceProof(proof))
    .digest("hex");
}

export function constantTimeSecretMatches(expected: string, provided: string) {
  const expectedDigest = createHash("sha256").update(expected).digest();
  const providedDigest = createHash("sha256").update(provided).digest();
  const equal = timingSafeEqual(expectedDigest, providedDigest);
  return expected.length >= 32 && provided.length >= 32 && equal;
}

export function constantTimeSignatureMatches(
  expected: string,
  provided: string,
) {
  const expectedBuffer = Buffer.from(expected, "utf8");
  const providedBuffer = Buffer.from(provided, "utf8");
  return (
    /^[0-9a-f]{64}$/.test(expected) &&
    /^[0-9a-f]{64}$/.test(provided) &&
    expectedBuffer.length === providedBuffer.length &&
    timingSafeEqual(expectedBuffer, providedBuffer)
  );
}
