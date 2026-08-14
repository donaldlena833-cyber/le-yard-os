import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { requireLocalPostgresControlUrl } from "./lib/require-local-postgres-control-url.mjs";

const suppliedConnectionString = process.env.RESERVATION_TEST_DATABASE_URL;
requireLocalPostgresControlUrl(
  suppliedConnectionString,
  "RESERVATION_TEST_DATABASE_URL",
);

const root = process.cwd();
const migrationDirectory = join(root, "supabase", "migrations");
const migrationFiles = (await readdir(migrationDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const runId = randomUUID().replaceAll("-", "");
const databaseName = `reservation_concurrency_${runId}`;
const markerSchema = `reservation_concurrency_run_${runId}`;
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const testUrl = new URL(suppliedConnectionString);
testUrl.pathname = `/${databaseName}`;

const ids = {
  organization: "20000000-0000-4000-8000-000000000001",
  location: "30000000-0000-4000-8000-000000000001",
  owner: "10000000-0000-4000-8000-000000000001",
  area: randomUUID(),
  tableA: randomUUID(),
  tableB: randomUUID(),
  dinnerPeriod: randomUUID(),
  latePeriod: randomUUID(),
  earlyPeriod: randomUUID(),
  allDayPeriod: randomUUID(),
  configurationLocation: "30000000-0000-4000-8000-000000000002",
  configurationPeriod: randomUUID(),
};

const bootstrap = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create schema if not exists storage;
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

const adminPool = new Pool({
  connectionString: suppliedConnectionString,
  max: 1,
  application_name: "le-yard-reservation-concurrency-admin",
});
let testPool;
let databaseCreated = false;
const createdRoles = [];

function claims(role, userId) {
  return JSON.stringify({
    role,
    ...(userId ? { sub: userId, aal: "aal1" } : {}),
  });
}

async function assumeRole(client, role, userId) {
  await client.query("reset role");
  await client.query(`set role ${quoteIdentifier(role)}`);
  await client.query("select set_config('request.jwt.claims', $1, false)", [
    claims(role, userId),
  ]);
}

async function rollbackQuietly(client) {
  if (!client) return;
  try {
    await client.query("rollback");
  } catch {
    // The transaction may already have committed or aborted.
  }
}

function requireCode(error, code, label) {
  if (!error || typeof error !== "object" || error.code !== code) {
    throw new Error(
      `${label} expected SQLSTATE ${code}, received ${error?.code ?? "success"}.`,
      { cause: error },
    );
  }
}

async function pause(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function proveBlocked(observer, promise, backendPid, label) {
  let settled = false;
  let lastActivity;
  promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (settled) {
      throw new Error(
        `${label} settled before PostgreSQL reported a lock wait.`,
      );
    }
    const activity = (
      await observer.query(
        `select state, wait_event_type, wait_event,
          pg_blocking_pids(pid) as blocking_pids
        from pg_stat_activity where pid = $1`,
        [backendPid],
      )
    ).rows[0];
    lastActivity = activity;
    if (
      activity?.wait_event_type === "Lock" ||
      activity?.blocking_pids?.length
    ) {
      return activity.wait_event ?? "blocking_pid";
    }
    await pause(20);
  }
  throw new Error(
    `${label} never reached a database-visible lock wait: ${JSON.stringify(lastActivity ?? null)}.`,
  );
}

function trackQuery(promise) {
  const state = { settled: false, outcome: undefined };
  state.promise = promise.then(
    (value) => {
      state.settled = true;
      state.outcome = { ok: true, value };
      return state.outcome;
    },
    (error) => {
      state.settled = true;
      state.outcome = { ok: false, error };
      return state.outcome;
    },
  );
  return state;
}

async function waitForSerializedPair(
  observer,
  firstState,
  firstPid,
  secondState,
  secondPid,
  label,
) {
  const deadline = Date.now() + 10_000;
  while (Date.now() < deadline) {
    if (firstState.settled && firstState.outcome && !firstState.outcome.ok) {
      throw new Error(
        `${label} first query failed before serialization completed.`,
        {
          cause: firstState.outcome.error,
        },
      );
    }
    if (secondState.settled && secondState.outcome && !secondState.outcome.ok) {
      throw new Error(
        `${label} second query failed before serialization completed.`,
        {
          cause: secondState.outcome.error,
        },
      );
    }
    const activity = (
      await observer.query(
        `select pid, state, wait_event_type, wait_event
        from pg_stat_activity where pid = any($1::integer[])`,
        [[firstPid, secondPid]],
      )
    ).rows;
    const firstActivity = activity.find((row) => row.pid === firstPid);
    const secondActivity = activity.find((row) => row.pid === secondPid);
    if (
      firstState.settled &&
      !secondState.settled &&
      secondActivity?.state === "active" &&
      secondActivity.wait_event_type === "Lock"
    ) {
      return { winner: "first", waitEvent: secondActivity.wait_event };
    }
    if (
      secondState.settled &&
      !firstState.settled &&
      firstActivity?.state === "active" &&
      firstActivity.wait_event_type === "Lock"
    ) {
      return { winner: "second", waitEvent: firstActivity.wait_event };
    }
    if (firstState.settled && secondState.settled) {
      throw new Error(
        `${label} did not hold one transaction behind the other.`,
      );
    }
    await pause(20);
  }
  throw new Error(
    `${label} never produced a database-visible serialized pair.`,
  );
}

async function settleWithin(promise, label, milliseconds = 10_000) {
  let timeout;
  try {
    return await Promise.race([
      promise,
      new Promise((_, reject) => {
        timeout = setTimeout(
          () => reject(new Error(`${label} timed out (possible deadlock).`)),
          milliseconds,
        );
      }),
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

async function configure(client, requestId, command, payload) {
  await client.query(
    `select public.configure_reservation_location(
      $1::uuid, $2::uuid, $3::text, $4::jsonb
    )`,
    [requestId, ids.location, command, JSON.stringify(payload)],
  );
}

async function createPublicHold(
  client,
  { requestId, startsAt, durationMinutes = 90, partySize, tableId, email },
) {
  return (
    await client.query(
      `select public.service_create_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, $5::integer,
        $6::integer, 'Concurrency', 'Guest', $7::text, '+12125550199',
        null, array[$8::uuid], array['email']::text[]
      ) result`,
      [
        requestId,
        ids.organization,
        ids.location,
        startsAt,
        durationMinutes,
        partySize,
        email,
        tableId,
      ],
    )
  ).rows[0].result;
}

async function confirmHold(client, holdId, fingerprint) {
  return (
    await client.query(
      `select public.service_confirm_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::text, 'email', array['email']::text[]
      ) result`,
      [ids.organization, ids.location, holdId, fingerprint],
    )
  ).rows[0].result;
}

async function exchangeManagement(
  client,
  reservationId,
  fingerprint,
  manageHash,
  bindingHash,
) {
  return (
    await client.query(
      `select public.service_exchange_reservation_management(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text
      ) result`,
      [
        ids.organization,
        ids.location,
        reservationId,
        fingerprint,
        manageHash,
        bindingHash,
      ],
    )
  ).rows[0].result;
}

async function createStaffReservation(
  client,
  { requestId, startsAt, durationMinutes = 90, partySize = 2, tableId },
) {
  return (
    await client.query(
      `select public.save_reservation(
        $1::uuid, $2::uuid, null::uuid, null::uuid, $3::timestamptz,
        $4::integer, $5::integer, 'Lifecycle concurrency', 'manual',
        array[$6::uuid]
      ) result`,
      [requestId, ids.location, startsAt, durationMinutes, partySize, tableId],
    )
  ).rows[0].result;
}

async function modifyStaffReservation(
  client,
  {
    requestId,
    reservationId,
    expectedVersion,
    startsAt,
    durationMinutes = 90,
    partySize,
    tableId,
    reason,
  },
) {
  return (
    await client.query(
      `select public.modify_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::integer, $5::timestamptz,
        $6::integer, $7::integer, 'Lifecycle concurrency', array[$8::uuid],
        $9::text
      ) result`,
      [
        requestId,
        ids.location,
        reservationId,
        expectedVersion,
        startsAt,
        durationMinutes,
        partySize,
        tableId,
        reason,
      ],
    )
  ).rows[0].result;
}

async function cancelStaffReservation(
  client,
  { requestId, reservationId, expectedVersion, reason },
) {
  return (
    await client.query(
      `select public.cancel_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::integer, $5::text
      ) result`,
      [requestId, ids.location, reservationId, expectedVersion, reason],
    )
  ).rows[0].result;
}

async function insertMessageFenceHold(
  client,
  holdId,
  publicCode,
  email,
  reservedAt,
) {
  await client.query(
    `insert into private.public_booking_holds (
      id, organization_id, location_id, reserved_at, duration_minutes,
      party_size, public_code, first_name, last_name, email, phone,
      expires_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $6::timestamptz,
      90, 2, $4::text, 'Message', 'Fence', $5::text, '+12125550999',
      clock_timestamp() + interval '1 hour'
    )`,
    [holdId, ids.organization, ids.location, publicCode, email, reservedAt],
  );
}

async function insertMessageFenceOutbox(
  client,
  { messageId, holdId, dedupeKey },
) {
  return client.query(
    `insert into public.reservation_message_outbox (
      id, organization_id, location_id, booking_hold_id, channel,
      template_key, template_data, dedupe_key
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'email',
      'reservation_verify',
      '{"purpose":"reservation_verify","channel":"email"}'::jsonb,
      $5::text
    )
    returning id, status, message_delivery_configuration_version`,
    [messageId, ids.organization, ids.location, holdId, dedupeKey],
  );
}

async function setMessageFenceConfiguration(client, enabled) {
  await client.query(
    `update public.reservation_settings
    set online_booking_enabled = $3::boolean,
      guest_messaging_enabled = $3::boolean,
      verification_channels = array['email']::text[],
      approved_at = case when $3::boolean then clock_timestamp() else null end,
      approved_by = case when $3::boolean then $4::uuid else null end,
      updated_at = clock_timestamp()
    where organization_id = $1::uuid and location_id = $2::uuid`,
    [ids.organization, ids.location, enabled, ids.owner],
  );
}

let setup;
let first;
let second;
try {
  const admin = await adminPool.connect();
  try {
    for (const role of ["anon", "authenticated", "service_role"]) {
      const exists = (
        await admin.query(
          "select exists(select 1 from pg_roles where rolname = $1) value",
          [role],
        )
      ).rows[0].value;
      if (!exists) {
        await admin.query(`create role ${quoteIdentifier(role)} nologin`);
        createdRoles.push(role);
      }
    }
    await admin.query(`create database ${quoteIdentifier(databaseName)}`);
    databaseCreated = true;
  } finally {
    admin.release();
  }

  testPool = new Pool({
    connectionString: testUrl.toString(),
    max: 4,
    application_name: "le-yard-reservation-concurrency-actual-schema",
  });
  setup = await testPool.connect();
  await setup.query(`create schema ${quoteIdentifier(markerSchema)}`);
  await setup.query(bootstrap);
  for (const file of migrationFiles) {
    try {
      await setup.query(await readFile(join(migrationDirectory, file), "utf8"));
    } catch (error) {
      throw new Error(`Actual migration failed in ${file}: ${error.message}`, {
        cause: error,
      });
    }
  }
  await setup.query(await readFile(join(root, "supabase", "seed.sql"), "utf8"));

  await assumeRole(setup, "authenticated", ids.owner);
  await configure(setup, randomUUID(), "settings.save", {
    onlineBookingEnabled: true,
    guestMessagingEnabled: true,
    verificationChannels: ["email"],
    staffPushEnabled: false,
    verificationHoldMinutes: 10,
    bookingHorizonDays: 30,
    minimumLeadMinutes: 0,
    slotIntervalMinutes: 15,
    maxOnlinePartySize: 8,
    modificationCutoffMinutes: 0,
    cancellationCutoffMinutes: 0,
    reminderScheduleMinutes: [1440, 120],
    approved: true,
  });
  await configure(setup, ids.area, "area.save", {
    name: "Concurrency Room",
    sortOrder: 1,
    isActive: true,
  });
  for (const [id, label] of [
    [ids.tableA, "C1"],
    [ids.tableB, "C2"],
  ]) {
    await configure(setup, id, "table.save", {
      diningAreaId: ids.area,
      label,
      minCapacity: 1,
      maxCapacity: 8,
      positionX: label === "C1" ? 0.2 : 0.5,
      positionY: 0.2,
      width: 0.12,
      height: 0.08,
      rotationDegrees: 0,
      shape: "rectangle",
      isBookable: true,
      isActive: true,
      approved: true,
    });
  }
  await configure(setup, ids.dinnerPeriod, "service_period.save", {
    name: "Concurrency Dinner",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startsLocal: "17:00",
    endsLocal: "23:00",
    defaultDurationMinutes: 90,
    pacingIntervalMinutes: 15,
    pacingCoverLimit: 12,
    minPartySize: 1,
    maxPartySize: 8,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    onlineEnabled: true,
    isActive: true,
    approved: true,
  });
  const times = (
    await setup.query(`
      select
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '3 days 19 hours') at time zone 'America/New_York') t3,
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '4 days 19 hours') at time zone 'America/New_York') t4,
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '5 days 19 hours') at time zone 'America/New_York') t5,
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '6 days 19 hours') at time zone 'America/New_York') t6,
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '7 days 19 hours') at time zone 'America/New_York') t7,
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '8 days 19 hours') at time zone 'America/New_York') t8,
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '9 days 19 hours') at time zone 'America/New_York') t9,
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '10 days 19 hours') at time zone 'America/New_York') t10,
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '11 days 19 hours') at time zone 'America/New_York') t11,
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '12 days 23 hours 40 minutes')
          at time zone 'America/New_York') boundary_late,
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '13 days 10 minutes')
          at time zone 'America/New_York') boundary_early,
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '14 days 23 hours 40 minutes')
          at time zone 'America/New_York') stale_late,
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '15 days 10 minutes')
          at time zone 'America/New_York') stale_early
    `)
  ).rows[0];

  first = await testPool.connect();
  second = await testPool.connect();

  // A service-period edit and a timezone edit target different rows, but one
  // committed wall-time contract. The timezone writer must wait on the shared
  // configuration key, then reject the newly committed fold boundary.
  await setup.query("reset role");
  await setup.query(
    `update public.locations set timezone = 'UTC'
     where organization_id = $1::uuid and id = $2::uuid`,
    [ids.organization, ids.configurationLocation],
  );
  await setup.query(
    `insert into public.reservation_service_periods (
       id, organization_id, location_id, name, days_of_week,
       starts_local, ends_local, default_duration_minutes,
       pacing_interval_minutes, pacing_cover_limit, min_party_size,
       max_party_size, effective_from, effective_to, online_enabled, is_active
     ) values (
       $1::uuid, $2::uuid, $3::uuid, 'Configuration lock proof', array[0],
       '00:30', '03:00', 90, 15, 20, 1, 8,
       date '2026-11-01', date '2026-11-01', false, true
     )`,
    [ids.configurationPeriod, ids.organization, ids.configurationLocation],
  );
  await first.query("reset role");
  await second.query("reset role");
  await first.query("begin");
  await second.query("begin");
  await first.query(
    `update public.reservation_service_periods
     set starts_local = '01:30'
     where id = $1::uuid`,
    [ids.configurationPeriod],
  );
  const timezoneBehindPeriod = second.query(
    `update public.locations set timezone = 'America/New_York'
     where organization_id = $1::uuid and id = $2::uuid`,
    [ids.organization, ids.configurationLocation],
  );
  await proveBlocked(
    setup,
    timezoneBehindPeriod,
    second.processID,
    "service-period/timezone configuration serialization",
  );
  await first.query("commit");
  let timezoneError;
  try {
    await settleWithin(
      timezoneBehindPeriod,
      "service-period/timezone configuration serialization",
    );
  } catch (error) {
    timezoneError = error;
  }
  requireCode(
    timezoneError,
    "23514",
    "service-period/timezone configuration serialization",
  );
  await rollbackQuietly(second);
  const configurationEvidence = (
    await setup.query(
      `select location.timezone, period.starts_local::text
       from public.locations location
       join public.reservation_service_periods period
         on period.organization_id = location.organization_id
        and period.location_id = location.id
       where location.organization_id = $1::uuid
         and location.id = $2::uuid and period.id = $3::uuid`,
      [ids.organization, ids.configurationLocation, ids.configurationPeriod],
    )
  ).rows[0];
  if (
    configurationEvidence?.timezone !== "UTC" ||
    !configurationEvidence.starts_local.startsWith("01:30")
  ) {
    throw new Error(
      `Configuration serialization left unsafe state: ${JSON.stringify(configurationEvidence)}`,
    );
  }

  // Actual GiST exclusion constraint: no helper/advisory lock is involved.
  await setup.query("reset role");
  const gistReservationA = randomUUID();
  const gistReservationB = randomUUID();
  await setup.query(
    `insert into public.reservations
      (id, organization_id, location_id, reserved_at, duration_minutes,
       party_size, status, source, booking_channel)
     values ($1, $3, $4, $5, 90, 2, 'booked', 'manual', 'staff'),
            ($2, $3, $4, $5, 90, 2, 'booked', 'manual', 'staff')`,
    [
      gistReservationA,
      gistReservationB,
      ids.organization,
      ids.location,
      times.t10,
    ],
  );
  await first.query("begin");
  await second.query("begin");
  await first.query(
    `insert into public.reservation_table_allocations
      (organization_id, location_id, reservation_id, table_id,
       allocation_kind, starts_at, ends_at)
     values ($1, $2, $3, $4, 'assignment', $5, $5::timestamptz + interval '90 minutes')`,
    [ids.organization, ids.location, gistReservationA, ids.tableA, times.t10],
  );
  const gistCompeting = second.query(
    `insert into public.reservation_table_allocations
      (organization_id, location_id, reservation_id, table_id,
       allocation_kind, starts_at, ends_at)
     values ($1, $2, $3, $4, 'assignment', $5::timestamptz + interval '15 minutes',
       $5::timestamptz + interval '75 minutes')`,
    [ids.organization, ids.location, gistReservationB, ids.tableA, times.t10],
  );
  await proveBlocked(
    setup,
    gistCompeting,
    second.processID,
    "actual GiST overlap",
  );
  await first.query("commit");
  let gistError;
  try {
    await settleWithin(gistCompeting, "actual GiST overlap");
  } catch (error) {
    gistError = error;
  }
  requireCode(gistError, "23P01", "actual GiST overlap");
  await rollbackQuietly(second);

  // Different-table public holds serialize on the actual pacing assertion.
  await assumeRole(first, "service_role");
  await assumeRole(second, "service_role");
  await first.query("begin");
  await second.query("begin");
  await createPublicHold(first, {
    requestId: randomUUID(),
    startsAt: times.t3,
    partySize: 8,
    tableId: ids.tableA,
    email: `pacing-a-${runId}@example.invalid`,
  });
  const pacingCompeting = createPublicHold(second, {
    requestId: randomUUID(),
    startsAt: times.t3,
    partySize: 8,
    tableId: ids.tableB,
    email: `pacing-b-${runId}@example.invalid`,
  });
  await proveBlocked(
    setup,
    pacingCompeting,
    second.processID,
    "actual public pacing RPC",
  );
  await first.query("commit");
  let pacingError;
  try {
    await settleWithin(pacingCompeting, "actual public pacing RPC");
  } catch (error) {
    pacingError = error;
  }
  requireCode(pacingError, "23P01", "actual public pacing RPC");
  await rollbackQuietly(second);

  // Two actual public creates for one table/interval leave only the winner.
  const sameTableWinnerRequest = randomUUID();
  const sameTableLoserRequest = randomUUID();
  await first.query("begin");
  await second.query("begin");
  await createPublicHold(first, {
    requestId: sameTableWinnerRequest,
    startsAt: times.t11,
    partySize: 2,
    tableId: ids.tableA,
    email: `same-table-a-${runId}@example.invalid`,
  });
  const sameTableCompeting = createPublicHold(second, {
    requestId: sameTableLoserRequest,
    startsAt: times.t11,
    partySize: 2,
    tableId: ids.tableA,
    email: `same-table-b-${runId}@example.invalid`,
  });
  await proveBlocked(
    setup,
    sameTableCompeting,
    second.processID,
    "public create/create table conflict",
  );
  await first.query("commit");
  let sameTableError;
  try {
    await settleWithin(
      sameTableCompeting,
      "public create/create table conflict",
    );
  } catch (error) {
    sameTableError = error;
  }
  requireCode(sameTableError, "23P01", "public create/create table conflict");
  await rollbackQuietly(second);
  const sameTableEvidence = (
    await setup.query(
      `select
        (select count(*) from private.public_booking_requests
          where request_id = $1::uuid) winner_requests,
        (select count(*) from private.public_booking_requests
          where request_id = $2::uuid) loser_requests,
        (select count(*) from private.public_booking_holds hold
          join private.public_booking_requests request
            on request.booking_hold_id = hold.id
          where request.request_id = $2::uuid) loser_holds,
        (select count(*) from public.reservation_table_allocations allocation
          join private.public_booking_requests request
            on request.booking_hold_id = allocation.booking_hold_id
          where request.request_id = $2::uuid) loser_allocations,
        (select count(*) from public.reservation_message_outbox message
          join private.public_booking_requests request
            on request.booking_hold_id = message.booking_hold_id
          where request.request_id = $2::uuid) loser_messages`,
      [sameTableWinnerRequest, sameTableLoserRequest],
    )
  ).rows[0];
  if (
    Number(sameTableEvidence.winner_requests) !== 1 ||
    Number(sameTableEvidence.loser_requests) !== 0 ||
    Number(sameTableEvidence.loser_holds) !== 0 ||
    Number(sameTableEvidence.loser_allocations) !== 0 ||
    Number(sameTableEvidence.loser_messages) !== 0
  ) {
    throw new Error(
      `Public create/create left partial loser state: ${JSON.stringify(sameTableEvidence)}`,
    );
  }

  // Confirmation and create use inventory -> expiry -> settings -> subject.
  const confirmFixture = await createPublicHold(first, {
    requestId: randomUUID(),
    startsAt: times.t4,
    partySize: 2,
    tableId: ids.tableA,
    email: `confirm-${runId}@example.invalid`,
  });
  await first.query("begin");
  await second.query("begin");
  await confirmHold(first, confirmFixture.holdId, "a".repeat(64));
  const createBehindConfirm = createPublicHold(second, {
    requestId: randomUUID(),
    startsAt: times.t4,
    partySize: 2,
    tableId: ids.tableB,
    email: `confirm-race-${runId}@example.invalid`,
  });
  await proveBlocked(
    setup,
    createBehindConfirm,
    second.processID,
    "confirmation/create lock order",
  );
  await first.query("commit");
  await settleWithin(createBehindConfirm, "confirmation/create lock order");
  await second.query("commit");

  // Seed two managed reservations, then swap opposite business dates.
  const holdA = await createPublicHold(first, {
    requestId: randomUUID(),
    startsAt: times.t5,
    partySize: 2,
    tableId: ids.tableA,
    email: `swap-a-${runId}@example.invalid`,
  });
  const reservationA = await confirmHold(first, holdA.holdId, "b".repeat(64));
  const holdB = await createPublicHold(first, {
    requestId: randomUUID(),
    startsAt: times.t6,
    partySize: 2,
    tableId: ids.tableB,
    email: `swap-b-${runId}@example.invalid`,
  });
  const reservationB = await confirmHold(first, holdB.holdId, "c".repeat(64));
  const manageA = "d".repeat(64);
  const manageB = "e".repeat(64);
  await exchangeManagement(
    first,
    reservationA.reservationId,
    "f".repeat(64),
    manageA,
    "1".repeat(64),
  );
  await exchangeManagement(
    first,
    reservationB.reservationId,
    "0".repeat(64),
    manageB,
    "2".repeat(64),
  );

  // Prove every date set uses the same canonical location lock. Reversed
  // input cannot split an adjacent-day pacing window or form a date deadlock.
  await first.query("reset role");
  await second.query("reset role");
  await first.query("begin");
  await second.query("begin");
  await first.query(
    `select pg_advisory_xact_lock(hashtextextended(
      'reservation-inventory-location:' || $1::uuid::text,
      0
    ))`,
    [ids.location],
  );
  const reverseInputLock = second.query(
    `select private.lock_reservation_inventory_many(
      $1::uuid, array[$2::timestamptz, $3::timestamptz])`,
    [ids.location, times.t6, times.t5],
  );
  await proveBlocked(
    setup,
    reverseInputLock,
    second.processID,
    "canonical reverse-input inventory locking",
  );
  await settleWithin(
    first.query(
      `select private.lock_reservation_inventory_many(
        $1::uuid, array[$2::timestamptz, $3::timestamptz])`,
      [ids.location, times.t5, times.t6],
    ),
    "canonical forward-input inventory locking",
  );
  await first.query("commit");
  await settleWithin(
    reverseInputLock,
    "canonical reverse-input inventory locking",
  );
  await second.query("commit");

  await assumeRole(first, "service_role");
  await assumeRole(second, "service_role");
  await first.query("begin");
  await second.query("begin");
  const firstSwap = trackQuery(
    first.query(
      `select public.service_modify_public_reservation(
      $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz,
      90, 2, null, array[$6::uuid])`,
      [
        randomUUID(),
        ids.organization,
        ids.location,
        manageA,
        times.t6,
        ids.tableA,
      ],
    ),
  );
  const secondSwap = trackQuery(
    second.query(
      `select public.service_modify_public_reservation(
      $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz,
      90, 2, null, array[$6::uuid])`,
      [
        randomUUID(),
        ids.organization,
        ids.location,
        manageB,
        times.t5,
        ids.tableB,
      ],
    ),
  );
  const serializedSwap = await waitForSerializedPair(
    setup,
    firstSwap,
    first.processID,
    secondSwap,
    second.processID,
    "opposite-date modification swap",
  );
  const winnerClient = serializedSwap.winner === "first" ? first : second;
  const loserClient = serializedSwap.winner === "first" ? second : first;
  const winnerState =
    serializedSwap.winner === "first" ? firstSwap : secondSwap;
  const loserState = serializedSwap.winner === "first" ? secondSwap : firstSwap;
  const winnerOutcome = await settleWithin(
    winnerState.promise,
    "opposite-date modification swap winner",
  );
  if (!winnerOutcome.ok) throw winnerOutcome.error;
  await winnerClient.query("commit");
  const loserOutcome = await settleWithin(
    loserState.promise,
    "opposite-date modification swap loser",
  );
  if (!loserOutcome.ok) throw loserOutcome.error;
  await loserClient.query("commit");

  // Two modifications of one reservation serialize; the loser gets 40001.
  await first.query("begin");
  await second.query("begin");
  await first.query(
    `select public.service_modify_public_reservation(
      $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz,
      90, 2, null, array[$6::uuid])`,
    [
      randomUUID(),
      ids.organization,
      ids.location,
      manageB,
      times.t8,
      ids.tableB,
    ],
  );
  const competingModify = second.query(
    `select public.service_modify_public_reservation(
      $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz,
      90, 2, null, array[$6::uuid])`,
    [
      randomUUID(),
      ids.organization,
      ids.location,
      manageB,
      times.t9,
      ids.tableB,
    ],
  );
  await proveBlocked(
    setup,
    competingModify,
    second.processID,
    "same-reservation modification",
  );
  await first.query("commit");
  let modifyError;
  try {
    await settleWithin(competingModify, "same-reservation modification");
  } catch (error) {
    modifyError = error;
  }
  requireCode(modifyError, "40001", "same-reservation modification");
  await rollbackQuietly(second);

  // Cancellation releases inventory before a serialized public rebook.
  await first.query("begin");
  await second.query("begin");
  await first.query(
    `select public.service_cancel_public_reservation(
      $1::uuid, $2::uuid, $3::uuid, $4::text, 'Concurrent rebook')`,
    [randomUUID(), ids.organization, ids.location, manageA],
  );
  const rebook = createPublicHold(second, {
    requestId: randomUUID(),
    startsAt: times.t6,
    partySize: 2,
    tableId: ids.tableA,
    email: `rebook-${runId}@example.invalid`,
  });
  await proveBlocked(
    setup,
    rebook,
    second.processID,
    "cancel/rebook inventory handoff",
  );
  await first.query("commit");
  await settleWithin(rebook, "cancel/rebook inventory handoff");
  await second.query("commit");

  // Staff and public creates share the same inventory lock and conflict rules.
  await assumeRole(first, "authenticated", ids.owner);
  await assumeRole(second, "service_role");
  await first.query("begin");
  await second.query("begin");
  await first.query(
    `select public.save_reservation(
      $1::uuid, $2::uuid, null::uuid, null::uuid, $3::timestamptz,
      90, 2, null, 'manual', array[$4::uuid])`,
    [randomUUID(), ids.location, times.t7, ids.tableA],
  );
  const publicBehindStaff = createPublicHold(second, {
    requestId: randomUUID(),
    startsAt: times.t7,
    partySize: 2,
    tableId: ids.tableA,
    email: `staff-race-${runId}@example.invalid`,
  });
  await proveBlocked(
    setup,
    publicBehindStaff,
    second.processID,
    "staff/public inventory conflict",
  );
  await first.query("commit");
  let staffPublicError;
  try {
    await settleWithin(publicBehindStaff, "staff/public inventory conflict");
  } catch (error) {
    staffPublicError = error;
  }
  requireCode(staffPublicError, "23P01", "staff/public inventory conflict");
  await rollbackQuietly(second);

  // Staff lifecycle commands serialize on the canonical inventory lock. A
  // second writer must observe the committed version and roll its request
  // claim back instead of appending a competing revision.
  await assumeRole(first, "authenticated", ids.owner);
  await assumeRole(second, "authenticated", ids.owner);
  const staffLifecycleCreated = await createStaffReservation(first, {
    requestId: randomUUID(),
    startsAt: times.t9,
    partySize: 2,
    tableId: ids.tableA,
  });
  if (
    !staffLifecycleCreated?.id ||
    staffLifecycleCreated.version !== 1 ||
    staffLifecycleCreated.replayed
  ) {
    throw new Error(
      `Staff lifecycle concurrency fixture failed: ${JSON.stringify(staffLifecycleCreated)}`,
    );
  }
  const staffLifecycleReservationId = staffLifecycleCreated.id;
  const staffLifecycleMovedAt = new Date(
    new Date(times.t9).valueOf() + 15 * 60_000,
  ).toISOString();
  const staffLifecycleCompetingAt = new Date(
    new Date(times.t9).valueOf() + 30 * 60_000,
  ).toISOString();
  const staffModifyWinnerRequestId = randomUUID();
  const staffModifyLoserRequestId = randomUUID();
  const staffCancelWinnerRequestId = randomUUID();
  const staffCancelLoserRequestId = randomUUID();
  const staffModifyWinnerInput = {
    requestId: staffModifyWinnerRequestId,
    reservationId: staffLifecycleReservationId,
    expectedVersion: 1,
    startsAt: staffLifecycleMovedAt,
    partySize: 3,
    tableId: ids.tableA,
    reason: "First staff writer moved the reservation",
  };

  await first.query("begin");
  await second.query("begin");
  const staffModifyWinner = await modifyStaffReservation(
    first,
    staffModifyWinnerInput,
  );
  if (
    staffModifyWinner.version !== 2 ||
    staffModifyWinner.replayed ||
    staffModifyWinner.revisionKind !== "staff_modified" ||
    !staffModifyWinner.policyEvidenceCaptured ||
    staffModifyWinner.guestNotificationQueued !== false
  ) {
    throw new Error(
      `Staff modify winner returned incomplete evidence: ${JSON.stringify(staffModifyWinner)}`,
    );
  }
  const staffModifyLoser = modifyStaffReservation(second, {
    requestId: staffModifyLoserRequestId,
    reservationId: staffLifecycleReservationId,
    expectedVersion: 1,
    startsAt: staffLifecycleCompetingAt,
    partySize: 4,
    tableId: ids.tableA,
    reason: "Second staff writer must become stale",
  });
  await proveBlocked(
    setup,
    staffModifyLoser,
    second.processID,
    "staff modify/modify version serialization",
  );
  await first.query("commit");
  let staffModifyLoserError;
  try {
    await settleWithin(
      staffModifyLoser,
      "staff modify/modify version serialization",
    );
  } catch (error) {
    staffModifyLoserError = error;
  }
  requireCode(
    staffModifyLoserError,
    "40001",
    "staff modify/modify version serialization",
  );
  await rollbackQuietly(second);

  await first.query("begin");
  await second.query("begin");
  const staffCancelWinner = await cancelStaffReservation(first, {
    requestId: staffCancelWinnerRequestId,
    reservationId: staffLifecycleReservationId,
    expectedVersion: 2,
    reason: "First staff writer cancelled the reservation",
  });
  if (
    staffCancelWinner.status !== "cancelled" ||
    staffCancelWinner.version !== 3 ||
    staffCancelWinner.replayed ||
    staffCancelWinner.revisionKind !== "staff_cancelled" ||
    !staffCancelWinner.policyEvidenceCaptured ||
    staffCancelWinner.guestNotificationQueued !== false
  ) {
    throw new Error(
      `Staff cancellation winner returned incomplete evidence: ${JSON.stringify(staffCancelWinner)}`,
    );
  }
  const staffModifyBehindCancel = modifyStaffReservation(second, {
    requestId: staffCancelLoserRequestId,
    reservationId: staffLifecycleReservationId,
    expectedVersion: 2,
    startsAt: staffLifecycleCompetingAt,
    partySize: 4,
    tableId: ids.tableA,
    reason: "Staff modification behind cancellation must become stale",
  });
  await proveBlocked(
    setup,
    staffModifyBehindCancel,
    second.processID,
    "staff cancel/modify version serialization",
  );
  await first.query("commit");
  let staffModifyBehindCancelError;
  try {
    await settleWithin(
      staffModifyBehindCancel,
      "staff cancel/modify version serialization",
    );
  } catch (error) {
    staffModifyBehindCancelError = error;
  }
  requireCode(
    staffModifyBehindCancelError,
    "40001",
    "staff cancel/modify version serialization",
  );
  await rollbackQuietly(second);

  // A request replay remains tied to its original immutable revision even
  // after a later cancellation changes the live reservation.
  const staffModifyReplay = await modifyStaffReservation(
    first,
    staffModifyWinnerInput,
  );
  if (
    !staffModifyReplay.replayed ||
    staffModifyReplay.status !== "booked" ||
    staffModifyReplay.version !== 2 ||
    staffModifyReplay.revisionId !== staffModifyWinner.revisionId
  ) {
    throw new Error(
      `Staff modification replay drifted after cancellation: ${JSON.stringify(staffModifyReplay)}`,
    );
  }

  await setup.query("reset role");
  const staffLifecycleEvidence = (
    await setup.query(
      `select reservation.status, reservation.version,
        (select count(*) from public.reservation_revisions revision
          where revision.reservation_id = reservation.id) revision_count,
        (select array_agg(revision.mutation_kind order by revision.version)
          from public.reservation_revisions revision
          where revision.reservation_id = reservation.id) revision_kinds,
        (select array_agg(revision.version order by revision.version)
          from public.reservation_revisions revision
          where revision.reservation_id = reservation.id) revision_versions,
        (select coalesce(bool_and(
            revision.actor_id = $4::uuid
            and revision.payload_hash ~ '^[0-9a-f]{64}$'
            and revision.before_state is distinct from revision.after_state
            and jsonb_typeof(revision.service_shift_evidence) = 'object'
            and revision.service_shift_evidence <> '{}'::jsonb
            and coalesce(revision.policy_hash ~ '^[0-9a-f]{64}$', false)
            and jsonb_typeof(revision.policy_evidence) = 'object'
            and revision.policy_evidence <> '{}'::jsonb
            and jsonb_typeof(revision.allocation_evidence) = 'object'
            and revision.allocation_evidence <> '{}'::jsonb
            and revision.result_evidence ->> 'revisionId' = revision.id::text
            and (revision.result_evidence ->> 'version')::integer = revision.version
          ), false)
          from public.reservation_revisions revision
          where revision.reservation_id = reservation.id) revision_evidence_complete,
        (select count(*) from private.operation_requests request
          where request.request_id = any($2::uuid[])
            and request.completed_at is not null) completed_winner_requests,
        (select count(*) from private.operation_requests request
          where request.request_id = any($3::uuid[])) losing_request_rows,
        (select count(*) from public.reservation_table_allocations allocation
          where allocation.reservation_id = reservation.id
            and allocation.is_active) active_allocations,
        (select count(*) from public.reservation_events event
          where event.reservation_id = reservation.id
            and event.event_type in ('staff_modified', 'staff_cancelled')) lifecycle_events
      from public.reservations reservation
      where reservation.id = $1::uuid`,
      [
        staffLifecycleReservationId,
        [staffModifyWinnerRequestId, staffCancelWinnerRequestId],
        [staffModifyLoserRequestId, staffCancelLoserRequestId],
        ids.owner,
      ],
    )
  ).rows[0];
  if (
    staffLifecycleEvidence?.status !== "cancelled" ||
    staffLifecycleEvidence.version !== 3 ||
    Number(staffLifecycleEvidence.revision_count) !== 2 ||
    JSON.stringify(staffLifecycleEvidence.revision_kinds) !==
      JSON.stringify(["staff_modified", "staff_cancelled"]) ||
    JSON.stringify(staffLifecycleEvidence.revision_versions) !==
      JSON.stringify([2, 3]) ||
    !staffLifecycleEvidence.revision_evidence_complete ||
    Number(staffLifecycleEvidence.completed_winner_requests) !== 2 ||
    Number(staffLifecycleEvidence.losing_request_rows) !== 0 ||
    Number(staffLifecycleEvidence.active_allocations) !== 0 ||
    Number(staffLifecycleEvidence.lifecycle_events) !== 2
  ) {
    throw new Error(
      `Staff lifecycle concurrency evidence is incomplete: ${JSON.stringify(staffLifecycleEvidence)}`,
    );
  }

  for (const [statement, label] of [
    [
      "update public.reservation_revisions set reason = reason where request_id = $1::uuid",
      "staff revision update immutability",
    ],
    [
      "delete from public.reservation_revisions where request_id = $1::uuid",
      "staff revision delete immutability",
    ],
  ]) {
    let immutabilityError;
    try {
      await setup.query(statement, [staffModifyWinnerRequestId]);
    } catch (error) {
      immutabilityError = error;
    }
    requireCode(immutabilityError, "55000", label);
  }

  // Reminder scheduling and staff modification share the reservation row
  // lock. Prove both orderings: a scheduler behind a modification must enqueue
  // only the committed version, while a modification behind the scheduler
  // must cancel the scheduler's row before it can commit.
  await assumeRole(first, "service_role");
  const reminderRaceInitialAt = new Date(
    new Date(times.t9).valueOf() + 45 * 60_000,
  ).toISOString();
  const reminderRaceMovedAt = new Date(
    new Date(reminderRaceInitialAt).valueOf() + 15 * 60_000,
  ).toISOString();
  const reminderRaceMovedAgainAt = new Date(
    new Date(reminderRaceMovedAt).valueOf() + 15 * 60_000,
  ).toISOString();
  const reminderRaceHold = await createPublicHold(first, {
    requestId: randomUUID(),
    startsAt: reminderRaceInitialAt,
    partySize: 2,
    tableId: ids.tableB,
    email: `reminder-race-${runId}@example.invalid`,
  });
  const reminderRaceConfirmed = await confirmHold(
    first,
    reminderRaceHold.holdId,
    "c1".repeat(32),
  );
  if (
    reminderRaceConfirmed.status !== "booked" ||
    !reminderRaceConfirmed.reservationId
  ) {
    throw new Error(
      `Reminder race fixture failed: ${JSON.stringify(reminderRaceConfirmed)}`,
    );
  }
  const reminderRaceReservationId = reminderRaceConfirmed.reservationId;
  const reminderRaceClock = new Date(
    new Date(reminderRaceMovedAt).valueOf() - 23 * 60 * 60_000,
  ).toISOString();

  await assumeRole(first, "authenticated", ids.owner);
  await assumeRole(second, "service_role");
  await first.query("begin");
  await second.query("begin");
  const reminderRaceFirstModify = await modifyStaffReservation(first, {
    requestId: randomUUID(),
    reservationId: reminderRaceReservationId,
    expectedVersion: 1,
    startsAt: reminderRaceMovedAt,
    partySize: 2,
    tableId: ids.tableB,
    reason: "Move before the reminder scheduler commits",
  });
  if (
    reminderRaceFirstModify.version !== 2 ||
    reminderRaceFirstModify.revisionKind !== "staff_modified" ||
    !reminderRaceFirstModify.guestNotificationQueued
  ) {
    throw new Error(
      `Reminder-race first modification failed: ${JSON.stringify(reminderRaceFirstModify)}`,
    );
  }
  const schedulerBehindModify = second.query(
    "select public.service_enqueue_reservation_reminders($1::timestamptz) count",
    [reminderRaceClock],
  );
  await proveBlocked(
    setup,
    schedulerBehindModify,
    second.processID,
    "reminder scheduler behind staff modification",
  );
  await first.query("commit");
  await settleWithin(
    schedulerBehindModify,
    "reminder scheduler behind staff modification",
  );
  await second.query("commit");

  const versionTwoReminder = (
    await setup.query(
      `select id, status, reservation_version, recipient_destination_hmac,
        template_data, dedupe_key
      from public.reservation_message_outbox
      where organization_id = $1::uuid
        and location_id = $2::uuid
        and reservation_id = $3::uuid
        and template_key = 'reservation_reminder_24h'
      order by created_at desc, id desc
      limit 1`,
      [ids.organization, ids.location, reminderRaceReservationId],
    )
  ).rows[0];
  if (
    versionTwoReminder?.status !== "queued" ||
    versionTwoReminder.reservation_version !== 2 ||
    versionTwoReminder.template_data?.reservationVersion !== 2 ||
    !/^[0-9a-f]{64}$/.test(
      versionTwoReminder.recipient_destination_hmac ?? "",
    ) ||
    versionTwoReminder.dedupe_key !==
      `reservation:${reminderRaceReservationId}:reminder:24h:v2:email`
  ) {
    throw new Error(
      `Scheduler inserted stale or unbound reminder evidence: ${JSON.stringify(versionTwoReminder)}`,
    );
  }

  await second.query("begin");
  await second.query(
    "select public.service_enqueue_reservation_reminders($1::timestamptz)",
    [reminderRaceClock],
  );
  await first.query("begin");
  const modifyBehindScheduler = modifyStaffReservation(first, {
    requestId: randomUUID(),
    reservationId: reminderRaceReservationId,
    expectedVersion: 2,
    startsAt: reminderRaceMovedAgainAt,
    partySize: 2,
    tableId: ids.tableB,
    reason: "Move after the reminder scheduler takes its row lock",
  });
  await proveBlocked(
    setup,
    modifyBehindScheduler,
    first.processID,
    "staff modification behind reminder scheduler",
  );
  await second.query("commit");
  const reminderRaceSecondModify = await settleWithin(
    modifyBehindScheduler,
    "staff modification behind reminder scheduler",
  );
  await first.query("commit");
  if (
    reminderRaceSecondModify.version !== 3 ||
    reminderRaceSecondModify.revisionKind !== "staff_modified" ||
    !reminderRaceSecondModify.guestNotificationQueued
  ) {
    throw new Error(
      `Reminder-race second modification failed: ${JSON.stringify(reminderRaceSecondModify)}`,
    );
  }

  await setup.query("reset role");
  const reminderRaceEvidence = (
    await setup.query(
      `select reservation.version,
        (select count(*) from public.reservation_message_outbox message
          where message.reservation_id = reservation.id
            and message.template_key in (
              'reservation_reminder_24h', 'reservation_reminder_2h'
            )
            and message.reservation_version = 1) version_one_reminders,
        (select status from public.reservation_message_outbox message
          where message.id = $2::uuid) version_two_status,
        (select count(*) from public.reservation_message_outbox message
          where message.reservation_id = reservation.id
            and message.template_key in (
              'reservation_reminder_24h', 'reservation_reminder_2h'
            )
            and message.status in ('queued', 'failed', 'sending')
            and message.reservation_version <> reservation.version)
          live_stale_reminders,
        (select count(*) from public.reservation_revisions revision
          where revision.reservation_id = reservation.id
            and revision.operation_kind = 'reservation.modify')
          modification_revisions
      from public.reservations reservation
      where reservation.id = $1::uuid`,
      [reminderRaceReservationId, versionTwoReminder.id],
    )
  ).rows[0];
  if (
    reminderRaceEvidence.version !== 3 ||
    Number(reminderRaceEvidence.version_one_reminders) !== 0 ||
    reminderRaceEvidence.version_two_status !== "cancelled" ||
    Number(reminderRaceEvidence.live_stale_reminders) !== 0 ||
    Number(reminderRaceEvidence.modification_revisions) !== 2
  ) {
    throw new Error(
      `Reminder scheduler/modification serialization evidence is incomplete: ${JSON.stringify(reminderRaceEvidence)}`,
    );
  }

  // Message configuration and provider dispatch share one settings -> outbox
  // lock order. Prove both enqueue/revocation orderings, then prove begin is the
  // exact provider boundary and an expired post-begin lease is never replayed.
  const messageFenceIds = {
    insertFirstHold: randomUUID(),
    insertFirstMessage: randomUUID(),
    settingsFirstHold: randomUUID(),
    settingsFirstMessage: randomUUID(),
    begunHold: randomUUID(),
    begunMessage: randomUUID(),
    uncertainHold: randomUUID(),
    uncertainMessage: randomUUID(),
  };
  const publicCodeStem = runId.slice(0, 8).toUpperCase();
  await setup.query("reset role");
  for (const [holdId, publicCode, email] of [
    [
      messageFenceIds.insertFirstHold,
      `M1${publicCodeStem}`,
      `message-insert-first-${runId}@example.invalid`,
    ],
    [
      messageFenceIds.settingsFirstHold,
      `M2${publicCodeStem}`,
      `message-settings-first-${runId}@example.invalid`,
    ],
    [
      messageFenceIds.begunHold,
      `M3${publicCodeStem}`,
      `message-begun-${runId}@example.invalid`,
    ],
    [
      messageFenceIds.uncertainHold,
      `M4${publicCodeStem}`,
      `message-uncertain-${runId}@example.invalid`,
    ],
  ]) {
    await insertMessageFenceHold(setup, holdId, publicCode, email, times.t10);
  }

  await first.query("reset role");
  await second.query("reset role");
  await first.query("begin");
  const insertFirst = (
    await insertMessageFenceOutbox(first, {
      messageId: messageFenceIds.insertFirstMessage,
      holdId: messageFenceIds.insertFirstHold,
      dedupeKey: `message-fence:insert-first:${runId}`,
    })
  ).rows[0];
  if (insertFirst.status !== "queued")
    throw new Error(
      `Insert-first message was not initially eligible: ${JSON.stringify(insertFirst)}`,
    );
  await second.query("begin");
  const disableBehindInsert = setMessageFenceConfiguration(second, false);
  await proveBlocked(
    setup,
    disableBehindInsert,
    second.processID,
    "reservation message settings revocation behind insert",
  );
  await first.query("commit");
  await settleWithin(
    disableBehindInsert,
    "reservation message settings revocation behind insert",
  );
  await second.query("commit");

  const insertFirstEvidence = (
    await setup.query(
      `select message.status, message.claim_token,
        message.provider_attempted_at, message.last_error_code,
        message.message_delivery_configuration_version message_version,
        settings.message_delivery_configuration_version settings_version
      from public.reservation_message_outbox message
      join public.reservation_settings settings
        on settings.organization_id = message.organization_id
       and settings.location_id = message.location_id
      where message.id = $1::uuid`,
      [messageFenceIds.insertFirstMessage],
    )
  ).rows[0];
  if (
    insertFirstEvidence?.status !== "cancelled" ||
    insertFirstEvidence.claim_token !== null ||
    insertFirstEvidence.provider_attempted_at !== null ||
    insertFirstEvidence.last_error_code !== "messaging_configuration_revoked" ||
    Number(insertFirstEvidence.message_version) >=
      Number(insertFirstEvidence.settings_version)
  ) {
    throw new Error(
      `Insert-first settings fence evidence is incomplete: ${JSON.stringify(insertFirstEvidence)}`,
    );
  }
  await setMessageFenceConfiguration(setup, true);

  await first.query("begin");
  await setMessageFenceConfiguration(first, false);
  await second.query("begin");
  const insertBehindSettings = insertMessageFenceOutbox(second, {
    messageId: messageFenceIds.settingsFirstMessage,
    holdId: messageFenceIds.settingsFirstHold,
    dedupeKey: `message-fence:settings-first:${runId}`,
  });
  await proveBlocked(
    setup,
    insertBehindSettings,
    second.processID,
    "reservation message insert behind settings revocation",
  );
  await first.query("commit");
  const settingsFirstInsert = await settleWithin(
    insertBehindSettings,
    "reservation message insert behind settings revocation",
  );
  await second.query("commit");
  const settingsFirstInsertedRow = settingsFirstInsert.rows[0];
  const settingsFirstVersion = (
    await setup.query(
      `select message_delivery_configuration_version
      from public.reservation_settings
      where organization_id = $1::uuid and location_id = $2::uuid`,
      [ids.organization, ids.location],
    )
  ).rows[0].message_delivery_configuration_version;
  if (
    settingsFirstInsertedRow?.status !== "cancelled" ||
    Number(settingsFirstInsertedRow.message_delivery_configuration_version) !==
      Number(settingsFirstVersion)
  ) {
    throw new Error(
      `Settings-first insert was not born terminally fenced: ${JSON.stringify({ settingsFirstInsertedRow, settingsFirstVersion })}`,
    );
  }
  await setMessageFenceConfiguration(setup, true);

  await insertMessageFenceOutbox(setup, {
    messageId: messageFenceIds.begunMessage,
    holdId: messageFenceIds.begunHold,
    dedupeKey: `message-fence:begun:${runId}`,
  });
  const begunClaimToken = randomUUID();
  await setup.query(
    `update public.reservation_message_outbox
    set status = 'sending', claim_token = $2::uuid, claimed_by = $3::uuid,
      claimed_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + interval '1 minute',
      attempts = attempts + 1, updated_at = clock_timestamp()
    where id = $1::uuid`,
    [messageFenceIds.begunMessage, begunClaimToken, randomUUID()],
  );

  await assumeRole(first, "service_role");
  await first.query("begin");
  const begunSnapshot = (
    await first.query(
      `select public.service_begin_reservation_message_delivery(
        $1::uuid, $2::uuid, clock_timestamp()
      ) begun`,
      [messageFenceIds.begunMessage, begunClaimToken],
    )
  ).rows[0].begun;
  if (
    begunSnapshot?.status !== "dispatching" ||
    begunSnapshot.id !== messageFenceIds.begunMessage ||
    begunSnapshot.recipientEmail !== `message-begun-${runId}@example.invalid` ||
    begunSnapshot.templateKey !== "reservation_verify"
  ) {
    throw new Error(
      `Native begin-delivery snapshot was not exact: ${JSON.stringify(begunSnapshot)}`,
    );
  }

  await second.query("reset role");
  await second.query("begin");
  const disableBehindBegin = setMessageFenceConfiguration(second, false);
  await proveBlocked(
    setup,
    disableBehindBegin,
    second.processID,
    "reservation message settings revocation behind begin delivery",
  );
  await first.query("commit");
  await settleWithin(
    disableBehindBegin,
    "reservation message settings revocation behind begin delivery",
  );
  await second.query("commit");

  const begunAfterRevocation = (
    await setup.query(
      `select message.status, message.claim_token,
        message.provider_attempted_at,
        message.message_delivery_configuration_version message_version,
        settings.message_delivery_configuration_version settings_version
      from public.reservation_message_outbox message
      join public.reservation_settings settings
        on settings.organization_id = message.organization_id
       and settings.location_id = message.location_id
      where message.id = $1::uuid`,
      [messageFenceIds.begunMessage],
    )
  ).rows[0];
  if (
    begunAfterRevocation?.status !== "sending" ||
    begunAfterRevocation.claim_token !== begunClaimToken ||
    begunAfterRevocation.provider_attempted_at === null ||
    Number(begunAfterRevocation.message_version) >=
      Number(begunAfterRevocation.settings_version)
  ) {
    throw new Error(
      `A begun provider dispatch was not preserved across revocation: ${JSON.stringify(begunAfterRevocation)}`,
    );
  }

  await assumeRole(setup, "service_role");
  const completedBegun = (
    await setup.query(
      `select public.service_complete_reservation_message_outbox(
        $1::uuid, $2::uuid, 'sent', null, null, $3::text
      ) completed`,
      [
        messageFenceIds.begunMessage,
        begunClaimToken,
        `native-provider-${runId}`,
      ],
    )
  ).rows[0].completed;
  if (completedBegun?.status !== "sent")
    throw new Error(
      `Begun provider dispatch could not complete after revocation: ${JSON.stringify(completedBegun)}`,
    );
  await setup.query("reset role");
  await setMessageFenceConfiguration(setup, true);

  await insertMessageFenceOutbox(setup, {
    messageId: messageFenceIds.uncertainMessage,
    holdId: messageFenceIds.uncertainHold,
    dedupeKey: `message-fence:uncertain:${runId}`,
  });
  const uncertainClaimToken = randomUUID();
  await setup.query(
    `update public.reservation_message_outbox
    set status = 'sending', claim_token = $2::uuid, claimed_by = $3::uuid,
      claimed_at = clock_timestamp(),
      lease_expires_at = clock_timestamp() + interval '5 seconds',
      attempts = attempts + 1, updated_at = clock_timestamp()
    where id = $1::uuid`,
    [messageFenceIds.uncertainMessage, uncertainClaimToken, randomUUID()],
  );
  await assumeRole(setup, "service_role");
  const uncertainBegun = (
    await setup.query(
      `select public.service_begin_reservation_message_delivery(
        $1::uuid, $2::uuid, clock_timestamp()
      ) begun`,
      [messageFenceIds.uncertainMessage, uncertainClaimToken],
    )
  ).rows[0].begun;
  if (uncertainBegun?.status !== "dispatching")
    throw new Error(
      `Post-begin uncertainty fixture did not begin: ${JSON.stringify(uncertainBegun)}`,
    );

  await first.query("reset role");
  await first.query("begin");
  await first.query(
    `select id from public.reservation_message_outbox
    where id <> $1::uuid and status in ('queued', 'failed', 'sending')
    for update`,
    [messageFenceIds.uncertainMessage],
  );
  await assumeRole(second, "service_role");
  const postBeginReclaim = (
    await second.query(
      `select * from public.service_claim_reservation_message_outbox(
        $1::uuid, 1, 30, clock_timestamp() + interval '10 seconds'
      )`,
      [randomUUID()],
    )
  ).rows;
  await first.query("commit");
  await setup.query("reset role");
  const uncertainEvidence = (
    await setup.query(
      `select status, claim_token, claimed_by, claimed_at,
        lease_expires_at, provider_attempted_at, last_error_code
      from public.reservation_message_outbox where id = $1::uuid`,
      [messageFenceIds.uncertainMessage],
    )
  ).rows[0];
  if (
    postBeginReclaim.some(
      (message) => message.id === messageFenceIds.uncertainMessage,
    ) ||
    uncertainEvidence?.status !== "uncertain" ||
    uncertainEvidence.claim_token !== null ||
    uncertainEvidence.claimed_by !== null ||
    uncertainEvidence.claimed_at !== null ||
    uncertainEvidence.lease_expires_at !== null ||
    uncertainEvidence.provider_attempted_at === null ||
    uncertainEvidence.last_error_code !== "provider_outcome_unknown_after_lease"
  ) {
    throw new Error(
      `Expired post-begin delivery was replayable: ${JSON.stringify({ postBeginReclaim, uncertainEvidence })}`,
    );
  }

  // Adjacent operating dates can still share one rolling pacing window. Use
  // separate late/early services and different tables to prove the canonical
  // location lock makes the second writer observe the committed covers.
  await assumeRole(setup, "authenticated", ids.owner);
  await configure(setup, randomUUID(), "service_period.save", {
    id: ids.dinnerPeriod,
    name: "Concurrency Dinner",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startsLocal: "17:00",
    endsLocal: "23:00",
    defaultDurationMinutes: 90,
    pacingIntervalMinutes: 15,
    pacingCoverLimit: 12,
    minPartySize: 1,
    maxPartySize: 8,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    onlineEnabled: false,
    isActive: false,
    approved: true,
  });
  for (const [id, name, startsLocal, endsLocal] of [
    [ids.latePeriod, "Concurrency Late", "23:00", "23:59"],
    [ids.earlyPeriod, "Concurrency Early", "00:00", "03:00"],
  ]) {
    await configure(setup, id, "service_period.save", {
      name,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startsLocal,
      endsLocal,
      defaultDurationMinutes: 15,
      pacingIntervalMinutes: 60,
      pacingCoverLimit: 12,
      minPartySize: 1,
      maxPartySize: 8,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      onlineEnabled: true,
      isActive: true,
      approved: true,
    });
  }

  await assumeRole(first, "service_role");
  await assumeRole(second, "service_role");
  await first.query("begin");
  await second.query("begin");
  await createPublicHold(first, {
    requestId: randomUUID(),
    startsAt: times.boundary_late,
    durationMinutes: 15,
    partySize: 8,
    tableId: ids.tableA,
    email: `boundary-late-${runId}@example.invalid`,
  });
  const boundaryPacingCompeting = createPublicHold(second, {
    requestId: randomUUID(),
    startsAt: times.boundary_early,
    durationMinutes: 15,
    partySize: 8,
    tableId: ids.tableB,
    email: `boundary-early-${runId}@example.invalid`,
  });
  await proveBlocked(
    setup,
    boundaryPacingCompeting,
    second.processID,
    "adjacent-day different-table pacing",
  );
  await first.query("commit");
  let boundaryPacingError;
  try {
    await settleWithin(
      boundaryPacingCompeting,
      "adjacent-day different-table pacing",
    );
  } catch (error) {
    boundaryPacingError = error;
  }
  requireCode(
    boundaryPacingError,
    "23P01",
    "adjacent-day different-table pacing",
  );
  await rollbackQuietly(second);

  // Create a valid late hold, then make its still-active allocation expired
  // and cross midnight. Date-scoped expiry intentionally misses it; the exact
  // table/interval cleanup must release and redact it before the new insert.
  const staleBoundaryRequest = randomUUID();
  const staleBoundaryHold = await createPublicHold(first, {
    requestId: staleBoundaryRequest,
    startsAt: times.stale_late,
    durationMinutes: 15,
    partySize: 2,
    tableId: ids.tableA,
    email: `stale-boundary-${runId}@example.invalid`,
  });
  await setup.query("reset role");
  await setup.query(
    `update private.public_booking_holds hold
      set expires_at = clock_timestamp() - interval '1 minute',
          updated_at = clock_timestamp()
      where hold.id = $1::uuid`,
    [staleBoundaryHold.holdId],
  );
  await setup.query(
    `update public.reservation_table_allocations allocation
      set ends_at = $2::timestamptz + interval '30 minutes',
          expires_at = clock_timestamp() - interval '1 minute',
          updated_at = clock_timestamp()
      where allocation.booking_hold_id = $1::uuid`,
    [staleBoundaryHold.holdId, times.stale_early],
  );
  await setup.query(
    `select private.expire_public_booking_holds(
      $1::uuid, $2::uuid, clock_timestamp(), 1000, $3::timestamptz
    )`,
    [ids.organization, ids.location, times.stale_early],
  );
  const staleBeforeExact = (
    await setup.query(
      `select hold.status, allocation.is_active
      from private.public_booking_holds hold
      join public.reservation_table_allocations allocation
        on allocation.booking_hold_id = hold.id
      where hold.id = $1::uuid`,
      [staleBoundaryHold.holdId],
    )
  ).rows[0];
  if (staleBeforeExact.status !== "pending" || !staleBeforeExact.is_active) {
    throw new Error(
      `Date-scoped expiry did not preserve the boundary fixture: ${JSON.stringify(staleBeforeExact)}`,
    );
  }

  const replacementBoundaryRequest = randomUUID();
  const replacementBoundaryHold = await createPublicHold(first, {
    requestId: replacementBoundaryRequest,
    startsAt: times.stale_early,
    durationMinutes: 15,
    partySize: 2,
    tableId: ids.tableA,
    email: `replacement-boundary-${runId}@example.invalid`,
  });
  const staleBoundaryEvidence = (
    await setup.query(
      `select
        (select status from private.public_booking_holds
          where id = $1::uuid) hold_status,
        (select expired_at is not null and redacted_at is not null
          and first_name is null and last_name is null and email is null
          and phone is null and special_requests is null
          from private.public_booking_holds where id = $1::uuid) redacted,
        (select count(*) from public.reservation_table_allocations
          where booking_hold_id = $1::uuid and is_active) stale_allocations,
        (select count(*) from public.reservation_message_outbox
          where booking_hold_id = $1::uuid and status <> 'cancelled') live_messages,
        (select count(*) from public.audit_events
          where action = 'public_booking_hold_expired'
            and record_id = $1::uuid::text) expiry_audits,
        (select count(*) from public.reservation_table_allocations
          where booking_hold_id = $2::uuid and is_active) replacements`,
      [staleBoundaryHold.holdId, replacementBoundaryHold.holdId],
    )
  ).rows[0];
  if (
    staleBoundaryEvidence.hold_status !== "expired" ||
    staleBoundaryEvidence.redacted !== true ||
    Number(staleBoundaryEvidence.stale_allocations) !== 0 ||
    Number(staleBoundaryEvidence.live_messages) !== 0 ||
    Number(staleBoundaryEvidence.expiry_audits) !== 1 ||
    Number(staleBoundaryEvidence.replacements) !== 1
  ) {
    throw new Error(
      `Exact cross-boundary expiry evidence is incomplete: ${JSON.stringify(staleBoundaryEvidence)}`,
    );
  }

  await assumeRole(setup, "authenticated", ids.owner);
  for (const [id, name, startsLocal, endsLocal] of [
    [ids.latePeriod, "Concurrency Late", "23:00", "23:59"],
    [ids.earlyPeriod, "Concurrency Early", "00:00", "03:00"],
  ]) {
    await configure(setup, randomUUID(), "service_period.save", {
      id,
      name,
      daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
      startsLocal,
      endsLocal,
      defaultDurationMinutes: 15,
      pacingIntervalMinutes: 60,
      pacingCoverLimit: 12,
      minPartySize: 1,
      maxPartySize: 8,
      effectiveFrom: "2026-01-01",
      effectiveTo: null,
      onlineEnabled: false,
      isActive: false,
      approved: true,
    });
  }

  // A contact update can commit while the resolver is waiting for its chosen
  // guest row. The post-lock lookup must reject that stale candidate instead
  // of attaching the waitlist entry to a profile that no longer owns the
  // supplied contact.
  const staleIdentityGuestId = randomUUID();
  const staleIdentityRequestId = randomUUID();
  const staleIdentityOldEmail = `stale-identity-${runId}@example.invalid`;
  const staleIdentityNewEmail = `moved-identity-${runId}@example.invalid`;
  const staleIdentityPhone = "+12125550991";
  await setup.query("reset role");
  await setup.query(
    `insert into public.guests (
      id, organization_id, display_name, email, source, external_references
    ) values ($1::uuid, $2::uuid, 'Stale Identity', $3::text, 'manual', '{}'::jsonb)`,
    [staleIdentityGuestId, ids.organization, staleIdentityOldEmail],
  );
  await setup.query(
    `insert into public.guest_locations (
      id, organization_id, guest_id, location_id, is_home_location
    ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, true)`,
    [randomUUID(), ids.organization, staleIdentityGuestId, ids.location],
  );
  await first.query("reset role");
  await assumeRole(second, "authenticated", ids.owner);
  await first.query("begin");
  await second.query("begin");
  await first.query(
    `update public.guests
      set email = $2::text, updated_at = clock_timestamp()
      where organization_id = $1::uuid and id = $3::uuid`,
    [ids.organization, staleIdentityNewEmail, staleIdentityGuestId],
  );
  const staleIdentityResolution = second.query(
    `select public.save_waitlist_entry_v2(
      $1::uuid, $2::uuid, null::uuid, 'Stale Identity',
      $3::text, $4::text, 2, null::timestamptz, null::timestamptz, 5, null
    )`,
    [
      staleIdentityRequestId,
      ids.location,
      staleIdentityOldEmail,
      staleIdentityPhone,
    ],
  );
  await proveBlocked(
    setup,
    staleIdentityResolution,
    second.processID,
    "guest identity post-lock recheck",
  );
  await first.query("commit");
  let staleIdentityError;
  try {
    await settleWithin(
      staleIdentityResolution,
      "guest identity post-lock recheck",
    );
  } catch (error) {
    staleIdentityError = error;
  }
  requireCode(staleIdentityError, "40001", "guest identity post-lock recheck");
  await rollbackQuietly(second);
  const staleIdentityEvidence = (
    await setup.query(
      `select
        (select lower(guest.email)
          from public.guests guest
          where guest.organization_id = $1::uuid
            and guest.id = $2::uuid) guest_email,
        (select count(*)
          from public.guests guest
          join public.guest_locations guest_location
            on guest_location.organization_id = guest.organization_id
           and guest_location.guest_id = guest.id
          where guest.organization_id = $1::uuid
            and guest_location.location_id = $3::uuid
            and guest.merged_into_id is null
            and lower(guest.email) = lower($4::text)) stale_matches,
        (select count(*) from public.waitlist_entries entry
          where entry.organization_id = $1::uuid
            and entry.id = $5::uuid) waitlist_rows,
        (select count(*) from private.operation_requests request
          where request.request_id = $5::uuid) operation_rows`,
      [
        ids.organization,
        staleIdentityGuestId,
        ids.location,
        staleIdentityOldEmail,
        staleIdentityRequestId,
      ],
    )
  ).rows[0];
  if (
    staleIdentityEvidence.guest_email !== staleIdentityNewEmail ||
    Number(staleIdentityEvidence.stale_matches) !== 0 ||
    Number(staleIdentityEvidence.waitlist_rows) !== 0 ||
    Number(staleIdentityEvidence.operation_rows) !== 0
  ) {
    throw new Error(
      `Guest identity post-lock rollback evidence is incomplete: ${JSON.stringify(staleIdentityEvidence)}`,
    );
  }

  // Waitlist seating participates in the same lock and sees a committed hold.
  await configure(setup, ids.allDayPeriod, "service_period.save", {
    name: "Concurrency All Day",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startsLocal: "00:00",
    endsLocal: "00:00",
    defaultDurationMinutes: 90,
    pacingIntervalMinutes: 15,
    pacingCoverLimit: 100,
    minPartySize: 1,
    maxPartySize: 8,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    onlineEnabled: true,
    isActive: true,
    approved: true,
  });
  const currentTime = (
    await setup.query(
      `select
        (clock_timestamp() at time zone 'America/New_York')::time local_time,
        clock_timestamp() + interval '5 seconds' slot`,
    )
  ).rows[0];
  if (currentTime.local_time >= "23:59:30") {
    throw new Error(
      "The waitlist concurrency scenario cannot run safely within 30 seconds of the location midnight boundary; rerun the gate after midnight.",
    );
  }
  const currentSlot = currentTime.slot;
  const waitlistId = randomUUID();
  await setup.query(
    `select public.save_waitlist_entry_v2(
      $1::uuid, $2::uuid, null::uuid, 'Concurrent Walk-in',
      'walkin-${runId}@example.invalid', '+12125550200', 2,
      null::timestamptz, null::timestamptz, 5, null)`,
    [waitlistId, ids.location],
  );
  await assumeRole(first, "service_role");
  await assumeRole(second, "authenticated", ids.owner);
  await setup.query("reset role");
  await first.query("begin");
  await second.query("begin");
  await createPublicHold(first, {
    requestId: randomUUID(),
    startsAt: currentSlot,
    partySize: 2,
    tableId: ids.tableA,
    email: `waitlist-race-${runId}@example.invalid`,
  });
  const waitlistSeat = second.query(
    "select public.seat_waitlist_entry($1::uuid, $2::uuid, array[$3::uuid], 90)",
    [randomUUID(), waitlistId, ids.tableA],
  );
  await proveBlocked(
    setup,
    waitlistSeat,
    second.processID,
    "waitlist/public inventory conflict",
  );
  await first.query("commit");
  let waitlistError;
  try {
    await settleWithin(waitlistSeat, "waitlist/public inventory conflict");
  } catch (error) {
    waitlistError = error;
  }
  requireCode(waitlistError, "23P01", "waitlist/public inventory conflict");
  await rollbackQuietly(second);

  await setup.query("reset role");
  await setup.query(`drop schema ${quoteIdentifier(markerSchema)} cascade`);
  process.stdout.write(
    "PASS actual migrated PostgreSQL two-connection gate: service-period/timezone configuration, GiST, public/public table conflict with rollback evidence, same-day and adjacent-day pacing, cross-boundary stale expiry, confirm/create, canonical opposite-date swaps, public modify/modify, cancel/rebook, staff/public, staff modify/modify and cancel/modify lifecycle revisions, both reservation-reminder scheduler/modify lock orderings with version and destination fences, guest-identity post-lock recheck, and waitlist/public\n",
  );
} finally {
  await rollbackQuietly(first);
  await rollbackQuietly(second);
  first?.release(true);
  second?.release(true);
  setup?.release(true);
  if (testPool) await testPool.end();

  if (databaseCreated) {
    const admin = await adminPool.connect();
    try {
      const deadline = Date.now() + 5_000;
      let activeConnections = 0;
      do {
        activeConnections = Number(
          (
            await admin.query(
              "select count(*) connection_count from pg_stat_activity where datname = $1",
              [databaseName],
            )
          ).rows[0].connection_count,
        );
        if (activeConnections === 0) break;
        await pause(20);
      } while (Date.now() < deadline);
      if (activeConnections !== 0) {
        throw new Error(
          `Disposable reservation database still has ${activeConnections} active connection(s) after pool shutdown.`,
        );
      }
      await admin.query(
        `drop database if exists ${quoteIdentifier(databaseName)}`,
      );
    } finally {
      admin.release();
    }
  }
  for (const role of createdRoles.reverse()) {
    const admin = await adminPool.connect();
    try {
      await admin.query(`drop role if exists ${quoteIdentifier(role)}`);
    } finally {
      admin.release();
    }
  }
  await adminPool.end();
}
