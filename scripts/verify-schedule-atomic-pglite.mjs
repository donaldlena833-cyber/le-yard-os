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

const ids = {
  organization: "20000000-0000-4000-8000-000000000001",
  location: "30000000-0000-4000-8000-000000000001",
  otherLocation: "30000000-0000-4000-8000-000000000002",
  owner: "10000000-0000-4000-8000-000000000001",
  manager: "10000000-0000-4000-8000-000000000004",
  employee: "10000000-0000-4000-8000-000000000005",
  managerEmployee: "50000000-0000-4000-8000-000000000004",
  employeeRecord: "50000000-0000-4000-8000-000000000005",
  serverRole: "40000000-0000-4000-8000-000000000001",
  barRole: "40000000-0000-4000-8000-000000000002",
  managerRole: "ad000000-0000-4000-8000-000000000001",
  managerAssignment: "ad100000-0000-4000-8000-000000000001",
  managerCapability: "ad200000-0000-4000-8000-000000000001",
  otherMembership: "ad300000-0000-4000-8000-000000000001",
  sourceTemplate: "ae000000-0000-4000-8000-000000000001",
  otherTemplate: "ae000000-0000-4000-8000-000000000002",
  invalidTemplate: "ae000000-0000-4000-8000-000000000003",
  dstTemplate: "ae000000-0000-4000-8000-000000000004",
  terminatedTemplate: "ae000000-0000-4000-8000-000000000005",
  inactiveRoleTemplate: "ae000000-0000-4000-8000-000000000006",
  ambiguousTemplate: "ae000000-0000-4000-8000-000000000007",
  futureTerminationTemplate: "ae000000-0000-4000-8000-000000000008",
  schedule: "af000000-0000-4000-8000-000000000001",
  scheduleTwo: "af000000-0000-4000-8000-000000000002",
  scheduleThree: "af000000-0000-4000-8000-000000000003",
  deniedSchedule: "af000000-0000-4000-8000-000000000004",
  invalidSchedule: "af000000-0000-4000-8000-000000000005",
  otherSchedule: "af000000-0000-4000-8000-000000000006",
  snapshotSchedule: "af000000-0000-4000-8000-000000000007",
  dstSchedule: "af000000-0000-4000-8000-000000000008",
  terminatedSchedule: "af000000-0000-4000-8000-000000000009",
  inactiveRoleSchedule: "af000000-0000-4000-8000-00000000000a",
  staleSnapshotSchedule: "af000000-0000-4000-8000-00000000000b",
  authSchedule: "af000000-0000-4000-8000-00000000000c",
  ambiguousSchedule: "af000000-0000-4000-8000-00000000000d",
  futureTerminationSchedule: "af000000-0000-4000-8000-00000000000e",
  dstSpanSchedule: "af000000-0000-4000-8000-00000000000f",
  snapshotShift: "af100000-0000-4000-8000-000000000001",
  cancelledSourceShift: "af100000-0000-4000-8000-000000000002",
  staleSnapshotShift: "af100000-0000-4000-8000-000000000003",
  authShift: "af100000-0000-4000-8000-000000000004",
  dstSpanShift: "af100000-0000-4000-8000-000000000005",
  otherDraftShift: "af100000-0000-4000-8000-000000000006",
  outOfWeekShift: "af100000-0000-4000-8000-000000000007",
  savedTemplate: "b0000000-0000-4000-8000-000000000001",
  duplicateNameTemplate: "b0000000-0000-4000-8000-000000000002",
  concurrentTemplateOne: "b0000000-0000-4000-8000-000000000003",
  concurrentTemplateTwo: "b0000000-0000-4000-8000-000000000004",
  invalidSavedTemplate: "b0000000-0000-4000-8000-000000000005",
  staleSavedTemplate: "b0000000-0000-4000-8000-000000000006",
  dstSpanSavedTemplate: "b0000000-0000-4000-8000-000000000007",
  inactiveRole: "c0000000-0000-4000-8000-000000000001",
  terminatedEmployee: "c1000000-0000-4000-8000-000000000001",
  terminatedAssignment: "c2000000-0000-4000-8000-000000000001",
  publishOnlyOverride: "d0000000-0000-4000-8000-000000000001",
  manageDenyOverride: "d0000000-0000-4000-8000-000000000002",
};

