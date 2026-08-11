import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const root = process.cwd();
const migrationsDirectory = join(root, "supabase", "migrations");
const migrations = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
const ids = {
  org: "20000000-0000-4000-8000-000000000001",
  location: "30000000-0000-4000-8000-000000000001",
  user: "10000000-0000-4000-8000-000000000004",
  reservation: "fa000000-0000-4000-8000-000000000001",
  subscription: "fa100000-0000-4000-8000-000000000001",
  notificationA: "fa200000-0000-4000-8000-000000000001",
  notificationB: "fa200000-0000-4000-8000-000000000002",
  notificationC: "fa200000-0000-4000-8000-000000000003",
  notificationD: "fa200000-0000-4000-8000-000000000004",
  notificationE: "fa200000-0000-4000-8000-000000000005",
  workerA: "fa300000-0000-4000-8000-000000000001",
  workerB: "fa300000-0000-4000-8000-000000000002",
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

function assert(condition, message, evidence) {
  if (!condition)
    throw new Error(
      `${message}${evidence === undefined ? "" : `: ${JSON.stringify(evidence)}`}`,
    );
}

async function expectCode(action, code, label) {
  try {
    await action();
  } catch (error) {
    if (error?.code === code) return;
    throw new Error(`${label} returned ${error?.code ?? "unknown"}; expected ${code}.`, {
      cause: error,
    });
  }
  throw new Error(`${label} unexpectedly succeeded.`);
}

async function assume(role) {
  await db.exec("reset role");
  await db.exec(`set role ${role}`);
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role }),
  ]);
}

async function claim(worker, at) {
  return (
    await db.query(
      `select * from public.service_claim_reservation_push_deliveries(
        $1::uuid, 1, 120, $2::timestamptz
      )`,
      [worker, at],
    )
  ).rows;
}

async function notify(id, at) {
  await db.query(
    `insert into public.notifications (
      id, organization_id, user_id, notification_type, title, body,
      action_url, entity_type, entity_id, created_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'reservation_changed',
      'Reservation changed', 'A reservation changed.', '/reservations',
      'reservation', $4::uuid, $5::timestamptz
    )`,
    [id, ids.org, ids.user, ids.reservation, at],
  );
}

