import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, open, readFile, readdir, realpath } from "node:fs/promises";
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";

export const RESTORE_DRILL_MANIFEST_VERSION = 2;
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

function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function requireRestoreDrillProvenanceKey(value) {
  if (typeof value !== "string" || !/^[0-9a-f]{64}$/.test(value)) {
    throw new Error(
      "BACKUP_RESTORE_PROVENANCE_KEY must be a lowercase 32-byte hexadecimal secret.",
    );
  }
  return value;
}

export function createRestoreDrillProvenance(unsignedManifest, keyValue) {
  const key = Buffer.from(requireRestoreDrillProvenanceKey(keyValue), "hex");
  return {
    algorithm: "hmac-sha256",
    keyId: sha256Bytes(key),
    signature: createHmac("sha256", key)
      .update(canonicalJson(unsignedManifest))
      .digest("hex"),
  };
}

export async function sha256File(path) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(path)) hash.update(chunk);
  return hash.digest("hex");
}

export async function fingerprintUntrackedFiles(root, paths) {
  const canonicalRoot = await realpath(root);
  const uniquePaths = [...new Set(paths)].sort();
  if (uniquePaths.length > 10_000) {
    throw new Error("The repository has too many untracked files to attest safely.");
  }
  const hash = createHash("sha256");
  let totalBytes = 0;
  for (const path of uniquePaths) {
    if (typeof path !== "string" || !path || path.includes("\0") || isAbsolute(path)) {
      throw new Error("Git returned an unsafe untracked path.");
    }
    const absolutePath = resolve(canonicalRoot, path);
    const relativePath = relative(canonicalRoot, absolutePath);
    if (
      relativePath === "" ||
      relativePath === ".." ||
      relativePath.startsWith(`..${sep}`) ||
      isAbsolute(relativePath)
    ) {
      throw new Error("An untracked path escaped the repository.");
    }
    const before = await lstat(absolutePath);
    if (before.isSymbolicLink() || !before.isFile()) {
      throw new Error("Untracked repository entries must be regular files.");
    }
    const canonicalFile = await realpath(absolutePath);
    if (canonicalFile !== absolutePath) {
      throw new Error("Untracked repository files cannot traverse symbolic links.");
    }
    totalBytes += before.size;
    if (totalBytes > 100 * 1024 * 1024) {
      throw new Error("Untracked repository bytes exceed the attestation limit.");
    }
    const fileSha256 = await sha256File(absolutePath);
    const after = await lstat(absolutePath);
    if (
      !after.isFile() ||
      before.dev !== after.dev ||
      before.ino !== after.ino ||
      before.mode !== after.mode ||
      before.size !== after.size ||
      before.mtimeMs !== after.mtimeMs
    ) {
      throw new Error("An untracked file changed while it was being fingerprinted.");
    }
    hash.update(relativePath);
    hash.update("\0");
    hash.update(String(after.mode & 0o7777));
    hash.update("\0");
    hash.update(String(after.size));
    hash.update("\0");
    hash.update(fileSha256);
    hash.update("\0");
  }
  return {
    fileCount: uniquePaths.length,
    sha256: hash.digest("hex"),
    totalBytes,
  };
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

export async function readSeedContract(root) {
  const path = join(root, "supabase", "seed.sql");
  const bytes = await readFile(path);
  if (bytes.byteLength === 0) throw new Error("The synthetic seed is empty.");
  return {
    bytes: bytes.byteLength,
    path,
    sha256: sha256Bytes(bytes),
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
      "provenance",
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

  const provenance = requireRecord(
    manifest.provenance,
    "Restore manifest provenance",
  );
  requireExactKeys(
    provenance,
    ["algorithm", "keyId", "signature"],
    "Restore manifest provenance",
  );
  if (provenance.algorithm !== "hmac-sha256") {
    throw new Error("Restore manifest provenance algorithm is not supported.");
  }
  requireString(provenance.keyId, SHA256_PATTERN, "Restore manifest provenance keyId");
  requireString(
    provenance.signature,
    SHA256_PATTERN,
    "Restore manifest provenance signature",
  );

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
      "dataFingerprintSha256",
      "fixtureContract",
      "providersDisabled",
      "seedSha256",
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
  requireString(
    source.seedSha256,
    SHA256_PATTERN,
    "Restore manifest source seedSha256",
  );
  requireString(
    source.dataFingerprintSha256,
    SHA256_PATTERN,
    "Restore manifest source dataFingerprintSha256",
  );
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
  if (source.seedSha256 !== expected.seedSha256) {
    throw new Error("Restore manifest seed hash does not match the repository.");
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

  const unsignedManifest = { ...manifest };
  delete unsignedManifest.provenance;
  const expectedProvenance = createRestoreDrillProvenance(
    unsignedManifest,
    expected.provenanceKey,
  );
  if (
    provenance.keyId !== expectedProvenance.keyId ||
    !timingSafeEqual(
      Buffer.from(provenance.signature, "hex"),
      Buffer.from(expectedProvenance.signature, "hex"),
    )
  ) {
    throw new Error("Restore manifest provenance authentication failed.");
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
