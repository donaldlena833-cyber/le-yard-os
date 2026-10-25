import { afterAll, test } from "vitest";
import { EXPECTED_SCHEMA_CONTRACT } from "@/lib/security/schema-contract";
import { readFileSync, writeFileSync } from "node:fs";
import { randomUUID, createHash } from "node:crypto";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { isIsoCalendarDate, zonedLocalToIso } from "@/data/read-models/local-time";

const required = key => {
  if (!process.env[key]) throw new Error(`Explicit ${key} required`);
  return process.env[key];
};
const fixture = JSON.parse(readFileSync(required("LOCAL_READINESS_FIXTURE_PATH")));
const status = JSON.parse(readFileSync(required("LOCAL_READINESS_STATUS_PATH")));
const output = required("LOCAL_READINESS_EVIDENCE_PATH");
const day = required("LOCAL_READINESS_SERVICE_DATE");
if (fixture.classification !== "isolated_local_synthetic_nonproduction" || fixture.api !== "http://127.0.0.1:55421" || status.API_URL !== fixture.api) throw new Error("Nonlocal/non-synthetic target refused");
const databaseUrl = new URL(status.DB_URL);
if (databaseUrl.hostname !== "127.0.0.1" || databaseUrl.port !== "55422" || databaseUrl.pathname !== "/postgres") throw new Error("Unsafe database target");
if (!isIsoCalendarDate(day)) throw new Error("Explicit ISO service date required");
const db = new pg.Client({ connectionString: status.DB_URL });
const clients = {};
const checks = [];
const commands = [];
const records = {};
const runId = randomUUID();
const prefix = `READINESS CONFLICT ${runId.slice(0, 8)}`;
let connected = false;
let completed = false;
function check(id, passed, observed) {
  checks.push({ id, passed, observed });
  if (!passed) throw new Error(`Connected conflict check failed: ${id}`);
}
async function request(role, name, args) {
  const startedAt = new Date().toISOString();
  const began = performance.now();
  const result = await clients[role].rpc(name, args);
  commands.push({ role, name, startedAt, elapsedMs: Math.round(performance.now() - began), status: result.status, code: result.error?.code ?? null });
  return result;
}
async function ok(role, name, args) {
  const result = await request(role, name, args);
  if (result.error) throw new Error(`${name}: ${result.error.code ?? "network"}: ${result.error.message}`);
  return result.data;
}
async function conflict(id, role, name, args, message) {
  const result = await request(role, name, args);
  let receipts = null;
  if (args.p_request_id) {
    receipts = Number((await db.query(`select
      (select count(*) from private.operation_requests where request_id=$1) +
      (select count(*) from private.prep_command_requests where request_id=$1) as n`, [args.p_request_id])).rows[0].n);
  }
  check(id, result.status === 409 && result.error?.code === "PT409" && result.error.message.includes(message) && (receipts === null || receipts === 0), {
    status: result.status, code: result.error?.code ?? null, message: result.error?.message ?? null,
    elapsedMs: commands.at(-1).elapsedMs, durableRequestReceipts: receipts,
  });
}
const at = time => {
  const value = zonedLocalToIso(day, time, "America/New_York");
  if (!value) throw new Error("Invalid local test time");
  return value;
};
const hash = value => createHash("sha256").update(value).digest("hex");
async function prepSnapshot(id) {
  return (await db.query(`select task.state,task.version,task.actual_yield,
    (select count(*)::int from public.inventory_transactions where reference_id=task.id) movements,
    (select coalesce(sum(quantity_delta),0) from public.inventory_transactions where reference_id=task.id) net
    from public.prep_tasks task where task.id=$1`, [id])).rows[0];
}
afterAll(async () => {
  writeFileSync(output, JSON.stringify({
    at: new Date().toISOString(), classification: fixture.classification, runId, businessDate: day,
    scope: "Actual local Auth/HTTP conflicts with authoritative before/after verification; mock upstream facts, no provider traffic or physical action",
    records, checks, commands, completed,
    summary: { passed: checks.filter(c => c.passed).length, total: checks.length, accepted: completed && checks.length >= 20 && checks.every(c => c.passed) },
  }, null, 2) + "\n");
  if (connected) await db.end();
});

