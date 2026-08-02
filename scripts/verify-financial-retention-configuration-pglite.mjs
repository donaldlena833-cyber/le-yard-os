import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const root = process.cwd();
const migrationsDirectory = join(root, "supabase", "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter(
    (file) =>
      file.endsWith(".sql") &&
      (file.startsWith("20260801000") ||
        file.startsWith("202608010010") ||
        file.startsWith("202608010011") ||
        file.startsWith("202608010012") ||
        file.startsWith("202608010013") ||
        file.startsWith("202608010014") ||
        file.startsWith("202608010015") ||
        file.startsWith("202608010016") ||
        file.startsWith("202608010017") ||
        file.startsWith("202608010018") ||
        file === "202608010022_financial_retention_configuration.sql" ||
        file === "202608010023_tip_policy_approval_role_boundary.sql"),
  )
  .sort();

const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });

async function expectDatabaseError(sql, expectedCode, label) {
  try {
    await db.exec(sql);
  } catch (error) {
    if (error && typeof error === "object" && error.code === expectedCode) return;
    throw new Error(
      `${label} returned an unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

const bootstrap = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create schema if not exists storage;

  do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;

  create table auth.users (
    instance_id uuid,
    id uuid primary key,
    aud text,
    role text,
    email text unique,
    encrypted_password text,
    email_confirmed_at timestamptz,
    raw_app_meta_data jsonb not null default '{}'::jsonb,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table auth.identities (
    id uuid primary key,
    provider_id text not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    identity_data jsonb not null default '{}'::jsonb,
    provider text not null,
    last_sign_in_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (provider_id, provider)
  );

  create function auth.jwt()
  returns jsonb language sql stable
  as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
  $$;

  create function auth.uid()
  returns uuid language sql stable
  as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;

  create function auth.role()
  returns text language sql stable
  as $$
    select coalesce(nullif(auth.jwt() ->> 'role', ''), current_user::text)
  $$;

  create table storage.buckets (
    id text primary key,
    name text not null unique,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );

  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets(id) on delete cascade,
    name text not null,
    owner_id text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant usage on schema auth, storage to authenticated;
  grant select on storage.buckets to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`;

try {
  await db.exec(bootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }
  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));

  await db.exec(`
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',
      false
    );
  `);

  await expectDatabaseError(
    `insert into public.tip_pool_policies (
       id, organization_id, location_id, name, created_by
     ) values (
       'f0220000-0000-4000-8000-000000000090',
       '20000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000001',
       'Forged direct policy',
       '10000000-0000-4000-8000-000000000003'
     )`,
    "42501",
    "direct authenticated tip policy insert",
  );

  await db.exec(`
    select public.configure_tip_pool_policy(
      'f0220000-0000-4000-8000-000000000001',
      'f0220000-0000-4000-8000-000000000011',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'Dinner pool',
      'Owner-authored dinner policy',
      true
    );
    select public.configure_tip_pool_policy(
      'f0220000-0000-4000-8000-000000000001',
      'f0220000-0000-4000-8000-000000000011',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'Dinner pool',
      'Owner-authored dinner policy',
      true
    );
  `);

  await expectDatabaseError(
    `select public.configure_tip_pool_policy(
      'f0220000-0000-4000-8000-000000000001',
      'f0220000-0000-4000-8000-000000000011',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'Changed replay', null, true
    )`,
    "23505",
    "tip policy request-id payload binding",
  );

  await db.exec(`
    select public.save_tip_pool_policy_draft(
      'f0220000-0000-4000-8000-000000000002',
      'f0220000-0000-4000-8000-000000000011',
      'f0220000-0000-4000-8000-000000000012',
      'weighted_hours',
      date '2026-08-01',
      null,
      array['cash_tips', 'card_tips'],
      '[
        {"job_role_id":"40000000-0000-4000-8000-000000000001","eligible":true,"points":1,"minimum_minutes":30},
        {"job_role_id":"40000000-0000-4000-8000-000000000002","eligible":true,"points":1.25,"minimum_minutes":30}
      ]'::jsonb
    );
    select public.save_tip_pool_policy_draft(
      'f0220000-0000-4000-8000-000000000002',
      'f0220000-0000-4000-8000-000000000011',
      'f0220000-0000-4000-8000-000000000012',
      'weighted_hours',
      date '2026-08-01',
      null,
      array['card_tips', 'cash_tips'],
      '[
        {"job_role_id":"40000000-0000-4000-8000-000000000001","eligible":true,"points":1,"minimum_minutes":30},
        {"job_role_id":"40000000-0000-4000-8000-000000000002","eligible":true,"points":1.25,"minimum_minutes":30}
      ]'::jsonb
    );
  `);

  await expectDatabaseError(
    `insert into public.tip_pool_policy_versions (
       id, organization_id, policy_id, version, distribution_method,
       effective_from, source_rules, created_by
     ) values (
       'f0220000-0000-4000-8000-000000000091',
       '20000000-0000-4000-8000-000000000001',
       'f0220000-0000-4000-8000-000000000011',
       99, 'hours', date '2026-08-01',
       '{"closeout_sources":["card_tips"]}'::jsonb,
       '10000000-0000-4000-8000-000000000003'
     )`,
    "42501",
    "direct authenticated tip version insert",
  );

  await expectDatabaseError(
    `select public.approve_tip_policy_version(
      'f0220000-0000-4000-8000-000000000003',
      'f0220000-0000-4000-8000-000000000012'
    )`,
    "42501",
    "tip policy self approval",
  );

  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.approve_tip_policy_version(
      'f0220000-0000-4000-8000-000000000004',
      'f0220000-0000-4000-8000-000000000012'
    );
    select public.approve_tip_policy_version(
      'f0220000-0000-4000-8000-000000000004',
      'f0220000-0000-4000-8000-000000000012'
    );
  `);

  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.save_tip_pool_policy_draft(
      'f0220000-0000-4000-8000-000000000002',
      'f0220000-0000-4000-8000-000000000011',
      'f0220000-0000-4000-8000-000000000012',
      'weighted_hours',
      date '2026-08-01',
      null,
      array['card_tips', 'cash_tips'],
      '[
        {"job_role_id":"40000000-0000-4000-8000-000000000001","eligible":true,"points":1,"minimum_minutes":30},
        {"job_role_id":"40000000-0000-4000-8000-000000000002","eligible":true,"points":1.25,"minimum_minutes":30}
      ]'::jsonb
    );
  `);

  await expectDatabaseError(
    `update public.tip_pool_policy_versions
     set effective_to = date '2026-12-31'
     where id = 'f0220000-0000-4000-8000-000000000012'`,
    "42501",
    "direct authenticated approved version mutation",
  );

  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.configure_retention_policy(
      'f0220000-0000-4000-8000-000000000005',
      'f0220000-0000-4000-8000-000000000013',
      '20000000-0000-4000-8000-000000000001',
      'receipts',
      2555,
      false,
      'Recorded owner decision'
    );
    select public.configure_retention_policy(
      'f0220000-0000-4000-8000-000000000005',
      'f0220000-0000-4000-8000-000000000013',
      '20000000-0000-4000-8000-000000000001',
      'receipts',
      2555,
      false,
      'Recorded owner decision'
    );
  `);

  await expectDatabaseError(
    `update public.retention_policies
     set retention_days = 1
     where id = 'f0220000-0000-4000-8000-000000000013'`,
    "42501",
    "direct authenticated retention mutation",
  );

  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000006","role":"authenticated","aal":"aal2"}',
      false
    );
  `);
  await expectDatabaseError(
    `select public.configure_retention_policy(
      'f0220000-0000-4000-8000-000000000006',
      'f0220000-0000-4000-8000-000000000014',
      '20000000-0000-4000-8000-000000000001',
      'audit_events', 3650, false, null
    )`,
    "42501",
    "cross-tenant retention configuration",
  );

  await db.exec(`
    reset role;
    insert into private.financial_approval_requests (
      request_id, organization_id, location_id,
      record_type, record_id, actor_id, completed_at
    ) values (
      'f0220000-0000-4000-8000-000000000008',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'tip_policy_version',
      'f0220000-0000-4000-8000-000000000012',
      '10000000-0000-4000-8000-000000000004',
      clock_timestamp()
    );
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  await expectDatabaseError(
    `select public.configure_tip_pool_policy(
      'f0220000-0000-4000-8000-000000000007',
      'f0220000-0000-4000-8000-000000000015',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'Manager-forged policy', null, true
    )`,
    "42501",
    "manager tip policy authoring",
  );
  await expectDatabaseError(
    `select public.approve_tip_policy_version(
      'f0220000-0000-4000-8000-000000000008',
      'f0220000-0000-4000-8000-000000000012'
    )`,
    "42501",
    "manager historical tip policy approval replay",
  );

  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);
  const checks = await db.query(`
    select
      (select created_by = '10000000-0000-4000-8000-000000000003'
       from public.tip_pool_policies
       where id = 'f0220000-0000-4000-8000-000000000011') as actor_stamped_policy,
      (select approved_by = '10000000-0000-4000-8000-000000000002'
         and approved_at is not null
       from public.tip_pool_policy_versions
       where id = 'f0220000-0000-4000-8000-000000000012') as independent_approval,
      (select count(*)::integer = 2
       from public.tip_pool_eligibility_rules
       where policy_version_id = 'f0220000-0000-4000-8000-000000000012') as exact_rules,
      (select configured_by = '10000000-0000-4000-8000-000000000003'
         and retention_days = 2555
       from public.retention_policies
       where id = 'f0220000-0000-4000-8000-000000000013') as actor_stamped_retention,
      (select count(*)::integer = 3
       from private.operation_requests
       where request_id in (
         'f0220000-0000-4000-8000-000000000001',
         'f0220000-0000-4000-8000-000000000002',
         'f0220000-0000-4000-8000-000000000005'
       ) and completed_at is not null) as completed_requests,
      (select count(*)::integer >= 4
       from public.audit_events
       where table_name in (
         'tip_pool_policies', 'tip_pool_policy_versions',
         'tip_pool_eligibility_rules', 'retention_policies'
       ) and record_id in (
         'f0220000-0000-4000-8000-000000000011',
         'f0220000-0000-4000-8000-000000000012',
         'f0220000-0000-4000-8000-000000000013'
       )) as audited
  `);
  const row = checks.rows[0];
  if (Object.values(row).some((value) => value !== true)) {
    throw new Error(`Financial/retention assertions failed: ${JSON.stringify(row)}`);
  }

  process.stdout.write(
    "PASS Owner/Admin financial configuration, manager denial, replay binding, and independent approval\n",
  );
} finally {
  await db.close();
}