try {
  await db.exec(bootstrap);
  for (const migration of migrations)
    await db.exec(await readFile(join(migrationsDirectory, migration), "utf8"));
  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));

  const t0 = "2035-01-01T17:00:00.000Z";
  await db.query(
    `insert into public.reservations (
      id, organization_id, location_id, reserved_at, duration_minutes,
      party_size, status, source, booking_channel
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::timestamptz + interval '1 day',
      90, 2, 'booked', 'manual', 'staff'
    )`,
    [ids.reservation, ids.org, ids.location, t0],
  );
  await db.query(
    `insert into public.reservation_settings (
      organization_id, location_id, staff_push_enabled
    ) values ($1::uuid, $2::uuid, true)`,
    [ids.org, ids.location],
  );
  await db.query(
    `insert into public.notification_preferences (
      organization_id, user_id, notification_type, push
    ) values ($1::uuid, $2::uuid, 'reservation_changed', true)`,
    [ids.org, ids.user],
  );
  await db.query(
    `insert into public.push_subscriptions (
      id, organization_id, user_id, endpoint_hash, encrypted_subscription
    ) values ($1::uuid, $2::uuid, $3::uuid, $4, decode('aa', 'hex'))`,
    [ids.subscription, ids.org, ids.user, "a".repeat(64)],
  );
  await notify(ids.notificationA, t0);

  await assume("authenticated");
  await expectCode(
    () => claim(ids.workerA, t0),
    "42501",
    "non-service push claim",
  );
  const acl = (
    await db.query(
      `select
        has_table_privilege(
          'service_role', 'public.reservation_push_deliveries', 'select'
        ) table_select,
        has_function_privilege(
          'service_role',
          'public.service_claim_reservation_push_deliveries(uuid,integer,integer,timestamptz)',
          'execute'
        ) claim_execute,
        has_function_privilege(
          'authenticated',
          'public.service_claim_reservation_push_deliveries(uuid,integer,integer,timestamptz)',
          'execute'
        ) authenticated_execute`,
    )
  ).rows[0];
  assert(
    !acl.table_select && acl.claim_execute && !acl.authenticated_execute,
    "Push delivery custody is not function-only",
    acl,
  );

  await assume("service_role");
  assert(
    (await claim(ids.workerA, t0)).length === 0,
    "Unapproved push settings exposed a delivery",
  );
  await db.exec("reset role");
  await db.query(
    `update public.reservation_settings
     set approved_at = $3::timestamptz
     where organization_id = $1::uuid and location_id = $2::uuid`,
    [ids.org, ids.location, t0],
  );
  await assume("service_role");
  const first = await claim(ids.workerA, t0);
  assert(first.length === 1, "Worker A did not claim the delivery", first);
  assert(
    (await claim(ids.workerB, t0)).length === 0,
    "Worker B acquired Worker A's live lease",
  );
  const recoveredAt = "2035-01-01T17:02:01.000Z";
  const recovered = await claim(ids.workerB, recoveredAt);
  assert(
    recovered.length === 1 &&
      recovered[0].id === first[0].id &&
      recovered[0].claimToken !== first[0].claimToken,
    "Stale pre-provider lease did not recover with a rotated token",
    { first: first[0], recovered: recovered[0] },
  );
  await expectCode(
    () =>
      db.query(
        `select public.service_begin_reservation_push_delivery(
          $1::uuid, $2::uuid, $3::timestamptz
        )`,
        [recovered[0].id, first[0].claimToken, recoveredAt],
      ),
    "P0002",
    "stale-token dispatch",
  );
  await db.exec("reset role");
  await db.query(
    `update public.push_subscriptions
     set encrypted_subscription = decode('bb', 'hex')
     where id = $1::uuid`,
    [ids.subscription],
  );
  await assume("service_role");
  const began = (
    await db.query(
      `select public.service_begin_reservation_push_delivery(
        $1::uuid, $2::uuid, $3::timestamptz
      ) result`,
      [recovered[0].id, recovered[0].claimToken, recoveredAt],
    )
  ).rows[0].result;
  assert(
    began.status === "dispatching" &&
      began.attempts === 1 &&
      began.encryptedSubscription === "\\xbb" &&
      began.title === "Reservation changed" &&
      began.body === "A reservation changed." &&
      began.actionUrl === "/reservations",
    "Dispatch fence did not return the exact current provider payload",
    began,
  );
  const sent = (
    await db.query(
      `select public.service_complete_reservation_push_delivery(
        $1::uuid, $2::uuid, 'sent', null, null, 201, false,
        '2035-01-01T17:02:02Z'::timestamptz
      ) result`,
      [recovered[0].id, recovered[0].claimToken],
    )
  ).rows[0].result;
  assert(sent.status === "sent" && sent.attempts === 1, "Sent was not durable", sent);

  await db.exec("reset role");
  await notify(ids.notificationE, "2035-01-01T17:02:30Z");
  await assume("service_role");
  const optedOut = (await claim(ids.workerA, "2035-01-01T17:02:30Z"))[0];
  assert(optedOut, "Opt-out race fixture was not claimed");
  await db.exec("reset role");
  await db.query(
    `update public.notification_preferences set push = false
     where organization_id = $1::uuid and user_id = $2::uuid
       and notification_type = 'reservation_changed'`,
    [ids.org, ids.user],
  );
  await assume("service_role");
  const optedOutBegin = (
    await db.query(
      `select public.service_begin_reservation_push_delivery(
        $1::uuid, $2::uuid, '2035-01-01T17:02:31Z'::timestamptz
      ) result`,
      [optedOut.id, optedOut.claimToken],
    )
  ).rows[0].result;
  assert(
    optedOutBegin.status === "cancelled",
    "A committed opt-out before begin still produced a dispatch",
    optedOutBegin,
  );
  await db.exec("reset role");
  await db.query(
    `update public.notification_preferences set push = true
     where organization_id = $1::uuid and user_id = $2::uuid
       and notification_type = 'reservation_changed'`,
    [ids.org, ids.user],
  );

  await db.exec("reset role");
  await notify(ids.notificationB, "2035-01-01T17:03:00Z");
  await assume("service_role");
  const uncertain = (await claim(ids.workerA, "2035-01-01T17:03:00Z"))[0];
  await db.query(
    `select public.service_begin_reservation_push_delivery(
      $1::uuid, $2::uuid, '2035-01-01T17:03:00Z'::timestamptz
    )`,
    [uncertain.id, uncertain.claimToken],
  );
  assert(
    (await claim(ids.workerB, "2035-01-01T17:05:01Z")).length === 0,
    "An expired provider attempt was replayed",
  );
  await db.exec("reset role");
  const uncertainState = (
    await db.query(
      `select status, last_error_code, claim_token
       from public.reservation_push_deliveries where id = $1::uuid`,
      [uncertain.id],
    )
  ).rows[0];
  assert(
    uncertainState.status === "uncertain" &&
      uncertainState.last_error_code === "provider_outcome_unknown_after_lease" &&
      uncertainState.claim_token === null,
    "Expired provider attempt did not become terminally uncertain",
    uncertainState,
  );

  await notify(ids.notificationC, "2035-01-01T17:06:00Z");
  await assume("service_role");
  const failed = (await claim(ids.workerA, "2035-01-01T17:06:00Z"))[0];
  await db.query(
    `select public.service_begin_reservation_push_delivery(
      $1::uuid, $2::uuid, '2035-01-01T17:06:00Z'::timestamptz
    )`,
    [failed.id, failed.claimToken],
  );
  const failure = (
    await db.query(
      `select public.service_complete_reservation_push_delivery(
        $1::uuid, $2::uuid, 'failed', 'provider_http_503',
        '2035-01-01T17:10:00Z'::timestamptz, 503, false,
        '2035-01-01T17:06:01Z'::timestamptz
      ) result`,
      [failed.id, failed.claimToken],
    )
  ).rows[0].result;
  assert(failure.status === "failed", "Failure was not durable", failure);
  assert(
    (await claim(ids.workerB, "2035-01-01T17:09:59Z")).length === 0,
    "Failed delivery retried early",
  );
  const retry = await claim(ids.workerB, "2035-01-01T17:10:00Z");
  assert(retry.length === 1 && retry[0].id === failed.id, "Due retry was not claimed", retry);
  await db.query(
    `select public.service_complete_reservation_push_delivery(
      $1::uuid, $2::uuid, 'cancelled', 'subscription_ciphertext_invalid',
      null, null, true, '2035-01-01T17:10:01Z'::timestamptz
    )`,
    [retry[0].id, retry[0].claimToken],
  );

  await db.exec("reset role");
  await notify(ids.notificationD, "2035-01-01T17:11:00Z");
  await assume("service_role");
  assert(
    (await claim(ids.workerA, "2035-01-01T17:11:00Z")).length === 0,
    "Blocked subscription produced a new claim",
  );
  await db.exec("reset role");
  const evidence = (
    await db.query(
      `select count(*)::integer count from public.reservation_push_deliveries
       where subscription_id = $1::uuid and notification_id = $2::uuid
         and status = 'cancelled'`,
      [ids.subscription, ids.notificationC],
    )
  ).rows[0].count;
  assert(evidence === 1, "Subscription block deleted delivery evidence", evidence);

  await db.query(
    `update public.push_subscriptions set encrypted_subscription = decode('bb', 'hex')
     where id = $1::uuid`,
    [ids.subscription],
  );
  await assume("service_role");
  assert(
    (await claim(ids.workerA, "2035-01-01T17:11:01Z")).length === 1,
    "Saving fresh subscription evidence did not clear its block",
  );

  process.stdout.write(
    "PASS reservation push service-only leases, token fencing, bounded recovery, retries, and uncertain non-replay\n",
  );
} finally {
  await db.close();
}
