import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const root = process.cwd();
const migrationsDirectory = join(root, "supabase", "migrations");
const migrationFiles = (await readdir(migrationsDirectory)).filter((file) => file.endsWith(".sql")).sort();
const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });
const ids = {
  organization: "20000000-0000-4000-8000-000000000001",
  location: "30000000-0000-4000-8000-000000000001",
  otherLocation: "30000000-0000-4000-8000-000000000002",
  admin: "10000000-0000-4000-8000-000000000003",
  manager: "10000000-0000-4000-8000-000000000004",
  employee: "10000000-0000-4000-8000-000000000005",
  managerEmployee: "50000000-0000-4000-8000-000000000004",
  employeeRecord: "50000000-0000-4000-8000-000000000005",
  role: "d1000000-0000-4000-8000-000000000001",
  availability: "d2000000-0000-4000-8000-000000000001",
  log: "d3000000-0000-4000-8000-000000000001",
  preshift: "d4000000-0000-4000-8000-000000000001",
  ack: "d5000000-0000-4000-8000-000000000001",
};

const bootstrap = `
  create schema if not exists extensions; create schema if not exists auth; create schema if not exists storage;
  do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
  create table auth.users (instance_id uuid, id uuid primary key, aud text, role text, email text unique, encrypted_password text, email_confirmed_at timestamptz, raw_app_meta_data jsonb not null default '{}'::jsonb, raw_user_meta_data jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now());
  create table auth.identities (id uuid primary key, provider_id text not null, user_id uuid not null references auth.users(id) on delete cascade, identity_data jsonb not null default '{}'::jsonb, provider text not null, last_sign_in_at timestamptz, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (provider_id, provider));
  create function auth.jwt() returns jsonb language sql stable as $$ select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb) $$;
  create function auth.uid() returns uuid language sql stable as $$ select nullif(auth.jwt() ->> 'sub', '')::uuid $$;
  create function auth.role() returns text language sql stable as $$ select coalesce(nullif(auth.jwt() ->> 'role', ''), current_user::text) $$;
  create table storage.buckets (id text primary key, name text not null unique, public boolean not null default false, file_size_limit bigint, allowed_mime_types text[]);
  create table storage.objects (id uuid primary key default gen_random_uuid(), bucket_id text not null references storage.buckets(id) on delete cascade, name text not null, owner_id text, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(), updated_at timestamptz not null default now(), unique (bucket_id, name));
  alter table storage.objects enable row level security; grant usage on schema auth, storage to authenticated; grant select on storage.buckets to authenticated; grant select, insert, update, delete on storage.objects to authenticated;
`;

async function assume(userId) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ role: "authenticated", sub: userId, aal: "aal1" })]);
}
async function expectError(action, code, label) {
  try { await action(); } catch (error) { if (code === null || error?.code === code) return; throw new Error(`${label}: ${error?.message ?? error}`); }
  throw new Error(`${label} unexpectedly succeeded`);
}

