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
  otherOrganization: "20000000-0000-4000-8000-000000000002",
  location: "30000000-0000-4000-8000-000000000001",
  otherLocation: "30000000-0000-4000-8000-000000000002",
  tenantLocation: "30000000-0000-4000-8000-000000000003",
  owner: "10000000-0000-4000-8000-000000000001",
  admin: "10000000-0000-4000-8000-000000000003",
  manager: "10000000-0000-4000-8000-000000000004",
  otherOwner: "10000000-0000-4000-8000-000000000006",
  deniedManager: "ed000000-0000-4000-8000-000000000001",
  expiredManager: "ed000000-0000-4000-8000-000000000002",
  deniedEmployee: "ed100000-0000-4000-8000-000000000001",
  expiredEmployee: "ed100000-0000-4000-8000-000000000002",
  activeRole: "ed200000-0000-4000-8000-000000000001",
  expiredRole: "ed200000-0000-4000-8000-000000000002",
  mainCloseout: "ed300000-0000-4000-8000-000000000001",
  otherCloseout: "ed300000-0000-4000-8000-000000000002",
  tenantCloseout: "ed300000-0000-4000-8000-000000000003",
  mainCount: "ed400000-0000-4000-8000-000000000001",
  otherCount: "ed400000-0000-4000-8000-000000000002",
  tenantCount: "ed400000-0000-4000-8000-000000000003",
  mainPar: "74000000-0000-4000-8000-000000000001",
  otherPar: "ed500000-0000-4000-8000-000000000002",
  tenantPar: "ed500000-0000-4000-8000-000000000003",
  mainLog: "ed800000-0000-4000-8000-000000000001",
  otherLog: "ed800000-0000-4000-8000-000000000002",
  tenantLog: "ed800000-0000-4000-8000-000000000003",
  westBoundaryLocation: "ed900000-0000-4000-8000-000000000001",
  eastBoundaryLocation: "ed900000-0000-4000-8000-000000000002",
  westBoundaryHostRole: "eda00000-0000-4000-8000-000000000001",
  eastBoundaryHostRole: "eda00000-0000-4000-8000-000000000002",
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

function claimsFor(userId) {
  return JSON.stringify({ role: "authenticated", sub: userId, aal: "aal1" });
}

async function assume(userId) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [claimsFor(userId)]);
}

async function idsFrom(table) {
  const result = await db.query(`select id::text from public.${table} order by id`);
  return result.rows.map((row) => row.id);
}

async function managerLogVersionParentIds() {
  const result = await db.query(`
    select manager_log_entry_id::text as id
    from public.manager_log_versions
    order by manager_log_entry_id
  `);
  return result.rows.map((row) => row.id);
}

function assertIds(actual, expected, label) {
  const sortedExpected = [...expected].sort();
  if (JSON.stringify(actual) !== JSON.stringify(sortedExpected)) {
    throw new Error(`${label} scope mismatch: ${JSON.stringify(actual)}`);
  }
}

async function assertVisible(expected, label) {
  assertIds(await idsFrom("shift_closeouts"), expected.closeouts, `${label} closeouts`);
  assertIds(await idsFrom("inventory_counts"), expected.counts, `${label} counts`);
  assertIds(await idsFrom("inventory_par_levels"), expected.pars, `${label} pars`);
  assertIds(await idsFrom("manager_log_entries"), expected.logs, `${label} manager logs`);
  assertIds(
    await managerLogVersionParentIds(),
    expected.logVersions,
    `${label} manager-log versions`,
  );
}

