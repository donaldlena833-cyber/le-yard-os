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

async function expectDatabaseError(sql, expectedCode, label) {
  try {
    await db.exec(sql);
  } catch (error) {
    if (error && typeof error === "object" && error.code === expectedCode)
      return;
    throw new Error(
      `${label} returned an unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      {
        cause: error,
      },
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
  create publication supabase_realtime;

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
    if (file === "20260824205728_location_release_control_and_aal2.sql") {
      await db.exec(`
        insert into public.organizations (id, name, slug, timezone)
        values (
          '20000000-0000-4000-8000-000000000001',
          'Le Yard Demo',
          'le-yard-demo',
          'America/New_York'
        )
        on conflict (id) do nothing;
        insert into public.startup_workspaces (
          id, organization_id, data, updated_at
        ) values (
          'le-yard-opening',
          '20000000-0000-4000-8000-000000000001',
          $legacy_workspace$
          {
            "version": 1,
            "organizationId": "20000000-0000-4000-8000-000000000001",
            "businessName": "Le Yard",
            "targetOpeningDate": "2026-11-15",
            "updatedAt": "2026-08-24T18:00:00.000Z",
            "tasks": [],
            "milestones": [{"id":"opening","title":"Opening","date":"2026-11-15","note":"Original v1 date"}],
            "events": [{"id":"opening-event","title":"Opening day","date":"2026-11-15","kind":"opening","note":"Original v1 date"}],
            "budgetItems": [
              {
                "id":"opening-inventory","category":"Inventory","name":"Liquor / food supply",
                "planned":12000,"committed":0,"paid":0,"essential":true,"budgetRole":"opening-cost",
                "subcategories":[{"id":"opening-inventory-unallocated","name":"Unallocated","planned":10000,"committed":0,"paid":0}]
              },
              {
                "id":"8aafb99f-cc0b-4f07-82da-be28c520a4f1","category":"Legal","name":"Attorney Lease Review",
                "planned":5000,"committed":0,"paid":0,"essential":true,"budgetRole":"opening-cost",
                "subcategories":[{"id":"attorney-unallocated","name":"Unallocated","planned":0,"committed":0,"paid":0}]
              },
              {
                "id":"operating-reserve","category":"Reserve","name":"Operating reserve",
                "planned":50000,"committed":0,"paid":0,"essential":true,"flexibility":"non-negotiable",
                "minimumAmount":50000,"budgetRole":"operating-reserve",
                "subcategories":[{"id":"operating-reserve-base","name":"Protected operating cash","planned":50000,"committed":0,"paid":0}]
              }
            ],
            "financials": {
              "cashOnHand":250000,"reserveFloor":50000,"projectedMonthlySales":0,
              "grossMarginPercent":0,"startupBudgetCap":250000,"monthlyCosts":[]
            },
            "facts": [{
              "id":"opening-date","group":"opening","label":"Opening date","value":"November 15, 2026",
              "status":"confirmed","public":true,"note":"Original v1 date","source":"Founder plan"
            }]
          }
          $legacy_workspace$::jsonb,
          '2026-08-24T18:00:00.000Z'
        );
      `);
    }
    try {
      await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
      process.stdout.write(`PASS migration ${file}\n`);
    } catch (error) {
      throw new Error(
        `Migration ${file} failed: ${error instanceof Error ? error.message : String(error)}`,
        {
          cause: error,
        },
      );
    }
  }

  const runtimeContract = await db.query(`
    select
      expected.table_fingerprint = actual.value ->> 'tableFingerprint' as tables_match,
      expected.function_fingerprint = actual.value ->> 'functionFingerprint' as functions_match,
      expected.access_fingerprint = actual.value ->> 'accessFingerprint' as access_matches,
      to_regprocedure('public.search_guests(uuid,text,integer)') is null as legacy_search_removed
    from private.runtime_schema_contract_expected expected
    cross join lateral (
      select private.compute_runtime_schema_fingerprints() as value
    ) actual
    where expected.contract_version = 'runtime-schema-v2'
  `);
  const runtimeContractRow = runtimeContract.rows[0];
  if (
    runtimeContractRow?.tables_match !== true ||
    runtimeContractRow?.functions_match !== true ||
    runtimeContractRow?.access_matches !== true ||
    runtimeContractRow?.legacy_search_removed !== true
  ) {
    throw new Error(
      `Runtime schema fingerprint contract failed: ${JSON.stringify(runtimeContractRow)}`,
    );
  }
  await db.exec("begin");
  const baselineAccess = await db.query(
    "select private.compute_runtime_schema_fingerprints() ->> 'accessFingerprint' as fingerprint",
  );
  await db.exec(
    "grant execute on function public.search_receipts(uuid,text,uuid,integer) to anon",
  );
  const driftedAccess = await db.query(
    "select private.compute_runtime_schema_fingerprints() ->> 'accessFingerprint' as fingerprint",
  );
  await db.exec("rollback");
  if (
    baselineAccess.rows[0]?.fingerprint === driftedAccess.rows[0]?.fingerprint
  ) {
    throw new Error("Runtime access fingerprint did not detect deliberate grant drift.");
  }
  process.stdout.write(
    "PASS runtime schema v2 fingerprints and legacy guest-search removal\n",
  );

  const legacyMigrationEvidence = await db.query(`
    select
      workspace.revision,
      workspace.data ->> 'version' as version,
      workspace.data ->> 'targetOpeningDate' as opening_date,
      workspace.data #>> '{milestones,0,date}' as milestone_date,
      workspace.data #>> '{events,0,date}' as event_date,
      workspace.data #>> '{facts,0,value}' as fact_value,
      workspace.data #>> '{budgetItems,0,subcategories,0,planned}' as inventory_subcategory,
      workspace.data #>> '{budgetItems,1,subcategories,0,planned}' as attorney_subcategory,
      (select count(*)::integer
       from public.startup_workspace_revisions revision
       where revision.workspace_id = workspace.id) as revision_count,
      (select data #>> '{budgetItems,0,subcategories,0,planned}'
       from public.startup_workspace_revisions revision
       where revision.workspace_id = workspace.id and revision.revision = 1) as baseline_inventory,
      (select data #>> '{budgetItems,1,subcategories,0,planned}'
       from public.startup_workspace_revisions revision
       where revision.workspace_id = workspace.id and revision.revision = 1) as baseline_attorney,
      (select metadata -> 'normalizedBudgetItemIds'
       from public.audit_events event
       where event.table_name = 'startup_workspaces'
         and event.record_id = workspace.id
         and event.action = 'startup_workspace_v1_migrated'
       order by event.id desc limit 1) as normalized_ids
    from public.startup_workspaces workspace
    where workspace.id = 'le-yard-opening'
  `);
  const legacyMigration = legacyMigrationEvidence.rows[0];
  if (
    legacyMigration?.revision !== 2 ||
    legacyMigration?.version !== "2" ||
    legacyMigration?.opening_date !== "2026-12-01" ||
    legacyMigration?.milestone_date !== "2026-12-01" ||
    legacyMigration?.event_date !== "2026-12-01" ||
    legacyMigration?.fact_value !== "December 1, 2026" ||
    legacyMigration?.inventory_subcategory !== "12000" ||
    legacyMigration?.attorney_subcategory !== "5000" ||
    legacyMigration?.revision_count !== 2 ||
    legacyMigration?.baseline_inventory !== "10000" ||
    legacyMigration?.baseline_attorney !== "0" ||
    JSON.stringify(legacyMigration?.normalized_ids) !==
      JSON.stringify([
        "opening-inventory",
        "8aafb99f-cc0b-4f07-82da-be28c520a4f1",
      ])
  ) {
    throw new Error(
      `Audited Opening Room v1 migration failed: ${JSON.stringify(legacyMigration)}`,
    );
  }
  process.stdout.write(
    "PASS audited lossless Opening Room v1 baseline and deterministic v2 migration\n",
  );

  const unsafeLegacyMigration = await db.query(`
    with source as (
      select jsonb_set(
        jsonb_set(
          data,
          '{budgetItems,0,committed}',
          '100'::jsonb,
          false
        ),
        '{budgetItems,0,paid}',
        '50'::jsonb,
        false
      ) as data,
      organization_id
      from public.startup_workspace_revisions
      where workspace_id = 'le-yard-opening' and revision = 1
    ), candidate as (
      select private.startup_workspace_migrate_v1(data) as data,
             organization_id
      from source
    )
    select
      data #>> '{budgetItems,0,subcategories,0,planned}' as child_planned,
      data #>> '{budgetItems,0,subcategories,0,committed}' as child_committed,
      private.startup_workspace_contract_violations(
        data,
        organization_id
      ) as violations
    from candidate
  `);
  const unsafeLegacy = unsafeLegacyMigration.rows[0];
  if (
    unsafeLegacy?.child_planned !== "10000" ||
    unsafeLegacy?.child_committed !== "0" ||
    !unsafeLegacy?.violations?.includes("subcategory_totals")
  ) {
    throw new Error(
      `Unsafe nonzero legacy accounting mismatch was not refused: ${JSON.stringify(unsafeLegacy)}`,
    );
  }
  process.stdout.write(
    "PASS Opening Room migration refuses nonzero committed/paid mismatches\n",
  );

  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));
  process.stdout.write("PASS synthetic seed\n");

  // Production locations predate the migration. The synthetic PGlite seed is
  // intentionally loaded afterward, so reproduce the migration's fail-closed
  // location backfill before asserting the release contract.
  await db.exec(`
    insert into public.location_release_controls (
      organization_id, location_id, state, accept_reservations_from,
      public_inventory_percent, booking_approved, support_ready
    )
    select organization_id, id, 'pilot', date '2026-12-01', 25, false, false
    from public.locations
    where is_active
    on conflict (organization_id, location_id) do nothing;
  `);

  const initialRelease = await db.query(`
    select state,
           accept_reservations_from::text as accept_reservations_from,
           public_inventory_percent,
           booking_approved,
           support_ready,
           version
    from public.location_release_controls
    where organization_id = '20000000-0000-4000-8000-000000000001'
      and location_id = '30000000-0000-4000-8000-000000000001'
  `);
  const initialReleaseRow = initialRelease.rows[0];
  if (
    initialReleaseRow?.state !== "pilot" ||
    initialReleaseRow?.accept_reservations_from !== "2026-12-01" ||
    initialReleaseRow?.public_inventory_percent !== 25 ||
    initialReleaseRow?.booking_approved !== false ||
    initialReleaseRow?.support_ready !== false ||
    initialReleaseRow?.version !== 1
  ) {
    throw new Error(
      `Fail-closed location release seed failed: ${JSON.stringify(initialReleaseRow)}`,
    );
  }

  await db.exec(`
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  const aal1Authority = await db.query(`
    select public.can_manage_org(
             '20000000-0000-4000-8000-000000000001'
           ) as can_manage,
           public.is_owner_pending_mfa(
             '20000000-0000-4000-8000-000000000001'
           ) as pending_mfa,
           (select count(*)::integer from public.startup_workspaces) as visible_workspaces
  `);
  if (
    aal1Authority.rows[0]?.can_manage !== false ||
    aal1Authority.rows[0]?.pending_mfa !== true ||
    aal1Authority.rows[0]?.visible_workspaces !== 0
  ) {
    throw new Error(
      `AAL1 management barrier failed: ${JSON.stringify(aal1Authority.rows[0])}`,
    );
  }
  await expectDatabaseError(
    `select * from public.save_startup_workspace(
      'le-yard-opening', 2,
      jsonb_build_object('version', 2)
    )`,
    "42501",
    "AAL1 Opening Room save",
  );
  await expectDatabaseError(
    `select public.manage_location_release_control(
      '94000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      1, 'pilot', '2026-12-01', 25, true, true
    )`,
    "22023",
    "AAL1 release-control command",
  );
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
      false
    );
  `);
  const aal2Authority = await db.query(`
    select public.can_manage_org(
             '20000000-0000-4000-8000-000000000001'
           ) as can_manage,
           public.is_owner_pending_mfa(
             '20000000-0000-4000-8000-000000000001'
           ) as pending_mfa
  `);
  if (
    aal2Authority.rows[0]?.can_manage !== true ||
    aal2Authority.rows[0]?.pending_mfa !== false
  ) {
    throw new Error(
      `AAL2 management authority failed: ${JSON.stringify(aal2Authority.rows[0])}`,
    );
  }
  await expectDatabaseError(
    `update public.startup_workspaces
     set data = data
     where id = 'le-yard-opening'`,
    "42501",
    "direct authenticated Opening Room update",
  );
  const startupSave = await db.query(`
    select outcome, revision, data, updated_at
    from public.save_startup_workspace(
      'le-yard-opening',
      2,
      (select data || jsonb_build_object('updatedAt', '2026-08-24T20:00:00.000Z')
       from public.startup_workspaces
       where id = 'le-yard-opening')
    )
  `);
  if (
    startupSave.rows[0]?.outcome !== "saved" ||
    startupSave.rows[0]?.revision !== 3 ||
    !startupSave.rows[0]?.data ||
    !startupSave.rows[0]?.updated_at
  ) {
    throw new Error(
      `Opening Room optimistic save failed: ${JSON.stringify(startupSave.rows[0])}`,
    );
  }
  const startupConflict = await db.query(`
    select outcome, revision, data, updated_at
    from public.save_startup_workspace(
      'le-yard-opening',
      2,
      (select data from public.startup_workspaces where id = 'le-yard-opening')
    )
  `);
  const revisionEvidence = await db.query(`
    select count(*)::integer as revision_count,
           (array_agg(actor_id order by revision desc)
             filter (where actor_id is not null))[1]::text as last_actor
    from public.startup_workspace_revisions
    where workspace_id = 'le-yard-opening'
  `);
  if (
    startupConflict.rows[0]?.outcome !== "conflict" ||
    startupConflict.rows[0]?.revision !== 3 ||
    revisionEvidence.rows[0]?.revision_count !== 3 ||
    revisionEvidence.rows[0]?.last_actor !==
      "10000000-0000-4000-8000-000000000001"
  ) {
    throw new Error(
      `Opening Room conflict/history contract failed: ${JSON.stringify({ startupConflict: startupConflict.rows[0], revisionEvidence: revisionEvidence.rows[0] })}`,
    );
  }
  await expectDatabaseError(
    `select public.manage_location_release_control(
      '94000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      1, 'pilot', '2026-12-01', 20, true, true
    )`,
    "23514",
    "pilot inventory percentage constraint",
  );
  const managedRelease = await db.query(`
    select public.manage_location_release_control(
      '94000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      1, 'pilot', '2026-12-01', 25, true, true
    ) as release
  `);
  const replayedRelease = await db.query(`
    select public.manage_location_release_control(
      '94000000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      1, 'pilot', '2026-12-01', 25, true, true
    ) as release
  `);
  if (
    managedRelease.rows[0]?.release?.version !== 2 ||
    managedRelease.rows[0]?.release?.publicInventoryPercent !== 25 ||
    managedRelease.rows[0]?.release?.replayed !== false ||
    replayedRelease.rows[0]?.release?.version !== 2 ||
    replayedRelease.rows[0]?.release?.replayed !== true
  ) {
    throw new Error(
      `Release command/idempotency failed: ${JSON.stringify({ managedRelease: managedRelease.rows[0], replayedRelease: replayedRelease.rows[0] })}`,
    );
  }
  await db.exec(`reset role;`);
  const strictWorkspaceMatrix = await db.query(`
    with base as (
      select data
      from public.startup_workspaces
      where id = 'le-yard-opening'
    ), variants as (
      select 'extra_top_level_key' as name,
             data || jsonb_build_object('unexpected', true) as candidate
      from base
      union all
      select 'missing_required_field', data - 'businessName' from base
      union all
      select 'invalid_timestamp',
             jsonb_set(data, '{updatedAt}', '"2026-08-24T20:00:00"'::jsonb)
      from base
      union all
      select 'invalid_fact_enum',
             jsonb_set(data, '{facts,0,status}', '"unknown"'::jsonb)
      from base
      union all
      select 'duplicate_collection_id',
             jsonb_set(data, '{facts}', (data -> 'facts') || (data -> 'facts' -> 0))
      from base
      union all
      select 'unknown_milestone_reference',
             jsonb_set(data, '{tasks}', jsonb_build_array(jsonb_build_object(
               'id', 'licensing-task',
               'title', 'Licensing',
               'area', 'Compliance',
               'owner', 'Owner',
               'status', 'todo',
               'priority', 'now',
               'dueDate', '2026-10-01',
               'dependsOn', '[]'::jsonb,
               'milestoneId', 'missing-milestone',
               'notes', '',
               'updatedAt', '2026-08-24T20:00:00.000Z'
             )))
      from base
      union all
      select 'money_above_client_bound',
             jsonb_set(
               jsonb_set(
                 jsonb_set(data, '{budgetItems,0,planned}', '1000000001'::jsonb),
                 '{budgetItems,0,subcategories,0,planned}', '1000000001'::jsonb
               ),
               '{financials,reserveFloor}', '1000000001'::jsonb
             )
      from base
      union all
      select 'second_opening_event',
             jsonb_set(
               data,
               '{events}',
               (data -> 'events') || jsonb_build_object(
                 'id', 'second-opening',
                 'title', 'Invalid second opening',
                 'date', '2026-11-30',
                 'kind', 'opening',
                 'note', ''
               )
             )
      from base
    )
    select
      (select cardinality(
        private.startup_workspace_contract_violations(
          base.data,
          '20000000-0000-4000-8000-000000000001'
        )
      ) = 0 from base) as accepts_valid,
      count(*)::integer as variant_count,
      count(*) filter (where cardinality(
        private.startup_workspace_contract_violations(
          variants.candidate,
          '20000000-0000-4000-8000-000000000001'
        )
      ) > 0)::integer as rejected_count
    from variants
  `);
  if (
    strictWorkspaceMatrix.rows[0]?.accepts_valid !== true ||
    strictWorkspaceMatrix.rows[0]?.variant_count !== 8 ||
    strictWorkspaceMatrix.rows[0]?.rejected_count !== 8
  ) {
    throw new Error(
      `Strict Opening Room v2 negative matrix failed: ${JSON.stringify(strictWorkspaceMatrix.rows[0])}`,
    );
  }
  process.stdout.write(
    "PASS release authority, AAL2 management, and strict Opening Room optimistic contract\n",
  );

  const storageScopeChecks = await db.query(`
    select
      public.storage_path_scope_is_valid(
        '20000000-0000-4000-8000-000000000001/global/manual.pdf'
      ) as valid_global,
      public.storage_path_scope_is_valid(
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/manual.pdf'
      ) as valid_location,
      public.storage_path_scope_is_valid(
        '20000000-0000-4000-8000-000000000001/not-a-location/manual.pdf'
      ) as rejects_malformed,
      public.storage_path_scope_is_valid(
        'not-an-organization/global/manual.pdf'
      ) as rejects_malformed_organization,
      public.storage_path_scope_is_valid(
        '20000000-0000-4000-8000-000000000001/GLOBAL/manual.pdf'
      ) as rejects_noncanonical_global,
      public.storage_path_scope_is_valid(
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000003/manual.pdf'
      ) as rejects_cross_tenant_location
  `);
  const scope = storageScopeChecks.rows[0];
  if (
    !scope.valid_global ||
    !scope.valid_location ||
    scope.rejects_malformed ||
    scope.rejects_malformed_organization ||
    scope.rejects_noncanonical_global ||
    scope.rejects_cross_tenant_location
  ) {
    throw new Error(
      `Storage scope validation failed: ${JSON.stringify(scope)}`,
    );
  }

  await db.exec(`
    insert into storage.objects (id, bucket_id, name, owner_id) values
      (
        '90000000-0000-4000-8000-000000000001', 'receipts',
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/manager-local-seed.pdf',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        '90000000-0000-4000-8000-000000000002', 'receipts',
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002/manager-cross.pdf',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        '90000000-0000-4000-8000-000000000003', 'receipts',
        '20000000-0000-4000-8000-000000000001/not-a-location/manager-malformed.pdf',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        '90000000-0000-4000-8000-000000000004', 'receipts',
        '20000000-0000-4000-8000-000000000001/global/manager-global.pdf',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        '90000000-0000-4000-8000-000000000011', 'sops',
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/local-sop.pdf',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        '90000000-0000-4000-8000-000000000012', 'sops',
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002/cross-sop.pdf',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        '90000000-0000-4000-8000-000000000013', 'sops',
        '20000000-0000-4000-8000-000000000001/not-a-location/malformed-sop.pdf',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        '90000000-0000-4000-8000-000000000014', 'sops',
        '20000000-0000-4000-8000-000000000001/global/global-sop.pdf',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        '90000000-0000-4000-8000-000000000015', 'chat-attachments',
        '20000000-0000-4000-8000-000000000001/global/channels/62000000-0000-4000-8000-000000000001/seed-chat-global.txt',
        '10000000-0000-4000-8000-000000000004'
      ),
      (
        '90000000-0000-4000-8000-000000000016', 'chat-attachments',
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/channels/62000000-0000-4000-8000-000000000002/seed-chat-local.txt',
        '10000000-0000-4000-8000-000000000004'
      ),
      (
        '90000000-0000-4000-8000-000000000017', 'chat-attachments',
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002/channels/62000000-0000-4000-8000-000000000002/seed-chat-cross.txt',
        '10000000-0000-4000-8000-000000000004'
      );
    insert into public.chat_attachments (
      id, organization_id, message_id, storage_path, file_name, uploaded_by
    ) values
      (
        '91000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '63000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001/global/channels/62000000-0000-4000-8000-000000000001/seed-chat-global.txt',
        'seed-chat-global.txt', '10000000-0000-4000-8000-000000000004'
      ),
      (
        '91000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        '63000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/channels/62000000-0000-4000-8000-000000000002/seed-chat-local.txt',
        'seed-chat-local.txt', '10000000-0000-4000-8000-000000000004'
      ),
      (
        '91000000-0000-4000-8000-000000000003',
        '20000000-0000-4000-8000-000000000001',
        '63000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002/channels/62000000-0000-4000-8000-000000000002/seed-chat-cross.txt',
        'seed-chat-cross.txt', '10000000-0000-4000-8000-000000000004'
      );

    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    insert into storage.objects (id, bucket_id, name, owner_id) values (
      '90000000-0000-4000-8000-000000000005', 'receipts',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/manager-local-insert.pdf',
      '10000000-0000-4000-8000-000000000004'
    );
  `);
  await expectDatabaseError(
    `insert into storage.objects (id, bucket_id, name, owner_id) values (
      '90000000-0000-4000-8000-000000000006', 'receipts',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002/manager-cross-insert.pdf',
      '10000000-0000-4000-8000-000000000004'
    )`,
    "42501",
    "manager cross-location storage insert",
  );
  await expectDatabaseError(
    `insert into storage.objects (id, bucket_id, name, owner_id) values (
      '90000000-0000-4000-8000-000000000007', 'receipts',
      '20000000-0000-4000-8000-000000000001/not-a-location/manager-malformed-insert.pdf',
      '10000000-0000-4000-8000-000000000004'
    )`,
    "42501",
    "manager malformed-scope storage insert",
  );
  await expectDatabaseError(
    `insert into storage.objects (id, bucket_id, name, owner_id) values (
      '90000000-0000-4000-8000-000000000008', 'receipts',
      '20000000-0000-4000-8000-000000000001/global/manager-global-insert.pdf',
      '10000000-0000-4000-8000-000000000004'
    )`,
    "42501",
    "manager global storage insert",
  );
  await expectDatabaseError(
    `update storage.objects
     set name = '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002/manager-renamed-cross.pdf'
     where id = '90000000-0000-4000-8000-000000000001'`,
    "42501",
    "manager local-to-cross-location storage rename",
  );
  const managerStorageChecks = await db.query(`
    with cross_update as (
      update storage.objects set owner_id = 'manager-cannot-update'
      where id = '90000000-0000-4000-8000-000000000002'
      returning 1
    ), cross_delete as (
      delete from storage.objects
      where id = '90000000-0000-4000-8000-000000000003'
      returning 1
    )
    select
      (select count(*)::integer from cross_update) as cross_updates,
      (select count(*)::integer from cross_delete) as malformed_deletes,
      (select count(*)::integer from storage.objects where bucket_id = 'receipts') as visible_receipts
  `);
  const managerStorage = managerStorageChecks.rows[0];
  if (
    managerStorage.cross_updates !== 0 ||
    managerStorage.malformed_deletes !== 0 ||
    managerStorage.visible_receipts !== 3
  ) {
    throw new Error(
      `Manager storage isolation failed: ${JSON.stringify(managerStorage)}`,
    );
  }

  await db.exec(`
    reset role;
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  const employeeStorageReadChecks = await db.query(`
    select
      count(*) filter (where bucket_id = 'sops')::integer as visible_sops,
      count(*) filter (where bucket_id = 'chat-attachments')::integer as visible_chat_attachments
    from storage.objects
  `);
  const employeeStorageReads = employeeStorageReadChecks.rows[0];
  if (
    employeeStorageReads.visible_sops !== 2 ||
    employeeStorageReads.visible_chat_attachments !== 2
  ) {
    throw new Error(
      `Staff storage isolation failed: ${JSON.stringify(employeeStorageReads)}`,
    );
  }
  await db.exec(`
    insert into storage.objects (id, bucket_id, name, owner_id) values
      (
        '90000000-0000-4000-8000-000000000021', 'chat-attachments',
        '20000000-0000-4000-8000-000000000001/global/channels/62000000-0000-4000-8000-000000000001/chat-global.txt',
        '10000000-0000-4000-8000-000000000005'
      ),
      (
        '90000000-0000-4000-8000-000000000022', 'chat-attachments',
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/channels/62000000-0000-4000-8000-000000000002/chat-local.txt',
        '10000000-0000-4000-8000-000000000005'
      ),
      (
        '90000000-0000-4000-8000-000000000025', 'profile-avatars',
        '20000000-0000-4000-8000-000000000001/global/10000000-0000-4000-8000-000000000005.png',
        '10000000-0000-4000-8000-000000000005'
      );
    update storage.objects
    set name = '20000000-0000-4000-8000-000000000001/global/10000000-0000-4000-8000-000000000005.webp'
    where id = '90000000-0000-4000-8000-000000000025';
  `);
  await expectDatabaseError(
    `insert into storage.objects (id, bucket_id, name, owner_id) values (
      '90000000-0000-4000-8000-000000000023', 'chat-attachments',
      '20000000-0000-4000-8000-000000000001/not-a-location/channels/62000000-0000-4000-8000-000000000002/chat-malformed.txt',
      '10000000-0000-4000-8000-000000000005'
    )`,
    "42501",
    "employee malformed-scope chat insert",
  );
  await expectDatabaseError(
    `insert into storage.objects (id, bucket_id, name, owner_id) values (
      '90000000-0000-4000-8000-000000000024', 'chat-attachments',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000002/channels/62000000-0000-4000-8000-000000000002/chat-cross.txt',
      '10000000-0000-4000-8000-000000000005'
    )`,
    "42501",
    "employee cross-location chat insert",
  );
  await expectDatabaseError(
    `insert into storage.objects (id, bucket_id, name, owner_id) values (
      '90000000-0000-4000-8000-000000000026', 'profile-avatars',
      '20000000-0000-4000-8000-000000000001/not-a-location/10000000-0000-4000-8000-000000000005.png',
      '10000000-0000-4000-8000-000000000005'
    )`,
    "42501",
    "employee malformed-scope self-avatar insert",
  );

  await db.exec(`
    reset role;
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
    insert into storage.objects (id, bucket_id, name, owner_id) values (
      '90000000-0000-4000-8000-000000000031', 'receipts',
      '20000000-0000-4000-8000-000000000001/global/admin-global.pdf',
      '10000000-0000-4000-8000-000000000003'
    );
  `);
  await expectDatabaseError(
    `insert into storage.objects (id, bucket_id, name, owner_id) values (
      '90000000-0000-4000-8000-000000000032', 'receipts',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000003/admin-mismatched-location.pdf',
      '10000000-0000-4000-8000-000000000003'
    )`,
    "42501",
    "admin mismatched tenant-location storage insert",
  );
  await db.exec(`
    reset role;
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  await expectDatabaseError(
    `insert into storage.objects (id, bucket_id, name, owner_id) values (
      '90000000-0000-4000-8000-000000000033', 'receipts',
      '20000000-0000-4000-8000-000000000001/global/owner-aal1-global.pdf',
      '10000000-0000-4000-8000-000000000001'
    )`,
    "42501",
    "AAL1 owner sensitive storage insert",
  );
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
      false
    );
    insert into storage.objects (id, bucket_id, name, owner_id) values (
      '90000000-0000-4000-8000-000000000034', 'receipts',
      '20000000-0000-4000-8000-000000000001/global/owner-aal2-global.pdf',
      '10000000-0000-4000-8000-000000000001'
    );
    reset role;
  `);
  process.stdout.write(
    "PASS strict storage path, tenant/location, role, and AAL2 Owner policies\n",
  );

  // The synthetic seed is a fixed business snapshot, while the clock-in RPC
  // intentionally validates against the database clock. Add an isolated,
  // currently active published shift so the verifier stays portable over time
  // without mutating immutable seed evidence or weakening the production guard.
  await db.exec(`
    reset role;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
      false
    );
    insert into public.schedules (
      id, organization_id, location_id, week_start, status, version, created_by
    ) values (
      '6f000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      date_trunc('week', current_date)::date,
      'draft', 99,
      '10000000-0000-4000-8000-000000000001'
    );
    insert into public.shifts (
      id, organization_id, location_id, schedule_id, employee_id, job_role_id,
      starts_at, ends_at, status, is_open
    ) values (
      '6f100000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '6f000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005',
      '40000000-0000-4000-8000-000000000001',
      clock_timestamp() - interval '1 hour',
      clock_timestamp() + interval '5 hours',
      'scheduled', false
    );
    set role authenticated;
    select public.publish_schedule('6f000000-0000-4000-8000-000000000001', 'Portable clock verifier');
    reset role;
  `);

  await db.exec(`
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  await expectDatabaseError(
    `select public.record_clock_in(
      'a0000000-0000-4000-8000-000000000099',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000002',
      null
    )`,
    "23514",
    "unassigned clock-in role guard",
  );
  await db.exec(`
    select public.record_clock_in(
      'a0000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '6f100000-0000-4000-8000-000000000001'
    );
    select public.record_clock_in(
      'a0000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '40000000-0000-4000-8000-000000000001',
      '6f100000-0000-4000-8000-000000000001'
    );
    select public.start_time_break(
      'a2000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001',
      false
    );
    select public.end_time_break('a2000000-0000-4000-8000-000000000001');
    select public.end_time_break('a2000000-0000-4000-8000-000000000001');
    select public.record_clock_out('a0000000-0000-4000-8000-000000000001');
    select public.record_clock_out('a0000000-0000-4000-8000-000000000001');
  `);
  await expectDatabaseError(
    `select public.review_time_entry(
       'a1000000-0000-4000-8000-000000000099',
       'a0000000-0000-4000-8000-000000000001',
       true,
       'self review must fail'
     )`,
    "42501",
    "self-reviewed submitted time entry",
  );
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.review_time_entry(
      'a1000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001',
      true,
      'Independent punch review complete'
    );
    select public.review_time_entry(
      'a1000000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001',
      true,
      'Independent punch review complete'
    );
  `);
  const punchReviewQuery = await db.query(`
    select status::text as status, approved_by, review_note
    from public.time_entries
    where id = 'a0000000-0000-4000-8000-000000000001'
  `);
  const punchReview = punchReviewQuery.rows[0];
  if (
    punchReview.status !== "approved" ||
    punchReview.approved_by !== "10000000-0000-4000-8000-000000000004" ||
    punchReview.review_note !== "Independent punch review complete"
  ) {
    throw new Error(
      `Time-entry review evidence failed: ${JSON.stringify(punchReview)}`,
    );
  }
  process.stdout.write(
    "PASS actor-derived clock/break and independent time-review workflows\n",
  );

  await db.exec(`
    reset role;
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.publish_schedule('60000000-0000-4000-8000-000000000001', null);
    select public.publish_schedule('60000000-0000-4000-8000-000000000001', null);
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  await expectDatabaseError(
    `update public.schedules
     set week_start = week_start + 7
     where id = '60000000-0000-4000-8000-000000000001'`,
    "42501",
    "published schedule immutability",
  );
  await expectDatabaseError(
    `update public.chat_messages
     set created_at = created_at - interval '1 hour'
     where id = '63000000-0000-4000-8000-000000000001'`,
    "42501",
    "chat message immutable timestamp guard",
  );
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
      false
    );
    insert into public.shift_closeouts (
      id, organization_id, location_id, business_date, shift_label, submitted_by
    ) values (
      'a3000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      date '2026-08-01', 'guard-test',
      '10000000-0000-4000-8000-000000000001'
    );
    insert into public.closeout_attachments (
      id, organization_id, closeout_id, storage_path, file_name, uploaded_by
    ) values (
      'a3100000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'a3000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/terminal-closeout.pdf',
      'terminal-closeout.pdf',
      '10000000-0000-4000-8000-000000000001'
    );
    insert into storage.objects (id, bucket_id, name, owner_id) values (
      '90000000-0000-4000-8000-000000000041', 'closeouts',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/terminal-closeout.pdf',
      '10000000-0000-4000-8000-000000000001'
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.approve_closeout('a3000000-0000-4000-8000-000000000001', true, 'verified');
    select public.approve_closeout('a3000000-0000-4000-8000-000000000001', true, 'ignored retry');
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  await expectDatabaseError(
    `select public.approve_closeout('a3000000-0000-4000-8000-000000000001', false, null)`,
    "42501",
    "closeout terminal reversal guard",
  );
  await db.exec(`
    insert into public.receipts (
      id, organization_id, location_id, document_number, uploaded_by
    ) values (
      'a4000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'GUARD-1', '10000000-0000-4000-8000-000000000004'
    );
    insert into public.receipt_files (
      id, organization_id, receipt_id, storage_path, file_name, mime_type
    ) values (
      'a4100000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'a4000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/terminal-receipt.pdf',
      'terminal-receipt.pdf', 'application/pdf'
    );
    insert into storage.objects (id, bucket_id, name, owner_id) values (
      '90000000-0000-4000-8000-000000000042', 'receipts',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/terminal-receipt.pdf',
      '10000000-0000-4000-8000-000000000004'
    );
    select public.review_receipt(
      'a4000000-0000-4000-8000-000000000001',
      'approved',
      '{"vendor_id":"73000000-0000-4000-8000-000000000001","total_cents":1234}'::jsonb
    );
    select public.review_receipt(
      'a4000000-0000-4000-8000-000000000001',
      'approved',
      '{"vendor_id":"73000000-0000-4000-8000-000000000001","total_cents":1234}'::jsonb
    );
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    insert into public.inventory_transactions (
      id, organization_id, location_id, inventory_item_id, unit_id,
      transaction_kind, quantity_delta, unit_cost_cents, reference_type,
      reason, created_by
    ) values (
      'a4900000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000002',
      'manual_adjustment', -2, 250, 'migration_regression',
      'Canonical negative on-hand regression fixture',
      '10000000-0000-4000-8000-000000000003'
    );
    insert into public.user_capability_overrides (
      id, organization_id, user_id, capability_key, location_id,
      effect, reason, effective_from, created_by, updated_by
    ) values
      (
        'a4a00000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000004',
        'inventory.count.create',
        '30000000-0000-4000-8000-000000000001',
        'grant', 'Portable count-integrity fixture', date '2026-01-01',
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        'a4a00000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000004',
        'inventory.count.approve',
        '30000000-0000-4000-8000-000000000001',
        'grant', 'Portable self-review fixture', date '2026-01-01',
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        'a4a00000-0000-4000-8000-000000000003',
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000004',
        'inventory.purchase.create',
        '30000000-0000-4000-8000-000000000001',
        'grant', 'Portable purchase-order fixture', date '2026-01-01',
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        'a4a00000-0000-4000-8000-000000000004',
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000004',
        'inventory.receive',
        '30000000-0000-4000-8000-000000000001',
        'grant', 'Portable receiving fixture', date '2026-01-01',
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        'a4a00000-0000-4000-8000-000000000005',
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000004',
        'inventory.waste.create',
        '30000000-0000-4000-8000-000000000001',
        'grant', 'Portable waste fixture', date '2026-01-01',
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        'a4a00000-0000-4000-8000-000000000006',
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000004',
        'inventory.transfer.create',
        '30000000-0000-4000-8000-000000000001',
        'grant', 'Portable transfer fixture', date '2026-01-01',
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        'a4a00000-0000-4000-8000-000000000007',
        '20000000-0000-4000-8000-000000000001',
        '10000000-0000-4000-8000-000000000004',
        'reports.operational.view',
        '30000000-0000-4000-8000-000000000001',
        'grant', 'Portable report-export fixture', date '2020-01-01',
        '10000000-0000-4000-8000-000000000003',
        '10000000-0000-4000-8000-000000000003'
      );
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.submit_inventory_count(
      'a5000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'spot',
      'guard test',
      '[{"inventory_item_id":"72000000-0000-4000-8000-000000000001","unit_id":"70000000-0000-4000-8000-000000000002","expected_quantity":5,"counted_quantity":4.5,"unit_cost_cents":199,"notes":null}]'::jsonb
    );
    select public.submit_inventory_count(
      'a5000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'spot',
      'guard test',
      '[{"inventory_item_id":"72000000-0000-4000-8000-000000000001","unit_id":"70000000-0000-4000-8000-000000000002","expected_quantity":5,"counted_quantity":4.5,"unit_cost_cents":199,"notes":null}]'::jsonb
    );
    select public.request_report_export(
      'a6000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      null, 'labor', date '2026-07-01', date '2026-07-31', '{}'::jsonb, 'csv'
    );
    select public.request_report_export(
      'a6000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      null, 'labor', date '2026-07-01', date '2026-07-31', '{}'::jsonb, 'csv'
    );
    select public.mark_channel_read(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001'
    );
    select public.mark_channel_read(
      '62000000-0000-4000-8000-000000000001',
      '63000000-0000-4000-8000-000000000001'
    );
  `);
  await expectDatabaseError(
    `select public.request_report_export(
      'a6000000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      null, null, 'labor', null, null, '{}'::jsonb, 'csv'
    )`,
    "42501",
    "manager organization-wide report guard",
  );
  const terminalStorageChecks = await db.query(`
    with receipt_update as (
      update storage.objects set owner_id = 'terminal-receipt-tamper'
      where id = '90000000-0000-4000-8000-000000000042'
      returning 1
    ), closeout_delete as (
      delete from storage.objects
      where id = '90000000-0000-4000-8000-000000000041'
      returning 1
    )
    select
      (select count(*)::integer from receipt_update) as receipt_updates,
      (select count(*)::integer from closeout_delete) as closeout_deletes,
      public.storage_object_is_terminal_evidence(
        'receipts',
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/terminal-receipt.pdf'
      ) as receipt_is_terminal,
      public.storage_object_is_terminal_evidence(
        'closeouts',
        '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/terminal-closeout.pdf'
      ) as closeout_is_terminal
  `);
  const terminalStorage = terminalStorageChecks.rows[0];
  if (
    terminalStorage.receipt_updates !== 0 ||
    terminalStorage.closeout_deletes !== 0 ||
    !terminalStorage.receipt_is_terminal ||
    !terminalStorage.closeout_is_terminal
  ) {
    throw new Error(
      `Terminal storage evidence guard failed: ${JSON.stringify(terminalStorage)}`,
    );
  }
  await db.query("select set_config('request.jwt.claims', $1, false)", [
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
  ]);
  const workflowCounts = await db.query(`
    select
      (select count(*)::integer from public.inventory_counts where id = 'a5000000-0000-4000-8000-000000000001') as inventory_headers,
      (select count(*)::integer from public.inventory_count_lines where inventory_count_id = 'a5000000-0000-4000-8000-000000000001') as inventory_lines,
      (select count(*)::integer from public.report_runs where id = 'a6000000-0000-4000-8000-000000000001') as report_runs,
      (select count(*)::integer from public.export_jobs where id = 'a6000000-0000-4000-8000-000000000001') as export_jobs
  `);
  const workflow = workflowCounts.rows[0];
  if (
    workflow.inventory_headers !== 1 ||
    workflow.inventory_lines !== 1 ||
    workflow.report_runs !== 1 ||
    workflow.export_jobs !== 1
  ) {
    throw new Error(
      `Workflow retry verification failed: ${JSON.stringify(workflow)}`,
    );
  }
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
  ]);
  await expectDatabaseError(
    `select public.approve_inventory_count(
       'a5200000-0000-4000-8000-000000000099',
       'a5000000-0000-4000-8000-000000000001',
       true,
       'self approval must fail'
     )`,
    "42501",
    "self-approved inventory count",
  );
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.approve_inventory_count(
      'a5200000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      true,
      'Independent count review complete'
    );
    select public.approve_inventory_count(
      'a5200000-0000-4000-8000-000000000001',
      'a5000000-0000-4000-8000-000000000001',
      true,
      'Independent count review complete'
    );
  `);
  await expectDatabaseError(
    `insert into public.inventory_count_lines (
       id, organization_id, inventory_count_id, inventory_item_id, unit_id,
       expected_quantity, counted_quantity
     ) values (
       'a5100000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000001',
       'a5000000-0000-4000-8000-000000000001',
       '72000000-0000-4000-8000-000000000001',
       '70000000-0000-4000-8000-000000000001',
       1, 1
     )`,
    "42501",
    "approved inventory count line insert guard",
  );
  await expectDatabaseError(
    `insert into public.inventory_transactions (
       organization_id, location_id, inventory_item_id, unit_id,
       transaction_kind, quantity_delta, reason, created_by
     ) values (
       '20000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000001',
       '72000000-0000-4000-8000-000000000001',
       '70000000-0000-4000-8000-000000000002',
       'manual_adjustment', 1, 'forged direct ledger row',
       '10000000-0000-4000-8000-000000000003'
     )`,
    "42501",
    "direct inventory ledger DML",
  );
  const inventoryEvidenceQuery = await db.query(`
    select
      (select status::text from public.inventory_counts
       where id = 'a5000000-0000-4000-8000-000000000001') as count_status,
      (select approved_by from public.inventory_counts
       where id = 'a5000000-0000-4000-8000-000000000001') as reviewer,
      (select expected_quantity::numeric from public.inventory_count_lines
       where inventory_count_id = 'a5000000-0000-4000-8000-000000000001') as expected_quantity,
      (select unit_cost_cents::integer from public.inventory_count_lines
       where inventory_count_id = 'a5000000-0000-4000-8000-000000000001') as unit_cost_cents,
      (select count(*)::integer from public.inventory_transactions
       where reference_type = 'inventory_count'
         and reference_id = 'a5000000-0000-4000-8000-000000000001') as posting_count,
      (select quantity_delta::numeric from public.inventory_transactions
       where reference_type = 'inventory_count'
         and reference_id = 'a5000000-0000-4000-8000-000000000001') as posting_delta,
      (select quantity_on_hand::numeric from public.inventory_on_hand
       where organization_id = '20000000-0000-4000-8000-000000000001'
         and location_id = '30000000-0000-4000-8000-000000000001'
         and inventory_item_id = '72000000-0000-4000-8000-000000000001') as on_hand
  `);
  const inventoryEvidence = inventoryEvidenceQuery.rows[0];
  if (
    inventoryEvidence.count_status !== "approved" ||
    inventoryEvidence.reviewer !== "10000000-0000-4000-8000-000000000003" ||
    Number(inventoryEvidence.expected_quantity) !== -2 ||
    inventoryEvidence.unit_cost_cents !== 250 ||
    inventoryEvidence.posting_count !== 1 ||
    Number(inventoryEvidence.posting_delta) !== 6.5 ||
    Number(inventoryEvidence.on_hand) !== 4.5
  ) {
    throw new Error(
      `Inventory approval evidence failed: ${JSON.stringify(inventoryEvidence)}`,
    );
  }
  process.stdout.write(
    "PASS guarded schedule/closeout/receipt/count/chat/report transitions and retries\n",
  );

  // 009: atomic published-shift claims/reopens and swap request/offer/decision.
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    insert into public.employee_job_roles (
      id, organization_id, employee_id, job_role_id, location_id, effective_from, is_primary
    ) values (
      'b1000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      date '2026-01-01', true
    );
    insert into public.shifts (
      id, organization_id, location_id, schedule_id, employee_id, job_role_id,
      starts_at, ends_at, status, is_open
    ) values (
      'b1100000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '60000000-0000-4000-8000-000000000001',
      null,
      '40000000-0000-4000-8000-000000000001',
      '2026-08-02 16:00:00-04',
      '2026-08-02 23:00:00-04',
      'open', true
    );
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
      false
    );
  `);
  await expectDatabaseError(
    `update public.shifts
     set status = 'claimed'
     where id = 'b1100000-0000-4000-8000-000000000001'`,
    "23514",
    "noncanonical direct shift claim",
  );
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.claim_open_shift(
      'b1200000-0000-4000-8000-000000000001',
      'b1100000-0000-4000-8000-000000000001'
    );
    select public.claim_open_shift(
      'b1200000-0000-4000-8000-000000000001',
      'b1100000-0000-4000-8000-000000000001'
    );
  `);
  const claimedShift = await db.query(`
    select status::text, is_open, employee_id
    from public.shifts
    where id = 'b1100000-0000-4000-8000-000000000001'
  `);
  if (
    claimedShift.rows[0]?.status !== "claimed" ||
    claimedShift.rows[0]?.is_open !== false ||
    claimedShift.rows[0]?.employee_id !== "50000000-0000-4000-8000-000000000005"
  ) {
    throw new Error(
      `Atomic shift claim failed: ${JSON.stringify(claimedShift.rows[0])}`,
    );
  }
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.reopen_shift(
      'b1200000-0000-4000-8000-000000000002',
      'b1100000-0000-4000-8000-000000000001'
    );
    select public.reopen_shift(
      'b1200000-0000-4000-8000-000000000002',
      'b1100000-0000-4000-8000-000000000001'
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.request_shift_swap(
      'b1300000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001',
      null,
      'Need coverage for this scheduled shift'
    );
    select public.request_shift_swap(
      'b1300000-0000-4000-8000-000000000001',
      '61000000-0000-4000-8000-000000000001',
      null,
      'Need coverage for this scheduled shift'
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
  `);
  await expectDatabaseError(
    `insert into public.shift_swap_offers (
       id, organization_id, swap_request_id, offered_by_employee_id, message
     ) values (
       'b1300000-0000-4000-8000-000000000099',
       '20000000-0000-4000-8000-000000000001',
       'b1300000-0000-4000-8000-000000000001',
       '50000000-0000-4000-8000-000000000003',
       'forged direct offer'
     )`,
    "42501",
    "direct shift-swap offer DML",
  );
  await db.exec(`
    select public.offer_shift_swap(
      'b1300000-0000-4000-8000-000000000002',
      'b1300000-0000-4000-8000-000000000001',
      'I can cover this shift'
    );
    select public.offer_shift_swap(
      'b1300000-0000-4000-8000-000000000002',
      'b1300000-0000-4000-8000-000000000001',
      'I can cover this shift'
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.decide_shift_swap(
      'b1300000-0000-4000-8000-000000000003',
      'b1300000-0000-4000-8000-000000000001',
      'b1300000-0000-4000-8000-000000000002',
      true
    );
    select public.decide_shift_swap(
      'b1300000-0000-4000-8000-000000000003',
      'b1300000-0000-4000-8000-000000000001',
      'b1300000-0000-4000-8000-000000000002',
      true
    );
  `);
  const shiftWorkflow = await db.query(`
    select
      (select status::text from public.shifts where id = 'b1100000-0000-4000-8000-000000000001') as reopened_status,
      (select is_open from public.shifts where id = 'b1100000-0000-4000-8000-000000000001') as reopened_is_open,
      (select employee_id from public.shifts where id = '61000000-0000-4000-8000-000000000001') as swapped_employee_id,
      (select status::text from public.shift_swap_requests where id = 'b1300000-0000-4000-8000-000000000001') as swap_status,
      (select status::text from public.shift_swap_offers where id = 'b1300000-0000-4000-8000-000000000002') as offer_status
  `);
  const shiftResult = shiftWorkflow.rows[0];
  if (
    shiftResult.reopened_status !== "open" ||
    shiftResult.reopened_is_open !== true ||
    shiftResult.swapped_employee_id !==
      "50000000-0000-4000-8000-000000000003" ||
    shiftResult.swap_status !== "approved" ||
    shiftResult.offer_status !== "approved"
  ) {
    throw new Error(
      `Shift workflow invariant failed: ${JSON.stringify(shiftResult)}`,
    );
  }
  process.stdout.write(
    "PASS canonical shift claim/reopen and actor-bound swap workflows\n",
  );

  // 032: AAL1 management receives tenant context but no sensitive org rows.
  await db.exec(`
    reset role;
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  const ownerAal1Query = await db.query(`
    select
      (select count(*)::integer from public.organizations) as organizations,
      (select count(*)::integer from public.locations) as locations,
      (select count(*)::integer from public.organization_memberships) as organization_memberships,
      (select count(*)::integer from public.profiles) as profiles,
      (select count(*)::integer from public.employees) as employees,
      (select count(*)::integer from public.receipts) as receipts,
      (select count(*)::integer from public.tasks) as tasks,
      (select count(*)::integer from public.audit_events) as audit_events,
      (select count(*)::integer from public.user_invitations) as invitations,
      (select count(*)::integer from storage.objects) as storage_objects
  `);
  const ownerAal1 = ownerAal1Query.rows[0];
  if (
    ownerAal1.organizations !== 1 ||
    ownerAal1.locations !== 2 ||
    ownerAal1.organization_memberships < 1 ||
    ownerAal1.profiles < 5 ||
    ownerAal1.employees !== 0 ||
    ownerAal1.receipts !== 0 ||
    ownerAal1.tasks !== 0 ||
    ownerAal1.audit_events !== 0 ||
    ownerAal1.invitations !== 0 ||
    ownerAal1.storage_objects < 1
  ) {
    throw new Error(
      `AAL1 Owner sensitive-read barrier failed: ${JSON.stringify(ownerAal1)}`,
    );
  }
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
      false
    );
  `);
  const ownerAal2Query = await db.query(`
    select
      (select count(*)::integer from public.employees) as employees,
      (select count(*)::integer from public.audit_events) as audit_events,
      (select count(*)::integer from storage.objects) as storage_objects
  `);
  const ownerAal2 = ownerAal2Query.rows[0];
  if (
    ownerAal2.employees < 6 ||
    ownerAal2.audit_events < 1 ||
    ownerAal2.storage_objects < 1
  ) {
    throw new Error(
      `AAL2 Owner access failed: ${JSON.stringify(ownerAal2)}`,
    );
  }
  await db.exec(`
    select public.administer_organization_member(
      'b1400000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000002',
      'manager', 'active', array[
        '30000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000002'
      ]::uuid[],
      '30000000-0000-4000-8000-000000000002'
    );
    select public.administer_organization_member(
      'b1400000-0000-4000-8000-000000000001',
      '21000000-0000-4000-8000-000000000002',
      'manager', 'active', array[
        '30000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000002'
      ]::uuid[],
      '30000000-0000-4000-8000-000000000002'
    );
  `);
  const explicitPrimaryQuery = await db.query(`
    select
      (select count(*)::integer
       from public.location_memberships location_membership
       where location_membership.user_id = '10000000-0000-4000-8000-000000000002'
         and location_membership.is_primary) as primary_count,
      (select location_id
       from public.location_memberships location_membership
       where location_membership.user_id = '10000000-0000-4000-8000-000000000002'
         and location_membership.is_primary) as primary_location_id,
      (select home_location_id
       from public.employees employee
       where employee.user_id = '10000000-0000-4000-8000-000000000002') as home_location_id
  `);
  const explicitPrimary = explicitPrimaryQuery.rows[0];
  if (
    explicitPrimary.primary_count !== 1 ||
    explicitPrimary.primary_location_id !== '30000000-0000-4000-8000-000000000002' ||
    explicitPrimary.home_location_id !== '30000000-0000-4000-8000-000000000002'
  ) {
    throw new Error(`Explicit member primary location failed: ${JSON.stringify(explicitPrimary)}`);
  }
  await expectDatabaseError(
    `select public.administer_organization_member(
       'b1400000-0000-4000-8000-000000000003',
       '21000000-0000-4000-8000-000000000002',
       'manager', 'active',
       array['30000000-0000-4000-8000-000000000001']::uuid[],
       null
     )`,
    "23514",
    "missing explicit member primary location",
  );
  await db.exec(`
    select public.administer_organization_member(
      'b1400000-0000-4000-8000-000000000004',
      '21000000-0000-4000-8000-000000000002',
      'owner', 'active', '{}'::uuid[], null
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
  `);
  await expectDatabaseError(
    `update public.organization_memberships
     set updated_at = clock_timestamp()
     where id = '21000000-0000-4000-8000-000000000001'`,
    "42501",
    "direct membership DML",
  );
  await expectDatabaseError(
    `select public.administer_organization_member(
       'b1400000-0000-4000-8000-000000000002',
       '21000000-0000-4000-8000-000000000001',
       'owner', 'active', '{}'::uuid[], null
     )`,
    "42501",
    "admin Owner-target member command",
  );
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);
  await expectDatabaseError(
    `update public.organization_memberships
     set status = 'suspended'
     where id = '21000000-0000-4000-8000-000000000006'`,
    "23514",
    "final active Owner counter",
  );
  process.stdout.write(
    "PASS Owner AAL boundary and Owner-target membership governance\n",
  );

  // 009: employee correction requests and manager-recorded missed punches.
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    insert into public.employee_job_roles (
      id, organization_id, employee_id, job_role_id, location_id, effective_from, is_primary
    ) values (
      'b2000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000004',
      '40000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      date '2026-01-01', true
    );
    insert into public.time_entries (
      id, organization_id, location_id, employee_id, job_role_id,
      clocked_in_at, clocked_out_at, status, source, submitted_at
    ) values (
      'b2010000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000004',
      '40000000-0000-4000-8000-000000000001',
      date_trunc('hour', clock_timestamp()) - interval '4 hours',
      date_trunc('hour', clock_timestamp()) - interval '3 hours',
      'submitted', 'import', date_trunc('hour', clock_timestamp()) - interval '3 hours'
    );
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  await expectDatabaseError(
    `select public.request_time_entry_correction(
       'b2100000-0000-4000-8000-000000000099',
       'a0000000-0000-4000-8000-000000000001',
       null,
       clock_timestamp() + interval '10 minutes',
       null,
       'Future time must be rejected'
     )`,
    "22023",
    "future time correction proposal",
  );
  await db.exec(`
    select public.request_time_entry_correction(
      'b2100000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001',
      (select clocked_in_at - interval '5 minutes'
       from public.time_entries where id = 'a0000000-0000-4000-8000-000000000001'),
      null,
      null,
      'Clock in should be five minutes earlier'
    );
    select public.request_time_entry_correction(
      'b2100000-0000-4000-8000-000000000001',
      'a0000000-0000-4000-8000-000000000001',
      (select clocked_in_at - interval '5 minutes'
       from public.time_entries where id = 'a0000000-0000-4000-8000-000000000001'),
      null,
      null,
      'Clock in should be five minutes earlier'
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.request_time_entry_correction(
      'b2100000-0000-4000-8000-000000000002',
      'b2010000-0000-4000-8000-000000000001',
      date_trunc('hour', clock_timestamp()) - interval '4 hours 10 minutes',
      null,
      null,
      'Manager-owned correction separation test'
    );
  `);
  await expectDatabaseError(
    `select public.apply_time_entry_correction(
       'b2100000-0000-4000-8000-000000000002', null, null
     )`,
    "22023",
    "nullable time correction decision",
  );
  await expectDatabaseError(
    `select public.apply_time_entry_correction(
       'b2100000-0000-4000-8000-000000000002', true, 'self approval'
     )`,
    "42501",
    "self-approved time correction",
  );
  await expectDatabaseError(
    `select public.record_missed_time_entry(
       'b2200000-0000-4000-8000-000000000099',
       '30000000-0000-4000-8000-000000000001',
       '50000000-0000-4000-8000-000000000003',
       '40000000-0000-4000-8000-000000000001',
       null,
       clock_timestamp() + interval '6 minutes',
       clock_timestamp() + interval '10 minutes',
       'Future missed punch must fail'
     )`,
    "22023",
    "future manager-recorded missed punch",
  );
  await expectDatabaseError(
    `select public.record_missed_time_entry(
       'b2200000-0000-4000-8000-000000000098',
       '30000000-0000-4000-8000-000000000001',
       '50000000-0000-4000-8000-000000000004',
       '40000000-0000-4000-8000-000000000001',
       null,
       date_trunc('hour', clock_timestamp()) - interval '8 hours',
       date_trunc('hour', clock_timestamp()) - interval '7 hours',
       'Managers cannot create their own missed punch'
     )`,
    "42501",
    "manager self-recorded missed punch",
  );
  await db.exec(`
    select public.apply_time_entry_correction(
      'b2100000-0000-4000-8000-000000000001', true, 'Employee explanation verified'
    );
    select public.record_missed_time_entry(
      'b2200000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000001',
      null,
      date_trunc('hour', clock_timestamp()) - interval '6 hours',
      date_trunc('hour', clock_timestamp()) - interval '5 hours',
      'Manager verified an entirely missed punch'
    );
    select public.record_missed_time_entry(
      'b2200000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000003',
      '40000000-0000-4000-8000-000000000001',
      null,
      date_trunc('hour', clock_timestamp()) - interval '6 hours',
      date_trunc('hour', clock_timestamp()) - interval '5 hours',
      'Manager verified an entirely missed punch'
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.apply_time_entry_correction(
      'b2100000-0000-4000-8000-000000000002', true, 'Independent admin approval'
    );
  `);
  const timeWorkflowQuery = await db.query(`
    select
      (select status::text from public.time_entry_corrections where id = 'b2100000-0000-4000-8000-000000000001') as employee_correction_status,
      (select status::text from public.time_entry_corrections where id = 'b2100000-0000-4000-8000-000000000002') as manager_correction_status,
      (select status::text from public.time_entries where id = 'b2200000-0000-4000-8000-000000000001') as missed_status,
      (select source from public.time_entries where id = 'b2200000-0000-4000-8000-000000000001') as missed_source,
      (select approved_by from public.time_entries where id = 'b2200000-0000-4000-8000-000000000001') as missed_approver
  `);
  const timeWorkflow = timeWorkflowQuery.rows[0];
  if (
    timeWorkflow.employee_correction_status !== "approved" ||
    timeWorkflow.manager_correction_status !== "approved" ||
    timeWorkflow.missed_status !== "corrected" ||
    timeWorkflow.missed_source !== "manager" ||
    timeWorkflow.missed_approver !== "10000000-0000-4000-8000-000000000004"
  ) {
    throw new Error(
      `Time correction/missed-punch workflow failed: ${JSON.stringify(timeWorkflow)}`,
    );
  }
  process.stdout.write(
    "PASS bounded time corrections and independent missed-punch workflow\n",
  );

  // 009: report location is authoritative; JSON cannot smuggle scope.
  await db.exec(`
    insert into public.saved_reports (
      id, organization_id, location_id, name, report_type, filters, created_by, is_shared
    ) values (
      'b3000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'Security follow-up labor report',
      'labor',
      '{"department":"dinner"}'::jsonb,
      '10000000-0000-4000-8000-000000000003',
      true
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  const reportAuthorizationCheck = await db.query(`
    select
      auth.uid() as actor_id,
      current_date as effective_on,
      public.has_capability(
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        'reports.operational.view',
        current_date
      ) as has_operational,
      public.can_access_report_kind(
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        'labor'
      ) as can_access
  `);
  if (
    !reportAuthorizationCheck.rows[0]?.has_operational ||
    !reportAuthorizationCheck.rows[0]?.can_access
  ) {
    throw new Error(
      `Report capability fixture failed: ${JSON.stringify(reportAuthorizationCheck.rows[0])}`,
    );
  }
  await expectDatabaseError(
    `select public.request_report_export(
       'b3100000-0000-4000-8000-000000000099',
       '20000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000001',
       null,
       'labor',
       current_date - 7,
       current_date,
       '{"nested":{"location_id":"30000000-0000-4000-8000-000000000002"}}'::jsonb,
       'csv'
     )`,
    "22023",
    "nested report location filter",
  );
  await expectDatabaseError(
    `select public.request_report_export(
       'b3100000-0000-4000-8000-000000000098',
       '20000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000001',
       'b3000000-0000-4000-8000-000000000001',
       'tips',
       current_date - 7,
       current_date,
       '{}'::jsonb,
       'csv'
     )`,
    "23514",
    "saved report type mismatch",
  );
  await db.exec(`
    select public.request_report_export(
      'b3100000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'labor',
      current_date - 7,
      current_date,
      '{"department":"dinner"}'::jsonb,
      'csv'
    );
    select public.request_report_export(
      'b3100000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'b3000000-0000-4000-8000-000000000001',
      'labor',
      current_date - 7,
      current_date,
      '{"department":"dinner"}'::jsonb,
      'csv'
    );
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    insert into public.report_runs (
      id, organization_id, location_id, report_type, filters, requested_by
    ) values (
      'b3200000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      'labor', '{}'::jsonb,
      '10000000-0000-4000-8000-000000000003'
    );
    insert into public.export_jobs (
      id, organization_id, location_id, report_run_id, export_type, requested_by
    ) values (
      'b3200000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      'b3200000-0000-4000-8000-000000000001',
      'csv',
      '10000000-0000-4000-8000-000000000003'
    );
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  const reportScopeQuery = await db.query(`
    select
      (select count(*)::integer from public.report_runs where id = 'b3100000-0000-4000-8000-000000000001') as local_runs,
      (select count(*)::integer from public.export_jobs where id = 'b3100000-0000-4000-8000-000000000001') as local_exports,
      (select count(*)::integer from public.report_runs where id = 'b3200000-0000-4000-8000-000000000001') as cross_runs,
      (select count(*)::integer from public.export_jobs where id = 'b3200000-0000-4000-8000-000000000002') as cross_exports
  `);
  const reportScope = reportScopeQuery.rows[0];
  if (
    reportScope.local_runs !== 1 ||
    reportScope.local_exports !== 1 ||
    reportScope.cross_runs !== 0 ||
    reportScope.cross_exports !== 0
  ) {
    throw new Error(
      `Authoritative report scope failed: ${JSON.stringify(reportScope)}`,
    );
  }
  process.stdout.write(
    "PASS authoritative report scope and recursive filter rejection\n",
  );

  // 009: expired invitations can be safely reissued against the same Auth,
  // membership, and employee identities, then revoked idempotently.
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    insert into auth.users (
      instance_id, id, aud, role, email, email_confirmed_at,
      raw_app_meta_data, raw_user_meta_data, created_at, updated_at
    ) values (
      '00000000-0000-0000-0000-000000000000',
      'b4000000-0000-4000-8000-000000000001',
      'authenticated', 'authenticated', 'reissue@example.invalid', now(),
      '{"provider":"email","providers":["email"],"pending_organization_id":"20000000-0000-4000-8000-000000000001","pending_role":"employee","invited_by":"10000000-0000-4000-8000-000000000003"}'::jsonb,
      '{"display_name":"Reissue Employee"}'::jsonb,
      now(), now()
    );
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.provision_user_invitation(
      'b4000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'reissue@example.invalid',
      'Reissue Employee',
      'employee',
      array['30000000-0000-4000-8000-000000000001']::uuid[],
      repeat('a', 64),
      date_trunc('second', clock_timestamp()) + interval '1 hour',
      'b4100000-0000-4000-8000-000000000001'
    );
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    update public.user_invitations
    set expires_at = clock_timestamp() - interval '1 minute'
    where organization_id = '20000000-0000-4000-8000-000000000001'
      and email = 'reissue@example.invalid';
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.provision_user_invitation(
      'b4000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'reissue@example.invalid',
      'Reissue Employee',
      'employee',
      array['30000000-0000-4000-8000-000000000001']::uuid[],
      repeat('b', 64),
      date_trunc('second', clock_timestamp()) + interval '2 hours',
      'b4100000-0000-4000-8000-000000000099'
    );
  `);
  await expectDatabaseError(
    `select public.provision_user_invitation(
       'b4000000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000001',
       'reissue@example.invalid',
       'Reissue Employee',
       'employee',
       array['30000000-0000-4000-8000-000000000001']::uuid[],
       repeat('c', 64),
       date_trunc('second', clock_timestamp()) + interval '3 hours',
       'b4100000-0000-4000-8000-000000000099'
     )`,
    "23505",
    "duplicate live reissued invitation",
  );
  await db.exec(`
    select public.revoke_user_invitation(
      'b4200000-0000-4000-8000-000000000001',
      (select id from public.user_invitations
       where organization_id = '20000000-0000-4000-8000-000000000001'
         and email = 'reissue@example.invalid'
         and token_hash = repeat('b', 64))
    );
    select public.revoke_user_invitation(
      'b4200000-0000-4000-8000-000000000001',
      (select id from public.user_invitations
       where organization_id = '20000000-0000-4000-8000-000000000001'
         and email = 'reissue@example.invalid'
         and token_hash = repeat('b', 64))
    );
  `);
  const invitationReissueQuery = await db.query(`
    select
      (select count(*)::integer from public.user_invitations
       where email = 'reissue@example.invalid') as invitation_count,
      (select count(*)::integer from public.user_invitations
       where email = 'reissue@example.invalid' and revoked_at is not null) as revoked_count,
      (select count(*)::integer from public.organization_memberships
       where user_id = 'b4000000-0000-4000-8000-000000000001') as membership_count,
      (select count(*)::integer from public.employees
       where user_id = 'b4000000-0000-4000-8000-000000000001'
         and id = 'b4100000-0000-4000-8000-000000000001') as original_employee_count
  `);
  const invitationReissue = invitationReissueQuery.rows[0];
  if (
    invitationReissue.invitation_count !== 2 ||
    invitationReissue.revoked_count !== 2 ||
    invitationReissue.membership_count !== 1 ||
    invitationReissue.original_employee_count !== 1
  ) {
    throw new Error(
      `Invitation reissue lifecycle failed: ${JSON.stringify(invitationReissue)}`,
    );
  }
  process.stdout.write(
    "PASS expired invitation reissue and idempotent revocation\n",
  );

  // 009: financial maker/checker stamps cannot be forged or authored by the
  // eventual approver, and approval recalculates immutable inputs.
  await expectDatabaseError(
    `insert into public.tip_pool_policy_versions (
       id, organization_id, policy_id, version, distribution_method,
       effective_from, source_rules, created_by
     ) values (
       'b5000000-0000-4000-8000-000000000099',
       '20000000-0000-4000-8000-000000000001',
       '90000000-0000-4000-8000-000000000001',
       99, 'weighted_hours', current_date, '{}'::jsonb,
       '10000000-0000-4000-8000-000000000004'
     )`,
    "42501",
    "spoofed tip policy creator",
  );
  await db.exec(`
    select public.save_tip_pool_policy_draft(
      'b5000000-0000-4000-8000-000000000002',
      '90000000-0000-4000-8000-000000000001',
      'b5000000-0000-4000-8000-000000000001',
      'weighted_hours',
      current_date - 1,
      null,
      array['card_tips', 'cash_tips'],
      '[{
        "job_role_id":"40000000-0000-4000-8000-000000000001",
        "eligible":true,
        "points":1,
        "minimum_minutes":0
      }]'::jsonb
    );
  `);
  await expectDatabaseError(
    `select public.approve_tip_policy_version(
       'b5020000-0000-4000-8000-000000000099',
       'b5000000-0000-4000-8000-000000000001'
     )`,
    "42501",
    "self-approved tip policy version",
  );
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  await expectDatabaseError(
    `update public.tip_pool_policy_versions
     set source_rules = '{"closeout_sources":["service_charges"]}'::jsonb
     where id = 'b5000000-0000-4000-8000-000000000001'`,
    "42501",
    "approver editing policy-version body",
  );
  await expectDatabaseError(
    `update public.tip_pool_eligibility_rules
     set points = 8
     where policy_version_id = 'b5000000-0000-4000-8000-000000000001'`,
    "42501",
    "approver editing eligibility rules",
  );
  await expectDatabaseError(
    `select public.approve_tip_policy_version(
      'b5020000-0000-4000-8000-000000000098',
      'b5000000-0000-4000-8000-000000000001'
    )`,
    "42501",
    "manager approving tip policy version",
  );
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.approve_tip_policy_version(
      'b5020000-0000-4000-8000-000000000001',
      'b5000000-0000-4000-8000-000000000001'
    );
    select public.approve_tip_policy_version(
      'b5020000-0000-4000-8000-000000000001',
      'b5000000-0000-4000-8000-000000000001'
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
  `);
  await expectDatabaseError(
    `update public.tip_pool_eligibility_rules
     set points = 2
     where policy_version_id = 'b5000000-0000-4000-8000-000000000001'`,
    "42501",
    "approved policy eligibility mutation",
  );
  await expectDatabaseError(
    `insert into public.tip_runs (
       id, organization_id, location_id, policy_version_id,
       business_date, shift_label, status, distributable_cents,
       allocated_cents, approved_by, approved_at, locked_at, created_by
     ) values (
       'b5100000-0000-4000-8000-000000000099',
       '20000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000001',
       'b5000000-0000-4000-8000-000000000001',
       (clock_timestamp() at time zone 'America/New_York')::date,
       'forged', 'approved', 100, 100,
       '10000000-0000-4000-8000-000000000003', now(), now(),
       '10000000-0000-4000-8000-000000000004'
     )`,
    "42501",
    "forged approved tip run insert",
  );
  // The CI database session runs in UTC while the synthetic restaurant is in
  // America/New_York. Derive closeout business dates in the location timezone
  // so late-evening labor is not incorrectly assigned to the next UTC day.
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    insert into public.shift_closeouts (
      id, organization_id, location_id, business_date, shift_label,
      gross_sales_cents, net_sales_cents, card_tips_cents, cash_tips_cents,
      service_charges_cents, submitted_by
    ) values (
      'b5050000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      (clock_timestamp() at time zone 'America/New_York')::date,
      'security-follow-up-tip-run',
      100000, 90000, 9000, 1000, 0,
      '10000000-0000-4000-8000-000000000004'
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.approve_closeout(
      'b5050000-0000-4000-8000-000000000001', true, 'Independent source review complete'
    );
    select public.prepare_tip_run_from_closeout(
      'b5100000-0000-4000-8000-000000000001',
      'b5050000-0000-4000-8000-000000000001',
      'b5000000-0000-4000-8000-000000000001'
    );
    select public.prepare_tip_run_from_closeout(
      'b5100000-0000-4000-8000-000000000001',
      'b5050000-0000-4000-8000-000000000001',
      'b5000000-0000-4000-8000-000000000001'
    );
  `);
  await expectDatabaseError(
    `insert into public.tip_sources (
       id, organization_id, tip_run_id, source_type, label, amount_cents
     ) values (
       'b5110000-0000-4000-8000-000000000099',
       '20000000-0000-4000-8000-000000000001',
       'b5100000-0000-4000-8000-000000000001',
       'card_tips', 'forged browser source', 999999
     )`,
    "42501",
    "direct tip-source DML",
  );
  await expectDatabaseError(
    `insert into public.tip_adjustments (
       id, organization_id, tip_run_id, employee_id,
       amount_cents, reason, created_by
     ) values (
       'b5130000-0000-4000-8000-000000000099',
       '20000000-0000-4000-8000-000000000001',
       'b5100000-0000-4000-8000-000000000001',
       '50000000-0000-4000-8000-000000000005',
       100, 'spoofed maker',
       '10000000-0000-4000-8000-000000000004'
     )`,
    "42501",
    "spoofed tip-adjustment creator",
  );
  await db.exec(`
    insert into public.tip_adjustments (
      id, organization_id, tip_run_id, employee_id,
      amount_cents, reason, created_by
    ) values (
      'b5130000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'b5100000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005',
      100, 'Verified adjustment for regression',
      '10000000-0000-4000-8000-000000000003'
    );
  `);
  await expectDatabaseError(
    `select public.approve_tip_adjustment(
       'b5140000-0000-4000-8000-000000000099',
       'b5130000-0000-4000-8000-000000000001'
     )`,
    "42501",
    "self-approved tip adjustment",
  );
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  await expectDatabaseError(
    `update public.tip_adjustments
     set reason = 'Approver-authored adjustment'
     where id = 'b5130000-0000-4000-8000-000000000001'`,
    "42501",
    "approver editing a draft adjustment",
  );
  await db.exec(`
    select public.approve_tip_adjustment(
      'b5140000-0000-4000-8000-000000000001',
      'b5130000-0000-4000-8000-000000000001'
    );
    select public.approve_tip_adjustment(
      'b5140000-0000-4000-8000-000000000001',
      'b5130000-0000-4000-8000-000000000001'
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.prepare_tip_run_from_closeout(
      'b5100000-0000-4000-8000-000000000001',
      'b5050000-0000-4000-8000-000000000001',
      'b5000000-0000-4000-8000-000000000001'
    );
    select public.calculate_tip_run('b5100000-0000-4000-8000-000000000001');
  `);
  const reprepareQuery = await db.query(`
    select (public.prepare_tip_run_from_closeout(
      'b5100000-0000-4000-8000-000000000001',
      'b5050000-0000-4000-8000-000000000001',
      'b5000000-0000-4000-8000-000000000001'
    )).status::text as status
  `);
  if (reprepareQuery.rows[0].status !== "draft") {
    throw new Error(
      `Calculated tip run did not reprepare to draft: ${JSON.stringify(reprepareQuery.rows[0])}`,
    );
  }
  await db.exec(`
    select public.calculate_tip_run('b5100000-0000-4000-8000-000000000001');
  `);
  await expectDatabaseError(
    `update public.tip_runs
     set shift_label = 'tampered-after-calculation'
     where id = 'b5100000-0000-4000-8000-000000000001'`,
    "42501",
    "calculated tip-run input mutation",
  );
  await expectDatabaseError(
    `select public.approve_tip_run('b5100000-0000-4000-8000-000000000001')`,
    "42501",
    "self-approved tip run",
  );
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.approve_tip_run('b5100000-0000-4000-8000-000000000001');
    select public.approve_tip_run('b5100000-0000-4000-8000-000000000001');
  `);
  await expectDatabaseError(
    `delete from public.tip_runs
     where id = 'b5100000-0000-4000-8000-000000000001'`,
    "42501",
    "direct tip-run deletion",
  );
  const tipEvidenceQuery = await db.query(`
    select
      (select status::text from public.tip_runs where id = 'b5100000-0000-4000-8000-000000000001') as run_status,
      (select approved_by from public.tip_runs where id = 'b5100000-0000-4000-8000-000000000001') as run_approver,
      (select sum(final_amount_cents)::integer from public.tip_allocations
       where tip_run_id = 'b5100000-0000-4000-8000-000000000001') as final_amount,
      (select count(*)::integer from public.tip_run_participants
       where tip_run_id = 'b5100000-0000-4000-8000-000000000001') as participant_count,
      (select prepared_at is not null from public.tip_runs
       where id = 'b5100000-0000-4000-8000-000000000001') as was_prepared,
      (select approved_by from public.tip_adjustments where id = 'b5130000-0000-4000-8000-000000000001') as adjustment_approver,
      (select approved_by from public.tip_pool_policy_versions where id = 'b5000000-0000-4000-8000-000000000001') as policy_approver
  `);
  const tipEvidence = tipEvidenceQuery.rows[0];
  if (
    tipEvidence.run_status !== "approved" ||
    tipEvidence.run_approver !== "10000000-0000-4000-8000-000000000004" ||
    tipEvidence.final_amount !== 10000 ||
    tipEvidence.participant_count < 1 ||
    !tipEvidence.was_prepared ||
    tipEvidence.adjustment_approver !==
      "10000000-0000-4000-8000-000000000004" ||
    tipEvidence.policy_approver !== "10000000-0000-4000-8000-000000000002"
  ) {
    throw new Error(
      `Financial maker/checker evidence failed: ${JSON.stringify(tipEvidence)}`,
    );
  }

  await db.exec(`
    insert into public.shift_closeouts (
      id, organization_id, location_id, business_date, shift_label,
      gross_sales_cents, net_sales_cents, card_tips_cents, submitted_by
    ) values (
      'b5200000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      (clock_timestamp() at time zone 'America/New_York')::date,
      'maker-checker-closeout',
      100000, 90000, 0,
      '10000000-0000-4000-8000-000000000004'
    );
  `);
  await expectDatabaseError(
    `select public.approve_closeout(
       'b5200000-0000-4000-8000-000000000001', true, 'self approval'
     )`,
    "42501",
    "self-approved closeout",
  );
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
  `);
  await expectDatabaseError(
    `update public.shift_closeouts
     set card_tips_cents = 999999
     where id = 'b5200000-0000-4000-8000-000000000001'`,
    "42501",
    "reviewer editing closeout inputs",
  );
  await expectDatabaseError(
    `select public.approve_closeout(
       'b5200000-0000-4000-8000-000000000001', null, null
     )`,
    "22023",
    "nullable closeout decision",
  );
  await db.exec(`
    select public.approve_closeout(
      'b5200000-0000-4000-8000-000000000001', true, 'Independent review complete'
    );
  `);
  process.stdout.write(
    "PASS financial creator binding, recalculation, and independent approvals\n",
  );

  // 012: operational commands own actor stamps, lifecycle transitions, and
  // attachment evidence. Every exact retry returns the one durable result.
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    insert into public.checklist_templates (
      id, organization_id, location_id, name, checklist_type, created_by
    ) values (
      'c1000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'Operational smoke checklist', 'custom',
      '10000000-0000-4000-8000-000000000004'
    );
    insert into public.checklist_template_items (
      id, organization_id, template_id, position, label, response_type, required
    ) values
      (
        'c1010000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        'c1000000-0000-4000-8000-000000000001',
        0, 'Required confirmation', 'checkbox', true
      ),
      (
        'c1010000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        'c1000000-0000-4000-8000-000000000001',
        1, 'Optional photo', 'photo', false
      );
    insert into public.sop_documents (
      id, organization_id, location_id, title, current_version,
      is_published, requires_acknowledgement, created_by
    ) values (
      'c1100000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'Operational smoke SOP', 1, true, true,
      '10000000-0000-4000-8000-000000000004'
    );
    insert into public.sop_versions (
      id, organization_id, sop_document_id, version, body,
      published_by, published_at, created_by
    ) values (
      'c1110000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'c1100000-0000-4000-8000-000000000001', 1,
      'Follow the operational smoke procedure.',
      '10000000-0000-4000-8000-000000000004', clock_timestamp(),
      '10000000-0000-4000-8000-000000000004'
    );
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.start_checklist_run(
      'c1200000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', current_date,
      '50000000-0000-4000-8000-000000000005'
    );
    select public.start_checklist_run(
      'c1200000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'c1000000-0000-4000-8000-000000000001', current_date,
      '50000000-0000-4000-8000-000000000005'
    );
    insert into storage.objects (
      id, bucket_id, name, owner_id, metadata
    ) values (
      'c1230000-0000-4000-8000-000000000001', 'checklists',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/checklists/c1200000-0000-4000-8000-000000000001/photo.jpg',
      '10000000-0000-4000-8000-000000000005',
      '{"mimetype":"image/jpeg","size":"2048"}'::jsonb
    );
    select public.record_checklist_response(
      'c1210000-0000-4000-8000-000000000001',
      'c1200000-0000-4000-8000-000000000001',
      'c1010000-0000-4000-8000-000000000001',
      'true'::jsonb, null, 'Confirmed'
    );
    select public.record_checklist_response(
      'c1210000-0000-4000-8000-000000000001',
      'c1200000-0000-4000-8000-000000000001',
      'c1010000-0000-4000-8000-000000000001',
      'true'::jsonb, null, 'Confirmed'
    );
    reset role;
    set role service_role;
    select set_config('request.jwt.claims', '{"role":"service_role"}', false);
    select public.bind_verified_checklist_photo_response(
      'c1210000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000005', 'aal1',
      'c1200000-0000-4000-8000-000000000001',
      'c1010000-0000-4000-8000-000000000002',
      '{"file_name":"photo.jpg","mime_type":"image/jpeg","size_bytes":2048}'::jsonb,
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/checklists/c1200000-0000-4000-8000-000000000001/photo.jpg',
      null, 'image/jpeg', 2048
    );
    select public.bind_verified_checklist_photo_response(
      'c1210000-0000-4000-8000-000000000002',
      '10000000-0000-4000-8000-000000000005', 'aal1',
      'c1200000-0000-4000-8000-000000000001',
      'c1010000-0000-4000-8000-000000000002',
      '{"file_name":"photo.jpg","mime_type":"image/jpeg","size_bytes":2048}'::jsonb,
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/checklists/c1200000-0000-4000-8000-000000000001/photo.jpg',
      null, 'image/jpeg', 2048
    );
    reset role;
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.complete_checklist_run(
      'c1220000-0000-4000-8000-000000000001',
      'c1200000-0000-4000-8000-000000000001', 'Complete'
    );
    select public.complete_checklist_run(
      'c1220000-0000-4000-8000-000000000001',
      'c1200000-0000-4000-8000-000000000001', 'Complete'
    );
    select public.acknowledge_sop(
      'c1300000-0000-4000-8000-000000000001',
      'c1110000-0000-4000-8000-000000000001'
    );
    select public.acknowledge_sop(
      'c1300000-0000-4000-8000-000000000001',
      'c1110000-0000-4000-8000-000000000001'
    );
    select public.create_maintenance_request(
      'c1400000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'Leaking fixture', 'Water is dripping slowly.', 'plumbing', 'normal',
      null, null, null
    );
    select public.create_incident(
      'c1500000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'safety', 'low', 'Operational smoke incident.', clock_timestamp(),
      array['50000000-0000-4000-8000-000000000005']::uuid[], null
    );
    insert into storage.objects (
      id, bucket_id, name, owner_id, metadata
    ) values (
      'c1530000-0000-4000-8000-000000000001', 'incidents',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/incidents/c1500000-0000-4000-8000-000000000001/evidence.jpg',
      '10000000-0000-4000-8000-000000000005',
      '{"mimetype":"image/jpeg","size":"4096"}'::jsonb
    );
    insert into public.incident_attachments (
      id, organization_id, incident_id, storage_path, file_name,
      mime_type, uploaded_by
    ) values (
      'c1540000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'c1500000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/incidents/c1500000-0000-4000-8000-000000000001/evidence.jpg',
      'evidence.jpg', 'image/jpeg',
      '10000000-0000-4000-8000-000000000003'
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.create_task(
      'c1600000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'Operational smoke task', 'Verify assignment notification.', 'high',
      '50000000-0000-4000-8000-000000000005', null
    );
    select public.create_task(
      'c1600000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'Operational smoke task', 'Verify assignment notification.', 'high',
      '50000000-0000-4000-8000-000000000005', null
    );
  `);
  await db.exec(`
    select public.transition_task(
      'c1610000-0000-4000-8000-000000000001',
      'c1600000-0000-4000-8000-000000000001', 'in_progress', 'Started'
    );
    select public.transition_task(
      'c1610000-0000-4000-8000-000000000001',
      'c1600000-0000-4000-8000-000000000001', 'in_progress', 'Started'
    );
    select public.set_maintenance_status(
      'c1410000-0000-4000-8000-000000000001',
      'c1400000-0000-4000-8000-000000000001', 'in_progress',
      'Internal maintenance', null, 1000, null, null, 'Assigned'
    );
    select public.set_maintenance_status(
      'c1420000-0000-4000-8000-000000000001',
      'c1400000-0000-4000-8000-000000000001', 'completed',
      null, null, null, 1200, null, 'Resolved'
    );
    select public.set_maintenance_status(
      'c1420000-0000-4000-8000-000000000001',
      'c1400000-0000-4000-8000-000000000001', 'completed',
      null, null, null, 1200, null, 'Resolved'
    );
    select public.set_incident_status(
      'c1510000-0000-4000-8000-000000000001',
      'c1500000-0000-4000-8000-000000000001', 'investigating', 'Reviewing'
    );
    select public.set_incident_status(
      'c1520000-0000-4000-8000-000000000001',
      'c1500000-0000-4000-8000-000000000001', 'closed', 'Closed safely'
    );
    select public.set_incident_status(
      'c1520000-0000-4000-8000-000000000001',
      'c1500000-0000-4000-8000-000000000001', 'closed', 'Closed safely'
    );
  `);
  await expectDatabaseError(
    `update public.tasks set title = 'tampered' where id = 'c1600000-0000-4000-8000-000000000001'`,
    "42501",
    "direct task lifecycle mutation",
  );
  await expectDatabaseError(
    `update public.checklist_responses set notes = 'tampered'
     where id = 'c1210000-0000-4000-8000-000000000001'`,
    "42501",
    "terminal checklist response mutation",
  );
  await expectDatabaseError(
    `update public.sop_acknowledgements set acknowledged_at = clock_timestamp()
     where id = 'c1300000-0000-4000-8000-000000000001'`,
    "42501",
    "SOP acknowledgement mutation",
  );
  const operationEvidenceQuery = await db.query(`
    with checklist_storage_delete as (
      delete from storage.objects
      where id = 'c1230000-0000-4000-8000-000000000001'
      returning 1
    ), incident_storage_delete as (
      delete from storage.objects
      where id = 'c1530000-0000-4000-8000-000000000001'
      returning 1
    )
    select
      (select count(*)::integer from public.checklist_runs
       where id = 'c1200000-0000-4000-8000-000000000001') as checklist_runs,
      (select status::text from public.checklist_runs
       where id = 'c1200000-0000-4000-8000-000000000001') as checklist_status,
      (select count(*)::integer from public.checklist_responses
       where checklist_run_id = 'c1200000-0000-4000-8000-000000000001') as checklist_responses,
      (select count(*)::integer from public.sop_acknowledgements
       where id = 'c1300000-0000-4000-8000-000000000001') as sop_acknowledgements,
      (select status::text from public.maintenance_requests
       where id = 'c1400000-0000-4000-8000-000000000001') as maintenance_status,
      (select assigned_to from public.maintenance_requests
       where id = 'c1400000-0000-4000-8000-000000000001') as maintenance_assignee,
      (select actual_cost_cents::integer from public.maintenance_requests
       where id = 'c1400000-0000-4000-8000-000000000001') as maintenance_cost,
      (select status from public.incidents
       where id = 'c1500000-0000-4000-8000-000000000001') as incident_status,
      (select uploaded_by from public.incident_attachments
       where id = 'c1540000-0000-4000-8000-000000000001') as attachment_actor,
      (select count(*)::integer from checklist_storage_delete) as checklist_storage_deletes,
      (select count(*)::integer from incident_storage_delete) as incident_storage_deletes
  `);
  const operationEvidence = operationEvidenceQuery.rows[0];
  if (
    operationEvidence.checklist_runs !== 1 ||
    operationEvidence.checklist_status !== "completed" ||
    operationEvidence.checklist_responses !== 2 ||
    operationEvidence.sop_acknowledgements !== 1 ||
    operationEvidence.maintenance_status !== "completed" ||
    operationEvidence.maintenance_assignee !== "Internal maintenance" ||
    operationEvidence.maintenance_cost !== 1200 ||
    operationEvidence.incident_status !== "closed" ||
    operationEvidence.attachment_actor !==
      "10000000-0000-4000-8000-000000000005" ||
    operationEvidence.checklist_storage_deletes !== 0 ||
    operationEvidence.incident_storage_deletes !== 0
  ) {
    throw new Error(
      `Operational command evidence failed: ${JSON.stringify(operationEvidence)}`,
    );
  }
  process.stdout.write(
    "PASS idempotent tasks, checklists, SOPs, maintenance, incidents, and protected attachments\n",
  );

  // 013: human-entered CRM fields flow through validated commands while
  // notes, consent, contacts, and merge provenance remain durable evidence.
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    insert into public.guest_tags (
      id, organization_id, name, color
    ) values (
      'c2000000-0000-4000-8000-000000000099',
      '20000000-0000-4000-8000-000000000001',
      'CRM smoke tag', '#3355AA'
    );
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.service_save_guest(
      'c2000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001', null,
      'Source', 'Guest', 'Source Guest', 'source@example.invalid', null,
      date '1990-01-01', false, 'Window', null, 'Source profile'
    );
    select public.service_save_guest(
      'c2000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001', null,
      'Source', 'Guest', 'Source Guest', 'source@example.invalid', null,
      date '1990-01-01', false, 'Window', null, 'Source profile'
    );
    select public.service_save_guest(
      'c2010000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001', null,
      'Target', 'Guest', 'Target Guest', 'target@example.invalid', null,
      date '1988-02-02', true, null, 'Shellfish', null
    );
    set role service_role;
    select public.save_guest_contact(
      'c2100000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000001', null,
      'email', 'Personal', 'source@example.invalid', true
    );
    select public.save_guest_contact(
      'c2110000-0000-4000-8000-000000000001',
      'c2010000-0000-4000-8000-000000000001', null,
      'email', 'Primary', 'target@example.invalid', true
    );
    set role authenticated;
    select public.service_add_guest_note(
      'c2200000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'Prefers a quiet corner.', false
    );
    select public.service_record_guest_consent(
      'c2210000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000001',
      'email', 'granted', 'Recorded in person.'
    );
    set role service_role;
    select public.assign_guest_tag(
      'c2310000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000099'
    );
    select public.assign_guest_tag(
      'c2320000-0000-4000-8000-000000000001',
      'c2010000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000099'
    );
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    update public.guest_contacts
    set verified_at = clock_timestamp()
    where id = 'c2100000-0000-4000-8000-000000000001';
    insert into public.guest_locations (
      id, organization_id, guest_id, location_id, is_home_location,
      first_visit_at, last_visit_at, visit_count, spend_cents
    ) values
      (
        'c2330000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        'c2000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001', true,
        clock_timestamp() - interval '30 days', clock_timestamp() - interval '10 days',
        2, 1000
      ),
      (
        'c2330000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        'c2010000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001', false,
        clock_timestamp() - interval '20 days', clock_timestamp() - interval '1 day',
        3, 2000
      )
    on conflict (guest_id, location_id) do update set
      is_home_location = excluded.is_home_location,
      first_visit_at = excluded.first_visit_at,
      last_visit_at = excluded.last_visit_at,
      visit_count = excluded.visit_count,
      spend_cents = excluded.spend_cents;
    insert into public.incidents (
      id, organization_id, location_id, incident_type, occurred_at,
      description, severity, status, reported_by, involved_employee_ids,
      guest_id, follow_up, resolved_by, resolved_at
    ) values (
      'c2340000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'guest_safety', clock_timestamp() - interval '1 day',
      'Closed historical CRM merge fixture.', 'low', 'closed',
      '10000000-0000-4000-8000-000000000004', '{}'::uuid[],
      'c2000000-0000-4000-8000-000000000001', 'Resolved',
      '10000000-0000-4000-8000-000000000004', clock_timestamp()
    );
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
    set role service_role;
    select public.save_guest_contact(
      'c2130000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000001',
      'c2100000-0000-4000-8000-000000000001',
      'email', 'Updated', 'source-updated@example.invalid', true
    );
    set role authenticated;
    select public.service_merge_guests(
      'c2400000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000001',
      'c2010000-0000-4000-8000-000000000001',
      0.98, '["same-party-confirmation"]'::jsonb
    );
    select public.service_merge_guests(
      'c2400000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'c2000000-0000-4000-8000-000000000001',
      'c2010000-0000-4000-8000-000000000001',
      0.98, '["same-party-confirmation"]'::jsonb
    );
  `);
  await expectDatabaseError(
    `select public.service_save_guest(
       'c2020000-0000-4000-8000-000000000001',
       '20000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000001', null,
       null, null, 'Future Guest', null, null,
       current_date + 1, false, null, null, null
     )`,
    "22023",
    "future guest birthday",
  );
  await expectDatabaseError(
    `update public.guests set display_name = ''
     where id = 'c2010000-0000-4000-8000-000000000001'`,
    "42501",
    "direct guest profile mutation",
  );
  await expectDatabaseError(
    `update public.guest_contacts set verified_at = clock_timestamp()
     where id = 'c2100000-0000-4000-8000-000000000001'`,
    "42501",
    "direct guest contact verification mutation",
  );
  await expectDatabaseError(
    `update public.guest_notes set note = 'tampered'
     where id = 'c2200000-0000-4000-8000-000000000001'`,
    "42501",
    "append-only guest note mutation",
  );
  await expectDatabaseError(
    `insert into public.guest_visits (
       organization_id, location_id, guest_id, visited_at, spend_cents, source
     ) values (
       '20000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000001',
       'c2010000-0000-4000-8000-000000000001',
       clock_timestamp(), 999999, 'manual'
     )`,
    "42501",
    "direct guest visit/spend evidence insert",
  );
  await expectDatabaseError(
    `insert into public.reservations (
       organization_id, location_id, guest_id, reserved_at,
       party_size, status, source, external_id
     ) values (
       '20000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000001',
       'c2010000-0000-4000-8000-000000000001',
       clock_timestamp(), 2, 'confirmed', 'manual', 'forged-reservation'
     )`,
    "42501",
    "direct reservation evidence insert",
  );
  await expectDatabaseError(
    `select public.service_save_guest(
       'c2020000-0000-4000-8000-000000000002',
       '20000000-0000-4000-8000-000000000002',
       '30000000-0000-4000-8000-000000000003', null,
       null, null, 'Cross tenant guest', null, null,
       null, false, null, null, null
     )`,
    "42501",
    "cross-tenant guest command",
  );
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);
  const crmEvidenceQuery = await db.query(`
    select
      (select merged_into_id from public.guests
       where id = 'c2000000-0000-4000-8000-000000000001') as merged_into_id,
      (select count(*)::integer from public.guest_merge_events
       where id = 'c2400000-0000-4000-8000-000000000001') as merge_events,
      (select visit_count::integer from public.guest_locations
       where guest_id = 'c2010000-0000-4000-8000-000000000001'
         and location_id = '30000000-0000-4000-8000-000000000001') as location_visits,
      (select spend_cents::integer from public.guest_locations
       where guest_id = 'c2010000-0000-4000-8000-000000000001'
         and location_id = '30000000-0000-4000-8000-000000000001') as location_spend,
      (select count(*)::integer from public.guest_contacts
       where guest_id = 'c2010000-0000-4000-8000-000000000001'
         and contact_type = 'email') as email_contacts,
      (select count(*)::integer from public.guest_contacts
       where guest_id = 'c2010000-0000-4000-8000-000000000001'
         and contact_type = 'email' and is_primary) as primary_emails,
      (select verified_at is null from public.guest_contacts
       where id = 'c2100000-0000-4000-8000-000000000001') as manual_edit_cleared_verification,
      (select count(*)::integer from public.guest_tag_assignments
       where guest_id = 'c2010000-0000-4000-8000-000000000001'
         and tag_id = 'c2000000-0000-4000-8000-000000000099') as tag_assignments,
      (select count(*)::integer from public.guest_notes
       where guest_id = 'c2010000-0000-4000-8000-000000000001') as notes,
      (select count(*)::integer from public.guest_consents
       where guest_id = 'c2010000-0000-4000-8000-000000000001') as consents,
      (select guest_id from public.incidents
       where id = 'c2340000-0000-4000-8000-000000000001') as closed_incident_guest
  `);
  const crmEvidence = crmEvidenceQuery.rows[0];
  if (
    crmEvidence.merged_into_id !== "c2010000-0000-4000-8000-000000000001" ||
    crmEvidence.merge_events !== 1 ||
    crmEvidence.location_visits !== 5 ||
    crmEvidence.location_spend !== 3000 ||
    crmEvidence.email_contacts !== 2 ||
    crmEvidence.primary_emails !== 1 ||
    !crmEvidence.manual_edit_cleared_verification ||
    crmEvidence.tag_assignments !== 1 ||
    crmEvidence.notes !== 1 ||
    crmEvidence.consents !== 1 ||
    crmEvidence.closed_incident_guest !== "c2010000-0000-4000-8000-000000000001"
  ) {
    throw new Error(
      `CRM merge evidence failed: ${JSON.stringify(crmEvidence)}`,
    );
  }
  process.stdout.write(
    "PASS validated CRM commands, append-only evidence, and closed-incident-safe guest merging\n",
  );

  // 014: trusted CSV/import queues and retries are actor-, tenant-, file-,
  // declaration-, and idempotency-bound. Browser DML cannot bypass commands.
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    insert into storage.objects (
      id, bucket_id, name, owner_id, metadata
    ) values (
      'd0100000-0000-4000-8000-000000000001', 'imports',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/imports/d0110000-0000-4000-8000-000000000001/d0120000-0000-4000-8000-000000000001-sales.csv',
      '10000000-0000-4000-8000-000000000003',
      '{"mimetype":"text/csv","size":"128"}'::jsonb
    );
    insert into public.integration_connections (
      id, organization_id, location_id, provider, display_name,
      adapter_version, status, created_by
    ) values
      (
        'd0200000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        'toast', 'Toast test adapter', 'test-v1', 'connected',
        '10000000-0000-4000-8000-000000000003'
      ),
      (
        'd0200000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000002',
        '30000000-0000-4000-8000-000000000003',
        'resy', 'Other tenant Resy adapter', 'test-v1', 'connected',
        '10000000-0000-4000-8000-000000000006'
      );
    insert into public.integration_sync_jobs (
      id, organization_id, connection_id, direction, resource_type,
      status, attempts, max_attempts, error_message, started_at, completed_at
    ) values
      (
        'd0210000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        'd0200000-0000-4000-8000-000000000001',
        'import', 'orders', 'failed', 1, 3, 'Synthetic upstream failure',
        clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '1 minute'
      ),
      (
        'd0210000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000002',
        'd0200000-0000-4000-8000-000000000002',
        'import', 'reservations', 'failed', 1, 3, 'Other tenant failure',
        clock_timestamp() - interval '2 minutes', clock_timestamp() - interval '1 minute'
      );
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.create_manual_csv_import(
      'd0110000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'toast_sales', 'sales.csv',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/imports/d0110000-0000-4000-8000-000000000001/d0120000-0000-4000-8000-000000000001-sales.csv',
      repeat('a', 64), 2, array['business_date', 'net_sales']::text[],
      '{"validation_version":"manual-csv-v1","columns":{"business_date":"business_date","net_sales":"net_sales"}}'::jsonb
    );
    select public.create_manual_csv_import(
      'd0110000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'toast_sales', 'sales.csv',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/imports/d0110000-0000-4000-8000-000000000001/d0120000-0000-4000-8000-000000000001-sales.csv',
      repeat('a', 64), 2, array['business_date', 'net_sales']::text[],
      '{"validation_version":"manual-csv-v1","columns":{"business_date":"business_date","net_sales":"net_sales"}}'::jsonb
    );
    select public.retry_integration_sync_job(
      'd0220000-0000-4000-8000-000000000001',
      'd0210000-0000-4000-8000-000000000001'
    );
    select public.retry_integration_sync_job(
      'd0220000-0000-4000-8000-000000000001',
      'd0210000-0000-4000-8000-000000000001'
    );
  `);
  await expectDatabaseError(
    `update public.import_jobs set successful_rows = 2
     where id = 'd0110000-0000-4000-8000-000000000001'`,
    "42501",
    "direct import job DML",
  );
  await expectDatabaseError(
    `select public.create_manual_csv_import(
       'd0110000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000001',
       'toast_sales', 'sales.csv',
       '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/imports/d0110000-0000-4000-8000-000000000001/d0120000-0000-4000-8000-000000000001-sales.csv',
       repeat('a', 64), 3, array['business_date', 'net_sales']::text[],
       '{"validation_version":"manual-csv-v1","columns":{"business_date":"business_date","net_sales":"net_sales"}}'::jsonb
     )`,
    "23505",
    "manual import request id reuse",
  );
  await expectDatabaseError(
    `select public.retry_integration_sync_job(
       'd0220000-0000-4000-8000-000000000002',
       'd0210000-0000-4000-8000-000000000002'
     )`,
    "42501",
    "cross-tenant integration retry",
  );
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  await expectDatabaseError(
    `select public.create_manual_csv_import(
       'd0110000-0000-4000-8000-000000000002',
       '30000000-0000-4000-8000-000000000001',
       'toast_sales', 'sales.csv',
       '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/imports/d0110000-0000-4000-8000-000000000001/d0120000-0000-4000-8000-000000000001-sales.csv',
       repeat('a', 64), 2, array['business_date', 'net_sales']::text[],
       '{"validation_version":"manual-csv-v1","columns":{"business_date":"business_date","net_sales":"net_sales"}}'::jsonb
     )`,
    "42501",
    "manager manual import command",
  );
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);
  const integrationEvidenceQuery = await db.query(`
    select
      (select count(*)::integer from public.import_jobs
       where id = 'd0110000-0000-4000-8000-000000000001') as import_jobs,
      (select requested_by from public.import_jobs
       where id = 'd0110000-0000-4000-8000-000000000001') as import_actor,
      (select declared_total_rows from public.import_jobs
       where id = 'd0110000-0000-4000-8000-000000000001') as declared_rows,
      (select count(*)::integer from public.integration_sync_jobs
       where id = 'd0220000-0000-4000-8000-000000000001') as retry_jobs,
      (select attempts from public.integration_sync_jobs
       where id = 'd0220000-0000-4000-8000-000000000001') as retry_attempt,
      (select retry_of_id from public.integration_sync_jobs
       where id = 'd0220000-0000-4000-8000-000000000001') as retry_of,
      (select requested_by from public.integration_sync_jobs
       where id = 'd0220000-0000-4000-8000-000000000001') as retry_actor,
      (select count(*)::integer from public.integration_events
       where metadata ->> 'import_job_id' = 'd0110000-0000-4000-8000-000000000001') as import_events,
      (select count(*)::integer from public.integration_events
       where metadata ->> 'retry_sync_job_id' = 'd0220000-0000-4000-8000-000000000001') as retry_events
  `);
  const integrationEvidence = integrationEvidenceQuery.rows[0];
  if (
    integrationEvidence.import_jobs !== 1 ||
    integrationEvidence.import_actor !==
      "10000000-0000-4000-8000-000000000003" ||
    integrationEvidence.declared_rows !== 2 ||
    integrationEvidence.retry_jobs !== 1 ||
    integrationEvidence.retry_attempt !== 2 ||
    integrationEvidence.retry_of !== "d0210000-0000-4000-8000-000000000001" ||
    integrationEvidence.retry_actor !==
      "10000000-0000-4000-8000-000000000003" ||
    integrationEvidence.import_events !== 1 ||
    integrationEvidence.retry_events !== 1
  ) {
    throw new Error(
      `Integration command evidence failed: ${JSON.stringify(integrationEvidence)}`,
    );
  }
  process.stdout.write(
    "PASS tenant-bound manual imports and exact-idempotent integration retries\n",
  );

  // Phase 2: the worker claims the queued retry itself instead of rejecting it,
  // and an expired running lease is terminalized before a linked retry starts.
  await db.exec(`
    reset role;
    insert into public.integration_sync_jobs (
      id, organization_id, connection_id, direction, resource_type,
      status, attempts, max_attempts, requested_by, started_at,
      lease_expires_at
    ) values (
      'd0230000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'd0200000-0000-4000-8000-000000000001',
      'import', 'time_entries', 'running', 1, 5,
      '10000000-0000-4000-8000-000000000003',
      clock_timestamp() - interval '20 minutes',
      clock_timestamp() - interval '5 minutes'
    );
    set role service_role;
    select set_config('request.jwt.claims', '{"role":"service_role"}', false);
  `);
  const claimedQueued = await db.query(`
    select (public.service_claim_integration_sync_job(
      '20000000-0000-4000-8000-000000000001',
      'd0200000-0000-4000-8000-000000000001',
      'orders',
      '10000000-0000-4000-8000-000000000003',
      'import', null, 900
    )).id as id
  `);
  const recoveredLease = await db.query(`
    select (public.service_claim_integration_sync_job(
      '20000000-0000-4000-8000-000000000001',
      'd0200000-0000-4000-8000-000000000001',
      'time_entries',
      '10000000-0000-4000-8000-000000000003',
      'import', null, 900
    )).id as id
  `);
  await db.exec(
    `reset role; select set_config('request.jwt.claims', '{}', false);`,
  );
  const workerClaimEvidence = await db.query(
    `
    select
      (select status::text from public.integration_sync_jobs
       where id = 'd0220000-0000-4000-8000-000000000001') as queued_retry_status,
      (select status::text from public.integration_sync_jobs
       where id = 'd0230000-0000-4000-8000-000000000001') as expired_status,
      (select retry_of_id from public.integration_sync_jobs
       where id = $1::uuid) as recovered_retry_of,
      (select attempts from public.integration_sync_jobs
       where id = $1::uuid) as recovered_attempt,
      (select lease_expires_at > clock_timestamp() from public.integration_sync_jobs
       where id = $1::uuid) as recovered_has_live_lease
  `,
    [recoveredLease.rows[0]?.id],
  );
  const workerEvidence = workerClaimEvidence.rows[0];
  if (
    claimedQueued.rows[0]?.id !== "d0220000-0000-4000-8000-000000000001" ||
    workerEvidence.queued_retry_status !== "running" ||
    workerEvidence.expired_status !== "failed" ||
    workerEvidence.recovered_retry_of !==
      "d0230000-0000-4000-8000-000000000001" ||
    workerEvidence.recovered_attempt !== 2 ||
    !workerEvidence.recovered_has_live_lease
  ) {
    throw new Error(
      `Integration worker claim evidence failed: ${JSON.stringify({ claimedQueued: claimedQueued.rows[0], recoveredLease: recoveredLease.rows[0], workerEvidence })}`,
    );
  }
  process.stdout.write(
    "PASS queued integration retry claim and expired-lease recovery\n",
  );

  // Toast Labor imports are service-only, provider-versioned, and replay-safe.
  await db.exec(`
    reset role;
    set role service_role;
    select set_config('request.jwt.claims', '{"role":"service_role"}', false);
  `);
  const firstToastImport = await db.query(`
    select public.service_ingest_pos_time_entry(
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'd0200000-0000-4000-8000-000000000001',
      'toast-time-entry-1', '2026-08-13T20:00:00Z', repeat('a', 64),
      '50000000-0000-4000-8000-000000000005',
      '40000000-0000-4000-8000-000000000001', null,
      '2026-08-13T18:00:00Z', null, false, null,
      '[{"externalId":"toast-break-1","startedAt":"2026-08-13T19:00:00Z","endedAt":"2026-08-13T19:15:00Z","isPaid":false}]'::jsonb
    ) as result
  `);
  const replayedToastImport = await db.query(`
    select public.service_ingest_pos_time_entry(
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'd0200000-0000-4000-8000-000000000001',
      'toast-time-entry-1', '2026-08-13T20:00:00Z', repeat('a', 64),
      '50000000-0000-4000-8000-000000000005',
      '40000000-0000-4000-8000-000000000001', null,
      '2026-08-13T18:00:00Z', null, false, null,
      '[{"externalId":"toast-break-1","startedAt":"2026-08-13T19:00:00Z","endedAt":"2026-08-13T19:15:00Z","isPaid":false}]'::jsonb
    ) as result
  `);
  const completedToastImport = await db.query(`
    select public.service_ingest_pos_time_entry(
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'd0200000-0000-4000-8000-000000000001',
      'toast-time-entry-1', '2026-08-13T22:00:00Z', repeat('b', 64),
      '50000000-0000-4000-8000-000000000005',
      '40000000-0000-4000-8000-000000000001', null,
      '2026-08-13T18:00:00Z', '2026-08-13T21:30:00Z', false, null,
      '[]'::jsonb
    ) as result
  `);
  await expectDatabaseError(
    `select public.service_ingest_pos_time_entry(
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'd0200000-0000-4000-8000-000000000001',
      'toast-time-entry-1', '2026-08-13T22:00:00Z', repeat('c', 64),
      '50000000-0000-4000-8000-000000000005',
      '40000000-0000-4000-8000-000000000001', null,
      '2026-08-13T18:00:00Z', '2026-08-13T21:30:00Z', false, null,
      '[]'::jsonb
    )`,
    "40001",
    "conflicting Toast source version",
  );
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);
  const toastFacts = (
    await db.query(`
    select
      entry.status,
      entry.source,
      entry.source_provider,
      entry.clocked_out_at,
      count(time_break.id)::integer as visible_breaks
    from public.time_entries entry
    left join public.time_breaks time_break
      on time_break.time_entry_id = entry.id
     and time_break.source_deleted_at is null
    where entry.integration_connection_id = 'd0200000-0000-4000-8000-000000000001'
      and entry.external_id = 'toast-time-entry-1'
    group by entry.id
  `)
  ).rows[0];
  if (
    firstToastImport.rows[0].result.status !== "created" ||
    replayedToastImport.rows[0].result.status !== "unchanged" ||
    completedToastImport.rows[0].result.status !== "updated" ||
    toastFacts.status !== "submitted" ||
    toastFacts.source !== "import" ||
    toastFacts.source_provider !== "toast" ||
    !toastFacts.clocked_out_at ||
    toastFacts.visible_breaks !== 0
  ) {
    throw new Error(
      `Toast Labor ingest failed: ${JSON.stringify({
        first: firstToastImport.rows[0],
        replay: replayedToastImport.rows[0],
        completed: completedToastImport.rows[0],
        facts: toastFacts,
      })}`,
    );
  }
  process.stdout.write(
    "PASS service-only replay-safe Toast Labor time entry ingestion\n",
  );

  // The read-only attendance mirror exposes only bounded sync freshness to an
  // authenticated employee at their assigned location. The SECURITY DEFINER
  // function must still fail closed for every other location and tenant.
  await db.exec(`
    reset role;
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  const toastSyncScope = (
    await db.query(`
    select
      (select count(*)::integer
       from public.get_pos_labor_sync_status(
         '30000000-0000-4000-8000-000000000001'
       )) as assigned_location_rows,
      (select count(*)::integer
       from public.get_pos_labor_sync_status(
         '30000000-0000-4000-8000-000000000002'
       )) as unassigned_location_rows,
      (select count(*)::integer
       from public.get_pos_labor_sync_status(
         '30000000-0000-4000-8000-000000000003'
       )) as cross_tenant_rows
  `)
  ).rows[0];
  if (
    toastSyncScope.assigned_location_rows !== 1 ||
    toastSyncScope.unassigned_location_rows !== 0 ||
    toastSyncScope.cross_tenant_rows !== 0
  ) {
    throw new Error(
      `Toast Labor sync-status scope failed: ${JSON.stringify(toastSyncScope)}`,
    );
  }
  process.stdout.write(
    "PASS bounded same-location Toast Labor sync-status access\n",
  );

  // 014: report completion is one service-only atomic transition across the
  // report run and export row, with exact replay and conflicting replay checks.
  await db.exec(`
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.request_report_export(
      'd0300000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001', null,
      'labor', current_date - 7, current_date,
      '{"delivery":"inline","report_version":"test-v1"}'::jsonb, 'csv'
    );
    select public.request_report_export(
      'd0300000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001', null,
      'attendance', current_date - 7, current_date,
      '{"delivery":"stored","report_version":"test-v1"}'::jsonb, 'pdf'
    );
    select public.request_report_export(
      'd0300000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001', null,
      'expenses', current_date - 7, current_date,
      '{"delivery":"inline","report_version":"test-v1"}'::jsonb, 'csv'
    );
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    update public.export_jobs
    set storage_path = '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/reports/missing.pdf'
    where id = 'd0300000-0000-4000-8000-000000000002';
    set role service_role;
    select set_config('request.jwt.claims', '{"role":"service_role"}', false);
    select public.complete_report_export(
      'd0300000-0000-4000-8000-000000000001', 'succeeded', 7,
      '{"kind":"labor","delivery":"inline"}'::jsonb, null
    );
    select public.complete_report_export(
      'd0300000-0000-4000-8000-000000000003', 'failed', 0,
      '{"kind":"expenses","stage":"render"}'::jsonb,
      'Synthetic render failure'
    );
    select public.complete_report_export(
      'd0300000-0000-4000-8000-000000000003', 'failed', 0,
      '{"kind":"expenses","stage":"render"}'::jsonb,
      'Synthetic render failure'
    );
    select public.complete_report_export(
      'd0300000-0000-4000-8000-000000000001', 'succeeded', 7,
      '{"kind":"labor","delivery":"inline"}'::jsonb, null
    );
  `);
  await expectDatabaseError(
    `select public.complete_report_export(
       'd0300000-0000-4000-8000-000000000001', 'succeeded', 8,
       '{"kind":"labor","delivery":"inline"}'::jsonb, null
     )`,
    "23505",
    "conflicting report completion replay",
  );
  await expectDatabaseError(
    `select public.complete_report_export(
       'd0300000-0000-4000-8000-000000000002', 'succeeded', 3,
       '{"kind":"attendance"}'::jsonb, null
     )`,
    "23514",
    "report completion without storage evidence",
  );
  await db.exec(`
    reset role;
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
  `);
  await expectDatabaseError(
    `select public.complete_report_export(
       'd0300000-0000-4000-8000-000000000002', 'failed', 0,
       '{}'::jsonb, 'Browser-forged failure'
     )`,
    "42501",
    "browser report completion",
  );
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);
  const reportCompletionQuery = await db.query(`
    select
      (select status::text from public.report_runs
       where id = 'd0300000-0000-4000-8000-000000000001') as run_status,
      (select status::text from public.export_jobs
       where id = 'd0300000-0000-4000-8000-000000000001') as export_status,
      (select row_count from public.report_runs
       where id = 'd0300000-0000-4000-8000-000000000001') as row_count,
      (select result_summary from public.report_runs
       where id = 'd0300000-0000-4000-8000-000000000001') as summary,
      (select status::text from public.report_runs
       where id = 'd0300000-0000-4000-8000-000000000002') as missing_run_status,
      (select status::text from public.export_jobs
       where id = 'd0300000-0000-4000-8000-000000000002') as missing_export_status
      ,(select status::text from public.report_runs
       where id = 'd0300000-0000-4000-8000-000000000003') as failed_run_status
      ,(select status::text from public.export_jobs
       where id = 'd0300000-0000-4000-8000-000000000003') as failed_export_status
      ,(select error_message from public.report_runs
       where id = 'd0300000-0000-4000-8000-000000000003') as failed_error
  `);
  const reportCompletion = reportCompletionQuery.rows[0];
  if (
    reportCompletion.run_status !== "succeeded" ||
    reportCompletion.export_status !== "succeeded" ||
    reportCompletion.row_count !== 7 ||
    reportCompletion.summary?.kind !== "labor" ||
    reportCompletion.missing_run_status !== "queued" ||
    reportCompletion.missing_export_status !== "queued" ||
    reportCompletion.failed_run_status !== "failed" ||
    reportCompletion.failed_export_status !== "failed" ||
    reportCompletion.failed_error !== "Synthetic render failure"
  ) {
    throw new Error(
      `Atomic report completion failed: ${JSON.stringify(reportCompletion)}`,
    );
  }
  process.stdout.write(
    "PASS service-only atomic report completion and exact replay semantics\n",
  );

  // 014: notifications are derived from workflow evidence, delivered once to
  // active tenant recipients, and recipient updates can only mark them read.
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    insert into public.schedules (
      id, organization_id, location_id, week_start, status, version, created_by
    ) values (
      'd0400000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      date '2026-08-10', 'draft', 1,
      '10000000-0000-4000-8000-000000000004'
    );
    insert into public.shifts (
      id, organization_id, location_id, schedule_id, employee_id, job_role_id,
      starts_at, ends_at, status, is_open
    ) values (
      'd0410000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'd0400000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005',
      '40000000-0000-4000-8000-000000000001',
      '2026-08-10 16:00:00-04', '2026-08-10 23:00:00-04',
      'scheduled', false
    );
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.publish_schedule(
      'd0400000-0000-4000-8000-000000000001', 'Notification contract test'
    );
    select public.publish_schedule(
      'd0400000-0000-4000-8000-000000000001', 'Notification contract test'
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',
      false
    );
    update public.notifications
    set read_at = '2000-01-01 00:00:00+00'
    where evidence_key = 'schedule.published:d0400000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000005';
  `);
  await expectDatabaseError(
    `update public.notifications
     set read_at = null
     where evidence_key = 'schedule.published:d0400000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000005'`,
    "42501",
    "notification mark-unread mutation",
  );
  await expectDatabaseError(
    `update public.notifications
     set title = 'Forged notification', read_at = clock_timestamp()
     where evidence_key = 'shift-swap.decided:b1300000-0000-4000-8000-000000000001:approved'`,
    "42501",
    "notification content mutation",
  );
  await expectDatabaseError(
    `insert into public.notifications (
       organization_id, user_id, notification_type, title
     ) values (
       '20000000-0000-4000-8000-000000000001',
       '10000000-0000-4000-8000-000000000005',
       'forged', 'Forged notification'
     )`,
    "42501",
    "browser notification insert",
  );
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);
  const notificationEvidenceQuery = await db.query(`
    select
      (select count(*)::integer from public.notifications
       where evidence_key = 'schedule.published:d0400000-0000-4000-8000-000000000001:10000000-0000-4000-8000-000000000005'
         and user_id = '10000000-0000-4000-8000-000000000005'
         and read_at > '2026-01-01'::timestamptz) as schedule_notifications,
      (select count(*)::integer from public.notifications
       where evidence_key = 'shift-swap.decided:b1300000-0000-4000-8000-000000000001:approved'
         and user_id = '10000000-0000-4000-8000-000000000005') as swap_notifications,
      (select count(*)::integer from public.notifications
       where evidence_key = 'time-correction.decided:b2100000-0000-4000-8000-000000000001:approved'
         and user_id = '10000000-0000-4000-8000-000000000005') as employee_correction_notifications,
      (select count(*)::integer from public.notifications
       where evidence_key = 'time-correction.decided:b2100000-0000-4000-8000-000000000002:approved'
         and user_id = '10000000-0000-4000-8000-000000000004') as manager_correction_notifications,
      (select count(*)::integer from public.notifications
       where evidence_key = 'task.assigned:c1600000-0000-4000-8000-000000000001:50000000-0000-4000-8000-000000000005'
         and user_id = '10000000-0000-4000-8000-000000000005') as task_notifications
  `);
  const notificationEvidence = notificationEvidenceQuery.rows[0];
  if (
    notificationEvidence.schedule_notifications !== 1 ||
    notificationEvidence.swap_notifications !== 1 ||
    notificationEvidence.employee_correction_notifications !== 1 ||
    notificationEvidence.manager_correction_notifications !== 1 ||
    notificationEvidence.task_notifications !== 1
  ) {
    throw new Error(
      `Derived notification evidence failed: ${JSON.stringify(notificationEvidence)}`,
    );
  }
  await db.exec(`
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
  `);
  const otherRecipientNotifications = await db.query(`
    select count(*)::integer as count
    from public.notifications
    where user_id = '10000000-0000-4000-8000-000000000005'
  `);
  if (otherRecipientNotifications.rows[0]?.count !== 0) {
    throw new Error(
      `Notification recipient isolation failed: ${JSON.stringify(otherRecipientNotifications.rows[0])}`,
    );
  }
  process.stdout.write(
    "PASS server-derived idempotent notifications and recipient-only read stamps\n",
  );

  // 015: purchasing, receiving, waste, and transfers use actor-bound,
  // idempotent commands. Only independent reviewers can post waste/transfer
  // ledger movements, and all quantities land in the item base unit.
  await db.exec(`
    reset role;
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.create_purchase_order(
      'e1000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      'PO-CONTRACT-001', date '2026-08-01', date '2026-08-02',
      175, 50, 'Contract test order',
      '[{"inventory_item_id":"72000000-0000-4000-8000-000000000001","unit_id":"70000000-0000-4000-8000-000000000002","quantity":10,"unit_price_cents":200}]'::jsonb
    );
    select public.create_purchase_order(
      'e1000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      'PO-CONTRACT-001', date '2026-08-01', date '2026-08-02',
      175, 50, 'Contract test order',
      '[{"inventory_item_id":"72000000-0000-4000-8000-000000000001","unit_id":"70000000-0000-4000-8000-000000000002","quantity":10,"unit_price_cents":200}]'::jsonb
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.review_purchase_order(
      'e1000000-0000-4000-8000-000000000002',
      'e1000000-0000-4000-8000-000000000001',
      true,
      'Independent contract-test approval'
    );
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.receive_inventory_delivery(
      'e1010000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      'e1000000-0000-4000-8000-000000000001',
      '2026-08-02 10:00:00-04', 'INV-CONTRACT-001', 'Accepted in full',
      '[{"inventory_item_id":"72000000-0000-4000-8000-000000000001","unit_id":"70000000-0000-4000-8000-000000000002","quantity":10,"accepted_quantity":10,"unit_price_cents":200,"lot_code":"LOT-1","expires_on":"2026-08-09"}]'::jsonb
    );
    select public.submit_waste_record(
      'e1020000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000002',
      2, 'spoilage', '2026-08-02 12:00:00-04', 'Quality check'
    );
    select public.create_inventory_transfer(
      'e1030000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000002',
      'Destination stock request',
      '[{"inventory_item_id":"72000000-0000-4000-8000-000000000001","unit_id":"70000000-0000-4000-8000-000000000002","sent_quantity":3}]'::jsonb
    );
  `);
  await expectDatabaseError(
    `select public.create_purchase_order(
       'e1000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000001',
       '73000000-0000-4000-8000-000000000001',
       'PO-CONTRACT-001', date '2026-08-01', date '2026-08-02',
       175, 50, 'Contract test order',
       '[{"inventory_item_id":"72000000-0000-4000-8000-000000000001","unit_id":"70000000-0000-4000-8000-000000000002","quantity":9,"unit_price_cents":200}]'::jsonb
     )`,
    "23505",
    "changed purchase-order replay",
  );
  await expectDatabaseError(
    `select public.review_waste_record(
       'e1040000-0000-4000-8000-000000000001',
       'e1020000-0000-4000-8000-000000000001', true, 'Self approval'
     )`,
    "42501",
    "waste creator self-review",
  );
  await expectDatabaseError(
    `select public.create_purchase_order(
       'e1050000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000003',
       '73000000-0000-4000-8000-000000000001',
       'PO-CROSS-TENANT', current_date, current_date,
       0, 0, null,
       '[{"inventory_item_id":"72000000-0000-4000-8000-000000000001","unit_id":"70000000-0000-4000-8000-000000000002","quantity":1,"unit_price_cents":200}]'::jsonb
     )`,
    "42501",
    "cross-tenant purchase order",
  );
  await expectDatabaseError(
    `insert into public.waste_records (
       organization_id, location_id, inventory_item_id, unit_id,
       quantity, reason_code, recorded_by
     ) values (
       '20000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000001',
       '72000000-0000-4000-8000-000000000001',
       '70000000-0000-4000-8000-000000000002',
       1, 'forged', '10000000-0000-4000-8000-000000000004'
     )`,
    "42501",
    "direct waste insert",
  );
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000003","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.review_waste_record(
      'e1040000-0000-4000-8000-000000000002',
      'e1020000-0000-4000-8000-000000000001', true,
      'Independent count verified'
    );
    select public.review_waste_record(
      'e1040000-0000-4000-8000-000000000002',
      'e1020000-0000-4000-8000-000000000001', true,
      'Independent count verified'
    );
    select public.review_inventory_transfer(
      'e1060000-0000-4000-8000-000000000001',
      'e1030000-0000-4000-8000-000000000001', true,
      'Destination quantity verified',
      '[{"inventory_item_id":"72000000-0000-4000-8000-000000000001","unit_id":"70000000-0000-4000-8000-000000000002","received_quantity":2.5}]'::jsonb
    );
    select public.review_inventory_transfer(
      'e1060000-0000-4000-8000-000000000001',
      'e1030000-0000-4000-8000-000000000001', true,
      'Destination quantity verified',
      '[{"inventory_item_id":"72000000-0000-4000-8000-000000000001","unit_id":"70000000-0000-4000-8000-000000000002","received_quantity":2.5}]'::jsonb
    );
  `);
  await expectDatabaseError(
    `insert into public.inventory_transactions (
       organization_id, location_id, inventory_item_id, unit_id,
       transaction_kind, quantity_delta, reference_type, reference_id,
       created_by
     ) values (
       '20000000-0000-4000-8000-000000000001',
       '30000000-0000-4000-8000-000000000001',
       '72000000-0000-4000-8000-000000000001',
       '70000000-0000-4000-8000-000000000002',
       'manual_adjustment', 99, 'forged', gen_random_uuid(),
       '10000000-0000-4000-8000-000000000003'
     )`,
    "42501",
    "direct inventory ledger insert",
  );
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);
  const inventoryWorkflowEvidenceQuery = await db.query(`
    select
      (select count(*)::integer from public.purchase_orders
       where id = 'e1000000-0000-4000-8000-000000000001') as purchase_orders,
      (select subtotal_cents from public.purchase_orders
       where id = 'e1000000-0000-4000-8000-000000000001') as subtotal_cents,
      (select status from public.purchase_orders
       where id = 'e1000000-0000-4000-8000-000000000001') as order_status,
      (select count(*)::integer from public.deliveries
       where id = 'e1010000-0000-4000-8000-000000000001') as deliveries,
      (select status::text from public.waste_records
       where id = 'e1020000-0000-4000-8000-000000000001') as waste_status,
      (select approved_by from public.waste_records
       where id = 'e1020000-0000-4000-8000-000000000001') as waste_reviewer,
      (select status from public.inventory_transfers
       where id = 'e1030000-0000-4000-8000-000000000001') as transfer_status,
      (select reviewed_by from public.inventory_transfers
       where id = 'e1030000-0000-4000-8000-000000000001') as transfer_reviewer,
      (select count(*)::integer from public.inventory_transactions
       where reference_type = 'delivery'
         and reference_id = 'e1010000-0000-4000-8000-000000000001') as delivery_posts,
      (select count(*)::integer from public.inventory_transactions
       where reference_type = 'waste_record'
         and reference_id = 'e1020000-0000-4000-8000-000000000001') as waste_posts,
      (select count(*)::integer from public.inventory_transactions
       where reference_type = 'inventory_transfer'
         and reference_id = 'e1030000-0000-4000-8000-000000000001') as transfer_posts,
      (select quantity_delta from public.inventory_transactions
       where reference_type = 'delivery'
         and reference_id = 'e1010000-0000-4000-8000-000000000001') as delivery_delta,
      (select quantity_delta from public.inventory_transactions
       where reference_type = 'waste_record'
         and reference_id = 'e1020000-0000-4000-8000-000000000001') as waste_delta,
      (select quantity_delta from public.inventory_transactions
       where reference_type = 'inventory_transfer'
         and reference_id = 'e1030000-0000-4000-8000-000000000001'
         and transaction_kind = 'transfer_out') as transfer_out_delta,
      (select quantity_delta from public.inventory_transactions
       where reference_type = 'inventory_transfer'
         and reference_id = 'e1030000-0000-4000-8000-000000000001'
         and transaction_kind = 'transfer_in') as transfer_in_delta
  `);
  const inventoryWorkflowEvidence = inventoryWorkflowEvidenceQuery.rows[0];
  if (
    inventoryWorkflowEvidence.purchase_orders !== 1 ||
    inventoryWorkflowEvidence.subtotal_cents !== 2000 ||
    inventoryWorkflowEvidence.order_status !== "received" ||
    inventoryWorkflowEvidence.deliveries !== 1 ||
    inventoryWorkflowEvidence.waste_status !== "approved" ||
    inventoryWorkflowEvidence.waste_reviewer !==
      "10000000-0000-4000-8000-000000000003" ||
    inventoryWorkflowEvidence.transfer_status !== "received" ||
    inventoryWorkflowEvidence.transfer_reviewer !==
      "10000000-0000-4000-8000-000000000003" ||
    inventoryWorkflowEvidence.delivery_posts !== 1 ||
    inventoryWorkflowEvidence.waste_posts !== 1 ||
    inventoryWorkflowEvidence.transfer_posts !== 2 ||
    Number(inventoryWorkflowEvidence.delivery_delta) !== 10 ||
    Number(inventoryWorkflowEvidence.waste_delta) !== -2 ||
    Number(inventoryWorkflowEvidence.transfer_out_delta) !== -3 ||
    Number(inventoryWorkflowEvidence.transfer_in_delta) !== 2.5
  ) {
    throw new Error(
      `Inventory workflow evidence failed: ${JSON.stringify(inventoryWorkflowEvidence)}`,
    );
  }
  const inventoryContractQuery = await db.query(`
    select
      to_regprocedure('public.create_purchase_order(uuid,uuid,uuid,text,date,date,bigint,bigint,text,jsonb)') is not null as po_rpc,
      to_regprocedure('public.receive_inventory_delivery(uuid,uuid,uuid,uuid,timestamp with time zone,text,text,jsonb)') is not null as delivery_rpc,
      to_regprocedure('public.submit_waste_record(uuid,uuid,uuid,uuid,numeric,text,timestamp with time zone,text)') is not null as waste_submit_rpc,
      to_regprocedure('public.review_waste_record(uuid,uuid,boolean,text)') is not null as waste_review_rpc,
      to_regprocedure('public.create_inventory_transfer(uuid,uuid,uuid,text,jsonb)') is not null as transfer_create_rpc,
      to_regprocedure('public.review_inventory_transfer(uuid,uuid,boolean,text,jsonb)') is not null as transfer_review_rpc,
      has_table_privilege('authenticated', 'public.purchase_orders', 'INSERT,UPDATE,DELETE') as po_direct_write,
      has_table_privilege('authenticated', 'public.deliveries', 'INSERT,UPDATE,DELETE') as delivery_direct_write,
      has_table_privilege('authenticated', 'public.waste_records', 'INSERT,UPDATE,DELETE') as waste_direct_write,
      has_table_privilege('authenticated', 'public.inventory_transfers', 'INSERT,UPDATE,DELETE') as transfer_direct_write,
      has_function_privilege('anon', 'public.review_waste_record(uuid,uuid,boolean,text)', 'EXECUTE') as anon_waste_review,
      has_function_privilege('authenticated', 'public.review_waste_record(uuid,uuid,boolean,text)', 'EXECUTE') as authenticated_waste_review
  `);
  const inventoryContract = inventoryContractQuery.rows[0];
  if (
    !inventoryContract.po_rpc ||
    !inventoryContract.delivery_rpc ||
    !inventoryContract.waste_submit_rpc ||
    !inventoryContract.waste_review_rpc ||
    !inventoryContract.transfer_create_rpc ||
    !inventoryContract.transfer_review_rpc ||
    inventoryContract.po_direct_write ||
    inventoryContract.delivery_direct_write ||
    inventoryContract.waste_direct_write ||
    inventoryContract.transfer_direct_write ||
    inventoryContract.anon_waste_review ||
    !inventoryContract.authenticated_waste_review
  ) {
    throw new Error(
      `Inventory workflow contract failed: ${JSON.stringify(inventoryContract)}`,
    );
  }
  process.stdout.write(
    "PASS actor-bound inventory purchasing, receiving, waste, transfer, and ledger workflows\n",
  );

  await db.exec(`
    reset role;
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.save_availability_rule(
      'f1000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005', null,
      '30000000-0000-4000-8000-000000000001', 1::smallint,
      time '09:00', time '17:00', true,
      date '2026-08-03', null, 'School ends before service'
    );
    select public.save_availability_rule(
      'f1000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005', null,
      '30000000-0000-4000-8000-000000000001', 1::smallint,
      time '09:00', time '17:00', true,
      date '2026-08-03', null, 'School ends before service'
    );
    select public.save_time_off_request(
      'f2000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005', null,
      '30000000-0000-4000-8000-000000000001',
      timestamptz '2027-01-10 09:00:00-05',
      timestamptz '2027-01-10 17:00:00-05',
      'Medical appointment'
    );
    select public.save_time_off_request(
      'f2000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005', null,
      '30000000-0000-4000-8000-000000000001',
      timestamptz '2027-01-10 09:00:00-05',
      timestamptz '2027-01-10 17:00:00-05',
      'Medical appointment'
    );
    select public.save_employee_emergency_contact(
      'f3000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005', null,
      'Jamie Employee Contact', 'Partner', '212-555-0199',
      'jamie.contact@example.invalid', true
    );
  `);
  await expectDatabaseError(
    `insert into public.availability_rules (
       organization_id, employee_id, location_id, weekday,
       available_from, available_until, is_available, effective_from
     ) values (
       '20000000-0000-4000-8000-000000000001',
       '50000000-0000-4000-8000-000000000005',
       '30000000-0000-4000-8000-000000000001', 2,
       time '09:00', time '17:00', true, date '2026-08-03'
     )`,
    "42501",
    "direct employee availability insert",
  );
  await expectDatabaseError(
    `select public.decide_time_off_request(
       'f2100000-0000-4000-8000-000000000001',
       'f2000000-0000-4000-8000-000000000001', true, null
     )`,
    "42501",
    "self-decided time off",
  );
  await expectDatabaseError(
    `select public.save_employee_certification(
       'f4000000-0000-4000-8000-000000000001',
       '50000000-0000-4000-8000-000000000005', null,
       'Food handler', 'City Health', 'FH-100',
       date '2026-01-01', date '2027-01-01', false
     )`,
    "42501",
    "employee-managed certification",
  );

  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.decide_time_off_request(
      'f2200000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000001', true,
      'Coverage confirmed'
    );
    select public.decide_time_off_request(
      'f2200000-0000-4000-8000-000000000001',
      'f2000000-0000-4000-8000-000000000001', true,
      'Coverage confirmed'
    );
    select public.save_employee_certification(
      'f4000000-0000-4000-8000-000000000001',
      '50000000-0000-4000-8000-000000000005', null,
      'Food handler', 'City Health', 'FH-100',
      date '2026-01-01', date '2027-01-01', true
    );
    insert into storage.objects (
      id, bucket_id, name, owner_id, metadata
    ) values (
      'f6000000-0000-4000-8000-000000000001',
      'employee-documents',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/employee-documents/50000000-0000-4000-8000-000000000005/f7000000-0000-4000-8000-000000000001-handbook.pdf',
      '10000000-0000-4000-8000-000000000004',
      '{"mimetype":"application/pdf","size":5}'::jsonb
    );
    reset role;
    set role service_role;
    select set_config('request.jwt.claims', '{"role":"service_role"}', false);
    select public.service_finalize_employee_document(
      'f7000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000004', 'aal1',
      '50000000-0000-4000-8000-000000000005',
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/employee-documents/50000000-0000-4000-8000-000000000005/f7000000-0000-4000-8000-000000000001-handbook.pdf',
      'handbook', 'Signed handbook', 'application/pdf', 5, true
    );
    select public.service_finalize_employee_document(
      'f7000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000004', 'aal1',
      '50000000-0000-4000-8000-000000000005',
      '30000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001/30000000-0000-4000-8000-000000000001/employee-documents/50000000-0000-4000-8000-000000000005/f7000000-0000-4000-8000-000000000001-handbook.pdf',
      'handbook', 'Signed handbook', 'application/pdf', 5, true
    );
    reset role;
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.update_employee_document_metadata(
      'f7100000-0000-4000-8000-000000000001',
      'f7000000-0000-4000-8000-000000000001',
      'policy acknowledgement', 'Handbook acknowledgement', false
    );
  `);
  const peopleManagerScopeQuery = await db.query(`
    select
      auth.uid() as actor_id,
      public.can_operate_employee('50000000-0000-4000-8000-000000000007') as can_operate_uptown,
      public.can_manage_location(
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000002'
      ) as can_manage_uptown,
      (select count(*)::integer from public.location_memberships
       where user_id = '10000000-0000-4000-8000-000000000004'
         and location_id = '30000000-0000-4000-8000-000000000002') as uptown_memberships
  `);
  const peopleManagerScope = peopleManagerScopeQuery.rows[0];
  if (
    peopleManagerScope.actor_id !== "10000000-0000-4000-8000-000000000004" ||
    peopleManagerScope.can_operate_uptown ||
    peopleManagerScope.can_manage_uptown ||
    peopleManagerScope.uptown_memberships !== 0
  ) {
    throw new Error(
      `People manager scope fixture failed: ${JSON.stringify(peopleManagerScope)}`,
    );
  }
  await expectDatabaseError(
    `select set_config(
       'request.jwt.claims',
       '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
       false
     );
     select public.save_availability_rule(
       'f1100000-0000-4000-8000-000000000001',
       '50000000-0000-4000-8000-000000000007', null,
       '30000000-0000-4000-8000-000000000002', 2::smallint,
       time '09:00', time '17:00', true,
       date '2026-08-03', null, null
     )`,
    "42501",
    "manager cross-location availability",
  );

  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000005","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  const peopleEmployeeStorageQuery = await db.query(`
    select count(*)::integer as visible_documents
    from storage.objects
    where bucket_id = 'employee-documents'
      and name like '%f7000000-0000-4000-8000-000000000001-handbook.pdf'
  `);
  if (peopleEmployeeStorageQuery.rows[0].visible_documents !== 0) {
    throw new Error(
      `Management-only employee document leaked: ${JSON.stringify(peopleEmployeeStorageQuery.rows[0])}`,
    );
  }

  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);
  const peopleWorkflowEvidenceQuery = await db.query(`
    select
      (select count(*)::integer from public.availability_rules
       where id = 'f1000000-0000-4000-8000-000000000001') as availability_rows,
      (select status::text from public.time_off_requests
       where id = 'f2000000-0000-4000-8000-000000000001') as time_off_status,
      (select decided_by from public.time_off_requests
       where id = 'f2000000-0000-4000-8000-000000000001') as time_off_decider,
      (select count(*)::integer from public.employee_emergency_contacts
       where id = 'f3000000-0000-4000-8000-000000000001') as emergency_contacts,
      (select verified_by from public.employee_certifications
       where id = 'f4000000-0000-4000-8000-000000000001') as certification_verifier,
      (select title from public.employee_documents
       where id = 'f7000000-0000-4000-8000-000000000001') as document_title,
      (select is_employee_visible from public.employee_documents
       where id = 'f7000000-0000-4000-8000-000000000001') as employee_visible,
      (select count(*)::integer from public.notifications
       where notification_type = 'time_off_decided'
         and entity_id = 'f2000000-0000-4000-8000-000000000001') as decision_notifications,
      (select count(*)::integer from public.audit_events
       where record_id in (
         'f1000000-0000-4000-8000-000000000001',
         'f2000000-0000-4000-8000-000000000001',
         'f3000000-0000-4000-8000-000000000001',
         'f4000000-0000-4000-8000-000000000001',
         'f7000000-0000-4000-8000-000000000001'
       )) as people_audit_events
  `);
  const peopleWorkflowEvidence = peopleWorkflowEvidenceQuery.rows[0];
  if (
    peopleWorkflowEvidence.availability_rows !== 1 ||
    peopleWorkflowEvidence.time_off_status !== "approved" ||
    peopleWorkflowEvidence.time_off_decider !==
      "10000000-0000-4000-8000-000000000004" ||
    peopleWorkflowEvidence.emergency_contacts !== 1 ||
    peopleWorkflowEvidence.certification_verifier !==
      "10000000-0000-4000-8000-000000000004" ||
    peopleWorkflowEvidence.document_title !== "Handbook acknowledgement" ||
    peopleWorkflowEvidence.employee_visible !== false ||
    peopleWorkflowEvidence.decision_notifications !== 1 ||
    peopleWorkflowEvidence.people_audit_events < 6
  ) {
    throw new Error(
      `People Operations evidence failed: ${JSON.stringify(peopleWorkflowEvidence)}`,
    );
  }
  const peopleContractQuery = await db.query(`
    select
      to_regprocedure('public.save_availability_rule(uuid,uuid,uuid,uuid,smallint,time without time zone,time without time zone,boolean,date,date,text)') is not null as availability_rpc,
      to_regprocedure('public.save_time_off_request(uuid,uuid,uuid,uuid,timestamp with time zone,timestamp with time zone,text)') is not null as time_off_rpc,
      to_regprocedure('public.decide_time_off_request(uuid,uuid,boolean,text)') is not null as time_off_decision_rpc,
      to_regprocedure('public.save_employee_certification(uuid,uuid,uuid,text,text,text,date,date,boolean)') is not null as certification_rpc,
      to_regprocedure('public.save_employee_emergency_contact(uuid,uuid,uuid,text,text,text,text,boolean)') is not null as emergency_contact_rpc,
      to_regprocedure('public.finalize_employee_document(uuid,uuid,uuid,text,text,text,text,bigint,boolean)') is not null as document_rpc,
      has_table_privilege('authenticated', 'public.availability_rules', 'INSERT,UPDATE,DELETE') as direct_availability_write,
      has_table_privilege('authenticated', 'public.time_off_requests', 'INSERT,UPDATE,DELETE') as direct_time_off_write,
      has_table_privilege('authenticated', 'public.employee_certifications', 'INSERT,UPDATE,DELETE') as direct_certification_write,
      has_table_privilege('authenticated', 'public.employee_emergency_contacts', 'INSERT,UPDATE,DELETE') as direct_emergency_write,
      has_table_privilege('authenticated', 'public.employee_documents', 'INSERT,UPDATE,DELETE') as direct_document_write,
      has_function_privilege('anon', 'public.decide_time_off_request(uuid,uuid,boolean,text)', 'EXECUTE') as anon_decision,
      has_function_privilege('authenticated', 'public.decide_time_off_request(uuid,uuid,boolean,text)', 'EXECUTE') as authenticated_decision
  `);
  const peopleContract = peopleContractQuery.rows[0];
  if (
    !peopleContract.availability_rpc ||
    !peopleContract.time_off_rpc ||
    !peopleContract.time_off_decision_rpc ||
    !peopleContract.certification_rpc ||
    !peopleContract.emergency_contact_rpc ||
    !peopleContract.document_rpc ||
    peopleContract.direct_availability_write ||
    peopleContract.direct_time_off_write ||
    peopleContract.direct_certification_write ||
    peopleContract.direct_emergency_write ||
    peopleContract.direct_document_write ||
    peopleContract.anon_decision ||
    !peopleContract.authenticated_decision
  ) {
    throw new Error(
      `People Operations contract failed: ${JSON.stringify(peopleContract)}`,
    );
  }
  process.stdout.write(
    "PASS actor-derived People Operations, independent leave decisions, and private document binding\n",
  );

  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    insert into public.receipts (
      id, organization_id, location_id, document_number, total_cents,
      review_status, uploaded_by
    ) values
      (
        'd7000000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        'R-001', 12500, 'pending', '10000000-0000-4000-8000-000000000004'
      ),
      (
        'd7000000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        'R-002', 12500, 'pending', '10000000-0000-4000-8000-000000000004'
      ),
      (
        'd7000000-0000-4000-8000-000000000003',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000001',
        'R-003', 9800, 'pending', '10000000-0000-4000-8000-000000000004'
      ),
      (
        'd7000000-0000-4000-8000-000000000004',
        '20000000-0000-4000-8000-000000000001',
        '30000000-0000-4000-8000-000000000002',
        'R-004', 9800, 'pending', '10000000-0000-4000-8000-000000000003'
      );
    insert into public.receipt_duplicate_matches (
      id, organization_id, receipt_id, possible_duplicate_id, score, reasons
    ) values
      (
        'd7100000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        'd7000000-0000-4000-8000-000000000001',
        'd7000000-0000-4000-8000-000000000002',
        1, '["sha256_exact_content_match"]'::jsonb
      ),
      (
        'd7100000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        'd7000000-0000-4000-8000-000000000003',
        'd7000000-0000-4000-8000-000000000004',
        .8, '["amount_and_date"]'::jsonb
      );
    insert into public.expenses (
      id, organization_id, location_id, expense_date, subtotal_cents,
      description, created_by
    ) values (
      'd7200000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      date '2026-08-01', 12500, 'Receipt reconciliation fixture',
      '10000000-0000-4000-8000-000000000004'
    );
    insert into public.deliveries (
      id, organization_id, location_id, vendor_id, delivered_at,
      invoice_number, received_by
    ) values (
      'd7200000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '73000000-0000-4000-8000-000000000001',
      timestamptz '2026-08-01 12:00:00-04', 'INV-017',
      '10000000-0000-4000-8000-000000000004'
    );
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
      false
    );
    select public.resolve_receipt_duplicate(
      'd7300000-0000-4000-8000-000000000001',
      'd7100000-0000-4000-8000-000000000001', 'not_duplicate'
    );
    select public.resolve_receipt_duplicate(
      'd7300000-0000-4000-8000-000000000001',
      'd7100000-0000-4000-8000-000000000001', 'not_duplicate'
    );
    select public.review_receipt(
      'd7000000-0000-4000-8000-000000000001', 'approved', '{}'::jsonb
    );
    select public.set_expense_receipt_link(
      'd7300000-0000-4000-8000-000000000002',
      'd7200000-0000-4000-8000-000000000001',
      'd7000000-0000-4000-8000-000000000001'
    );
    select public.set_expense_receipt_link(
      'd7300000-0000-4000-8000-000000000002',
      'd7200000-0000-4000-8000-000000000001',
      'd7000000-0000-4000-8000-000000000001'
    );
    select public.set_delivery_receipt_link(
      'd7300000-0000-4000-8000-000000000003',
      'd7200000-0000-4000-8000-000000000002',
      'd7000000-0000-4000-8000-000000000001'
    );
    select public.create_checklist_template_version(
      'd7400000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '017 Closing', 'closing',
      '[{"label":"Lock front door","response_type":"checkbox","required":true,"validation":{}},{"label":"Closing photo","response_type":"photo","required":false,"validation":{}}]'::jsonb
    );
    select public.create_checklist_template_version(
      'd7400000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '017 Closing', 'closing',
      '[{"label":"Lock front door","response_type":"checkbox","required":true,"validation":{}},{"label":"Closing photo","response_type":"photo","required":false,"validation":{}}]'::jsonb
    );
    select public.publish_checklist_template(
      'd7400000-0000-4000-8000-000000000002',
      'd7400000-0000-4000-8000-000000000001'
    );
    select public.publish_checklist_template(
      'd7400000-0000-4000-8000-000000000002',
      'd7400000-0000-4000-8000-000000000001'
    );
    select public.create_sop_draft(
      'd7500000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '017 Guest recovery', 'Service', true,
      'Escalate the concern to the manager on duty.', 'Initial procedure'
    );
    select public.create_sop_draft(
      'd7500000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '017 Guest recovery', 'Service', true,
      'Escalate the concern to the manager on duty.', 'Initial procedure'
    );
    select public.publish_sop_version(
      'd7500000-0000-4000-8000-000000000002',
      'd7500000-0000-4000-8000-000000000001'
    );
    select public.create_sop_version(
      'd7500000-0000-4000-8000-000000000003',
      (select sop_document_id from public.sop_versions
       where id = 'd7500000-0000-4000-8000-000000000001'),
      'Escalate, resolve, and document the concern.', 'Added documentation'
    );
    select public.create_sop_version(
      'd7500000-0000-4000-8000-000000000003',
      (select sop_document_id from public.sop_versions
       where id = 'd7500000-0000-4000-8000-000000000001'),
      'Escalate, resolve, and document the concern.', 'Added documentation'
    );
    select public.set_notification_preference(
      'd7600000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'time_off_decided', false, false, false, '{}'::jsonb
    );
    select public.set_notification_preference(
      'd7600000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'time_off_decided', false, false, false, '{}'::jsonb
    );
    select public.save_push_subscription(
      'd7600000-0000-4000-8000-000000000002',
      '20000000-0000-4000-8000-000000000001',
      repeat('a', 64), decode(repeat('ab', 32), 'hex'), 'PGlite browser'
    );
    select public.remove_push_subscription(
      'd7600000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000001', repeat('a', 64)
    );
    select public.remove_push_subscription(
      'd7600000-0000-4000-8000-000000000003',
      '20000000-0000-4000-8000-000000000001', repeat('a', 64)
    );
  `);

  await expectDatabaseError(
    `select set_config(
       'request.jwt.claims',
       '{"sub":"10000000-0000-4000-8000-000000000004","role":"authenticated","aal":"aal1"}',
       false
     );
     select public.resolve_receipt_duplicate(
       'd7300000-0000-4000-8000-000000000004',
       'd7100000-0000-4000-8000-000000000002', 'duplicate'
     )`,
    "42501",
    "manager cross-location duplicate resolution",
  );
  await expectDatabaseError(
    `update public.expenses
     set receipt_id = null
     where id = 'd7200000-0000-4000-8000-000000000001'`,
    "42501",
    "direct expense receipt unlink",
  );
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);
  const releaseGapEvidenceQuery = await db.query(`
    select
      (select resolution from public.receipt_duplicate_matches
       where id = 'd7100000-0000-4000-8000-000000000001') as duplicate_resolution,
      (select resolved_by from public.receipt_duplicate_matches
       where id = 'd7100000-0000-4000-8000-000000000001') as duplicate_actor,
      (select receipt_id from public.expenses
       where id = 'd7200000-0000-4000-8000-000000000001') as expense_receipt_id,
      (select receipt_id from public.deliveries
       where id = 'd7200000-0000-4000-8000-000000000002') as delivery_receipt_id,
      (select count(*)::integer from public.checklist_templates
       where id = 'd7400000-0000-4000-8000-000000000001' and is_active) as published_templates,
      (select count(*)::integer from public.checklist_template_items
       where template_id = 'd7400000-0000-4000-8000-000000000001') as template_items,
      (select count(*)::integer from public.sop_versions
       where id in (
         'd7500000-0000-4000-8000-000000000001',
         'd7500000-0000-4000-8000-000000000003'
       )) as sop_versions,
      (select count(*)::integer from public.push_subscriptions
       where endpoint_hash = repeat('a', 64)) as removed_push_subscriptions,
      (select in_app from public.notification_preferences
       where organization_id = '20000000-0000-4000-8000-000000000001'
         and user_id = '10000000-0000-4000-8000-000000000004'
         and notification_type = 'time_off_decided') as time_off_in_app,
      has_table_privilege(
        'authenticated', 'public.notification_preferences', 'INSERT,UPDATE,DELETE'
      ) as direct_preference_write,
      has_function_privilege(
        'authenticated',
        'public.remove_push_subscription(uuid,uuid,text)', 'EXECUTE'
      ) as authenticated_remove_push
  `);
  const releaseGapEvidence = releaseGapEvidenceQuery.rows[0];
  if (
    releaseGapEvidence.duplicate_resolution !== "not_duplicate" ||
    releaseGapEvidence.duplicate_actor !==
      "10000000-0000-4000-8000-000000000004" ||
    releaseGapEvidence.expense_receipt_id !==
      "d7000000-0000-4000-8000-000000000001" ||
    releaseGapEvidence.delivery_receipt_id !==
      "d7000000-0000-4000-8000-000000000001" ||
    releaseGapEvidence.published_templates !== 1 ||
    releaseGapEvidence.template_items !== 2 ||
    releaseGapEvidence.sop_versions !== 2 ||
    releaseGapEvidence.removed_push_subscriptions !== 0 ||
    releaseGapEvidence.time_off_in_app !== false ||
    releaseGapEvidence.direct_preference_write ||
    !releaseGapEvidence.authenticated_remove_push
  ) {
    throw new Error(
      `Receipt/operations/preferences evidence failed: ${JSON.stringify(releaseGapEvidence)}`,
    );
  }
  process.stdout.write(
    "PASS receipt reconciliation, authored operations content, preference custody, and exact replays\n",
  );

  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);

  const chatMessageId = "63000000-0000-4000-8000-000000000001";
  const chatChildDeleteCases = [
    {
      insert: `insert into public.chat_reactions (
        id, organization_id, message_id, user_id, emoji
      ) values (
        'd7800000-0000-4000-8000-000000000001',
        '20000000-0000-4000-8000-000000000001',
        '${chatMessageId}',
        '10000000-0000-4000-8000-000000000004',
        '✅'
      )`,
      remove: `delete from public.chat_reactions
        where id = 'd7800000-0000-4000-8000-000000000001'`,
      label: "reaction",
    },
    {
      insert: `insert into public.chat_attachments (
        id, organization_id, message_id, storage_path, file_name,
        mime_type, size_bytes, uploaded_by
      ) values (
        'd7800000-0000-4000-8000-000000000002',
        '20000000-0000-4000-8000-000000000001',
        '${chatMessageId}',
        '20000000-0000-4000-8000-000000000001/${chatMessageId}/d7800000-0000-4000-8000-000000000002.pdf',
        'service-note.pdf', 'application/pdf', 100,
        '10000000-0000-4000-8000-000000000004'
      )`,
      remove: `delete from public.chat_attachments
        where id = 'd7800000-0000-4000-8000-000000000002'`,
      label: "attachment",
    },
    {
      insert: `insert into public.announcement_acknowledgements (
        id, organization_id, message_id, user_id
      ) values (
        'd7800000-0000-4000-8000-000000000003',
        '20000000-0000-4000-8000-000000000001',
        '${chatMessageId}',
        '10000000-0000-4000-8000-000000000004'
      )`,
      remove: `delete from public.announcement_acknowledgements
        where id = 'd7800000-0000-4000-8000-000000000003'`,
      label: "acknowledgement",
    },
  ];
  for (const childCase of chatChildDeleteCases) {
    await db.exec(childCase.insert);
    const beforeDelete = await db.query(
      `select updated_at from public.chat_messages where id = $1`,
      [chatMessageId],
    );
    await new Promise((resolve) => setTimeout(resolve, 2));
    await db.exec(childCase.remove);
    const afterDelete = await db.query(
      `select updated_at from public.chat_messages where id = $1`,
      [chatMessageId],
    );
    if (
      !beforeDelete.rows[0]?.updated_at ||
      !afterDelete.rows[0]?.updated_at ||
      new Date(afterDelete.rows[0].updated_at).getTime() <=
        new Date(beforeDelete.rows[0].updated_at).getTime()
    ) {
      throw new Error(
        `Chat ${childCase.label} deletion did not advance the parent invalidation timestamp`,
      );
    }
  }

  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    insert into private.intelligence_operator_authorizations (
      organization_id, user_id, can_execute_actions, authorized_by
    ) values (
      '20000000-0000-4000-8000-000000000001',
      '10000000-0000-4000-8000-000000000001', true,
      '10000000-0000-4000-8000-000000000001'
    );
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal1"}',
      false
    );
  `);
  const ownerAal1Intelligence = await db.query(`
    select public.can_use_owner_intelligence(
      '20000000-0000-4000-8000-000000000001'
    ) as allowed
  `);
  if (ownerAal1Intelligence.rows[0]?.allowed) {
    throw new Error("Owner intelligence accepted an AAL1 session");
  }
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000002","role":"authenticated","aal":"aal2"}',
      false
    );
  `);
  const secondOwnerIntelligence = await db.query(`
    select public.can_use_owner_intelligence(
      '20000000-0000-4000-8000-000000000001'
    ) as allowed
  `);
  if (secondOwnerIntelligence.rows[0]?.allowed) {
    throw new Error("Owner intelligence accepted an owner without explicit authorization");
  }
  await expectDatabaseError(
    `select public.begin_owner_intelligence_run(
      'dd100000-0000-4000-8000-000000000099',
      '30000000-0000-4000-8000-000000000001', 'Unauthorized request', '{}'::jsonb
    )`,
    "42501",
    "Unauthorized owner intelligence request",
  );
  await db.exec(`
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
      false
    );
    select public.begin_owner_intelligence_run(
      'dd100000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      'Create a task to review tomorrow pickup list',
      '{"reportKind":"guest_activity","evidenceCount":1}'::jsonb
    );
  `);
  const completion = await db.query(`
    select public.complete_owner_intelligence_run(
      'dd110000-0000-4000-8000-000000000001',
      'dd100000-0000-4000-8000-000000000001',
      '{"title":"Pickup review","summary":"Create a review task.","confidence":0.94}'::jsonb,
      0.94,
      '[{"sourceTable":"owner_request","sourceRecordId":"dd100000-0000-4000-8000-000000000001","label":"Your instruction","excerpt":"Create a task","relevance":1}]'::jsonb,
      '{"kind":"task.create","title":"Review tomorrow pickup list","description":"Check names and readiness before service.","priority":"high","assignedEmployeeId":null,"dueAt":null}'::jsonb
    ) as result
  `);
  const completionResult = completion.rows[0]?.result;
  if (!completionResult?.proposalId || !completionResult?.confirmationFingerprint) {
    throw new Error(`Owner intelligence did not persist confirmation evidence: ${JSON.stringify(completionResult)}`);
  }
  await expectDatabaseError(
    `select public.execute_owner_intelligence_task_proposal(
      'dd120000-0000-4000-8000-000000000001',
      '${completionResult.proposalId}', repeat('0', 64)
    )`,
    "40001",
    "Mismatched intelligence confirmation fingerprint",
  );
  const execution = await db.query(
    `select public.execute_owner_intelligence_task_proposal($1, $2, $3) as result`,
    [
      "dd120000-0000-4000-8000-000000000002",
      completionResult.proposalId,
      completionResult.confirmationFingerprint,
    ],
  );
  const executionResult = execution.rows[0]?.result;
  if (!executionResult?.taskId || executionResult.status !== "open") {
    throw new Error(`Owner intelligence did not execute the confirmed task: ${JSON.stringify(executionResult)}`);
  }
  const undo = await db.query(
    `select public.undo_owner_intelligence_task_proposal($1, $2, $3) as result`,
    [
      "dd130000-0000-4000-8000-000000000001",
      completionResult.proposalId,
      "Owner changed the operating plan.",
    ],
  );
  const undoResult = undo.rows[0]?.result;
  if (undoResult?.taskId !== executionResult.taskId || undoResult.status !== "cancelled") {
    throw new Error(`Owner intelligence undo failed: ${JSON.stringify(undoResult)}`);
  }
  const intelligenceEvidence = await db.query(`
    select
      (select count(*)::integer from public.ai_runs
       where id = 'dd100000-0000-4000-8000-000000000001') as runs,
      (select count(*)::integer from public.ai_citations
       where ai_run_id = 'dd100000-0000-4000-8000-000000000001') as citations,
      (select count(*)::integer from public.ai_action_proposals
       where id = '${completionResult.proposalId}' and reverted_by = auth.uid()) as reverted,
      (select count(*)::integer from public.tasks
       where id = '${executionResult.taskId}' and status = 'cancelled'
         and source_type = 'ai_proposal') as cancelled_tasks
  `);
  if (Object.values(intelligenceEvidence.rows[0] ?? {}).some((value) => value !== 1)) {
    throw new Error(`Owner intelligence evidence is incomplete: ${JSON.stringify(intelligenceEvidence.rows[0])}`);
  }
  process.stdout.write(
    "PASS owner-only AAL2 intelligence, exact confirmation, task execution, and audited undo\n",
  );

  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
    insert into public.recipes (
      id, organization_id, name, yield_quantity, yield_unit_id, is_active
    ) values (
      'ef000000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'Prep verification tomato base', 1,
      '70000000-0000-4000-8000-000000000002', true
    );
    insert into public.recipe_ingredients (
      id, organization_id, recipe_id, inventory_item_id, unit_id, quantity, waste_factor
    ) values (
      'ef010000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      'ef000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000002', 1, 0
    );
    insert into public.inventory_transactions (
      id, organization_id, location_id, inventory_item_id, unit_id,
      transaction_kind, quantity_delta, occurred_at, reference_type, reason, created_by
    ) values (
      'ef020000-0000-4000-8000-000000000001',
      '20000000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001',
      '72000000-0000-4000-8000-000000000001',
      '70000000-0000-4000-8000-000000000002',
      'manual_adjustment', 10, clock_timestamp(), 'prep_verifier',
      'Opening prep verification stock', '10000000-0000-4000-8000-000000000001'
    );
    set role authenticated;
    select set_config(
      'request.jwt.claims',
      '{"sub":"10000000-0000-4000-8000-000000000001","role":"authenticated","aal":"aal2"}',
      false
    );
  `);
  const savedPrep = await db.query(`
    select * from public.save_prep_task(
      'ef100000-0000-4000-8000-000000000001',
      'ef110000-0000-4000-8000-000000000001',
      '30000000-0000-4000-8000-000000000001', current_date,
      'dinner', 'Garde manger',
      'ef000000-0000-4000-8000-000000000001', null,
      2, '70000000-0000-4000-8000-000000000002',
      clock_timestamp() + interval '2 hours', null, 'Verifier prep task', null
    )
  `);
  const savedPrepRow = savedPrep.rows[0];
  if (savedPrepRow?.state !== "draft" || savedPrepRow?.version !== 1) {
    throw new Error(`Prep draft save failed: ${JSON.stringify(savedPrepRow)}`);
  }
  const publishedPrep = await db.query(`
    select * from public.transition_prep_task(
      'ef100000-0000-4000-8000-000000000002',
      'ef110000-0000-4000-8000-000000000001', 1, 'publish'
    )
  `);
  if (publishedPrep.rows[0]?.state !== "published" || publishedPrep.rows[0]?.version !== 2) {
    throw new Error(`Prep publish failed: ${JSON.stringify(publishedPrep.rows[0])}`);
  }
  const prepPreview = (await db.query(`
    select public.preview_prep_completion(
      'ef110000-0000-4000-8000-000000000001', 2
    ) as result
  `)).rows[0]?.result;
  if (prepPreview?.has_shortage || prepPreview?.movements?.[0]?.quantity !== 2) {
    throw new Error(`Prep completion preview failed: ${JSON.stringify(prepPreview)}`);
  }
  const completedPrep = await db.query(`
    select * from public.complete_prep_task(
      'ef100000-0000-4000-8000-000000000003',
      'ef110000-0000-4000-8000-000000000001', 2, 2, false, 'Verified yield'
    )
  `);
  if (completedPrep.rows[0]?.state !== "completed" || completedPrep.rows[0]?.version !== 3) {
    throw new Error(`Prep completion failed: ${JSON.stringify(completedPrep.rows[0])}`);
  }
  const replayedPrep = await db.query(`
    select (public.complete_prep_task(
      'ef100000-0000-4000-8000-000000000003',
      'ef110000-0000-4000-8000-000000000001', 2, 2, false, 'Verified yield'
    )).state as state
  `);
  if (replayedPrep.rows[0]?.state !== "completed") {
    throw new Error(`Prep completion replay failed: ${JSON.stringify(replayedPrep.rows[0])}`);
  }
  await expectDatabaseError(
    `select public.complete_prep_task(
      'ef100000-0000-4000-8000-000000000003',
      'ef110000-0000-4000-8000-000000000001', 2, 3, false, 'Changed replay'
    )`,
    "23505",
    "Prep completion request reuse",
  );
  const correctedPrep = await db.query(`
    select * from public.correct_prep_completion(
      'ef100000-0000-4000-8000-000000000004',
      'ef110000-0000-4000-8000-000000000001', 3,
      'Verifier correction reverses the ledger'
    )
  `);
  const prepLedger = await db.query(`
    select coalesce(sum(quantity_delta), 0) as prep_net,
      count(*)::integer as movement_count
    from public.inventory_transactions
    where reference_id = 'ef110000-0000-4000-8000-000000000001'
      and reference_type in ('prep_completion', 'prep_correction')
  `);
  if (correctedPrep.rows[0]?.state !== "corrected"
    || Number(prepLedger.rows[0]?.prep_net) !== 0
    || prepLedger.rows[0]?.movement_count !== 2) {
    throw new Error(`Prep correction did not reconcile inventory: ${JSON.stringify({ task: correctedPrep.rows[0], ledger: prepLedger.rows[0] })}`);
  }
  process.stdout.write(
    "PASS manual prep draft, publish, preview, replay-safe posting, and compensating correction\n",
  );
  await db.exec(`
    reset role;
    select set_config('request.jwt.claims', '{}', false);
  `);

  const finalSecurityContractsQuery = await db.query(`
    select
      to_regprocedure(
        'public.create_manual_csv_import(uuid,uuid,text,text,text,text,integer,text[],jsonb)'
      ) is not null as manual_import_exists,
      to_regprocedure(
        'public.retry_integration_sync_job(uuid,uuid)'
      ) is not null as sync_retry_exists,
      to_regprocedure(
        'public.complete_report_export(uuid,public.job_status,integer,jsonb,text)'
      ) is not null as report_completion_exists,
      has_function_privilege(
        'authenticated',
        'public.create_manual_csv_import(uuid,uuid,text,text,text,text,integer,text[],jsonb)',
        'EXECUTE'
      ) as authenticated_can_queue_import,
      has_function_privilege(
        'authenticated',
        'public.retry_integration_sync_job(uuid,uuid)',
        'EXECUTE'
      ) as authenticated_can_retry_sync,
      has_function_privilege(
        'service_role',
        'public.complete_report_export(uuid,public.job_status,integer,jsonb,text)',
        'EXECUTE'
      ) as service_can_complete_report,
      has_function_privilege(
        'authenticated',
        'public.complete_report_export(uuid,public.job_status,integer,jsonb,text)',
        'EXECUTE'
      ) as authenticated_can_complete_report,
      has_function_privilege(
        'anon',
        'public.create_manual_csv_import(uuid,uuid,text,text,text,text,integer,text[],jsonb)',
        'EXECUTE'
      ) as anon_can_queue_import,
      has_table_privilege('authenticated', 'public.guest_visits', 'INSERT,UPDATE,DELETE')
        as browser_can_mutate_guest_visits,
      has_table_privilege('authenticated', 'public.reservations', 'INSERT,UPDATE,DELETE')
        as browser_can_mutate_reservations,
      has_table_privilege('authenticated', 'public.import_jobs', 'INSERT,UPDATE,DELETE')
        as browser_can_mutate_import_jobs,
      has_table_privilege('authenticated', 'public.integration_sync_jobs', 'INSERT,UPDATE,DELETE')
        as browser_can_mutate_sync_jobs,
      has_table_privilege('authenticated', 'public.notifications', 'INSERT,UPDATE,DELETE')
        as browser_has_notification_table_write,
      has_column_privilege('authenticated', 'public.notifications', 'read_at', 'UPDATE')
        as recipient_can_mark_notification_read,
      has_column_privilege('authenticated', 'public.notifications', 'title', 'UPDATE')
        as recipient_can_update_notification_title,
      (select count(*)::integer from pg_trigger
       where tgname in (
         'schedule_publication_notification',
         'shift_swap_decision_notification',
         'time_correction_decision_notification',
         'task_assignment_notification',
         'notification_evidence_guard'
       ) and not tgisinternal) as notification_triggers,
      (select not pubdelete from pg_publication
       where pubname = 'supabase_realtime') as realtime_delete_disabled,
      (select not pubtruncate from pg_publication
       where pubname = 'supabase_realtime') as realtime_truncate_disabled,
      (select pubinsert and pubupdate from pg_publication
       where pubname = 'supabase_realtime') as realtime_safe_changes_enabled,
      (select count(*)::integer from pg_trigger
       where tgname in (
         'chat_reaction_delete_invalidate_message',
         'chat_attachment_delete_invalidate_message',
         'chat_acknowledgement_delete_invalidate_message'
       ) and not tgisinternal) as chat_delete_invalidation_triggers,
      has_function_privilege(
        'authenticated',
        'private.touch_chat_message_after_child_delete()',
        'EXECUTE'
      ) as browser_can_execute_chat_delete_invalidation
  `);
  const finalSecurityContracts = finalSecurityContractsQuery.rows[0];
  if (
    !finalSecurityContracts.manual_import_exists ||
    !finalSecurityContracts.sync_retry_exists ||
    !finalSecurityContracts.report_completion_exists ||
    !finalSecurityContracts.authenticated_can_queue_import ||
    !finalSecurityContracts.authenticated_can_retry_sync ||
    !finalSecurityContracts.service_can_complete_report ||
    finalSecurityContracts.authenticated_can_complete_report ||
    finalSecurityContracts.anon_can_queue_import ||
    finalSecurityContracts.browser_can_mutate_guest_visits ||
    finalSecurityContracts.browser_can_mutate_reservations ||
    finalSecurityContracts.browser_can_mutate_import_jobs ||
    finalSecurityContracts.browser_can_mutate_sync_jobs ||
    finalSecurityContracts.browser_has_notification_table_write ||
    !finalSecurityContracts.recipient_can_mark_notification_read ||
    finalSecurityContracts.recipient_can_update_notification_title ||
    finalSecurityContracts.notification_triggers !== 5 ||
    !finalSecurityContracts.realtime_delete_disabled ||
    !finalSecurityContracts.realtime_truncate_disabled ||
    !finalSecurityContracts.realtime_safe_changes_enabled ||
    finalSecurityContracts.chat_delete_invalidation_triggers !== 3 ||
    finalSecurityContracts.browser_can_execute_chat_delete_invalidation
  ) {
    throw new Error(
      `Final security contract catalog failed: ${JSON.stringify(finalSecurityContracts)}`,
    );
  }
  process.stdout.write(
    "PASS frozen RPC grants, evidence revokes, and notification trigger catalog\n",
  );

  const coverage = await db.query(`
    select
      count(*)::integer as table_count,
      count(*) filter (where relrowsecurity)::integer as rls_count,
      count(*) filter (where relforcerowsecurity)::integer as forced_count
    from pg_class
    where relnamespace = 'public'::regnamespace and relkind = 'r'
  `);
  const invitation = await db.query(`
    select
      to_regprocedure('public.provision_user_invitation(uuid,uuid,text,text,public.app_role,uuid[],text,timestamp with time zone,uuid)') is not null as provision_exists,
      to_regprocedure('public.accept_my_invitation(uuid)') is not null as accept_exists,
      exists (
        select 1 from pg_trigger
        where tgname = 'organization_memberships_owner_assignment' and not tgisinternal
      ) as owner_guard_exists
  `);

  const counts = coverage.rows[0];
  const inviteChecks = invitation.rows[0];
  if (
    counts.table_count !== counts.rls_count ||
    counts.table_count !== counts.forced_count ||
    !inviteChecks.provision_exists ||
    !inviteChecks.accept_exists ||
    !inviteChecks.owner_guard_exists
  ) {
    throw new Error(
      `Catalog verification failed: ${JSON.stringify({ counts, inviteChecks })}`,
    );
  }

  process.stdout.write(
    `PASS catalog ${counts.table_count}/${counts.table_count} public tables use forced RLS\n`,
  );
  process.stdout.write(
    "PASS secure invitation functions and owner-role guard\n",
  );
} finally {
  await db.close();
}