try {
  await db.exec(bootstrap);
  for (const file of migrationFiles) await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));
  await db.exec(`
    insert into public.job_roles (id, organization_id, name, code, department, default_tip_points, is_tipped)
    values ('${ids.role}', '${ids.organization}', 'FOH Manager Test', 'FOH-MGR-TEST', 'Front of house', 0, false);
    insert into public.employee_job_roles (organization_id, employee_id, job_role_id, location_id, effective_from, is_primary)
    values ('${ids.organization}', '${ids.managerEmployee}', '${ids.role}', '${ids.location}', date '2026-01-01', true);
    set role authenticated;
  `);
  await assume(ids.admin);
  for (const [index, capability] of ["service.availability.manage", "manager_log.manage", "preshift.manage"].entries()) {
    await db.query(`select public.configure_job_role_capability($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text, $6::uuid, date '2026-01-01', null::date, true)`, [
      `d1100000-0000-4000-8000-00000000000${index + 1}`, ids.organization,
      `d1200000-0000-4000-8000-00000000000${index + 1}`, ids.role, capability, ids.location,
    ]);
  }
  await assume(ids.manager);
  const availabilityArgs = [ids.availability, ids.organization, ids.location, "menu_item", "Steak frites", "eighty_sixed", 0, "Sold out", "2026-08-08T18:00:00Z", null, "Internal only"];
  await db.query("select public.record_service_availability_event($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::numeric,$8::text,$9::timestamptz,$10::timestamptz,$11::text)", availabilityArgs);
  await db.query("select public.record_service_availability_event($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::numeric,$8::text,$9::timestamptz,$10::timestamptz,$11::text)", availabilityArgs);
  await expectError(() => db.query("select public.record_service_availability_event($1::uuid,$2::uuid,$3::uuid,$4::text,$5::text,$6::text,$7::numeric,$8::text,$9::timestamptz,$10::timestamptz,$11::text)", [...availabilityArgs.slice(0, 5), "running_low", ...availabilityArgs.slice(6)]), "23505", "changed replay");
  await db.query(`select public.save_manager_log_entry($1::uuid,null::uuid,$2::uuid,$3::uuid,date '2026-08-08','dinner','foh','action_required','Guest follow-up','Call tomorrow',null,null,null,null,null,date '2026-08-09','needs_follow_up',null,null)`, [ids.log, ids.organization, ids.location]);
  await db.query(`select public.save_preshift($1::uuid,null::uuid,$2::uuid,$3::uuid,date '2026-08-08','dinner','published',null,null,null,'Tree nut allergy',null,'Steak frites 86',null,'[]'::jsonb,'Guest follow-up','Clear allergy communication','Allergy protocol',null)`, [ids.preshift, ids.organization, ids.location]);
  await expectError(() => db.query(`select public.record_service_availability_event('d2100000-0000-4000-8000-000000000001'::uuid,$1::uuid,$2::uuid,'menu_item','Wrong room','running_low',2,null,now(),null,null)`, [ids.organization, ids.otherLocation]), "42501", "cross-location availability");
  await assume(ids.employee);
  await db.query("select public.acknowledge_preshift($1::uuid,$2::uuid,null::text)", [ids.ack, ids.preshift]);
  await expectError(() => db.query(`select public.record_service_availability_event('d2200000-0000-4000-8000-000000000001'::uuid,$1::uuid,$2::uuid,'menu_item','Unauthorized','eighty_sixed',0,null,now(),null,null)`, [ids.organization, ids.location]), "42501", "employee management action");
  await db.exec("reset role; select set_config('request.jwt.claims', '{}', false)");
  const evidence = (await db.query(`select
    (select count(*)::integer from public.service_availability_events where id='${ids.availability}') as availability_count,
    (select count(*)::integer from public.manager_log_versions where manager_log_entry_id='${ids.log}') as log_versions,
    (select count(*)::integer from public.preshift_acknowledgements where id='${ids.ack}' and employee_id='${ids.employeeRecord}') as acknowledgements,
    (select count(*)::integer from public.audit_events where table_name in ('service_availability_events','manager_log_entries','preshifts','preshift_acknowledgements')) as audit_events,
    has_table_privilege('authenticated','public.service_availability_events','INSERT,UPDATE,DELETE') as direct_availability_write
  `)).rows[0];
  if (evidence.availability_count !== 1 || evidence.log_versions !== 1 || evidence.acknowledgements !== 1 || evidence.audit_events < 4 || evidence.direct_availability_write) throw new Error(`Service-control evidence failed: ${JSON.stringify(evidence)}`);
  await expectError(() => db.query(`update public.service_availability_events set notes='rewrite' where id=$1::uuid`, [ids.availability]), null, "availability history rewrite");
  process.stdout.write("PASS service availability, handoff versions, pre-shift publish/acknowledge, replay, location scope, audit, and immutable history\n");
} finally {
  await db.close();
}
