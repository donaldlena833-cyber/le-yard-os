import { afterAll, beforeAll, expect, test } from 'vitest';
import { readFileSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';
import pg from 'pg';
import { requireAuthenticatedActor } from '@/data/actor';
import { submitCloseout, approveCloseout } from '@/data/workflows/closeout';
import { configureTipPolicy, saveTipPolicyDraft, approveTipPolicyVersion } from '@/data/workflows/financial-configuration';
import { prepareTipRun, calculateTipRun, approveTipRun, exportTipPayroll } from '@/data/workflows/tips';
import { createEmployeeJobAssignment } from '@/data/workflows/people-configuration';
import { recordMissedTimeEntry } from '@/data/workflows/time';
import { zonedLocalToIso } from '@/data/read-models/local-time';
import { submitCloseoutInputSchema } from '@/data/schemas';
const required = (name) => { const x = process.env[name]; if (!x)
    throw Error('Explicit ' + name + ' required'); return x; };
const fixture = JSON.parse(readFileSync(required('LOCAL_READINESS_FIXTURE_PATH'), 'utf8'));
const backend = JSON.parse(readFileSync(required('LOCAL_READINESS_STATUS_PATH'), 'utf8'));
const output = required('LOCAL_READINESS_EVIDENCE_PATH');
if (fixture.api !== 'http://127.0.0.1:55421' || backend.API_URL !== fixture.api || fixture.classification !== 'isolated_local_synthetic_nonproduction')
    throw Error('Refusing non-loopback or non-synthetic target');
const databaseUrl = new URL(backend.DB_URL);
if (databaseUrl.hostname !== '127.0.0.1' || databaseUrl.port !== '55422' || databaseUrl.pathname !== '/postgres')
    throw Error('Unexpected database target');
const db = new pg.Client({ connectionString: backend.DB_URL });
const contexts = {};
const checks = [];
const phases = [];
function scenario(name, run) { test(name, async () => { const start = checks.length; try {
    await run();
    phases.push({ name, status: checks.slice(start).some(c => !c.passed) ? 'failed_checks' : 'completed' });
}
catch (e) {
    phases.push({ name, status: 'interrupted', message: e instanceof Error ? e.message : String(e) });
    throw e;
} }); }
const runId = randomUUID(), day = required('LOCAL_READINESS_SERVICE_DATE'), closedDay = required('LOCAL_READINESS_FINANCIAL_DATE');
function record(id, expected, passed, observed) { checks.push({ id, expected, passed, observed }); expect.soft(passed, id).toBe(true); }
async function rpc(role, name, args) { const x = await contexts[role].supabase.rpc(name, args); if (x.error)
    throw Error(name + ': ' + x.error.message); return x.data; }
async function refusal(id, role, name, args) { const x = await contexts[role].supabase.rpc(name, args); record(id, 'Database refuses invalid command', !!x.error, { errorCode: x.error?.code ?? null, message: x.error?.message ?? null }); return x; }
beforeAll(async () => {
    await db.connect();
    for (const role of ['Owner', 'Owner2', 'Manager', 'Host', 'Chef', 'Employee']) {
        const supabase = createClient(fixture.api, backend.ANON_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
        const r = await supabase.auth.signInWithPassword({ email: fixture.users[role].email, password: fixture.users[role].password });
        if (r.error)
            throw Error('Local Auth ' + role + ': ' + r.error.message);
        contexts[role] = { supabase, actor: await requireAuthenticatedActor(supabase) };
    }
});
afterAll(async () => {
    writeFileSync(output, JSON.stringify({ at: new Date().toISOString(), runId, classification: fixture.classification, productionReleaseAccepted: false, execution: 'Real local Auth and application workflow/database commands; compressed command sequence, not observed restaurant service timing', serviceDate: day, financialDate: closedDay, phases, checks, summary: { total: checks.length, passed: checks.filter(c => c.passed).length, failed: checks.filter(c => !c.passed).length, interruptedPhases: phases.filter(p => p.status === 'interrupted').length, completed: phases.length > 0 && phases.every(p => p.status === 'completed') } }, null, 2) + '\n');
    await db.end();
});
scenario('current-floor connected reservations: 60 planned covers, interval conflicts and turnover', async () => {
    const tables = (await db.query('select id,label,max_capacity from public.reservation_tables where location_id=$1 and is_active order by label', [fixture.location])).rows;
    record('floor', '20 two-tops / 40 seats', tables.length === 20 && tables.reduce((n, t) => n + t.max_capacity, 0) === 40, { tables: tables.length, seats: tables.reduce((n, t) => n + t.max_capacity, 0) });
    const timeZone = (await db.query('select timezone from public.locations where id=$1', [fixture.location])).rows[0].timezone;
    const at = (time) => { const instant = zonedLocalToIso(day, time, timeZone); if (!instant)
        throw Error('Unresolvable local service time'); return instant; };
    const prior = (await db.query('select count(*)::int n from public.reservations where location_id=$1 and (reserved_at at time zone $3)::date=$2::date', [fixture.location, day, timeZone])).rows[0].n;
    if (prior)
        throw Error('Rehearsal date already has records; select a clean date');
    const reservations = [], instants = ['17:00', '17:20', '17:40', '18:00', '18:30', '18:50'];
    for (let wave = 0; wave < 6; wave++)
        for (let i = 0; i < 5; i++) {
            const table = tables[(wave < 4 ? wave : wave - 4) * 5 + i];
            const args = { p_request_id: randomUUID(), p_location_id: fixture.location, p_display_name: `READINESS ${runId.slice(0, 8)} party ${wave * 5 + i + 1}`, p_email: null, p_phone: null, p_reserved_at: at(instants[wave]), p_duration_minutes: 75, p_party_size: 2, p_special_requests: 'SYNTHETIC command rehearsal; no actual guest', p_source: 'manual', p_table_ids: [table.id] };
            const saved = await rpc('Host', 'save_reservation_with_guest', args);
            reservations.push({ ...saved, tableId: table.id });
            if (!wave && !i) {
                const replay = await rpc('Host', 'save_reservation_with_guest', args);
                record('reservation-exact-retry', 'Retry creates one reservation', saved.id === replay.id, { sameRecord: saved.id === replay.id, replayed: replay.replayed });
            }
        }
    const stored = (await db.query('select id,reserved_at,duration_minutes,party_size from public.reservations where id=any($1::uuid[])', [reservations.map(r => r.id)])).rows;
    const peak = Math.max(...stored.map(r => stored.filter(s => Date.parse(s.reserved_at) <= Date.parse(r.reserved_at) && Date.parse(s.reserved_at) + s.duration_minutes * 60000 > Date.parse(r.reserved_at)).reduce((n, s) => n + s.party_size, 0)));
    record('current-floor-60-covers', '60 stored planned covers; peak 40', stored.length === 30 && stored.reduce((n, r) => n + r.party_size, 0) === 60 && peak === 40, { reservations: stored.length, covers: stored.reduce((n, r) => n + r.party_size, 0), peakConcurrent: peak, turnMinutes: 75 });
    const invalid = { p_request_id: randomUUID(), p_location_id: fixture.location, p_display_name: 'READINESS conflicting party', p_email: null, p_phone: null, p_reserved_at: at('17:45'), p_duration_minutes: 75, p_party_size: 2, p_special_requests: 'Synthetic denial probe', p_source: 'manual', p_table_ids: [tables[0].id] };
    await refusal('overlapping-table-refused', 'Host', 'save_reservation_with_guest', invalid);
    const first = reservations[0];
    for (const state of ['arrived', 'seated', 'completed']) {
        const changed = await rpc('Host', 'transition_reservation', { p_request_id: randomUUID(), p_reservation_id: first.id, p_target_status: state, p_note: 'Synthetic compressed lifecycle, not elapsed service timing' });
        record('lifecycle-' + state, 'Reservation reaches ' + state, changed.status === state, { status: changed.status });
    }
    const status = (await db.query('select status from public.table_status_events where table_id=$1 order by occurred_at desc,id desc limit 1', [first.tableId])).rows[0]?.status;
    record('completion-requires-reset', 'Completion leaves needs_reset', status === 'needs_reset', { physicalStatus: status });
    await rpc('Host', 'set_reservation_table_status', { p_request_id: randomUUID(), p_table_id: first.tableId, p_status: 'available', p_note: 'Synthetic reset only, no physical inspection', p_reservation_id: null });
    const active = (await db.query('select count(*)::int n from public.reservation_table_allocations where reservation_id=$1 and is_active', [first.id])).rows[0].n;
    record('completed-allocation-released', 'Completed interval is released', active === 0, { activeAllocations: active });
    await rpc('Host', 'transition_reservation', { p_request_id: randomUUID(), p_reservation_id: reservations[1].id, p_target_status: 'no_show', p_note: 'Synthetic absent party' });
    const rows = (await db.query('select status from public.reservations where id=$1', [reservations[1].id])).rows;
    record('no-show-retained', 'No-show retains original record', rows[0].status === 'no_show', { status: rows[0].status });
    const badTurn = await contexts.Host.supabase.rpc('save_reservation_with_guest', { ...invalid, p_request_id: randomUUID(), p_display_name: 'READINESS turn-policy bypass', p_reserved_at: at('20:30'), p_duration_minutes: 90, p_table_ids: [tables[0].id] });
    record('create-turn-policy-consistency', 'Creation refuses wrong active turn', !!badTurn.error, { accepted: !badTurn.error, errorCode: badTurn.error?.code ?? null, requestedMinutes: 90, activeMinutes: 75 });
    if (!badTurn.error)
        await rpc('Host', 'cancel_reservation', { p_request_id: randomUUID(), p_location_id: fixture.location, p_reservation_id: badTurn.data.id, p_expected_version: 1, p_reason: 'Synthetic bypass probe finished' });
});
scenario('connected closeout, approved labor, tip policy and immutable payroll-support export', async () => {
    const roles = (await db.query('select id,name from public.job_roles where organization_id=$1', [fixture.org])).rows, server = roles.find(r => r.name === 'Server');
    if (!server)
        throw Error('Server role missing');
    for (const [role, from, to] of [['Employee', '16:00', '20:00'], ['Host', '18:00', '20:00']]) {
        const employee = (await db.query('select id from public.employees where user_id=$1 and organization_id=$2', [fixture.users[role].id, fixture.org])).rows[0];
        await createEmployeeJobAssignment(contexts.Owner, { requestId: randomUUID(), employeeId: employee.id, jobRoleId: server.id, locationId: fixture.location, hourlyRateCents: null, effectiveFrom: closedDay, effectiveTo: closedDay, isPrimary: true });
        const entry = await recordMissedTimeEntry(contexts.Owner, { requestId: randomUUID(), locationId: fixture.location, employeeId: employee.id, jobRoleId: server.id, scheduledShiftId: null, clockedInLocal: `${closedDay}T${from}`, clockedOutLocal: `${closedDay}T${to}`, reason: 'SYNTHETIC labor mechanics, no actual wages or attendance' });
        const proof = (await db.query('select status,source,approved_by from public.time_entries where id=$1', [entry.id])).rows[0];
        record('missed-labor-' + role, 'Authorized manager records another qualified employee as corrected', proof.status === 'corrected' && proof.source === 'manager' && proof.approved_by === fixture.users.Owner.id, { status: proof.status, source: proof.source, approvedByRecorder: proof.approved_by === fixture.users.Owner.id, requiresSeparateReview: false });
    }
    const args = submitCloseoutInputSchema.parse({ submissionId: randomUUID(), locationId: fixture.location, businessDate: closedDay, shiftLabel: 'READINESS ' + runId.slice(0, 8), grossSalesCents: 360000, netSalesCents: 350000, cashSalesCents: 50000, cardSalesCents: 300000, expectedCashCents: 50000, actualCashCents: 49900, covers: 60, compsCents: 10000, voidsCents: 0, serviceChargesCents: 0, cardTipsCents: 60001, cashTipsCents: 0, notes: 'SYNTHETIC TEST ONLY: one-dollar variance; no actual cash or revenue' });
    let managerDenied = false;
    try {
        await submitCloseout(contexts.Manager, { ...args, submissionId: randomUUID() });
    }
    catch (e) {
        managerDenied = e.code === 'forbidden';
    }
    record('manager-without-financial-capability', 'Manager lacking closeout capabilities cannot submit', managerDenied, { denied: managerDenied });
    const saved = await submitCloseout(contexts.Owner, args), replay = await submitCloseout(contexts.Owner, args);
    record('closeout-exact-retry', 'Retry returns original closeout', saved.id === replay.id && replay.alreadyApplied, { sameRecord: saved.id === replay.id, alreadyApplied: replay.alreadyApplied });
    await refusal('closeout-self-review', 'Owner', 'approve_closeout', { p_closeout_id: saved.id, p_approved: true, p_note: 'Synthetic denial' });
    const approved = await approveCloseout(contexts.Owner2, { closeoutId: saved.id, approved: true, note: 'Independent synthetic variance review' });
    record('closeout-independent-review', 'Independent approval succeeds', approved.status === 'approved', { status: approved.status });
    const changed = await contexts.Owner.supabase.from('shift_closeouts').update({ actual_cash_cents: 50000 }).eq('id', saved.id).select('id');
    record('closeout-immutable', 'Reviewed cash cannot be changed', !!changed.error, { errorCode: changed.error?.code ?? null });
    const policy = await configureTipPolicy(contexts.Owner, { requestId: randomUUID(), policyId: randomUUID(), organizationId: fixture.org, locationId: fixture.location, name: 'READINESS ONLY hours ' + runId.slice(0, 8), description: 'Synthetic mechanics; no restaurant or legal policy approval', isActive: true });
    const version = await saveTipPolicyDraft(contexts.Owner, { requestId: randomUUID(), policyId: policy.id, policyVersionId: randomUUID(), distributionMethod: 'hours', effectiveFrom: closedDay, effectiveTo: closedDay, closeoutSources: ['card_tips'], eligibilityRules: roles.map(r => ({ jobRoleId: r.id, eligible: r.id === server.id, points: 1, minimumMinutes: 0 })) });
    await refusal('policy-self-approval', 'Owner', 'approve_tip_policy_version', { p_request_id: randomUUID(), p_policy_version_id: version.id });
    await approveTipPolicyVersion(contexts.Owner2, { requestId: randomUUID(), policyVersionId: version.id });
    const prepared = await prepareTipRun(contexts.Owner, { requestId: randomUUID(), closeoutId: saved.id, policyVersionId: version.id });
    await calculateTipRun(contexts.Owner, { tipRunId: prepared.id });
    await refusal('tip-run-self-approval', 'Owner', 'approve_tip_run', { p_tip_run_id: prepared.id });
    await approveTipRun(contexts.Owner2, { tipRunId: prepared.id });
    const allocations = (await db.query('select a.employee_id,p.worked_minutes,a.final_amount_cents from public.tip_allocations a join public.tip_run_participants p on p.tip_run_id=a.tip_run_id and p.employee_id=a.employee_id where a.tip_run_id=$1', [prepared.id])).rows;
    record('tip-cents-conserved', '60001 cents conserved across two 4h/2h workers', allocations.reduce((n, r) => n + Number(r.final_amount_cents), 0) === 60001 && allocations.length === 2, { allocations: allocations.map(r => ({ workedMinutes: r.worked_minutes, finalCents: r.final_amount_cents })), sumCents: allocations.reduce((n, r) => n + Number(r.final_amount_cents), 0) });
    const exportId = randomUUID(), exported = await exportTipPayroll(contexts.Owner2, { requestId: exportId, tipRunId: prepared.id }), exportReplay = await exportTipPayroll(contexts.Owner2, { requestId: exportId, tipRunId: prepared.id });
    const count = (await db.query('select count(*)::int n from public.payroll_exports where id=$1', [exportId])).rows[0].n;
    record('payroll-support-export-once', 'One audit record, no payroll submission', count === 1 && exported.csv === exportReplay.csv, { auditRows: count, exportFields: Object.keys(exported), submittedToPayroll: false });
    const earnings = await contexts.Employee.supabase.from('tip_allocations').select('employee_id,final_amount_cents').eq('tip_run_id', prepared.id);
    const employeeId = (await db.query('select id from public.employees where user_id=$1 and organization_id=$2', [fixture.users.Employee.id, fixture.org])).rows[0].id;
    record('employee-earnings-scope', 'Employee sees only own allocation', !earnings.error && earnings.data?.length === 1 && earnings.data[0].employee_id === employeeId, { visibleAllocations: earnings.data?.length ?? 0, errorCode: earnings.error?.code ?? null });
});
