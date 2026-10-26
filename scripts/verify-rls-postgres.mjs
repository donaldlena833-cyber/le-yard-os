import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { requireLocalPostgresControlUrl } from "./lib/require-local-postgres-control-url.mjs";

const controlUrl = requireLocalPostgresControlUrl(process.env.RLS_TEST_DATABASE_URL, "RLS_TEST_DATABASE_URL");
const root = process.cwd();
const legacyPublishBaseline = process.env.RLS_TEST_LEGACY_PUBLISH === "true";
let legacyPublishInjected = false;
const requiredFiles = ["00_rls_coverage.sql", "01_tenant_and_roles.sql", "02_workflow_guards.sql", "03_tip_engine.sql", "04_current_scope_signals.sql", "05_service_shift_read_stability.sql", "06_current_preshift_projection.sql", "07_reservation_signal_sources.sql", "08_square_source_evidence.sql", "09_sql_warning_triage.sql", "10_checklist_authoring_boundaries.sql", "11_staffing_replay_and_overlap.sql", "12_staffing_capabilities_and_publication.sql", "13_receiving_proposed_quantities.sql", "14_prep_formula_and_replay.sql"];
const testFiles = (await readdir(join(root, "tests/rls"))).filter(f => f.endsWith(".sql")).sort();
if (!requiredFiles.every(file => testFiles.includes(file))) throw new Error("Required RLS coverage file is missing.");
const database = `rls_acceptance_${randomUUID().replaceAll("-", "")}`;
const testUrl = new URL(controlUrl);
testUrl.pathname = `/${database}`;
const admin = new Client({ connectionString: controlUrl.href });
const db = new Client({ connectionString: testUrl.href });
const report = { at: new Date().toISOString(), classification: "isolated_local_synthetic_nonproduction", realAuthService: false, platformAuth: "SQL JWT helpers; actual Auth sign-ins are a separate connected gate", database, files: [], completed: false, dropped: false };
// A backend crash can emit on both idle and active clients. Preserve a failed
// report instead of losing the generated database identity to an unhandled event.
const connectionErrors = [];
for (const client of [admin, db]) client.on("error", error => connectionErrors.push(error.message));
let created = false;
let connected = false;
try {
  await admin.connect();
  report.serverVersion = (await admin.query("show server_version")).rows[0].server_version;
  if (Number((await admin.query("show server_version_num")).rows[0].server_version_num) < 170000 || Number((await admin.query("show server_version_num")).rows[0].server_version_num) >= 180000) throw new Error("This gate requires native PostgreSQL 17.");
  const roles = (await admin.query("select rolname,rolsuper,rolbypassrls from pg_roles where rolname in ('anon','authenticated','service_role') order by rolname")).rows;
  if (roles.length !== 3 || roles.some(role => role.rolname !== 'service_role' && (role.rolsuper || role.rolbypassrls))) throw new Error("Initialized platform roles are required; browser roles must not bypass RLS. Use the isolated Supabase database profile.");
  report.databaseRoles = roles;
  await admin.query(`create database "${database}" template template0 owner postgres`);
  created = true;
  await db.connect();
  connected = true;
  await db.query("set statement_timeout = '120s'");
  const generator = await readFile(join(root, "scripts/generate-database-types.mjs"), "utf8");
  const bootstrap = generator.match(/const bootstrap = `([\s\S]*?)`;/)?.[1];
  if (!bootstrap) throw new Error("Platform bootstrap not found.");
  await db.query(bootstrap);
  // Mirror the legacy Supabase creator defaults so the hardening migration is
  // exercised, rather than accidentally passing on a grant-free template.
  await db.query(`grant usage on schema extensions to authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on tables to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant all on sequences to anon, authenticated, service_role;
    alter default privileges for role postgres in schema public grant execute on functions to anon, authenticated, service_role;`);
  for (const extension of ["pgcrypto", "pg_trgm", "btree_gist", "pgtap"]) await db.query(`create extension if not exists "${extension}" with schema extensions`);
  await db.query("create publication supabase_realtime; create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)");
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter(f => f.endsWith(".sql")).sort();
  const migrationHash = createHash("sha256");
  for (const file of migrations) {
    await db.query("begin");
    if (legacyPublishBaseline && file.startsWith("20261025062929_")) {
      const legacySql = await readFile(join(root, "tests/fixtures/legacy-publish-schedule-v0008.sql"), "utf8");
      await db.query(legacySql);
      const legacyMd5 = (await db.query("select md5(prosrc)body from pg_proc where oid='public.publish_schedule(uuid,text)'::regprocedure")).rows[0].body;
      if (legacyMd5 !== "db3c23cd12c8623ec753da7b945ef7b9") throw new Error("Historical publication fixture drifted");
      report.legacyPublishBaseline = { bodyMd5: legacyMd5, fixtureSha256: createHash("sha256").update(legacySql).digest("hex"), injectedBefore: file };
      legacyPublishInjected = true;
    }
    const sql = await readFile(join(root, "supabase/migrations", file), "utf8");
    migrationHash.update(file).update("\0").update(sql);
    await db.query(sql);
    await db.query("insert into supabase_migrations.schema_migrations(version) values($1)", [file.split("_")[0]]);
    await db.query("commit");
  }
  if (legacyPublishBaseline && !legacyPublishInjected) throw new Error("Historical baseline was not exercised");
  const seedSql = await readFile(join(root, "supabase/seed.sql"), "utf8");
  report.seedSha256 = createHash("sha256").update(seedSql).digest("hex");
  await db.query(seedSql);
  report.migrationHead = migrations.at(-1).split("_")[0];
  report.migrationCount = migrations.length;
  report.migrationSha256 = migrationHash.digest("hex");
  for (const file of testFiles) {
    const item = { file, tap: [], passed: 0, failed: 0, skipped: 0, planned: null, complete: false };
    try {
      const sql = await readFile(join(root, "tests/rls", file), "utf8");
      item.sha256 = createHash("sha256").update(sql).digest("hex");
      const response = await db.query(sql);
      for (const result of Array.isArray(response) ? response : [response]) for (const row of result.rows) for (const value of Object.values(row)) {
        if (typeof value === "string" && /^(ok |not ok |1\.\.|#)/.test(value)) item.tap.push(...value.split("\n"));
      }
      const plan = item.tap.find(line => /^1\.\.\d+$/.test(line));
      item.planned = plan ? Number(plan.slice(3)) : null;
      item.passed = item.tap.filter(line => /^ok \d+/.test(line)).length;
      item.failed = item.tap.filter(line => /^not ok \d+/.test(line)).length;
      item.skipped = item.tap.filter(line => /^(?:ok|not ok) \d+.*#\s*(?:SKIP|TODO)\b/i.test(line)).length;
      const ids = item.tap.flatMap(line => line.match(/^(?:ok|not ok) (\d+)/)?.[1] ?? []).map(Number);
      item.complete = item.planned !== null && ids.length === item.planned && ids.every((id, i) => id === i + 1);
    } catch (error) {
      item.error = error.message;
      await db.query("rollback");
    }
    report.files.push(item);
  }
  report.completed = true;
} catch (error) {
  report.error = error.message;
  if (connected) await db.query("rollback").catch(() => {});
} finally {
  if (connected) await db.end().catch(() => {});
  await admin.end().catch(() => {});
  if (created) {
    // Only the generated database is eligible for cleanup. No shared database
    // data, project reset, global role change, or cluster termination occurs.
    // A replacement control session is necessary after server recovery. Only
    // retry cleanup of this generated database; never restart the test on error.
    for (let attempt = 0; attempt < 8 && !report.dropped; attempt += 1) {
      const cleanup = new Client({ connectionString: controlUrl.href, connectionTimeoutMillis: 2000 });
      cleanup.on("error", () => {});
      try {
        await cleanup.connect();
        await cleanup.query(`drop database "${database}"`);
        report.dropped = true;
      } catch (error) {
        report.cleanupError = error.message;
        if (attempt < 7) await new Promise(resolve => setTimeout(resolve, 250));
      } finally {
        await cleanup.end().catch(() => {});
      }
    }
    if (report.dropped) delete report.cleanupError;
  }
  if (connectionErrors.length) report.connectionErrors = connectionErrors;
  report.summary = { files: report.files.length, passed: report.files.reduce((n, f) => n + f.passed, 0), failed: report.files.reduce((n, f) => n + f.failed, 0), skipped: report.files.reduce((n, f) => n + f.skipped, 0), incomplete: report.files.filter(f => !f.complete).length, accepted: !connectionErrors.length && report.completed && report.dropped && report.files.length === requiredFiles.length && report.files.every(f => f.complete && f.failed === 0 && f.skipped === 0) };
  if (process.env.RLS_TEST_REPORT_PATH) await writeFile(process.env.RLS_TEST_REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify(report.summary));
  if (!report.summary.accepted) process.exitCode = 1;
}
