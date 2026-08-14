import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";

const root = process.cwd();
const migrationsDirectory = join(root, "supabase", "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
const businessDate = new Date().toISOString().slice(0, 10);
const nextBusinessDate = new Date(Date.parse(`${businessDate}T00:00:00Z`) + 86_400_000)
  .toISOString()
  .slice(0, 10);

const ids = {
  organization: "20000000-0000-4000-8000-000000000001",
  location: "30000000-0000-4000-8000-000000000001",
  owner: "10000000-0000-4000-8000-000000000001",
  otherOwner: "10000000-0000-4000-8000-000000000006",
  period: "ea100000-0000-4000-8000-000000000001",
  closure: "ea200000-0000-4000-8000-000000000001",
  pacing: "ea200000-0000-4000-8000-000000000002",
  buffer: "ea200000-0000-4000-8000-000000000003",
  revokeClosure: "ea200000-0000-4000-8000-000000000004",
};

const platformBootstrap = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create schema if not exists storage;
  do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
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

async function assume(userId) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "authenticated", sub: userId, aal: "aal1" }),
  ]);
}

async function expectError(action, code, label) {
  try {
    await action();
  } catch (error) {
    if (error && typeof error === "object" && error.code === code) return;
    throw new Error(`${label} returned ${error?.code ?? String(error)}`, { cause: error });
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

try {
  await db.exec(platformBootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }
  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));
  await db.query(
    `insert into public.reservation_service_periods (
      id, organization_id, location_id, name, days_of_week,
      starts_local, ends_local, default_duration_minutes,
      pacing_interval_minutes, pacing_cover_limit, min_party_size,
      max_party_size, effective_from, online_enabled, is_active,
      approved_at, approved_by
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'Night service', array[0,1,2,3,4,5,6],
      time '17:00', time '03:00', 90, 15, 20, 1, 10,
      date '${businessDate}', true, true, '${businessDate}T12:00:00Z', $4::uuid
    )`,
    [ids.period, ids.organization, ids.location, ids.owner],
  );

  await assume(ids.owner);
  await db.exec("set role authenticated");
  const initial = (
    await db.query(
      `select * from public.service_reservation_shift_snapshot($1::uuid,$2::uuid,date '${businessDate}')`,
      [ids.organization, ids.location],
    )
  ).rows;
  if (
    initial.length !== 1 || initial[0].servicePeriodId !== ids.period ||
    initial[0].startsAt.toISOString() !== `${businessDate}T21:00:00.000Z` ||
    initial[0].endsAt.toISOString() !== `${nextBusinessDate}T07:00:00.000Z`
  ) {
    throw new Error(`Overnight materialization is wrong: ${JSON.stringify(initial)}`);
  }
  const shiftId = initial[0].shiftId;

  await db.query(
    `select public.configure_service_shift_exception(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,'closure',
      '${businessDate}T23:00:00Z','${nextBusinessDate}T00:00:00Z',
      null,null,null,null,'Private event closure',true
    )`,
    [ids.closure, ids.organization, ids.location, shiftId],
  );
  await db.query(
    `select public.configure_service_shift_exception(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,'pacing_override',
      '${nextBusinessDate}T00:00:00Z','${nextBusinessDate}T01:00:00Z',
      30,2,null,null,'Reduced kitchen pacing',true
    )`,
    [ids.pacing, ids.organization, ids.location, shiftId],
  );
  const bufferResult = await db.query(
    `select public.configure_service_shift_exception(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,'buffer_override',
      '${businessDate}T21:00:00Z','${nextBusinessDate}T07:00:00Z',
      null,null,30,45,'Opening and close buffers',true
    ) result`,
    [ids.buffer, ids.organization, ids.location, shiftId],
  );
  const replay = await db.query(
    `select public.configure_service_shift_exception(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,'buffer_override',
      '${businessDate}T21:00:00Z','${nextBusinessDate}T07:00:00Z',
      null,null,30,45,'Opening and close buffers',true
    ) result`,
    [ids.buffer, ids.organization, ids.location, shiftId],
  );
  if (bufferResult.rows[0].result.replayed || !replay.rows[0].result.replayed) {
    throw new Error("Service-shift exception replay evidence is wrong");
  }
  const snapshot = (
    await db.query(
      `select * from public.service_reservation_shift_snapshot($1::uuid,$2::uuid,date '${businessDate}')`,
      [ids.organization, ids.location],
    )
  ).rows[0];
  if (snapshot.exceptions.length !== 3) {
    throw new Error(`Active exceptions are incomplete: ${JSON.stringify(snapshot)}`);
  }

  await db.exec("reset role");
  await expectError(
    () => db.query(
      `select private.assert_public_reservation_slot_contract($1::uuid,$2::uuid,'${businessDate}T23:15:00Z',90,2)`,
      [ids.organization, ids.location],
    ),
    "23514",
    "closed slot",
  );
  await db.exec("set role authenticated");
  const revoked = await db.query(
    "select public.revoke_service_shift_exception($1::uuid,$2::uuid,'Service reopened after review') result",
    [ids.revokeClosure, ids.closure],
  );
  if (revoked.rows[0].result.status !== "revoked") {
    throw new Error(`Closure revocation failed: ${JSON.stringify(revoked.rows[0])}`);
  }
  await db.exec("reset role");
  await db.query(
    `select private.assert_public_reservation_slot_contract($1::uuid,$2::uuid,'${businessDate}T23:15:00Z',90,2)`,
    [ids.organization, ids.location],
  );
  await expectError(
    () => db.query(
      `select private.assert_public_reservation_slot_contract($1::uuid,$2::uuid,'${businessDate}T21:00:00Z',90,2)`,
      [ids.organization, ids.location],
    ),
    "23514",
    "opening buffer",
  );
  await expectError(
    () => db.query(
      `select private.assert_reservation_pacing($1::uuid,$2::uuid,'${nextBusinessDate}T00:15:00Z',3,null,null)`,
      [ids.organization, ids.location],
    ),
    "23P01",
    "reduced pacing",
  );

  await db.query(
    "update public.reservation_service_periods set starts_local = time '18:00' where id = $1::uuid",
    [ids.period],
  );
  await db.exec("set role authenticated");
  await expectError(
    () => db.query(
      `select * from public.service_reservation_shift_snapshot($1::uuid,$2::uuid,date '${businessDate}')`,
      [ids.organization, ids.location],
    ),
    "23514",
    "configuration drift across active exception evidence",
  );
  await db.exec("reset role");
  await db.query(
    "update public.reservation_service_periods set starts_local = time '17:00' where id = $1::uuid",
    [ids.period],
  );

  await assume(ids.otherOwner);
  await db.exec("set role authenticated");
  await expectError(
    () => db.query(
      `select * from public.service_reservation_shift_snapshot($1::uuid,$2::uuid,date '${businessDate}')`,
      [ids.organization, ids.location],
    ),
    "42501",
    "cross-tenant snapshot",
  );
  const direct = await db.query(
    "select id from public.service_shifts where organization_id = $1::uuid",
    [ids.organization],
  );
  if (direct.rows.length !== 0) throw new Error("Service-shift RLS crossed tenant scope");

  await db.exec("reset role");
  const revokeDefinition = (
    await db.query(
      "select pg_get_functiondef('public.revoke_service_shift_exception(uuid,uuid,text)'::regprocedure) definition",
    )
  ).rows[0].definition;
  const shiftLock = revokeDefinition.indexOf("for update;", revokeDefinition.indexOf("from public.service_shifts"));
  const exceptionLock = revokeDefinition.indexOf("for update;", shiftLock + 1);
  if (shiftLock < 0 || exceptionLock <= shiftLock) {
    throw new Error("Exception revocation does not lock shift before exception");
  }
  const snapshotDefinition = (
    await db.query(
      "select pg_get_functiondef('public.service_reservation_shift_snapshot(uuid,uuid,date)'::regprocedure) definition",
    )
  ).rows[0].definition;
  if (snapshotDefinition.includes("auth.role()")) {
    throw new Error("Service snapshot uses deprecated auth.role authorization");
  }

  process.stdout.write(
    "PASS materialized service shifts, overnight boundaries, closures, pacing, buffers, replay, and tenant scope\n",
  );
} finally {
  await db.close();
}
