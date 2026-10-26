import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { Pool } from "pg";
import { RESTORE_DRILL_PLATFORM_BOOTSTRAP } from "./lib/restore-drill-postgres.mjs";
import { requireLocalPostgresControlUrl } from "./lib/require-local-postgres-control-url.mjs";
const controlUrl = requireLocalPostgresControlUrl(
  process.env.CATERING_TEST_DATABASE_URL,
  "CATERING_TEST_DATABASE_URL",
);
const control = new Pool({ connectionString: controlUrl.href, max: 1 });
const name = `catering_test_${randomUUID().replaceAll("-", "")}`;
const url = new URL(controlUrl);
url.pathname = `/${name}`;
let db;
const ids = {
  org: randomUUID(),
  otherOrg: randomUUID(),
  location: randomUUID(),
  owner: randomUUID(),
  otherOwner: randomUUID(),
  manager: randomUUID(),
  admin: randomUUID(),
  suspended: randomUUID(),
  client: randomUUID(),
};
const hash = (value) => createHash("sha256").update(value).digest("hex");
const fixture = {
  audience: "corporate",
  contactName: "Example Guest",
  email: "guest@example.com",
  phone: "",
  company: "Example Company",
  occasion: "Team gathering",
  eventDate: "",
  eventTime: "",
  guestCount: null,
  location: "",
  dietaryNeeds: "",
  format: "",
  budget: "",
  notes: "",
  source: "direct",
  channel: "website",
  purpose: "catering_service_inquiry",
  noticeVersion: "catering-2026-10-21",
  emailMarketingConsent: false,
  smsMarketingConsent: false,
  profileConsent: false,
};
let checks = 0;
function pass(label) {
  checks++;
  process.stdout.write(`PASS ${label}\n`);
}
async function roleQuery(role, sql, params = [], subject = null) {
  const c = await db.connect();
  try {
    await c.query("begin");
    await c.query(`set local role ${role}`);
    await c.query("select set_config('request.jwt.claims',$1,true)", [
      JSON.stringify({ sub: subject, role, aal: "aal1" }),
    ]);
    const r = await c.query(sql, params);
    await c.query("commit");
    return r;
  } catch (e) {
    await c.query("rollback");
    throw e;
  } finally {
    c.release();
  }
}
const capture = (requestId, payload = fixture, clientId = ids.client) =>
  roleQuery(
    "service_role",
    "select public.service_capture_catering_inquiry($1,$2,$3::jsonb) as result",
    [clientId, requestId, JSON.stringify(payload)],
  ).then((r) => r.rows[0].result);
