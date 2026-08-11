import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";

const suppliedConnectionString = process.env.SERVICE_SHIFT_TEST_DATABASE_URL;
if (!suppliedConnectionString) {
  throw new Error(
    "SERVICE_SHIFT_TEST_DATABASE_URL is required; this gate never falls back to PGlite.",
  );
}
if (!/^postgres(?:ql)?:\/\//.test(suppliedConnectionString)) {
  throw new Error(
    "SERVICE_SHIFT_TEST_DATABASE_URL must be a PostgreSQL URL.",
  );
}

const adminUrl = new URL(suppliedConnectionString);
const allowedHosts = new Set(["127.0.0.1", "localhost", "[::1]", "::1"]);
if (!allowedHosts.has(adminUrl.hostname)) {
  throw new Error(
    "SERVICE_SHIFT_TEST_DATABASE_URL must target a loopback PostgreSQL cluster; shared and remote databases are refused.",
  );
}

const root = process.cwd();
const migrationDirectory = join(root, "supabase", "migrations");
const migrationFiles = (await readdir(migrationDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const runId = randomUUID().replaceAll("-", "");
const databaseName = `service_shift_concurrency_${runId}`;
const markerSchema = `service_shift_concurrency_run_${runId}`;
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const testUrl = new URL(suppliedConnectionString);
testUrl.pathname = `/${databaseName}`;

const ids = {
  organization: "20000000-0000-4000-8000-000000000001",
  location: "30000000-0000-4000-8000-000000000001",
  owner: "10000000-0000-4000-8000-000000000001",
  period: randomUUID(),
  replay: randomUUID(),
  pacingA: randomUUID(),
  pacingB: randomUUID(),
  bufferA: randomUUID(),
  bufferB: randomUUID(),
  revokeA: randomUUID(),
  revokeB: randomUUID(),
  exceptionFirst: randomUUID(),
  configurationFirst: randomUUID(),
};

const businessDates = {
  replay: "2035-01-07",
  pacing: "2035-01-08",
  buffer: "2035-01-09",
  exceptionFirst: "2035-01-10",
  configurationFirst: "2035-01-11",
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
  application_name: "le-yard-service-shift-concurrency-admin",
});

let serverVersion;
let testPool;
let setup;
let first;
let second;
let databaseCreated = false;
const createdRoles = [];

function assert(condition, message, evidence = undefined) {
  if (!condition) {
    throw new Error(
      `${message}${
        evidence === undefined ? "" : `: ${JSON.stringify(evidence)}`
      }`,
    );
  }
}

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

async function assumeAdministrator(client) {
  await client.query("reset role");
  await client.query("select set_config('request.jwt.claims', '{}', false)");
}

async function rollbackQuietly(client) {
  if (!client) return;
  try {
    await client.query("rollback");
  } catch {
    // The transaction may already have committed or aborted.
  }
}

function requireCode(error, code, label, constraint = undefined) {
  if (!error || typeof error !== "object" || error.code !== code) {
    throw new Error(
      `${label} expected SQLSTATE ${code}, received ${error?.code ?? "success"}.`,
      { cause: error },
    );
  }
  if (constraint && error.constraint !== constraint) {
    throw new Error(
      `${label} expected constraint ${constraint}, received ${error.constraint ?? "none"}.`,
      { cause: error },
    );
  }
}

async function pause(milliseconds) {
  await new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function trackQuery(promise) {
  const state = { settled: false, outcome: undefined, promise: undefined };
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
  let lastActivity;
  while (Date.now() < deadline) {
    if (firstState.settled && firstState.outcome && !firstState.outcome.ok) {
      throw new Error(`${label} first query failed before serialization.`, {
        cause: firstState.outcome.error,
      });
    }
    if (secondState.settled && secondState.outcome && !secondState.outcome.ok) {
      throw new Error(`${label} second query failed before serialization.`, {
        cause: secondState.outcome.error,
      });
    }

    const activity = (
      await observer.query(
        `select pid, state, wait_event_type, wait_event,
                pg_blocking_pids(pid) blocking_pids
         from pg_stat_activity
         where pid = any($1::integer[])`,
        [[firstPid, secondPid]],
      )
    ).rows;
    lastActivity = activity;
    const firstActivity = activity.find((row) => row.pid === firstPid);
    const secondActivity = activity.find((row) => row.pid === secondPid);

    if (
      firstState.settled &&
      !secondState.settled &&
      secondActivity?.state === "active" &&
      (secondActivity.wait_event_type === "Lock" ||
        secondActivity.blocking_pids?.length)
    ) {
      return {
        winner: "first",
        waitEvent: secondActivity.wait_event ?? "blocking_pid",
      };
    }
    if (
      secondState.settled &&
      !firstState.settled &&
      firstActivity?.state === "active" &&
      (firstActivity.wait_event_type === "Lock" ||
        firstActivity.blocking_pids?.length)
    ) {
      return {
        winner: "second",
        waitEvent: firstActivity.wait_event ?? "blocking_pid",
      };
    }
    if (firstState.settled && secondState.settled) {
      throw new Error(`${label} did not hold one transaction behind the other.`);
    }
    await pause(20);
  }
  throw new Error(
    `${label} never produced a database-visible serialized pair: ${JSON.stringify(lastActivity ?? null)}.`,
  );
}

async function proveBlocked(observer, state, backendPid, label) {
  const deadline = Date.now() + 10_000;
  let lastActivity;
  while (Date.now() < deadline) {
    if (state.settled) {
      if (state.outcome && !state.outcome.ok) {
        throw new Error(`${label} failed before reaching the expected lock.`, {
          cause: state.outcome.error,
        });
      }
      throw new Error(`${label} settled before PostgreSQL reported a lock wait.`);
    }
    const activity = (
      await observer.query(
        `select state, wait_event_type, wait_event,
                pg_blocking_pids(pid) blocking_pids
         from pg_stat_activity
         where pid = $1`,
        [backendPid],
      )
    ).rows[0];
    lastActivity = activity;
    if (
      activity?.state === "active" &&
      (activity.wait_event_type === "Lock" || activity.blocking_pids?.length)
    ) {
      return activity.wait_event ?? "blocking_pid";
    }
    await pause(20);
  }
  throw new Error(
    `${label} never reached a database-visible lock wait: ${JSON.stringify(lastActivity ?? null)}.`,
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

function shifted(date, minutes) {
  return new Date(date.getTime() + minutes * 60_000);
}

async function configureException(client, input) {
  return client.query(
    `select public.configure_service_shift_exception(
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::text,
       $6::timestamptz, $7::timestamptz, $8::integer, $9::integer,
       $10::integer, $11::integer, $12::text, $13::boolean
     ) result`,
    [
      input.requestId,
      ids.organization,
      ids.location,
      input.shift.id,
      input.kind,
      input.startsAt,
      input.endsAt,
      input.pacingIntervalMinutes ?? null,
      input.pacingCoverLimit ?? null,
      input.openingBufferMinutes ?? null,
      input.closingBufferMinutes ?? null,
      input.reason,
      true,
    ],
  );
}

async function revokeException(client, requestId, exceptionId, reason) {
  return client.query(
    `select public.revoke_service_shift_exception(
       $1::uuid, $2::uuid, $3::text
     ) result`,
    [requestId, exceptionId, reason],
  );
}

async function runSerializedPair({
  label,
  firstQuery,
  secondQuery,
  followerError,
}) {
  await first.query("begin");
  await second.query("begin");
  const firstState = trackQuery(firstQuery());
  const secondState = trackQuery(secondQuery());
  const serialization = await waitForSerializedPair(
    setup,
    firstState,
    first.processID,
    secondState,
    second.processID,
    label,
  );
  const winner =
    serialization.winner === "first"
      ? { client: first, state: firstState }
      : { client: second, state: secondState };
  const follower =
    serialization.winner === "first"
      ? { client: second, state: secondState }
      : { client: first, state: firstState };
  assert(
    winner.state.outcome?.ok,
    `${label} winner did not return successfully.`,
    winner.state.outcome,
  );
  await winner.client.query("commit");
  const followerOutcome = await settleWithin(
    follower.state.promise,
    `${label} follower`,
  );
  if (followerError) {
    assert(
      !followerOutcome.ok,
      `${label} follower unexpectedly succeeded.`,
      followerOutcome,
    );
    requireCode(
      followerOutcome.error,
      followerError.code,
      `${label} follower`,
      followerError.constraint,
    );
    await rollbackQuietly(follower.client);
  } else {
    assert(
      followerOutcome.ok,
      `${label} follower did not succeed after serialization.`,
      followerOutcome.error,
    );
    await follower.client.query("commit");
  }
  return {
    winnerOutcome: winner.state.outcome,
    followerOutcome,
    waitEvent: serialization.waitEvent,
  };
}

try {
  const admin = await adminPool.connect();
  try {
    const version = (
      await admin.query(
        `select current_setting('server_version') version,
                current_setting('server_version_num')::integer version_num`,
      )
    ).rows[0];
    assert(
      version.version_num >= 170000 && version.version_num < 180000,
      "The native service-shift gate requires PostgreSQL 17.",
      version,
    );
    serverVersion = version.version;

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
    application_name: "le-yard-service-shift-concurrency-actual-schema",
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

  await setup.query(
    `insert into public.reservation_service_periods (
       id, organization_id, location_id, name, days_of_week,
       starts_local, ends_local, default_duration_minutes,
       pacing_interval_minutes, pacing_cover_limit, min_party_size,
       max_party_size, effective_from, online_enabled, is_active,
       approved_at, approved_by
     ) values (
       $1::uuid, $2::uuid, $3::uuid, $4::text, array[0,1,2,3,4,5,6],
       time '17:00', time '03:00', 90, 15, 20, 1, 10,
       date '2035-01-01', false, true, clock_timestamp(), $5::uuid
     )`,
    [
      ids.period,
      ids.organization,
      ids.location,
      `Native exception concurrency ${runId.slice(0, 12)}`,
      ids.owner,
    ],
  );
  await setup.query(
    "select private.ensure_service_shifts($1::uuid, $2::uuid, $3::date[])",
    [ids.organization, ids.location, Object.values(businessDates)],
  );
  const shiftRows = (
    await setup.query(
      `select id, business_date::text business_date, starts_at, ends_at
       from public.service_shifts
       where organization_id = $1::uuid
         and location_id = $2::uuid
         and service_period_id = $3::uuid
         and business_date = any($4::date[])
       order by business_date`,
      [
        ids.organization,
        ids.location,
        ids.period,
        Object.values(businessDates),
      ],
    )
  ).rows;
  assert(
    shiftRows.length === Object.keys(businessDates).length,
    "The fixture did not materialize every service shift.",
    shiftRows,
  );
  const shifts = Object.fromEntries(
    Object.entries(businessDates).map(([label, businessDate]) => [
      label,
      shiftRows.find((row) => row.business_date === businessDate),
    ]),
  );
  assert(
    Object.values(shifts).every(Boolean),
    "The materialized service-shift fixture is incomplete.",
    shifts,
  );

  first = await testPool.connect();
  second = await testPool.connect();
  await assumeRole(first, "authenticated", ids.owner);
  await assumeRole(second, "authenticated", ids.owner);
  for (const client of [first, second]) {
    await client.query("set statement_timeout = '20s'");
    await client.query("set lock_timeout = '15s'");
  }

  const replayInput = {
    requestId: ids.replay,
    shift: shifts.replay,
    kind: "closure",
    startsAt: shifted(shifts.replay.starts_at, 30),
    endsAt: shifted(shifts.replay.starts_at, 60),
    reason: "Concurrent exact replay closure",
  };
  const replayPair = await runSerializedPair({
    label: "service-shift exact configure replay",
    firstQuery: () => configureException(first, replayInput),
    secondQuery: () => configureException(second, replayInput),
  });
  const replayFlags = [
    replayPair.winnerOutcome.value.rows[0]?.result?.replayed,
    replayPair.followerOutcome.value.rows[0]?.result?.replayed,
  ].sort();
  assert(
    replayFlags.length === 2 &&
      replayFlags[0] === false &&
      replayFlags[1] === true,
    "Concurrent exact replay did not return one original and one replay.",
    { replayFlags, waitEvent: replayPair.waitEvent },
  );
  const replayEvidence = (
    await setup.query(
      `select
         (select count(*)::integer
          from public.service_shift_exceptions exception
          where exception.id = $1::uuid and exception.status = 'active') exception_count,
         (select count(*)::integer
          from private.operation_requests request
          where request.request_id = $1::uuid
            and request.completed_at is not null) completed_requests,
         (select count(*)::integer
          from public.audit_events event
          where event.action = 'service_shift_exception_created'
            and event.record_id = $1::text) audit_count`,
      [ids.replay],
    )
  ).rows[0];
  assert(
    replayEvidence.exception_count === 1 &&
      replayEvidence.completed_requests === 1 &&
      replayEvidence.audit_count === 1,
    "Concurrent exact replay duplicated durable evidence.",
    replayEvidence,
  );

  const pacingInputs = [
    {
      requestId: ids.pacingA,
      shift: shifts.pacing,
      kind: "pacing_override",
      startsAt: shifted(shifts.pacing.starts_at, 90),
      endsAt: shifted(shifts.pacing.starts_at, 210),
      pacingIntervalMinutes: 30,
      pacingCoverLimit: 4,
      reason: "Concurrent pacing override A",
    },
    {
      requestId: ids.pacingB,
      shift: shifts.pacing,
      kind: "pacing_override",
      startsAt: shifted(shifts.pacing.starts_at, 150),
      endsAt: shifted(shifts.pacing.starts_at, 270),
      pacingIntervalMinutes: 30,
      pacingCoverLimit: 6,
      reason: "Concurrent pacing override B",
    },
  ];
  const pacingPair = await runSerializedPair({
    label: "service-shift overlapping pacing configure/configure",
    firstQuery: () => configureException(first, pacingInputs[0]),
    secondQuery: () => configureException(second, pacingInputs[1]),
    followerError: {
      code: "23P01",
      constraint: "service_shift_pacing_override_no_overlap",
    },
  });
  const pacingEvidence = (
    await setup.query(
      `select
         (select count(*)::integer
          from public.service_shift_exceptions exception
          where exception.id = any($1::uuid[]) and exception.status = 'active') exception_count,
         (select count(*)::integer
          from private.operation_requests request
          where request.request_id = any($1::uuid[])
            and request.completed_at is not null) completed_requests,
         (select count(*)::integer
          from public.audit_events event
          where event.action = 'service_shift_exception_created'
            and event.record_id = any($2::text[])) audit_count`,
      [
        [ids.pacingA, ids.pacingB],
        [ids.pacingA, ids.pacingB],
      ],
    )
  ).rows[0];
  assert(
    pacingEvidence.exception_count === 1 &&
      pacingEvidence.completed_requests === 1 &&
      pacingEvidence.audit_count === 1,
    "Overlapping pacing commands left ambiguous durable evidence.",
    { ...pacingEvidence, waitEvent: pacingPair.waitEvent },
  );

  const bufferInputs = [
    {
      requestId: ids.bufferA,
      shift: shifts.buffer,
      kind: "buffer_override",
      startsAt: shifts.buffer.starts_at,
      endsAt: shifts.buffer.ends_at,
      openingBufferMinutes: 30,
      closingBufferMinutes: 45,
      reason: "Concurrent buffer override A",
    },
    {
      requestId: ids.bufferB,
      shift: shifts.buffer,
      kind: "buffer_override",
      startsAt: shifts.buffer.starts_at,
      endsAt: shifts.buffer.ends_at,
      openingBufferMinutes: 45,
      closingBufferMinutes: 30,
      reason: "Concurrent buffer override B",
    },
  ];
  const bufferPair = await runSerializedPair({
    label: "service-shift buffer configure/configure",
    firstQuery: () => configureException(first, bufferInputs[0]),
    secondQuery: () => configureException(second, bufferInputs[1]),
    followerError: {
      code: "23505",
      constraint: "service_shift_one_active_buffer_override_idx",
    },
  });
  const bufferEvidence = (
    await setup.query(
      `select
         (select count(*)::integer
          from public.service_shift_exceptions exception
          where exception.id = any($1::uuid[]) and exception.status = 'active') exception_count,
         (select count(*)::integer
          from private.operation_requests request
          where request.request_id = any($1::uuid[])
            and request.completed_at is not null) completed_requests,
         (select count(*)::integer
          from public.audit_events event
          where event.action = 'service_shift_exception_created'
            and event.record_id = any($2::text[])) audit_count`,
      [
        [ids.bufferA, ids.bufferB],
        [ids.bufferA, ids.bufferB],
      ],
    )
  ).rows[0];
  assert(
    bufferEvidence.exception_count === 1 &&
      bufferEvidence.completed_requests === 1 &&
      bufferEvidence.audit_count === 1,
    "Concurrent buffer commands left ambiguous durable evidence.",
    { ...bufferEvidence, waitEvent: bufferPair.waitEvent },
  );

  const revokePair = await runSerializedPair({
    label: "service-shift revoke/revoke",
    firstQuery: () =>
      revokeException(
        first,
        ids.revokeA,
        ids.replay,
        "Concurrent closure revocation A",
      ),
    secondQuery: () =>
      revokeException(
        second,
        ids.revokeB,
        ids.replay,
        "Concurrent closure revocation B",
      ),
  });
  const revokeStatuses = [
    revokePair.winnerOutcome.value.rows[0]?.result?.status,
    revokePair.followerOutcome.value.rows[0]?.result?.status,
  ];
  const revokeEvidence = (
    await setup.query(
      `select
         (select status
          from public.service_shift_exceptions exception
          where exception.id = $1::uuid) status,
         (select count(*)::integer
          from private.operation_requests request
          where request.request_id = any($2::uuid[])
            and request.completed_at is not null) completed_requests,
         (select count(*)::integer
          from public.audit_events event
          where event.action = 'service_shift_exception_revoked'
            and event.record_id = $1::text) revoke_audits`,
      [ids.replay, [ids.revokeA, ids.revokeB]],
    )
  ).rows[0];
  assert(
    revokeStatuses.every((status) => status === "revoked") &&
      revokeEvidence.status === "revoked" &&
      revokeEvidence.completed_requests === 2 &&
      revokeEvidence.revoke_audits === 1,
    "Concurrent revocation did not preserve one lifecycle transition.",
    { revokeStatuses, ...revokeEvidence, waitEvent: revokePair.waitEvent },
  );

  const exceptionFirstInput = {
    requestId: ids.exceptionFirst,
    shift: shifts.exceptionFirst,
    kind: "closure",
    startsAt: shifted(shifts.exceptionFirst.starts_at, 15),
    endsAt: shifted(shifts.exceptionFirst.starts_at, 45),
    reason: "Exception-first boundary drift proof",
  };
  await first.query("begin");
  const exceptionFirstResult = await configureException(
    first,
    exceptionFirstInput,
  );
  assert(
    exceptionFirstResult.rows[0]?.result?.id === ids.exceptionFirst,
    "Exception-first fixture did not retain its shift lock.",
    exceptionFirstResult.rows,
  );
  await assumeAdministrator(second);
  await second.query("begin");
  await second.query(
    `update public.reservation_service_periods
     set starts_local = time '18:00', updated_at = clock_timestamp()
     where id = $1::uuid`,
    [ids.period],
  );
  const materializeAfterException = trackQuery(
    second.query(
      "select private.ensure_service_shifts($1::uuid, $2::uuid, array[$3::date])",
      [ids.organization, ids.location, businessDates.exceptionFirst],
    ),
  );
  const exceptionFirstWaitEvent = await proveBlocked(
    setup,
    materializeAfterException,
    second.processID,
    "exception-first service-shift rematerialization",
  );
  await first.query("commit");
  const exceptionFirstConfigurationOutcome = await settleWithin(
    materializeAfterException.promise,
    "exception-first service-shift rematerialization",
  );
  assert(
    !exceptionFirstConfigurationOutcome.ok,
    "Boundary drift unexpectedly committed over active exception evidence.",
    exceptionFirstConfigurationOutcome,
  );
  requireCode(
    exceptionFirstConfigurationOutcome.error,
    "23514",
    "exception-first service-shift rematerialization",
  );
  await rollbackQuietly(second);
  const exceptionFirstEvidence = (
    await setup.query(
      `select
         period.starts_local::text period_start,
         shift.starts_at,
         count(exception.id)::integer active_exceptions
       from public.reservation_service_periods period
       join public.service_shifts shift
         on shift.service_period_id = period.id
        and shift.business_date = $2::date
       left join public.service_shift_exceptions exception
         on exception.service_shift_id = shift.id
        and exception.status = 'active'
       where period.id = $1::uuid
       group by period.starts_local, shift.starts_at`,
      [ids.period, businessDates.exceptionFirst],
    )
  ).rows[0];
  assert(
    exceptionFirstEvidence?.period_start === "17:00:00" &&
      exceptionFirstEvidence.starts_at.getTime() ===
        shifts.exceptionFirst.starts_at.getTime() &&
      exceptionFirstEvidence.active_exceptions === 1,
    "Exception-first rollback did not preserve prior configuration and evidence.",
    { ...exceptionFirstEvidence, waitEvent: exceptionFirstWaitEvent },
  );

  await assumeAdministrator(second);
  await second.query("begin");
  await second.query(
    `update public.reservation_service_periods
     set starts_local = time '18:00', updated_at = clock_timestamp()
     where id = $1::uuid`,
    [ids.period],
  );
  await second.query(
    "select private.ensure_service_shifts($1::uuid, $2::uuid, array[$3::date])",
    [ids.organization, ids.location, businessDates.configurationFirst],
  );
  await assumeRole(first, "authenticated", ids.owner);
  await first.query("begin");
  const configurationFirstInput = {
    requestId: ids.configurationFirst,
    shift: shifts.configurationFirst,
    kind: "closure",
    startsAt: shifted(shifts.configurationFirst.starts_at, 15),
    endsAt: shifted(shifts.configurationFirst.starts_at, 45),
    reason: "Configuration-first stale exception proof",
  };
  const staleException = trackQuery(
    configureException(first, configurationFirstInput),
  );
  const configurationFirstWaitEvent = await proveBlocked(
    setup,
    staleException,
    first.processID,
    "configuration-first stale exception",
  );
  await second.query("commit");
  const staleExceptionOutcome = await settleWithin(
    staleException.promise,
    "configuration-first stale exception",
  );
  assert(
    !staleExceptionOutcome.ok,
    "A stale exception unexpectedly survived committed boundary configuration.",
    staleExceptionOutcome,
  );
  requireCode(
    staleExceptionOutcome.error,
    "23514",
    "configuration-first stale exception",
  );
  await rollbackQuietly(first);
  const configurationFirstEvidence = (
    await setup.query(
      `select
         period.starts_local::text period_start,
         shift.starts_at,
         (select count(*)::integer
          from public.service_shift_exceptions exception
          where exception.id = $3::uuid) exception_count,
         (select count(*)::integer
          from private.operation_requests request
          where request.request_id = $3::uuid) request_count
       from public.reservation_service_periods period
       join public.service_shifts shift
         on shift.service_period_id = period.id
        and shift.business_date = $2::date
       where period.id = $1::uuid`,
      [ids.period, businessDates.configurationFirst, ids.configurationFirst],
    )
  ).rows[0];
  assert(
    configurationFirstEvidence?.period_start === "18:00:00" &&
      configurationFirstEvidence.starts_at.getTime() ===
        shifted(shifts.configurationFirst.starts_at, 60).getTime() &&
      configurationFirstEvidence.exception_count === 0 &&
      configurationFirstEvidence.request_count === 0,
    "Configuration-first serialization left stale exception evidence.",
    {
      ...configurationFirstEvidence,
      waitEvent: configurationFirstWaitEvent,
    },
  );

  await setup.query(
    `update public.reservation_service_periods
     set starts_local = time '17:00', updated_at = clock_timestamp()
     where id = $1::uuid`,
    [ids.period],
  );
  await setup.query(
    "select private.ensure_service_shifts($1::uuid, $2::uuid, array[$3::date])",
    [ids.organization, ids.location, businessDates.configurationFirst],
  );

  await setup.query(`drop schema ${quoteIdentifier(markerSchema)} cascade`);
  process.stdout.write(
    `PASS actual migrated PostgreSQL ${serverVersion} service-shift gate: exact replay, pacing and buffer conflicts, revoke/revoke, and both exception/configuration lock orders\n`,
  );
} finally {
  await Promise.all([rollbackQuietly(first), rollbackQuietly(second)]);
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
          `Disposable service-shift database still has ${activeConnections} active connection(s) after pool shutdown.`,
        );
      }
      await admin.query(`drop database ${quoteIdentifier(databaseName)}`);
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
