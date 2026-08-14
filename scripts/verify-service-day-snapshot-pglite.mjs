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

const ids = {
  organization: "20000000-0000-4000-8000-000000000001",
  location: "30000000-0000-4000-8000-000000000001",
  otherLocation: "30000000-0000-4000-8000-000000000002",
  admin: "10000000-0000-4000-8000-000000000003",
  manager: "10000000-0000-4000-8000-000000000004",
  employee: "10000000-0000-4000-8000-000000000005",
  deniedManager: "e2000000-0000-4000-8000-000000000001",
  expiredManager: "e2000000-0000-4000-8000-000000000002",
  managerEmployee: "50000000-0000-4000-8000-000000000004",
  expiredManagerEmployee: "e2010000-0000-4000-8000-000000000001",
  managerRole: "e1000000-0000-4000-8000-000000000001",
  expiredManagerRole: "e2020000-0000-4000-8000-000000000001",
  managerAssignment: "e1010000-0000-4000-8000-000000000001",
  expiredManagerAssignment: "e2030000-0000-4000-8000-000000000001",
  capabilityAssignment: "e1020000-0000-4000-8000-000000000001",
  expiredCapabilityAssignment: "e2040000-0000-4000-8000-000000000001",
  capabilityRequest: "e1030000-0000-4000-8000-000000000001",
  expiredCapabilityRequest: "e2050000-0000-4000-8000-000000000001",
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

async function expectDatabaseError(action, expectedCode, label) {
  try {
    await action();
  } catch (error) {
    if (error && typeof error === "object" && error.code === expectedCode) return;
    throw new Error(
      `${label} returned an unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

function isoDate(value) {
  return value instanceof Date
    ? value.toISOString().slice(0, 10)
    : String(value).slice(0, 10);
}

async function providerHealth(locationId = ids.location) {
  return db.query(
    "select * from public.service_day_provider_health($1::uuid, $2::uuid)",
    [ids.organization, locationId],
  );
}

try {
  await db.exec(platformBootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }
  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));
  await db.exec(`
    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values
      ('00000000-0000-0000-0000-000000000000', '${ids.deniedManager}',
       'authenticated', 'authenticated', 'denied-manager@example.invalid', '', now(),
       '{}'::jsonb, '{}'::jsonb, now(), now()),
      ('00000000-0000-0000-0000-000000000000', '${ids.expiredManager}',
       'authenticated', 'authenticated', 'expired-manager@example.invalid', '', now(),
       '{}'::jsonb, '{}'::jsonb, now(), now());
    insert into public.organization_memberships (
      organization_id, user_id, role, status, joined_at
    ) values
      ('${ids.organization}', '${ids.deniedManager}', 'manager', 'active', now()),
      ('${ids.organization}', '${ids.expiredManager}', 'manager', 'active', now());
    insert into public.location_memberships (
      organization_id, location_id, user_id, is_primary
    ) values
      ('${ids.organization}', '${ids.location}', '${ids.deniedManager}', true),
      ('${ids.organization}', '${ids.location}', '${ids.expiredManager}', true);
    insert into public.employees (
      id, organization_id, user_id, home_location_id, employee_number,
      display_name, email, employment_status
    ) values (
      '${ids.expiredManagerEmployee}', '${ids.organization}', '${ids.expiredManager}',
      '${ids.location}', 'EXPIRED-MGR', 'Expired Manager',
      'expired-manager@example.invalid', 'active'
    );
    insert into public.job_roles (
      id, organization_id, name, code, department, default_tip_points, is_tipped
    ) values
      ('${ids.managerRole}', '${ids.organization}', 'Integration Manager',
       'INTEGRATION_MANAGER', 'Operations', 0, false),
      ('${ids.expiredManagerRole}', '${ids.organization}', 'Former Integration Manager',
       'FORMER_INTEGRATION_MANAGER', 'Operations', 0, false);
    insert into public.employee_job_roles (
      id, organization_id, employee_id, job_role_id, location_id,
      effective_from, is_primary
    ) values
      ('${ids.managerAssignment}', '${ids.organization}', '${ids.managerEmployee}',
       '${ids.managerRole}', '${ids.location}', date '2026-01-01', true),
      ('${ids.expiredManagerAssignment}', '${ids.organization}', '${ids.expiredManagerEmployee}',
       '${ids.expiredManagerRole}', '${ids.location}', date '2000-01-01', true);
    insert into public.integration_connections (
      id, organization_id, location_id, provider, display_name, status,
      last_synced_at, created_by, updated_at
    ) values
      ('e1100000-0000-4000-8000-000000000001', '${ids.organization}', null,
       'toast', 'Organization POS', 'connected', '2026-08-10T03:00:00Z', '${ids.admin}', '2026-08-10T03:00:00Z'),
      ('e1100000-0000-4000-8000-000000000002', '${ids.organization}', '${ids.location}',
       'resy', 'Downtown reservations', 'degraded', null, '${ids.admin}', '2026-08-10T03:05:00Z'),
      ('e1100000-0000-4000-8000-000000000003', '${ids.organization}', '${ids.otherLocation}',
       'payroll', 'Uptown payroll', 'connected', '2026-08-10T03:10:00Z', '${ids.admin}', '2026-08-10T03:10:00Z');
    update public.locations
    set timezone = case
      when (clock_timestamp() at time zone 'Pacific/Kiritimati')::date <> current_date
        then 'Pacific/Kiritimati'
      else 'Etc/GMT+12'
    end
    where organization_id = '${ids.organization}'
      and id = '${ids.location}';
    set role authenticated;
  `);

  await assume(ids.admin);
  const effectiveOn = (await db.query(
    `select (clock_timestamp() at time zone timezone)::date::text as local_date,
            current_date::text as session_date
     from public.locations
     where organization_id = $1::uuid and id = $2::uuid`,
    [ids.organization, ids.location],
  )).rows[0];
  if (effectiveOn.local_date === effectiveOn.session_date) {
    throw new Error(`Timezone fixture did not cross a session-date boundary: ${JSON.stringify(effectiveOn)}`);
  }
  await db.query(
    `select public.configure_job_role_capability(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'integrations.manage',
      $5::uuid, $6::date, $6::date, true
    )`,
    [
      ids.capabilityRequest,
      ids.organization,
      ids.capabilityAssignment,
      ids.managerRole,
      ids.location,
      effectiveOn.local_date,
    ],
  );
  await db.query(
    `select public.configure_job_role_capability(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'integrations.manage',
      $5::uuid, date '2000-01-01', date '2000-01-02', true
    )`,
    [
      ids.expiredCapabilityRequest,
      ids.organization,
      ids.expiredCapabilityAssignment,
      ids.expiredManagerRole,
      ids.location,
    ],
  );

  await assume(ids.manager);
  const result = await providerHealth();
  if (result.rows.length !== 2) {
    throw new Error(`Capable manager received the wrong provider scope: ${JSON.stringify(result.rows)}`);
  }
  const fields = Object.keys(result.rows[0] ?? {}).sort();
  const expectedFields = [
    "display_name",
    "last_synced_at",
    "provider",
    "status",
    "updated_at",
  ];
  if (JSON.stringify(fields) !== JSON.stringify(expectedFields)) {
    throw new Error(`Provider RPC returned non-minimal fields: ${JSON.stringify(fields)}`);
  }
  if (
    result.rows.some((row) => row.display_name === "Uptown payroll") ||
    !result.rows.some((row) => row.display_name === "Organization POS") ||
    !result.rows.some((row) => row.display_name === "Downtown reservations")
  ) {
    throw new Error(`Provider RPC crossed location scope: ${JSON.stringify(result.rows)}`);
  }
  const directRows = await db.query(
    "select display_name from public.integration_connections where organization_id = $1::uuid",
    [ids.organization],
  );
  if (directRows.rows.length !== 0) {
    throw new Error("Capability RPC unexpectedly broadened raw integration table RLS.");
  }
  await expectDatabaseError(
    () => providerHealth(ids.otherLocation),
    "42501",
    "cross-location provider health",
  );

  await assume(ids.deniedManager);
  await expectDatabaseError(
    () => providerHealth(),
    "42501",
    "manager without integration capability",
  );

  await assume(ids.expiredManager);
  await expectDatabaseError(
    () => providerHealth(),
    "42501",
    "manager with expired integration capability",
  );

  await assume(ids.employee);
  await expectDatabaseError(
    () => providerHealth(),
    "42501",
    "denied employee provider health",
  );

  await db.query("select set_config('request.jwt.claims', '{}', false)");
  await expectDatabaseError(
    () => providerHealth(),
    "42501",
    "missing principal provider health",
  );

  await db.exec("reset role");
  await db.exec(`
    update public.locations set timezone = 'America/New_York'
    where organization_id = '${ids.organization}' and id = '${ids.location}';

    insert into public.reservation_service_periods (
      id, organization_id, location_id, name, days_of_week,
      starts_local, ends_local, default_duration_minutes,
      pacing_interval_minutes, pacing_cover_limit, min_party_size,
      max_party_size, effective_from, effective_to, online_enabled,
      is_active, approved_at, approved_by
    ) values
      ('d9000000-0000-4000-8000-000000000001', '${ids.organization}', '${ids.location}',
       'Overnight dinner', array[0], '17:00', '02:00', 90, 15, 12, 1, 10,
       date '2026-08-09', date '2026-08-09', true, true,
       '2026-08-01T12:00:00Z', '${ids.admin}'),
      ('d9000000-0000-4000-8000-000000000002', '${ids.organization}', '${ids.location}',
       'Spring DST service', array[0], '00:30', '03:30', 90, 15, 30, 1, 10,
       date '2026-03-08', date '2026-03-08', false, true, null, null),
      ('d9000000-0000-4000-8000-000000000003', '${ids.organization}', '${ids.location}',
       'Fall DST service', array[0], '00:30', '03:30', 90, 15, 30, 1, 10,
       date '2026-11-01', date '2026-11-01', true, true,
       '2026-08-01T12:00:00Z', '${ids.admin}');

    insert into public.schedules (
      id, organization_id, location_id, week_start, status, version,
      created_by, published_by, published_at
    ) values
      ('d9100000-0000-4000-8000-000000000001', '${ids.organization}', '${ids.location}',
       date '2026-08-10', 'published', 1, '${ids.admin}', '${ids.admin}', '2026-08-01T12:00:00Z'),
      ('d9100000-0000-4000-8000-000000000002', '${ids.organization}', '${ids.location}',
       date '2026-08-10', 'published', 2, '${ids.admin}', '${ids.admin}', '2026-08-01T12:00:00Z');

    insert into public.shifts (
      id, organization_id, location_id, schedule_id, employee_id, job_role_id,
      starts_at, ends_at, status, is_open
    ) values
      ('d9200000-0000-4000-8000-000000000001', '${ids.organization}', '${ids.location}',
       'd9100000-0000-4000-8000-000000000001', null, '${ids.managerRole}',
       '2026-08-17T03:00:00Z', '2026-08-17T07:00:00Z', 'open', true),
      ('d9200000-0000-4000-8000-000000000002', '${ids.organization}', '${ids.location}',
       'd9100000-0000-4000-8000-000000000002', null, '${ids.managerRole}',
       '2026-08-16T21:00:00Z', '2026-08-17T06:00:00Z', 'open', true),
      ('d9200000-0000-4000-8000-000000000003', '${ids.organization}', '${ids.location}',
       'd9100000-0000-4000-8000-000000000002', null, '${ids.managerRole}',
       '2026-08-17T03:00:00Z', '2026-08-17T06:00:00Z', 'open', true);

    insert into public.reservations (
      id, organization_id, location_id, reserved_at, party_size, status,
      source, duration_minutes, booking_channel, version
    ) values (
      'd9300000-0000-4000-8000-000000000001', '${ids.organization}', '${ids.location}',
      '2026-08-10T03:55:00Z', 8, 'confirmed', 'manual', 90, 'staff', 1
    );
  `);

  const wallTimeContract = (await db.query(`
    select
      private.local_wall_timestamp_is_unambiguous(
        timestamp '2026-03-08 02:30', 'America/New_York'
      ) as spring_gap,
      private.local_wall_timestamp_is_unambiguous(
        timestamp '2026-11-01 01:30', 'America/New_York'
      ) as autumn_fold,
      private.local_wall_timestamp_is_unambiguous(
        timestamp '2026-11-01 00:30', 'America/New_York'
      ) as before_fold,
      private.local_wall_timestamp_is_unambiguous(
        timestamp '2026-11-01 02:30', 'America/New_York'
      ) as after_fold
  `)).rows[0];
  if (
    wallTimeContract.spring_gap
    || wallTimeContract.autumn_fold
    || !wallTimeContract.before_fold
    || !wallTimeContract.after_fold
  ) {
    throw new Error(
      `Local wall-time uniqueness contract drifted: ${JSON.stringify(wallTimeContract)}`,
    );
  }

  await expectDatabaseError(
    () => db.query(`
      insert into public.reservation_service_periods (
        id, organization_id, location_id, name, days_of_week,
        starts_local, ends_local, default_duration_minutes,
        pacing_interval_minutes, pacing_cover_limit, min_party_size,
        max_party_size, effective_from, effective_to, online_enabled,
        is_active
      ) values (
        'd9000000-0000-4000-8000-000000000010', $1::uuid, $2::uuid,
        'Gap boundary', array[0], '02:30', '04:00', 90, 15, 20, 1, 8,
        date '2026-03-08', date '2026-03-08', false, true
      )
    `, [ids.organization, ids.location]),
    "23514",
    "nonexistent service-period boundary",
  );
  await expectDatabaseError(
    () => db.query(`
      insert into public.reservation_service_periods (
        id, organization_id, location_id, name, days_of_week,
        starts_local, ends_local, default_duration_minutes,
        pacing_interval_minutes, pacing_cover_limit, min_party_size,
        max_party_size, effective_from, effective_to, online_enabled,
        is_active
      ) values (
        'd9000000-0000-4000-8000-000000000011', $1::uuid, $2::uuid,
        'Fold boundary', array[0], '01:30', '03:00', 90, 15, 20, 1, 8,
        date '2026-11-01', date '2026-11-01', false, true
      )
    `, [ids.organization, ids.location]),
    "23514",
    "ambiguous service-period boundary",
  );

  await db.query(`
    update public.locations
    set timezone = 'UTC'
    where organization_id = $1::uuid and id = $2::uuid
  `, [ids.organization, ids.otherLocation]);
  await db.query(`
    insert into public.reservation_service_periods (
      id, organization_id, location_id, name, days_of_week,
      starts_local, ends_local, default_duration_minutes,
      pacing_interval_minutes, pacing_cover_limit, min_party_size,
      max_party_size, effective_from, effective_to, online_enabled,
      is_active
    ) values (
      'd9000000-0000-4000-8000-000000000016', $1::uuid, $2::uuid,
      'Timezone replay fold', array[0], '01:30', '03:00', 90, 15, 20, 1, 8,
      date '2026-11-01', date '2026-11-01', false, true
    )
  `, [ids.organization, ids.otherLocation]);
  await expectDatabaseError(
    () => db.query(`
      update public.locations
      set timezone = 'America/New_York'
      where organization_id = $1::uuid and id = $2::uuid
    `, [ids.organization, ids.otherLocation]),
    "23514",
    "timezone edit against a newly ambiguous service boundary",
  );
  const guardedTimezone = (await db.query(`
    select timezone
    from public.locations
    where organization_id = $1::uuid and id = $2::uuid
  `, [ids.organization, ids.otherLocation])).rows[0]?.timezone;
  if (guardedTimezone !== "UTC") {
    throw new Error(`Rejected timezone edit was not atomic: ${guardedTimezone}`);
  }

  await expectDatabaseError(
    () => db.query(`
      insert into public.reservation_service_periods (
        id, organization_id, location_id, name, days_of_week,
        starts_local, ends_local, default_duration_minutes,
        pacing_interval_minutes, pacing_cover_limit, min_party_size,
        max_party_size, effective_from, effective_to, online_enabled,
        is_active
      ) values (
        'd9000000-0000-4000-8000-000000000012', $1::uuid, $2::uuid,
        'Opening overlap', array[0], '18:00', '20:00', 90, 15, 20, 1, 8,
        date '2026-08-09', date '2026-08-09', false, true
      )
    `, [ids.organization, ids.location]),
    "23P01",
    "same-day service-period overlap",
  );
  await expectDatabaseError(
    () => db.query(`
      insert into public.reservation_service_periods (
        id, organization_id, location_id, name, days_of_week,
        starts_local, ends_local, default_duration_minutes,
        pacing_interval_minutes, pacing_cover_limit, min_party_size,
        max_party_size, effective_from, effective_to, online_enabled,
        is_active
      ) values (
        'd9000000-0000-4000-8000-000000000013', $1::uuid, $2::uuid,
        'Carryover overlap', array[1], '01:00', '03:00', 90, 15, 20, 1, 8,
        date '2026-08-10', date '2026-08-10', false, true
      )
    `, [ids.organization, ids.location]),
    "23P01",
    "overnight carryover service-period overlap",
  );

  // Exact adjacency is allowed, and the same wall-clock interval is allowed
  // when no effective weekday occurrence intersects.
  await db.query(`
    insert into public.reservation_service_periods (
      id, organization_id, location_id, name, days_of_week,
      starts_local, ends_local, default_duration_minutes,
      pacing_interval_minutes, pacing_cover_limit, min_party_size,
      max_party_size, effective_from, effective_to, online_enabled,
      is_active
    ) values
      ('d9000000-0000-4000-8000-000000000014', $1::uuid, $2::uuid,
       'Carryover adjacent', array[1], '02:00', '04:00', 90, 15, 20, 1, 8,
       date '2026-08-10', date '2026-08-10', false, true),
      ('d9000000-0000-4000-8000-000000000015', $1::uuid, $2::uuid,
       'Later effective occurrence', array[1], '01:00', '03:00', 90, 15, 20, 1, 8,
       date '2026-08-17', date '2026-08-17', false, true)
  `, [ids.organization, ids.location]);
  const safeSpanCount = Number((await db.query(`
    select count(*) as count
    from private.reservation_service_period_spans span
    where span.service_period_id in (
      'd9000000-0000-4000-8000-000000000014',
      'd9000000-0000-4000-8000-000000000015'
    )
  `)).rows[0].count);
  if (safeSpanCount !== 2) {
    throw new Error(`Service-period spans were not materialized exactly: ${safeSpanCount}`);
  }

  await db.exec("set role authenticated");
  await assume(ids.manager);
  const serviceDay = (observedAt) => db.query(
    "select * from public.service_day_business_date($1::uuid, $2::uuid, $3::timestamptz)",
    [ids.organization, ids.location, observedAt],
  );
  const overnight = (await serviceDay("2026-08-10T04:01:00Z")).rows[0];
  if (
    isoDate(overnight.businessDate) !== "2026-08-09"
    || isoDate(overnight.calendarDate) !== "2026-08-10"
    || overnight.source !== "materialized_service_shift"
    || new Date(overnight.startsAt).toISOString() !== "2026-08-09T21:00:00.000Z"
    || new Date(overnight.endsAt).toISOString() !== "2026-08-10T06:00:00.000Z"
  ) throw new Error(`Overnight service date was not retained: ${JSON.stringify(overnight)}`);

  const spring = (await serviceDay("2026-03-08T06:30:00Z")).rows[0];
  if (
    isoDate(spring.businessDate) !== "2026-03-08"
    || new Date(spring.startsAt).toISOString() !== "2026-03-08T05:30:00.000Z"
    || new Date(spring.endsAt).toISOString() !== "2026-03-08T07:30:00.000Z"
  ) throw new Error(`Spring DST boundary was not timezone-derived: ${JSON.stringify(spring)}`);

  const fall = (await serviceDay("2026-11-01T07:30:00Z")).rows[0];
  if (
    isoDate(fall.businessDate) !== "2026-11-01"
    || new Date(fall.startsAt).toISOString() !== "2026-11-01T04:30:00.000Z"
    || new Date(fall.endsAt).toISOString() !== "2026-11-01T08:30:00.000Z"
  ) throw new Error(`Fall DST boundary was not timezone-derived: ${JSON.stringify(fall)}`);

  for (const foldInstant of [
    "2026-11-01T05:30:00Z",
    "2026-11-01T06:30:00Z",
  ]) {
    const folded = (await serviceDay(foldInstant)).rows[0];
    if (folded.source !== "calendar" || folded.servicePeriodId !== null) {
      throw new Error(
        `Ambiguous fold instant resolved to a service period: ${JSON.stringify(folded)}`,
      );
    }
  }

  await db.exec("reset role");
  for (const foldInstant of [
    "2026-11-01T05:30:00Z",
    "2026-11-01T06:30:00Z",
  ]) {
    await expectDatabaseError(
      () => db.query(
        "select private.assert_reservation_pacing($1::uuid, $2::uuid, $3::timestamptz, 2, null, null)",
        [ids.organization, ids.location, foldInstant],
      ),
      "23514",
      "ambiguous reservation pacing slot",
    );
  }
  await db.exec("set role authenticated");
  await assume(ids.manager);

  const scheduleOnly = (await serviceDay("2026-08-17T04:30:00Z")).rows[0];
  if (
    isoDate(scheduleOnly.businessDate) !== "2026-08-16"
    || scheduleOnly.source !== "published_shift"
    || new Date(scheduleOnly.startsAt).toISOString() !== "2026-08-16T21:00:00.000Z"
  ) throw new Error(`Earliest latest-version shift was not retained: ${JSON.stringify(scheduleOnly)}`);

  await expectDatabaseError(
    () => db.query(
      "select * from public.service_day_business_date($1::uuid, $2::uuid, $3::timestamptz)",
      [ids.organization, ids.otherLocation, "2026-08-10T04:01:00Z"],
    ),
    "42501",
    "cross-location service-day read",
  );

  await db.exec("reset role");
  await db.exec(`
    delete from private.reservation_inventory_days
    where location_id = '${ids.location}';
    select private.lock_reservation_inventory_many(
      '${ids.location}',
      array['2026-08-10T03:55:00Z', '2026-08-10T04:05:00Z']::timestamptz[]
    );
  `);
  const lockDates = (await db.query(
    "select business_date from private.reservation_inventory_days where location_id = $1::uuid order by business_date",
    [ids.location],
  )).rows;
  if (lockDates.length !== 1 || isoDate(lockDates[0].business_date) !== "2026-08-09") {
    throw new Error(`Overnight inventory lock split across dates: ${JSON.stringify(lockDates)}`);
  }
  await expectDatabaseError(
    () => db.query(
      "select private.assert_reservation_pacing($1::uuid, $2::uuid, $3::timestamptz, 5, null, null)",
      [ids.organization, ids.location, "2026-08-10T04:05:00Z"],
    ),
    "23P01",
    "after-midnight pacing",
  );

  const grants = (await db.query(`
    select
      has_function_privilege('anon', 'public.service_day_provider_health(uuid,uuid)', 'EXECUTE') as anon_execute,
      has_function_privilege('authenticated', 'public.service_day_provider_health(uuid,uuid)', 'EXECUTE') as authenticated_execute,
      has_function_privilege('anon', 'public.service_day_business_date(uuid,uuid,timestamptz)', 'EXECUTE') as anon_business_date,
      has_function_privilege('authenticated', 'public.service_day_business_date(uuid,uuid,timestamptz)', 'EXECUTE') as authenticated_business_date
  `)).rows[0];
  if (
    grants.anon_execute
    || !grants.authenticated_execute
    || grants.anon_business_date
    || !grants.authenticated_business_date
  ) {
    throw new Error(`Provider RPC grants are unsafe: ${JSON.stringify(grants)}`);
  }
  const definition = (await db.query(
    "select pg_get_functiondef('public.service_day_provider_health(uuid,uuid)'::regprocedure) as sql",
  )).rows[0]?.sql ?? "";
  if (
    !/clock_timestamp\(\)\s+at\s+time\s+zone\s+location\.timezone/i.test(definition) ||
    /has_capability\([\s\S]*current_date/i.test(definition)
  ) {
    throw new Error(`Provider RPC effective date is not location-timezone bound: ${definition}`);
  }

  process.stdout.write(
    "PASS service-day provider health plus overnight/DST business dates, latest schedule version, earliest overlapping shift, exact access, unified inventory lock, after-midnight pacing, and grants\n",
  );
} finally {
  await db.close();
}
