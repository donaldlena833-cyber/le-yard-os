import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
const generator = await readFile("scripts/generate-database-types.mjs", "utf8");
const bootstrap = generator.match(/const bootstrap = `([\s\S]*?)`;/)?.[1];
assert(bootstrap, "Database platform bootstrap must be available");
const org = "10000000-0000-4000-8000-000000000001";
const otherOrg = "10000000-0000-4000-8000-000000000002";
const loc = "20000000-0000-4000-8000-000000000001";
const otherLoc = "20000000-0000-4000-8000-000000000002";
const owner = "30000000-0000-4000-8000-000000000001";
const admin = "30000000-0000-4000-8000-000000000002";
const employee = "30000000-0000-4000-8000-000000000003";
const outsider = "30000000-0000-4000-8000-000000000004";
const sourceSid = "SM" + "a".repeat(32);
const secondSid = "MM" + "b".repeat(32);
const otherSid = "SM" + "c".repeat(32);
const setupKey = "setup:40000000-0000-4000-8000-000000000001";

async function actor(id, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ sub: id, role, aal: "aal1" }),
  ]);
  assert(["authenticated", "service_role", "anon"].includes(role));
  await db.exec(`set role ${role}`);
}

async function denied(sql, values = [], code = "42501") {
  await assert.rejects(db.query(sql, values), (error) => error.code === code);
}

async function enqueue(overrides = {}) {
  const row = {
    organization_id: org,
    location_id: loc,
    source_sid: sourceSid,
    source_key: sourceSid,
    recipient: "donald",
    part: 1,
    body: "Le Yard alert: fixture inbound text.",
    ...overrides,
  };
  const columns = Object.keys(row);
  const values = Object.values(row);
  return (
    await db.query(
      `insert into public.owner_sms_alerts (${columns.join(",")}) values (${values.map((_, i) => `$${i + 1}`).join(",")}) returning *`,
      values,
    )
  ).rows[0];
}

async function claim(id, organizationId = org) {
  return (
    await db.query(
      "select public.service_claim_owner_sms_alert($1, $2) as value",
      [organizationId, id],
    )
  ).rows[0].value;
}

async function mark(id, status, providerSid = null) {
  await db.query(
    "update public.owner_sms_alerts set status=$2, provider_sid=coalesce($3,provider_sid) where id=$1",
    [id, status, providerSid],
  );
}

