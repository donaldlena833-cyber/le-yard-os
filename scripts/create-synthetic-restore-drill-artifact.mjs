import { execFile } from "node:child_process";
import { constants } from "node:fs";
import {
  chmod,
  copyFile,
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  RESTORE_DRILL_FIXTURE_CONTRACT,
  RESTORE_DRILL_MANIFEST_KIND,
  RESTORE_DRILL_MANIFEST_VERSION,
  RESTORE_DRILL_POSTGRES_MAJOR,
  RESTORE_DRILL_SOURCE_CLASSIFICATION,
  createRestoreDrillProvenance,
  inspectRegularFile,
  readMigrationContract,
  readSeedContract,
  requireRestoreDrillProvenanceKey,
  sha256File,
} from "./lib/backup-restore-drill-contract.mjs";
import {
  acquireRestoreDrillLease,
  applyReferenceDatabase,
  assertPostgres17Tools,
  attestControlDatabase,
  attestFreshDisposableDatabase,
  attestLocalPostgresDataDirectory,
  attestTemplateOne,
  collectSyntheticDataFingerprint,
  collectSyntheticInvariants,
  createAdminPool,
  createDatabasePool,
  createDisposableDatabase,
  createRestoreDrillDatabaseName,
  dropDisposableDatabase,
  dropRestoreDrillRoles,
  dumpCustomArchive,
  ensureRestoreDrillRoles,
  inspectArchive,
  releaseRestoreDrillLease,
  requireRestoreDrillControlUrl,
} from "./lib/restore-drill-postgres.mjs";

const execFileAsync = promisify(execFile);
const root = process.cwd();

function parseArguments(argv) {
  const parsed = {};
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!option?.startsWith("--") || value === undefined || value.startsWith("--")) {
      throw new Error("Usage: --artifact <dump> --manifest <json>");
    }
    if (option === "--artifact") parsed.artifact = resolve(value);
    else if (option === "--manifest") parsed.manifest = resolve(value);
    else throw new Error(`Unknown synthetic backup option: ${option}`);
  }
  if (!parsed.artifact || !parsed.manifest) {
    throw new Error("Usage: --artifact <dump> --manifest <json>");
  }
  if (parsed.artifact === parsed.manifest) {
    throw new Error("Synthetic artifact and manifest paths must be different.");
  }
  return parsed;
}

async function requireUnusedOutput(path, label) {
  try {
    await lstat(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
  throw new Error(`${label} already exists; refusing to overwrite it.`);
}

async function unlinkIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
  }
}

async function canonicalOutputPath(path) {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const stat = await lstat(parent);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Synthetic backup output parent must be a real directory.");
  }
  return join(await realpath(parent), basename(path));
}

const requestedOutput = parseArguments(process.argv.slice(2));
const output = {
  artifact: await canonicalOutputPath(requestedOutput.artifact),
  manifest: await canonicalOutputPath(requestedOutput.manifest),
};
if (output.artifact === output.manifest) {
  throw new Error("Synthetic artifact and manifest paths must be different.");
}
await requireUnusedOutput(output.artifact, "Synthetic backup artifact");
await requireUnusedOutput(output.manifest, "Synthetic backup manifest");

const controlUrl = requireRestoreDrillControlUrl(
  process.env.BACKUP_RESTORE_CONTROL_DATABASE_URL,
);
const provenanceKey = requireRestoreDrillProvenanceKey(
  process.env.BACKUP_RESTORE_PROVENANCE_KEY,
);
const [{ stdout: commitOutput }, migrationContract, seedContract] = await Promise.all([
  execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }),
  readMigrationContract(root),
  readSeedContract(root),
]);
const commit = commitOutput.trim();
if (!/^[0-9a-f]{40}$/.test(commit)) {
  throw new Error("The checked-out Git commit is not a full SHA-1 object ID.");
}

await assertPostgres17Tools(controlUrl);
const adminPool = createAdminPool(
  controlUrl,
  "le-yard-synthetic-backup-source-admin",
);
const sourceDatabase = createRestoreDrillDatabaseName("source");
let sourcePool;
let adminClient;
let temporaryDirectory;
let temporaryArtifact;
let temporaryManifest;
let rolesCreated = [];
let controlAttested = false;
let leaseReleased = false;
let artifactPublished = false;
let manifestPublished = false;
let primaryError;
let cleanupError;

