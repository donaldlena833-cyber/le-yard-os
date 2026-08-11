import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { promisify } from "node:util";
import { Pool } from "pg";
import { requireLocalPostgresControlUrl } from "./require-local-postgres-control-url.mjs";
import { sha256Bytes } from "./backup-restore-drill-contract.mjs";

const execFileAsync = promisify(execFile);
const RESTORE_DRILL_ADVISORY_LOCK = "72834892384110217";
const RESTORE_ALLOWED_SCHEMAS = [
  "auth",
  "extensions",
  "private",
  "public",
  "storage",
  "supabase_migrations",
];
const RESTORE_ALLOWED_EXTENSIONS = [
  "btree_gist",
  "pg_trgm",
  "pgcrypto",
  "plpgsql",
];

export const RESTORE_DRILL_PLATFORM_BOOTSTRAP = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create schema if not exists storage;
  create schema if not exists supabase_migrations;

  create table auth.users (
    instance_id uuid, id uuid primary key, aud text, role text, email text unique,
    encrypted_password text, email_confirmed_at timestamptz,
    raw_app_meta_data jsonb not null default '{}'::jsonb,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );
  create table auth.identities (
    id uuid primary key, provider_id text not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    identity_data jsonb not null default '{}'::jsonb, provider text not null,
    last_sign_in_at timestamptz, created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(), unique (provider_id, provider)
  );
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(
      nullif(current_setting('request.jwt.claims', true), '')::jsonb,
      '{}'::jsonb
    )
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(nullif(auth.jwt() ->> 'role', ''), current_user::text)
  $$;

  create table storage.buckets (
    id text primary key, name text not null unique,
    public boolean not null default false, file_size_limit bigint,
    allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets(id) on delete cascade,
    name text not null, owner_id text, metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(), unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant usage on schema auth, storage to authenticated;
  grant select on storage.buckets to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;

  create table supabase_migrations.schema_migrations (
    version text primary key
  );
`;

export function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

export function createRestoreDrillDatabaseName(kind) {
  if (!new Set(["reference", "restored", "source"]).has(kind)) {
    throw new Error("Unknown restore drill database kind.");
  }
  return `le_yard_restore_${kind}_${randomUUID().replaceAll("-", "")}`;
}

export function requireRestoreDrillControlUrl(value) {
  const url = requireLocalPostgresControlUrl(
    value,
    "BACKUP_RESTORE_CONTROL_DATABASE_URL",
  );
  if (url.search || url.hash) {
    throw new Error(
      "BACKUP_RESTORE_CONTROL_DATABASE_URL cannot contain query parameters or a fragment.",
    );
  }
  if (decodeURIComponent(url.username) !== "postgres") {
    throw new Error(
      "BACKUP_RESTORE_CONTROL_DATABASE_URL must use the postgres control role.",
    );
  }
  return url;
}

export function postgresCommandEnvironment(controlUrl) {
  const inherited = {};
  for (const name of [
    "DYLD_LIBRARY_PATH",
    "LANG",
    "LC_ALL",
    "LC_CTYPE",
    "LD_LIBRARY_PATH",
    "PATH",
    "SYSTEMROOT",
  ]) {
    if (process.env[name]) inherited[name] = process.env[name];
  }
  return {
    ...inherited,
    PGCONNECT_TIMEOUT: "5",
    PGDATABASE: "postgres",
    PGHOST: controlUrl.hostname,
    PGPASSWORD: decodeURIComponent(controlUrl.password),
    PGPORT: controlUrl.port || "5432",
    PGSSLMODE: "disable",
    PGUSER: decodeURIComponent(controlUrl.username),
  };
}

export async function runPostgresCommand(
  command,
  args,
  controlUrl,
  databaseName,
  options = {},
) {
  try {
    return await execFileAsync(command, args, {
      encoding: "utf8",
      env: {
        ...postgresCommandEnvironment(controlUrl),
        PGDATABASE: databaseName,
      },
      maxBuffer: options.maxBuffer ?? 100 * 1024 * 1024,
    });
  } catch (error) {
    const stderr =
      error && typeof error === "object" && typeof error.stderr === "string"
        ? error.stderr.trim().slice(-4_000)
        : "";
    throw new Error(
      `${command} failed${stderr ? `: ${stderr}` : "."}`,
      { cause: error },
    );
  }
}

export async function assertPostgres17Tools(controlUrl) {
  for (const command of ["pg_dump", "pg_restore"]) {
    const { stdout } = await runPostgresCommand(
      command,
      ["--version"],
      controlUrl,
      "postgres",
    );
    const match = stdout.match(/\(PostgreSQL\)\s+(\d+)(?:\.|\s)/);
    if (Number(match?.[1]) !== 17) {
      throw new Error(`${command} major version 17 is required.`);
    }
  }
}

function isLoopbackAddress(value) {
  const address = typeof value === "string" ? value.replace(/\/\d+$/, "") : value;
  return (
    address === "127.0.0.1" ||
    address === "::1" ||
    /^127\.(?:\d{1,3}\.){2}\d{1,3}$/.test(address)
  );
}

export async function attestControlDatabase(adminPool) {
  const result = (
    await adminPool.query(`
      select
        current_database() as database_name,
        current_user as user_name,
        current_setting('server_version_num')::integer as server_version_num,
        inet_server_addr()::text as server_address,
        pg_is_in_recovery() as in_recovery,
        role.rolsuper as is_superuser,
        role.rolcreatedb as can_create_database,
        (select count(*)::integer from pg_database database
          where database.datname not in ('postgres', 'template0', 'template1'))
          as other_database_count,
        (select count(*)::integer
          from pg_class class
          join pg_namespace namespace on namespace.oid = class.relnamespace
          where namespace.nspname not like 'pg\\_%'
            and namespace.nspname <> 'information_schema') as control_object_count,
        (select count(*)::integer from pg_replication_slots) as replication_slot_count,
        (select count(*)::integer from pg_subscription) as subscription_count,
        (select count(*)::integer from pg_roles candidate
          where candidate.rolname !~ '^pg_'
            and candidate.rolname <> 'postgres') as other_user_role_count,
        (select count(*)::integer from pg_stat_activity activity
          where activity.pid <> pg_backend_pid()
            and activity.backend_type = 'client backend') as other_client_count
      from pg_roles role
      where role.rolname = current_user
    `)
  ).rows[0];
  if (
    result?.database_name !== "postgres" ||
    result?.user_name !== "postgres" ||
    Math.floor(Number(result?.server_version_num) / 10_000) !== 17 ||
    !isLoopbackAddress(result?.server_address) ||
    result?.in_recovery ||
    !result?.is_superuser ||
    !result?.can_create_database ||
    result?.other_database_count !== 0 ||
    result?.control_object_count !== 0 ||
    result?.replication_slot_count !== 0 ||
    result?.subscription_count !== 0 ||
    result?.other_user_role_count !== 0 ||
    result?.other_client_count !== 0
  ) {
    throw new Error(
      "The control target is not an empty, dedicated, writable loopback PostgreSQL 17 cluster.",
    );
  }
  return {
    major: 17,
    otherDatabaseCount: result.other_database_count,
    otherClientCount: result.other_client_count,
    otherUserRoleCount: result.other_user_role_count,
    serverVersionNumber: Number(result.server_version_num),
    serverAddress: result.server_address,
  };
}

export async function acquireRestoreDrillLease(adminPool) {
  const client = await adminPool.connect();
  try {
    const acquired = (
      await client.query(
        "select pg_try_advisory_lock($1::bigint) as acquired",
        [RESTORE_DRILL_ADVISORY_LOCK],
      )
    ).rows[0]?.acquired;
    if (!acquired) {
      throw new Error("Another disposable restore drill already holds the cluster lease.");
    }
    return client;
  } catch (error) {
    client.release();
    throw error;
  }
}

export async function releaseRestoreDrillLease(client) {
  try {
    const released = (
      await client.query(
        "select pg_advisory_unlock($1::bigint) as released",
        [RESTORE_DRILL_ADVISORY_LOCK],
      )
    ).rows[0]?.released;
    if (!released) throw new Error("The disposable restore drill lease was not held.");
  } finally {
    client.release();
  }
}

export async function ensureRestoreDrillRoles(adminClient) {
  const created = [];
  try {
    await adminClient.query("begin");
    for (const role of ["anon", "authenticated", "service_role"]) {
      const exists = (
        await adminClient.query(
          "select exists(select 1 from pg_roles where rolname = $1) value",
          [role],
        )
      ).rows[0].value;
      if (!exists) {
        await adminClient.query(`create role ${quoteIdentifier(role)} nologin`);
        created.push(role);
      }
    }
    await adminClient.query("commit");
  } catch (error) {
    try {
      await adminClient.query("rollback");
    } catch {
      // Preserve the original role-provisioning failure.
    }
    throw error;
  }
  return created;
}

export async function dropRestoreDrillRoles(adminClient, roles) {
  try {
    await adminClient.query("begin");
    for (const role of [...roles].reverse()) {
      await adminClient.query(`drop role if exists ${quoteIdentifier(role)}`);
    }
    await adminClient.query("commit");
  } catch (error) {
    try {
      await adminClient.query("rollback");
    } catch {
      // Preserve the original role-cleanup failure.
    }
    throw error;
  }
}

export async function createDisposableDatabase(adminClient, databaseName) {
  if (!/^le_yard_restore_(?:reference|restored|source)_[0-9a-f]{32}$/.test(databaseName)) {
    throw new Error("Refusing to create a non-disposable restore drill database.");
  }
  await adminClient.query(
    `create database ${quoteIdentifier(databaseName)} template template0`,
  );
}

export async function dropDisposableDatabase(adminClient, databaseName) {
  if (!/^le_yard_restore_(?:reference|restored|source)_[0-9a-f]{32}$/.test(databaseName)) {
    throw new Error("Refusing to drop a non-disposable restore drill database.");
  }
  await adminClient.query(
    `drop database if exists ${quoteIdentifier(databaseName)} with (force)`,
  );
}

export async function attestFreshDisposableDatabase(pool) {
  const result = (
    await pool.query(`
      select
        (select count(*)::integer
          from pg_class class
          join pg_namespace namespace on namespace.oid = class.relnamespace
          where namespace.nspname not like 'pg\\_%'
            and namespace.nspname <> 'information_schema') as user_object_count,
        (select count(*)::integer from pg_event_trigger) as event_trigger_count,
        (select array_agg(extname order by extname) from pg_extension)
          as extensions,
        (select array_agg(nspname order by nspname)
          from pg_namespace
          where nspname not like 'pg\\_%'
            and nspname <> 'information_schema') as schemas
    `)
  ).rows[0];
  if (
    result?.user_object_count !== 0 ||
    result?.event_trigger_count !== 0 ||
    JSON.stringify(result?.extensions) !== JSON.stringify(["plpgsql"]) ||
    JSON.stringify(result?.schemas) !== JSON.stringify(["public"])
  ) {
    throw new Error("Disposable database inherited unapproved template state.");
  }
}

export function databaseUrl(controlUrl, databaseName) {
  const url = new URL(controlUrl);
  url.pathname = `/${databaseName}`;
  return url;
}

export async function applyReferenceDatabase(pool, migrationContract, root, seed) {
  const client = await pool.connect();
  try {
    await client.query(RESTORE_DRILL_PLATFORM_BOOTSTRAP);
    for (const [index, file] of migrationContract.files.entries()) {
      try {
        const migrationSql = await readFile(
          `${migrationContract.directory}/${file}`,
          "utf8",
        );
        if (sha256Bytes(migrationSql) !== migrationContract.fileSha256[index]) {
          throw new Error("Migration changed after its bundle was fingerprinted.");
        }
        await client.query(migrationSql);
        await client.query(
          "insert into supabase_migrations.schema_migrations (version) values ($1)",
          [migrationContract.versions[index]],
        );
      } catch (error) {
        throw new Error(`Restore reference migration failed in ${file}.`, {
          cause: error,
        });
      }
    }
    if (seed) {
      await client.query(await readFile(`${root}/supabase/seed.sql`, "utf8"));
    }
  } finally {
    client.release();
  }
}

export async function inspectArchive(controlUrl, artifactPath) {
  const { stdout } = await runPostgresCommand(
    "pg_restore",
    ["--list", artifactPath],
    controlUrl,
    "postgres",
  );
  const forbidden = [
    /\sBLOB\s/i,
    /\sDATABASE\s/i,
    /\bEVENT TRIGGER\b/i,
    /\bFOREIGN DATA WRAPPER\b/i,
    /\bMATERIALIZED VIEW DATA\b/i,
    /\bPROCEDURAL LANGUAGE\b/i,
    /\bPUBLICATION\b/i,
    /\bSERVER\b/i,
    /\bSUBSCRIPTION\b/i,
    /\bUSER MAPPING\b/i,
  ];
  const archiveEntries = stdout
    .split("\n")
    .filter((line) => /^\d+;/.test(line));
  const rejected = archiveEntries
    .filter((line) => forbidden.some((pattern) => pattern.test(line)));
  if (rejected.length) {
    throw new Error(
      `Backup archive contains forbidden database objects: ${rejected.slice(0, 5).join(" | ")}`,
    );
  }
  const archivedSchemas = [...stdout.matchAll(
    /^\d+;\s+\d+\s+\d+\s+SCHEMA\s+-\s+(\S+)/gm,
  )].map((match) => match[1]).sort();
  const archivedExtensions = [...stdout.matchAll(
    /^\d+;\s+\d+\s+\d+\s+EXTENSION\s+-\s+(\S+)/gm,
  )].map((match) => match[1]).sort();
  const approvedArchivedSchemas = RESTORE_ALLOWED_SCHEMAS.filter(
    (schema) => schema !== "public",
  );
  const approvedArchivedExtensions = RESTORE_ALLOWED_EXTENSIONS.filter(
    (extension) => extension !== "plpgsql",
  );
  if (
    JSON.stringify(archivedSchemas) !== JSON.stringify(approvedArchivedSchemas) ||
    JSON.stringify(archivedExtensions) !==
      JSON.stringify(approvedArchivedExtensions)
  ) {
    throw new Error(
      "Backup archive schema or extension catalog is not approved for the synthetic drill.",
    );
  }
  return {
    extensions: archivedExtensions,
    entryCount: archiveEntries.length,
    listSha256: sha256Bytes(stdout),
    schemas: archivedSchemas,
  };
}

export async function restoreArchive(
  controlUrl,
  databaseName,
  artifactPath,
) {
  await runPostgresCommand(
    "pg_restore",
    [
      "--exit-on-error",
      "--no-owner",
      "--dbname",
      databaseName,
      artifactPath,
    ],
    controlUrl,
    databaseName,
  );
}

export async function dumpCustomArchive(
  controlUrl,
  databaseName,
  artifactPath,
) {
  await runPostgresCommand(
    "pg_dump",
    [
      "--format=custom",
      "--no-owner",
      "--file",
      artifactPath,
      "--dbname",
      databaseName,
    ],
    controlUrl,
    databaseName,
  );
}

export async function collectSchemaFingerprint(
  controlUrl,
  databaseName,
) {
  const args = ["--schema-only", "--no-owner", "--dbname", databaseName];
  for (const schema of RESTORE_ALLOWED_SCHEMAS) {
    args.push("--schema", schema);
  }
  const { stdout } = await runPostgresCommand(
    "pg_dump",
    args,
    controlUrl,
    databaseName,
  );
  const normalized = stdout.replace(
    /^\\(un)?restrict [^\n]+$/gm,
    (_line, unprefix) => `\\${unprefix ?? ""}restrict <nonce>`,
  );
  return {
    bytes: Buffer.byteLength(normalized),
    sha256: sha256Bytes(normalized),
  };
}

export async function collectDatabaseContract(pool, expectedVersions) {
  const schemaRows = (
    await pool.query(`
      select nspname
      from pg_namespace
      where nspname not like 'pg\\_%'
        and nspname <> 'information_schema'
      order by nspname
    `)
  ).rows.map((row) => row.nspname);
  if (JSON.stringify(schemaRows) !== JSON.stringify(RESTORE_ALLOWED_SCHEMAS)) {
    throw new Error(
      `Restored database has an unapproved schema catalog: ${JSON.stringify(schemaRows)}.`,
    );
  }

  const extensionRows = (
    await pool.query("select extname from pg_extension order by extname")
  ).rows.map((row) => row.extname);
  if (JSON.stringify(extensionRows) !== JSON.stringify(RESTORE_ALLOWED_EXTENSIONS)) {
    throw new Error(
      `Restored database has an unapproved extension catalog: ${JSON.stringify(extensionRows)}.`,
    );
  }

  const migrationVersions = (
    await pool.query(
      "select version::text from supabase_migrations.schema_migrations order by version",
    )
  ).rows.map((row) => row.version);
  if (JSON.stringify(migrationVersions) !== JSON.stringify(expectedVersions)) {
    throw new Error("Restored migration history does not exactly match the repository.");
  }

  const rlsRows = (
    await pool.query(`
      select
        class.relname as table_name,
        class.relrowsecurity as rls_enabled,
        class.relforcerowsecurity as rls_forced,
        (select count(*)::integer from pg_policy policy where policy.polrelid = class.oid)
          as policy_count
      from pg_class class
      where class.relnamespace = 'public'::regnamespace
        and class.relkind in ('r', 'p')
      order by class.relname
    `)
  ).rows;
  const unsafeRls = rlsRows.filter(
    (row) => !row.rls_enabled || !row.rls_forced,
  );
  if (unsafeRls.length) {
    throw new Error(
      `Restored public tables lack forced RLS: ${JSON.stringify(unsafeRls)}.`,
    );
  }

  const anonymousTableGrants = Number(
    (
      await pool.query(`
        select count(*)::integer as count
        from information_schema.role_table_grants
        where grantee = 'anon' and table_schema = 'public'
      `)
    ).rows[0].count,
  );
  if (anonymousTableGrants !== 0) {
    throw new Error("Restored public tables grant privileges to anon.");
  }

  const functionRows = (
    await pool.query(`
      select
        namespace.nspname as schema_name,
        procedure.oid::regprocedure::text as signature,
        procedure.prosecdef as security_definer,
        coalesce(procedure.proconfig, '{}'::text[]) as configuration,
        exists (
          select 1
          from aclexplode(coalesce(
            procedure.proacl,
            acldefault('f', procedure.proowner)
          )) privilege
          where privilege.grantee = 0 and privilege.privilege_type = 'EXECUTE'
        ) as public_execute,
        has_function_privilege('anon', procedure.oid, 'EXECUTE') as anon_execute,
        has_function_privilege('authenticated', procedure.oid, 'EXECUTE')
          as authenticated_execute,
        has_function_privilege('service_role', procedure.oid, 'EXECUTE')
          as service_execute,
        exists (
          select 1 from pg_trigger trigger
          where trigger.tgfoid = procedure.oid and not trigger.tgisinternal
        ) as trigger_function
      from pg_proc procedure
      join pg_namespace namespace on namespace.oid = procedure.pronamespace
      where namespace.nspname in ('private', 'public')
      order by namespace.nspname, procedure.oid::regprocedure::text
    `)
  ).rows;
  const unsafeFunctions = functionRows.filter((entry) => {
    const safeSearchPath = entry.configuration.some(
      (setting) => setting === "search_path=" || setting === 'search_path=""',
    );
    return (
      entry.public_execute ||
      entry.anon_execute ||
      (entry.security_definer && !safeSearchPath) ||
      (entry.trigger_function && entry.authenticated_execute)
    );
  });
  if (unsafeFunctions.length) {
    throw new Error(
      `Restored function execution boundary is unsafe: ${JSON.stringify(unsafeFunctions)}.`,
    );
  }

  return {
    extensions: extensionRows,
    functions: {
      count: functionRows.length,
      fingerprintSha256: sha256Bytes(JSON.stringify(functionRows)),
      rows: functionRows,
    },
    migrations: migrationVersions,
    rls: {
      anonymousTableGrantCount: anonymousTableGrants,
      fingerprintSha256: sha256Bytes(JSON.stringify(rlsRows)),
      tableCount: rlsRows.length,
      rows: rlsRows,
    },
    schemas: schemaRows,
  };
}

export async function collectSyntheticInvariants(pool) {
  const result = (
    await pool.query(`
      select
        (select array_agg(id::text order by id) from public.organizations)
          as organization_ids,
        (select array_agg(id::text order by id) from public.locations)
          as location_ids,
        (select count(*)::integer from auth.users) as auth_user_count,
        (select count(*)::integer from auth.users
          where email is null or email !~ '^[^@]+@([A-Za-z0-9-]+\\.)*example\\.invalid$')
          as non_synthetic_auth_email_count,
        (select count(*)::integer from public.employees
          where email is not null and email !~ '^[^@]+@([A-Za-z0-9-]+\\.)*example\\.invalid$')
          as non_synthetic_employee_email_count,
        (select count(*)::integer from public.guests
          where email is not null and email !~ '^[^@]+@([A-Za-z0-9-]+\\.)*example\\.invalid$')
          as non_synthetic_guest_email_count,
        (select count(*)::integer from public.organization_memberships)
          as organization_membership_count,
        (select count(*)::integer from public.integration_connections)
          as integration_connection_count,
        (select count(*)::integer from private.integration_credentials)
          as integration_credential_count,
        (select count(*)::integer from public.integration_sync_jobs)
          as integration_job_count,
        (select count(*)::integer from public.reservation_settings
          where online_booking_enabled or guest_messaging_enabled or staff_push_enabled)
          as enabled_reservation_setting_count,
        (select count(*)::integer from public.reservation_message_outbox)
          as reservation_message_count,
        (select count(*)::integer from public.reservation_push_deliveries)
          as reservation_push_count,
        (select count(*)::integer from private.connected_acceptance_targets)
          as acceptance_marker_count
    `)
  ).rows[0];
  const expectedOrganizationIds = [
    "20000000-0000-4000-8000-000000000001",
    "20000000-0000-4000-8000-000000000002",
  ];
  const expectedLocationIds = [
    "30000000-0000-4000-8000-000000000001",
    "30000000-0000-4000-8000-000000000002",
    "30000000-0000-4000-8000-000000000003",
  ];
  if (
    JSON.stringify(result.organization_ids) !== JSON.stringify(expectedOrganizationIds) ||
    JSON.stringify(result.location_ids) !== JSON.stringify(expectedLocationIds) ||
    result.auth_user_count !== 6 ||
    result.organization_membership_count !== 6 ||
    result.non_synthetic_auth_email_count !== 0 ||
    result.non_synthetic_employee_email_count !== 0 ||
    result.non_synthetic_guest_email_count !== 0 ||
    result.integration_connection_count !== 0 ||
    result.integration_credential_count !== 0 ||
    result.integration_job_count !== 0 ||
    result.enabled_reservation_setting_count !== 0 ||
    result.reservation_message_count !== 0 ||
    result.reservation_push_count !== 0 ||
    result.acceptance_marker_count !== 0
  ) {
    throw new Error(
      `Restored data is not the exact provider-disabled synthetic fixture: ${JSON.stringify(result)}.`,
    );
  }
  return result;
}

export function createAdminPool(controlUrl, applicationName) {
  return new Pool({
    application_name: applicationName,
    connectionTimeoutMillis: 5_000,
    connectionString: controlUrl.toString(),
    max: 2,
    ssl: false,
  });
}

export function createDatabasePool(controlUrl, databaseName, applicationName) {
  return new Pool({
    application_name: applicationName,
    connectionTimeoutMillis: 5_000,
    connectionString: databaseUrl(controlUrl, databaseName).toString(),
    max: 2,
    ssl: false,
  });
}
