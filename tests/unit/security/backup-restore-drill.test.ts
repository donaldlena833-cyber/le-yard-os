import { mkdtemp, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESTORE_DRILL_FIXTURE_CONTRACT,
  RESTORE_DRILL_MANIFEST_KIND,
  RESTORE_DRILL_MANIFEST_VERSION,
  RESTORE_DRILL_SOURCE_CLASSIFICATION,
  createRestoreDrillProvenance,
  fingerprintUntrackedFiles,
  parseRestoreDrillArguments,
  readMigrationContract,
  validateRestoreDrillManifest,
} from "../../../scripts/lib/backup-restore-drill-contract.mjs";
import {
  attestControlDatabase,
  attestLocalPostgresDataDirectory,
  createRestoreDrillDatabaseName,
  postgresCommandEnvironment,
  requireRestoreDrillControlUrl,
} from "../../../scripts/lib/restore-drill-postgres.mjs";

const expected = {
  artifactBytes: 512,
  artifactFileName: "synthetic.dump",
  artifactSha256: "a".repeat(64),
  commit: "b".repeat(40),
  migrationBundleSha256: "c".repeat(64),
  migrationHead: "20260811092658",
  provenanceKey: "1".repeat(64),
  seedSha256: "d".repeat(64),
};

function manifest() {
  const unsignedManifest = {
    manifestVersion: RESTORE_DRILL_MANIFEST_VERSION,
    kind: RESTORE_DRILL_MANIFEST_KIND,
    createdAt: "2026-08-11T12:00:00.000Z",
    artifact: {
      bytes: expected.artifactBytes,
      fileName: expected.artifactFileName,
      format: "pg_dump_custom",
      sha256: expected.artifactSha256,
    },
    database: { postgresMajor: 17 },
    repository: {
      commit: expected.commit,
      migrationBundleSha256: expected.migrationBundleSha256,
      migrationHead: expected.migrationHead,
    },
    source: {
      classification: RESTORE_DRILL_SOURCE_CLASSIFICATION,
      dataFingerprintSha256: "e".repeat(64),
      fixtureContract: RESTORE_DRILL_FIXTURE_CONTRACT,
      providersDisabled: true,
      seedSha256: expected.seedSha256,
      storagePayloadIncluded: false,
    },
  };
  return {
    ...unsignedManifest,
    provenance: createRestoreDrillProvenance(
      unsignedManifest,
      expected.provenanceKey,
    ),
  };
}

