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
  otherOrganization: "20000000-0000-4000-8000-000000000002",
  location: "30000000-0000-4000-8000-000000000001",
  otherLocation: "30000000-0000-4000-8000-000000000002",
  manager: "10000000-0000-4000-8000-000000000004",
  employee: "10000000-0000-4000-8000-000000000005",
  admin: "10000000-0000-4000-8000-000000000003",
  owner: "10000000-0000-4000-8000-000000000001",
  chefRole: "c0100000-0000-4000-8000-000000000001",
  chefAssignment: "c0200000-0000-4000-8000-000000000001",
  unit: "c0250000-0000-4000-8000-000000000001",
  category: "c0260000-0000-4000-8000-000000000001",
  item: "c0300000-0000-4000-8000-000000000001",
  itemCost: "c0350000-0000-4000-8000-000000000001",
  vendor: "c0400000-0000-4000-8000-000000000001",
  vendorItem: "c0500000-0000-4000-8000-000000000001",
  par: "c0600000-0000-4000-8000-000000000001",
  recipe: "c0800000-0000-4000-8000-000000000001",
};

const platformBootstrap = `
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

function claimsFor(userId, aal = "aal1") {
  return JSON.stringify({ role: "authenticated", sub: userId, aal });
}

async function assumeUser(userId, aal = "aal1") {
  await db.query("select set_config('request.jwt.claims', $1, false)", [claimsFor(userId, aal)]);
}

async function expectDatabaseError(action, expectedCode, label) {
  try {
    await action();
  } catch (error) {
    if (error && typeof error === "object" && error.code === expectedCode) return;
    throw new Error(
      `${label} returned an unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function assignCapability(requestId, assignmentId, capabilityKey, active = true) {
  return db.query(
    `select public.configure_job_role_capability(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
      null::uuid, date '2026-01-01', null::date, $6::boolean
    ) as result`,
    [requestId, ids.organization, assignmentId, ids.chefRole, capabilityKey, active],
  );
}

async function configure(requestId, command, payload, locationId = ids.location) {
  const result = await db.query(
    `select public.configure_operational_inventory_catalog(
      $1::uuid, $2::uuid, $3::uuid, $4::text, $5::jsonb
    ) as result`,
    [requestId, ids.organization, locationId, command, JSON.stringify(payload)],
  );
  return result.rows[0].result;
}

async function configureFoundation(requestId, command, payload, locationId = ids.location) {
  const result = await db.query(
    `select public.configure_kitchen_foundation(
      $1::uuid, $2::uuid, $3::uuid, $4::text, $5::jsonb
    ) as result`,
    [requestId, ids.organization, locationId, command, JSON.stringify(payload)],
  );
  return result.rows[0].result;
}

