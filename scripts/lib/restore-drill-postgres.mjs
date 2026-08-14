import { randomUUID } from "node:crypto";
import { execFile } from "node:child_process";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, join, resolve } from "node:path";
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
  for (const command of ["pg_controldata", "pg_dump", "pg_restore"]) {
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

export async function attestLocalPostgresDataDirectory(
  adminClient,
  controlUrl,
  pathValue,
) {
  if (typeof pathValue !== "string" || !isAbsolute(pathValue)) {
    throw new Error("BACKUP_RESTORE_PGDATA must be an absolute local PGDATA path.");
  }
  const requestedPath = resolve(pathValue);
  const directoryStat = await lstat(requestedPath);
  if (
    directoryStat.isSymbolicLink() ||
    !directoryStat.isDirectory() ||
    (directoryStat.mode & 0o022) !== 0 ||
    (typeof process.getuid === "function" && directoryStat.uid !== process.getuid())
  ) {
    throw new Error("BACKUP_RESTORE_PGDATA must be a process-owned, non-shared real directory.");
  }
  const canonicalPath = await realpath(requestedPath);
  const versionPath = join(canonicalPath, "PG_VERSION");
  const pidPath = join(canonicalPath, "postmaster.pid");
  const controlPath = join(canonicalPath, "global", "pg_control");
  for (const [path, label] of [
    [versionPath, "PG_VERSION"],
    [pidPath, "postmaster.pid"],
    [controlPath, "pg_control"],
  ]) {
    const stat = await lstat(path);
    if (stat.isSymbolicLink() || !stat.isFile()) {
      throw new Error(`Local PostgreSQL ${label} must be a regular file.`);
    }
  }
  if ((await readFile(versionPath, "utf8")).trim() !== "17") {
    throw new Error("BACKUP_RESTORE_PGDATA is not a PostgreSQL 17 data directory.");
  }
  const postmasterLines = (await readFile(pidPath, "utf8")).split("\n");
  const postmasterPid = Number(postmasterLines[0]);
  const postmasterStartedAt = Number(postmasterLines[2]);
  const postmasterPort = Number(postmasterLines[3]);
  const listenAddresses = (postmasterLines[5] ?? "")
    .split(",")
    .map((address) => address.trim())
    .filter(Boolean);
  if (
    !Number.isSafeInteger(postmasterPid) ||
    postmasterPid <= 1 ||
    !Number.isSafeInteger(postmasterStartedAt) ||
    postmasterPort !== Number(controlUrl.port || "5432") ||
    !listenAddresses.length ||
    listenAddresses.some((address) => !isLoopbackAddress(address)) ||
    (await realpath(postmasterLines[1])) !== canonicalPath
  ) {
    throw new Error("Local PostgreSQL postmaster metadata does not match the control URL.");
  }
  try {
    process.kill(postmasterPid, 0);
  } catch (error) {
    throw new Error("The attested PostgreSQL postmaster is not a local live process.", {
      cause: error,
    });
  }
  const { stdout: controlOutput } = await execFileAsync(
    "pg_controldata",
    [canonicalPath],
    {
      encoding: "utf8",
      env: { ...postgresCommandEnvironment(controlUrl), LC_ALL: "C" },
      maxBuffer: 1024 * 1024,
    },
  );
  const localSystemIdentifier = controlOutput.match(
    /^Database system identifier:\s+(\d+)$/m,
  )?.[1];
  const serverControl = (
    await adminClient.query(`
      select
        system_identifier::text,
        floor(extract(epoch from pg_postmaster_start_time()))::bigint::text
          as postmaster_started_at
      from pg_control_system()
    `)
  ).rows[0];
  if (
    !localSystemIdentifier ||
    serverControl?.system_identifier !== localSystemIdentifier ||
    Number(serverControl?.postmaster_started_at) !== postmasterStartedAt
  ) {
    throw new Error("Local PGDATA control state does not match the connected postmaster.");
  }
  return {
    localPostmasterProcess: true,
    pgdataPathSha256: sha256Bytes(canonicalPath),
    port: postmasterPort,
    systemIdentifierSha256: sha256Bytes(localSystemIdentifier),
  };
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
        (select array_agg(extname::text order by extname) from pg_extension)
          as extensions,
        (select array_agg(nspname::text order by nspname)
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

export async function attestTemplateOne(controlUrl) {
  const pool = createDatabasePool(
    controlUrl,
    "template1",
    "le-yard-backup-restore-template1-attestation",
  );
  try {
    await attestFreshDisposableDatabase(pool);
  } finally {
    await pool.end();
  }
}

export function databaseUrl(controlUrl, databaseName) {
  const url = new URL(controlUrl);
  url.pathname = `/${databaseName}`;
  return url;
}

export async function applyReferenceDatabase(
  pool,
  migrationContract,
  root,
  seedContract,
) {
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
    if (seedContract) {
      const seedSql = await readFile(`${root}/supabase/seed.sql`, "utf8");
      if (sha256Bytes(seedSql) !== seedContract.sha256) {
        throw new Error("Synthetic seed changed after it was fingerprinted.");
      }
      await client.query(seedSql);
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

  const relationAccessRows = (
    await pool.query(`
      select
        class.relname as relation_name,
        class.relkind as relation_kind,
        has_table_privilege('anon', class.oid, 'SELECT') as anon_select,
        has_table_privilege('anon', class.oid, 'INSERT') as anon_insert,
        has_table_privilege('anon', class.oid, 'UPDATE') as anon_update,
        has_table_privilege('anon', class.oid, 'DELETE') as anon_delete,
        has_table_privilege('anon', class.oid, 'TRUNCATE') as anon_truncate,
        has_table_privilege('anon', class.oid, 'REFERENCES') as anon_references,
        has_table_privilege('anon', class.oid, 'TRIGGER') as anon_trigger,
        case
          when class.relkind = 'v'
            then coalesce('security_invoker=true' = any(class.reloptions), false)
          else null
        end as security_invoker
      from pg_class class
      where class.relnamespace = 'public'::regnamespace
        and class.relkind in ('r', 'p', 'v', 'm', 'f')
      order by class.relname
    `)
  ).rows;
  const unsafeRelationAccess = relationAccessRows.filter((row) =>
    row.anon_select ||
    row.anon_insert ||
    row.anon_update ||
    row.anon_delete ||
    row.anon_truncate ||
    row.anon_references ||
    row.anon_trigger ||
    row.relation_kind === "m" ||
    (row.relation_kind === "v" && !row.security_invoker)
  );
  if (unsafeRelationAccess.length) {
    throw new Error(
      `Restored public relations expose unsafe anonymous or view privileges: ${JSON.stringify(unsafeRelationAccess)}.`,
    );
  }

  const sequenceAccessRows = (
    await pool.query(`
      select
        class.relname as sequence_name,
        has_sequence_privilege('anon', class.oid, 'USAGE') as anon_usage,
        has_sequence_privilege('anon', class.oid, 'SELECT') as anon_select,
        has_sequence_privilege('anon', class.oid, 'UPDATE') as anon_update
      from pg_class class
      where class.relnamespace = 'public'::regnamespace
        and class.relkind = 'S'
      order by class.relname
    `)
  ).rows;
  const unsafeSequenceAccess = sequenceAccessRows.filter(
    (row) => row.anon_usage || row.anon_select || row.anon_update,
  );
  if (unsafeSequenceAccess.length) {
    throw new Error(
      `Restored public sequences expose unsafe anonymous privileges: ${JSON.stringify(unsafeSequenceAccess)}.`,
    );
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
      anonymousRelationPrivilegeCount: unsafeRelationAccess.length,
      anonymousSequencePrivilegeCount: unsafeSequenceAccess.length,
      fingerprintSha256: sha256Bytes(JSON.stringify({
        relationAccessRows,
        rlsRows,
        sequenceAccessRows,
      })),
      relationAccessRows,
      sequenceAccessRows,
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
        (select count(*)::integer from auth.identities) as auth_identity_count,
        (select count(*)::integer from auth.users
          where encrypted_password is null
            or encrypted_password is distinct from
              extensions.crypt('DemoOnly-change-me!', encrypted_password))
          as invalid_demo_password_hash_count,
        (select count(*)::integer from auth.users
          where email is null or email !~ '^[^@]+@([A-Za-z0-9-]+\\.)*example\\.invalid$')
          as non_synthetic_auth_email_count,
        (select count(*)::integer from public.employees
          where email is not null and email !~ '^[^@]+@([A-Za-z0-9-]+\\.)*example\\.invalid$')
          as non_synthetic_employee_email_count,
        (select count(*)::integer from public.guests
          where email is not null and email !~ '^[^@]+@([A-Za-z0-9-]+\\.)*example\\.invalid$')
          as non_synthetic_guest_email_count,
        (select count(*)::integer from public.guests) as guest_count,
        (select count(*)::integer from public.guests where phone is not null)
          as guest_phone_count,
        (select count(*)::integer from public.guest_contacts) as guest_contact_count,
        (select count(*)::integer from private.public_booking_holds)
          as public_booking_hold_count,
        (select count(*)::integer from public.waitlist_entries) as waitlist_entry_count,
        (select count(*)::integer from public.tasks
          where id = '81000000-0000-4000-8000-000000000001'
            and due_at - created_at <> interval '1 day')
          as invalid_demo_task_due_offset_count,
        (select count(*)::integer from public.notifications notification
          where notification.evidence_key like 'shift.assigned:%'
            and not exists (
              select 1 from public.shifts shift_row
              where notification.evidence_key = format(
                'shift.assigned:%s:%s:%s',
                shift_row.id,
                shift_row.employee_id,
                extract(epoch from shift_row.updated_at)::bigint
              )
            )) as invalid_shift_notification_evidence_count,
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
    result.auth_identity_count !== 6 ||
    result.invalid_demo_password_hash_count !== 0 ||
    result.guest_count !== 1 ||
    result.guest_phone_count !== 0 ||
    result.guest_contact_count !== 0 ||
    result.public_booking_hold_count !== 0 ||
    result.waitlist_entry_count !== 0 ||
    result.invalid_demo_task_due_offset_count !== 0 ||
    result.invalid_shift_notification_evidence_count !== 0 ||
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

const SYNTHETIC_TIME_NORMALIZATIONS = new Map([
  ["auth.identities", ["created_at", "last_sign_in_at", "updated_at"]],
  ["auth.users", ["created_at", "email_confirmed_at", "updated_at"]],
  ["private.organization_owner_counts", ["updated_at"]],
  ["public.audit_events", ["occurred_at"]],
  ["public.capability_definitions", ["created_at", "updated_at"]],
  ["public.chat_channels", ["created_at", "updated_at"]],
  ["public.chat_messages", ["created_at", "updated_at"]],
  ["public.employee_job_roles", ["created_at"]],
  ["public.employees", ["created_at", "updated_at"]],
  ["public.guests", ["created_at", "updated_at"]],
  ["public.inventory_categories", ["created_at", "updated_at"]],
  ["public.inventory_items", ["created_at", "updated_at"]],
  ["public.inventory_par_levels", ["created_at", "updated_at"]],
  ["public.job_roles", ["created_at", "updated_at"]],
  ["public.location_memberships", ["created_at"]],
  ["public.locations", ["created_at", "updated_at"]],
  ["public.measurement_units", ["created_at", "updated_at"]],
  ["public.notifications", ["created_at"]],
  [
    "public.organization_memberships",
    ["created_at", "invited_at", "joined_at", "updated_at"],
  ],
  ["public.organization_settings", ["updated_at"]],
  ["public.organizations", ["created_at", "updated_at"]],
  ["public.profiles", ["created_at", "updated_at"]],
  ["public.schedules", ["created_at", "published_at", "updated_at"]],
  ["public.shifts", ["created_at", "updated_at"]],
  ["public.tasks", ["created_at", "due_at", "updated_at"]],
  ["public.tip_pool_policies", ["created_at", "updated_at"]],
  ["public.vendors", ["created_at", "updated_at"]],
]);

function timestampToEpochMicroseconds(value) {
  if (typeof value !== "string") return null;
  const match = value.match(
    /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2}:\d{2})(?:\.(\d{1,6}))?(Z|[+-]\d{2}:\d{2})$/,
  );
  if (!match) return null;
  const epochMilliseconds = Date.parse(`${match[1]}T${match[2]}${match[4]}`);
  if (!Number.isFinite(epochMilliseconds)) return null;
  const fractionalMicroseconds = BigInt((match[3] ?? "").padEnd(6, "0"));
  return BigInt(epochMilliseconds) * 1_000n + fractionalMicroseconds;
}

function replaceSeedTimeFields(qualifiedName, row, anchors) {
  const anchor =
    qualifiedName === "public.capability_definitions" ||
    qualifiedName === "public.audit_events" ||
    qualifiedName === "public.notifications" ||
    qualifiedName === "private.organization_owner_counts"
        ? null
        : anchors.seed;
  for (const column of SYNTHETIC_TIME_NORMALIZATIONS.get(qualifiedName) ?? []) {
    if (row[column] !== null && row[column] !== undefined) {
      const timestamp = timestampToEpochMicroseconds(row[column]);
      const anchorTimestamp = timestampToEpochMicroseconds(anchor);
      row[column] =
        timestamp !== null && anchorTimestamp !== null
          ? `<synthetic-time-offset:${column}:${timestamp - anchorTimestamp}us>`
          : `<synthetic-volatile-time:${column}>`;
    }
  }
}

function canonicalNotificationEvidenceKey(value) {
  if (typeof value !== "string") return value;
  return value.replace(
    /^(shift\.assigned:[^:]+:[^:]+):\d+$/,
    "$1:<synthetic-seed-epoch>",
  );
}

function buildCanonicalIdMap(rows, stableRow) {
  const ordered = rows
    .map((row) => ({ id: row.id, stable: JSON.stringify(stableRow(row)) }))
    .sort((left, right) => left.stable.localeCompare(right.stable));
  if (ordered.some((entry, index) => index > 0 && entry.stable === ordered[index - 1].stable)) {
    throw new Error("Synthetic generated identifiers lack unique stable row evidence.");
  }
  return new Map(
    ordered.map((entry, index) => [entry.id, `<synthetic-generated-id:${index + 1}>`]),
  );
}

function normalizeSyntheticRow(qualifiedName, source, idMaps, anchors) {
  const row = structuredClone(source);
  replaceSeedTimeFields(qualifiedName, row, anchors);
  if (qualifiedName === "auth.users" && row.encrypted_password !== null) {
    row.encrypted_password =
      typeof row.encrypted_password === "string" &&
      /^\$2[aby]\$\d{2}\$/.test(row.encrypted_password)
        ? "<synthetic-demo-bcrypt>"
        : row.encrypted_password;
  }
  if (qualifiedName === "auth.identities" && idMaps.identities.has(row.id)) {
    row.id = idMaps.identities.get(row.id);
  }
  if (qualifiedName === "public.notifications") {
    if (idMaps.notifications.has(row.id)) {
      row.id = idMaps.notifications.get(row.id);
    }
    row.evidence_key = canonicalNotificationEvidenceKey(row.evidence_key);
  }
  if (qualifiedName === "public.audit_events") {
    const auditedRelation = `public.${row.table_name}`;
    for (const field of ["old_record", "new_record"]) {
      if (row[field] && typeof row[field] === "object" && !Array.isArray(row[field])) {
        row[field] = normalizeSyntheticRow(
          auditedRelation,
          row[field],
          idMaps,
          anchors,
        );
      }
    }
    if (row.table_name === "notifications" && idMaps.notifications.has(row.record_id)) {
      row.record_id = idMaps.notifications.get(row.record_id);
    }
  }
  return row;
}

export async function collectSyntheticDataFingerprint(pool) {
  const invalidPasswordCount = Number(
    (
      await pool.query(`
        select count(*)::integer as count
        from auth.users
        where encrypted_password is null
          or encrypted_password is distinct from
            extensions.crypt('DemoOnly-change-me!', encrypted_password)
      `)
    ).rows[0].count,
  );
  if (invalidPasswordCount !== 0) {
    throw new Error("Synthetic Auth users do not use the approved demo password hash.");
  }
  const tables = (
    await pool.query(`
      select namespace.nspname as schema_name, class.relname as table_name
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname in (
        'auth', 'private', 'public', 'storage', 'supabase_migrations'
      )
        and class.relkind in ('r', 'p')
        and not class.relispartition
      order by namespace.nspname, class.relname
    `)
  ).rows;
  const tableData = [];
  let totalRowCount = 0;

  for (const table of tables) {
    const qualifiedName = `${table.schema_name}.${table.table_name}`;
    const relation = `${quoteIdentifier(table.schema_name)}.${quoteIdentifier(table.table_name)}`;
    const count = Number(
      (await pool.query(`select count(*)::integer as count from ${relation}`)).rows[0]
        .count,
    );
    if (!Number.isSafeInteger(count) || count < 0 || count > 10_000) {
      throw new Error(`Synthetic data table ${qualifiedName} exceeds the safe row limit.`);
    }
    totalRowCount += count;
    if (totalRowCount > 25_000) {
      throw new Error("Synthetic data exceeds the safe total row limit.");
    }
    const rawRows = (
      await pool.query(`select to_jsonb(source_row) as row_data from ${relation} source_row`)
    ).rows.map((row) => row.row_data);
    tableData.push({
      name: qualifiedName,
      rawRows,
      rowCount: count,
    });
  }

  const identityRows = tableData.find((table) => table.name === "auth.identities")?.rawRows ?? [];
  const notificationRows = tableData.find((table) => table.name === "public.notifications")?.rawRows ?? [];
  const anchors = {
    seed:
      tableData
        .find((table) => table.name === "public.organizations")
        ?.rawRows.find(
          (row) => row.id === "20000000-0000-4000-8000-000000000001",
        )?.created_at ?? null,
  };
  if (!anchors.seed) {
    throw new Error("Synthetic timestamp anchors are missing.");
  }
  const idMaps = {
    identities: buildCanonicalIdMap(identityRows, (source) => {
      const row = structuredClone(source);
      delete row.id;
      replaceSeedTimeFields("auth.identities", row, anchors);
      return row;
    }),
    notifications: buildCanonicalIdMap(notificationRows, (source) => {
      const row = structuredClone(source);
      delete row.id;
      replaceSeedTimeFields("public.notifications", row, anchors);
      row.evidence_key = canonicalNotificationEvidenceKey(row.evidence_key);
      return row;
    }),
  };
  const tableFingerprints = tableData.map((table) => {
    const rowStrings = table.rawRows
      .map((row) =>
        JSON.stringify(normalizeSyntheticRow(table.name, row, idMaps, anchors)),
      )
      .sort();
    return {
      name: table.name,
      normalizedFields: [
        ...(SYNTHETIC_TIME_NORMALIZATIONS.get(table.name) ?? []),
        ...(table.name === "auth.users" ? ["encrypted_password:bcrypt"] : []),
        ...(table.name === "auth.identities" ? ["id:stable-map"] : []),
        ...(table.name === "public.notifications"
          ? ["id:stable-map", "evidence_key:seed-epoch"]
          : []),
        ...(table.name === "public.audit_events"
          ? ["nested-records:relation-normalization", "notification-record-id:stable-map"]
          : []),
      ].sort(),
      rowCount: table.rowCount,
      sha256: sha256Bytes(JSON.stringify(rowStrings)),
    };
  });

  const sequenceFingerprints = [];
  const sequences = (
    await pool.query(`
      select namespace.nspname as schema_name, class.relname as sequence_name
      from pg_class class
      join pg_namespace namespace on namespace.oid = class.relnamespace
      where namespace.nspname in (
        'auth', 'private', 'public', 'storage', 'supabase_migrations'
      )
        and class.relkind = 'S'
      order by namespace.nspname, class.relname
    `)
  ).rows;
  for (const sequence of sequences) {
    const qualifiedName = `${sequence.schema_name}.${sequence.sequence_name}`;
    const relation = `${quoteIdentifier(sequence.schema_name)}.${quoteIdentifier(sequence.sequence_name)}`;
    const state = (await pool.query(
      `select last_value::text as last_value, is_called from ${relation}`,
    )).rows[0];
    sequenceFingerprints.push({ name: qualifiedName, ...state });
  }

  const catalog = { sequences: sequenceFingerprints, tables: tableFingerprints };
  return {
    catalog,
    sha256: sha256Bytes(JSON.stringify(catalog)),
    tableCount: tableFingerprints.length,
    totalRowCount,
  };
}

export function createAdminPool(controlUrl, applicationName) {
  return new Pool({
    application_name: applicationName,
    connectionTimeoutMillis: 5_000,
    connectionString: controlUrl.toString(),
    max: 1,
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
