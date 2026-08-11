import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import {
  lstat,
  mkdir,
  mkdtemp,
  realpath,
  rmdir,
  unlink,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, join, resolve } from "node:path";
import { promisify } from "node:util";
import {
  assertCustomArchiveMagic,
  inspectRegularFile,
  parseRestoreDrillArguments,
  readJsonFile,
  readMigrationContract,
  sha256Bytes,
  sha256File,
  validateRestoreDrillManifest,
} from "./lib/backup-restore-drill-contract.mjs";
import {
  applyReferenceDatabase,
  assertPostgres17Tools,
  attestControlDatabase,
  collectDatabaseContract,
  collectSchemaFingerprint,
  collectSyntheticInvariants,
  createAdminPool,
  createDatabasePool,
  createDisposableDatabase,
  createRestoreDrillDatabaseName,
  dumpCustomArchive,
  dropDisposableDatabase,
  dropRestoreDrillRoles,
  ensureRestoreDrillRoles,
  inspectArchive,
  requireRestoreDrillControlUrl,
  restoreArchive,
} from "./lib/restore-drill-postgres.mjs";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const startedAt = new Date();
const runId = randomUUID();
const argumentsValue = parseRestoreDrillArguments(process.argv.slice(2));
const evidenceDirectory = resolve(argumentsValue.evidenceDirectory);
const evidenceFileName =
  `restore-evidence-${startedAt.toISOString().replaceAll(":", "-")}-${runId}.json`;
let evidencePath;

let artifact;
let manifestFile;
let manifest;
let artifactSha256;
let manifestSha256;
let repository;
let migrationContract;
let controlAttestation;
let archiveInspection;
let referenceSchema;
let restoredSchema;
let referenceContract;
let restoredContract;
let syntheticInvariants;
let databaseNames;
let adminPool;
let referencePool;
let restoredPool;
let rolesCreated = [];
let rolesRemoved = false;
let finalControlAttested = false;
let referenceRoundtripDirectory;
let referenceRoundtripArtifact;
let referenceArtifactRemoved = false;
let referenceDirectoryRemoved = false;
const databaseLifecycle = {
  reference: { created: false, dropped: false },
  restored: { created: false, dropped: false },
};
let cleanupError;
let primaryError;
let currentStage = "input_validation";
let failureStage;

async function repositoryState() {
  const [{ stdout: commitOutput }, { stdout: statusOutput }] =
    await Promise.all([
      execFileAsync("git", ["rev-parse", "HEAD"], {
        cwd: root,
        encoding: "utf8",
      }),
      execFileAsync("git", ["status", "--porcelain=v1", "--untracked-files=all"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 10 * 1024 * 1024,
      }),
    ]);
  const commit = commitOutput.trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("The checked-out Git commit is not a full SHA-1 object ID.");
  }
  const changedPaths = statusOutput
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
  return {
    changedPathCount: changedPaths.length,
    commit,
    dirty: changedPaths.length > 0,
  };
}

async function prepareEvidenceDirectory() {
  await mkdir(evidenceDirectory, { recursive: true, mode: 0o700 });
  const stat = await lstat(evidenceDirectory);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Evidence directory must be a real directory, not a symbolic link.");
  }
  const canonicalDirectory = await realpath(evidenceDirectory);
  evidencePath = resolve(canonicalDirectory, evidenceFileName);
  if (!evidencePath.startsWith(`${canonicalDirectory}/`)) {
    throw new Error("Evidence path escaped its output directory.");
  }
}

function publicDatabaseContract(contract) {
  if (!contract) return null;
  return {
    extensions: contract.extensions,
    functionGrantCatalog: {
      count: contract.functions.count,
      sha256: contract.functions.fingerprintSha256,
    },
    migrationCount: contract.migrations.length,
    migrationHead: contract.migrations.at(-1),
    rlsCatalog: {
      anonymousTableGrantCount: contract.rls.anonymousTableGrantCount,
      sha256: contract.rls.fingerprintSha256,
      tableCount: contract.rls.tableCount,
    },
    schemas: contract.schemas,
  };
}

