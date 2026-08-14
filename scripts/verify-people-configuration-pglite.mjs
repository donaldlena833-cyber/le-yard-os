import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const root = process.cwd();
const migrationsDirectory = join(root, "supabase", "migrations");
const targetMigration = "202608010019_people_configuration_security.sql";
const migrationFiles = (await readdir(migrationsDirectory))
  .filter(
    (file) =>
      file.endsWith(".sql") && file.localeCompare(targetMigration) <= 0,
  )
  .sort();
const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });

function assert(condition, message, evidence) {
  if (!condition) {
    throw new Error(`${message}${evidence === undefined ? "" : `: ${JSON.stringify(evidence)}`}`);
  }
}

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
  grant usage on schema auth, storage to authenticated, service_role;
  grant select on storage.buckets to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`;

try {
  await db.exec(bootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }
  assert(
    migrationFiles.at(-1) === targetMigration,
    "Focused migration set did not stop at 019",
    migrationFiles.at(-1),
  );
  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));
  process.stdout.write("PASS migrations 001-019 and synthetic seed\n");

  // One employee spans Downtown and Uptown. Management remains Downtown-only.
  await db.exec(`
    insert into public.employee_job_roles (
      id, organization_id, employee_id, job_role_id, location_id,
      effective_from, is_primary
    ) values (
      'f8000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005',
      '40000000-0000-4000-8000-000000000002',
      '30000000-0000-4000-8000-000000000002',
      date '2026-01-01', false
    );
    insert into public.availability_rules (
      id, organization_id, employee_id, location_id, weekday,
      available_from, available_until, is_available, effective_from
    ) values
      (
        'f9000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000005',
        '30000000-0000-4000-8000-000000000001', 1,
        time '09:00', time '17:00', true, date '2026-08-01'
      ),
      (
        'f9000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000005',
        '30000000-0000-4000-8000-000000000002', 2,
        time '10:00', time '18:00', true, date '2026-08-01'
      );
    insert into public.time_off_requests (
      id, organization_id, employee_id, location_id, starts_at, ends_at, reason
    ) values
      (
        'f9100000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000005',
        '30000000-0000-4000-8000-000000000001',
        timestamptz '2026-09-01 09:00:00-04',
        timestamptz '2026-09-01 17:00:00-04', 'Downtown request'
      ),
      (
        'f9100000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        '50000000-0000-4000-8000-000000000005',
        '30000000-0000-4000-8000-000000000002',
        timestamptz '2026-09-02 09:00:00-04',
        timestamptz '2026-09-02 17:00:00-04', 'Uptown request'
      );

    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  const managerReads = (await db.query(`
    select
      (select count(*)::integer from public.availability_rules
       where employee_id = '50000000-0000-4000-8000-000000000005') as availability_count,
      (select min(location_id::text) from public.availability_rules
       where employee_id = '50000000-0000-4000-8000-000000000005') as availability_location,
      (select count(*)::integer from public.time_off_requests
       where employee_id = '50000000-0000-4000-8000-000000000005') as time_off_count,
      (select min(location_id::text) from public.time_off_requests
       where employee_id = '50000000-0000-4000-8000-000000000005') as time_off_location
  `)).rows[0];
  assert(
    managerReads.availability_count === 1 &&
      managerReads.availability_location === "30000000-0000-4000-8000-000000000001" &&
      managerReads.time_off_count === 1 &&
      managerReads.time_off_location === "30000000-0000-4000-8000-000000000001",
    "Downtown manager saw rows outside the managed location",
    managerReads,
  );

  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  const selfReads = (await db.query(`
    select
      (select count(*)::integer from public.availability_rules
       where employee_id = '50000000-0000-4000-8000-000000000005') as availability_count,
      (select count(*)::integer from public.time_off_requests
       where employee_id = '50000000-0000-4000-8000-000000000005') as time_off_count
  `)).rows[0];
  assert(
    selfReads.availability_count === 2 && selfReads.time_off_count === 2,
    "Employee self-read did not retain both locations",
    selfReads,
  );

  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
      false
    );
  `);
  const ownerReads = (await db.query(`
    select
      (select count(*)::integer from public.availability_rules
       where employee_id = '50000000-0000-4000-8000-000000000005') as availability_count,
      (select count(*)::integer from public.time_off_requests
       where employee_id = '50000000-0000-4000-8000-000000000005') as time_off_count
  `)).rows[0];
  assert(
    ownerReads.availability_count === 2 && ownerReads.time_off_count === 2,
    "Organization-wide Owner read changed unexpectedly",
    ownerReads,
  );
  process.stdout.write("PASS self/Owner reads and location-scoped manager People reads\n");

  // Owner/Admin-only role definitions and employee assignment commands.
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.create_job_role_definition(
      'f8100000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'Service Lead', 'service_lead', 'Dining room', '#0f766e', 1.5, true
    );
    select public.create_job_role_definition(
      'f8100000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'Service Lead', 'service_lead', 'Dining room', '#0f766e', 1.5, true
    );
    select public.update_job_role_definition(
      'f8100000-0000-4000-8000-000000000002',
      'f8100000-0000-4000-8000-000000000001',
      'Service Captain', 'service_captain', 'Dining room', '#0f766e', 1.75, true
    );
    select public.update_job_role_definition(
      'f8100000-0000-4000-8000-000000000002',
      'f8100000-0000-4000-8000-000000000001',
      'Service Captain', 'service_captain', 'Dining room', '#0f766e', 1.75, true
    );
  `);

  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  await expectDatabaseError(
    `select public.create_job_role_definition(
       'f8110000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000001',
       'Manager Role', 'MANAGER_ROLE', null, null, 0, false
     )`,
    "42501",
    "manager role-definition creation",
  );

  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  await expectDatabaseError(
    `select public.create_job_role_definition(
       'f8120000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000001',
       'Employee Role', 'EMPLOYEE_ROLE', null, null, 0, false
     )`,
    "42501",
    "employee role-definition creation",
  );

  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  await expectDatabaseError(
    `select public.create_job_role_definition(
       'f8130000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000002',
       'Cross Tenant', 'CROSS_TENANT', null, null, 0, false
     )`,
    "42501",
    "admin cross-tenant role-definition creation",
  );
  await expectDatabaseError(
    `insert into public.job_roles (
       organization_id, name, code, default_tip_points, is_tipped
     ) values (
       '20000000-0000-4000-8000-000000000001',
       'Direct Write', 'DIRECT_WRITE', 0, false
     )`,
    "42501",
    "authenticated direct job-role insert",
  );
  await expectDatabaseError(
    `select public.create_employee_job_assignment(
       'f8210000-0000-4000-8000-000000000001',
       '50000000-0000-4000-8000-000000000005',
       'f8100000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000002',
       -1, date '2026-01-01', null, false
     )`,
    "22023",
    "negative private hourly rate",
  );
  await expectDatabaseError(
    `select public.create_employee_job_assignment(
       'f8210000-0000-4000-8000-000000000002',
       '50000000-0000-4000-8000-000000000005',
       'f8100000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000002',
       null, date '2026-02-01', date '2026-01-01', false
     )`,
    "22023",
    "reversed assignment dates",
  );
  await expectDatabaseError(
    `select public.create_employee_job_assignment(
       'f8210000-0000-4000-8000-000000000003',
       '50000000-0000-4000-8000-000000000005',
       '40000000-0000-4000-8000-000000000004',
       '30000000-0000-4000-8000-000000000002',
       null, date '2026-01-01', null, false
     )`,
    "23514",
    "cross-tenant assignment role",
  );
  await expectDatabaseError(
    `select public.create_employee_job_assignment(
       'f8210000-0000-4000-8000-000000000004',
       '50000000-0000-4000-8000-000000000006',
       '40000000-0000-4000-8000-000000000004',
       '30000000-0000-4000-8000-000000000003',
       null, date '2026-01-01', null, false
     )`,
    "42501",
    "cross-tenant employee assignment",
  );

  await db.exec(`
    select public.create_employee_job_assignment(
      'f8200000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005',
      'f8100000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      2750, date '2026-01-01', null, false
    );
    select public.create_employee_job_assignment(
      'f8200000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005',
      'f8100000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      2750, date '2026-01-01', null, false
    );
  `);
  await expectDatabaseError(
    `select public.create_employee_job_assignment(
       'f8210000-0000-4000-8000-000000000005',
       '50000000-0000-4000-8000-000000000005',
       'f8100000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000002',
       null, date '2026-02-01', null, false
     )`,
    "23P01",
    "overlapping role assignment",
  );
  await db.exec(`
    select public.update_employee_job_assignment(
      'f8200000-0000-4000-8000-000000000002',
      'f8200000-0000-4000-8000-000000000001',
      'f8100000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      false, null, date '2026-01-02', null, false
    );
    select public.update_employee_job_assignment(
      'f8200000-0000-4000-8000-000000000002',
      'f8200000-0000-4000-8000-000000000001',
      'f8100000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      false, null, date '2026-01-02', null, false
    );
  `);
  await expectDatabaseError(
    `select public.deactivate_job_role_definition(
       'f8100000-0000-4000-8000-000000000003',
       'f8100000-0000-4000-8000-000000000001'
     )`,
    "23514",
    "deactivation with active assignment",
  );
  await db.exec(`
    select public.end_employee_job_assignment(
      'f8200000-0000-4000-8000-000000000003',
      'f8200000-0000-4000-8000-000000000001', date '2026-07-31'
    );
    select public.end_employee_job_assignment(
      'f8200000-0000-4000-8000-000000000003',
      'f8200000-0000-4000-8000-000000000001', date '2026-07-31'
    );
    select public.deactivate_job_role_definition(
      'f8100000-0000-4000-8000-000000000003',
      'f8100000-0000-4000-8000-000000000001'
    );
    select public.deactivate_job_role_definition(
      'f8100000-0000-4000-8000-000000000003',
      'f8100000-0000-4000-8000-000000000001'
    );
  `);
  await expectDatabaseError(
    `select public.create_employee_job_assignment(
       'f8210000-0000-4000-8000-000000000006',
       '50000000-0000-4000-8000-000000000005',
       'f8100000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000002',
       null, date '2026-08-01', null, false
     )`,
    "23514",
    "assignment to inactive role",
  );
  await expectDatabaseError(
    `update public.employee_job_roles
     set effective_to = date '2026-08-01'
     where id = 'f8200000-0000-4000-8000-000000000001'`,
    "42501",
    "authenticated direct assignment update",
  );
  await expectDatabaseError(
    `select hourly_rate_cents
     from public.employee_job_roles
     where id = 'f8200000-0000-4000-8000-000000000001'`,
    "42501",
    "authenticated hourly-rate read",
  );

  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);
  const configurationEvidence = (await db.query(`
    select
      (select count(*)::integer from public.job_roles
       where id = 'f8100000-0000-4000-8000-000000000001') as role_rows,
      (select name from public.job_roles
       where id = 'f8100000-0000-4000-8000-000000000001') as role_name,
      (select is_active from public.job_roles
       where id = 'f8100000-0000-4000-8000-000000000001') as role_active,
      (select count(*)::integer from public.employee_job_roles
       where id = 'f8200000-0000-4000-8000-000000000001') as assignment_rows,
      (select hourly_rate_cents from public.employee_job_roles
       where id = 'f8200000-0000-4000-8000-000000000001') as private_rate,
      (select effective_from::text from public.employee_job_roles
       where id = 'f8200000-0000-4000-8000-000000000001') as effective_from,
      (select effective_to::text from public.employee_job_roles
       where id = 'f8200000-0000-4000-8000-000000000001') as effective_to,
      (select count(*)::integer from public.audit_events
       where table_name = 'job_roles'
         and record_id = 'f8100000-0000-4000-8000-000000000001') as role_audits,
      (select count(*)::integer from public.audit_events
       where table_name = 'employee_job_roles'
         and record_id = 'f8200000-0000-4000-8000-000000000001') as assignment_audits,
      (select count(*)::integer from public.audit_events
       where record_id in (
         'f8100000-0000-4000-8000-000000000001',
         'f8200000-0000-4000-8000-000000000001'
       ) and actor_id = '10000000-0000-4000-8000-000000000003') as actor_audits,
      (select count(*)::integer from private.operation_requests
       where request_id in (
         'f8100000-0000-4000-8000-000000000001',
         'f8100000-0000-4000-8000-000000000002',
         'f8100000-0000-4000-8000-000000000003',
         'f8200000-0000-4000-8000-000000000001',
         'f8200000-0000-4000-8000-000000000002',
         'f8200000-0000-4000-8000-000000000003'
       ) and actor_id = '10000000-0000-4000-8000-000000000003'
         and completed_at is not null) as completed_requests
  `)).rows[0];
  assert(
    configurationEvidence.role_rows === 1 &&
      configurationEvidence.role_name === "Service Captain" &&
      configurationEvidence.role_active === false &&
      configurationEvidence.assignment_rows === 1 &&
      configurationEvidence.private_rate === 2750 &&
      configurationEvidence.effective_from === "2026-01-02" &&
      configurationEvidence.effective_to === "2026-07-31" &&
      configurationEvidence.role_audits === 3 &&
      configurationEvidence.assignment_audits === 3 &&
      configurationEvidence.actor_audits === 6 &&
      configurationEvidence.completed_requests === 6,
    "Role/assignment command evidence or exact replay failed",
    configurationEvidence,
  );
  process.stdout.write("PASS actor-bound role and assignment commands, validation, replay, audit, and private rates\n");

  // Browser sessions may upload and verify, but only the server role may bind.
  await db.exec(`
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    insert into storage.objects (id, bucket_id, name, owner_id, metadata)
    values (
      'f6000000-0000-4000-8000-000000000019',
      'employee-documents',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/employee-documents/50000000-0000-4000-8000-000000000005/f7000000-0000-4000-8000-000000000019-handbook.pdf',
      '10000000-0000-4000-8000-000000000004',
      '{"mimetype":"application/pdf","size":5}'::jsonb
    );
  `);
  await expectDatabaseError(
    `select public.finalize_employee_document(
       'f7000000-0000-4000-8000-000000000019',
       '50000000-0000-4000-8000-000000000005',
       '30000000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/employee-documents/50000000-0000-4000-8000-000000000005/f7000000-0000-4000-8000-000000000019-handbook.pdf',
       'handbook', 'Signed handbook', 'application/pdf', 5, true
     )`,
    "42501",
    "authenticated direct document finalization",
  );
  await expectDatabaseError(
    `select public.service_finalize_employee_document(
       'f7000000-0000-4000-8000-000000000019',
       '10000000-0000-4000-8000-000000000004', 'aal1',
       '50000000-0000-4000-8000-000000000005',
       '30000000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/employee-documents/50000000-0000-4000-8000-000000000005/f7000000-0000-4000-8000-000000000019-handbook.pdf',
       'handbook', 'Signed handbook', 'application/pdf', 5, true
     )`,
    "42501",
    "authenticated service document finalization",
  );

  await db.exec(`
    reset role;
    insert into storage.objects (id, bucket_id, name, owner_id, metadata) values
      (
        'f6000000-0000-4000-8000-000000000020',
        'employee-documents',
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/employee-documents/50000000-0000-4000-8000-000000000005/f7010000-0000-4000-8000-000000000019-forged.pdf',
        '10000000-0000-4000-8000-000000000004',
        '{"mimetype":"application/pdf","size":6}'::jsonb
      ),
      (
        'f6000000-0000-4000-8000-000000000021',
        'employee-documents',
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/employee-documents/50000000-0000-4000-8000-000000000005/f7020000-0000-4000-8000-000000000019-cross.pdf',
        '10000000-0000-4000-8000-000000000006',
        '{"mimetype":"application/pdf","size":5}'::jsonb
      );
    set role service_role;
    select set_config(
      'request.jwt.claims',
      '{"role":"service_role"}',
      false
    );
    select public.service_finalize_employee_document(
      'f7000000-0000-4000-8000-000000000019',
      '10000000-0000-4000-8000-000000000004', 'aal1',
      '50000000-0000-4000-8000-000000000005',
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/employee-documents/50000000-0000-4000-8000-000000000005/f7000000-0000-4000-8000-000000000019-handbook.pdf',
      'handbook', 'Signed handbook', 'application/pdf', 5, true
    );
    select public.service_finalize_employee_document(
      'f7000000-0000-4000-8000-000000000019',
      '10000000-0000-4000-8000-000000000004', 'aal1',
      '50000000-0000-4000-8000-000000000005',
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/employee-documents/50000000-0000-4000-8000-000000000005/f7000000-0000-4000-8000-000000000019-handbook.pdf',
      'handbook', 'Signed handbook', 'application/pdf', 5, true
    );
  `);
  await expectDatabaseError(
    `select public.service_finalize_employee_document(
       'f7010000-0000-4000-8000-000000000019',
       '10000000-0000-4000-8000-000000000004', 'aal1',
       '50000000-0000-4000-8000-000000000005',
       '30000000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/employee-documents/50000000-0000-4000-8000-000000000005/f7010000-0000-4000-8000-000000000019-forged.pdf',
       'handbook', 'Forged size', 'application/pdf', 5, true
     )`,
    "23514",
    "forged employee-document metadata",
  );
  await expectDatabaseError(
    `select public.service_finalize_employee_document(
       'f7020000-0000-4000-8000-000000000019',
       '10000000-0000-4000-8000-000000000006', 'aal2',
       '50000000-0000-4000-8000-000000000005',
       '30000000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/employee-documents/50000000-0000-4000-8000-000000000005/f7020000-0000-4000-8000-000000000019-cross.pdf',
       'handbook', 'Cross tenant', 'application/pdf', 5, true
     )`,
    "42501",
    "cross-tenant service document finalization",
  );

  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);
  const documentEvidence = (await db.query(`
    select
      (select count(*)::integer from public.employee_documents
       where id = 'f7000000-0000-4000-8000-000000000019') as document_rows,
      (select uploaded_by from public.employee_documents
       where id = 'f7000000-0000-4000-8000-000000000019') as uploaded_by,
      (select count(*)::integer from public.audit_events
       where table_name = 'employee_documents'
         and record_id = 'f7000000-0000-4000-8000-000000000019'
         and actor_id = '10000000-0000-4000-8000-000000000004') as actor_audits,
      (select count(*)::integer from private.operation_requests
       where request_id = 'f7000000-0000-4000-8000-000000000019'
         and actor_id = '10000000-0000-4000-8000-000000000004'
         and completed_at is not null) as completed_requests
  `)).rows[0];
  assert(
    documentEvidence.document_rows === 1 &&
      documentEvidence.uploaded_by === "10000000-0000-4000-8000-000000000004" &&
      documentEvidence.actor_audits === 1 &&
      documentEvidence.completed_requests === 1,
    "Service-bound document evidence or replay failed",
    documentEvidence,
  );

  const contract = (await db.query(`
    select
      (select not public and file_size_limit = 26214400
         and allowed_mime_types = array[
           'application/pdf', 'image/jpeg', 'image/png', 'image/webp'
         ]::text[]
       from storage.buckets where id = 'employee-documents') as bucket_exact,
      has_table_privilege('authenticated', 'public.job_roles', 'INSERT,UPDATE,DELETE') as direct_role_write,
      has_table_privilege('authenticated', 'public.employee_job_roles', 'INSERT,UPDATE,DELETE') as direct_assignment_write,
      has_column_privilege('authenticated', 'public.employee_job_roles', 'id', 'SELECT') as safe_assignment_read,
      has_column_privilege('authenticated', 'public.employee_job_roles', 'hourly_rate_cents', 'SELECT') as private_rate_read,
      has_function_privilege(
        'authenticated',
        'public.finalize_employee_document(uuid,uuid,uuid,text,text,text,text,bigint,boolean)',
        'EXECUTE'
      ) as authenticated_old_finalize,
      has_function_privilege(
        'authenticated',
        'public.service_finalize_employee_document(uuid,uuid,text,uuid,uuid,text,text,text,text,bigint,boolean)',
        'EXECUTE'
      ) as authenticated_service_finalize,
      has_function_privilege(
        'service_role',
        'public.service_finalize_employee_document(uuid,uuid,text,uuid,uuid,text,text,text,text,bigint,boolean)',
        'EXECUTE'
      ) as service_finalize,
      to_regprocedure(
        'public.create_job_role_definition(uuid,uuid,text,text,text,text,numeric,boolean)'
      ) is not null as create_role_rpc,
      to_regprocedure(
        'public.update_employee_job_assignment(uuid,uuid,uuid,uuid,boolean,integer,date,date,boolean)'
      ) is not null as update_assignment_rpc
  `)).rows[0];
  assert(
    contract.bucket_exact &&
      !contract.direct_role_write &&
      !contract.direct_assignment_write &&
      contract.safe_assignment_read &&
      !contract.private_rate_read &&
      !contract.authenticated_old_finalize &&
      !contract.authenticated_service_finalize &&
      contract.service_finalize &&
      contract.create_role_rpc &&
      contract.update_assignment_rpc,
    "People configuration/security catalog contract failed",
    contract,
  );
  process.stdout.write("PASS service-only verified document binding and exact storage/catalog privileges\n");
} finally {
  await db.close();
}