async function denied(operation, code) {
  await assert.rejects(operation, (e) => e.code === code);
}
try {
  await control.query(`create database "${name}"`);
  db = new Pool({ connectionString: url.href, max: 16 });
  await db.query(
    "do $$ begin create role anon nologin; exception when duplicate_object then null; end $$; do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$; do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;",
  );
  await db.query(
    "do $$ begin create role postgres nologin superuser; exception when duplicate_object then null; end $$;",
  );
  await db.query(RESTORE_DRILL_PLATFORM_BOOTSTRAP);
  await db.query("create publication supabase_realtime");
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    if (file.endsWith("_catering_inquiry_receiver.sql")) {
      const predecessor = (await roleQuery("service_role", "select public.service_runtime_schema_contract() as value")).rows[0].value;
      assert.equal(predecessor.migrationHead, "20261025085858");
      assert.equal(predecessor.matchesExpected, true);
      assert.equal((await db.query("select to_regclass('public.catering_inquiries') as relation")).rows[0].relation, null);
    }
    try {
      await db.query(await readFile(`supabase/migrations/${file}`, "utf8"));
      await db.query("insert into supabase_migrations.schema_migrations(version) values($1)", [file.split("_")[0]]);
    } catch (e) {
      throw new Error(`Migration ${file}: ${e.message}`, { cause: e });
    }
  }
  pass("full migration chain applied to disposable loopback PostgreSQL");
  const upgraded = (await roleQuery("service_role", "select public.service_runtime_schema_contract() as value")).rows[0].value;
  assert.equal(upgraded.migrationHead, "20261026101813");
  assert.equal(upgraded.matchesExpected, true);
  pass("current-main predecessor upgrades forward to the matching catering app contract");
  await db.query(
    "insert into public.organizations(id,name,slug) values($1,'Catering test','catering-test'),($2,'Other test','other-test')",
    [ids.org, ids.otherOrg],
  );
  await db.query(
    "insert into public.locations(id,organization_id,name,code,timezone) values($1,$2,'Test location','TEST','America/New_York')",
    [ids.location, ids.org],
  );
  for (const [user, org, role, status] of [
    [ids.owner, ids.org, "owner", "active"],
    [ids.otherOwner, ids.otherOrg, "owner", "active"],
    [ids.manager, ids.org, "manager", "active"],
    [ids.admin, ids.org, "admin", "active"],
    [ids.suspended, ids.org, "owner", "suspended"],
  ]) {
    await db.query("insert into auth.users(id,email) values($1,$2)", [
      user,
      `${user}@example.com`,
    ]);
    await db.query(
      "insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values($1,$2,$3,$4,now())",
      [org, user, role, status],
    );
  }
  const keyHash = hash("local-test-only-key-not-production");
  await db.query(
    "insert into private.catering_api_clients(id,organization_id,location_id,key_hash,name) values($1,$2,$3,$4,'Local test')",
    [ids.client, ids.org, ids.location, keyHash],
  );
  assert.equal(
    (
      await roleQuery(
        "service_role",
        "select public.service_authenticate_catering_client($1) as result",
        [keyHash],
      )
    ).rows[0].result,
    null,
  );
  await denied(() => capture(randomUUID()), "28000");
  pass("new client is inactive by default");
  await db.query(
    "update private.catering_api_clients set is_active=true where id=$1",
    [ids.client],
  );
  assert.equal(
    (
      await roleQuery(
        "service_role",
        "select public.service_authenticate_catering_client($1) as result",
        [keyHash],
      )
    ).rows[0].result.id,
    ids.client,
  );
  await db.query(
    "update private.catering_api_clients set expires_at=now()-interval '1 minute' where id=$1",
    [ids.client],
  );
  await denied(() => capture(randomUUID()), "28000");
  await db.query(
    "update private.catering_api_clients set expires_at=null where id=$1",
    [ids.client],
  );
  pass("dedicated active/expired credential boundary");
  const request = randomUUID();
  const accepted = await capture(request);
  assert.equal(accepted.stored, true);
  const again = await capture(request);
  assert.equal(again.inquiryId, accepted.inquiryId);
  assert.equal(
    (await db.query("select count(*)::int as n from public.catering_inquiries"))
      .rows[0].n,
    1,
  );
  pass("durable insert and exact idempotent replay");
  await denied(
    () => capture(request, { ...fixture, occasion: "Changed" }),
    "23505",
  );
  assert.equal(
    (
      await db.query(
        "select max(attempts) as n from private.catering_rate_buckets",
      )
    ).rows[0].n,
    1,
  );
  pass("conflicting reuse rejected without consuming abuse quota");
  for (const extra of [
    { emailMarketingConsent: true },
    { profileConsent: "false" },
    { extra: "unknown" },
    { guestCount: 1.5 },
    { notes: "x".repeat(1201) },
    { eventDate: "2027-02-30" },
    { eventDate: "2020-01-01" },
  ])
    await denied(
      () => capture(randomUUID(), { ...fixture, ...extra }),
      "22023",
    );
  assert.equal(
    (await db.query("select count(*)::int as n from public.catering_inquiries"))
      .rows[0].n,
    1,
  );
  pass("database rejects invalid dates/fields/consent without partial saves");
  const party = await capture(randomUUID(), {
    ...fixture,
    audience: "private_party",
    company: "",
    email: "party@example.com",
  });
  assert.notEqual(party.inquiryId, accepted.inquiryId);
  pass("both catering audiences persist without marketing or guest records");
  for (const [subject, count] of [
    [ids.owner, 2],
    [ids.otherOwner, 0],
    [ids.manager, 0],
    [ids.admin, 0],
    [ids.suspended, 0],
  ])
    assert.equal(
      (
        await roleQuery(
          "authenticated",
          "select count(*)::int as n from public.catering_inquiries",
          [],
          subject,
        )
      ).rows[0].n,
      count,
    );
  await denied(
    () => roleQuery("anon", "select * from public.catering_inquiries"),
    "42501",
  );
  await denied(
    () =>
      roleQuery(
        "authenticated",
        "select public.service_authenticate_catering_client($1)",
        [keyHash],
        ids.owner,
      ),
    "42501",
  );
  await denied(
    () =>
      roleQuery(
        "authenticated",
        "select public.service_capture_catering_inquiry($1,$2,$3)",
        [ids.client, randomUUID(), fixture],
        ids.owner,
      ),
    "42501",
  );
  await denied(
    () =>
      roleQuery(
        "authenticated",
        "delete from public.catering_inquiries",
        [],
        ids.owner,
      ),
    "42501",
  );
  pass(
    "owner-only organization reads; admin/manager/suspended/cross-tenant/anon and direct RPC writes denied",
  );
  // Force failure after counters have been incremented, before insert can commit.
  await db.query(
    "create function public.test_reject_catering() returns trigger language plpgsql as $$ begin raise exception 'synthetic_failure' using errcode='P0001'; end $$; create trigger test_catering_rollback before insert on public.catering_inquiries for each row execute function public.test_reject_catering()",
  );
  const before = (
    await db.query(
      "select sum(attempts)::int as n from private.catering_rate_buckets",
    )
  ).rows[0].n;
  await denied(
    () => capture(randomUUID(), { ...fixture, email: "rollback@example.com" }),
    "P0001",
  );
  assert.equal(
    (
      await db.query(
        "select sum(attempts)::int as n from private.catering_rate_buckets",
      )
    ).rows[0].n,
    before,
  );
  await db.query(
    "drop trigger test_catering_rollback on public.catering_inquiries; drop function public.test_reject_catering()",
  );
  pass("failed insert rolls counters back; no false accepted record");
  await db.query("delete from private.catering_rate_buckets");
  await db.query(
    "update private.catering_api_clients set hourly_limit=100,contact_hourly_limit=20 where id=$1",
    [ids.client],
  );
  const sameKey = randomUUID();
  const concurrent = await Promise.all(
    Array.from({ length: 12 }, () =>
      capture(sameKey, { ...fixture, email: "race@example.com" }),
    ),
  );
  assert.equal(new Set(concurrent.map((r) => r.inquiryId)).size, 1);
  pass("12 concurrent identical requests yield one committed inquiry");
  const conflictKey = randomUUID();
  const raceConflict = await Promise.allSettled(
    ["First", "Second"].map((occasion) =>
      capture(conflictKey, {
        ...fixture,
        email: "conflict@example.com",
        occasion,
      }),
    ),
  );
  assert.equal(raceConflict.filter((r) => r.status === "fulfilled").length, 1);
  assert.equal(
    raceConflict.find((r) => r.status === "rejected").reason.code,
    "23505",
  );
  pass("concurrent conflicting reuse yields one acceptance and one conflict");
  await db.query("delete from private.catering_rate_buckets");
  await db.query(
    "update private.catering_api_clients set hourly_limit=3,contact_hourly_limit=20 where id=$1",
    [ids.client],
  );
  const limited = await Promise.allSettled(
    Array.from({ length: 10 }, (_, i) =>
      capture(randomUUID(), { ...fixture, email: `global-${i}@example.com` }),
    ),
  );
  assert.equal(limited.filter((r) => r.status === "fulfilled").length, 3);
  assert.ok(
    limited
      .filter((r) => r.status === "rejected")
      .every((r) => r.reason.message === "catering_rate_limited"),
  );
  pass(
    "concurrent global quota admits exactly3 of10 across independent connections",
  );
  assert.equal((await capture(request)).inquiryId, accepted.inquiryId);
  pass("accepted inquiry replays after the global quota is exhausted");
  await db.query("delete from private.catering_rate_buckets");
  await db.query(
    "update private.catering_api_clients set hourly_limit=100,contact_hourly_limit=2 where id=$1",
    [ids.client],
  );
  const contactKeys = Array.from({ length: 8 }, () => randomUUID());
  const contact = await Promise.allSettled(
    contactKeys.map((key) =>
      capture(key, { ...fixture, email: "contact@example.com" }),
    ),
  );
  assert.equal(contact.filter((r) => r.status === "fulfilled").length, 2);
  pass("concurrent per-contact quota admits exactly2 of8");
  const admittedIndex = contact.findIndex(
    (result) => result.status === "fulfilled",
  );
  const admitted = contact[admittedIndex].value;
  assert.equal(
    (
      await capture(contactKeys[admittedIndex], {
        ...fixture,
        email: "contact@example.com",
      })
    ).inquiryId,
    admitted.inquiryId,
  );
  pass("accepted inquiry replays after its contact quota is exhausted");
  // A synthetic prior-day acceptance verifies replay ordering without changing
  // the database clock or weakening the new-inquiry date rule.
  const pastDate = (
    await db.query(
      "select ((clock_timestamp() at time zone 'America/New_York')::date-1)::text as day",
    )
  ).rows[0].day;
  const pastPayload = {
    ...fixture,
    email: "past@example.com",
    eventDate: pastDate,
  };
  const pastRequest = randomUUID();
  const pastId = randomUUID();
  await db.query(
    "insert into public.catering_inquiries(id,organization_id,location_id,client_id,request_id,payload_hash,payload,created_at) values($1,$2,$3,$4,$5,encode(extensions.digest($6::jsonb::text,'sha256'),'hex'),$6::jsonb,now()-interval '1 day')",
    [
      pastId,
      ids.org,
      ids.location,
      ids.client,
      pastRequest,
      JSON.stringify(pastPayload),
    ],
  );
  assert.equal((await capture(pastRequest, pastPayload)).inquiryId, pastId);
  await denied(() => capture(randomUUID(), pastPayload), "22023");
  pass("prior-day acceptance replays; new past-date inquiry remains rejected");
  // New connection verifies persistence independently of the accepting connection.
  const fresh = new Pool({ connectionString: url.href, max: 1 });
  const stored = (
    await fresh.query(
      "select payload,notification_status from public.catering_inquiries where id=$1",
      [accepted.inquiryId],
    )
  ).rows[0];
  await fresh.end();
  assert.equal(stored.payload.emailMarketingConsent, false);
  assert.equal(stored.payload.smsMarketingConsent, false);
  assert.equal(stored.notification_status, "not_configured");
  assert.equal(
    (await db.query("select count(*)::int as n from public.guests")).rows[0].n,
    0,
  );
  pass(
    "fresh connection reads durable service record; guest/newsletter/notification actions absent",
  );
  await db.query(
    "update private.catering_api_clients set is_active=false where id=$1",
    [ids.client],
  );
  await denied(() => capture(request), "28000");
  assert.equal(
    (
      await roleQuery(
        "service_role",
        "select public.service_authenticate_catering_client($1) as result",
        [keyHash],
      )
    ).rows[0].result,
    null,
  );
  pass(
    "revoking the dedicated client blocks new acceptance and old-key replay",
  );
  if (process.env.CATERING_RUN_ADVISORS === "true") {
    const run = promisify(execFile);
    const advisorUrl = new URL(url);
    // The test URL has already been restricted to loopback; this disposable
    // cluster has no TLS. Never apply this setting to a provider database.
    advisorUrl.searchParams.set("sslmode", "disable");
    const { stdout, stderr } = await run(
      "./node_modules/.bin/supabase",
      [
        "db",
        "advisors",
        "--db-url",
        advisorUrl.href,
        "--type",
        "security",
        "--level",
        "warn",
        "--output",
        "json",
      ],
      { timeout: 60000, maxBuffer: 8 * 1024 * 1024 },
    );
    await writeFile(
      process.env.CATERING_ADVISOR_OUTPUT || "../catering-advisors.json",
      JSON.stringify(
        {
          scope: "disposable_loopback_database",
          reportedNoIssues: /No issues found/.test(stderr),
          stdout,
          stderr,
        },
        null,
        2,
      ) + "\n",
    );
    if (stderr) process.stderr.write(stderr);
    pass(
      "Supabase security advisors executed locally; report requires scoped review",
    );
  }
  process.stdout.write(
    `PASS ${checks} catering database checks; no external database, message or service activation\n`,
  );
} finally {
  if (db) await db.end();
  await control.query(
    "select pg_terminate_backend(pid) from pg_stat_activity where datname=$1 and pid<>pg_backend_pid()",
    [name],
  );
  await control.query(`drop database if exists "${name}"`);
  await control.end();
}