const bootstrap = `
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

function assert(condition, message, evidence = undefined) {
  if (!condition) {
    throw new Error(`${message}${evidence === undefined ? "" : `: ${JSON.stringify(evidence)}`}`);
  }
}

async function assume(userId) {
  await db.exec("reset role; set role authenticated");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({
      role: "authenticated",
      sub: userId,
      aal: userId === ids.owner ? "aal2" : "aal1",
    }),
  ]);
}

async function trusted() {
  await db.exec("reset role; select set_config('request.jwt.claims', '{}', false)");
}

async function expectError(action, expectedCode, label) {
  try {
    await action();
  } catch (error) {
    if (error?.code === expectedCode) return error;
    throw new Error(`${label}: expected ${expectedCode}, received ${error?.code ?? "unknown"}: ${error?.message ?? error}`);
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

function createSchedule(requestId, weekStart = "2030-01-07", templateId = ids.sourceTemplate) {
  return db.query(
    "select public.create_schedule_draft($1::uuid,$2::uuid,$3::date,$4::uuid) as result",
    [requestId, ids.location, weekStart, templateId],
  );
}

function saveTemplate(requestId, name, scheduleId = ids.schedule) {
  return db.query(
    "select public.save_schedule_template($1::uuid,$2::uuid,$3::text) as result",
    [requestId, scheduleId, name],
  );
}

try {
  await db.exec(bootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }
  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));

  await trusted();
  await db.exec(`
    insert into public.location_memberships (
      id, organization_id, location_id, user_id, is_primary
    ) values (
      '${ids.otherMembership}', '${ids.organization}', '${ids.otherLocation}',
      '${ids.manager}', false
    );
    insert into public.job_roles (
      id, organization_id, name, code, department, default_tip_points, is_tipped
    ) values (
      '${ids.managerRole}', '${ids.organization}', 'Schedule Coordinator',
      'ATOMIC_SCHED', 'Operations', 0, false
    );
    insert into public.job_roles (
      id, organization_id, name, code, department, default_tip_points, is_tipped, is_active
    ) values (
      '${ids.inactiveRole}', '${ids.organization}', 'Retired Service Role',
      'RETIRED_ATOMIC', 'Operations', 0, false, false
    );
    insert into public.employees (
      id, organization_id, home_location_id, employee_number, display_name,
      employment_status, hire_date, termination_date
    ) values (
      '${ids.terminatedEmployee}', '${ids.organization}', '${ids.location}',
      'ATOMIC-TERM-1', 'Terminated Template Employee', 'terminated',
      date '2029-01-01', date '2029-12-31'
    );
    insert into public.employee_job_roles (
      id, organization_id, employee_id, job_role_id, location_id,
      effective_from, effective_to, is_primary
    ) values (
      '${ids.terminatedAssignment}', '${ids.organization}', '${ids.terminatedEmployee}',
      '${ids.serverRole}', '${ids.location}', date '2029-01-01', null, true
    );
    insert into public.employee_job_roles (
      id, organization_id, employee_id, job_role_id, location_id,
      effective_from, is_primary
    ) values (
      '${ids.managerAssignment}', '${ids.organization}', '${ids.managerEmployee}',
      '${ids.managerRole}', '${ids.location}', current_date - 30, true
    );
    select set_config(
      'request.jwt.claims',
      '{"role":"authenticated","sub":"${ids.owner}","aal":"aal2"}',
      false
    );
    update public.employees
    set hire_date = date '2026-01-01', termination_date = date '2029-12-31'
    where id = '${ids.employeeRecord}';
    select set_config('request.jwt.claims', '{}', false);
    insert into public.job_role_capabilities (
      id, organization_id, job_role_id, capability_key, location_id,
      effective_from, effective_to, is_active, created_by, updated_by
    ) values (
      '${ids.managerCapability}', '${ids.organization}', '${ids.managerRole}',
      'schedule.manage', '${ids.location}', current_date - 30, current_date - 1,
      true, '${ids.owner}', '${ids.owner}'
    );
    insert into public.user_capability_overrides (
      id, organization_id, user_id, capability_key, location_id, effect,
      reason, effective_from, is_active, created_by, updated_by
    ) values (
      '${ids.publishOnlyOverride}', '${ids.organization}', '${ids.employee}',
      'schedule.publish', '${ids.location}', 'grant',
      'Atomic schedule publish-only verifier', current_date - 1, true,
      '${ids.owner}', '${ids.owner}'
    );

    insert into public.schedule_templates (
      id, organization_id, location_id, name, created_by, is_active
    ) values
      ('${ids.sourceTemplate}', '${ids.organization}', '${ids.location}',
       'Atomic source', '${ids.owner}', true),
      ('${ids.otherTemplate}', '${ids.organization}', '${ids.otherLocation}',
       'Other room source', '${ids.owner}', true),
      ('${ids.invalidTemplate}', '${ids.organization}', '${ids.location}',
       'Invalid assignment source', '${ids.owner}', true),
      ('${ids.dstTemplate}', '${ids.organization}', '${ids.location}',
       'DST gap source', '${ids.owner}', true),
      ('${ids.terminatedTemplate}', '${ids.organization}', '${ids.location}',
       'Terminated employee source', '${ids.owner}', true),
      ('${ids.inactiveRoleTemplate}', '${ids.organization}', '${ids.location}',
       'Inactive role source', '${ids.owner}', true),
      ('${ids.ambiguousTemplate}', '${ids.organization}', '${ids.location}',
       'DST fold source', '${ids.owner}', true),
      ('${ids.futureTerminationTemplate}', '${ids.organization}', '${ids.location}',
       'Future termination source', '${ids.owner}', true);
    insert into public.schedule_template_shifts (
      organization_id, template_id, weekday, starts_at, ends_at,
      job_role_id, employee_id, break_minutes, notes
    ) values
      ('${ids.organization}', '${ids.sourceTemplate}', 1, time '10:00', time '18:00',
       '${ids.serverRole}', null, 30, 'Open day'),
      ('${ids.organization}', '${ids.sourceTemplate}', 2, time '22:00', time '02:00',
       '${ids.barRole}', null, 20, 'Open overnight'),
      ('${ids.organization}', '${ids.otherTemplate}', 1, time '09:00', time '17:00',
       '${ids.serverRole}', null, 30, null),
      ('${ids.organization}', '${ids.invalidTemplate}', 1, time '10:00', time '18:00',
       '${ids.barRole}', '${ids.employeeRecord}', 30, 'Assignment mismatch'),
      ('${ids.organization}', '${ids.dstTemplate}', 0, time '02:30', time '04:00',
       '${ids.serverRole}', null, 0, 'Nonexistent spring-forward time'),
      ('${ids.organization}', '${ids.terminatedTemplate}', 1, time '10:00', time '18:00',
       '${ids.serverRole}', '${ids.terminatedEmployee}', 30, 'Terminated employee'),
      ('${ids.organization}', '${ids.inactiveRoleTemplate}', 1, time '10:00', time '18:00',
       '${ids.inactiveRole}', null, 30, 'Inactive open-shift role'),
      ('${ids.organization}', '${ids.ambiguousTemplate}', 0, time '01:30', time '03:00',
       '${ids.serverRole}', null, 0, 'Ambiguous fall-back time'),
      ('${ids.organization}', '${ids.futureTerminationTemplate}', 1, time '10:00', time '18:00',
       '${ids.serverRole}', '${ids.employeeRecord}', 30, 'After recorded termination');
    insert into public.schedules (
      id, organization_id, location_id, week_start, status, version, created_by
    ) values (
      '${ids.authSchedule}', '${ids.organization}', '${ids.location}',
      date '2030-05-06', 'draft', 1, '${ids.owner}'
    );
    insert into public.shifts (
      id, organization_id, location_id, schedule_id, employee_id, job_role_id,
      starts_at, ends_at, break_minutes, status, is_open, notes
    ) values (
      '${ids.authShift}', '${ids.organization}', '${ids.location}',
      '${ids.authSchedule}', null, '${ids.serverRole}',
      timestamptz '2030-05-06 10:00:00-04', timestamptz '2030-05-06 18:00:00-04',
      30, 'open', true, 'Authorization boundary fixture'
    );
  `);

  await assume(ids.manager);
  const expiredDraftRead = (await db.query(`
    select
      (select count(*)::integer from public.schedules
       where id = '${ids.authSchedule}') as schedules,
      (select count(*)::integer from public.shifts
       where id = '${ids.authShift}') as shifts,
      (select count(*)::integer from public.schedule_templates
       where id = '${ids.sourceTemplate}') as templates,
      (select count(*)::integer from public.schedule_template_shifts
       where template_id = '${ids.sourceTemplate}') as template_shifts
  `)).rows[0];
  assert(
    expiredDraftRead.schedules === 0 && expiredDraftRead.shifts === 0 &&
      expiredDraftRead.templates === 0 && expiredDraftRead.template_shifts === 0,
    "Manager role bypassed an expired scheduling capability on draft reads",
    expiredDraftRead,
  );
  const deniedDirectShift = await db.query(
    "update public.shifts set notes = 'legacy manager bypass' where id = $1::uuid returning id",
    [ids.authShift],
  );
  assert(
    deniedDirectShift.rows.length === 0,
    "Legacy manager role bypassed exact schedule.manage shift RLS",
    deniedDirectShift.rows,
  );
  await expectError(
    () => db.query(
      "update public.schedules set week_start = week_start + 7 where id = $1::uuid",
      [ids.authSchedule],
    ),
    "42501",
    "denied direct schedule update",
  );
  await expectError(
    () => db.query(
      "update public.schedule_templates set description = 'legacy manager bypass' where id = $1::uuid",
      [ids.sourceTemplate],
    ),
    "42501",
    "denied direct template update",
  );
  await expectError(
    () => db.query(
      "select (public.publish_schedule($1::uuid, 'manage is not publish')).id",
      [ids.authSchedule],
    ),
    "42501",
    "manager without schedule.publish",
  );
  await expectError(
    () => createSchedule(ids.deniedSchedule),
    "42501",
    "expired schedule.manage capability",
  );
  await trusted();
  await db.exec(`
    update public.job_role_capabilities
    set effective_to = current_date + 30
    where id = '${ids.managerCapability}';
  `);

  await assume(ids.manager);
  const managedDirectShift = await db.query(
    "update public.shifts set notes = 'exact manage update' where id = $1::uuid returning id",
    [ids.authShift],
  );
  assert(
    managedDirectShift.rows.length === 1 && managedDirectShift.rows[0].id === ids.authShift,
    "Exact schedule.manage did not authorize draft shift editing",
    managedDirectShift.rows,
  );
  await expectError(
    () => db.query(
      `insert into public.shifts (
         id, organization_id, location_id, schedule_id, employee_id, job_role_id,
         starts_at, ends_at, break_minutes, status, is_open
       ) values (
         $1::uuid, $2::uuid, $3::uuid, $4::uuid, null, $5::uuid,
         timestamptz '2030-05-13 10:00:00-04',
         timestamptz '2030-05-13 18:00:00-04', 30, 'open', true
       )`,
      [
        ids.outOfWeekShift,
        ids.organization,
        ids.location,
        ids.authSchedule,
        ids.serverRole,
      ],
    ),
    "23514",
    "out-of-week direct shift insert",
  );
  const crossLocationShiftWrite = await db.query(
    "update public.shifts set notes = 'cross-location bypass' where id = $1::uuid returning id",
    ["61000000-0000-4000-8000-000000000002"],
  );
  assert(
    crossLocationShiftWrite.rows.length === 0,
    "Location-local schedule.manage mutated another location's shift",
    crossLocationShiftWrite.rows,
  );
  const crossLocationDraftRead = (await db.query(`
    select
      (select count(*)::integer from public.schedule_templates
       where id = '${ids.otherTemplate}') as templates,
      (select count(*)::integer from public.schedule_template_shifts
       where template_id = '${ids.otherTemplate}') as template_shifts
  `)).rows[0];
  assert(
    crossLocationDraftRead.templates === 0 &&
      crossLocationDraftRead.template_shifts === 0,
    "Location-scoped schedule.manage read another location's templates",
    crossLocationDraftRead,
  );
  await expectError(
    () => db.query(
      "select (public.publish_schedule($1::uuid, 'manage is still not publish')).id",
      [ids.authSchedule],
    ),
    "42501",
    "schedule.manage incorrectly implied schedule.publish",
  );

  await assume(ids.employee);
  const publishOnlyRead = (await db.query(`
    select
      (select count(*)::integer from public.schedules where id = '${ids.authSchedule}') as schedules,
      (select count(*)::integer from public.shifts where id = '${ids.authShift}') as shifts,
      (select count(*)::integer from public.schedule_templates
       where id = '${ids.sourceTemplate}') as templates,
      (select count(*)::integer from public.schedule_template_shifts
       where template_id = '${ids.sourceTemplate}') as template_shifts
  `)).rows[0];
  assert(
    publishOnlyRead.schedules === 1 && publishOnlyRead.shifts === 1 &&
      publishOnlyRead.templates === 1 && publishOnlyRead.template_shifts === 2,
    "schedule.publish holder could not read the draft required for publication",
    publishOnlyRead,
  );
  const publishOnlyShiftWrite = await db.query(
    "update public.shifts set notes = 'publish-only bypass' where id = $1::uuid returning id",
    [ids.authShift],
  );
  assert(
    publishOnlyShiftWrite.rows.length === 0,
    "schedule.publish holder mutated a draft shift without schedule.manage",
    publishOnlyShiftWrite.rows,
  );
  await expectError(
    () => createSchedule(ids.deniedSchedule),
    "42501",
    "missing exact schedule.manage capability",
  );
  await expectError(
    () => saveTemplate(ids.invalidSavedTemplate, "Publish cannot save", ids.authSchedule),
    "42501",
    "schedule.publish incorrectly implied schedule.manage",
  );
  const publishedByCapability = (await db.query(
    "select (public.publish_schedule($1::uuid, 'publish-only proof')).*",
    [ids.authSchedule],
  )).rows[0];
  assert(
    publishedByCapability.id === ids.authSchedule &&
      publishedByCapability.status === "published" &&
      publishedByCapability.published_by === ids.employee,
    "Exact schedule.publish did not publish the draft",
    publishedByCapability,
  );
  await assume(ids.owner);
  await expectError(
    () => db.query(
      "update public.shifts set starts_at = starts_at + interval '15 minutes' where id = $1::uuid",
      [ids.authShift],
    ),
    "42501",
    "published shift mutation",
  );
  await assume(ids.employee);
  const crossLocationPublish = await expectError(
    () => db.query(
      "select (public.publish_schedule($1::uuid, 'cross-location')).id",
      ["60000000-0000-4000-8000-000000000002"],
    ),
    "42501",
    "cross-location schedule publication",
  );
  const missingPublish = await expectError(
    () => db.query(
      "select (public.publish_schedule($1::uuid, 'missing')).id",
      ["3f000000-0000-4000-8000-000000000000"],
    ),
    "42501",
    "missing schedule publication",
  );
  assert(
    crossLocationPublish.message === missingPublish.message,
    "Missing and unauthorized publication exposed different errors",
    { denied: crossLocationPublish.message, missing: missingPublish.message },
  );

  await assume(ids.manager);
  await expectError(
    () => db.query(
      "select public.create_schedule_draft($1::uuid,$2::uuid,date '2030-01-07',null::uuid)",
      [ids.deniedSchedule, ids.otherLocation],
    ),
    "42501",
    "cross-location schedule creation",
  );
  const missingLocation = await expectError(
    () => db.query(
      "select public.create_schedule_draft($1::uuid,$2::uuid,date '2030-01-07',null::uuid)",
      [ids.deniedSchedule, "3fffffff-ffff-4fff-8fff-ffffffffffff"],
    ),
    "42501",
    "missing schedule location",
  );
  const deniedLocation = await expectError(
    () => db.query(
      "select public.create_schedule_draft($1::uuid,$2::uuid,date '2030-01-07',null::uuid)",
      [ids.deniedSchedule, ids.otherLocation],
    ),
    "42501",
    "denied schedule location",
  );
  assert(
    missingLocation.message === deniedLocation.message,
    "Missing and unauthorized locations exposed different command errors",
    { missing: missingLocation.message, denied: deniedLocation.message },
  );
  await expectError(
    () => createSchedule(ids.deniedSchedule, "2030-01-07", ids.otherTemplate),
    "42501",
    "cross-location template application",
  );

  const created = (await createSchedule(ids.schedule)).rows[0].result;
  assert(
    created.id === ids.schedule && created.status === "draft" &&
      created.version === 1 && created.replayed === false,
    "Atomic schedule creation result was malformed",
    created,
  );
  const replayed = (await createSchedule(ids.schedule)).rows[0].result;
  assert(
    replayed.id === ids.schedule && replayed.version === 1 && replayed.replayed === true,
    "Exact schedule replay did not return the original result",
    replayed,
  );
  await expectError(
    () => createSchedule(ids.schedule, "2030-01-14"),
    "23505",
    "changed schedule request replay",
  );
  await assume(ids.owner);
  await expectError(
    () => createSchedule(ids.schedule),
    "23505",
    "cross-actor schedule replay",
  );

  await trusted();
  await db.exec(`
    update public.organization_settings
    set week_starts_on = 0
    where organization_id = '${ids.organization}';
    update public.schedule_templates
    set is_active = false
    where id = '${ids.sourceTemplate}';
  `);
  await assume(ids.manager);
  const mutableSourceReplay = (await createSchedule(ids.schedule)).rows[0].result;
  assert(
    mutableSourceReplay.id === ids.schedule && mutableSourceReplay.version === 1 &&
      mutableSourceReplay.replayed === true,
    "Completed schedule replay depended on mutable week/template state",
    mutableSourceReplay,
  );
  await trusted();
  await db.exec(`
    update public.organization_settings
    set week_starts_on = 1
    where organization_id = '${ids.organization}';
    update public.schedule_templates
    set is_active = true
    where id = '${ids.sourceTemplate}';
  `);
  await assume(ids.manager);
  const serializedVersionResults = await Promise.all([
    createSchedule(ids.scheduleTwo),
    createSchedule(ids.scheduleThree),
  ]);
  assert(
    serializedVersionResults.every((result) => result.rows[0].result.replayed === false),
    "Serialized embedded schedule commands did not both complete",
    serializedVersionResults.map((result) => result.rows[0].result),
  );
  await assume(ids.owner);
  await db.query(
    "select (public.publish_schedule($1::uuid, 'immutable replay proof')).id",
    [ids.scheduleThree],
  );
  await assume(ids.manager);
  const publishedScheduleReplay = (await createSchedule(ids.scheduleThree)).rows[0].result;
  assert(
    publishedScheduleReplay.id === ids.scheduleThree &&
      publishedScheduleReplay.status === "draft" &&
      publishedScheduleReplay.version === 3 &&
      publishedScheduleReplay.replayed === true,
    "Schedule replay returned mutable current row state instead of its immutable result",
    publishedScheduleReplay,
  );

  await expectError(
    () => createSchedule(ids.invalidSchedule, "2030-01-07", ids.invalidTemplate),
    "23514",
    "template child failure",
  );
  await expectError(
    () => createSchedule(ids.dstSchedule, "2030-03-04", ids.dstTemplate),
    "22023",
    "nonexistent DST local time",
  );
  await expectError(
    () => createSchedule(ids.ambiguousSchedule, "2030-10-28", ids.ambiguousTemplate),
    "22023",
    "ambiguous DST local time",
  );
  await expectError(
    () => createSchedule(ids.terminatedSchedule, "2030-01-07", ids.terminatedTemplate),
    "23514",
    "terminated template employee",
  );
  await expectError(
    () => createSchedule(ids.inactiveRoleSchedule, "2030-01-07", ids.inactiveRoleTemplate),
    "23514",
    "inactive template job role",
  );
  await expectError(
    () => createSchedule(
      ids.futureTerminationSchedule,
      "2030-01-07",
      ids.futureTerminationTemplate,
    ),
    "23514",
    "active employee after recorded termination date",
  );
  await trusted();
  const nonHourFold = (await db.query(`
    select private.local_timestamp_is_unique(
      timestamp '2030-04-07 01:45:00',
      'Australia/Lord_Howe'
    ) as unique_local_time
  `)).rows[0];
  assert(
    nonHourFold.unique_local_time === false,
    "Non-one-hour DST fold was not detected as ambiguous",
    nonHourFold,
  );
  const createEvidence = (await db.query(`
    select
      (select count(*)::integer from public.schedules
       where id in ('${ids.schedule}','${ids.scheduleTwo}','${ids.scheduleThree}')) as schedules,
      (select count(distinct version)::integer from public.schedules
       where id in ('${ids.schedule}','${ids.scheduleTwo}','${ids.scheduleThree}')) as versions,
      (select min(version)::integer from public.schedules
       where id in ('${ids.schedule}','${ids.scheduleTwo}','${ids.scheduleThree}')) as min_version,
      (select max(version)::integer from public.schedules
       where id in ('${ids.schedule}','${ids.scheduleTwo}','${ids.scheduleThree}')) as max_version,
      (select count(*)::integer from public.shifts where schedule_id = '${ids.schedule}') as copied_shifts,
      (select count(*)::integer from public.schedules where id = '${ids.invalidSchedule}') as invalid_parent,
      (select count(*)::integer from public.schedules where id = '${ids.dstSchedule}') as dst_parent,
      (select count(*)::integer from public.schedules
       where id in (
         '${ids.ambiguousSchedule}','${ids.terminatedSchedule}',
         '${ids.inactiveRoleSchedule}','${ids.futureTerminationSchedule}'
       )) as stale_parents,
      (select count(*)::integer from private.operation_requests
       where request_id in (
         '${ids.invalidSchedule}','${ids.dstSchedule}',
         '${ids.ambiguousSchedule}','${ids.terminatedSchedule}',
         '${ids.inactiveRoleSchedule}','${ids.futureTerminationSchedule}'
       )) as invalid_requests,
      (select count(*)::integer from private.operation_requests
       where request_id = '${ids.schedule}' and actor_id = '${ids.manager}'
         and completed_at is not null and length(payload_hash) = 64) as completed_request,
      (select count(*)::integer from public.audit_events
       where table_name = 'schedules' and record_id = '${ids.schedule}'
         and actor_id = '${ids.manager}'
         and request_id = '${ids.schedule}') as schedule_audits,
      (select count(*)::integer from public.audit_events
       where table_name = 'shifts' and new_record ->> 'schedule_id' = '${ids.schedule}'
         and actor_id = '${ids.manager}'
         and request_id = '${ids.schedule}') as shift_audits,
      (select count(*)::integer from private.schedule_command_results
       where request_id = '${ids.schedule}'
         and operation_kind = 'schedule.create'
         and result_payload = jsonb_build_object(
           'id', '${ids.schedule}'::uuid, 'status', 'draft', 'version', 1
         )) as immutable_results
  `)).rows[0];
  assert(
    createEvidence.schedules === 3 && createEvidence.versions === 3 &&
      createEvidence.min_version === 1 && createEvidence.max_version === 3 &&
      createEvidence.copied_shifts === 2 && createEvidence.invalid_parent === 0 &&
      createEvidence.dst_parent === 0 && createEvidence.invalid_requests === 0 &&
      createEvidence.stale_parents === 0 &&
      createEvidence.completed_request === 1 &&
      createEvidence.schedule_audits === 1 && createEvidence.shift_audits === 2 &&
      createEvidence.immutable_results === 1,
    "Schedule atomicity, version, request, or audit evidence failed",
    createEvidence,
  );

  await db.exec(`
    insert into public.shifts (
      id, organization_id, location_id, schedule_id, employee_id, job_role_id,
      starts_at, ends_at, break_minutes, status, is_open, notes
    ) values (
      '${ids.cancelledSourceShift}', '${ids.organization}', '${ids.location}',
      '${ids.schedule}', null, '${ids.serverRole}',
      timestamptz '2030-01-09 09:00:00-05', timestamptz '2030-01-09 12:00:00-05',
      0, 'cancelled', false, 'Must not enter template snapshot'
    );
  `);

  await assume(ids.manager);
  const saved = (await saveTemplate(ids.savedTemplate, "  Dinner Core  ")).rows[0].result;
  assert(saved.id === ids.savedTemplate && saved.replayed === false, "Template save failed", saved);
  const savedReplay = (await saveTemplate(ids.savedTemplate, "Dinner Core")).rows[0].result;
  assert(
    savedReplay.id === ids.savedTemplate && savedReplay.replayed === true,
    "Canonical template replay failed",
    savedReplay,
  );
  await expectError(
    () => saveTemplate(ids.savedTemplate, "Different payload"),
    "23505",
    "changed template request replay",
  );
  await expectError(
    () => saveTemplate(ids.duplicateNameTemplate, "Dinner Core"),
    "23505",
    "duplicate template name",
  );

  const serializedNames = await Promise.allSettled([
    saveTemplate(ids.concurrentTemplateOne, "Concurrent winner"),
    saveTemplate(ids.concurrentTemplateTwo, "Concurrent winner"),
  ]);
  assert(
    serializedNames.filter((result) => result.status === "fulfilled").length === 1 &&
      serializedNames.filter(
        (result) => result.status === "rejected" && result.reason?.code === "23505",
      ).length === 1,
    "Serialized embedded template-name commands did not produce exactly one winner",
    serializedNames.map((result) => result.status === "fulfilled"
      ? result.value.rows[0].result
      : { code: result.reason?.code, message: result.reason?.message }),
  );

  await trusted();
  await db.exec(`
    insert into public.schedules (
      id, organization_id, location_id, week_start, status, version, created_by
    ) values (
      '${ids.snapshotSchedule}', '${ids.organization}', '${ids.location}',
      date '2030-02-04', 'draft', 1, '${ids.manager}'
    );
    insert into public.shifts (
      id, organization_id, location_id, schedule_id, employee_id, job_role_id,
      starts_at, ends_at, break_minutes, status, is_open
    ) values (
      '${ids.snapshotShift}', '${ids.organization}', '${ids.location}',
      '${ids.snapshotSchedule}', null, '${ids.serverRole}',
      timestamptz '2030-02-05 10:00:00-05', timestamptz '2030-02-06 12:00:00-05',
      0, 'open', true
    );
    insert into public.schedules (
      id, organization_id, location_id, week_start, status, version, created_by
    ) values (
      '${ids.dstSpanSchedule}', '${ids.organization}', '${ids.location}',
      date '2030-03-04', 'draft', 1, '${ids.manager}'
    );
    insert into public.shifts (
      id, organization_id, location_id, schedule_id, employee_id, job_role_id,
      starts_at, ends_at, break_minutes, status, is_open
    ) values (
      '${ids.dstSpanShift}', '${ids.organization}', '${ids.location}',
      '${ids.dstSpanSchedule}', null, '${ids.serverRole}',
      timestamptz '2030-03-09 10:00:00-05', timestamptz '2030-03-10 10:30:00-04',
      0, 'open', true
    );
    insert into public.schedules (
      id, organization_id, location_id, week_start, status, version, created_by
    ) values (
      '${ids.otherSchedule}', '${ids.organization}', '${ids.otherLocation}',
      date '2030-02-04', 'draft', 1, '${ids.owner}'
    );
    insert into public.schedules (
      id, organization_id, location_id, week_start, status, version, created_by
    ) values (
      '${ids.staleSnapshotSchedule}', '${ids.organization}', '${ids.location}',
      date '2030-02-11', 'draft', 1, '${ids.manager}'
    );
    insert into public.shifts (
      id, organization_id, location_id, schedule_id, employee_id, job_role_id,
      starts_at, ends_at, break_minutes, status, is_open
    ) values (
      '${ids.staleSnapshotShift}', '${ids.organization}', '${ids.location}',
      '${ids.staleSnapshotSchedule}', null, '${ids.inactiveRole}',
      timestamptz '2030-02-12 10:00:00-05', timestamptz '2030-02-12 18:00:00-05',
      30, 'open', true
    );
    insert into public.shifts (
      id, organization_id, location_id, schedule_id, employee_id, job_role_id,
      starts_at, ends_at, break_minutes, status, is_open
    ) values (
      '${ids.otherDraftShift}', '${ids.organization}', '${ids.otherLocation}',
      '${ids.otherSchedule}', null, '${ids.serverRole}',
      timestamptz '2030-02-05 10:00:00-05', timestamptz '2030-02-05 18:00:00-05',
      30, 'open', true
    );
  `);
  await assume(ids.manager);
  const crossLocationDraftRows = (await db.query(`
    select
      (select count(*)::integer from public.schedules
       where id = '${ids.otherSchedule}') as schedules,
      (select count(*)::integer from public.shifts
       where id = '${ids.otherDraftShift}') as shifts
  `)).rows[0];
  assert(
    crossLocationDraftRows.schedules === 0 &&
      crossLocationDraftRows.shifts === 0,
    "Location-scoped schedule.manage read another location's draft staffing",
    crossLocationDraftRows,
  );
  await expectError(
    () => saveTemplate(ids.invalidSavedTemplate, "Invalid snapshot", ids.snapshotSchedule),
    "23514",
    "multi-day template snapshot loss",
  );
  await expectError(
    () => saveTemplate(
      ids.dstSpanSavedTemplate,
      "DST span snapshot",
      ids.dstSpanSchedule,
    ),
    "23514",
    "DST-spanning template snapshot loss",
  );
  await expectError(
    () => saveTemplate(ids.staleSavedTemplate, "Stale role snapshot", ids.staleSnapshotSchedule),
    "23514",
    "inactive role schedule snapshot",
  );
  const deniedSchedule = await expectError(
    () => saveTemplate(ids.invalidSavedTemplate, "Other room", ids.otherSchedule),
    "42501",
    "cross-location template save",
  );
  const missingSchedule = await expectError(
    () => saveTemplate(
      ids.invalidSavedTemplate,
      "Missing schedule",
      "afffffff-ffff-4fff-8fff-ffffffffffff",
    ),
    "42501",
    "missing schedule template save",
  );
  const crossTenantSchedule = await expectError(
    () => saveTemplate(
      ids.invalidSavedTemplate,
      "Cross tenant",
      "60000000-0000-4000-8000-000000000003",
    ),
    "42501",
    "cross-tenant template save",
  );
  assert(
    deniedSchedule.message === missingSchedule.message &&
      missingSchedule.message === crossTenantSchedule.message,
    "Missing, cross-location, and cross-tenant schedules exposed different command errors",
    {
      denied: deniedSchedule.message,
      missing: missingSchedule.message,
      crossTenant: crossTenantSchedule.message,
    },
  );

  await trusted();
  await db.exec(`
    insert into public.user_capability_overrides (
      id, organization_id, user_id, capability_key, location_id, effect,
      reason, effective_from, is_active, created_by, updated_by
    ) values (
      '${ids.manageDenyOverride}', '${ids.organization}', '${ids.manager}',
      'schedule.manage', '${ids.location}', 'deny',
      'Atomic schedule explicit-deny read proof', current_date, true,
      '${ids.owner}', '${ids.owner}'
    );
  `);
  await assume(ids.manager);
  const explicitlyDeniedDraftRead = (await db.query(`
    select
      (select count(*)::integer from public.schedules
       where id = '${ids.staleSnapshotSchedule}') as schedules,
      (select count(*)::integer from public.shifts
       where id = '${ids.staleSnapshotShift}') as shifts,
      (select count(*)::integer from public.schedule_templates
       where id = '${ids.sourceTemplate}') as templates,
      (select count(*)::integer from public.schedule_template_shifts
       where template_id = '${ids.sourceTemplate}') as template_shifts
  `)).rows[0];
  assert(
    explicitlyDeniedDraftRead.schedules === 0 &&
      explicitlyDeniedDraftRead.shifts === 0 &&
      explicitlyDeniedDraftRead.templates === 0 &&
      explicitlyDeniedDraftRead.template_shifts === 0,
    "Manager role bypassed an explicit scheduling capability denial on reads",
    explicitlyDeniedDraftRead,
  );

  await trusted();
  const templateEvidence = (await db.query(`
    select
      (select count(*)::integer from public.schedule_templates
       where id = '${ids.savedTemplate}' and name = 'Dinner Core') as templates,
      (select count(*)::integer from public.schedule_template_shifts
       where template_id = '${ids.savedTemplate}') as copied_shifts,
      (select count(*)::integer from public.schedule_templates
       where name = 'Concurrent winner') as name_winners,
      (select count(*)::integer from public.schedule_template_shifts shift
       join public.schedule_templates template on template.id = shift.template_id
       where template.name = 'Concurrent winner') as winner_children,
      (select count(*)::integer from public.schedule_templates
       where id in ('${ids.invalidSavedTemplate}','${ids.dstSpanSavedTemplate}')) as invalid_parent,
      (select count(*)::integer from public.schedule_templates
       where id = '${ids.staleSavedTemplate}') as stale_parent,
      (select count(*)::integer from private.operation_requests
       where request_id in (
         '${ids.duplicateNameTemplate}','${ids.invalidSavedTemplate}',
         '${ids.dstSpanSavedTemplate}','${ids.staleSavedTemplate}'
       )) as failed_requests,
      (select count(*)::integer from private.operation_requests
       where request_id = '${ids.savedTemplate}' and actor_id = '${ids.manager}'
         and completed_at is not null and length(payload_hash) = 64) as completed_request,
      (select count(*)::integer from public.audit_events
       where table_name = 'schedule_templates' and record_id = '${ids.savedTemplate}'
         and actor_id = '${ids.manager}'
         and request_id = '${ids.savedTemplate}') as template_audits,
      (select count(*)::integer from public.audit_events
       where table_name = 'schedule_template_shifts'
         and new_record ->> 'template_id' = '${ids.savedTemplate}'
         and actor_id = '${ids.manager}'
         and request_id = '${ids.savedTemplate}') as child_audits,
      (select count(*)::integer from private.schedule_command_results
       where request_id = '${ids.savedTemplate}'
         and operation_kind = 'schedule.template.save'
         and result_payload = jsonb_build_object('id', '${ids.savedTemplate}'::uuid)
      ) as immutable_results,
      has_table_privilege('authenticated','public.schedules','INSERT') as direct_schedule_insert,
      has_table_privilege('authenticated','public.schedules','DELETE') as direct_schedule_delete,
      has_any_column_privilege('authenticated','public.schedules','UPDATE') as direct_schedule_update,
      has_table_privilege('authenticated','public.schedule_templates','INSERT') as direct_template_insert,
      has_any_column_privilege('authenticated','public.schedule_templates','UPDATE') as direct_template_update,
      has_table_privilege('authenticated','public.schedule_template_shifts','INSERT') as direct_child_insert,
      has_table_privilege('authenticated','public.shifts','UPDATE') as direct_shift_update,
      position(
        'for update' in lower(pg_get_functiondef(
          'public.save_schedule_template(uuid,uuid,text)'::regprocedure
        ))
      ) > 0 and position(
        'order by shift.id' in lower(pg_get_functiondef(
          'public.save_schedule_template(uuid,uuid,text)'::regprocedure
        ))
      ) > 0 and position(
        'for share' in lower(pg_get_functiondef(
          'public.save_schedule_template(uuid,uuid,text)'::regprocedure
        ))
      ) > 0 as snapshot_lock_contract,
      position(
        'lock table public.shifts in share mode' in lower(pg_get_functiondef(
          'public.save_schedule_template(uuid,uuid,text)'::regprocedure
        ))
      ) > 0 and position(
        'lock table public.shifts in share mode' in lower(pg_get_functiondef(
          'public.save_schedule_template(uuid,uuid,text)'::regprocedure
        ))
      ) < position(
        'for update' in lower(pg_get_functiondef(
          'public.save_schedule_template(uuid,uuid,text)'::regprocedure
        ))
      ) as snapshot_table_barrier_contract,
      position(
        'order by template_shift.id' in lower(pg_get_functiondef(
          'public.create_schedule_draft(uuid,uuid,date,uuid)'::regprocedure
        ))
      ) > 0 and position(
        'for share' in lower(pg_get_functiondef(
          'public.create_schedule_draft(uuid,uuid,date,uuid)'::regprocedure
        ))
      ) > 0 as source_template_lock_contract,
      position(
        'order by shift_row.id' in lower(pg_get_functiondef(
          'public.publish_schedule(uuid,text)'::regprocedure
        ))
      ) > 0 and position(
        'for update' in lower(pg_get_functiondef(
          'public.publish_schedule(uuid,text)'::regprocedure
        ))
      ) > 0 as publish_shift_lock_contract,
      position(
        'lock table public.shifts in share mode' in lower(pg_get_functiondef(
          'public.publish_schedule(uuid,text)'::regprocedure
        ))
      ) > 0 and position(
        'lock table public.shifts in share mode' in lower(pg_get_functiondef(
          'public.publish_schedule(uuid,text)'::regprocedure
        ))
      ) < position(
        'for update' in lower(pg_get_functiondef(
          'public.publish_schedule(uuid,text)'::regprocedure
        ))
      ) as publish_table_barrier_contract,
      position(
        'order by schedule.id' in lower(pg_get_functiondef(
          'private.lock_shift_schedule_parents()'::regprocedure
        ))
      ) > 0 and position(
        'for key share' in lower(pg_get_functiondef(
          'private.lock_shift_schedule_parents()'::regprocedure
        ))
      ) > 0 and exists (
        select 1
        from pg_trigger trigger_row
        where trigger_row.tgrelid = 'public.shifts'::regclass
          and trigger_row.tgname = 'a_shift_schedule_parent_lock'
          and not trigger_row.tgisinternal
          and trigger_row.tgname < 'published_shift_guard'
      ) and position(
        'local_start_date not between parent_week_start and parent_week_start + 6'
          in lower(pg_get_functiondef(
            'private.lock_shift_schedule_parents()'::regprocedure
          ))
      ) > 0 as shift_parent_lock_contract,
      position(
        'not between result.week_start and result.week_start + 6'
          in lower(pg_get_functiondef(
            'public.publish_schedule(uuid,text)'::regprocedure
          ))
      ) > 0 as publish_week_contract
  `)).rows[0];
  assert(
    templateEvidence.templates === 1 && templateEvidence.copied_shifts === 2 &&
      templateEvidence.name_winners === 1 && templateEvidence.winner_children === 2 &&
      templateEvidence.invalid_parent === 0 && templateEvidence.failed_requests === 0 &&
      templateEvidence.stale_parent === 0 &&
      templateEvidence.completed_request === 1 && templateEvidence.template_audits === 1 &&
      templateEvidence.child_audits === 2 && templateEvidence.immutable_results === 1 &&
      !templateEvidence.direct_schedule_insert && !templateEvidence.direct_schedule_delete &&
      !templateEvidence.direct_schedule_update && !templateEvidence.direct_template_insert &&
      !templateEvidence.direct_template_update &&
      !templateEvidence.direct_child_insert && templateEvidence.direct_shift_update &&
      templateEvidence.snapshot_lock_contract &&
      templateEvidence.snapshot_table_barrier_contract &&
      templateEvidence.source_template_lock_contract &&
      templateEvidence.publish_shift_lock_contract &&
      templateEvidence.publish_table_barrier_contract &&
      templateEvidence.shift_parent_lock_contract &&
      templateEvidence.publish_week_contract,
    "Template atomicity, name, request, audit, or direct-write boundary failed",
    templateEvidence,
  );

  process.stdout.write(
    "PASS atomic schedule/template writes, immutable replay, exact manage/publish scope, DST/workforce validation, request-correlated audit, and rollback (native concurrency is a separate gate)\n",
  );
} finally {
  await db.close();
}
