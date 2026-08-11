import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import { basename, join, resolve } from "node:path";

export const RESTORE_DRILL_MANIFEST_VERSION = 1;
export const RESTORE_DRILL_MANIFEST_KIND =
  "le-yard-os-synthetic-postgres-backup";
export const RESTORE_DRILL_FIXTURE_CONTRACT = "le-yard-demo-seed-v1";
export const RESTORE_DRILL_SOURCE_CLASSIFICATION =
  "isolated_synthetic_nonproduction";
export const RESTORE_DRILL_POSTGRES_MAJOR = 17;

const SHA256_PATTERN = /^[0-9a-f]{64}$/;
const COMMIT_PATTERN = /^[0-9a-f]{40}$/;
const MIGRATION_VERSION_PATTERN = /^[0-9]{14}$/;
const ISO_TIMESTAMP_PATTERN = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{3})?Z$/;

function requireRecord(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${label} must be a JSON object.`);
  }
  return value;
}

function requireExactKeys(record, expected, label) {
  const actual = Object.keys(record).sort();
  const wanted = [...expected].sort();
  if (actual.length !== wanted.length || actual.some((key, index) => key !== wanted[index])) {
    throw new Error(
      `${label} must contain exactly: ${wanted.join(", ")}.`,
    );
  }
}

function requireString(value, pattern, label) {
  if (typeof value !== "string" || !pattern.test(value)) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function requirePositiveSafeInteger(value, label) {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

export function sha256Bytes(value) {
  return createHash("sha256").update(value).digest("hex");
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function readMigrationContract(root) {
  const migrationDirectory = join(root, "supabase", "migrations");
  const files = (await readdir(migrationDirectory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  if (!files.length) throw new Error("No PostgreSQL migrations were found.");
  if (files.some((file) => !/^[0-9]{12}(?:[0-9]{2})?_[a-z0-9_]+\.sql$/.test(file))) {
    throw new Error("Every PostgreSQL migration must use a canonical timestamped filename.");
  }
  const versions = files.map((file) => file.slice(0, file.indexOf("_")));
  if (!/^[0-9]{14}$/.test(versions.at(-1))) {
    throw new Error("The latest PostgreSQL migration must use a 14-digit version.");
  }

  const hash = createHash("sha256");
  const fileSha256 = [];
  for (const file of files) {
    const bytes = await readFile(join(migrationDirectory, file));
    fileSha256.push(sha256Bytes(bytes));
    hash.update(file);
    hash.update("\0");
    hash.update(String(bytes.byteLength));
    hash.update("\0");
    hash.update(bytes);
    hash.update("\0");
  }

  return {
    directory: migrationDirectory,
    files,
    fileSha256,
    versions,
    head: versions.at(-1),
    bundleSha256: hash.digest("hex"),
  };
}

export function validateRestoreDrillManifest(manifestValue, expected) {
  const manifest = requireRecord(manifestValue, "Restore manifest");
  requireExactKeys(
    manifest,
    [
      "artifact",
      "createdAt",
      "database",
      "kind",
      "manifestVersion",
      "repository",
      "source",
    ],
    "Restore manifest",
  );

  if (manifest.manifestVersion !== RESTORE_DRILL_MANIFEST_VERSION) {
    throw new Error("Restore manifest version is not supported.");
  }
  if (manifest.kind !== RESTORE_DRILL_MANIFEST_KIND) {
    throw new Error("Restore manifest kind is not approved for this drill.");
  }
  requireString(manifest.createdAt, ISO_TIMESTAMP_PATTERN, "Restore manifest createdAt");

  const artifact = requireRecord(manifest.artifact, "Restore manifest artifact");
  requireExactKeys(
    artifact,
    ["bytes", "fileName", "format", "sha256"],
    "Restore manifest artifact",
  );
  if (artifact.format !== "pg_dump_custom") {
    throw new Error("Only a PostgreSQL custom-format archive is accepted.");
  }
  if (
    typeof artifact.fileName !== "string" ||
    artifact.fileName !== basename(artifact.fileName) ||
    artifact.fileName.length < 1 ||
    artifact.fileName.length > 200
  ) {
    throw new Error("Restore manifest artifact fileName must be a plain filename.");
  }
  requirePositiveSafeInteger(artifact.bytes, "Restore manifest artifact bytes");
  requireString(artifact.sha256, SHA256_PATTERN, "Restore manifest artifact sha256");

  const database = requireRecord(manifest.database, "Restore manifest database");
  requireExactKeys(database, ["postgresMajor"], "Restore manifest database");
  if (database.postgresMajor !== RESTORE_DRILL_POSTGRES_MAJOR) {
    throw new Error("Restore manifest must identify PostgreSQL major version 17.");
  }

  const repository = requireRecord(
    manifest.repository,
    "Restore manifest repository",
  );
  requireExactKeys(
    repository,
    ["commit", "migrationBundleSha256", "migrationHead"],
    "Restore manifest repository",
  );
  requireString(repository.commit, COMMIT_PATTERN, "Restore manifest repository commit");
  requireString(
    repository.migrationHead,
    MIGRATION_VERSION_PATTERN,
    "Restore manifest repository migrationHead",
  );
  requireString(
    repository.migrationBundleSha256,
    SHA256_PATTERN,
    "Restore manifest repository migrationBundleSha256",
  );

  const source = requireRecord(manifest.source, "Restore manifest source");
  requireExactKeys(
    source,
    [
      "classification",
      "fixtureContract",
      "providersDisabled",
      "storagePayloadIncluded",
    ],
    "Restore manifest source",
  );
  if (source.classification !== RESTORE_DRILL_SOURCE_CLASSIFICATION) {
    throw new Error("Production, shared, and non-synthetic backup sources are refused.");
  }
  if (source.fixtureContract !== RESTORE_DRILL_FIXTURE_CONTRACT) {
    throw new Error("Restore manifest does not identify the approved synthetic fixture.");
  }
  if (source.providersDisabled !== true) {
    throw new Error("Restore manifest must attest that every provider is disabled.");
  }
  if (source.storagePayloadIncluded !== false) {
    throw new Error(
      "This database-only drill must not claim that private Storage payloads are included.",
    );
  }

  if (repository.commit !== expected.commit) {
    throw new Error("Restore manifest commit does not match the checked-out commit.");
  }
  if (repository.migrationHead !== expected.migrationHead) {
    throw new Error("Restore manifest migration head does not match the repository.");
  }
  if (repository.migrationBundleSha256 !== expected.migrationBundleSha256) {
    throw new Error("Restore manifest migration bundle hash does not match the repository.");
  }
  if (artifact.fileName !== expected.artifactFileName) {
    throw new Error("Restore manifest is bound to a different artifact filename.");
  }
  if (artifact.bytes !== expected.artifactBytes) {
    throw new Error("Restore manifest artifact size does not match the supplied file.");
  }
  if (artifact.sha256 !== expected.artifactSha256) {
    throw new Error("Restore manifest artifact hash does not match the supplied file.");
  }

  return manifest;
}

export async function inspectRegularFile(pathValue, label) {
  if (typeof pathValue !== "string" || !pathValue.trim()) {
    throw new Error(`${label} path is required.`);
  }
  const path = resolve(pathValue);
  const stat = await lstat(path);
  if (stat.isSymbolicLink() || !stat.isFile()) {
    throw new Error(`${label} must be a regular file and cannot be a symbolic link.`);
  }
  const canonicalPath = await realpath(path);
  return { path, canonicalPath, bytes: stat.size };
}

export async function assertCustomArchiveMagic(path) {
  const handle = await open(path, "r");
  const bytes = Buffer.alloc(5);
  let bytesRead;
  try {
    ({ bytesRead } = await handle.read(bytes, 0, bytes.byteLength, 0));
  } finally {
    await handle.close();
  }
  if (bytesRead !== 5 || bytes.toString("ascii") !== "PGDMP") {
    throw new Error("Backup artifact is not a PostgreSQL custom-format archive.");
  }
}

export function parseRestoreDrillArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error(
        "Usage: --artifact <dump> --manifest <json> --evidence-directory <directory>",
      );
    }
    if (option === "--artifact") parsed.artifact = value;
    else if (option === "--manifest") parsed.manifest = value;
    else if (option === "--evidence-directory") parsed.evidenceDirectory = value;
    else throw new Error(`Unknown restore drill option: ${option}`);
  }
  if (!parsed.artifact || !parsed.manifest || !parsed.evidenceDirectory) {
    throw new Error(
      "Usage: --artifact <dump> --manifest <json> --evidence-directory <directory>",
    );
  }
  return parsed;
}

export async function readJsonFile(path, label) {
  let value;
  try {
    value = JSON.parse(await readFile(path, "utf8"));
  } catch (error) {
    throw new Error(`${label} must contain valid JSON.`, { cause: error });
  }
  return value;
}
