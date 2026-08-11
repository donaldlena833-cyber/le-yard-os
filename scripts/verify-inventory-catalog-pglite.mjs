import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const root = process.cwd();
const migrationsDirectory = join(root, "supabase", "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql") && file <= "202608010020_inventory_catalog_configuration.sql")
  .sort();
const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });

const ids = {
  owner: "ca000000-0000-4000-8000-000000000001",
  admin: "ca000000-0000-4000-8000-000000000002",
  manager: "ca000000-0000-4000-8000-000000000003",
  otherOwner: "ca000000-0000-4000-8000-000000000004",
  organization: "ca100000-0000-4000-8000-000000000001",
  otherOrganization: "ca100000-0000-4000-8000-000000000002",
  location: "ca200000-0000-4000-8000-000000000001",
  otherLocation: "ca200000-0000-4000-8000-000000000002",
  otherUnit: "ca300000-0000-4000-8000-000000000099",
  countUnit: "ca300000-0000-4000-8000-000000000001",
  ounceUnit: "ca300000-0000-4000-8000-000000000002",
  poundUnit: "ca300000-0000-4000-8000-000000000003",
  conversion: "ca400000-0000-4000-8000-000000000001",
  category: "ca500000-0000-4000-8000-000000000001",
  vendor: "ca600000-0000-4000-8000-000000000001",
  item: "ca700000-0000-4000-8000-000000000001",
  vendorItem: "ca800000-0000-4000-8000-000000000001",
  par: "ca900000-0000-4000-8000-000000000001",
  recipe: "caa00000-0000-4000-8000-000000000001",
  replay: "cab00000-0000-4000-8000-000000000001",
};

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

function claimsFor(userId, aal = "aal1") {
  return JSON.stringify({ role: "authenticated", sub: userId, aal });
}

async function assumeUser(userId, aal = "aal1") {
  await db.query("select set_config('request.jwt.claims', $1, false)", [claimsFor(userId, aal)]);
}

