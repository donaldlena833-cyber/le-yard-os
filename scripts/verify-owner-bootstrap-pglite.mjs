import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const root = process.cwd();
const migrationsDirectory = join(root, "supabase", "migrations");
const migrationFiles = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
const expiresAt = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();

const platformBootstrap = `
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

const bootstrapCall = (requestId = "aa000000-0000-4000-8000-000000000001") => `
  select public.bootstrap_initial_tenant(
    '${requestId}',
    'aa000000-0000-4000-8000-000000000002',
    'North River Hospitality',
    'north-river-hospitality',
    'America/New_York',
    'USD',
    '[{"id":"aa000000-0000-4000-8000-000000000003","name":"Garden Room","code":"GARDEN","timezone":"America/New_York","address":{"line1":"10 Orchard Street","city":"New York","region":"NY","postalCode":"10002","country":"US"},"phone":"+1 212 555 0147"}]'::jsonb,
    'aa000000-0000-4000-8000-000000000004',
    'donald@north-river.test',
    'Donald',
    'aa000000-0000-4000-8000-000000000006',
    '${"a".repeat(64)}',
    'aa000000-0000-4000-8000-000000000005',
    'maris@north-river.test',
    'Maris',
    'aa000000-0000-4000-8000-000000000007',
    '${"b".repeat(64)}',
    '${expiresAt}'::timestamptz
  )
`;

async function expectDatabaseError(sql, expectedCode, label) {
  try {
    await db.exec(sql);
  } catch (error) {
    if (error && typeof error === "object" && error.code === expectedCode) return;
    throw new Error(`${label} returned an unexpected error: ${error instanceof Error ? error.message : String(error)}`, { cause: error });
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

try {
  await db.exec(platformBootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }
  await db.exec(`
    insert into auth.users (id, email, raw_app_meta_data, raw_user_meta_data) values
      (
        'aa000000-0000-4000-8000-000000000004',
        'donald@north-river.test',
        '{"pending_organization_id":"aa000000-0000-4000-8000-000000000002","pending_role":"owner","bootstrap_request_id":"aa000000-0000-4000-8000-000000000001"}',
        '{"display_name":"Donald"}'
      ),
      (
        'aa000000-0000-4000-8000-000000000005',
        'maris@north-river.test',
        '{"pending_organization_id":"aa000000-0000-4000-8000-000000000002","pending_role":"owner","bootstrap_request_id":"aa000000-0000-4000-8000-000000000001"}',
        '{"display_name":"Maris"}'
      );
  `);

  await db.exec(`
    set role authenticated;
    select set_config('request.jwt.claims', '{"role":"authenticated"}', false);
  `);
  await expectDatabaseError(bootstrapCall(), "42501", "authenticated bootstrap attempt");

  await db.exec(`
    reset role;
    set role service_role;
    select set_config('request.jwt.claims', '{"role":"service_role"}', false);
    ${bootstrapCall()};
    ${bootstrapCall()};
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);

  const result = await db.query(`
    select
      (select count(*)::integer from public.organizations) as organizations,
      (select count(*)::integer from public.locations) as locations,
      (select count(*)::integer from public.organization_memberships where role = 'owner' and status = 'invited') as pending_owners,
      (select count(*)::integer from public.user_invitations where role = 'owner' and accepted_at is null) as owner_invitations,
      (select count(*)::integer from public.employees where employment_status = 'invited') as invited_employees,
      (select count(*)::integer from private.initial_tenant_bootstrap_requests where completed_at is not null) as completed_requests,
      has_function_privilege(
        'service_role',
        'public.bootstrap_initial_tenant(uuid,uuid,text,text,text,text,jsonb,uuid,text,text,uuid,text,uuid,text,text,uuid,text,timestamp with time zone)',
        'EXECUTE'
      ) as service_can_bootstrap,
      has_function_privilege(
        'authenticated',
        'public.bootstrap_initial_tenant(uuid,uuid,text,text,text,text,jsonb,uuid,text,text,uuid,text,uuid,text,text,uuid,text,timestamp with time zone)',
        'EXECUTE'
      ) as authenticated_can_bootstrap,
      has_table_privilege('service_role', 'private.initial_tenant_bootstrap_requests', 'SELECT') as service_can_read_requests
  `);
  const checks = result.rows[0];
  if (
    checks.organizations !== 1
    || checks.locations !== 1
    || checks.pending_owners !== 2
    || checks.owner_invitations !== 2
    || checks.invited_employees !== 2
    || checks.completed_requests !== 1
    || !checks.service_can_bootstrap
    || checks.authenticated_can_bootstrap
    || checks.service_can_read_requests
  ) {
    throw new Error(`Owner bootstrap verification failed: ${JSON.stringify(checks)}`);
  }

  await db.exec(`
    set role service_role;
    select set_config('request.jwt.claims', '{"role":"service_role"}', false);
  `);
  await expectDatabaseError(
    bootstrapCall("aa000000-0000-4000-8000-000000000099"),
    "23514",
    "second initial tenant bootstrap",
  );
  process.stdout.write("PASS service-only idempotent initial tenant and two-Owner invitation bootstrap\n");
} finally {
  await db.close();
}