describe("disposable backup/restore drill safety contract", () => {
  it("accepts only the exact artifact, commit, migration bundle, and synthetic source", () => {
    expect(validateRestoreDrillManifest(manifest(), expected)).toEqual(manifest());
  });

  it("fingerprints every legacy and current migration with the exact latest head", async () => {
    const contract = await readMigrationContract(process.cwd());
    expect(contract.files.length).toBeGreaterThan(0);
    expect(contract.files).toHaveLength(contract.versions.length);
    expect(contract.files).toHaveLength(contract.fileSha256.length);
    expect(contract.versions[0]).toBe("202608010001");
    expect(contract.versions.every((version) => /^\d{12}(?:\d{2})?$/.test(version))).toBe(true);
    expect(contract.head).toBe(contract.versions.at(-1));
    expect(contract.head).toMatch(/^\d{14}$/);
    expect(contract.bundleSha256).toMatch(/^[0-9a-f]{64}$/);
    expect(contract.fileSha256.every((hash) => /^[0-9a-f]{64}$/.test(hash))).toBe(true);
  });

  it("binds repository evidence to untracked bytes and rejects symlinks", async () => {
    const directory = await mkdtemp(join(tmpdir(), "le-yard-untracked-proof-"));
    try {
      await writeFile(join(directory, "fixture.sql"), "beta", "utf8");
      const first = await fingerprintUntrackedFiles(directory, ["fixture.sql"]);
      const repeated = await fingerprintUntrackedFiles(directory, ["fixture.sql"]);
      expect(repeated).toEqual(first);
      await writeFile(join(directory, "fixture.sql"), "zeta", "utf8");
      const mutated = await fingerprintUntrackedFiles(directory, ["fixture.sql"]);
      expect(mutated.sha256).not.toBe(first.sha256);
      expect(mutated.fileCount).toBe(1);
      expect(mutated.totalBytes).toBe(4);

      await symlink("fixture.sql", join(directory, "fixture-link.sql"));
      await expect(
        fingerprintUntrackedFiles(directory, ["fixture-link.sql"]),
      ).rejects.toThrow(/regular files/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it.each([
    ["production source", (value: ReturnType<typeof manifest>) => {
      value.source.classification = "production";
    }, /Production, shared, and non-synthetic/],
    ["enabled provider", (value: ReturnType<typeof manifest>) => {
      value.source.providersDisabled = false;
    }, /every provider is disabled/],
    ["claimed Storage payload", (value: ReturnType<typeof manifest>) => {
      value.source.storagePayloadIncluded = true;
    }, /must not claim/],
    ["wrong commit", (value: ReturnType<typeof manifest>) => {
      value.repository.commit = "d".repeat(40);
    }, /commit does not match/],
    ["wrong migration bundle", (value: ReturnType<typeof manifest>) => {
      value.repository.migrationBundleSha256 = "d".repeat(64);
    }, /migration bundle hash does not match/],
    ["wrong artifact hash", (value: ReturnType<typeof manifest>) => {
      value.artifact.sha256 = "d".repeat(64);
    }, /artifact hash does not match/],
    ["wrong seed hash", (value: ReturnType<typeof manifest>) => {
      value.source.seedSha256 = "f".repeat(64);
    }, /seed hash does not match/],
  ])("rejects %s", (_label, mutate, pattern) => {
    const value = manifest();
    mutate(value);
    expect(() => validateRestoreDrillManifest(value, expected)).toThrow(pattern);
  });

  it("rejects ambiguous extra manifest fields", () => {
    expect(() =>
      validateRestoreDrillManifest(
        { ...manifest(), environment: "nonproduction" },
        expected,
      ),
    ).toThrow(/must contain exactly/);
  });

  it("authenticates the complete manifest before restore", () => {
    const value = manifest();
    value.source.dataFingerprintSha256 = "f".repeat(64);
    expect(() => validateRestoreDrillManifest(value, expected)).toThrow(
      /provenance authentication failed/,
    );
    expect(() =>
      validateRestoreDrillManifest(manifest(), {
        ...expected,
        provenanceKey: "2".repeat(64),
      }),
    ).toThrow(/provenance authentication failed/);
  });

  it.each([
    [undefined, /is required/],
    ["postgres://postgres:postgres@example.com:5432/postgres", /loopback/],
    ["postgres://postgres:postgres@127.0.0.1:5432/app", /control database/],
    ["postgres://app:postgres@127.0.0.1:5432/postgres", /postgres control role/],
    ["postgres://postgres:postgres@127.0.0.1:5432/postgres?sslmode=require", /query parameters/],
  ])("rejects unsafe control URL %s", (value, pattern) => {
    expect(() => requireRestoreDrillControlUrl(value)).toThrow(pattern);
  });

  it("accepts only the loopback postgres control database", () => {
    const controlUrl = requireRestoreDrillControlUrl(
      "postgres://postgres:postgres@127.0.0.1:5432/postgres",
    );
    expect(controlUrl.pathname).toBe("/postgres");
    const commandEnvironment = postgresCommandEnvironment(controlUrl);
    expect(commandEnvironment).toMatchObject({
      PGCONNECT_TIMEOUT: "5",
      PGDATABASE: "postgres",
      PGHOST: "127.0.0.1",
      PGPASSWORD: "postgres",
      PGPORT: "5432",
      PGSSLMODE: "disable",
      PGUSER: "postgres",
    });
    expect(commandEnvironment).not.toHaveProperty("HOME");
    expect(commandEnvironment).not.toHaveProperty("PGOPTIONS");
    expect(commandEnvironment).not.toHaveProperty("SUPABASE_SERVICE_ROLE_KEY");
  });

  it("requires an absolute local PGDATA ownership proof", async () => {
    const controlUrl = requireRestoreDrillControlUrl(
      "postgres://postgres:postgres@127.0.0.1:5432/postgres",
    );
    await expect(
      attestLocalPostgresDataDirectory({} as never, controlUrl, undefined),
    ).rejects.toThrow(/BACKUP_RESTORE_PGDATA must be an absolute/);
    await expect(
      attestLocalPostgresDataDirectory({} as never, controlUrl, "relative/pgdata"),
    ).rejects.toThrow(/BACKUP_RESTORE_PGDATA must be an absolute/);
  });

  it("attests an empty dedicated PG17 cluster and rejects shared catalog state", async () => {
    const fresh = {
      database_name: "postgres",
      user_name: "postgres",
      server_version_num: 170010,
      server_address: "127.0.0.1/32",
      in_recovery: false,
      is_superuser: true,
      can_create_database: true,
      other_database_count: 0,
      control_object_count: 0,
      replication_slot_count: 0,
      subscription_count: 0,
      other_user_role_count: 0,
      other_client_count: 0,
    };
    const pool = (row: typeof fresh) => ({
      query: async () => ({ rows: [row] }),
    });
    await expect(attestControlDatabase(pool(fresh))).resolves.toMatchObject({
      major: 17,
      otherDatabaseCount: 0,
      otherUserRoleCount: 0,
    });
    await expect(
      attestControlDatabase(pool({ ...fresh, other_database_count: 1 })),
    ).rejects.toThrow(/empty, dedicated/);
    await expect(
      attestControlDatabase(pool({ ...fresh, server_address: "172.18.0.2/16" })),
    ).rejects.toThrow(/empty, dedicated/);
    await expect(
      attestControlDatabase(pool({ ...fresh, other_user_role_count: 1 })),
    ).rejects.toThrow(/empty, dedicated/);
  });

  it("generates narrowly named disposable database targets", () => {
    expect(createRestoreDrillDatabaseName("reference")).toMatch(
      /^le_yard_restore_reference_[0-9a-f]{32}$/,
    );
    expect(createRestoreDrillDatabaseName("restored")).toMatch(
      /^le_yard_restore_restored_[0-9a-f]{32}$/,
    );
    expect(() => createRestoreDrillDatabaseName("production")).toThrow(
      /Unknown restore drill database kind/,
    );
  });

  it("requires all verifier paths and rejects unknown options", () => {
    expect(
      parseRestoreDrillArguments([
        "--artifact",
        "fixture.dump",
        "--manifest",
        "fixture.json",
        "--evidence-directory",
        "evidence",
      ]),
    ).toEqual({
      artifact: "fixture.dump",
      manifest: "fixture.json",
      evidenceDirectory: "evidence",
    });
    expect(() =>
      parseRestoreDrillArguments(["--artifact", "fixture.dump"]),
    ).toThrow(/Usage/);
    expect(() =>
      parseRestoreDrillArguments([
        "--artifact",
        "fixture.dump",
        "--provider",
        "supabase",
      ]),
    ).toThrow(/Unknown restore drill option/);
  });

  it("keeps the manual workflow synthetic, PG17-only, and evidence-only", async () => {
    const root = process.cwd();
    const workflow = await readFile(
      join(root, ".github", "workflows", "backup-restore-drill.yml"),
      "utf8",
    );
    const uploadStep = workflow.slice(workflow.indexOf("actions/upload-artifact"));
    const jobHeader = workflow.slice(0, workflow.indexOf("steps:"));
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain('/usr/lib/postgresql/17/bin');
    expect(workflow).toContain("https://apt.postgresql.org/pub/repos/apt");
    expect(workflow).toContain("postgresql-client-17");
    expect(workflow).toContain('initdb -D "$RESTORE_DRILL_PGDATA"');
    expect(workflow).toContain("RESTORE_DRILL_DIRECTORY=$RUNNER_TEMP/");
    expect(workflow).toContain("BACKUP_RESTORE_PGDATA=$RUNNER_TEMP/");
    expect(workflow).toContain("BACKUP_RESTORE_PROVENANCE_KEY=");
    expect(workflow).toContain("::add-mask::");
    expect(jobHeader).not.toContain("runner.temp");
    expect(workflow).toContain('-h 127.0.0.1');
    expect(workflow).toContain("BACKUP_RESTORE_CONTROL_DATABASE_URL");
    expect(workflow).not.toMatch(/supabase\s+(?:db|projects|backups)/i);
    expect(uploadStep).toContain("evidence/*.json");
    expect(uploadStep).toContain("synthetic.manifest.json");
    expect(uploadStep).not.toMatch(/\.dump\b/);
  });

  it("pins verifier inputs and publishes generated artifacts without clobbering", async () => {
    const [generator, verifier, postgresLibrary] = await Promise.all([
      readFile(join(process.cwd(), "scripts", "create-synthetic-restore-drill-artifact.mjs"), "utf8"),
      readFile(join(process.cwd(), "scripts", "verify-backup-restore-postgres.mjs"), "utf8"),
      readFile(join(process.cwd(), "scripts", "lib", "restore-drill-postgres.mjs"), "utf8"),
    ]);
    expect(generator).toContain("constants.COPYFILE_EXCL");
    expect(generator).toContain("le-yard-synthetic-restore-source-");
    expect(verifier).toContain("le-yard-restore-input-");
    expect(verifier).toContain("Pinned backup input changed");
    expect(postgresLibrary).toMatch(/create database[^\n]+template template0/i);
    expect(postgresLibrary).toContain("pg_try_advisory_lock");
    expect(postgresLibrary).toContain("has_table_privilege('anon'");
    expect(postgresLibrary).toContain("has_sequence_privilege('anon'");
    expect(postgresLibrary).toContain("security_invoker=true");
    expect(postgresLibrary).toContain("pg_control_system()");
    expect(postgresLibrary).toContain("postmaster.pid");
    expect(postgresLibrary).toContain("template1");
    expect(postgresLibrary).toContain(
      '["private.runtime_schema_contract_expected", ["captured_at"]]',
    );
    expect(postgresLibrary).toMatch(
      /qualifiedName === "private\.organization_owner_counts" \|\|\s+qualifiedName === "private\.runtime_schema_contract_expected"/,
    );
    expect(verifier).toContain("Evidence inside the repository must use an ignored");
    expect(verifier).toContain("task due-at mutation");
    expect(verifier).toContain("wrong demo password hash");
  });

  it("revokes every private helper and future private function by default", async () => {
    const migration = await readFile(
      join(
        process.cwd(),
        "supabase",
        "migrations",
        "20260811100128_private_trigger_function_grant_hardening.sql",
      ),
      "utf8",
    );
    expect(migration).toMatch(
      /alter default privileges for role postgres in schema private\s+revoke execute on functions from public/i,
    );
    expect(migration).toMatch(
      /revoke execute on all functions in schema private\s+from public, anon, authenticated, service_role/i,
    );
  });
});
