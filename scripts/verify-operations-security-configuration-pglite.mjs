import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";

const root = process.cwd();
const migrationsDirectory = join(root, "supabase", "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => {
    if (!file.endsWith(".sql")) return false;
    const sequence = Number(file.slice(8, 12));
    return sequence <= 18 || sequence === 21;
  })
  .sort();
const db = new PGlite({ extensions: { pgcrypto, pg_trgm } });

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

const asAuthenticated = (userId, aal, sql) => `
  reset role;
  set role authenticated;
  select set_config(
    'request.jwt.claims',
    '{"sub":"${userId}","role":"authenticated","aal":"${aal}"}',
    false
  );
  ${sql}
`;

try {
  await db.exec(bootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }
  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));

  await db.exec(`
    insert into public.receipts (
      id, organization_id, location_id, document_number, review_status, uploaded_by
    ) values
      ('e1000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '021-A', 'pending', '10000000-0000-4000-8000-000000000004'),
      ('e1000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '021-B', 'pending', '10000000-0000-4000-8000-000000000004'),
      ('e1000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000002', '021-C', 'pending', '10000000-0000-4000-8000-000000000003'),
      ('e1000000-0000-4000-8000-000000000004', '20000000-0000-4000-8000-000000000002', '30000000-0000-4000-8000-000000000003', '021-D', 'pending', '10000000-0000-4000-8000-000000000006');
  `);
  const exactHash = "a".repeat(64);
  await db.exec(asAuthenticated("10000000-0000-4000-8000-000000000004", "aal1", `
    select public.record_receipt_fingerprint(
      'e1100000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001', '${exactHash}'
    );
    select public.record_receipt_fingerprint(
      'e1100000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001', '${exactHash}'
    );
    select public.record_receipt_fingerprint(
      'e1100000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000002', '${exactHash}'
    );
    select public.record_receipt_fingerprint(
      'e1100000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000002', '${exactHash}'
    );
  `));
  await expectDatabaseError(
    asAuthenticated("10000000-0000-4000-8000-000000000004", "aal1", `
      select public.record_receipt_fingerprint(
        'e1100000-0000-4000-8000-000000000003',
        'e1000000-0000-4000-8000-000000000003', '${exactHash}'
      );
    `),
    "42501",
    "manager cross-location fingerprint",
  );
  await db.exec(asAuthenticated("10000000-0000-4000-8000-000000000003", "aal1", `
    select public.record_receipt_fingerprint(
      'e1100000-0000-4000-8000-000000000004',
      'e1000000-0000-4000-8000-000000000003', '${exactHash}'
    );
  `));
  await expectDatabaseError(
    asAuthenticated("10000000-0000-4000-8000-000000000004", "aal1", `
      insert into public.receipt_duplicate_matches (
        organization_id, receipt_id, possible_duplicate_id, score, reasons
      ) values (
        '20000000-0000-4000-8000-000000000001',
        'e1000000-0000-4000-8000-000000000001',
        'e1000000-0000-4000-8000-000000000002', .1, '["forged"]'::jsonb
      );
    `),
    "42501",
    "forged direct duplicate evidence",
  );
  await expectDatabaseError(
    asAuthenticated("10000000-0000-4000-8000-000000000004", "aal1", `
      update public.receipts set content_hash = repeat('b', 64)
      where id = 'e1000000-0000-4000-8000-000000000001';
    `),
    "42501",
    "direct receipt fingerprint update",
  );
  await expectDatabaseError(
    asAuthenticated("10000000-0000-4000-8000-000000000004", "aal1", `
      select public.record_receipt_fingerprint(
        'e1100000-0000-4000-8000-000000000001',
        'e1000000-0000-4000-8000-000000000001', repeat('b', 64)
      );
    `),
    "23505",
    "fingerprint request payload forgery",
  );

  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    insert into public.checklist_templates (
      id, organization_id, location_id, name, checklist_type, version, is_active, created_by
    ) values
      ('e2000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '021 Photo', 'closing', 1, true, '10000000-0000-4000-8000-000000000004'),
      ('e2000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', '30000000-0000-4000-8000-000000000001', '021 Replay', 'opening', 1, true, '10000000-0000-4000-8000-000000000004');
    insert into public.checklist_template_items (
      id, organization_id, template_id, position, label, response_type, required
    ) values
      ('e2100000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 1, 'Closing image', 'photo', true),
      ('e2100000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000001', 2, 'Door locked', 'checkbox', true),
      ('e2100000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001', 'e2000000-0000-4000-8000-000000000002', 1, 'Open complete', 'checkbox', true);
    insert into public.checklist_runs (
      id, organization_id, location_id, template_id, business_date,
      status, assigned_employee_id, started_at, created_by
    ) values (
      'e2200000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000001', current_date,
      'in_progress', '50000000-0000-4000-8000-000000000005',
      clock_timestamp(), '10000000-0000-4000-8000-000000000004'
    );
    insert into storage.objects (id, bucket_id, name, owner_id) values (
      'e2300000-0000-4000-8000-000000000001', 'checklists',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/checklists/e2200000-0000-4000-8000-000000000001/e2300000-0000-4000-8000-000000000002-closing.webp',
      '10000000-0000-4000-8000-000000000005'
    );
  `);
  const photoPath = "20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/checklists/e2200000-0000-4000-8000-000000000001/e2300000-0000-4000-8000-000000000002-closing.webp";
  await expectDatabaseError(
    asAuthenticated("10000000-0000-4000-8000-000000000005", "aal1", `
      select public.record_checklist_response(
        'e2400000-0000-4000-8000-000000000001',
        'e2200000-0000-4000-8000-000000000001',
        'e2100000-0000-4000-8000-000000000001',
        '{"mime_type":"image/webp","size_bytes":128}'::jsonb,
        '${photoPath}', null
      );
    `),
    "42501",
    "direct authenticated photo binding",
  );
  await db.exec(asAuthenticated("10000000-0000-4000-8000-000000000005", "aal1", `
    select public.record_checklist_response(
      'e2400000-0000-4000-8000-000000000002',
      'e2200000-0000-4000-8000-000000000001',
      'e2100000-0000-4000-8000-000000000002',
      'true'::jsonb, null, null
    );
  `));
  await db.exec(`
    reset role;
    set role service_role;
    select set_config('request.jwt.claims', '{"role":"service_role"}', false);
    select public.bind_verified_checklist_photo_response(
      'e2400000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000005', 'aal1',
      'e2200000-0000-4000-8000-000000000001',
      'e2100000-0000-4000-8000-000000000001',
      '{"file_name":"closing.webp","mime_type":"image/webp","size_bytes":128}'::jsonb,
      '${photoPath}', null, 'image/webp', 128
    );
    select public.bind_verified_checklist_photo_response(
      'e2400000-0000-4000-8000-000000000003',
      '10000000-0000-4000-8000-000000000005', 'aal1',
      'e2200000-0000-4000-8000-000000000001',
      'e2100000-0000-4000-8000-000000000001',
      '{"file_name":"closing.webp","mime_type":"image/webp","size_bytes":128}'::jsonb,
      '${photoPath}', null, 'image/webp', 128
    );
  `);
  await expectDatabaseError(
    `reset role; set role service_role;
     select set_config('request.jwt.claims', '{"role":"service_role"}', false);
     select public.bind_verified_checklist_photo_response(
       'e2400000-0000-4000-8000-000000000004',
       '10000000-0000-4000-8000-000000000006', 'aal2',
       'e2200000-0000-4000-8000-000000000001',
       'e2100000-0000-4000-8000-000000000001',
       '{"file_name":"closing.webp","mime_type":"image/webp","size_bytes":128}'::jsonb,
       '${photoPath}', null, 'image/webp', 128
     );`,
    "42501",
    "cross-tenant verified photo actor",
  );

  await db.exec(asAuthenticated("10000000-0000-4000-8000-000000000004", "aal1", `
    select public.start_checklist_run(
      'e2500000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000002', current_date,
      '50000000-0000-4000-8000-000000000005'
    );
  `));
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    update public.checklist_templates set is_active = false
    where id = 'e2000000-0000-4000-8000-000000000002';
    update public.locations set is_active = false
    where id = '30000000-0000-4000-8000-000000000001';
  `);
  await db.exec(asAuthenticated("10000000-0000-4000-8000-000000000004", "aal1", `
    select public.start_checklist_run(
      'e2500000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'e2000000-0000-4000-8000-000000000002', current_date,
      '50000000-0000-4000-8000-000000000005'
    );
  `));
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    update public.locations set is_active = true
    where id = '30000000-0000-4000-8000-000000000001';
    insert into public.sop_documents (
      id, organization_id, location_id, title, current_version,
      is_published, requires_acknowledgement, created_by
    ) values (
      'e2600000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '021 SOP', 1, true, true, '10000000-0000-4000-8000-000000000004'
    );
    insert into public.sop_versions (
      id, organization_id, sop_document_id, version, body, created_by,
      published_by, published_at
    ) values (
      'e2610000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'e2600000-0000-4000-8000-000000000001', 1, 'First version',
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000004', clock_timestamp()
    );
  `);
  await db.exec(asAuthenticated("10000000-0000-4000-8000-000000000005", "aal1", `
    select public.acknowledge_sop(
      'e2620000-0000-4000-8000-000000000001',
      'e2610000-0000-4000-8000-000000000001'
    );
  `));
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    update public.sop_documents set current_version = 2 where id = 'e2600000-0000-4000-8000-000000000001';
    insert into public.sop_versions (
      id, organization_id, sop_document_id, version, body, created_by,
      published_by, published_at
    ) values (
      'e2610000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      'e2600000-0000-4000-8000-000000000001', 2, 'Second version',
      '10000000-0000-4000-8000-000000000004',
      '10000000-0000-4000-8000-000000000004', clock_timestamp()
    );
  `);
  await db.exec(asAuthenticated("10000000-0000-4000-8000-000000000005", "aal1", `
    select public.acknowledge_sop(
      'e2620000-0000-4000-8000-000000000001',
      'e2610000-0000-4000-8000-000000000001'
    );
  `));
  await expectDatabaseError(
    asAuthenticated("10000000-0000-4000-8000-000000000005", "aal1", `
      select public.acknowledge_sop(
        'e2620000-0000-4000-8000-000000000002',
        'e2610000-0000-4000-8000-000000000001'
      );
    `),
    "23514",
    "new request for stale SOP",
  );

  await db.exec(asAuthenticated("10000000-0000-4000-8000-000000000003", "aal1", `
    select public.create_chat_channel(
      'e3000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001', 'location',
      '30000000-0000-4000-8000-000000000002', 'Uptown',
      'Uptown service channel', '{}'::uuid[]
    );
    select public.create_chat_channel(
      'e3000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001', 'private', null,
      'Owner operators', 'Private operating room',
      array['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003']::uuid[]
    );
    select public.create_chat_channel(
      'e3000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001', 'private', null,
      'Owner operators', 'Private operating room',
      array['10000000-0000-4000-8000-000000000001', '10000000-0000-4000-8000-000000000003']::uuid[]
    );
    select public.set_private_chat_channel_members(
      'e3100000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000002',
      array['10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000004']::uuid[]
    );
    select public.set_chat_channel_archived(
      'e3200000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000002', true
    );
    select public.set_chat_channel_archived(
      'e3200000-0000-4000-8000-000000000001',
      'e3000000-0000-4000-8000-000000000002', true
    );
  `));
  await expectDatabaseError(
    asAuthenticated("10000000-0000-4000-8000-000000000003", "aal1", `
      select public.create_chat_channel(
        'e3000000-0000-4000-8000-000000000003',
        '20000000-0000-4000-8000-000000000001', 'all_staff', null,
        'Everyone', null, '{}'::uuid[]
      );
    `),
    "23505",
    "duplicate canonical channel",
  );
  await expectDatabaseError(
    asAuthenticated("10000000-0000-4000-8000-000000000003", "aal1", `
      select public.create_chat_channel(
        'e3000000-0000-4000-8000-000000000004',
        '20000000-0000-4000-8000-000000000001', 'private', null,
        'Forged tenant member', null,
        array['10000000-0000-4000-8000-000000000003', '10000000-0000-4000-8000-000000000006']::uuid[]
      );
    `),
    "23514",
    "cross-tenant private member",
  );
  await expectDatabaseError(
    asAuthenticated("10000000-0000-4000-8000-000000000003", "aal1", `
      insert into public.chat_channels (
        organization_id, kind, name, created_by
      ) values (
        '20000000-0000-4000-8000-000000000001', 'all_staff', 'Forged',
        '10000000-0000-4000-8000-000000000003'
      );
    `),
    "42501",
    "direct channel creation",
  );

  await db.exec(asAuthenticated("10000000-0000-4000-8000-000000000003", "aal1", `
    select public.save_expense_category(
      'e4000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001', null,
      'Smallwares', '6100'
    );
    select public.save_expense_category(
      'e4000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001', null,
      'Smallwares', '6100'
    );
    select public.save_expense_category(
      'e4000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001',
      'Smallwares & tools', '6100'
    );
    select public.set_expense_category_active(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001', false
    );
    select public.set_expense_category_active(
      'e4100000-0000-4000-8000-000000000001',
      'e4000000-0000-4000-8000-000000000001', false
    );
  `));
  await expectDatabaseError(
    asAuthenticated("10000000-0000-4000-8000-000000000004", "aal1", `
      select public.save_expense_category(
        'e4000000-0000-4000-8000-000000000003',
        '20000000-0000-4000-8000-000000000001', null,
        'Manager forged', null
      );
    `),
    "42501",
    "manager expense category creation",
  );
  await expectDatabaseError(
    asAuthenticated("10000000-0000-4000-8000-000000000003", "aal1", `
      insert into public.expense_categories (organization_id, name)
      values ('20000000-0000-4000-8000-000000000001', 'Direct forged');
    `),
    "42501",
    "direct expense category creation",
  );

  await db.exec(`reset role; select set_config('request.jwt.claims', '{}', false);`);
  const result = await db.query(`
    select
      (select count(*)::integer from public.receipt_duplicate_matches
       where receipt_id = 'e1000000-0000-4000-8000-000000000002'
         and possible_duplicate_id = 'e1000000-0000-4000-8000-000000000001'
         and score = 1
         and reasons = '["sha256_exact_content_match"]'::jsonb) as exact_matches,
      (select count(*)::integer from public.receipt_duplicate_matches
       where receipt_id = 'e1000000-0000-4000-8000-000000000003') as cross_location_matches,
      (select content_hash from public.receipts where id = 'e1000000-0000-4000-8000-000000000003') as cross_location_hash,
      (select count(*)::integer from private.receipt_fingerprint_requests where completed_at is not null) as fingerprint_requests,
      (select count(*)::integer from private.verified_checklist_photo_requests where completed_at is not null) as verified_photo_requests,
      (select storage_path is not null from public.checklist_responses
       where checklist_run_id = 'e2200000-0000-4000-8000-000000000001'
         and template_item_id = 'e2100000-0000-4000-8000-000000000001') as photo_bound,
      (select count(*)::integer from public.checklist_runs where id = 'e2500000-0000-4000-8000-000000000001') as replayed_runs,
      (select count(*)::integer from public.sop_acknowledgements
       where sop_version_id = 'e2610000-0000-4000-8000-000000000001') as replayed_acknowledgements,
      (select count(*)::integer from public.chat_channels where id = 'e3000000-0000-4000-8000-000000000001') as created_location_channels,
      (select is_archived from public.chat_channels where id = 'e3000000-0000-4000-8000-000000000002') as private_archived,
      (select count(*)::integer from public.chat_channel_members where channel_id = 'e3000000-0000-4000-8000-000000000002') as private_members,
      (select count(*)::integer from public.expense_categories
       where id = 'e4000000-0000-4000-8000-000000000001'
         and name = 'Smallwares & tools' and not is_active) as configured_categories,
      (select file_size_limit from storage.buckets where id = 'checklists') as checklist_limit,
      (select allowed_mime_types from storage.buckets where id = 'checklists') as checklist_mime_types,
      has_table_privilege('authenticated', 'public.receipt_duplicate_matches', 'INSERT') as duplicate_insert,
      has_column_privilege('authenticated', 'public.receipts', 'content_hash', 'UPDATE') as fingerprint_update,
      has_table_privilege('authenticated', 'public.chat_channels', 'INSERT,UPDATE,DELETE') as channel_write,
      has_table_privilege('authenticated', 'public.chat_channel_members', 'INSERT,UPDATE,DELETE') as member_write,
      has_table_privilege('authenticated', 'public.expense_categories', 'INSERT,UPDATE,DELETE') as category_write,
      has_function_privilege(
        'authenticated',
        'public.bind_verified_checklist_photo_response(uuid,uuid,text,uuid,uuid,jsonb,text,text,text,bigint)',
        'EXECUTE'
      ) as authenticated_photo_bind,
      has_function_privilege(
        'service_role',
        'public.bind_verified_checklist_photo_response(uuid,uuid,text,uuid,uuid,jsonb,text,text,text,bigint)',
        'EXECUTE'
      ) as service_photo_bind
  `);
  const checks = result.rows[0];
  if (
    checks.exact_matches !== 1
    || checks.cross_location_matches !== 0
    || checks.cross_location_hash !== exactHash
    || checks.fingerprint_requests !== 3
    || checks.verified_photo_requests !== 1
    || !checks.photo_bound
    || checks.replayed_runs !== 1
    || checks.replayed_acknowledgements !== 1
    || checks.created_location_channels !== 1
    || !checks.private_archived
    || checks.private_members !== 2
    || checks.configured_categories !== 1
    || Number(checks.checklist_limit) !== 26_214_400
    || JSON.stringify(checks.checklist_mime_types) !== JSON.stringify(["image/jpeg", "image/png", "image/webp"])
    || checks.duplicate_insert
    || checks.fingerprint_update
    || checks.channel_write
    || checks.member_write
    || checks.category_write
    || checks.authenticated_photo_bind
    || !checks.service_photo_bind
  ) {
    throw new Error(`Operations security/configuration verification failed: ${JSON.stringify(checks)}`);
  }
  process.stdout.write("PASS 021 receipt, verified-photo, replay-first, channel, category, and bucket contracts\n");
} finally {
  await db.close();
}
