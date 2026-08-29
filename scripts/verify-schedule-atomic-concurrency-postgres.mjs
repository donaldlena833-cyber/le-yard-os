import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { Pool } from "pg";
import { requireLocalPostgresControlUrl } from "./lib/require-local-postgres-control-url.mjs";

const suppliedConnectionString =
  process.env.SCHEDULE_TEST_DATABASE_URL ??
  process.env.RESERVATION_TEST_DATABASE_URL;

requireLocalPostgresControlUrl(
  suppliedConnectionString,
  "SCHEDULE_TEST_DATABASE_URL or RESERVATION_TEST_DATABASE_URL",
);

const root = process.cwd();
const migrationDirectory = join(root, "supabase", "migrations");
const migrationFiles = (await readdir(migrationDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const runId = randomUUID().replaceAll("-", "");
const databaseName = `schedule_concurrency_${runId}`;
const markerSchema = `schedule_concurrency_run_${runId}`;
const quoteIdentifier = (value) => `"${value.replaceAll('"', '""')}"`;
const testUrl = new URL(suppliedConnectionString);
testUrl.pathname = `/${databaseName}`;

const ids = {
  organization: "20000000-0000-4000-8000-000000000001",
  location: "30000000-0000-4000-8000-000000000001",
  owner: "10000000-0000-4000-8000-000000000001",
  createA: randomUUID(),
  createB: randomUUID(),
  createC: randomUUID(),
  templateA: randomUUID(),
  templateB: randomUUID(),
  shift: randomUUID(),
  reverseShift: randomUUID(),
  concurrentPublishShift: randomUUID(),
};

const pauseAdvisoryKey = "7205759403792793";

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
  application_name: "le-yard-schedule-concurrency-admin",
});

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
    ...(userId ? { sub: userId, aal: "aal2" } : {}),
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
        `select pid, state, wait_event_type, wait_event
         from pg_stat_activity
         where pid = any($1::integer[])`,
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
      throw new Error(`${label} did not hold one transaction behind the other.`);
    }
    await pause(20);
  }
  throw new Error(
    `${label} never produced a database-visible serialized pair.`,
  );
}

async function proveBlocked(observer, state, backendPid, label) {
  const deadline = Date.now() + 10_000;
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
        `select state, wait_event_type, wait_event
         from pg_stat_activity
         where pid = $1`,
        [backendPid],
      )
    ).rows[0];
    if (activity?.state === "active" && activity.wait_event_type === "Lock") {
      return activity.wait_event;
    }
    await pause(20);
  }
  throw new Error(`${label} never reached a database-visible lock wait.`);
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

async function createSchedule(client, requestId, weekStart) {
  return client.query(
    `select public.create_schedule_draft(
       $1::uuid, $2::uuid, $3::date, null::uuid
     ) result`,
    [requestId, ids.location, weekStart],
  );
}

async function saveTemplate(client, requestId, scheduleId, name) {
  return client.query(
    `select public.save_schedule_template(
       $1::uuid, $2::uuid, $3::text
     ) result`,
    [requestId, scheduleId, name],
  );
}

