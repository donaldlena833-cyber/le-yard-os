import { randomUUID } from "node:crypto";
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
import { basename, isAbsolute, join, relative, resolve, sep } from "node:path";
import { promisify } from "node:util";
import {
  assertCustomArchiveMagic,
  fingerprintUntrackedFiles,
  inspectRegularFile,
  parseRestoreDrillArguments,
  readJsonFile,
  readMigrationContract,
  readSeedContract,
  requireRestoreDrillProvenanceKey,
  sha256Bytes,
  sha256File,
  validateRestoreDrillManifest,
} from "./lib/backup-restore-drill-contract.mjs";
import {
  acquireRestoreDrillLease,
  applyReferenceDatabase,
  assertPostgres17Tools,
  attestControlDatabase,
  attestFreshDisposableDatabase,
  attestLocalPostgresDataDirectory,
  attestTemplateOne,
  collectDatabaseContract,
  collectSchemaFingerprint,
  collectSyntheticDataFingerprint,
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
  releaseRestoreDrillLease,
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
let repositoryInitial;
let repositoryFinal;
let migrationContract;
let seedContract;
let controlAttestation;
let localProcessAttestation;
let templateOneAttested = false;
let archiveInspection;
let referenceSchema;
let restoredSchema;
let referenceContract;
let restoredContract;
let syntheticInvariants;
let referenceDataFingerprint;
let independentReferenceDataFingerprint;
let restoredDataFingerprint;
let fingerprintSensitivityPassed = false;
let businessTimestampMutationChangesFingerprint = false;
let wrongDemoPasswordRejected = false;
let databaseNames;
let adminPool;
let adminClient;
let referencePool;
let restoredPool;
let rolesCreated = [];
let rolesRemoved = false;
let finalControlAttested = false;
let leaseReleased = false;
let referenceRoundtripDirectory;
let referenceRoundtripArtifact;
let referenceArtifactRemoved = false;
let referenceDirectoryRemoved = false;
let inputSnapshotDirectory;
let inputSnapshotArtifact;
let inputSnapshotManifest;
let inputSnapshotRemoved = false;
let suppliedArtifactFileName;
const databaseLifecycle = {
  reference: { created: false, dropped: false },
  restored: { created: false, dropped: false },
};
let cleanupError;
let primaryError;
let currentStage = "input_validation";
let failureStage;

async function repositoryState() {
  const [
    { stdout: commitOutput },
    { stdout: statusOutput },
    { stdout: diffOutput },
    { stdout: untrackedOutput },
  ] =
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
      execFileAsync("git", ["diff", "--binary", "--no-ext-diff", "HEAD", "--"], {
        cwd: root,
        encoding: "utf8",
        maxBuffer: 50 * 1024 * 1024,
      }),
      execFileAsync(
        "git",
        ["ls-files", "--others", "--exclude-standard", "-z"],
        {
          cwd: root,
          encoding: "utf8",
          maxBuffer: 10 * 1024 * 1024,
        },
      ),
    ]);
  const commit = commitOutput.trim();
  if (!/^[0-9a-f]{40}$/.test(commit)) {
    throw new Error("The checked-out Git commit is not a full SHA-1 object ID.");
  }
  const changedPaths = statusOutput
    .split("\n")
    .filter(Boolean)
    .map((line) => line.slice(3));
  const untrackedFiles = await fingerprintUntrackedFiles(
    root,
    untrackedOutput.split("\0").filter(Boolean),
  );
  return {
    changedPathCount: changedPaths.length,
    commit,
    dirty: changedPaths.length > 0,
    stateFingerprintSha256: sha256Bytes(
      `${statusOutput}\0${diffOutput}\0${untrackedFiles.sha256}`,
    ),
    untrackedFileCount: untrackedFiles.fileCount,
    untrackedTotalBytes: untrackedFiles.totalBytes,
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
  const repositoryRelativePath = relative(root, canonicalDirectory);
  const insideRepository =
    repositoryRelativePath === "" ||
    (!repositoryRelativePath.startsWith(`..${sep}`) &&
      repositoryRelativePath !== ".." &&
      !isAbsolute(repositoryRelativePath));
  if (insideRepository) {
    let ignored = false;
    try {
      await execFileAsync(
        "git",
        ["check-ignore", "--quiet", "--no-index", "--", canonicalDirectory],
        { cwd: root },
      );
      ignored = true;
    } catch (error) {
      if (!(error && typeof error === "object" && error.code === 1)) throw error;
    }
    if (!ignored) {
      throw new Error(
        "Evidence inside the repository must use an ignored output directory.",
      );
    }
  }
}

