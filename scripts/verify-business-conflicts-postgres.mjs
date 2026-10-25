import { randomUUID } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Client } from "pg";
import { requireLocalPostgresControlUrl } from "./lib/require-local-postgres-control-url.mjs";

const control = requireLocalPostgresControlUrl(
  process.env.BUSINESS_CONFLICT_DATABASE_URL,
  "BUSINESS_CONFLICT_DATABASE_URL",
);
const root = process.cwd();
const manifest = JSON.parse(await readFile(join(root, "tests/fixtures/business-conflicts-reviewed.json"), "utf8"));
const database = `business_conflicts_${randomUUID().replaceAll("-", "")}`;
const url = new URL(control);
url.pathname = `/${database}`;
const admin = new Client({ connectionString: control.href });
const db = new Client({ connectionString: url.href });
const other = new Client({ connectionString: url.href });
const report = {
  at: new Date().toISOString(),
  classification: "isolated_local_synthetic_nonproduction",
  scope: "Native catalog transformation, fail-closed migration guards and genuine engine serialization; actual HTTP is separate",
  database,
  checks: [],
  dropped: false,
};
let created = false;
let connected = false;
let otherConnected = false;
function check(id, passed, observed) {
  report.checks.push({ id, passed, observed });
  if (!passed) throw new Error(`Business-conflict gate failed: ${id}`);
}
async function catalog() {
  return (await db.query(`select
    format('%I.%I(%s)',ns.nspname,fn.proname,pg_catalog.oidvectortypes(fn.proargtypes)) identity,
    fn.prosrc source,md5(fn.prosrc) source_md5,
    fn.proowner,fn.proacl::text,fn.prosecdef,fn.proconfig,fn.provolatile,
    fn.proisstrict,fn.proleakproof,fn.proparallel,fn.prorettype,
    fn.proargtypes::text,fn.proallargtypes,fn.proargmodes,fn.proargnames,
    fn.procost,fn.prorows,fn.proretset,fn.prolang,fn.prosupport
    from pg_catalog.pg_proc fn join pg_catalog.pg_namespace ns on ns.oid=fn.pronamespace
    where ns.nspname in ('public','private') and fn.prokind='f'
    order by ns.nspname,fn.proname,fn.oid`)).rows;
}
async function expectGuard(sql, expectedMessage) {
  let observed;
  try { await db.query(sql); } catch (error) { observed = { code: error.code, message: error.message }; }
  check(expectedMessage, observed?.code === "P0001" && observed.message.includes(expectedMessage), observed);
}
try {
  await admin.connect();
  const version = Number((await admin.query("show server_version_num")).rows[0].server_version_num);
  if (version < 170000 || version >= 180000) throw new Error("Native PostgreSQL17 is required.");
  await admin.query(`create database "${database}" template template0 owner postgres`);
  created = true;
  await db.connect();
  connected = true;
  await db.query("set statement_timeout='120s'");
  const generator = await readFile(join(root, "scripts/generate-database-types.mjs"), "utf8");
  const bootstrap = generator.match(/const bootstrap = `([\s\S]*?)`;/)?.[1];
  if (!bootstrap) throw new Error("Controlled platform bootstrap is missing.");
  await db.query(bootstrap);
  for (const extension of ["pgcrypto", "pg_trgm", "btree_gist"]) {
    await db.query(`create extension if not exists "${extension}" with schema extensions`);
  }
  await db.query("create publication supabase_realtime; create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)");
  const migrations = (await readdir(join(root, "supabase/migrations"))).filter(f => f.endsWith(".sql")).sort();
  let migrationValidated = false;
  for (const name of migrations) {
    const sql = await readFile(join(root, "supabase/migrations", name), "utf8");
    if (name === manifest.migration) {
      await db.query("set search_path=pg_catalog");
      const before = await catalog();
      const targets = before.filter(row => row.source.includes("40001"));
      check("reviewed_inventory", targets.length === manifest.functionCount && targets.every(row =>
        manifest.functions.some(expected => expected.identity === row.identity && expected.sourceMd5 === row.source_md5)),
      { reviewed: targets.length, expected: manifest.functionCount });
      const migrationBody = sql.replace(/^begin;\s*$/m, "").replace(/^commit;\s*$/m, "");
      // Both probes roll back completely, including their deliberate drift.
      await db.query("begin");
      const first = targets[0];
      const def = (await db.query("select pg_get_functiondef($1::regprocedure) definition", [first.identity])).rows[0].definition;
      await db.query(def.replace(first.source, () => first.source + "\n-- synthetic drift probe\n"));
      await expectGuard(migrationBody, "Reviewed business-conflict body drifted");
      await db.query("rollback");
      await db.query("begin");
      await db.query("create function private.readiness_unreviewed_conflict() returns void language plpgsql as $$begin raise exception 'synthetic' using errcode='40001'; end$$");
      await expectGuard(migrationBody, "An unreviewed40001 function requires classification first");
      await db.query("rollback");
      await db.query(sql);
      const after = await catalog();
      check("function_identities_preserved", before.length === after.length && before.every((row, i) => row.identity === after[i].identity), { before: before.length, after: after.length });
      const codePattern = /errcode\s*=\s*'40001'/gi;
      const targetSet = new Set(manifest.functions.map(f => f.identity));
      const changed = after.filter((row, i) => row.source !== before[i].source);
      check("only_reviewed_bodies_changed", changed.length === manifest.functionCount && changed.every(row => targetSet.has(row.identity)), { changed: changed.length });
      check("body_substitution_only", after.every((row, i) => row.source === (targetSet.has(row.identity) ? before[i].source.replace(codePattern, "errcode = 'PT409'") : before[i].source)), { substitutions: manifest.explicitRaiseCount });
      const attributes = row => {
        const rest = { ...row };
        delete rest.source;
        delete rest.source_md5;
        return rest;
      };
      check("owners_grants_and_security_attributes_preserved", after.every((row, i) => JSON.stringify(attributes(row)) === JSON.stringify(attributes(before[i]))), { functions: after.length });
      check("no_explicit_business_serialization_raises", after.every(row => !/errcode\s*=\s*'40001'/i.test(row.source)), { remaining: 0 });
      migrationValidated = true;
    } else {
      await db.query(sql);
    }
    await db.query("insert into supabase_migrations.schema_migrations(version) values($1)", [name.split("_")[0]]);
  }
  check("reviewed_migration_executed", migrationValidated, { head: migrations.at(-1).split("_")[0], count: migrations.length });
  const latestCatalog = await catalog();
  check("latest_catalog_has_no_explicit_business_40001", latestCatalog.every(row => !/errcode\s*=\s*'40001'/i.test(row.source)), { functions: latestCatalog.length });
  await db.query("select set_config('request.jwt.claims','{\"role\":\"service_role\"}',false)");
  const contract = (await db.query("select public.service_runtime_schema_contract() value")).rows[0].value;
  check("runtime_contract_exact", contract.matchesExpected === true && contract.migrationHead === migrations.at(-1).split("_")[0], contract);
  await db.query("create table public.readiness_engine_serialization(id integer primary key,value integer not null); insert into public.readiness_engine_serialization values(1,0)");
  await other.connect();
  otherConnected = true;
  await db.query("begin isolation level repeatable read");
  await db.query("select * from public.readiness_engine_serialization where id=1");
  await other.query("update public.readiness_engine_serialization set value=1 where id=1");
  let genuine;
  try { await db.query("update public.readiness_engine_serialization set value=2 where id=1"); }
  catch (error) { genuine = { code: error.code, message: error.message }; }
  await db.query("rollback");
  check("genuine_engine_serialization_unchanged", genuine?.code === "40001", genuine);
} catch (error) {
  report.error = error.message;
  report.errorCode = error.code ?? null;
  process.exitCode = 1;
} finally {
  if (otherConnected) await other.end();
  if (connected) await db.end();
  if (created) {
    await admin.query(`drop database "${database}" with (force)`);
    report.dropped = true;
  }
  await admin.end();
  report.summary = { passed: report.checks.filter(c => c.passed).length, total: report.checks.length, accepted: !report.error && report.dropped && report.checks.length === 12 && report.checks.every(c => c.passed) };
  if (!report.summary.accepted) process.exitCode = 1;
  if (process.env.BUSINESS_CONFLICT_REPORT_PATH) await writeFile(process.env.BUSINESS_CONFLICT_REPORT_PATH, JSON.stringify(report, null, 2) + "\n");
  console.log(JSON.stringify({ ...report.summary, dropped: report.dropped, error: report.error ?? null }));
}