async function publishSchedule(client, scheduleId, note) {
  return client.query(
    `select published.id, published.status, published.published_by,
            published.published_at, published.publish_note
     from public.publish_schedule($1::uuid, $2::text) published`,
    [scheduleId, note],
  );
}

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
    application_name: "le-yard-schedule-concurrency-actual-schema",
  });
  setup = await testPool.connect();
  await setup.query(`create schema ${quoteIdentifier(markerSchema)}`);
  await setup.query(bootstrap);

  for (const file of migrationFiles) {
    try {
      await setup.query(
        await readFile(join(migrationDirectory, file), "utf8"),
      );
    } catch (error) {
      throw new Error(`Actual migration failed in ${file}: ${error.message}`, {
        cause: error,
      });
    }
  }
  await setup.query(await readFile(join(root, "supabase", "seed.sql"), "utf8"));

  const targetWeek = (
    await setup.query(
      `with configured as (
         select
           (clock_timestamp() at time zone location.timezone)::date local_date,
           settings.week_starts_on
         from public.locations location
         join public.organization_settings settings
           on settings.organization_id = location.organization_id
         where location.organization_id = $1::uuid
           and location.id = $2::uuid
       ), aligned as (
         select local_date
           + ((week_starts_on - extract(dow from local_date)::integer + 7) % 7)
             aligned_week
         from configured
       )
       select to_char(aligned_week + candidate.week_offset * 7, 'YYYY-MM-DD') week_start
       from aligned
       cross join generate_series(1000, 2000) candidate(week_offset)
       where not exists (
         select 1
         from public.schedules schedule
         where schedule.organization_id = $1::uuid
           and schedule.location_id = $2::uuid
           and schedule.week_start = aligned_week + candidate.week_offset * 7
       )
       order by candidate.week_offset
       limit 1`,
      [ids.organization, ids.location],
    )
  ).rows[0]?.week_start;
  assert(targetWeek, "No unused future schedule week was available.");

  first = await testPool.connect();
  second = await testPool.connect();
  await assumeRole(first, "authenticated", ids.owner);
  await assumeRole(second, "authenticated", ids.owner);
  await first.query("set statement_timeout = '20s'");
  await second.query("set statement_timeout = '20s'");

  // Launch both commands before either transaction commits. The winner retains
  // the transaction-scoped version advisory lock while PostgreSQL reports the
  // other backend waiting on that lock.
  await first.query("begin");
  await second.query("begin");
  const createStateA = trackQuery(
    createSchedule(first, ids.createA, targetWeek),
  );
  const createStateB = trackQuery(
    createSchedule(second, ids.createB, targetWeek),
  );
  const createSerialization = await waitForSerializedPair(
    setup,
    createStateA,
    first.processID,
    createStateB,
    second.processID,
    "schedule create/create",
  );
  const createWinner =
    createSerialization.winner === "first"
      ? { client: first, state: createStateA }
      : { client: second, state: createStateB };
  const createFollower =
    createSerialization.winner === "first"
      ? { client: second, state: createStateB }
      : { client: first, state: createStateA };
  assert(
    createWinner.state.outcome?.ok,
    "The serialized schedule winner did not return successfully.",
    createWinner.state.outcome,
  );
  await createWinner.client.query("commit");
  const followerCreateOutcome = await settleWithin(
    createFollower.state.promise,
    "schedule create/create follower",
  );
  assert(
    followerCreateOutcome.ok,
    "The serialized schedule follower did not succeed.",
    followerCreateOutcome.error,
  );
  await createFollower.client.query("commit");

  const createEvidence = (
    await setup.query(
      `select
         count(*)::integer schedule_count,
         min(version)::integer min_version,
         max(version)::integer max_version,
         count(distinct version)::integer distinct_versions,
         (select count(*)::integer
          from private.operation_requests request
          where request.request_id = any($1::uuid[])
            and request.completed_at is not null) completed_requests,
         (select count(*)::integer
          from private.schedule_command_results result
          where result.request_id = any($1::uuid[])
            and result.operation_kind = 'schedule.create') command_results
       from public.schedules schedule
       where schedule.id = any($1::uuid[])
         and schedule.organization_id = $2::uuid
         and schedule.location_id = $3::uuid
         and schedule.week_start = $4::date`,
      [
        [ids.createA, ids.createB],
        ids.organization,
        ids.location,
        targetWeek,
      ],
    )
  ).rows[0];
  assert(
    createEvidence.schedule_count === 2 &&
      createEvidence.distinct_versions === 2 &&
      createEvidence.max_version - createEvidence.min_version === 1 &&
      createEvidence.completed_requests === 2 &&
      createEvidence.command_results === 2,
    "Concurrent schedule creation did not produce two consecutive durable versions.",
    { ...createEvidence, waitEvent: createSerialization.waitEvent },
  );

  const thirdCreate = await createSchedule(first, ids.createC, targetWeek);
  assert(
    thirdCreate.rowCount === 1 && thirdCreate.rows[0]?.result?.id === ids.createC,
    "The multi-publisher fixture schedule was not created.",
    thirdCreate.rows,
  );

  await setup.query("reset role");
  await setup.query("select set_config('request.jwt.claims', '{}', false)");
  const activeRole = (
    await setup.query(
      `select role.id
       from public.job_roles role
       where role.organization_id = $1::uuid
         and role.is_active
       order by role.id
       limit 1`,
      [ids.organization],
    )
  ).rows[0]?.id;
  assert(activeRole, "The seed supplied no active job role for a source shift.");
  await setup.query(
    `insert into public.shifts (
       id, organization_id, location_id, schedule_id, employee_id, job_role_id,
       starts_at, ends_at, break_minutes, status, is_open, notes
     )
     select
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, null::uuid, $5::uuid,
       (($6::date + 1 + time '10:00') at time zone location.timezone),
       (($6::date + 1 + time '18:00') at time zone location.timezone),
       30, 'open'::public.shift_status, true, 'Native concurrency source'
     from public.locations location
     where location.organization_id = $2::uuid
       and location.id = $3::uuid`,
    [
      ids.shift,
      ids.organization,
      ids.location,
      ids.createA,
      activeRole,
      targetWeek,
    ],
  );
  await setup.query(
    `insert into public.shifts (
       id, organization_id, location_id, schedule_id, employee_id, job_role_id,
       starts_at, ends_at, break_minutes, status, is_open, notes
     )
     select
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, null::uuid, $5::uuid,
       (($6::date + 3 + time '10:00') at time zone location.timezone),
       (($6::date + 3 + time '18:00') at time zone location.timezone),
       30, 'open'::public.shift_status, true, 'Concurrent publisher source'
     from public.locations location
     where location.organization_id = $2::uuid
       and location.id = $3::uuid`,
    [
      ids.concurrentPublishShift,
      ids.organization,
      ids.location,
      ids.createC,
      activeRole,
      targetWeek,
    ],
  );
  await setup.query(
    `insert into public.shifts (
       id, organization_id, location_id, schedule_id, employee_id, job_role_id,
       starts_at, ends_at, break_minutes, status, is_open, notes
     )
     select
       $1::uuid, $2::uuid, $3::uuid, $4::uuid, null::uuid, $5::uuid,
       (($6::date + 2 + time '10:00') at time zone location.timezone),
       (($6::date + 2 + time '18:00') at time zone location.timezone),
       30, 'open'::public.shift_status, true, 'Publisher-first race source'
     from public.locations location
     where location.organization_id = $2::uuid
       and location.id = $3::uuid`,
    [
      ids.reverseShift,
      ids.organization,
      ids.location,
      ids.createB,
      activeRole,
      targetWeek,
    ],
  );

  const templateName = `Native concurrent template ${runId.slice(0, 12)}`;
  await first.query("begin");
  await second.query("begin");
  const templateStateA = trackQuery(
    saveTemplate(first, ids.templateA, ids.createA, templateName),
  );
  const templateStateB = trackQuery(
    saveTemplate(second, ids.templateB, ids.createA, templateName),
  );
  const templateSerialization = await waitForSerializedPair(
    setup,
    templateStateA,
    first.processID,
    templateStateB,
    second.processID,
    "schedule template same-name save",
  );
  const templateWinner =
    templateSerialization.winner === "first"
      ? { client: first, state: templateStateA, requestId: ids.templateA }
      : { client: second, state: templateStateB, requestId: ids.templateB };
  const templateLoser =
    templateSerialization.winner === "first"
      ? { client: second, state: templateStateB, requestId: ids.templateB }
      : { client: first, state: templateStateA, requestId: ids.templateA };
  assert(
    templateWinner.state.outcome?.ok,
    "The serialized template winner did not return successfully.",
    templateWinner.state.outcome,
  );
  await templateWinner.client.query("commit");
  const loserTemplateOutcome = await settleWithin(
    templateLoser.state.promise,
    "schedule template same-name loser",
  );
  assert(
    !loserTemplateOutcome.ok,
    "Both same-name template saves unexpectedly succeeded.",
    loserTemplateOutcome,
  );
  requireCode(
    loserTemplateOutcome.error,
    "23505",
    "schedule template same-name loser",
  );
  await rollbackQuietly(templateLoser.client);

  const templateEvidence = (
    await setup.query(
      `select
         (select count(*)::integer
          from public.schedule_templates template
          where template.organization_id = $1::uuid
            and template.location_id = $2::uuid
            and template.name = $3::text) named_templates,
         (select count(*)::integer
          from public.schedule_template_shifts shift
          where shift.template_id = $4::uuid) winner_children,
         (select count(*)::integer
          from public.schedule_templates template
          where template.id = $5::uuid) loser_templates,
         (select count(*)::integer
          from public.schedule_template_shifts shift
          where shift.template_id = $5::uuid) loser_children,
         (select count(*)::integer
          from private.operation_requests request
          where request.request_id = $4::uuid
            and request.completed_at is not null) winner_requests,
         (select count(*)::integer
          from private.schedule_command_results result
          where result.request_id = $4::uuid
            and result.operation_kind = 'schedule.template.save') winner_results,
         (select count(*)::integer
          from private.operation_requests request
          where request.request_id = $5::uuid) loser_requests,
         (select count(*)::integer
          from private.schedule_command_results result
          where result.request_id = $5::uuid) loser_results`,
      [
        ids.organization,
        ids.location,
        templateName,
        templateWinner.requestId,
        templateLoser.requestId,
      ],
    )
  ).rows[0];
  assert(
    templateEvidence.named_templates === 1 &&
      templateEvidence.winner_children === 1 &&
      templateEvidence.loser_templates === 0 &&
      templateEvidence.loser_children === 0 &&
      templateEvidence.winner_requests === 1 &&
      templateEvidence.winner_results === 1 &&
      templateEvidence.loser_requests === 0 &&
      templateEvidence.loser_results === 0,
    "Same-name template serialization left duplicate or orphan state.",
    { ...templateEvidence, waitEvent: templateSerialization.waitEvent },
  );

  // Force the dangerous real interleaving instead of merely committing an
  // updater before publication starts. The editor owns the child tuple and
  // shifts ROW EXCLUSIVE table lock, then pauses in an alphabetically first
  // BEFORE trigger before the production parent-lock trigger can run. A safe
  // publisher must wait on its SHARE table barrier without touching the
  // parent. Releasing the editor lets it acquire parent -> finish -> commit;
  // only then may publication lock parent -> child and validate fresh state.
  await setup.query(
    `create function ${quoteIdentifier(markerSchema)}.pause_shift_update()
     returns trigger
     language plpgsql
     set search_path = ''
     as $pause$
     begin
       if old.id::text = current_setting(
         'schedule_concurrency.pause_shift_id', true
       ) then
         perform pg_advisory_xact_lock(${pauseAdvisoryKey}::bigint);
       end if;
       return new;
     end
     $pause$;
     create trigger "00_schedule_concurrency_pause"
     before update on public.shifts
     for each row execute function ${quoteIdentifier(markerSchema)}.pause_shift_update();`,
  );
  await setup.query("select pg_advisory_lock($1::bigint)", [pauseAdvisoryKey]);

  await first.query("begin");
  const childLock = await first.query(
    `select id
     from public.shifts
     where id = $1::uuid
       and schedule_id = $2::uuid
     for update`,
    [ids.shift, ids.createA],
  );
  assert(
    childLock.rowCount === 1,
    "The simultaneous-interleaving editor did not acquire the child tuple.",
    childLock.rows,
  );
  await first.query(
    "select set_config('schedule_concurrency.pause_shift_id', $1, true)",
    [ids.shift],
  );
  const mutationState = trackQuery(
    first.query(
      `update public.shifts
       set break_minutes = 45
       where id = $1::uuid
         and schedule_id = $2::uuid
       returning id, break_minutes`,
      [ids.shift, ids.createA],
    ),
  );
  const mutationPauseWaitEvent = await proveBlocked(
    setup,
    mutationState,
    first.processID,
    "paused direct shift update before parent lock",
  );

  await second.query("begin");
  const publishNote = `Native publish race ${runId.slice(0, 12)}`;
  const publishState = trackQuery(
    publishSchedule(second, ids.createA, publishNote),
  );
  const publishWaitEvent = await proveBlocked(
    setup,
    publishState,
    second.processID,
    "publish SHARE barrier behind paused shift update",
  );
  const barrierEvidence = (
    await setup.query(
      `select
         coalesce(bool_or(
           lock.pid = $1::integer and lock.mode = 'RowExclusiveLock'
             and lock.granted
         ) filter (where lock.relation = 'public.shifts'::regclass), false)
           updater_row_exclusive,
         coalesce(bool_or(
           lock.pid = $2::integer and lock.mode = 'ShareLock'
             and not lock.granted
         ) filter (where lock.relation = 'public.shifts'::regclass), false)
           publisher_share_waiting,
         coalesce(bool_or(
           lock.pid = $2::integer and lock.mode = 'RowShareLock'
             and lock.granted
         ) filter (where lock.relation = 'public.schedules'::regclass), false)
           publisher_reached_parent_lock
       from pg_locks lock
       where lock.pid = any($3::integer[])`,
      [first.processID, second.processID, [first.processID, second.processID]],
    )
  ).rows[0];
  assert(
    barrierEvidence.updater_row_exclusive === true &&
      barrierEvidence.publisher_share_waiting === true &&
      barrierEvidence.publisher_reached_parent_lock === false,
    "Publication did not wait at the shifts table before its parent lock.",
    { ...barrierEvidence, publishWaitEvent, mutationPauseWaitEvent },
  );

  await setup.query("select pg_advisory_unlock($1::bigint)", [pauseAdvisoryKey]);
  const mutationOutcome = await settleWithin(
    mutationState.promise,
    "paused direct shift update after release",
  );
  assert(
    mutationOutcome.ok &&
      mutationOutcome.value.rowCount === 1 &&
      mutationOutcome.value.rows[0].break_minutes === 45,
    "The paused draft shift mutation did not resume before publication.",
    mutationOutcome.ok ? mutationOutcome.value.rows : {
      code: mutationOutcome.error?.code,
      message: mutationOutcome.error?.message,
    },
  );
  const stillBlockedEvent = await proveBlocked(
    setup,
    publishState,
    second.processID,
    "publisher retained behind editor transaction",
  );
  await first.query("commit");
  const publishOutcome = await settleWithin(
    publishState.promise,
    "publish after simultaneous direct shift update",
  );
  assert(
    publishOutcome.ok &&
      publishOutcome.value.rowCount === 1 &&
      publishOutcome.value.rows[0].id === ids.createA &&
      publishOutcome.value.rows[0].status === "published" &&
      publishOutcome.value.rows[0].published_at != null,
    "Publication did not resume successfully after the draft mutation committed.",
    publishOutcome.ok ? publishOutcome.value.rows : {
      code: publishOutcome.error?.code,
      message: publishOutcome.error?.message,
    },
  );
  await second.query("commit");
  await setup.query(
    `drop trigger "00_schedule_concurrency_pause" on public.shifts;
     drop function ${quoteIdentifier(markerSchema)}.pause_shift_update();`,
  );

  let postPublicationMutationError;
  await first.query("begin");
  try {
    await first.query(
      `update public.shifts
       set break_minutes = 50
       where id = $1::uuid
         and schedule_id = $2::uuid`,
      [ids.shift, ids.createA],
    );
  } catch (error) {
    postPublicationMutationError = error;
  }
  requireCode(
    postPublicationMutationError,
    "42501",
    "post-publication structural shift mutation",
  );
  await rollbackQuietly(first);

  const publicationEvidence = (
    await setup.query(
      `select
         schedule.status,
         schedule.published_by,
         schedule.published_at is not null published_at_set,
         schedule.publish_note,
         shift.break_minutes,
         (select count(*)::integer
          from public.shifts all_shift
          where all_shift.organization_id = schedule.organization_id
            and all_shift.location_id = schedule.location_id
            and all_shift.schedule_id = schedule.id) shift_count
       from public.schedules schedule
       join public.shifts shift
         on shift.organization_id = schedule.organization_id
        and shift.location_id = schedule.location_id
        and shift.schedule_id = schedule.id
       where schedule.id = $1::uuid
         and shift.id = $2::uuid`,
      [ids.createA, ids.shift],
    )
  ).rows[0];
  assert(
    publicationEvidence?.status === "published" &&
      publicationEvidence.published_by === ids.owner &&
      publicationEvidence.published_at_set === true &&
      publicationEvidence.publish_note === publishNote &&
      publicationEvidence.break_minutes === 45 &&
      publicationEvidence.shift_count === 1,
    "Publish/direct-shift serialization did not preserve the safe final state.",
    {
      ...publicationEvidence,
      publishWaitEvent,
      mutationPauseWaitEvent,
      stillBlockedEvent,
    },
  );

  // Reverse the order: publication owns SHARE, parent, and child locks before
  // a direct structural UPDATE starts. The UPDATE must wait for ROW EXCLUSIVE
  // at the table barrier, then re-read the committed published status in its
  // production trigger and reject without ever changing the child.
  await first.query("begin");
  const reversePublishNote = `Publisher-first race ${runId.slice(0, 12)}`;
  const reversePublish = await publishSchedule(
    first,
    ids.createB,
    reversePublishNote,
  );
  assert(
    reversePublish.rowCount === 1 &&
      reversePublish.rows[0].status === "published",
    "Publisher-first proof did not retain an uncommitted published parent.",
    reversePublish.rows,
  );

  await second.query("begin");
  const reverseMutationState = trackQuery(
    second.query(
      `update public.shifts
       set break_minutes = 60
       where id = $1::uuid
         and schedule_id = $2::uuid
       returning id, break_minutes`,
      [ids.reverseShift, ids.createB],
    ),
  );
  const reverseWaitEvent = await proveBlocked(
    setup,
    reverseMutationState,
    second.processID,
    "direct shift update behind publication",
  );
  const reverseBarrierEvidence = (
    await setup.query(
      `select
         coalesce(bool_or(
           lock.pid = $1::integer and lock.mode = 'ShareLock' and lock.granted
         ), false) publisher_share_granted,
         coalesce(bool_or(
           lock.pid = $2::integer and lock.mode = 'RowExclusiveLock'
             and not lock.granted
         ), false) updater_row_exclusive_waiting
       from pg_locks lock
       where lock.relation = 'public.shifts'::regclass
         and lock.pid = any($3::integer[])`,
      [first.processID, second.processID, [first.processID, second.processID]],
    )
  ).rows[0];
  assert(
    reverseBarrierEvidence.publisher_share_granted === true &&
      reverseBarrierEvidence.updater_row_exclusive_waiting === true,
    "Publisher-first mutation did not block at the shifts table barrier.",
    { ...reverseBarrierEvidence, reverseWaitEvent },
  );
  await first.query("commit");
  const reverseMutationOutcome = await settleWithin(
    reverseMutationState.promise,
    "direct shift update behind publication",
  );
  assert(
    !reverseMutationOutcome.ok,
    "A structural shift update approved before waiting resumed after publication.",
    reverseMutationOutcome,
  );
  requireCode(
    reverseMutationOutcome.error,
    "42501",
    "publisher-first structural shift mutation",
  );
  await rollbackQuietly(second);

  const reversePublicationEvidence = (
    await setup.query(
      `select schedule.status, schedule.publish_note, shift.break_minutes
       from public.schedules schedule
       join public.shifts shift on shift.schedule_id = schedule.id
       where schedule.id = $1::uuid
         and shift.id = $2::uuid`,
      [ids.createB, ids.reverseShift],
    )
  ).rows[0];
  assert(
    reversePublicationEvidence?.status === "published" &&
      reversePublicationEvidence.publish_note === reversePublishNote &&
      reversePublicationEvidence.break_minutes === 30,
    "Publisher-first serialization allowed a stale-approved child mutation.",
    {
      ...reversePublicationEvidence,
      ...reverseBarrierEvidence,
      waitEvent: reverseWaitEvent,
    },
  );

  // SHARE barriers are mutually compatible. Two publishers for one draft can
  // both pass the table barrier; only the parent row serializes them. The
  // winner writes publication evidence and the follower returns that committed
  // result without a second transition or any 40P01 deadlock.
  const publishNoteA = `Concurrent publisher A ${runId.slice(0, 8)}`;
  const publishNoteB = `Concurrent publisher B ${runId.slice(0, 8)}`;
  await first.query("begin");
  await second.query("begin");
  const concurrentPublishA = trackQuery(
    publishSchedule(first, ids.createC, publishNoteA),
  );
  const concurrentPublishB = trackQuery(
    publishSchedule(second, ids.createC, publishNoteB),
  );
  const concurrentPublishSerialization = await waitForSerializedPair(
    setup,
    concurrentPublishA,
    first.processID,
    concurrentPublishB,
    second.processID,
    "schedule publish/publish",
  );
  const concurrentPublisherWinner =
    concurrentPublishSerialization.winner === "first"
      ? {
          client: first,
          state: concurrentPublishA,
          note: publishNoteA,
        }
      : {
          client: second,
          state: concurrentPublishB,
          note: publishNoteB,
        };
  const concurrentPublisherFollower =
    concurrentPublishSerialization.winner === "first"
      ? { client: second, state: concurrentPublishB }
      : { client: first, state: concurrentPublishA };
  assert(
    concurrentPublisherWinner.state.outcome?.ok &&
      concurrentPublisherWinner.state.outcome.value.rows[0]?.status === "published",
    "The concurrent publication winner did not publish the draft.",
    concurrentPublisherWinner.state.outcome,
  );
  const concurrentPublisherLocks = (
    await setup.query(
      `select count(distinct lock.pid)::integer share_holders
       from pg_locks lock
       where lock.relation = 'public.shifts'::regclass
         and lock.pid = any($1::integer[])
         and lock.mode = 'ShareLock'
         and lock.granted`,
      [[first.processID, second.processID]],
    )
  ).rows[0];
  assert(
    concurrentPublisherLocks.share_holders === 2,
    "Concurrent publishers did not both pass the compatible SHARE barrier.",
    {
      ...concurrentPublisherLocks,
      waitEvent: concurrentPublishSerialization.waitEvent,
    },
  );
  await concurrentPublisherWinner.client.query("commit");
  const concurrentFollowerOutcome = await settleWithin(
    concurrentPublisherFollower.state.promise,
    "schedule publish/publish follower",
  );
  assert(
    concurrentFollowerOutcome.ok &&
      concurrentFollowerOutcome.value.rows[0]?.status === "published" &&
      concurrentFollowerOutcome.value.rows[0]?.publish_note ===
        concurrentPublisherWinner.note,
    "The concurrent publication follower did not replay the winner's evidence.",
    concurrentFollowerOutcome.ok ? concurrentFollowerOutcome.value.rows : {
      code: concurrentFollowerOutcome.error?.code,
      message: concurrentFollowerOutcome.error?.message,
    },
  );
  await concurrentPublisherFollower.client.query("commit");

  const concurrentPublicationEvidence = (
    await setup.query(
      `select schedule.status, schedule.published_by, schedule.publish_note,
              count(shift.id)::integer shift_count
       from public.schedules schedule
       join public.shifts shift on shift.schedule_id = schedule.id
       where schedule.id = $1::uuid
       group by schedule.id`,
      [ids.createC],
    )
  ).rows[0];
  assert(
    concurrentPublicationEvidence?.status === "published" &&
      concurrentPublicationEvidence.published_by === ids.owner &&
      concurrentPublicationEvidence.publish_note === concurrentPublisherWinner.note &&
      concurrentPublicationEvidence.shift_count === 1,
    "Concurrent publishers left inconsistent publication evidence.",
    concurrentPublicationEvidence,
  );

  await setup.query(`drop schema ${quoteIdentifier(markerSchema)} cascade`);
  process.stdout.write(
    "PASS actual migrated PostgreSQL schedule gate: create/create versions, same-name template serialization, forced simultaneous publish/direct-update ordering, publisher-first rejection, and compatible publish/publish serialization without 40P01\n",
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
          `Disposable schedule database still has ${activeConnections} active connection(s) after pool shutdown.`,
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