try {
  temporaryDirectory = await mkdtemp(
    join(tmpdir(), "le-yard-synthetic-restore-source-"),
  );
  await chmod(temporaryDirectory, 0o700);
  temporaryArtifact = join(temporaryDirectory, "synthetic.dump");
  temporaryManifest = join(temporaryDirectory, "synthetic.manifest.json");
  adminClient = await acquireRestoreDrillLease(adminPool);
  await attestLocalPostgresDataDirectory(
    adminClient,
    controlUrl,
    process.env.BACKUP_RESTORE_PGDATA,
  );
  await attestControlDatabase(adminClient);
  await attestTemplateOne(controlUrl);
  controlAttested = true;
  rolesCreated = await ensureRestoreDrillRoles(adminClient);
  await createDisposableDatabase(adminClient, sourceDatabase);
  sourcePool = createDatabasePool(
    controlUrl,
    sourceDatabase,
    "le-yard-synthetic-backup-source",
  );
  await attestFreshDisposableDatabase(sourcePool);
  await applyReferenceDatabase(sourcePool, migrationContract, root, seedContract);
  await collectSyntheticInvariants(sourcePool);
  const dataFingerprint = await collectSyntheticDataFingerprint(sourcePool);
  await sourcePool.end();
  sourcePool = undefined;
  await dumpCustomArchive(controlUrl, sourceDatabase, temporaryArtifact);
  await chmod(temporaryArtifact, 0o600);
  await inspectArchive(controlUrl, temporaryArtifact);
  const [finalMigrationContract, finalSeedContract] = await Promise.all([
    readMigrationContract(root),
    readSeedContract(root),
  ]);
  if (
    finalMigrationContract.bundleSha256 !== migrationContract.bundleSha256 ||
    finalMigrationContract.head !== migrationContract.head ||
    finalSeedContract.sha256 !== seedContract.sha256
  ) {
    throw new Error("Migration bundle or seed changed while the synthetic backup was created.");
  }

  const artifact = await inspectRegularFile(
    temporaryArtifact,
    "Synthetic backup artifact",
  );
  const unsignedManifest = {
    manifestVersion: RESTORE_DRILL_MANIFEST_VERSION,
    kind: RESTORE_DRILL_MANIFEST_KIND,
    createdAt: new Date().toISOString(),
    artifact: {
      bytes: artifact.bytes,
      fileName: basename(output.artifact),
      format: "pg_dump_custom",
      sha256: await sha256File(artifact.path),
    },
    database: {
      postgresMajor: RESTORE_DRILL_POSTGRES_MAJOR,
    },
    repository: {
      commit,
      migrationBundleSha256: migrationContract.bundleSha256,
      migrationHead: migrationContract.head,
    },
    source: {
      classification: RESTORE_DRILL_SOURCE_CLASSIFICATION,
      dataFingerprintSha256: dataFingerprint.sha256,
      fixtureContract: RESTORE_DRILL_FIXTURE_CONTRACT,
      providersDisabled: true,
      seedSha256: seedContract.sha256,
      storagePayloadIncluded: false,
    },
  };
  const manifest = {
    ...unsignedManifest,
    provenance: createRestoreDrillProvenance(unsignedManifest, provenanceKey),
  };
  await writeFile(temporaryManifest, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
  await copyFile(temporaryArtifact, output.artifact, constants.COPYFILE_EXCL);
  artifactPublished = true;
  await chmod(output.artifact, 0o600);
  await copyFile(temporaryManifest, output.manifest, constants.COPYFILE_EXCL);
  manifestPublished = true;
  await chmod(output.manifest, 0o600);
  const [
    publishedArtifact,
    publishedManifest,
    publishedArtifactHash,
    publishedManifestHash,
    temporaryManifestHash,
  ] =
    await Promise.all([
      inspectRegularFile(output.artifact, "Published synthetic backup artifact"),
      inspectRegularFile(output.manifest, "Published synthetic backup manifest"),
      sha256File(output.artifact),
      sha256File(output.manifest),
      sha256File(temporaryManifest),
    ]);
  if (
    publishedArtifact.bytes !== artifact.bytes ||
    publishedArtifactHash !== manifest.artifact.sha256 ||
    publishedManifest.bytes <= 0 ||
    publishedManifestHash !== temporaryManifestHash
  ) {
    throw new Error("Published synthetic backup bytes changed during no-clobber output.");
  }
} catch (error) {
  primaryError = error;
} finally {
  const cleanupErrors = [];
  const attemptCleanup = async (operation) => {
    try {
      await operation();
    } catch (error) {
      cleanupErrors.push(error);
    }
  };
  await attemptCleanup(async () => sourcePool?.end());
  if (controlAttested && adminClient) {
    await attemptCleanup(async () =>
      dropDisposableDatabase(adminClient, sourceDatabase),
    );
  }
  if (adminClient && rolesCreated.length) {
    await attemptCleanup(async () =>
      dropRestoreDrillRoles(adminClient, rolesCreated),
    );
  }
  if (controlAttested && adminClient) {
    await attemptCleanup(async () => attestControlDatabase(adminClient));
  }
  if (adminClient) {
    await attemptCleanup(async () => {
      await releaseRestoreDrillLease(adminClient);
      leaseReleased = true;
    });
  }
  await attemptCleanup(async () => adminPool.end());
  if (temporaryArtifact) {
    await attemptCleanup(async () => unlinkIfPresent(temporaryArtifact));
  }
  if (temporaryManifest) {
    await attemptCleanup(async () => unlinkIfPresent(temporaryManifest));
  }
  if (temporaryDirectory) {
    await attemptCleanup(async () => rmdir(temporaryDirectory));
  }
  if (primaryError && artifactPublished) {
    await attemptCleanup(async () => unlink(output.artifact));
  }
  if (primaryError && manifestPublished) {
    await attemptCleanup(async () => unlink(output.manifest));
  }
  if (cleanupErrors.length) {
    cleanupError = new AggregateError(
      cleanupErrors,
      "Synthetic backup cleanup failed.",
    );
  }
}

if (primaryError && cleanupError) {
  throw new AggregateError(
    [primaryError, cleanupError],
    "Synthetic backup generation and cleanup failed.",
  );
}
if (primaryError) throw primaryError;
if (cleanupError) throw cleanupError;
if (!leaseReleased) throw new Error("Synthetic restore drill cluster lease was not released.");

process.stdout.write(`ARTIFACT ${output.artifact}\n`);
process.stdout.write(`MANIFEST ${output.manifest}\n`);