try {
  await db.exec(platformBootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }
  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));

  await db.exec(`
    set timezone = 'UTC';
    update public.locations
    set timezone = case
      when (statement_timestamp() at time zone 'Pacific/Kiritimati')::date <> current_date
        then 'Pacific/Kiritimati'
      else 'Etc/GMT+12'
    end
    where organization_id = '${ids.organization}' and id = '${ids.location}';

    insert into public.locations (
      id, organization_id, name, code, timezone, address
    ) values
      ('${ids.westBoundaryLocation}', '${ids.organization}',
       'Reservation default west boundary', 'RLS-WEST', 'Etc/GMT+12', '{}'::jsonb),
      ('${ids.eastBoundaryLocation}', '${ids.organization}',
       'Reservation default east boundary', 'RLS-EAST', 'Pacific/Kiritimati', '{}'::jsonb);

    set timezone = 'Pacific/Kiritimati';
    insert into public.job_roles (
      id, organization_id, name, code, department, default_tip_points, is_tipped
    ) values (
      '${ids.westBoundaryHostRole}', '${ids.organization}',
      'Boundary Host West', 'BOUNDARY_HOST_WEST', 'Front of house', 0, false
    );
    do $reservation_default_west$
    begin
      if exists (
        select 1 from public.job_role_capabilities grant_row
        where grant_row.job_role_id = '${ids.westBoundaryHostRole}'
          and grant_row.location_id is null
      ) or (
        select count(*) from public.job_role_capabilities grant_row
        where grant_row.job_role_id = '${ids.westBoundaryHostRole}'
          and grant_row.location_id = '${ids.westBoundaryLocation}'
          and grant_row.effective_from = (
            statement_timestamp() at time zone 'Etc/GMT+12'
          )::date
          and grant_row.effective_from < current_date
      ) <> 2 then
        raise exception 'West-of-session reservation defaults were not location-local';
      end if;
    end
    $reservation_default_west$;

    set timezone = 'Etc/GMT+12';
    insert into public.job_roles (
      id, organization_id, name, code, department, default_tip_points, is_tipped
    ) values (
      '${ids.eastBoundaryHostRole}', '${ids.organization}',
      'Boundary Host East', 'BOUNDARY_HOST_EAST', 'Front of house', 0, false
    );
    do $reservation_default_east$
    begin
      if exists (
        select 1 from public.job_role_capabilities grant_row
        where grant_row.job_role_id = '${ids.eastBoundaryHostRole}'
          and grant_row.location_id is null
      ) or (
        select count(*) from public.job_role_capabilities grant_row
        where grant_row.job_role_id = '${ids.eastBoundaryHostRole}'
          and grant_row.location_id = '${ids.eastBoundaryLocation}'
          and grant_row.effective_from = (
            statement_timestamp() at time zone 'Pacific/Kiritimati'
          )::date
          and grant_row.effective_from > current_date
      ) <> 2 then
        raise exception 'East-of-session reservation defaults were not location-local';
      end if;
    end
    $reservation_default_east$;
    set timezone = 'UTC';

    insert into auth.users (
      instance_id, id, aud, role, email, encrypted_password, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values
      ('00000000-0000-0000-0000-000000000000', '${ids.deniedManager}',
       'authenticated', 'authenticated', 'denied-service-day@example.invalid', '', now(),
       '{}'::jsonb, '{}'::jsonb, now(), now()),
      ('00000000-0000-0000-0000-000000000000', '${ids.expiredManager}',
       'authenticated', 'authenticated', 'expired-service-day@example.invalid', '', now(),
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
      display_name, email, hire_date, employment_status
    ) values
      ('${ids.deniedEmployee}', '${ids.organization}', '${ids.deniedManager}',
       '${ids.location}', 'RLS-DENIED', 'Denied snapshot manager',
       'denied-service-day@example.invalid', date '2000-01-01', 'active'),
      ('${ids.expiredEmployee}', '${ids.organization}', '${ids.expiredManager}',
       '${ids.location}', 'RLS-EXPIRED', 'Expired snapshot manager',
       'expired-service-day@example.invalid', date '2000-01-01', 'active');
    insert into public.job_roles (
      id, organization_id, name, code, department, default_tip_points, is_tipped
    ) values
      ('${ids.activeRole}', '${ids.organization}', 'Snapshot reader',
       'SNAPSHOT_READER', 'Operations', 0, false),
      ('${ids.expiredRole}', '${ids.organization}', 'Former snapshot reader',
       'FORMER_SNAPSHOT_READER', 'Operations', 0, false);

    with local_day as (
      select (statement_timestamp() at time zone location.timezone)::date as value
      from public.locations location
      where location.organization_id = '${ids.organization}' and location.id = '${ids.location}'
    )
    insert into public.employee_job_roles (
      organization_id, employee_id, job_role_id, location_id, effective_from, is_primary
    )
    select '${ids.organization}', employee_id, job_role_id, '${ids.location}',
      local_day.value - 1, true
    from local_day
    cross join (values
      ('50000000-0000-4000-8000-000000000004'::uuid, '${ids.activeRole}'::uuid),
      ('${ids.deniedEmployee}'::uuid, '${ids.activeRole}'::uuid),
      ('${ids.expiredEmployee}'::uuid, '${ids.expiredRole}'::uuid)
    ) assignment(employee_id, job_role_id);

    with local_day as (
      select (statement_timestamp() at time zone location.timezone)::date as value
      from public.locations location
      where location.organization_id = '${ids.organization}' and location.id = '${ids.location}'
    )
    insert into public.job_role_capabilities (
      organization_id, job_role_id, capability_key, location_id,
      effective_from, effective_to, created_by, updated_by
    )
    select '${ids.organization}', role_id, capability_key, '${ids.location}',
      case when role_id = '${ids.expiredRole}' then local_day.value - 2 else local_day.value end,
      case when role_id = '${ids.expiredRole}' then local_day.value - 1 else local_day.value end,
      '${ids.owner}', '${ids.owner}'
    from local_day
    cross join (values
      ('${ids.activeRole}'::uuid, 'closeout.create'),
      ('${ids.activeRole}'::uuid, 'inventory.count.create'),
      ('${ids.activeRole}'::uuid, 'manager_log.manage'),
      ('${ids.expiredRole}'::uuid, 'closeout.create'),
      ('${ids.expiredRole}'::uuid, 'inventory.count.create'),
      ('${ids.expiredRole}'::uuid, 'manager_log.manage')
    ) grant_row(role_id, capability_key);

    with local_day as (
      select (statement_timestamp() at time zone location.timezone)::date as value
      from public.locations location
      where location.organization_id = '${ids.organization}' and location.id = '${ids.location}'
    )
    insert into public.user_capability_overrides (
      organization_id, user_id, capability_key, location_id, effect, reason,
      effective_from, effective_to, created_by, updated_by
    )
    select '${ids.organization}', '${ids.deniedManager}', capability_key,
      '${ids.location}', 'deny', 'PGlite explicit-deny proof',
      local_day.value, local_day.value, '${ids.owner}', '${ids.owner}'
    from local_day
    cross join (values
      ('closeout.create'),
      ('inventory.count.create'),
      ('manager_log.manage')
    ) denied(capability_key);

    insert into public.shift_closeouts (
      id, organization_id, location_id, business_date, shift_label,
      gross_sales_cents, net_sales_cents, submitted_by
    ) values
      ('${ids.mainCloseout}', '${ids.organization}', '${ids.location}', current_date,
       'main', 10000, 9000, '${ids.owner}'),
      ('${ids.otherCloseout}', '${ids.organization}', '${ids.otherLocation}', current_date,
       'other-location', 20000, 18000, '${ids.owner}'),
      ('${ids.tenantCloseout}', '${ids.otherOrganization}', '${ids.tenantLocation}', current_date,
       'other-tenant', 30000, 27000, '${ids.otherOwner}');
    insert into public.inventory_counts (
      id, organization_id, location_id, status, count_type, counted_by
    ) values
      ('${ids.mainCount}', '${ids.organization}', '${ids.location}', 'pending', 'full', '${ids.owner}'),
      ('${ids.otherCount}', '${ids.organization}', '${ids.otherLocation}', 'pending', 'cycle', '${ids.owner}'),
      ('${ids.tenantCount}', '${ids.otherOrganization}', '${ids.tenantLocation}', 'pending', 'spot', '${ids.otherOwner}');

    insert into public.measurement_units (
      id, organization_id, name, symbol, dimension, is_base
    ) values (
      'ed600000-0000-4000-8000-000000000001', '${ids.otherOrganization}',
      'Snapshot each', 'snap-ea', 'count', true
    );
    insert into public.inventory_items (
      id, organization_id, base_unit_id, name, sku
    ) values (
      'ed700000-0000-4000-8000-000000000001', '${ids.otherOrganization}',
      'ed600000-0000-4000-8000-000000000001', 'Snapshot tenant item', 'SNAP-TENANT'
    );
    insert into public.inventory_par_levels (
      id, organization_id, location_id, inventory_item_id, par_quantity, effective_from
    ) values
      ('${ids.otherPar}', '${ids.organization}', '${ids.otherLocation}',
       '72000000-0000-4000-8000-000000000001', 30, current_date),
      ('${ids.tenantPar}', '${ids.otherOrganization}', '${ids.tenantLocation}',
       'ed700000-0000-4000-8000-000000000001', 40, current_date);

    insert into public.manager_log_entries (
      id, organization_id, location_id, business_date, service_period,
      category, severity, title, narrative, author_id, status
    ) values
      ('${ids.mainLog}', '${ids.organization}', '${ids.location}', current_date,
       'dinner', 'guest', 'awareness', 'Main handoff', 'Main location narrative',
       '${ids.owner}', 'informational'),
      ('${ids.otherLog}', '${ids.organization}', '${ids.otherLocation}', current_date,
       'dinner', 'employee', 'action_required', 'Other handoff', 'Other location narrative',
       '${ids.owner}', 'needs_follow_up'),
      ('${ids.tenantLog}', '${ids.otherOrganization}', '${ids.tenantLocation}', current_date,
       'dinner', 'reservation', 'critical', 'Tenant handoff', 'Other tenant narrative',
       '${ids.otherOwner}', 'needs_follow_up');
    insert into public.manager_log_versions (
      organization_id, manager_log_entry_id, version_number, snapshot, changed_by
    ) values
      ('${ids.organization}', '${ids.mainLog}', 1, '{"title":"Main handoff"}'::jsonb, '${ids.owner}'),
      ('${ids.organization}', '${ids.otherLog}', 1, '{"title":"Other handoff"}'::jsonb, '${ids.owner}'),
      ('${ids.otherOrganization}', '${ids.tenantLog}', 1, '{"title":"Tenant handoff"}'::jsonb, '${ids.otherOwner}');

    set role authenticated;
  `);

  await assume(ids.manager);
  const dateBoundary = (await db.query(`
    select
      current_date::text as session_date,
      (
        statement_timestamp() at time zone (
          select location.timezone
          from public.locations location
          where location.organization_id = $1::uuid and location.id = $2::uuid
        )
      )::date::text as location_date,
      public.has_capability($1::uuid, $2::uuid, 'closeout.create') as local_default,
      public.has_capability(
        $1::uuid, $2::uuid, 'closeout.create', current_date
      ) as explicit_session_date
  `, [ids.organization, ids.location])).rows[0];
  if (
    dateBoundary.session_date === dateBoundary.location_date ||
    !dateBoundary.local_default ||
    dateBoundary.explicit_session_date
  ) {
    throw new Error(`Location-local effective-date proof failed: ${JSON.stringify(dateBoundary)}`);
  }
  await assertVisible({
    closeouts: [ids.mainCloseout],
    counts: [ids.mainCount],
    pars: [ids.mainPar],
    logs: [ids.mainLog],
    logVersions: [ids.mainLog],
  }, "capable manager");

  await assume(ids.deniedManager);
  await assertVisible(
    { closeouts: [], counts: [], pars: [], logs: [], logVersions: [] },
    "explicitly denied manager",
  );
  const denied = (await db.query(`
    select
      public.has_capability($1::uuid, $2::uuid, 'closeout.create') as closeout,
      public.has_capability($1::uuid, $2::uuid, 'inventory.count.create') as inventory,
      public.has_capability($1::uuid, $2::uuid, 'manager_log.manage') as manager_log
  `, [ids.organization, ids.location])).rows[0];
  if (denied.closeout || denied.inventory || denied.manager_log) {
    throw new Error(`Explicit capability deny was bypassed: ${JSON.stringify(denied)}`);
  }

  await assume(ids.expiredManager);
  await assertVisible(
    { closeouts: [], counts: [], pars: [], logs: [], logVersions: [] },
    "expired capability manager",
  );

  await assume(ids.owner);
  await assertVisible({
    closeouts: [ids.mainCloseout, ids.otherCloseout],
    counts: [ids.mainCount, ids.otherCount],
    pars: [ids.mainPar, ids.otherPar],
    logs: [ids.mainLog, ids.otherLog],
    logVersions: [ids.mainLog, ids.otherLog],
  }, "owner");

  await assume(ids.admin);
  await assertVisible({
    closeouts: [ids.mainCloseout, ids.otherCloseout],
    counts: [ids.mainCount, ids.otherCount],
    pars: [ids.mainPar, ids.otherPar],
    logs: [ids.mainLog, ids.otherLog],
    logVersions: [ids.mainLog, ids.otherLog],
  }, "admin");

  await assume(ids.otherOwner);
  await assertVisible({
    closeouts: [ids.tenantCloseout],
    counts: [ids.tenantCount],
    pars: [ids.tenantPar],
    logs: [ids.tenantLog],
    logVersions: [ids.tenantLog],
  }, "other-tenant owner");

  await db.exec("reset role; select set_config('request.jwt.claims', '{}', false)");
  const policies = await db.query(`
    select tablename, policyname, cmd, permissive
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'shift_closeouts',
        'inventory_counts',
        'inventory_par_levels',
        'manager_log_entries',
        'manager_log_versions'
      ])
    order by tablename, cmd, policyname
  `);
  for (const table of [
    "shift_closeouts",
    "inventory_counts",
    "inventory_par_levels",
    "manager_log_entries",
    "manager_log_versions",
  ]) {
    const tablePolicies = policies.rows.filter((policy) => policy.tablename === table);
    const permissiveSelectPolicies = tablePolicies.filter(
      (policy) => policy.cmd === "SELECT" && policy.permissive === "PERMISSIVE",
    );
    if (
      permissiveSelectPolicies.length !== 1 ||
      !permissiveSelectPolicies[0].policyname.startsWith("service_day_") ||
      (table !== "manager_log_entries" &&
        table !== "manager_log_versions" &&
        (!tablePolicies.some((policy) => policy.cmd === "INSERT") ||
          !tablePolicies.some((policy) => policy.cmd === "UPDATE") ||
          !tablePolicies.some((policy) => policy.cmd === "DELETE")))
    ) {
      throw new Error(`${table} policy contract drifted: ${JSON.stringify(tablePolicies)}`);
    }
  }

  process.stdout.write(
    "PASS snapshot-sensitive reads, manager-log history, and reservation-role defaults: exact capability, explicit deny, expired grant, owner/admin, location-local dates, cross-location/tenant scope, and preserved write policies\n",
  );
} finally {
  await db.close();
}