async function unlinkIfPresent(path) {
  try {
    await unlink(path);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") return;
    throw error;
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
      anonymousRelationPrivilegeCount:
        contract.rls.anonymousRelationPrivilegeCount,
      anonymousSequencePrivilegeCount:
        contract.rls.anonymousSequencePrivilegeCount,
      relationCount: contract.rls.relationAccessRows.length,
      sequenceCount: contract.rls.sequenceAccessRows.length,
      sha256: contract.rls.fingerprintSha256,
      tableCount: contract.rls.tableCount,
    },
    schemas: contract.schemas,
  };
}

function publicDataFingerprint(fingerprint) {
  if (!fingerprint) return null;
  return {
    sha256: fingerprint.sha256,
    tableCount: fingerprint.tableCount,
    totalRowCount: fingerprint.totalRowCount,
  };
}

function fingerprintDifferenceNames(left, right) {
  const differences = [];
  const leftTables = new Map(
    (left?.catalog?.tables ?? []).map((table) => [table.name, table]),
  );
  const rightTables = new Map(
    (right?.catalog?.tables ?? []).map((table) => [table.name, table]),
  );
  for (const name of new Set([...leftTables.keys(), ...rightTables.keys()])) {
    if (JSON.stringify(leftTables.get(name)) !== JSON.stringify(rightTables.get(name))) {
      differences.push(name);
    }
  }
  if (
    JSON.stringify(left?.catalog?.sequences) !==
    JSON.stringify(right?.catalog?.sequences)
  ) {
    differences.push("<sequence-state>");
  }
  return differences.sort();
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
    repository: {
      initial: repositoryInitial ?? null,
      final: repositoryFinal ?? null,
      stateUnchanged:
        Boolean(repositoryInitial && repositoryFinal) &&
        repositoryInitial.commit === repositoryFinal.commit &&
        repositoryInitial.stateFingerprintSha256 ===
          repositoryFinal.stateFingerprintSha256,
    },
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
          artifactFileName: suppliedArtifactFileName ?? null,
          artifactSha256: artifactSha256 ?? null,
          manifestSha256: manifestSha256 ?? null,
          provenanceAuthenticated: Boolean(manifest),
          provenanceKeyId: manifest?.provenance?.keyId ?? null,
        }
      : null,
    sourceAttestation: manifest?.source ?? null,
    postgres: controlAttestation
      ? {
          clientMajor: 17,
          dedicatedCluster: true,
          otherDatabaseCount: controlAttestation.otherDatabaseCount,
          otherClientCount: controlAttestation.otherClientCount,
          otherUserRoleCount: controlAttestation.otherUserRoleCount,
          serverAddressClass: "loopback",
          serverMajor: controlAttestation.major,
          serverVersionNumber: controlAttestation.serverVersionNumber,
          localProcess: localProcessAttestation ?? null,
          templateOneFreshCatalogAttested: templateOneAttested,
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
      privateInputSnapshotRemoved: !inputSnapshotDirectory || inputSnapshotRemoved,
      clusterLeaseReleased: leaseReleased,
    },
    archive: archiveInspection ?? null,
    reference: {
      contract: publicDatabaseContract(referenceContract),
      dataFingerprint: publicDataFingerprint(referenceDataFingerprint),
      independentSeedRebuild:
        publicDataFingerprint(independentReferenceDataFingerprint),
      deliberateMutationChangesFingerprint: fingerprintSensitivityPassed,
      businessTimestampMutationChangesFingerprint,
      wrongDemoPasswordRejected,
      schema: referenceSchema ?? null,
    },
    restored: {
      contract: publicDatabaseContract(restoredContract),
      dataFingerprint: publicDataFingerprint(restoredDataFingerprint),
      schema: restoredSchema ?? null,
      syntheticInvariants: syntheticInvariants ?? null,
    },
    providersContacted: false,
    storagePayloadVerified: false,
    releaseGate: {
      databaseRestorePassed: status === "passed",
      privateStorageRestorePassed: false,
      providerBackupAvailabilityProven: false,
      repositoryClean:
        repositoryInitial?.dirty === false && repositoryFinal?.dirty === false,
      repositoryStateUnchanged:
        Boolean(repositoryInitial && repositoryFinal) &&
        repositoryInitial.commit === repositoryFinal.commit &&
        repositoryInitial.stateFingerprintSha256 ===
          repositoryFinal.stateFingerprintSha256,
      repositoryControlledDatabaseGatePassed:
        status === "passed" &&
        repositoryInitial?.dirty === false &&
        repositoryFinal?.dirty === false &&
        repositoryInitial.commit === repositoryFinal.commit &&
        repositoryInitial.stateFingerprintSha256 ===
          repositoryFinal.stateFingerprintSha256,
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
  await prepareEvidenceDirectory();
  const suppliedArtifact = await inspectRegularFile(
    argumentsValue.artifact,
    "Backup artifact",
  );
  const suppliedManifest = await inspectRegularFile(
    argumentsValue.manifest,
    "Backup manifest",
  );
  if (suppliedArtifact.canonicalPath === suppliedManifest.canonicalPath) {
    throw new Error("Backup artifact and manifest must be separate files.");
  }
  suppliedArtifactFileName = basename(suppliedArtifact.path);
  inputSnapshotDirectory = await mkdtemp(
    join(tmpdir(), "le-yard-restore-input-"),
  );
  await chmod(inputSnapshotDirectory, 0o700);
  inputSnapshotArtifact = join(inputSnapshotDirectory, "supplied.dump");
  inputSnapshotManifest = join(inputSnapshotDirectory, "supplied.manifest.json");
  await copyFile(
    suppliedArtifact.path,
    inputSnapshotArtifact,
    constants.COPYFILE_EXCL,
  );
  await copyFile(
    suppliedManifest.path,
    inputSnapshotManifest,
    constants.COPYFILE_EXCL,
  );
  await Promise.all([
    chmod(inputSnapshotArtifact, 0o600),
    chmod(inputSnapshotManifest, 0o600),
  ]);
  artifact = await inspectRegularFile(inputSnapshotArtifact, "Pinned backup artifact");
  manifestFile = await inspectRegularFile(
    inputSnapshotManifest,
    "Pinned backup manifest",
  );
  await assertCustomArchiveMagic(artifact.path);
  [
    artifactSha256,
    manifestSha256,
    repositoryInitial,
    migrationContract,
    seedContract,
  ] =
    await Promise.all([
      sha256File(artifact.path),
      sha256File(manifestFile.path),
      repositoryState(),
      readMigrationContract(root),
      readSeedContract(root),
    ]);
  manifest = validateRestoreDrillManifest(
    await readJsonFile(manifestFile.path, "Backup manifest"),
    {
      artifactBytes: artifact.bytes,
      artifactFileName: suppliedArtifactFileName,
      artifactSha256,
      commit: repositoryInitial.commit,
      migrationBundleSha256: migrationContract.bundleSha256,
      migrationHead: migrationContract.head,
      provenanceKey: requireRestoreDrillProvenanceKey(
        process.env.BACKUP_RESTORE_PROVENANCE_KEY,
      ),
      seedSha256: seedContract.sha256,
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
  adminClient = await acquireRestoreDrillLease(adminPool);
  localProcessAttestation = await attestLocalPostgresDataDirectory(
    adminClient,
    controlUrl,
    process.env.BACKUP_RESTORE_PGDATA,
  );
  controlAttestation = await attestControlDatabase(adminClient);
  await attestTemplateOne(controlUrl);
  templateOneAttested = true;
  rolesCreated = await ensureRestoreDrillRoles(adminClient);

  databaseNames = {
    reference: createRestoreDrillDatabaseName("reference"),
    restored: createRestoreDrillDatabaseName("restored"),
  };
  await createDisposableDatabase(adminClient, databaseNames.reference);
  databaseLifecycle.reference.created = true;
  await createDisposableDatabase(adminClient, databaseNames.restored);
  databaseLifecycle.restored.created = true;

  currentStage = "reference_build";
  referencePool = createDatabasePool(
    controlUrl,
    databaseNames.reference,
    "le-yard-backup-restore-reference",
  );
  await attestFreshDisposableDatabase(referencePool);
  await applyReferenceDatabase(
    referencePool,
    migrationContract,
    root,
    seedContract,
  );
  referenceDataFingerprint = await collectSyntheticDataFingerprint(referencePool);

  restoredPool = createDatabasePool(
    controlUrl,
    databaseNames.restored,
    "le-yard-backup-restore-independent-seed-reference",
  );
  await attestFreshDisposableDatabase(restoredPool);
  await applyReferenceDatabase(
    restoredPool,
    migrationContract,
    root,
    seedContract,
  );
  independentReferenceDataFingerprint =
    await collectSyntheticDataFingerprint(restoredPool);
  if (
    referenceDataFingerprint.sha256 !== independentReferenceDataFingerprint.sha256 ||
    JSON.stringify(referenceDataFingerprint.catalog) !==
      JSON.stringify(independentReferenceDataFingerprint.catalog)
  ) {
    throw new Error(
      `Two independent synthetic reference builds are not deterministic: ${fingerprintDifferenceNames(referenceDataFingerprint, independentReferenceDataFingerprint).join(", ")}.`,
    );
  }
  const sensitivityClient = await restoredPool.connect();
  try {
    await sensitivityClient.query("begin");
    await sensitivityClient.query(`
      update public.guests
      set display_name = display_name || ' [restore-drill-mutation]'
      where id = '80000000-0000-4000-8000-000000000001'
    `);
    const mutatedFingerprint =
      await collectSyntheticDataFingerprint(sensitivityClient);
    if (mutatedFingerprint.sha256 === independentReferenceDataFingerprint.sha256) {
      throw new Error("Synthetic fingerprint did not detect a deliberate guest mutation.");
    }
    fingerprintSensitivityPassed = true;
    await sensitivityClient.query("rollback");
  } catch (error) {
    try {
      await sensitivityClient.query("rollback");
    } catch {
      // Preserve the sensitivity proof failure.
    }
    throw error;
  } finally {
    sensitivityClient.release();
  }
  const timestampProofClient = await restoredPool.connect();
  try {
    await timestampProofClient.query("begin");
    await timestampProofClient.query(`
      update public.tasks
      set due_at = timestamptz '2099-01-01 00:00:00+00'
      where id = '81000000-0000-4000-8000-000000000001'
    `);
    const mutatedFingerprint =
      await collectSyntheticDataFingerprint(timestampProofClient);
    if (mutatedFingerprint.sha256 === independentReferenceDataFingerprint.sha256) {
      throw new Error("Synthetic fingerprint did not detect a task due-at mutation.");
    }
    businessTimestampMutationChangesFingerprint = true;
    await timestampProofClient.query("rollback");
  } catch (error) {
    try {
      await timestampProofClient.query("rollback");
    } catch {
      // Preserve the business-timestamp sensitivity proof failure.
    }
    throw error;
  } finally {
    timestampProofClient.release();
  }
  const passwordProofClient = await restoredPool.connect();
  try {
    await passwordProofClient.query("begin");
    await passwordProofClient.query(`
      update auth.users
      set encrypted_password = extensions.crypt(
        'Not-the-approved-demo-password!',
        extensions.gen_salt('bf')
      )
      where id = '10000000-0000-4000-8000-000000000001'
    `);
    try {
      await collectSyntheticDataFingerprint(passwordProofClient);
    } catch (error) {
      if (
        error instanceof Error &&
        error.message.includes("approved demo password hash")
      ) {
        wrongDemoPasswordRejected = true;
      } else {
        throw error;
      }
    }
    if (!wrongDemoPasswordRejected) {
      throw new Error("Synthetic fingerprint accepted a wrong demo password hash.");
    }
    await passwordProofClient.query("rollback");
  } catch (error) {
    try {
      await passwordProofClient.query("rollback");
    } catch {
      // Preserve the password-boundary proof failure.
    }
    throw error;
  } finally {
    passwordProofClient.release();
  }
  await restoredPool.end();
  restoredPool = undefined;
  await dropDisposableDatabase(adminClient, databaseNames.restored);
  databaseLifecycle.restored.dropped = true;
  await createDisposableDatabase(adminClient, databaseNames.restored);
  databaseLifecycle.restored.dropped = false;
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
  await dropDisposableDatabase(adminClient, databaseNames.reference);
  databaseLifecycle.reference.dropped = true;
  await createDisposableDatabase(adminClient, databaseNames.reference);
  databaseLifecycle.reference.dropped = false;
  referencePool = createDatabasePool(
    controlUrl,
    databaseNames.reference,
    "le-yard-backup-restore-reference-fresh-attestation",
  );
  await attestFreshDisposableDatabase(referencePool);
  await referencePool.end();
  referencePool = undefined;
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
  restoredPool = createDatabasePool(
    controlUrl,
    databaseNames.restored,
    "le-yard-backup-restore-restored-fresh-attestation",
  );
  await attestFreshDisposableDatabase(restoredPool);
  await restoredPool.end();
  restoredPool = undefined;
  await restoreArchive(controlUrl, databaseNames.restored, artifact.path);
  restoredPool = createDatabasePool(
    controlUrl,
    databaseNames.restored,
    "le-yard-backup-restore-restored",
  );

  currentStage = "restored_contract_verification";
  [
    referenceSchema,
    restoredSchema,
    referenceContract,
    restoredContract,
    referenceDataFingerprint,
    restoredDataFingerprint,
  ] =
    await Promise.all([
      collectSchemaFingerprint(controlUrl, databaseNames.reference),
      collectSchemaFingerprint(controlUrl, databaseNames.restored),
      collectDatabaseContract(referencePool, migrationContract.versions),
      collectDatabaseContract(restoredPool, migrationContract.versions),
      collectSyntheticDataFingerprint(referencePool),
      collectSyntheticDataFingerprint(restoredPool),
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
  if (
    referenceDataFingerprint.sha256 !== restoredDataFingerprint.sha256 ||
    JSON.stringify(referenceDataFingerprint.catalog) !==
      JSON.stringify(restoredDataFingerprint.catalog) ||
    manifest.source.dataFingerprintSha256 !== referenceDataFingerprint.sha256
  ) {
    throw new Error(
      "Restored data does not exactly match the normalized repository synthetic fixture.",
    );
  }
  syntheticInvariants = await collectSyntheticInvariants(restoredPool);
  const [finalMigrationContract, finalSeedContract] = await Promise.all([
    readMigrationContract(root),
    readSeedContract(root),
  ]);
  if (
    finalMigrationContract.bundleSha256 !== migrationContract.bundleSha256 ||
    finalMigrationContract.head !== migrationContract.head ||
    finalSeedContract.sha256 !== seedContract.sha256
  ) {
    throw new Error("Migration bundle or seed changed while the restore drill was running.");
  }
  const [finalArtifactHash, finalManifestHash, finalArtifact] = await Promise.all([
    sha256File(artifact.path),
    sha256File(manifestFile.path),
    inspectRegularFile(artifact.path, "Pinned backup artifact"),
  ]);
  if (
    finalArtifactHash !== artifactSha256 ||
    finalManifestHash !== manifestSha256 ||
    finalArtifact.bytes !== artifact.bytes
  ) {
    throw new Error("Pinned backup input changed while the restore drill was running.");
  }
  repositoryFinal = await repositoryState();
  if (
    repositoryFinal.commit !== repositoryInitial.commit ||
    repositoryFinal.stateFingerprintSha256 !==
      repositoryInitial.stateFingerprintSha256
  ) {
    throw new Error("Repository state changed while the restore drill was running.");
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
  if (adminClient && databaseNames?.reference) {
    await attemptCleanup(async () => {
      await dropDisposableDatabase(adminClient, databaseNames.reference);
      databaseLifecycle.reference.dropped = true;
    });
  }
  if (adminClient && databaseNames?.restored) {
    await attemptCleanup(async () => {
      await dropDisposableDatabase(adminClient, databaseNames.restored);
      databaseLifecycle.restored.dropped = true;
    });
  }
  if (adminClient && rolesCreated.length) {
    await attemptCleanup(async () => {
      await dropRestoreDrillRoles(adminClient, rolesCreated);
      rolesRemoved = true;
    });
  }
  if (adminClient && controlAttestation) {
    await attemptCleanup(async () => {
      await attestControlDatabase(adminClient);
      finalControlAttested = true;
    });
  }
  if (adminClient) {
    await attemptCleanup(async () => {
      await releaseRestoreDrillLease(adminClient);
      leaseReleased = true;
    });
  }
  await attemptCleanup(async () => adminPool?.end());
  if (referenceRoundtripArtifact) {
    await attemptCleanup(async () => {
      await unlinkIfPresent(referenceRoundtripArtifact);
      referenceArtifactRemoved = true;
    });
  }
  if (referenceRoundtripDirectory) {
    await attemptCleanup(async () => {
      await rmdir(referenceRoundtripDirectory);
      referenceDirectoryRemoved = true;
    });
  }
  if (inputSnapshotArtifact) {
    await attemptCleanup(async () => unlinkIfPresent(inputSnapshotArtifact));
  }
  if (inputSnapshotManifest) {
    await attemptCleanup(async () => unlinkIfPresent(inputSnapshotManifest));
  }
  if (inputSnapshotDirectory) {
    await attemptCleanup(async () => {
      await rmdir(inputSnapshotDirectory);
      inputSnapshotRemoved = true;
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
