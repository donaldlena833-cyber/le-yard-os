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
  downtown: "30000000-0000-4000-8000-000000000001",
  uptown: "30000000-0000-4000-8000-000000000002",
  owner: "10000000-0000-4000-8000-000000000001",
  admin: "10000000-0000-4000-8000-000000000003",
  manager: "10000000-0000-4000-8000-000000000004",
  employee: "10000000-0000-4000-8000-000000000005",
  managerEmployee: "50000000-0000-4000-8000-000000000004",
  employeeRecord: "50000000-0000-4000-8000-000000000005",
  item: "72000000-0000-4000-8000-000000000001",
  unit: "70000000-0000-4000-8000-000000000002",
  vendor: "73000000-0000-4000-8000-000000000001",
  creatorRole: "da000000-0000-4000-8000-000000000001",
  reviewerRole: "db000000-0000-4000-8000-000000000001",
  ownerCount: "d1000000-0000-4000-8000-000000000001",
  employeeCount: "d1000000-0000-4000-8000-000000000002",
  countReview: "d1000000-0000-4000-8000-000000000003",
  purchaseOrder: "d2000000-0000-4000-8000-000000000001",
  deniedPurchaseOrder: "d2000000-0000-4000-8000-000000000002",
  delivery: "d3000000-0000-4000-8000-000000000001",
  expiredDelivery: "d3000000-0000-4000-8000-000000000002",
  exceptionOrder: "d3000000-0000-4000-8000-000000000003",
  exceptionDelivery: "d3000000-0000-4000-8000-000000000004",
  exceptionReview: "d3000000-0000-4000-8000-000000000005",
  exceptionPosting: "d3000000-0000-4000-8000-000000000006",
  waste: "d4000000-0000-4000-8000-000000000001",
  wasteReview: "d4000000-0000-4000-8000-000000000002",
  transfer: "d5000000-0000-4000-8000-000000000001",
  transferReview: "d5000000-0000-4000-8000-000000000002",
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

function claimsFor(userId) {
  return JSON.stringify({ role: "authenticated", sub: userId, aal: "aal1" });
}

async function assumeUser(userId) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [claimsFor(userId)]);
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