async function writeEvidence(status, error) {
  await prepareEvidenceDirectory();
  const completedAt = new Date();
  const evidence = {
    evidenceVersion: 1,
    kind: "le-yard-os-disposable-postgres-restore-evidence",
    runId,
    status,
    startedAt: startedAt.toISOString(),
    completedAt: completedAt.toISOString(),
    durationMilliseconds: completedAt.valueOf() - startedAt.valueOf(),
    repository: repository ?? null,
    schemaSource: migrationContract
      ? {
          migrationBundleSha256: migrationContract.bundleSha256,
          migrationCount: migrationContract.files.length,
          migrationHead: migrationContract.head,
        }
      : null,
    suppliedBackup: artifact
      ? {
          artifactBytes: artifact.bytes,
          artifactFileName: basename(artifact.path),
          artifactSha256: artifactSha256 ?? null,
          manifestSha256: manifestSha256 ?? null,
        }
      : null,
    sourceAttestation: manifest?.source ?? null,
    postgres: controlAttestation
      ? {
          clientMajor: 17,
          dedicatedCluster: true,
          otherDatabaseCount: controlAttestation.otherDatabaseCount,
          otherUserRoleCount: controlAttestation.otherUserRoleCount,
          serverAddressClass: "loopback",
          serverMajor: controlAttestation.major,
          serverVersionNumber: controlAttestation.serverVersionNumber,
        }
      : null,
    disposableDatabases: {
      reference: {
        ...databaseLifecycle.reference,
        retained:
          databaseLifecycle.reference.created &&
          !databaseLifecycle.reference.dropped,
      },
      restored: {
        ...databaseLifecycle.restored,
        retained:
          databaseLifecycle.restored.created &&
          !databaseLifecycle.restored.dropped,
      },
      createdRoleCount: rolesCreated.length,
      createdRolesRemoved: rolesCreated.length === 0 || rolesRemoved,
      finalEmptyControlClusterAttested: finalControlAttested,
      temporaryReferenceArtifactRemoved:
        !referenceRoundtripArtifact || referenceArtifactRemoved,
      temporaryReferenceDirectoryRemoved:
        !referenceRoundtripDirectory || referenceDirectoryRemoved,
    },
    archive: archiveInspection ?? null,
    reference: {
      contract: publicDatabaseContract(referenceContract),
      schema: referenceSchema ?? null,
    },
    restored: {
      contract: publicDatabaseContract(restoredContract),
      schema: restoredSchema ?? null,
      syntheticInvariants: syntheticInvariants ?? null,
    },
    providersContacted: false,
    storagePayloadVerified: false,
    releaseGate: {
      databaseRestorePassed: status === "passed",
      privateStorageRestorePassed: false,
      providerBackupAvailabilityProven: false,
      repositoryClean: repository?.dirty === false,
      repositoryControlledDatabaseGatePassed:
        status === "passed" && repository?.dirty === false,
    },
    error: error
      ? {
          fingerprintSha256: sha256Bytes(
            error instanceof Error ? error.message : String(error),
          ),
          message: "Restore drill failed closed; inspect protected runner logs.",
          stage: failureStage ?? "unknown",
        }
      : null,
  };
  await writeFile(evidencePath, `${JSON.stringify(evidence, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
}

try {
  currentStage = "input_validation";
  artifact = await inspectRegularFile(argumentsValue.artifact, "Backup artifact");
  manifestFile = await inspectRegularFile(
    argumentsValue.manifest,
    "Backup manifest",
  );
  if (artifact.canonicalPath === manifestFile.canonicalPath) {
    throw new Error("Backup artifact and manifest must be separate files.");
  }
  await assertCustomArchiveMagic(artifact.path);
  [artifactSha256, manifestSha256, repository, migrationContract] =
    await Promise.all([
      sha256File(artifact.path),
      sha256File(manifestFile.path),
      repositoryState(),
      readMigrationContract(root),
    ]);
  manifest = validateRestoreDrillManifest(
    await readJsonFile(manifestFile.path, "Backup manifest"),
    {
      artifactBytes: artifact.bytes,
      artifactFileName: basename(artifact.path),
      artifactSha256,
      commit: repository.commit,
      migrationBundleSha256: migrationContract.bundleSha256,
      migrationHead: migrationContract.head,
    },
  );

  currentStage = "control_attestation";
  const controlUrl = requireRestoreDrillControlUrl(
    process.env.BACKUP_RESTORE_CONTROL_DATABASE_URL,
  );
  await assertPostgres17Tools(controlUrl);
  archiveInspection = await inspectArchive(controlUrl, artifact.path);

  adminPool = createAdminPool(
    controlUrl,
    "le-yard-backup-restore-drill-admin",
  );
  controlAttestation = await attestControlDatabase(adminPool);
  rolesCreated = await ensureRestoreDrillRoles(adminPool);

  databaseNames = {
    reference: createRestoreDrillDatabaseName("reference"),
    restored: createRestoreDrillDatabaseName("restored"),
  };
  await createDisposableDatabase(adminPool, databaseNames.reference);
  databaseLifecycle.reference.created = true;
  await createDisposableDatabase(adminPool, databaseNames.restored);
  databaseLifecycle.restored.created = true;

  currentStage = "reference_build";
  referencePool = createDatabasePool(
    controlUrl,
    databaseNames.reference,
    "le-yard-backup-restore-reference",
  );
  await applyReferenceDatabase(
    referencePool,
    migrationContract,
    root,
    false,
  );
  referenceRoundtripDirectory = await mkdtemp(
    join(tmpdir(), "le-yard-restore-reference-"),
  );
  referenceRoundtripArtifact = join(
    referenceRoundtripDirectory,
    "reference.dump",
  );
  await referencePool.end();
  referencePool = undefined;
  await dumpCustomArchive(
    controlUrl,
    databaseNames.reference,
    referenceRoundtripArtifact,
  );
  await dropDisposableDatabase(adminPool, databaseNames.reference);
  databaseLifecycle.reference.dropped = true;
  await createDisposableDatabase(adminPool, databaseNames.reference);
  databaseLifecycle.reference.dropped = false;
  await restoreArchive(
    controlUrl,
    databaseNames.reference,
    referenceRoundtripArtifact,
  );
  referencePool = createDatabasePool(
    controlUrl,
    databaseNames.reference,
    "le-yard-backup-restore-reference",
  );
  currentStage = "supplied_archive_restore";
  await restoreArchive(controlUrl, databaseNames.restored, artifact.path);
  restoredPool = createDatabasePool(
    controlUrl,
    databaseNames.restored,
    "le-yard-backup-restore-restored",
  );

  currentStage = "restored_contract_verification";
  [referenceSchema, restoredSchema, referenceContract, restoredContract] =
    await Promise.all([
      collectSchemaFingerprint(controlUrl, databaseNames.reference),
      collectSchemaFingerprint(controlUrl, databaseNames.restored),
      collectDatabaseContract(referencePool, migrationContract.versions),
      collectDatabaseContract(restoredPool, migrationContract.versions),
    ]);
  if (referenceSchema.sha256 !== restoredSchema.sha256) {
    throw new Error("Restored schema fingerprint does not match current migrations.");
  }
  if (
    referenceContract.functions.fingerprintSha256 !==
      restoredContract.functions.fingerprintSha256 ||
    JSON.stringify(referenceContract.functions.rows) !==
      JSON.stringify(restoredContract.functions.rows)
  ) {
    throw new Error(
      "Restored function definitions or execution grants do not match current migrations.",
    );
  }
  if (
    referenceContract.rls.fingerprintSha256 !==
      restoredContract.rls.fingerprintSha256 ||
    JSON.stringify(referenceContract.rls.rows) !==
      JSON.stringify(restoredContract.rls.rows)
  ) {
    throw new Error("Restored forced-RLS catalog does not match current migrations.");
  }
  syntheticInvariants = await collectSyntheticInvariants(restoredPool);
  const finalMigrationContract = await readMigrationContract(root);
  if (
    finalMigrationContract.bundleSha256 !== migrationContract.bundleSha256 ||
    finalMigrationContract.head !== migrationContract.head
  ) {
    throw new Error("Migration bundle changed while the restore drill was running.");
  }
} catch (error) {
  primaryError = error;
  failureStage = currentStage;
} finally {
  const cleanupErrors = [];
  const attemptCleanup = async (operation) => {
    try {
      await operation();
    } catch (error) {
      cleanupErrors.push(error);
    }
  };
  await attemptCleanup(async () => referencePool?.end());
  await attemptCleanup(async () => restoredPool?.end());
  if (adminPool && databaseNames?.reference) {
    await attemptCleanup(async () => {
      await dropDisposableDatabase(adminPool, databaseNames.reference);
      databaseLifecycle.reference.dropped = true;
    });
  }
  if (adminPool && databaseNames?.restored) {
    await attemptCleanup(async () => {
      await dropDisposableDatabase(adminPool, databaseNames.restored);
      databaseLifecycle.restored.dropped = true;
    });
  }
  if (adminPool && rolesCreated.length) {
    await attemptCleanup(async () => {
      await dropRestoreDrillRoles(adminPool, rolesCreated);
      rolesRemoved = true;
    });
  }
  if (adminPool && controlAttestation) {
    await attemptCleanup(async () => {
      await attestControlDatabase(adminPool);
      finalControlAttested = true;
    });
  }
  await attemptCleanup(async () => adminPool?.end());
  if (referenceRoundtripArtifact) {
    await attemptCleanup(async () => {
      await unlink(referenceRoundtripArtifact);
      referenceArtifactRemoved = true;
    });
  }
  if (referenceRoundtripDirectory) {
    await attemptCleanup(async () => {
      await rmdir(referenceRoundtripDirectory);
      referenceDirectoryRemoved = true;
    });
  }
  if (cleanupErrors.length) {
    cleanupError = new AggregateError(cleanupErrors, "Restore drill cleanup failed.");
    if (!failureStage) failureStage = "cleanup";
  }
}

const finalError =
  primaryError && cleanupError
    ? new AggregateError([primaryError, cleanupError], "Restore drill and cleanup failed.")
    : primaryError ?? cleanupError;

try {
  await writeEvidence(finalError ? "failed" : "passed", finalError);
} catch (error) {
  throw new AggregateError(
    finalError ? [finalError, error] : [error],
    "Restore drill evidence could not be retained.",
  );
}

if (finalError) throw finalError;

process.stdout.write(
  `PASS disposable PostgreSQL restore, schema/RLS/grants, and synthetic provider-off invariants\n`,
);
process.stdout.write(`EVIDENCE ${evidencePath}\n`);
