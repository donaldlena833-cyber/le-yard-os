import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { requireLocalPostgresControlUrl } from "./lib/require-local-postgres-control-url.mjs";

const controlUrl = requireLocalPostgresControlUrl(
  process.env.RESERVATION_PUSH_TEST_DATABASE_URL,
  "RESERVATION_PUSH_TEST_DATABASE_URL",
);
const root = process.cwd();
const migrationsDirectory = join(root, "supabase", "migrations");
const migrations = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const suffix = randomUUID().replaceAll("-", "");
const databaseName = `reservation_push_concurrency_${suffix}`;
const testUrl = new URL(controlUrl);
testUrl.pathname = `/${databaseName}`;
const quote = (value) => `"${value.replaceAll('"', '""')}"`;
const adminPool = new Pool({
  connectionString: controlUrl.toString(),
  max: 1,
  application_name: "le-yard-reservation-push-concurrency-admin",
});
let testPool;
let setup;
let first;
let second;
let databaseCreated = false;
const createdRoles = [];
const ids = {
  org: "20000000-0000-4000-8000-000000000001",
  location: "30000000-0000-4000-8000-000000000001",
  user: "10000000-0000-4000-8000-000000000004",
  reservation: "fb000000-0000-4000-8000-000000000001",
  subscription: "fb100000-0000-4000-8000-000000000001",
  notification: "fb200000-0000-4000-8000-000000000001",
  delivery: "fb300000-0000-4000-8000-000000000001",
  workerA: "fb400000-0000-4000-8000-000000000001",
  workerB: "fb400000-0000-4000-8000-000000000002",
};
const bootstrap = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create schema if not exists storage;
  create table auth.users (
    instance_id uuid, id uuid primary key, aud text, role text, email text unique,
    encrypted_password text, email_confirmed_at timestamptz,
    raw_app_meta_data jsonb not null default '{}'::jsonb,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table auth.identities (
    id uuid primary key, provider_id text not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    identity_data jsonb not null default '{}'::jsonb, provider text not null,
    last_sign_in_at timestamptz, created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(), unique (provider_id, provider)
  );
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(nullif(auth.jwt() ->> 'role', ''), current_user::text)
  $$;
  create table storage.buckets (
    id text primary key, name text not null unique, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets(id) on delete cascade,
    name text not null, owner_id text, metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant usage on schema auth, storage to authenticated;
  grant select on storage.buckets to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`;

function assert(condition, message, evidence) {
  if (!condition)
    throw new Error(
      `${message}${evidence === undefined ? "" : `: ${JSON.stringify(evidence)}`}`,
    );
}

async function assume(client, role) {
  await client.query("reset role");
  await client.query(`set role ${quote(role)}`);
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role }),
  ]);
}

async function claim(client, worker, at) {
  return (
    await client.query(
      `select * from public.service_claim_reservation_push_deliveries(
        $1::uuid, 1, 120, $2::timestamptz
      )`,
      [worker, at],
    )
  ).rows;
}

async function rollback(client) {
  if (!client) return;
  try {
    await client.query("rollback");
  } catch {
    // The transaction may already be closed.
  }
}

async function waitForLock(observer, pid, label) {
  let lastActivity = null;
  for (let attempt = 0; attempt < 200; attempt += 1) {
    lastActivity = (
      await observer.query(
        `select state, wait_event_type, wait_event
         from pg_stat_activity where pid = $1`,
        [pid],
      )
    ).rows[0];
    if (
      lastActivity?.state === "active" &&
      lastActivity.wait_event_type === "Lock"
    )
      return;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error(
    `${label} never reached a database-visible lock wait: ${JSON.stringify(lastActivity)}.`,
  );
}

try {
  const admin = await adminPool.connect();
  try {
    const version = (
      await admin.query(
        `select current_setting('server_version') version,
                current_setting('server_version_num')::integer version_num`,
      )
    ).rows[0];
    assert(
      version.version_num >= 170000 && version.version_num < 180000,
      "Reservation push concurrency requires PostgreSQL 17",
      version,
    );
    for (const role of ["anon", "authenticated", "service_role", "postgres"]) {
      const exists = (
        await admin.query(
          "select exists(select 1 from pg_roles where rolname = $1) value",
          [role],
        )
      ).rows[0].value;
      if (!exists) {
        await admin.query(
          `create role ${quote(role)} nologin${role === "postgres" ? " superuser" : ""}`,
        );
        createdRoles.push(role);
      }
    }
    await admin.query(`create database ${quote(databaseName)}`);
    databaseCreated = true;
  } finally {
    admin.release();
  }

  testPool = new Pool({
    connectionString: testUrl.toString(),
    max: 3,
    application_name: "le-yard-reservation-push-concurrency-schema",
  });
  setup = await testPool.connect();
  await setup.query(bootstrap);
  for (const migration of migrations) {
    try {
      await setup.query(
        await readFile(join(migrationsDirectory, migration), "utf8"),
      );
    } catch (error) {
      throw new Error(`Actual migration failed in ${migration}: ${error.message}`, {
        cause: error,
      });
    }
  }
  await setup.query("set role postgres");
  await setup.query(await readFile(join(root, "supabase", "seed.sql"), "utf8"));
  await setup.query("reset role");
  const t0 = "2035-02-01T17:00:00Z";
  await setup.query(
    `insert into public.reservations (
      id, organization_id, location_id, reserved_at, duration_minutes,
      party_size, status, source, booking_channel
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::timestamptz + interval '1 day',
      90, 2, 'booked', 'manual', 'staff'
    )`,
    [ids.reservation, ids.org, ids.location, t0],
  );
  await setup.query(
    `insert into public.reservation_settings (
      organization_id, location_id, staff_push_enabled, approved_at
    ) values ($1::uuid, $2::uuid, true, $3::timestamptz)`,
    [ids.org, ids.location, t0],
  );
  await setup.query(
    `insert into public.notification_preferences (
      organization_id, user_id, notification_type, push
    ) values ($1::uuid, $2::uuid, 'reservation_changed', true)`,
    [ids.org, ids.user],
  );
  await setup.query(
    `insert into public.push_subscriptions (
      id, organization_id, user_id, endpoint_hash, encrypted_subscription
    ) values ($1::uuid, $2::uuid, $3::uuid, $4, decode('aa', 'hex'))`,
    [ids.subscription, ids.org, ids.user, "a".repeat(64)],
  );
  await setup.query(
    `insert into public.notifications (
      id, organization_id, user_id, notification_type, title, body,
      action_url, entity_type, entity_id, created_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'reservation_changed',
      'Reservation changed', 'A reservation changed.', '/reservations',
      'reservation', $4::uuid, $5::timestamptz
    )`,
    [ids.notification, ids.org, ids.user, ids.reservation, t0],
  );
  await setup.query(
    `insert into public.reservation_push_deliveries (
      id, organization_id, notification_id, subscription_id, status,
      attempts, next_attempt_at, created_at, updated_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'queued', 0,
      $5::timestamptz, $5::timestamptz, $5::timestamptz
    )`,
    [ids.delivery, ids.org, ids.notification, ids.subscription, t0],
  );

  first = await testPool.connect();
  second = await testPool.connect();
  await assume(first, "service_role");
  await assume(second, "service_role");

  await first.query("begin");
  const firstClaim = await claim(first, ids.workerA, t0);
  assert(firstClaim.length === 1, "First worker did not claim queued delivery");
  const secondClaim = await claim(second, ids.workerB, t0);
  assert(
    secondClaim.length === 0,
    "SKIP LOCKED exposed the same delivery to a second worker",
    secondClaim,
  );
  await first.query("commit");

  const recovered = await claim(second, ids.workerB, "2035-02-01T17:02:01Z");
  assert(
    recovered.length === 1 &&
      recovered[0].id === firstClaim[0].id &&
      recovered[0].claimToken !== firstClaim[0].claimToken,
    "Expired claim did not recover with a fresh token",
    { first: firstClaim[0], recovered: recovered[0] },
  );
  const secondPid = (await second.query("select pg_backend_pid() pid")).rows[0]
    .pid;
  await first.query("reset role");
  await first.query("begin");
  await first.query(
    `update public.push_subscriptions
     set encrypted_subscription = decode('bb', 'hex')
     where organization_id = $1::uuid and id = $2::uuid`,
    [ids.org, ids.subscription],
  );
  const beginPromise = second.query(
    `select public.service_begin_reservation_push_delivery(
      $1::uuid, $2::uuid, '2035-02-01T17:02:01Z'::timestamptz
    ) result`,
    [recovered[0].id, recovered[0].claimToken],
  );
  await waitForLock(
    setup,
    secondPid,
    "push begin behind an uncommitted subscription rotation",
  );
  await first.query("commit");
  const began = (await beginPromise).rows[0].result;
  assert(
    began.status === "dispatching" &&
      began.encryptedSubscription === "\\xbb",
    "Push begin did not use the post-lock current subscription",
    began,
  );
  await assume(first, "service_role");
  assert(
    (await claim(first, ids.workerA, "2035-02-01T17:04:02Z")).length === 0,
    "Expired provider attempt was automatically replayed",
  );
  const state = (
    await setup.query(
      `select status, last_error_code, claim_token
       from public.reservation_push_deliveries where id = $1::uuid`,
      [ids.delivery],
    )
  ).rows[0];
  assert(
    state.status === "uncertain" &&
      state.last_error_code === "provider_outcome_unknown_after_lease" &&
      state.claim_token === null,
    "Expired provider attempt did not become non-replayable",
    state,
  );

  process.stdout.write(
    "PASS PostgreSQL 17 reservation push two-worker exclusion, stale-claim recovery, current-subscription begin, and provider-attempt non-replay\n",
  );
} finally {
  await Promise.all([rollback(first), rollback(second)]);
  first?.release(true);
  second?.release(true);
  setup?.release(true);
  if (testPool) await testPool.end();
  if (databaseCreated) {
    const admin = await adminPool.connect();
    try {
      await admin.query(`drop database ${quote(databaseName)} with (force)`);
    } finally {
      admin.release();
    }
  }
  for (const role of createdRoles.reverse()) {
    const admin = await adminPool.connect();
    try {
      await admin.query(`drop role if exists ${quote(role)}`);
    } finally {
      admin.release();
    }
  }
  await adminPool.end();
}
