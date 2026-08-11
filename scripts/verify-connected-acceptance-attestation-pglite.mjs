import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const root = process.cwd();
const migrationsDirectory = join(root, "supabase", "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });

const targetId = "11111111-1111-4111-8111-111111111111";
const fixtureId = "22222222-2222-4222-8222-222222222222";
const fixtureRevision = "role-matrix-v1";
const expectedSchemaVersion = migrationFiles.at(-1)?.slice(0, 14);
if (!expectedSchemaVersion || !/^[0-9]{14}$/.test(expectedSchemaVersion))
  throw new Error("The latest migration does not have a 14-digit version");

const bootstrap = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create schema if not exists storage;
  create schema if not exists supabase_migrations;
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
  create table supabase_migrations.schema_migrations (
    version text primary key
  );
`;

async function expectDatabaseError(sql, label) {
  try {
    await db.exec(sql);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "42501") return;
    throw new Error(
      `${label} returned an unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

try {
  await db.exec(bootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
    await db.query(
      "insert into supabase_migrations.schema_migrations (version) values ($1)",
      [file.slice(0, 14)],
    );
  }
  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));

  const initiallyEmpty = await db.query(
    "select count(*)::integer as count from private.connected_acceptance_targets",
  );
  if (initiallyEmpty.rows[0]?.count !== 0)
    throw new Error("A production-capable migration or seed created an acceptance marker");
  process.stdout.write("PASS migration and seed create no acceptance marker\n");

  const grants = (
    await db.query(`
      select
        has_schema_privilege('anon', 'private', 'USAGE') as anon_schema,
        has_schema_privilege('authenticated', 'private', 'USAGE') as authenticated_schema,
        has_schema_privilege('service_role', 'private', 'USAGE') as service_schema,
        has_table_privilege('anon', 'private.connected_acceptance_targets', 'SELECT') as anon_table,
        has_table_privilege('authenticated', 'private.connected_acceptance_targets', 'SELECT') as authenticated_table,
        has_table_privilege('service_role', 'private.connected_acceptance_targets', 'SELECT') as service_table,
        has_function_privilege('anon', 'public.service_connected_acceptance_marker(uuid,text,uuid,text)', 'EXECUTE') as anon_rpc,
        has_function_privilege('authenticated', 'public.service_connected_acceptance_marker(uuid,text,uuid,text)', 'EXECUTE') as authenticated_rpc,
        has_function_privilege('service_role', 'public.service_connected_acceptance_marker(uuid,text,uuid,text)', 'EXECUTE') as service_rpc
    `)
  ).rows[0];
  if (
    grants.anon_schema ||
    grants.authenticated_schema ||
    grants.service_schema ||
    grants.anon_table ||
    grants.authenticated_table ||
    grants.service_table ||
    grants.anon_rpc ||
    grants.authenticated_rpc ||
    !grants.service_rpc
  )
    throw new Error(`Attestation grant boundary failed: ${JSON.stringify(grants)}`);
  process.stdout.write("PASS private marker is inaccessible and RPC is service-role-only\n");

  await db.exec(`
    insert into private.connected_acceptance_targets (
      target_id, environment, schema_version, fixture_id, fixture_revision, expires_at, created_by
    ) values (
      '${targetId}', 'nonproduction_preview', '${expectedSchemaVersion}', '${fixtureId}', '${fixtureRevision}',
      clock_timestamp() + interval '1 day', 'pglite acceptance verifier'
    )
  `);

  await expectDatabaseError(
    `set role anon; select * from public.service_connected_acceptance_marker('${targetId}', '${expectedSchemaVersion}', '${fixtureId}', '${fixtureRevision}');`,
    "anonymous attestation RPC",
  );
  await db.exec("reset role");
  await expectDatabaseError(
    `set role authenticated; select * from public.service_connected_acceptance_marker('${targetId}', '${expectedSchemaVersion}', '${fixtureId}', '${fixtureRevision}');`,
    "authenticated attestation RPC",
  );
  await db.exec("reset role");
  await expectDatabaseError(
    "set role service_role; select * from private.connected_acceptance_targets;",
    "service-role direct marker read",
  );
  await db.exec("reset role");

  await db.exec("set role service_role");
  const exact = await db.query(`
    select * from public.service_connected_acceptance_marker(
      '${targetId}', '${expectedSchemaVersion}', '${fixtureId}', '${fixtureRevision}'
    )
  `);
  await db.exec("reset role");
  if (
    exact.rows.length !== 1 ||
    exact.rows[0]?.target_id !== targetId ||
    exact.rows[0]?.environment !== "nonproduction_preview" ||
    exact.rows[0]?.schema_version !== expectedSchemaVersion ||
    exact.rows[0]?.fixture_id !== fixtureId ||
    exact.rows[0]?.fixture_revision !== fixtureRevision
  )
    throw new Error(`Exact marker proof failed: ${JSON.stringify(exact.rows)}`);

  await db.exec("set role service_role");
  const wrongFixture = await db.query(`
    select * from public.service_connected_acceptance_marker(
      '${targetId}', '${expectedSchemaVersion}', '33333333-3333-4333-8333-333333333333', '${fixtureRevision}'
    )
  `);
  await db.exec("reset role");
  if (wrongFixture.rows.length !== 0)
    throw new Error("The marker RPC accepted the wrong fixture identity");

  await db.query(
    "insert into supabase_migrations.schema_migrations (version) values ($1)",
    ["99999999999999"],
  );
  await db.exec("set role service_role");
  const staleSchema = await db.query(`
    select * from public.service_connected_acceptance_marker(
      '${targetId}', '${expectedSchemaVersion}', '${fixtureId}', '${fixtureRevision}'
    )
  `);
  await db.exec("reset role");
  if (staleSchema.rows.length !== 0)
    throw new Error("The marker RPC accepted a marker for a stale migration head");
  process.stdout.write(
    "PASS marker RPC proves exact target, latest migration head, and fixture\n",
  );
} finally {
  await db.close();
}