async function observeDatabaseError(action, label) {
  try {
    await action();
  } catch (error) {
    if (!error || typeof error !== "object") {
      throw new Error(`${label} returned a non-object database error`);
    }
    return {
      code: typeof error.code === "string" ? error.code : null,
      detail: typeof error.detail === "string" ? error.detail : null,
      hint: typeof error.hint === "string" ? error.hint : null,
      message: error instanceof Error ? error.message : String(error),
    };
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

async function expectEquivalentDatabaseErrors(cases, expected, label) {
  const observations = [];
  for (const testCase of cases) {
    observations.push({
      case: testCase.label,
      error: await observeDatabaseError(testCase.action, `${label}: ${testCase.label}`),
    });
  }
  const baseline = observations[0]?.error;
  if (
    !baseline
    || baseline.code !== expected.code
    || baseline.message !== expected.message
    || observations.some(
      (observation) => JSON.stringify(observation.error) !== JSON.stringify(baseline),
    )
  ) {
    throw new Error(
      `${label} exposed distinguishable database errors: ${JSON.stringify(observations)}`,
    );
  }
}

const countLines = JSON.stringify([{
  inventory_item_id: ids.item,
  unit_id: ids.unit,
  counted_quantity: 100,
  notes: null,
}]);
const purchaseLines = JSON.stringify([{
  inventory_item_id: ids.item,
  unit_id: ids.unit,
  quantity: 10,
  unit_price_cents: 200,
  notes: null,
}]);
const deliveryLines = JSON.stringify([{
  inventory_item_id: ids.item,
  unit_id: ids.unit,
  quantity: 10,
  accepted_quantity: 10,
  unit_price_cents: 200,
  lot_code: "CAP-LOT",
  expires_on: null,
}]);
const exceptionDeliveryLines = JSON.stringify([{
  inventory_item_id: ids.item,
  unit_id: ids.unit,
  quantity: 5,
  accepted_quantity: 3,
  unit_price_cents: 200,
  lot_code: "DAMAGED-LOT",
  expires_on: null,
  exception_kind: "damaged",
  exception_note: "Two units crushed in transit",
}]);
const transferLines = JSON.stringify([{
  inventory_item_id: ids.item,
  unit_id: ids.unit,
  sent_quantity: 2,
}]);
const transferReviewLines = JSON.stringify([{
  inventory_item_id: ids.item,
  unit_id: ids.unit,
  received_quantity: 2,
}]);

const inaccessibleTargets = {
  count: "d1000000-0000-4000-8000-000000000099",
  waste: "d4000000-0000-4000-8000-000000000099",
  transfer: "d5000000-0000-4000-8000-000000000099",
};

function countReviewAction(requestId, targetId, note) {
  return () => db.query(
    "select public.approve_inventory_count($1::uuid, $2::uuid, true, $3::text)",
    [requestId, targetId, note],
  );
}

function wasteReviewAction(requestId, targetId, note) {
  return () => db.query(
    "select public.review_waste_record($1::uuid, $2::uuid, true, $3::text)",
    [requestId, targetId, note],
  );
}

function transferReviewAction(requestId, targetId, note) {
  return () => db.query(
    "select public.review_inventory_transfer($1::uuid, $2::uuid, true, $3::text, $4::jsonb)",
    [requestId, targetId, note, transferReviewLines],
  );
}

const reviewContracts = [
  {
    action: countReviewAction,
    collisionRequest: ids.countReview,
    existingTarget: ids.employeeCount,
    genericMessage: "Not authorized to review this inventory count",
    label: "inventory count review",
    missingTarget: inaccessibleTargets.count,
    requestPrefix: "d1100000-0000-4000-8000-0000000000",
  },
  {
    action: wasteReviewAction,
    collisionRequest: ids.wasteReview,
    existingTarget: ids.waste,
    genericMessage: "Not authorized to review this waste record",
    label: "waste review",
    missingTarget: inaccessibleTargets.waste,
    requestPrefix: "d4100000-0000-4000-8000-0000000000",
  },
  {
    action: transferReviewAction,
    collisionRequest: ids.transferReview,
    existingTarget: ids.transfer,
    genericMessage: "Not authorized to review this transfer at its destination",
    label: "transfer review",
    missingTarget: inaccessibleTargets.transfer,
    requestPrefix: "d5100000-0000-4000-8000-0000000000",
  },
];

try {
  await db.exec(platformBootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }
  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));

  await db.exec(`
    insert into public.location_memberships (
      id, organization_id, location_id, user_id, is_primary
    ) values
      (
        'dd000000-0000-4000-8000-000000000001', '${ids.organization}',
        '${ids.uptown}', '${ids.employee}', false
      ),
      (
        'dd000000-0000-4000-8000-000000000002', '${ids.organization}',
        '${ids.uptown}', '${ids.manager}', false
      )
    on conflict (location_id, user_id) do nothing;

    insert into public.job_roles (
      id, organization_id, name, code, department, default_tip_points, is_tipped
    ) values
      ('${ids.creatorRole}', '${ids.organization}', 'Inventory Creator', 'INV_CREATOR', 'Operations', 0, false),
      ('${ids.reviewerRole}', '${ids.organization}', 'Inventory Reviewer', 'INV_REVIEWER', 'Operations', 0, false);

    insert into public.employee_job_roles (
      id, organization_id, employee_id, job_role_id, location_id,
      effective_from, is_primary
    ) values
      (
        'de000000-0000-4000-8000-000000000001', '${ids.organization}',
        '${ids.employeeRecord}', '${ids.creatorRole}', '${ids.downtown}',
        date '2020-01-01', true
      ),
      (
        'de000000-0000-4000-8000-000000000002', '${ids.organization}',
        '${ids.managerEmployee}', '${ids.reviewerRole}', '${ids.downtown}',
        date '2020-01-01', true
      ),
      (
        'de000000-0000-4000-8000-000000000003', '${ids.organization}',
        '${ids.managerEmployee}', '${ids.reviewerRole}', '${ids.uptown}',
        date '2020-01-01', false
      );

    insert into public.job_role_capabilities (
      organization_id, job_role_id, capability_key, location_id,
      effective_from, effective_to, is_active, created_by, updated_by
    ) values
      ('${ids.organization}', '${ids.creatorRole}', 'inventory.count.create', null,
        date '2020-01-01', null, true, '${ids.owner}', '${ids.owner}'),
      ('${ids.organization}', '${ids.creatorRole}', 'inventory.purchase.create', null,
        date '2020-01-01', null, true, '${ids.owner}', '${ids.owner}'),
      ('${ids.organization}', '${ids.creatorRole}', 'inventory.waste.create', null,
        date '2020-01-01', null, true, '${ids.owner}', '${ids.owner}'),
      ('${ids.organization}', '${ids.creatorRole}', 'inventory.transfer.create', null,
        date '2020-01-01', null, true, '${ids.owner}', '${ids.owner}'),
      ('${ids.organization}', '${ids.creatorRole}', 'inventory.receive', null,
        date '2020-01-01', date '2020-12-31', true, '${ids.owner}', '${ids.owner}'),
      ('${ids.organization}', '${ids.reviewerRole}', 'inventory.count.approve', null,
        date '2020-01-01', null, true, '${ids.owner}', '${ids.owner}'),
      ('${ids.organization}', '${ids.reviewerRole}', 'inventory.waste.approve', null,
        date '2020-01-01', null, true, '${ids.owner}', '${ids.owner}'),
      ('${ids.organization}', '${ids.reviewerRole}', 'inventory.transfer.approve', null,
        date '2020-01-01', null, true, '${ids.owner}', '${ids.owner}'),
      ('${ids.organization}', '${ids.reviewerRole}', 'inventory.purchase.approve', null,
        date '2020-01-01', null, true, '${ids.owner}', '${ids.owner}'),
      ('${ids.organization}', '${ids.reviewerRole}', 'inventory.purchase.create', null,
        date '2020-01-01', null, true, '${ids.owner}', '${ids.owner}');

    insert into public.user_capability_overrides (
      organization_id, user_id, capability_key, location_id, effect, reason,
      effective_from, effective_to, is_active, created_by, updated_by
    ) values
      ('${ids.organization}', '${ids.employee}', 'inventory.count.approve', '${ids.downtown}',
        'grant', 'Expired target-enumeration proof', date '2020-01-01', date '2020-12-31', true,
        '${ids.admin}', '${ids.admin}'),
      ('${ids.organization}', '${ids.employee}', 'inventory.waste.approve', '${ids.downtown}',
        'grant', 'Expired target-enumeration proof', date '2020-01-01', date '2020-12-31', true,
        '${ids.admin}', '${ids.admin}'),
      ('${ids.organization}', '${ids.employee}', 'inventory.transfer.approve', '${ids.uptown}',
        'grant', 'Expired target-enumeration proof', date '2020-01-01', date '2020-12-31', true,
        '${ids.admin}', '${ids.admin}');

    insert into public.inventory_transactions (
      id, organization_id, location_id, inventory_item_id, unit_id,
      transaction_kind, quantity_delta, unit_cost_cents, occurred_at,
      reference_type, reason, created_by
    ) values (
      'df000000-0000-4000-8000-000000000001', '${ids.organization}',
      '${ids.downtown}', '${ids.item}', '${ids.unit}',
      'manual_adjustment', 100, 200, clock_timestamp(),
      'capability_verifier', 'Inventory capability verifier opening stock', '${ids.admin}'
    );

    set role authenticated;
  `);
  await assumeUser(ids.employee);

  const initialCapabilities = (await db.query(
    `select
      public.has_capability($1::uuid, $2::uuid, 'inventory.count.create') as can_count,
      public.has_capability($1::uuid, $2::uuid, 'inventory.count.approve') as can_approve_count,
      public.has_capability($1::uuid, $2::uuid, 'inventory.receive') as can_receive,
      public.has_capability($1::uuid, $3::uuid, 'inventory.waste.create') as can_waste_uptown`,
    [ids.organization, ids.downtown, ids.uptown],
  )).rows[0];
  if (
    !initialCapabilities.can_count
    || initialCapabilities.can_approve_count
    || initialCapabilities.can_receive
    || initialCapabilities.can_waste_uptown
  ) {
    throw new Error(`Initial exact capability matrix failed: ${JSON.stringify(initialCapabilities)}`);
  }

  await expectDatabaseError(
    () => db.query(
      `select public.receive_inventory_delivery(
        $1::uuid, $2::uuid, $3::uuid, null::uuid, clock_timestamp(),
        'EXPIRED-CAP', null::text, $4::jsonb
      )`,
      [ids.expiredDelivery, ids.downtown, ids.vendor, deliveryLines],
    ),
    "42501",
    "expired receive capability",
  );
  await expectDatabaseError(
    () => db.query(
      `select public.submit_waste_record(
        'd4000000-0000-4000-8000-000000000099'::uuid,
        $1::uuid, $2::uuid, $3::uuid, 1::numeric,
        'cross_location', clock_timestamp(), null::text
      )`,
      [ids.uptown, ids.item, ids.unit],
    ),
    "42501",
    "cross-location waste capability",
  );

  await assumeUser(ids.owner);
  await db.query(
    `select public.submit_inventory_count(
      $1::uuid, $2::uuid, 'spot', 'Owner capability coverage', $3::jsonb
    )`,
    [ids.ownerCount, ids.downtown, countLines],
  );

  await assumeUser(ids.employee);
  await expectDatabaseError(
    () => db.query(
      "select public.approve_inventory_count($1::uuid, $2::uuid, true, 'Create is not approve')",
      ["d1000000-0000-4000-8000-000000000099", ids.ownerCount],
    ),
    "42501",
    "create-only count approval",
  );
  await db.query(
    `select public.submit_inventory_count(
      $1::uuid, $2::uuid, 'spot', 'Capability employee count', $3::jsonb
    )`,
    [ids.employeeCount, ids.downtown, countLines],
  );
  await db.query(
    `select public.create_purchase_order(
      $1::uuid, $2::uuid, $3::uuid, 'CAP-PO-1', current_date,
      current_date + 1, 0::bigint, 0::bigint, null::text, $4::jsonb
    )`,
    [ids.purchaseOrder, ids.downtown, ids.vendor, purchaseLines],
  );
  await db.query(
    `select public.submit_waste_record(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1::numeric,
      'quality', clock_timestamp(), 'Capability waste'
    )`,
    [ids.waste, ids.downtown, ids.item, ids.unit],
  );
  await db.query(
    `select public.create_inventory_transfer(
      $1::uuid, $2::uuid, $3::uuid, 'Capability transfer', $4::jsonb
    )`,
    [ids.transfer, ids.downtown, ids.uptown, transferLines],
  );

  for (const contract of reviewContracts) {
    await expectEquivalentDatabaseErrors(
      [
        {
          label: "expired capability against existing target",
          action: contract.action(
            `${contract.requestPrefix}01`,
            contract.existingTarget,
            "Expired capability probe",
          ),
        },
        {
          label: "expired capability against nonexistent target",
          action: contract.action(
            `${contract.requestPrefix}02`,
            contract.missingTarget,
            "Expired capability probe",
          ),
        },
      ],
      { code: "42501", message: contract.genericMessage },
      `${contract.label} expired-target equivalence`,
    );
  }

  await db.exec(`
    reset role;
    insert into public.user_capability_overrides (
      organization_id, user_id, capability_key, location_id, effect, reason,
      effective_from, effective_to, is_active, created_by, updated_by
    ) values
      ('${ids.organization}', '${ids.employee}', 'inventory.count.approve', '${ids.uptown}',
        'grant', 'Cross-location target-enumeration proof', date '2022-01-01', null, true,
        '${ids.admin}', '${ids.admin}'),
      ('${ids.organization}', '${ids.employee}', 'inventory.waste.approve', '${ids.uptown}',
        'grant', 'Cross-location target-enumeration proof', date '2022-01-01', null, true,
        '${ids.admin}', '${ids.admin}'),
      ('${ids.organization}', '${ids.employee}', 'inventory.transfer.approve', '${ids.downtown}',
        'grant', 'Cross-location target-enumeration proof', date '2022-01-01', null, true,
        '${ids.admin}', '${ids.admin}');
    set role authenticated;
  `);
  await assumeUser(ids.employee);
  for (const contract of reviewContracts) {
    await expectEquivalentDatabaseErrors(
      [
        {
          label: "wrong-location grant against existing target",
          action: contract.action(
            `${contract.requestPrefix}03`,
            contract.existingTarget,
            "Cross-location capability probe",
          ),
        },
        {
          label: "wrong-location grant against nonexistent target",
          action: contract.action(
            `${contract.requestPrefix}04`,
            contract.missingTarget,
            "Cross-location capability probe",
          ),
        },
      ],
      { code: "42501", message: contract.genericMessage },
      `${contract.label} cross-location target equivalence`,
    );
  }

  await db.exec(`
    reset role;
    insert into public.job_role_capabilities (
      organization_id, job_role_id, capability_key, location_id,
      effective_from, effective_to, is_active, created_by, updated_by
    ) values
      ('${ids.organization}', '${ids.creatorRole}', 'inventory.receive', null,
       date '2021-01-01', null, true, '${ids.owner}', '${ids.owner}'),
      ('${ids.organization}', '${ids.reviewerRole}', 'inventory.receive', null,
       date '2021-01-01', null, true, '${ids.owner}', '${ids.owner}');
    set role authenticated;
  `);
  await assumeUser(ids.manager);
  await db.query(
    "select public.review_purchase_order($1::uuid, $2::uuid, true, 'Independent receiving approval')",
    ["d2000000-0000-4000-8000-000000000003", ids.purchaseOrder],
  );
  await assumeUser(ids.employee);
  await db.query(
    `select public.receive_inventory_delivery(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, clock_timestamp(),
      'CAP-INV-1', null::text, $5::jsonb
    )`,
    [ids.delivery, ids.downtown, ids.vendor, ids.purchaseOrder, deliveryLines],
  );
  await db.query(
    `select public.create_purchase_order(
      $1::uuid, $2::uuid, $3::uuid, 'CAP-PO-EXCEPTION', current_date,
      current_date, 0, 0, 'Exception review proof', $4::jsonb
    )`,
    [ids.exceptionOrder, ids.downtown, ids.vendor, JSON.stringify([{ inventory_item_id: ids.item, unit_id: ids.unit, quantity: 5, unit_price_cents: 200, notes: null }])],
  );
  await assumeUser(ids.manager);
  await db.query("select public.review_purchase_order($1::uuid,$2::uuid,true,'Review exception order')", ["d3000000-0000-4000-8000-000000000007", ids.exceptionOrder]);
  await assumeUser(ids.employee);
  await db.query(
    `select public.receive_inventory_delivery_with_exceptions(
      $1::uuid,$2::uuid,$3::uuid,$4::uuid,clock_timestamp(),
      'CAP-INV-EXCEPTION',null::text,$5::jsonb
    )`,
    [ids.exceptionDelivery, ids.downtown, ids.vendor, ids.exceptionOrder, exceptionDeliveryLines],
  );
  await expectDatabaseError(
    () => db.query("select public.review_delivery_receiving_exceptions($1::uuid,$2::uuid,$3::uuid,true,'Self review')", [ids.exceptionReview, ids.exceptionPosting, ids.exceptionDelivery]),
    "42501",
    "self-reviewed delivery exception",
  );
  await assumeUser(ids.manager);
  await db.query(
    "select public.review_delivery_receiving_exceptions($1::uuid,$2::uuid,$3::uuid,true,'Damage verified')",
    [ids.exceptionReview, ids.exceptionPosting, ids.exceptionDelivery],
  );
  const exceptionEvidence = (await db.query(`select
    (select status from public.delivery_receiving_batches where delivery_id='${ids.exceptionDelivery}') as status,
    (select corrective_delivery_id from public.delivery_receiving_batches where delivery_id='${ids.exceptionDelivery}') as corrective_delivery_id,
    (select count(*)::int from public.delivery_receiving_exceptions where delivery_id='${ids.exceptionDelivery}') as exception_count,
    (select count(*)::int from public.inventory_transactions where reference_id='${ids.exceptionPosting}' and quantity_delta=3) as corrective_posts
  `)).rows[0];
  if (exceptionEvidence.status !== "approved" || exceptionEvidence.corrective_delivery_id !== ids.exceptionPosting || exceptionEvidence.exception_count !== 1 || exceptionEvidence.corrective_posts !== 1) {
    throw new Error(`Delivery exception review evidence failed: ${JSON.stringify(exceptionEvidence)}`);
  }
  await db.exec(`
    reset role;
    update public.job_role_capabilities
    set is_active = false
    where organization_id = '${ids.organization}'
      and job_role_id = '${ids.reviewerRole}'
      and capability_key = 'inventory.receive';
    set role authenticated;
  `);

  await db.exec(`
    reset role;
    insert into public.user_capability_overrides (
      organization_id, user_id, capability_key, location_id, effect, reason,
      effective_from, effective_to, is_active, created_by, updated_by
    ) values
      ('${ids.organization}', '${ids.employee}', 'inventory.count.approve', '${ids.downtown}',
        'grant', 'Self-review boundary proof', date '2022-01-01', null, true, '${ids.admin}', '${ids.admin}'),
      ('${ids.organization}', '${ids.employee}', 'inventory.waste.approve', '${ids.downtown}',
        'grant', 'Self-review boundary proof', date '2022-01-01', null, true, '${ids.admin}', '${ids.admin}'),
      ('${ids.organization}', '${ids.employee}', 'inventory.transfer.approve', '${ids.uptown}',
        'grant', 'Self-review boundary proof', date '2022-01-01', null, true, '${ids.admin}', '${ids.admin}');
    set role authenticated;
  `);
  await assumeUser(ids.employee);
  await expectDatabaseError(
    () => db.query(
      "select public.approve_inventory_count($1::uuid, $2::uuid, true, 'Self review')",
      ["d1000000-0000-4000-8000-000000000098", ids.employeeCount],
    ),
    "42501",
    "self-reviewed count",
  );
  await expectDatabaseError(
    () => db.query(
      "select public.review_waste_record($1::uuid, $2::uuid, true, 'Self review')",
      ["d4000000-0000-4000-8000-000000000098", ids.waste],
    ),
    "42501",
    "self-reviewed waste",
  );
  await expectDatabaseError(
    () => db.query(
      "select public.review_inventory_transfer($1::uuid, $2::uuid, true, 'Self review', $3::jsonb)",
      ["d5000000-0000-4000-8000-000000000098", ids.transfer, transferReviewLines],
    ),
    "42501",
    "self-reviewed transfer",
  );

  await assumeUser(ids.manager);
  await db.query(
    "select public.approve_inventory_count($1::uuid, $2::uuid, true, 'Independent review')",
    [ids.countReview, ids.employeeCount],
  );
  await db.query(
    "select public.review_waste_record($1::uuid, $2::uuid, true, 'Independent review')",
    [ids.wasteReview, ids.waste],
  );
  await db.query(
    "select public.review_inventory_transfer($1::uuid, $2::uuid, true, 'Independent review', $3::jsonb)",
    [ids.transferReview, ids.transfer, transferReviewLines],
  );

  await db.exec(`
    reset role;
    insert into public.user_capability_overrides (
      organization_id, user_id, capability_key, location_id, effect, reason,
      effective_from, effective_to, is_active, created_by, updated_by
    )
    select '${ids.organization}'::uuid, '${ids.manager}'::uuid, capability_key,
      location_id, 'deny', 'Explicit-deny RLS and command proof',
      date '2023-01-01', null::date, true, '${ids.admin}'::uuid, '${ids.admin}'::uuid
    from unnest(array['${ids.downtown}'::uuid, '${ids.uptown}'::uuid]) location_id
    cross join unnest(array[
      'inventory.count.approve',
      'inventory.waste.approve',
      'inventory.transfer.approve',
      'inventory.purchase.create',
      'inventory.purchase.approve'
    ]::text[]) capability_key;
    set role authenticated;
  `);
  await assumeUser(ids.manager);
  await expectDatabaseError(
    () => db.query(
      `select public.create_purchase_order(
        $1::uuid, $2::uuid, $3::uuid, 'CAP-PO-DENIED', current_date,
        current_date + 1, 0::bigint, 0::bigint, null::text, $4::jsonb
      )`,
      [ids.deniedPurchaseOrder, ids.downtown, ids.vendor, purchaseLines],
    ),
    "42501",
    "explicitly denied Manager purchase",
  );

  for (const contract of reviewContracts) {
    await expectEquivalentDatabaseErrors(
      [
        {
          label: "explicit deny against existing target",
          action: contract.action(
            `${contract.requestPrefix}05`,
            contract.existingTarget,
            "Denied capability probe",
          ),
        },
        {
          label: "explicit deny against nonexistent target",
          action: contract.action(
            `${contract.requestPrefix}06`,
            contract.missingTarget,
            "Denied capability probe",
          ),
        },
        {
          label: "completed request collision against nonexistent target",
          action: contract.action(
            contract.collisionRequest,
            contract.missingTarget,
            "Request collision probe",
          ),
        },
      ],
      { code: "42501", message: contract.genericMessage },
      `${contract.label} deny/nonexistent/request-collision equivalence`,
    );
  }

  const deniedReads = (await db.query(`
    select
      (select count(*)::int from public.inventory_counts
        where id in ('${ids.ownerCount}', '${ids.employeeCount}')) as counts,
      (select count(*)::int from public.inventory_count_lines
        where inventory_count_id in ('${ids.ownerCount}', '${ids.employeeCount}')) as count_lines,
      (select count(*)::int from public.purchase_orders where id = '${ids.purchaseOrder}') as purchase_orders,
      (select count(*)::int from public.purchase_order_lines
        where purchase_order_id = '${ids.purchaseOrder}') as purchase_order_lines,
      (select count(*)::int from public.deliveries where id = '${ids.delivery}') as deliveries,
      (select count(*)::int from public.delivery_lines where delivery_id = '${ids.delivery}') as delivery_lines,
      (select count(*)::int from public.waste_records where id = '${ids.waste}') as waste_records,
      (select count(*)::int from public.inventory_transfers where id = '${ids.transfer}') as transfers,
      (select count(*)::int from public.inventory_transfer_lines where transfer_id = '${ids.transfer}') as transfer_lines,
      (select count(*)::int from public.inventory_transactions
        where reference_id in ('${ids.employeeCount}', '${ids.delivery}', '${ids.waste}', '${ids.transfer}')) as transactions
  `)).rows[0];
  if (Object.values(deniedReads).some((value) => value !== 0)) {
    throw new Error(`Explicit-deny SELECT policies leaked rows: ${JSON.stringify(deniedReads)}`);
  }

  await db.exec("reset role; select set_config('request.jwt.claims', '{}', false)");
  const evidence = (await db.query(`
    select
      (select status::text from public.inventory_counts where id = '${ids.employeeCount}') as count_status,
      (select status::text from public.purchase_orders where id = '${ids.purchaseOrder}') as purchase_status,
      (select count(*)::int from public.deliveries where id = '${ids.delivery}') as delivery_count,
      (select status::text from public.waste_records where id = '${ids.waste}') as waste_status,
      (select status::text from public.inventory_transfers where id = '${ids.transfer}') as transfer_status,
      (select count(*)::int from public.inventory_transactions
        where reference_id in ('${ids.delivery}', '${ids.waste}', '${ids.transfer}')) as ledger_rows
  `)).rows[0];
  if (
    evidence.count_status !== "approved"
    || evidence.purchase_status !== "received"
    || evidence.delivery_count !== 1
    || evidence.waste_status !== "approved"
    || evidence.transfer_status !== "received"
    || evidence.ledger_rows < 4
  ) {
    throw new Error(`Inventory capability workflow evidence failed: ${JSON.stringify(evidence)}`);
  }

  const expectedFunctions = new Map([
    ["submit_inventory_count", "inventory.count.create"],
    ["approve_inventory_count", "inventory.count.approve"],
    ["create_purchase_order", "inventory.purchase.create"],
    ["receive_inventory_delivery", "inventory.receive"],
    ["receive_inventory_delivery_with_exceptions", "inventory.receive"],
    ["review_delivery_receiving_exceptions", "inventory.receive"],
    ["submit_waste_record", "inventory.waste.create"],
    ["review_waste_record", "inventory.waste.approve"],
    ["create_inventory_transfer", "inventory.transfer.create"],
    ["review_inventory_transfer", "inventory.transfer.approve"],
  ]);
  const functionRows = (await db.query(`
    select p.proname as name, pg_get_functiondef(p.oid) as definition,
      has_function_privilege('authenticated', p.oid, 'EXECUTE') as authenticated_execute,
      has_function_privilege('anon', p.oid, 'EXECUTE') as anon_execute
    from pg_proc p
    where p.pronamespace = 'public'::regnamespace
      and p.proname = any($1::text[])
    order by p.proname
  `, [[...expectedFunctions.keys()]])).rows;
  if (functionRows.length !== expectedFunctions.size) {
    throw new Error(`Expected ${expectedFunctions.size} inventory RPCs, found ${functionRows.length}`);
  }
  for (const row of functionRows) {
    const capability = expectedFunctions.get(row.name);
    if (
      !capability
      || !row.definition.includes(`'${capability}'`)
      || row.definition.includes("can_manage_location")
      || !row.authenticated_execute
      || row.anon_execute
    ) {
      throw new Error(`Inventory RPC grant/capability contract failed: ${JSON.stringify(row)}`);
    }
  }

  const stalePolicies = (await db.query(`
    select schemaname, tablename, policyname, qual
    from pg_policies
    where schemaname = 'public'
      and tablename = any(array[
        'inventory_counts', 'inventory_count_lines', 'purchase_orders',
        'purchase_order_lines', 'deliveries', 'delivery_lines', 'waste_records',
        'inventory_transfers', 'inventory_transfer_lines', 'inventory_transactions'
      ])
      and cmd in ('SELECT', 'ALL')
      and (
        policyname = any(array[
          'manager_location_read', 'count_line_read', 'po_line_read',
          'delivery_line_read', 'transfer_read', 'transfer_line_read',
          'count_line_write', 'po_line_write', 'delivery_line_write',
          'transfer_write', 'transfer_line_write'
        ])
        or coalesce(qual, '') ~ 'can_(read_management|manage)_location'
      )
  `)).rows;
  if (stalePolicies.length > 0) {
    throw new Error(`Legacy role-OR inventory SELECT policies remain: ${JSON.stringify(stalePolicies)}`);
  }

  process.stdout.write(
    "PASS exact inventory capabilities: all ten RPCs, Owner coverage, grants, expiry, location isolation, create/approve separation, self-review, target/request non-enumeration, explicit-deny RLS, and function grants\n",
  );
} finally {
  await db.close();
}
