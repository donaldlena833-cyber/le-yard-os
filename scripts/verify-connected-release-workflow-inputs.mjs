import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

export const CONNECTED_ACCEPTANCE_REPOSITORY =
  "donaldlena833-cyber/le-yard-os";
export const CONNECTED_ACCEPTANCE_CONFIRMATION =
  "RUN CONNECTED RELEASE ACCEPTANCE";

const commitPattern = /^[0-9a-f]{40}$/;
// The repository's original bootstrap chain used 12-digit versions. Connected
// acceptance was introduced after the chain moved to full 14-digit timestamps,
// so legacy names remain valid while the authoritative head must be 14 digits.
const migrationNamePattern = /^(\d{12}|\d{14})_[a-z0-9_]+\.sql$/;
const vercelPreviewHostPattern =
  /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?\.vercel\.app$/;
const deniedProductionHosts = new Set([
  "le-yard-os.vercel.app",
  "le-yard.vercel.app",
]);

function fail(message) {
  throw new Error(message);
}

export function sha256(value) {
  return createHash("sha256").update(value).digest("hex");
}

export function validateConnectedPreviewOrigin(value) {
  if (typeof value !== "string" || value !== value.trim() || !value)
    fail("Preview URL must be a non-empty canonical origin.");

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    fail("Preview URL must be a valid canonical HTTPS origin.");
  }

  const hostname = parsed.hostname.toLowerCase().replace(/\.$/, "");
  if (
    parsed.protocol !== "https:" ||
    parsed.username ||
    parsed.password ||
    parsed.port ||
    parsed.pathname !== "/" ||
    parsed.search ||
    parsed.hash
  )
    fail("Preview URL must be a canonical HTTPS origin without credentials, a port, path, query, or fragment.");

  if (
    deniedProductionHosts.has(hostname) ||
    hostname === "leyardnyc.com" ||
    hostname.endsWith(".leyardnyc.com")
  )
    fail("Connected release acceptance refuses a known live or production host.");

  if (!vercelPreviewHostPattern.test(hostname))
    fail("Connected release acceptance requires a Vercel Preview hostname.");

  const canonicalOrigin = `https://${hostname}`;
  if (value !== canonicalOrigin)
    fail("Preview URL must exactly equal its lowercase canonical origin.");
  return canonicalOrigin;
}

export function latestMigrationVersion(fileNames) {
  const migrations = fileNames.filter((name) => name.endsWith(".sql"));
  if (migrations.length === 0)
    fail("No Supabase migration files were found.");

  const versions = migrations.map((name) => {
    const match = name.match(migrationNamePattern);
    if (!match)
      fail("Every Supabase migration must use a supported versioned SQL filename.");
    return match[1];
  });
  if (new Set(versions).size !== versions.length)
    fail("Supabase migration versions must be unique.");

  const latest = versions.sort((left, right) => left.localeCompare(right)).at(-1);
  if (!/^\d{14}$/.test(latest ?? ""))
    fail("Connected acceptance requires a full 14-digit migration head.");
  return latest;
}

export function validateConnectedReleaseWorkflowInputs({
  repository,
  eventName,
  githubSha,
  requestedCommit,
  checkoutCommit,
  confirmation,
  previewUrl,
  migrationFileNames,
}) {
  if (repository !== CONNECTED_ACCEPTANCE_REPOSITORY)
    fail("Connected release acceptance is disabled outside the canonical repository.");
  if (eventName !== "workflow_dispatch")
    fail("Connected release acceptance can run only through manual workflow dispatch.");
  if (confirmation !== CONNECTED_ACCEPTANCE_CONFIRMATION)
    fail("Connected release acceptance requires the exact manual confirmation phrase.");
  if (
    !commitPattern.test(requestedCommit ?? "") ||
    !commitPattern.test(githubSha ?? "") ||
    !commitPattern.test(checkoutCommit ?? "")
  )
    fail("The requested, workflow, and checked-out commits must be lowercase 40-character Git SHAs.");
  if (requestedCommit !== githubSha || requestedCommit !== checkoutCommit)
    fail("The requested commit must exactly equal the workflow commit and checked-out HEAD.");

  const previewOrigin = validateConnectedPreviewOrigin(previewUrl);
  const schemaVersion = latestMigrationVersion(migrationFileNames);
  return {
    previewOrigin,
    previewOriginSha256: sha256(previewOrigin),
    commitSha: requestedCommit,
    schemaVersion,
  };
}

function readCheckoutCommit() {
  return execFileSync("git", ["rev-parse", "HEAD"], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "ignore"],
  }).trim();
}

function runCli() {
  const migrationDirectory = resolve(
    process.cwd(),
    "supabase",
    "migrations",
  );
  const migrationFileNames = readdirSync(migrationDirectory, {
    withFileTypes: true,
  })
    .filter((entry) => entry.isFile())
    .map((entry) => entry.name);

  const result = validateConnectedReleaseWorkflowInputs({
    repository: process.env.GITHUB_REPOSITORY,
    eventName: process.env.GITHUB_EVENT_NAME,
    githubSha: process.env.GITHUB_SHA,
    requestedCommit: process.env.CONNECTED_ACCEPTANCE_REQUESTED_COMMIT,
    checkoutCommit: readCheckoutCommit(),
    confirmation: process.env.CONNECTED_ACCEPTANCE_CONFIRMATION,
    previewUrl: process.env.CONNECTED_ACCEPTANCE_PREVIEW_URL,
    migrationFileNames,
  });

  // This command is redirected into GITHUB_OUTPUT. Every emitted value is
  // validated, canonical, and non-secret.
  process.stdout.write(
    [
      `preview_origin=${result.previewOrigin}`,
      `preview_origin_sha256=${result.previewOriginSha256}`,
      `commit_sha=${result.commitSha}`,
      `schema_version=${result.schemaVersion}`,
      "",
    ].join("\n"),
  );
}

const invokedAsScript = process.argv[1]
  ? pathToFileURL(resolve(process.argv[1])).href === import.meta.url
  : false;

if (invokedAsScript) {
  try {
    runCli();
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown contract failure.";
    process.stderr.write(`Connected release contract refused the run: ${message}\n`);
    process.exitCode = 1;
  }
}
