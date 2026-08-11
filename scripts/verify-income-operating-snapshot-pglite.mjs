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
  otherOrganization: "20000000-0000-4000-8000-000000000002",
  otherLocation: "30000000-0000-4000-8000-000000000003",
  owner: "10000000-0000-4000-8000-000000000001",
  employee: "10000000-0000-4000-8000-000000000005",
  employeeRecord: "50000000-0000-4000-8000-000000000005",
  jobRole: "40000000-0000-4000-8000-000000000001",
  assignment: "51000000-0000-4000-8000-000000000001",
  timeEntry: "e1000000-0000-4000-8000-000000000001",
  timeBreak: "e2000000-0000-4000-8000-000000000001",
  expense: "e3000000-0000-4000-8000-000000000001",
  reservation: "e4000000-0000-4000-8000-000000000001",
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

async function assume(role, userId = null) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role, ...(userId ? { sub: userId, aal: "aal1" } : {}) }),
  ]);
  await db.exec(`set role ${role}`);
}

async function expectError(action, code, label) {
  try {
    await action();
  } catch (error) {
    if (error && typeof error === "object" && error.code === code) return;
    throw new Error(`${label} returned ${error?.code ?? String(error)}`, {
      cause: error,
    });
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

try {
  await db.exec(platformBootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }
  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));

  await assume("authenticated", ids.owner);
  const rawPrivileges = (
    await db.query(`
    select
      has_table_privilege('authenticated', 'public.income_sales_checks', 'SELECT') as can_select,
      has_function_privilege('authenticated',
        'public.ingest_income_sales_check(uuid,uuid,text,text,text,timestamptz,timestamptz,bigint,bigint,bigint,bigint,bigint,bigint,bigint,bigint,integer,text,timestamptz,text)',
        'EXECUTE') as can_ingest
  `)
  ).rows[0];
  if (rawPrivileges.can_select || rawPrivileges.can_ingest) {
    throw new Error(
      "Browser roles can reach raw income facts or provider ingest",
    );
  }

  await expectError(
    () =>
      db.query(
        "select public.income_operating_snapshot($1::uuid,$2::uuid,clock_timestamp(),28)",
        [ids.otherOrganization, ids.otherLocation],
      ),
    "42501",
    "cross-tenant income snapshot",
  );
  await assume("authenticated", ids.employee);
  await expectError(
    () =>
      db.query(
        "select public.income_operating_snapshot($1::uuid,$2::uuid,clock_timestamp(),28)",
        [ids.organization, ids.location],
      ),
    "42501",
    "financial-capability denied snapshot",
  );

  await assume("service_role");
  await db.exec("reset role");
  await db.query(
    `update public.employee_job_roles set hourly_rate_cents = 2400
     where id = $1::uuid`,
    [ids.assignment],
  );
  await db.query(
    `with local_day as (
       select (clock_timestamp() at time zone timezone)::date as value, timezone
       from public.locations where id = $1::uuid
     )
     insert into public.time_entries (
       id, organization_id, location_id, employee_id, job_role_id,
       clocked_in_at, clocked_out_at, status, source
     ) select $2::uuid,$3::uuid,$1::uuid,$4::uuid,$5::uuid,
       (value + time '17:00') at time zone timezone,
       (value + time '19:00') at time zone timezone,
       'approved','import' from local_day`,
    [
      ids.location,
      ids.timeEntry,
      ids.organization,
      ids.employeeRecord,
      ids.jobRole,
    ],
  );
  await db.query(
    `insert into public.time_breaks (
       id, organization_id, time_entry_id, started_at, ended_at, is_paid, source
     ) select $1::uuid,$2::uuid,$3::uuid,
       entry.clocked_in_at + interval '45 minutes',
       entry.clocked_in_at + interval '75 minutes',false,'import'
     from public.time_entries entry where entry.id = $3::uuid`,
    [ids.timeBreak, ids.organization, ids.timeEntry],
  );
  await db.query(
    `insert into public.expenses (
       id, organization_id, location_id, expense_date, subtotal_cents,
       tax_cents, description, created_by
     ) select $1::uuid,$2::uuid,$3::uuid,
       (clock_timestamp() at time zone location.timezone)::date,
       1800,200,'Income proof',$4::uuid
     from public.locations location where location.id = $3::uuid`,
    [ids.expense, ids.organization, ids.location, ids.owner],
  );
  await db.query(
    `insert into public.reservations (
       id,organization_id,location_id,reserved_at,party_size,status,source
     ) select $1::uuid,$2::uuid,$3::uuid,
       ((clock_timestamp() at time zone location.timezone)::date + time '18:00')
         at time zone location.timezone,
       4,'confirmed','manual'
     from public.locations location where location.id = $3::uuid`,
    [ids.reservation, ids.organization, ids.location],
  );

  const ingestObservedAt = new Date();
  const ingestArgs = [
    ids.organization,
    ids.location,
    "toast",
    "check-income-proof",
    "closed",
    new Date(ingestObservedAt.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    new Date(ingestObservedAt.getTime() - 30 * 60 * 1000).toISOString(),
    12000,
    10000,
    0,
    0,
    0,
    0,
    0,
    0,
    4,
    "dine_in",
    ingestObservedAt.toISOString(),
    "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  ];
  const ingestSql = `select public.ingest_income_sales_check(
    $1::uuid,$2::uuid,$3,$4,$5,
    coalesce($6::timestamptz,clock_timestamp()-interval '2 hours'),
    coalesce($7::timestamptz,clock_timestamp()-interval '30 minutes'),
    $8,$9,$10,$11,$12,$13,$14,$15,$16,$17,
    coalesce($18::timestamptz,clock_timestamp()),$19
  ) as result`;
  await assume("service_role");
  const created = (await db.query(ingestSql, ingestArgs)).rows[0].result;
  const replayed = (await db.query(ingestSql, ingestArgs)).rows[0].result;
  if (created.replayed !== false || replayed.replayed !== true) {
    throw new Error("Income check ingest lost exact replay semantics");
  }
  const staleArgs = [...ingestArgs];
  staleArgs[7] = 12001;
  staleArgs[17] = new Date(Date.now() - 60_000).toISOString();
  staleArgs[18] =
    "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
  await expectError(
    () => db.query(ingestSql, staleArgs),
    "40001",
    "stale sales update",
  );

  await assume("authenticated", ids.owner);
  const result = (
    await db.query(
      "select public.income_operating_snapshot($1::uuid,$2::uuid,clock_timestamp(),28) as value",
      [ids.organization, ids.location],
    )
  ).rows[0].value;
  const metrics = result.current;
  if (
    metrics.liveNetSalesCents !== 10000 ||
    metrics.liveGrossSalesCents !== 12000 ||
    metrics.salesCheckCount !== 1 ||
    metrics.salesCovers !== 4 ||
    metrics.laborMinutes !== 90 ||
    metrics.laborKnownRateMinutes !== 90 ||
    metrics.laborCostCents !== 3600 ||
    metrics.recordedExpenseCents !== 2000 ||
    metrics.trackedContributionCents !== 4400
  ) {
    throw new Error(
      `Income current metric contract drifted: ${JSON.stringify(metrics)}`,
    );
  }
  const hour18 = result.hourly.find((bucket) => bucket.hour === 18);
  if (!hour18 || hour18.reservationCovers < 4 || hour18.laborMinutes !== 45) {
    throw new Error(`Income hourly profile drifted: ${JSON.stringify(hour18)}`);
  }
  await assume("service_role");
  await db.exec("reset role");
  await db.query(
    `update public.reservations
     set status = 'completed', completed_at = clock_timestamp()
     where id = $1::uuid`,
    [ids.reservation],
  );
  await assume("authenticated", ids.owner);
  const afterCompletion = (
    await db.query(
      "select public.income_operating_snapshot($1::uuid,$2::uuid,clock_timestamp(),28) as value",
      [ids.organization, ids.location],
    )
  ).rows[0].value;
  const completedHour = afterCompletion.hourly.find(
    (bucket) => bucket.hour === 18,
  );
  if (!completedHour || completedHour.reservationCovers < 4) {
    throw new Error(
      "Completed service demand disappeared from the historical hourly profile",
    );
  }
  const salesSource = result.sources.find(
    (source) => source.key === "sales_checks",
  );
  if (!salesSource || salesSource.recordCount !== 1) {
    throw new Error(
      `Income source evidence was multiplied or omitted: ${JSON.stringify(result.sources)}`,
    );
  }

  await assume("service_role");
  await db.exec("reset role");
  await db.query(
    "delete from public.income_sales_checks where organization_id = $1::uuid",
    [ids.organization],
  );
  await assume("authenticated", ids.owner);
  const withoutSales = (
    await db.query(
      "select public.income_operating_snapshot($1::uuid,$2::uuid,clock_timestamp(),28) as value",
      [ids.organization, ids.location],
    )
  ).rows[0].value;
  if (
    withoutSales.current.liveNetSalesCents !== null ||
    withoutSales.current.trackedContributionCents !== null
  ) {
    throw new Error(
      "Missing sales facts were rendered as zero or profit-like contribution",
    );
  }

  console.log("Income operating snapshot PGlite verification passed.");
} finally {
  await db.close();
}
