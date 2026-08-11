import { execFile } from "node:child_process";
import { lstat, mkdir, realpath, writeFile } from "node:fs/promises";
import { basename, dirname, resolve } from "node:path";
import { promisify } from "node:util";
import {
  RESTORE_DRILL_FIXTURE_CONTRACT,
  RESTORE_DRILL_MANIFEST_KIND,
  RESTORE_DRILL_MANIFEST_VERSION,
  RESTORE_DRILL_POSTGRES_MAJOR,
  RESTORE_DRILL_SOURCE_CLASSIFICATION,
  inspectRegularFile,
  readMigrationContract,
  sha256File,
} from "./lib/backup-restore-drill-contract.mjs";
import {
  applyReferenceDatabase,
  assertPostgres17Tools,
  attestControlDatabase,
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

async function requireRealParent(path) {
  const parent = dirname(path);
  await mkdir(parent, { recursive: true, mode: 0o700 });
  const stat = await lstat(parent);
  if (stat.isSymbolicLink() || !stat.isDirectory()) {
    throw new Error("Synthetic backup output parent must be a real directory.");
  }
  await realpath(parent);
}

const output = parseArguments(process.argv.slice(2));
await requireRealParent(output.artifact);
await requireRealParent(output.manifest);
await requireUnusedOutput(output.artifact, "Synthetic backup artifact");
await requireUnusedOutput(output.manifest, "Synthetic backup manifest");

const controlUrl = requireRestoreDrillControlUrl(
  process.env.BACKUP_RESTORE_CONTROL_DATABASE_URL,
);
const [{ stdout: commitOutput }, migrationContract] = await Promise.all([
  execFileAsync("git", ["rev-parse", "HEAD"], { cwd: root, encoding: "utf8" }),
  readMigrationContract(root),
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
let rolesCreated = [];
let sourceCreated = false;
let controlAttested = false;
let primaryError;
let cleanupError;

try {
  await attestControlDatabase(adminPool);
  controlAttested = true;
  rolesCreated = await ensureRestoreDrillRoles(adminPool);
  await createDisposableDatabase(adminPool, sourceDatabase);
  sourceCreated = true;
  sourcePool = createDatabasePool(
    controlUrl,
    sourceDatabase,
    "le-yard-synthetic-backup-source",
  );
  await applyReferenceDatabase(sourcePool, migrationContract, root, true);
  await collectSyntheticInvariants(sourcePool);
  await sourcePool.end();
  sourcePool = undefined;
  await dumpCustomArchive(controlUrl, sourceDatabase, output.artifact);
  await inspectArchive(controlUrl, output.artifact);
  const finalMigrationContract = await readMigrationContract(root);
  if (
    finalMigrationContract.bundleSha256 !== migrationContract.bundleSha256 ||
    finalMigrationContract.head !== migrationContract.head
  ) {
    throw new Error("Migration bundle changed while the synthetic backup was created.");
  }

  const artifact = await inspectRegularFile(
    output.artifact,
    "Synthetic backup artifact",
  );
  const manifest = {
    manifestVersion: RESTORE_DRILL_MANIFEST_VERSION,
    kind: RESTORE_DRILL_MANIFEST_KIND,
    createdAt: new Date().toISOString(),
    artifact: {
      bytes: artifact.bytes,
      fileName: basename(artifact.path),
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
      fixtureContract: RESTORE_DRILL_FIXTURE_CONTRACT,
      providersDisabled: true,
      storagePayloadIncluded: false,
    },
  };
  await writeFile(output.manifest, `${JSON.stringify(manifest, null, 2)}\n`, {
    encoding: "utf8",
    flag: "wx",
    mode: 0o600,
  });
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
  if (sourceCreated) {
    await attemptCleanup(async () =>
      dropDisposableDatabase(adminPool, sourceDatabase),
    );
  }
  if (rolesCreated.length) {
    await attemptCleanup(async () =>
      dropRestoreDrillRoles(adminPool, rolesCreated),
    );
  }
  if (controlAttested) {
    await attemptCleanup(async () => attestControlDatabase(adminPool));
  }
  await attemptCleanup(async () => adminPool.end());
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

process.stdout.write(`ARTIFACT ${output.artifact}\n`);
process.stdout.write(`MANIFEST ${output.manifest}\n`);