async function configure(requestId, command, payload, organizationId = ids.organization) {
  const result = await db.query(
    "select public.configure_inventory_catalog($1::uuid, $2::uuid, $3::text, $4::jsonb) as result",
    [requestId, organizationId, command, JSON.stringify(payload)],
  );
  return result.rows[0].result;
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

try {
  await db.exec(platformBootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }

  await db.exec(`
    insert into auth.users (id, email) values
      ('${ids.owner}', 'owner@catalog.test'),
      ('${ids.admin}', 'admin@catalog.test'),
      ('${ids.manager}', 'manager@catalog.test'),
      ('${ids.otherOwner}', 'other-owner@catalog.test');
    insert into public.organizations (id, name, slug) values
      ('${ids.organization}', 'Catalog Test', 'catalog-test'),
      ('${ids.otherOrganization}', 'Other Catalog', 'other-catalog');
    insert into public.locations (id, organization_id, name, code, timezone) values
      ('${ids.location}', '${ids.organization}', 'Main', 'MAIN', 'America/New_York'),
      ('${ids.otherLocation}', '${ids.otherOrganization}', 'Other', 'OTHER', 'America/New_York');
    insert into public.organization_memberships (
      organization_id, user_id, role, status, joined_at
    ) values
      ('${ids.organization}', '${ids.owner}', 'owner', 'active', now()),
      ('${ids.organization}', '${ids.admin}', 'admin', 'active', now()),
      ('${ids.organization}', '${ids.manager}', 'manager', 'active', now()),
      ('${ids.otherOrganization}', '${ids.otherOwner}', 'owner', 'active', now());
    insert into public.measurement_units (
      id, organization_id, name, symbol, dimension, is_base
    ) values (
      '${ids.otherUnit}', '${ids.otherOrganization}', 'Other each', 'other-ea', 'count', true
    );
    set role authenticated;
  `);

  await assumeUser(ids.owner, "aal1");
  await expectDatabaseError(
    () => configure(ids.countUnit, "unit.save", {
      name: "Each",
      symbol: "ea",
      dimension: "count",
      isBase: true,
      isActive: true,
    }),
    "42501",
    "Owner without AAL2 catalog command",
  );

  await assumeUser(ids.owner, "aal2");
  const firstUnit = await configure(ids.countUnit, "unit.save", {
    name: "Each",
    symbol: "ea",
    dimension: "count",
    isBase: true,
    isActive: true,
  });
  const replayedUnit = await configure(ids.countUnit, "unit.save", {
    name: "Each",
    symbol: "ea",
    dimension: "count",
    isBase: true,
    isActive: true,
  });
  if (firstUnit.replayed !== false || replayedUnit.replayed !== true) {
    throw new Error("Unit command did not report first execution and exact replay correctly");
  }
  await expectDatabaseError(
    () => configure(ids.countUnit, "unit.save", {
      name: "Changed replay",
      symbol: "ea",
      dimension: "count",
      isBase: true,
      isActive: true,
    }),
    "23505",
    "conflicting operation replay",
  );

  await assumeUser(ids.admin);
  await configure(ids.ounceUnit, "unit.save", {
    name: "Ounce",
    symbol: "oz",
    dimension: "mass",
    isBase: true,
    isActive: true,
  });
  await configure(ids.poundUnit, "unit.save", {
    name: "Pound",
    symbol: "lb",
    dimension: "mass",
    isBase: false,
    isActive: true,
  });
  await configure(ids.conversion, "conversion.save", {
    fromUnitId: ids.poundUnit,
    toUnitId: ids.ounceUnit,
    inventoryItemId: null,
    multiplier: 16,
    isActive: true,
  });
  await configure(ids.category, "category.save", {
    name: "Kitchen",
    parentId: null,
    isActive: true,
  });
  await configure(ids.vendor, "vendor.save", {
    name: "Market Produce",
    accountNumber: "MP-100",
    contactName: "Alex",
    email: "orders@market.test",
    phone: "+1 212 555 0100",
    paymentTerms: "Net 15",
    isActive: true,
  });
  await configure(ids.item, "item.save", {
    name: "Tomatoes",
    sku: "TOMATO",
    description: "Canonical inventory is measured by ounce.",
    categoryId: ids.category,
    baseUnitId: ids.ounceUnit,
    trackInventory: true,
    isActive: true,
  });
  await configure(ids.vendorItem, "vendor_item.save", {
    vendorId: ids.vendor,
    inventoryItemId: ids.item,
    purchaseUnitId: ids.poundUnit,
    vendorSku: "TOM-LB",
    packQuantity: 25,
    lastPriceCents: 4200,
    priceEffectiveAt: "2026-08-01T12:00:00.000Z",
    isPreferred: true,
    isActive: true,
  });
  await configure(ids.par, "par.set", {
    locationId: ids.location,
    inventoryItemId: ids.item,
    parQuantity: 160,
    reorderQuantity: 64,
    effectiveFrom: "2026-08-01",
  });
  await configure(ids.recipe, "recipe.save", {
    name: "Tomato salad",
    yieldQuantity: 1,
    yieldUnitId: ids.countUnit,
    menuPriceCents: 1800,
    isActive: true,
    ingredients: [{
      inventoryItemId: ids.item,
      unitId: ids.poundUnit,
      quantity: 0.5,
      wasteFactor: 0.1,
    }],
  });

  await expectDatabaseError(
    () => configure("cab00000-0000-4000-8000-000000000002", "item.save", {
      name: "Cross-tenant item",
      sku: "CROSS",
      description: null,
      categoryId: null,
      baseUnitId: ids.otherUnit,
      trackInventory: true,
      isActive: true,
    }),
    "23514",
    "cross-tenant resource reference",
  );
  await expectDatabaseError(
    () => configure(
      "cab00000-0000-4000-8000-000000000003",
      "vendor.save",
      { name: "Unauthorized", isActive: true },
      ids.otherOrganization,
    ),
    "42501",
    "cross-tenant organization command",
  );

  await assumeUser(ids.manager);
  await expectDatabaseError(
    () => configure("cab00000-0000-4000-8000-000000000004", "vendor.save", {
      name: "Manager vendor",
      isActive: true,
    }),
    "42501",
    "manager catalog command",
  );
  await expectDatabaseError(
    () => db.exec(`insert into public.vendors (organization_id, name) values ('${ids.organization}', 'Direct insert')`),
    "42501",
    "direct authenticated catalog insert",
  );
  await expectDatabaseError(
    () => db.exec(`update public.inventory_items set name = 'Direct update' where id = '${ids.item}'`),
    "42501",
    "direct authenticated catalog update",
  );
  await expectDatabaseError(
    () => db.exec(`delete from public.inventory_par_levels where id = '${ids.par}'`),
    "42501",
    "direct authenticated catalog delete",
  );

  await assumeUser(ids.admin);
  await configure("cab00000-0000-4000-8000-000000000005", "recipe.save", {
    id: ids.recipe,
    name: "Tomato salad",
    yieldQuantity: 1,
    yieldUnitId: ids.countUnit,
    menuPriceCents: 1800,
    isActive: false,
    ingredients: [{
      inventoryItemId: ids.item,
      unitId: ids.poundUnit,
      quantity: 0.5,
      wasteFactor: 0.1,
    }],
  });
  await configure("cab00000-0000-4000-8000-000000000006", "item.save", {
    id: ids.item,
    name: "Tomatoes",
    sku: "TOMATO",
    description: "Canonical inventory is measured by ounce.",
    categoryId: ids.category,
    baseUnitId: ids.ounceUnit,
    trackInventory: true,
    isActive: false,
  });

  await db.exec("reset role; select set_config('request.jwt.claims', '{}', false)");
  const result = await db.query(`
    select
      (select count(*)::integer from public.measurement_units where id = '${ids.countUnit}') as replay_unit_count,
      (select count(*)::integer from public.item_price_history where source_id = '${ids.vendorItem}') as price_versions,
      (select count(*)::integer from public.inventory_recipe_versions where recipe_id = '${ids.recipe}') as recipe_versions,
      (select count(*)::integer from public.inventory_par_levels where id = '${ids.par}') as par_versions,
      (select is_active from public.inventory_items where id = '${ids.item}') as item_active,
      (select is_active from public.vendor_items where id = '${ids.vendorItem}') as vendor_item_active,
      (select count(*)::integer from private.operation_requests where completed_at is not null) as completed_commands,
      has_function_privilege(
        'authenticated',
        'public.configure_inventory_catalog(uuid,uuid,text,jsonb)',
        'EXECUTE'
      ) as can_execute,
      has_table_privilege('authenticated', 'public.inventory_items', 'INSERT') as can_insert_item,
      has_table_privilege('authenticated', 'public.inventory_items', 'UPDATE') as can_update_item,
      has_table_privilege('authenticated', 'public.inventory_items', 'DELETE') as can_delete_item,
      has_table_privilege('authenticated', 'public.inventory_recipe_versions', 'INSERT') as can_insert_version
  `);
  const checks = result.rows[0];
  if (
    checks.replay_unit_count !== 1
    || checks.price_versions !== 1
    || checks.recipe_versions !== 2
    || checks.par_versions !== 1
    || checks.item_active !== false
    || checks.vendor_item_active !== false
    || checks.completed_commands !== 12
    || !checks.can_execute
    || checks.can_insert_item
    || checks.can_update_item
    || checks.can_delete_item
    || checks.can_insert_version
  ) {
    throw new Error(`Inventory catalog verification failed: ${JSON.stringify(checks)}`);
  }

  process.stdout.write(
    "PASS Owner/Admin actor-derived inventory catalog commands, exact replay, tenant isolation, history, and direct-DML revocation\n",
  );
} finally {
  await db.close();
}
