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
const followingDate = (date) => new Date(Date.parse(`${date}T00:00:00Z`) + 86_400_000)
  .toISOString()
  .slice(0, 10);
const minutesAfter = (instant, minutes) => new Date(instant.valueOf() + minutes * 60_000).toISOString();

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
  // Snapshot reads accept the site's current local date through 400 days out.
  // Choose one date safely inside each offset period independent of the runner's season.
  const { today, timezone } = (await db.query(
    `select (statement_timestamp() at time zone timezone)::date::text today, timezone
     from public.locations where id = $1::uuid`,
    [ids.location],
  )).rows[0];
  if (timezone !== "America/New_York") throw new Error(`Unexpected fixture timezone: ${timezone}`);
  const upcomingDate = (monthDay) => {
    const year = Number(today.slice(0, 4));
    const thisYear = `${year}-${monthDay}`;
    return thisYear >= today ? thisYear : `${year + 1}-${monthDay}`;
  };
  const businessDate = upcomingDate("01-15");
  const summerDate = upcomingDate("07-15");
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
      $5::date, true, true, statement_timestamp(), $4::uuid
    )`,
    [ids.period, ids.organization, ids.location, ids.owner, [businessDate, summerDate].sort()[0]],
  );

  await assume(ids.owner);
  await db.exec("set role authenticated");
  const readSnapshot = (date) => db.query(
    "select * from public.service_reservation_shift_snapshot($1::uuid,$2::uuid,$3::date)",
    [ids.organization, ids.location, date],
  );
  let winterShift;
  for (const { season, date, startUtc, endUtc } of [
    { season: "winter", date: businessDate, startUtc: "22:00", endUtc: "08:00" },
    { season: "summer", date: summerDate, startUtc: "21:00", endUtc: "07:00" },
  ]) {
    const { rows } = await readSnapshot(date);
    if (
      rows.length !== 1 || rows[0].servicePeriodId !== ids.period ||
      rows[0].startsAt.toISOString() !== `${date}T${startUtc}:00.000Z` ||
      rows[0].endsAt.toISOString() !== `${followingDate(date)}T${endUtc}:00.000Z`
    ) {
      throw new Error(`Overnight ${season} materialization is wrong: ${JSON.stringify(rows)}`);
    }
    if (season === "winter") winterShift = rows[0];
  }
  const { shiftId, startsAt, endsAt } = winterShift;
  const closureStarts = minutesAfter(startsAt, 120);
  const pacingStarts = minutesAfter(startsAt, 180);
  const closedSlot = minutesAfter(startsAt, 135);
  const reducedPacingSlot = minutesAfter(startsAt, 195);

  await db.query(
    `select public.configure_service_shift_exception(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,'closure',
      $5::timestamptz,$6::timestamptz,
      null,null,null,null,'Private event closure',true
    )`,
    [ids.closure, ids.organization, ids.location, shiftId, closureStarts, pacingStarts],
  );
  await db.query(
    `select public.configure_service_shift_exception(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,'pacing_override',
      $5::timestamptz,$6::timestamptz,
      30,2,null,null,'Reduced kitchen pacing',true
    )`,
    [ids.pacing, ids.organization, ids.location, shiftId, pacingStarts, minutesAfter(startsAt, 240)],
  );
  const configureBuffer = () => db.query(
    `select public.configure_service_shift_exception(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,'buffer_override',
      $5::timestamptz,$6::timestamptz,
      null,null,30,45,'Opening and close buffers',true
    ) result`,
    [ids.buffer, ids.organization, ids.location, shiftId, startsAt.toISOString(), endsAt.toISOString()],
  );
  const bufferResult = await configureBuffer();
  const replay = await configureBuffer();
  if (bufferResult.rows[0].result.replayed || !replay.rows[0].result.replayed) {
    throw new Error("Service-shift exception replay evidence is wrong");
  }
  const snapshot = (await readSnapshot(businessDate)).rows[0];
  if (snapshot.exceptions.length !== 3) {
    throw new Error(`Active exceptions are incomplete: ${JSON.stringify(snapshot)}`);
  }

  await db.exec("reset role");
  await expectError(
    () => db.query(
      "select private.assert_public_reservation_slot_contract($1::uuid,$2::uuid,$3::timestamptz,90,2)",
      [ids.organization, ids.location, closedSlot],
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
    "select private.assert_public_reservation_slot_contract($1::uuid,$2::uuid,$3::timestamptz,90,2)",
    [ids.organization, ids.location, closedSlot],
  );
  await expectError(
    () => db.query(
      "select private.assert_public_reservation_slot_contract($1::uuid,$2::uuid,$3::timestamptz,90,2)",
      [ids.organization, ids.location, startsAt.toISOString()],
    ),
    "23514",
    "opening buffer",
  );
  await expectError(
    () => db.query(
      "select private.assert_reservation_pacing($1::uuid,$2::uuid,$3::timestamptz,3,null,null)",
      [ids.organization, ids.location, reducedPacingSlot],
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
    () => readSnapshot(businessDate),
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
    () => readSnapshot(businessDate),
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
    "PASS materialized service shifts, winter and summer overnight boundaries, closures, pacing, buffers, replay, and tenant scope\n",
  );
} finally {
  await db.close();
}