test("business conflicts return bounded explicit HTTP responses and preserve state", async () => {
  await db.connect();
  connected = true;
  const options = { auth: { persistSession: false, autoRefreshToken: false }, global: { fetch: (input, init) => fetch(input, { ...init, signal: AbortSignal.timeout(10000) }) } };
  for (const role of ["Owner", "Owner2", "Host", "Chef", "Employee"]) {
    clients[role] = createClient(fixture.api, status.ANON_KEY, options);
    const signed = await clients[role].auth.signInWithPassword({ email: fixture.users[role].email, password: fixture.users[role].password });
    if (signed.error) throw signed.error;
  }
  clients.Service = createClient(fixture.api, status.SERVICE_ROLE_KEY, options);
  const contract = await ok("Service", "service_runtime_schema_contract", {});
  const explicit = Number((await db.query("select count(*)::int n from pg_proc fn join pg_namespace ns on ns.oid=fn.pronamespace where ns.nspname in ('public','private') and fn.prokind='f' and fn.prosrc ~ $1", ["errcode\\s*=\\s*'40001'"])).rows[0].n);
  check("exact_contract_and_no_explicit_40001", contract.matchesExpected === true && contract.migrationHead === EXPECTED_SCHEMA_CONTRACT.migrationHead && explicit === 0, { migrationHead: contract.migrationHead, explicitRaises: explicit, publicFunctions: contract.publicFunctionCount });

  // A fresh unallocated booking tests version fences without occupying a table.
  const quote = await ok("Host", "quote_staff_reservation_turn", { p_location_id: fixture.location, p_starts_at: at("18:00"), p_party_size: 2, p_reservation_id: null });
  const booking = { p_request_id: randomUUID(), p_location_id: fixture.location, p_display_name: prefix, p_email: null, p_phone: null, p_reserved_at: at("18:00"), p_duration_minutes: quote.durationMinutes, p_party_size: 2, p_special_requests: prefix, p_source: "manual", p_table_ids: [] };
  const saved = await ok("Host", "save_reservation_with_guest", booking);
  records.reservationId = saved.id;
  const replay = await ok("Host", "save_reservation_with_guest", booking);
  check("reservation_create_exact_retry", replay.id === saved.id, { id: saved.id, sameRecord: replay.id === saved.id });
  const edit = { p_request_id: randomUUID(), p_location_id: fixture.location, p_reservation_id: saved.id, p_expected_version: 1, p_reserved_at: at("18:20"), p_duration_minutes: quote.durationMinutes, p_party_size: 2, p_special_requests: prefix, p_table_ids: [], p_reason: prefix };
  const edited = await ok("Host", "modify_reservation", edit);
  check("reservation_current_edit", edited.version === 2, { version: edited.version });
  await conflict("reservation_stale_edit", "Host", "modify_reservation", { ...edit, p_request_id: randomUUID(), p_reserved_at: at("18:40") }, "Reservation changed concurrently");
  await conflict("reservation_stale_cancel", "Host", "cancel_reservation", { p_request_id: randomUUID(), p_location_id: fixture.location, p_reservation_id: saved.id, p_expected_version: 1, p_reason: prefix }, "Reservation changed concurrently");
  await conflict("reservation_stale_correction", "Owner", "correct_reservation_status", { p_request_id: randomUUID(), p_location_id: fixture.location, p_reservation_id: saved.id, p_expected_version: 1, p_reason: prefix }, "Reservation changed concurrently");
  const live = (await db.query("select version,status,reserved_at from public.reservations where id=$1", [saved.id])).rows[0];
  check("stale_reservations_do_not_change_record", live.version === 2 && live.status === "booked" && live.reserved_at.toISOString() === at("18:20"), { version: live.version, status: live.status });
  const cancelArgs = { p_request_id: randomUUID(), p_location_id: fixture.location, p_reservation_id: saved.id, p_expected_version: 2, p_reason: prefix + " cleanup through authorized cancellation" };
  const cancelled = await ok("Host", "cancel_reservation", cancelArgs);
  const cancelReplay = await ok("Host", "cancel_reservation", cancelArgs);
  check("current_cancel_and_exact_retry", cancelled.version === 3 && cancelReplay.version === 3, { version: cancelled.version, replayVersion: cancelReplay.version });

  const table = (await db.query("select id,position_x,position_y from public.reservation_tables where location_id=$1 and is_active order by id limit 1", [fixture.location])).rows[0];
  await conflict("stale_floor_positions", "Owner", "save_reservation_floor_positions", { p_request_id: randomUUID(), p_location_id: fixture.location, p_moves: [{ tableId: table.id, fromX: Number(table.position_x) < 0.5 ? 0.75 : 0.25, fromY: Number(table.position_y), toX: Number(table.position_x), toY: Number(table.position_y) }] }, "The floor changed concurrently");
  const tableAfter = (await db.query("select position_x,position_y from public.reservation_tables where id=$1", [table.id])).rows[0];
  check("stale_floor_preserves_coordinates", String(tableAfter.position_x) === String(table.position_x) && String(tableAfter.position_y) === String(table.position_y), tableAfter);

  // A manual output-only prep task keeps this version test independent of recipe policy.
  const item = (await db.query("select id,base_unit_id from public.inventory_items where organization_id=$1 and name='Demo Tomatoes' and is_active and track_inventory", [fixture.org])).rows[0];
  if (!item) throw new Error("Synthetic tracked item missing");
  const taskId = randomUUID(); records.prepTaskId = taskId;
  const draftArgs = { p_request_id: randomUUID(), p_task_id: taskId, p_location_id: fixture.location, p_business_date: day, p_service_period: "prep", p_station: prefix, p_recipe_id: null, p_output_inventory_item_id: item.id, p_target_quantity: 1, p_target_unit_id: item.base_unit_id, p_due_at: at("16:00"), p_assignee_user_id: fixture.users.Chef.id, p_note: prefix + " no physical batch", p_expected_version: null };
  const draft = await ok("Owner", "save_prep_task", draftArgs);
  const updated = await ok("Owner", "save_prep_task", { ...draftArgs, p_request_id: randomUUID(), p_expected_version: draft.version, p_target_quantity: 2 });
  await conflict("prep_stale_draft", "Owner", "save_prep_task", { ...draftArgs, p_request_id: randomUUID(), p_expected_version: draft.version }, "Only the current draft can be edited");
  await conflict("prep_stale_publish", "Owner", "transition_prep_task", { p_request_id: randomUUID(), p_task_id: taskId, p_expected_version: draft.version, p_command: "publish" }, "Prep task changed");
  const published = await ok("Owner", "transition_prep_task", { p_request_id: randomUUID(), p_task_id: taskId, p_expected_version: updated.version, p_command: "publish" });
  await conflict("prep_stale_completion", "Chef", "complete_prep_task", { p_request_id: randomUUID(), p_task_id: taskId, p_expected_version: updated.version, p_actual_yield: 2, p_override_insufficient: false, p_completion_note: prefix }, "Prep task changed");
  const unposted = await prepSnapshot(taskId);
  check("stale_prep_has_no_stock_posting", unposted.movements === 0 && unposted.version === published.version && unposted.state === "published", unposted);
  const completeArgs = { p_request_id: randomUUID(), p_task_id: taskId, p_expected_version: published.version, p_actual_yield: 2, p_override_insufficient: false, p_completion_note: prefix };
  const done = await ok("Chef", "complete_prep_task", completeArgs);
  await ok("Chef", "complete_prep_task", completeArgs);
  const posted = await prepSnapshot(taskId);
  check("current_prep_and_exact_retry_once", posted.movements === 1 && Number(posted.net) === 2 && posted.version === done.version, posted);
  await conflict("prep_stale_correction", "Owner", "correct_prep_completion", { p_request_id: randomUUID(), p_task_id: taskId, p_expected_version: published.version, p_correction_note: prefix }, "Only the current completed prep task");
  const correctionArgs = { p_request_id: randomUUID(), p_task_id: taskId, p_expected_version: done.version, p_correction_note: prefix + " reverse test-only output" };
  await ok("Owner", "correct_prep_completion", correctionArgs);
  await ok("Owner", "correct_prep_completion", correctionArgs);
  const corrected = await prepSnapshot(taskId);
  check("current_correction_reverses_once", corrected.movements === 2 && Number(corrected.net) === 0, corrected);

  // This later-seeded fixture had no release row. Initialize only the default
  // closed state, without booking approval, credentials or public inventory.
  const initialized = await db.query("insert into public.location_release_controls(organization_id,location_id) values($1,$2) on conflict(organization_id,location_id) do nothing returning id", [fixture.org, fixture.location]);
  records.syntheticClosedReleaseFixtureCreated = initialized.rows.length === 1;
  const release = (await db.query("select *,accept_reservations_from::text accept_date from public.location_release_controls where organization_id=$1 and location_id=$2", [fixture.org, fixture.location])).rows[0];
  if (release.state !== "prelaunch" || release.public_inventory_percent !== 0 || release.booking_approved) throw new Error("Synthetic public release is not closed");
  await conflict("stale_release_control", "Owner", "manage_location_release_control", { p_request_id: randomUUID(), p_organization_id: fixture.org, p_location_id: fixture.location, p_expected_version: Number(release.version) - 1, p_state: release.state, p_accept_reservations_from: release.accept_date, p_public_inventory_percent: release.public_inventory_percent, p_booking_approved: release.booking_approved, p_support_ready: release.support_ready }, "Release control changed concurrently");
  const releaseAfter = (await db.query("select version,state,public_inventory_percent,release_id from public.location_release_controls where id=$1", [release.id])).rows[0];
  check("release_stays_closed_and_unchanged", Number(releaseAfter.version) === Number(release.version) && releaseAfter.state === release.state && releaseAfter.public_inventory_percent === 0 && releaseAfter.release_id === release.release_id, releaseAfter);

  const workspace = (await db.query("select id,revision,data from public.startup_workspaces where id='le-yard-readiness-20261024' and organization_id=$1", [fixture.org])).rows[0];
  if (!workspace || Number(workspace.revision) < 2) throw new Error("Existing synthetic Opening Room workspace missing");
  const opening = await request("Owner", "save_startup_workspace_v3", { p_workspace_id: workspace.id, p_expected_revision: Number(workspace.revision) - 1, p_data: workspace.data, p_operation_id: randomUUID() });
  check("opening_room_structured_conflict_preserved", !opening.error && opening.status === 200 && opening.data?.[0]?.outcome === "conflict" && Number(opening.data[0].revision) === Number(workspace.revision), { httpStatus: opening.status, outcome: opening.data?.[0]?.outcome, revision: opening.data?.[0]?.revision });

  // Mock provider facts travel only to the local API; no live adapter or worker runs.
  const observedAt = new Date(Date.now() - 3600000).toISOString();
  const source = { p_organization_id: fixture.org, p_location_id: fixture.location, p_source: "internal", p_external_id: prefix, p_status: "closed", p_opened_at: new Date(Date.now() - 7200000).toISOString(), p_closed_at: observedAt, p_gross_sales_cents: 100, p_net_sales_cents: 100, p_discount_cents: 0, p_comp_cents: 0, p_void_cents: 0, p_tax_cents: 0, p_tip_cents: 0, p_service_charge_cents: 0, p_covers: 1, p_order_channel: prefix, p_source_observed_at: observedAt, p_payload_hash: hash(prefix) };
  const ingested = await ok("Service", "ingest_income_sales_check", source); records.incomeCheckId = ingested.id;
  const ingestReplay = await ok("Service", "ingest_income_sales_check", source);
  check("income_exact_source_replay", ingested.id === ingestReplay.id && ingestReplay.replayed === true, { id: ingested.id, replayed: ingestReplay.replayed });
  await conflict("stale_income_source", "Service", "ingest_income_sales_check", { ...source, p_source_observed_at: new Date(Date.parse(observedAt) - 1000).toISOString(), p_net_sales_cents: 90 }, "Sales-check source evidence is stale");
  const income = (await db.query("select net_sales_cents,payload_hash from public.income_sales_checks where id=$1", [ingested.id])).rows[0];
  check("stale_income_preserves_facts", Number(income.net_sales_cents) === 100 && income.payload_hash === source.p_payload_hash, { netSalesCents: income.net_sales_cents, sourceRetained: income.payload_hash === source.p_payload_hash });
  const denied = await request("Employee", "ingest_income_sales_check", { ...source, p_external_id: prefix + " denied" });
  check("service_ingest_stays_unavailable_to_employee", denied.status === 403 && denied.error?.code === "42501", { status: denied.status, code: denied.error?.code });

  // A disconnected secondary-location fixture supplies mappings only. It has
  // no merchant credentials and starts no adapter, sync worker or provider call.
  await db.query("insert into public.integration_connections(organization_id,location_id,provider,display_name,status,created_by) values($1,$2,'toast',$3,'disconnected',$4) on conflict(organization_id,provider,location_id) do nothing", [fixture.org, fixture.otherLocation, prefix + " mock mapping only", fixture.users.Owner.id]);
  const connection = (await db.query("select id,status from public.integration_connections where organization_id=$1 and location_id=$2 and provider='toast'", [fixture.org, fixture.otherLocation])).rows[0];
  if (connection?.status !== "disconnected") throw new Error("A disconnected test-only POS mapping is required");
  const employee = (await db.query("select id from public.employees where organization_id=$1 and user_id=$2", [fixture.org, fixture.users.CrossLocation.id])).rows[0];
  const role = (await db.query("select id from public.job_roles where organization_id=$1 and name='Server' and is_active", [fixture.org])).rows[0];
  if (!employee || !role) throw new Error("Synthetic employee/job mapping missing");
  const localDate = (await db.query("select (clock_timestamp() at time zone 'America/New_York')::date::text value")).rows[0].value;
  const qualified = (await db.query("select id from public.employee_job_roles where employee_id=$1 and job_role_id=$2 and location_id=$3 and effective_from<=$4::date and (effective_to is null or effective_to>=$4::date)", [employee.id, role.id, fixture.otherLocation, localDate])).rows.length > 0;
  if (!qualified) await ok("Owner", "create_employee_job_assignment", { p_request_id: randomUUID(), p_employee_id: employee.id, p_job_role_id: role.id, p_location_id: fixture.otherLocation, p_hourly_rate_cents: null, p_effective_from: localDate, p_effective_to: localDate, p_is_primary: false });
  const clockOut = new Date(Date.now() - 3 * 3600000).toISOString();
  const posArgs = { p_organization_id: fixture.org, p_location_id: fixture.otherLocation, p_connection_id: connection.id, p_external_id: prefix, p_external_modified_at: observedAt, p_payload_hash: hash(prefix + " pos1"), p_employee_id: employee.id, p_job_role_id: role.id, p_scheduled_shift_id: null, p_clocked_in_at: new Date(Date.parse(clockOut) - 3600000).toISOString(), p_clocked_out_at: clockOut, p_auto_clocked_out: false, p_source_deleted_at: null, p_breaks: [] };
  const pos = await ok("Service", "service_ingest_pos_time_entry", posArgs);
  records.posTimeEntryId = pos.id;
  const posReplay = await ok("Service", "service_ingest_pos_time_entry", posArgs);
  check("pos_source_exact_retry", posReplay.id === pos.id && posReplay.reason === "replayed_source_version", { id: pos.id, status: posReplay.status, reason: posReplay.reason, providerTraffic: false });
  await conflict("pos_same_version_different_facts", "Service", "service_ingest_pos_time_entry", { ...posArgs, p_payload_hash: hash(prefix + " pos2"), p_clocked_out_at: new Date(Date.parse(clockOut) + 300000).toISOString() }, "same POS version contains different facts");
  const posRow = (await db.query("select clocked_out_at,source_payload_hash from public.time_entries where id=$1", [pos.id])).rows[0];
  check("pos_conflict_preserves_source_facts", posRow.clocked_out_at.toISOString() === clockOut && posRow.source_payload_hash === posArgs.p_payload_hash, { clockedOutAt: posRow.clocked_out_at, originalHashRetained: posRow.source_payload_hash === posArgs.p_payload_hash });
  const older = await ok("Service", "service_ingest_pos_time_entry", { ...posArgs, p_external_modified_at: new Date(Date.parse(observedAt) - 1000).toISOString() });
  check("older_pos_version_stays_noop", older.id === pos.id && older.reason === "stale_source_version" && older.status === "unchanged", { status: older.status, reason: older.reason });
  completed = true;
}, 120000);