let failed = false;
try {
  await db.exec(bootstrap);
  await db.exec(
    "create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key)",
  );
  for (const file of (await readdir("supabase/migrations"))
    .filter((file) => file.endsWith(".sql"))
    .sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    await db.query(
      "insert into supabase_migrations.schema_migrations(version) values ($1)",
      [file.split("_")[0]],
    );
  }
  await db.exec(`set request.jwt.claims='{"role":"service_role"}';
    insert into auth.users(id,email) values
      ('${owner}','owner@fixture.test'),('${admin}','admin@fixture.test'),
      ('${employee}','employee@fixture.test'),('${outsider}','outsider@fixture.test');
    insert into public.organizations(id,name,slug) values
      ('${org}','Owner alerts fixture','owner-alerts-fixture'),
      ('${otherOrg}','Other fixture','other-owner-alerts-fixture');
    insert into public.locations(id,organization_id,name,code,timezone) values
      ('${loc}','${org}','Fixture','LY','America/New_York'),
      ('${otherLoc}','${otherOrg}','Other','OT','America/New_York');
    insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values
      ('${org}','${owner}','owner','active',now()),
      ('${org}','${admin}','admin','active',now()),
      ('${org}','${employee}','employee','active',now()),
      ('${otherOrg}','${outsider}','owner','active',now());
    insert into public.communication_messages(organization_id,location_id,sid,from_number,to_number,body,direction,sender_kind,status,sent_at) values
      ('${org}','${loc}','${sourceSid}','+12125550101','+12125550102','First fixture','inbound','client','received',now()),
      ('${org}','${loc}','${secondSid}','+12125550101','+12125550102','Second fixture','inbound','client','received',now()),
      ('${otherOrg}','${otherLoc}','${otherSid}','+12125550103','+12125550104','Other fixture','inbound','client','received',now());`);

  await actor(null, "service_role");
  assert.equal(
    (await db.query("select rolbypassrls from pg_roles where rolname=current_user"))
      .rows[0].rolbypassrls,
    false,
    "Exercise the actual service role and its policies, without BYPASSRLS",
  );
  const contract = (
    await db.query("select public.service_runtime_schema_contract() as value")
  ).rows[0].value;
  assert.equal(contract.migrationHead, "20260912174103");
  assert.equal(contract.matchesExpected, true);
  const rls = (
    await db.query(
      "select relrowsecurity, relforcerowsecurity from pg_class where oid='public.owner_sms_alerts'::regclass",
    )
  ).rows[0];
  assert.deepEqual(rls, { relrowsecurity: true, relforcerowsecurity: true });

  const first = await enqueue();
  assert.equal(first.status, "queued");
  assert.equal(first.started_at, null);
  assert.equal(first.completed_at, null);
  assert.equal(first.provider_sid, null);
  assert.ok(first.created_at && first.updated_at);
  assert.ok(!Object.keys(first).some((key) => /number|phone/.test(key)));
  const duplicates = await Promise.allSettled(
    Array.from({ length: 4 }, () => enqueue()),
  );
  assert.ok(duplicates.every((result) => result.status === "rejected" && result.reason.code === "23505"));

  for (const invalid of [
    { recipient: "someone_else" },
    { part: 0 },
    { part: 17 },
    { body: "" },
    { body: "a".repeat(1601) },
    { source_key: "a".repeat(101) },
    { source_key: secondSid },
    { source_sid: null },
    { source_sid: null, source_key: "setup:unbounded-arbitrary-text" },
    { source_key: setupKey },
    { status: "retry" },
    { provider_sid: "SM-invalid" },
  ]) {
    await assert.rejects(enqueue(invalid), (error) => error.code === "23514");
  }
  await assert.rejects(enqueue({ location_id: otherLoc, part: 2 }), (error) => error.code === "23503");
  await assert.rejects(enqueue({ source_sid: otherSid, source_key: otherSid }), (error) => error.code === "23503");
  const setup = await enqueue({ source_sid: null, source_key: setupKey, body: "🙂".repeat(1600) });
  assert.equal(setup.body, "🙂".repeat(1600), "The limit counts PostgreSQL characters");
  const recipient = await enqueue({ recipient: "maris" });
  const second = await enqueue({ part: 2 });
  const fourth = await enqueue({ part: 4 });

  const queuedResult = await claim(second.id);
  assert.equal(queuedResult.status, "busy");
  assert.equal(queuedResult.alert.status, "queued");
  // PGlite has one backend: concurrent calls prove single-claim/idempotency
  // behavior, but are not a substitute for two-session PostgreSQL lock testing.
  const claims = await Promise.all(Array.from({ length: 8 }, () => claim(first.id)));
  assert.equal(claims.filter((result) => result.status === "claimed").length, 1);
  assert.equal(claims.filter((result) => result.status === "sending").length, 7);
  const claimed = claims.find((result) => result.status === "claimed").alert;
  assert.equal(claimed.status, "sending");
  assert.ok(claimed.started_at);
  assert.equal((await claim(first.id)).alert.started_at, claimed.started_at);
  assert.equal((await claim(second.id)).status, "busy");
  assert.equal((await claim(recipient.id)).status, "claimed", "Recipients progress independently");
  assert.equal((await claim(first.id, otherOrg)).status, "missing");
  assert.equal((await claim("90000000-0000-4000-8000-000000000001")).status, "missing");

  await mark(first.id, "accepted", "SM" + "d".repeat(32));
  assert.equal((await claim(first.id)).status, "accepted");
  assert.equal((await claim(second.id)).status, "claimed");
  await mark(second.id, "delivered");
  assert.equal((await claim(second.id)).status, "delivered");
  assert.equal((await claim(fourth.id)).status, "busy", "A missing third part blocks part four");
  const third = await enqueue({ part: 3 });
  await mark(third.id, "failed");
  assert.equal((await claim(third.id)).status, "failed", "Failed parts are never blindly retried");
  assert.equal((await claim(fourth.id)).status, "busy", "A failed earlier part blocks later parts");

  const stale = await enqueue({ source_sid: secondSid, source_key: secondSid });
  assert.equal((await claim(stale.id)).status, "claimed");
  await db.query(
    "update public.owner_sms_alerts set started_at=clock_timestamp()-interval '121 seconds',provider_sid=$2 where id=$1",
    [stale.id, "MM" + "e".repeat(32)],
  );
  const uncertain = await claim(stale.id);
  assert.equal(uncertain.status, "uncertain");
  assert.equal(uncertain.alert.status, "uncertain");
  assert.equal(uncertain.alert.error_code, "worker_interrupted");
  assert.equal(uncertain.alert.provider_sid, "MM" + "e".repeat(32));
  assert.ok(uncertain.alert.completed_at);
  assert.equal((await claim(stale.id)).status, "uncertain");
  const staleNext = await enqueue({ source_sid: secondSid, source_key: secondSid, part: 2 });
  assert.equal((await claim(staleNext.id)).status, "busy");
  assert.equal((await claim(setup.id)).status, "claimed", "A controlled setup alert can be claimed");

  const total = (await db.query("select count(*)::int as n from public.owner_sms_alerts")).rows[0].n;
  for (const id of [owner, admin]) {
    await actor(id);
    assert.equal((await db.query("select count(*)::int as n from public.owner_sms_alerts")).rows[0].n, total);
    await denied("update public.owner_sms_alerts set body='tampered'");
    await denied("delete from public.owner_sms_alerts");
    await denied("insert into public.owner_sms_alerts select * from public.owner_sms_alerts limit 1");
    await denied("select public.service_claim_owner_sms_alert($1,$2)", [org, first.id]);
  }
  for (const id of [employee, outsider]) {
    await actor(id);
    assert.equal((await db.query("select * from public.owner_sms_alerts")).rows.length, 0);
    await denied("update public.owner_sms_alerts set status='queued'");
    await denied("select public.service_claim_owner_sms_alert($1,$2)", [org, first.id]);
  }
  await actor(null, "anon");
  await denied("select * from public.owner_sms_alerts");
  await denied("select public.service_claim_owner_sms_alert($1,$2)", [org, first.id]);
  await actor(null, "service_role");
  await db.exec("set request.jwt.claims='{\"role\":\"authenticated\"}'");
  await denied("select public.service_claim_owner_sms_alert($1,$2)", [org, first.id]);

  console.log("PASS: complete migration chain and runtime fingerprint; actual service-role writes; forced RLS; owner/admin reads; employee, anonymous, and cross-tenant isolation.");
  console.log("PASS: duplicate enqueue constraints, bounded recipients/body/parts, source/location integrity, ordered multipart claims, repeated concurrent-call idempotency, and stale-worker uncertainty without resend.");
} catch (error) {
  console.error("FAIL:", error.message, error.code ?? "");
  failed = true;
} finally {
  await db.close();
}
if (failed) process.exitCode = 1;
