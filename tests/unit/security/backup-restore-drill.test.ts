import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  RESTORE_DRILL_FIXTURE_CONTRACT,
  RESTORE_DRILL_MANIFEST_KIND,
  RESTORE_DRILL_SOURCE_CLASSIFICATION,
  parseRestoreDrillArguments,
  readMigrationContract,
  validateRestoreDrillManifest,
} from "../../../scripts/lib/backup-restore-drill-contract.mjs";
import {
  attestControlDatabase,
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
};

function manifest() {
  return {
    manifestVersion: 1,
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
      fixtureContract: RESTORE_DRILL_FIXTURE_CONTRACT,
      providersDisabled: true,
      storagePayloadIncluded: false,
    },
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
    expect(workflow).toContain("workflow_dispatch:");
    expect(workflow).toContain('/usr/lib/postgresql/17/bin');
    expect(workflow).toContain("https://apt.postgresql.org/pub/repos/apt");
    expect(workflow).toContain("postgresql-client-17");
    expect(workflow).toContain('initdb -D "$RESTORE_DRILL_PGDATA"');
    expect(workflow).toContain('-h 127.0.0.1');
    expect(workflow).toContain("BACKUP_RESTORE_CONTROL_DATABASE_URL");
    expect(workflow).not.toMatch(/supabase\s+(?:db|projects|backups)/i);
    expect(uploadStep).toContain("evidence/*.json");
    expect(uploadStep).toContain("synthetic.manifest.json");
    expect(uploadStep).not.toMatch(/\.dump\b/);
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