try {
  await db.exec(platformBootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }
  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));
  process.stdout.write("PASS all migrations and synthetic seed for capability verification\n");

  await db.exec(`
    update public.locations location
    set timezone = case
      when (statement_timestamp() at time zone 'Pacific/Kiritimati')::date <> current_date
        then 'Pacific/Kiritimati'
      else 'America/Adak'
    end
    where location.id = '${ids.location}'
      and location.organization_id = '${ids.organization}';
    insert into public.job_roles (
      id, organization_id, name, code, department, default_tip_points, is_tipped
    ) values (
      '${ids.chefRole}', '${ids.organization}', 'Executive Chef', 'EXEC_CHEF',
      'Back of house', 0, false
    );
    insert into public.employee_job_roles (
      id, organization_id, employee_id, job_role_id, location_id,
      effective_from, is_primary
    ) values (
      '${ids.chefAssignment}', '${ids.organization}',
      '50000000-0000-4000-8000-000000000004', '${ids.chefRole}',
      '${ids.location}', (
        select (statement_timestamp() at time zone location.timezone)::date
        from public.locations location
        where location.organization_id = '${ids.organization}'
          and location.id = '${ids.location}'
      ), true
    );
    update public.job_role_capabilities capability
    set effective_from = (
      select (statement_timestamp() at time zone location.timezone)::date
      from public.locations location
      where location.organization_id = '${ids.organization}'
        and location.id = '${ids.location}'
    )
    where capability.organization_id = '${ids.organization}'
      and capability.job_role_id = '${ids.chefRole}';
    set role authenticated;
  `);

  const capabilities = [
    "inventory.item.manage",
    "inventory.category.manage",
    "inventory.unit.manage",
    "inventory.par.manage",
    "inventory.count.create",
    "inventory.count.approve",
    "inventory.waste.create",
    "inventory.waste.approve",
    "inventory.transfer.create",
    "inventory.purchase.create",
    "inventory.purchase.approve",
    "inventory.receive",
    "inventory.vendor.manage",
    "inventory.price.manage",
    "recipe.manage",
    "prep.manage",
    "prep.complete",
    "menu.manage",
    "schedule.manage",
    "schedule.publish",
    "service.availability.manage",
    "reports.operational.view",
  ];
  await assumeUser(ids.admin);
  await db.query(
    `select public.configure_user_capability_override(
      'c1400000-0000-4000-8000-000000000010'::uuid, $1::uuid,
      'c1500000-0000-4000-8000-000000000010'::uuid, $2::uuid,
      'inventory.item.manage', $3::uuid, 'deny',
      'UTC-date boundary proof', current_date, current_date, true
    )`,
    [ids.organization, ids.manager, ids.location],
  );
  await assumeUser(ids.manager);
  const localDateBoundary = (await db.query(
    `select
      current_date as session_date,
      (
        statement_timestamp() at time zone (
          select location.timezone
          from public.locations location
          where location.organization_id = $1::uuid and location.id = $2::uuid
        )
      )::date as location_date,
      public.has_capability($1::uuid, $2::uuid, 'inventory.item.manage') as local_default,
      public.has_capability(
        $1::uuid, $2::uuid, 'inventory.item.manage', current_date
      ) as explicit_session_date`,
    [ids.organization, ids.location],
  )).rows[0];
  if (
    localDateBoundary.session_date === localDateBoundary.location_date
    || !localDateBoundary.local_default
    || localDateBoundary.explicit_session_date
  ) {
    throw new Error(
      `Location-local capability date boundary failed: ${JSON.stringify(localDateBoundary)}`,
    );
  }
  const effective = await db.query(
    "select capability_key from public.effective_capabilities($1::uuid, $2::uuid)",
    [ids.organization, ids.location],
  );
  const effectiveKeys = effective.rows.map((row) => row.capability_key).sort();
  if (JSON.stringify(effectiveKeys) !== JSON.stringify([...capabilities].sort())) {
    throw new Error(`Expected default Executive Chef capabilities, got ${JSON.stringify(effectiveKeys)}`);
  }
  const boundaries = (await db.query(`
    select
      public.has_capability($1::uuid, $2::uuid, 'inventory.item.manage') as assigned_location,
      public.has_capability($1::uuid, $3::uuid, 'inventory.item.manage') as unassigned_location,
      public.has_capability($4::uuid, '30000000-0000-4000-8000-000000000003'::uuid,
        'inventory.item.manage') as other_tenant
  `, [ids.organization, ids.location, ids.otherLocation, ids.otherOrganization])).rows[0];
  if (!boundaries.assigned_location || boundaries.unassigned_location || boundaries.other_tenant) {
    throw new Error(`Capability location/tenant boundary failed: ${JSON.stringify(boundaries)}`);
  }
  await expectDatabaseError(
    () => assignCapability(
      "c1200000-0000-4000-8000-000000000001",
      "c1300000-0000-4000-8000-000000000001",
      "schedule.publish",
    ),
    "42501",
    "manager self-escalation",
  );

  const createdUnit = await configureFoundation(ids.unit, "unit.save", {
    name: "Capability gram",
    symbol: "cap-g",
    dimension: "mass",
    isBase: false,
    isActive: true,
  });
  const replayedUnit = await configureFoundation(ids.unit, "unit.save", {
    name: "Capability gram",
    symbol: "cap-g",
    dimension: "mass",
    isBase: false,
    isActive: true,
  });
  if (createdUnit.replayed !== false || replayedUnit.replayed !== true) {
    throw new Error("Kitchen foundation command did not preserve exact replay semantics");
  }
  await configureFoundation(ids.category, "category.save", {
    name: "Capability kitchen",
    parentId: null,
    isActive: true,
  });
  await expectDatabaseError(
    () => configureFoundation(
      "c0270000-0000-4000-8000-000000000001",
      "category.save",
      { name: "Wrong room", parentId: null, isActive: true },
      ids.otherLocation,
    ),
    "42501",
    "cross-location kitchen foundation command",
  );

  const createdItem = await configure(ids.item, "item.save", {
    name: "Capability Carrots",
    sku: "CAP-CARROT",
    description: "Created by a non-admin Chef capability.",
    categoryId: "71000000-0000-4000-8000-000000000001",
    baseUnitId: "70000000-0000-4000-8000-000000000002",
    trackInventory: true,
    isActive: true,
  });
  const replayedItem = await configure(ids.item, "item.save", {
    name: "Capability Carrots",
    sku: "CAP-CARROT",
    description: "Created by a non-admin Chef capability.",
    categoryId: "71000000-0000-4000-8000-000000000001",
    baseUnitId: "70000000-0000-4000-8000-000000000002",
    trackInventory: true,
    isActive: true,
  });
  if (createdItem.replayed !== false || replayedItem.replayed !== true) {
    throw new Error("Operational item command did not preserve exact replay semantics");
  }
  const recordDirectCost = (price = 3, locationId = ids.location) => db.query(
    `select public.record_inventory_item_cost(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid,
      '70000000-0000-4000-8000-000000000002'::uuid,
      1000::numeric, $5::bigint, '2026-08-09T12:00:00.000Z'::timestamptz,
      'Opening direct gram cost'
    ) as result`,
    [ids.itemCost, ids.organization, locationId, ids.item, price],
  );
  const createdCost = (await recordDirectCost()).rows[0].result;
  const replayedCost = (await recordDirectCost()).rows[0].result;
  if (createdCost.replayed !== false || replayedCost.replayed !== true) {
    throw new Error("Direct inventory cost did not preserve exact replay semantics");
  }
  await expectDatabaseError(
    () => recordDirectCost(4),
    "23505",
    "changed direct cost replay",
  );
  await expectDatabaseError(
    () => db.query(
      `select public.record_inventory_item_cost(
        'c0350000-0000-4000-8000-000000000002'::uuid, $1::uuid, $2::uuid,
        $3::uuid, '70000000-0000-4000-8000-000000000002'::uuid,
        1000::numeric, 3::bigint, '2026-08-09T12:00:00.000Z'::timestamptz, null
      )`,
      [ids.organization, ids.otherLocation, ids.item],
    ),
    "42501",
    "cross-location direct cost",
  );
  await assumeUser(ids.owner, "aal1");
  const directCostEvidence = (await db.query(
    `select
      count(*) filter (where vendor_id is null and source_type = 'manual_unit_cost')::int as price_rows,
      (select count(*)::int from public.audit_events
       where table_name = 'item_price_history' and record_id = $1::text) as audit_rows
     from public.item_price_history`,
    [ids.itemCost],
  )).rows[0];
  if (directCostEvidence.price_rows !== 1 || directCostEvidence.audit_rows < 1) {
    throw new Error(`Direct cost evidence is incomplete: ${JSON.stringify(directCostEvidence)}`);
  }

  const ownerPasswordAccess = (await db.query(
    "select public.can_manage_org($1::uuid) as can_manage, public.is_owner_pending_mfa($1::uuid) as pending_mfa",
    [ids.organization],
  )).rows[0];
  if (!ownerPasswordAccess.can_manage || ownerPasswordAccess.pending_mfa) {
    throw new Error(`Password-only Owner policy failed: ${JSON.stringify(ownerPasswordAccess)}`);
  }
  await assumeUser(ids.manager);
  await configure(ids.vendor, "vendor.save", {
    name: "Capability Produce",
    email: "orders@capability.example.invalid",
    paymentTerms: "Net 15",
    isActive: true,
  });
  await configure(ids.vendorItem, "vendor_item.save", {
    vendorId: ids.vendor,
    inventoryItemId: ids.item,
    purchaseUnitId: "70000000-0000-4000-8000-000000000002",
    vendorSku: "CARROT-LB",
    packQuantity: 1,
    lastPriceCents: 275,
    priceEffectiveAt: "2026-08-08T12:00:00.000Z",
    isPreferred: true,
    isActive: true,
  });
  await configure(ids.par, "par.set", {
    locationId: ids.location,
    inventoryItemId: ids.item,
    parQuantity: 30,
    reorderQuantity: 12,
    effectiveFrom: "2026-08-08",
  });
  await expectDatabaseError(
    () => configure(
      "c0700000-0000-4000-8000-000000000001",
      "par.set",
      {
        locationId: ids.otherLocation,
        inventoryItemId: ids.item,
        parQuantity: 99,
        reorderQuantity: 20,
        effectiveFrom: "2026-08-08",
      },
      ids.otherLocation,
    ),
    "42501",
    "cross-location operational catalog command",
  );

  const recipePayload = JSON.stringify([{
    inventoryItemId: ids.item,
    unitId: "70000000-0000-4000-8000-000000000002",
    quantity: 0.25,
    wasteFactor: 0.1,
  }]);
  const createRecipe = () => db.query(
    `select public.save_manager_recipe(
      $1::uuid, $2::uuid, null::uuid, 'Capability Carrot Plate',
      1::numeric, '70000000-0000-4000-8000-000000000001'::uuid,
      1500::bigint, true, $3::jsonb
    ) as result`,
    [ids.recipe, ids.location, recipePayload],
  );
  const createdRecipe = (await createRecipe()).rows[0].result;
  const replayedRecipe = (await createRecipe()).rows[0].result;
  if (createdRecipe.replayed !== false || replayedRecipe.replayed !== true) {
    throw new Error("Chef recipe command did not preserve exact replay semantics");
  }

  await assumeUser(ids.admin);
  await db.query(
    `select public.configure_user_capability_override(
      'c1400000-0000-4000-8000-000000000001'::uuid, $1::uuid,
      'c1500000-0000-4000-8000-000000000001'::uuid, $2::uuid,
      'inventory.item.manage', $3::uuid, 'deny',
      'Focused test denial', date '2026-08-08', null::date, true
    )`,
    [ids.organization, ids.manager, ids.location],
  );
  await db.query(
    `select public.configure_user_capability_override(
      'c1400000-0000-4000-8000-000000000002'::uuid, $1::uuid,
      'c1500000-0000-4000-8000-000000000002'::uuid, $2::uuid,
      'recipe.manage', $3::uuid, 'deny',
      'Focused recipe denial', date '2026-08-08', null::date, true
    )`,
    [ids.organization, ids.manager, ids.location],
  );
  await assumeUser(ids.manager);
  const denied = (await db.query(
    "select public.has_capability($1::uuid, $2::uuid, 'inventory.item.manage') as value",
    [ids.organization, ids.location],
  )).rows[0].value;
  if (denied) throw new Error("Active user denial did not override the job-role grant");
  await expectDatabaseError(
    () => configure("c1600000-0000-4000-8000-000000000001", "item.save", {
      name: "Denied item",
      baseUnitId: "70000000-0000-4000-8000-000000000002",
      trackInventory: true,
      isActive: true,
    }),
    "42501",
    "denied catalog write",
  );
  await expectDatabaseError(
    () => db.query(
      `select public.save_manager_recipe(
        'c0800000-0000-4000-8000-000000000002'::uuid,
        $1::uuid, null::uuid, 'Denied Recipe', 1::numeric,
        '70000000-0000-4000-8000-000000000001'::uuid,
        1000::bigint, true, $2::jsonb
      )`,
      [ids.location, recipePayload],
    ),
    "42501",
    "denied recipe write",
  );

  await db.exec("reset role; select set_config('request.jwt.claims', '{}', false)");
  const evidence = (await db.query(`
    select
      (select count(*)::integer from public.inventory_items where id = '${ids.item}') as item_count,
      (select count(*)::integer from public.measurement_units where id = '${ids.unit}') as unit_count,
      (select count(*)::integer from public.inventory_categories where id = '${ids.category}') as category_count,
      (select count(*)::integer from public.item_price_history where source_id = '${ids.vendorItem}') as price_versions,
      (select count(*)::integer from public.inventory_par_levels where id = '${ids.par}') as par_count,
      (select count(*)::integer from public.recipes where id = '${ids.recipe}') as recipe_count,
      (select count(*)::integer from public.inventory_recipe_versions where recipe_id = '${ids.recipe}') as recipe_versions,
      (select count(*)::integer from public.audit_events
        where table_name in ('job_role_capabilities', 'user_capability_overrides')) as capability_audit_events,
      has_function_privilege('authenticated',
        'public.configure_operational_inventory_catalog(uuid,uuid,uuid,text,jsonb)', 'EXECUTE') as can_execute,
      has_function_privilege('authenticated',
        'public.configure_kitchen_foundation(uuid,uuid,uuid,text,jsonb)', 'EXECUTE') as can_configure_foundation,
      has_table_privilege('authenticated', 'public.job_role_capabilities', 'INSERT,UPDATE,DELETE') as direct_grant_write,
      has_table_privilege('anon', 'public.capability_definitions', 'SELECT') as anon_capability_read
  `)).rows[0];
  if (
    evidence.item_count !== 1 || evidence.unit_count !== 1 || evidence.category_count !== 1
    || evidence.price_versions !== 1 || evidence.par_count !== 1
    || evidence.recipe_count !== 1 || evidence.recipe_versions !== 1
    || evidence.capability_audit_events < 8 || !evidence.can_execute || !evidence.can_configure_foundation
    || evidence.direct_grant_write || evidence.anon_capability_read
  ) {
    throw new Error(`Capability security evidence failed: ${JSON.stringify(evidence)}`);
  }
  process.stdout.write(
    "PASS capability grants/denials, tenant/location isolation, Chef catalog workflow, replay, audit, and direct-DML revocation\n",
  );
} finally {
  await db.close();
}
