import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const ownerId = "10000000-0000-4000-8000-000000000001";
const restaurantEmployeeId = "10000000-0000-4000-8000-000000000005";
const churchEmployeeId = "10000000-0000-4000-8000-000000000011";
const restaurantId = "20000000-0000-4000-8000-000000000001";
const restaurantLocationId = "30000000-0000-4000-8000-000000000001";

async function expectDenial(db, sql, code, label) {
  let result;
  try {
    await db.exec(sql);
  } catch (error) {
    result = error;
  }
  assert.equal(result?.code, code, label);
  return result;
}

async function claims(db, userId, role = "authenticated") {
  const token = JSON.stringify({ sub: userId, role, aal: "aal1" });
  await db.exec(`reset role; set role ${role}; select set_config('request.jwt.claims', '${token}', false);`);
}

async function verifyChurchSquareCountLedger(db, churchId, locationId) {
  const itemId = randomUUID();
  const requestId = randomUUID();
  const list = (location = locationId) => `select public.list_church_square_count_items('${location}') as result`;
  const read = async (sql) => (await db.query(sql)).rows[0].result;
  const configure = (actor = ownerId, item = itemId, merchant = "M_TEST", variation = "V_TEST", enabled = true) =>
    `select public.service_configure_church_square_count_item(
      '${actor}','${locationId}','${item}','Fixture Sandwich','${merchant}','L_TEST','${variation}',${enabled}
    ) as result`;
  const claim = (actor = churchEmployeeId, request = requestId, quantity = "0") =>
    `select public.service_claim_church_square_count(
      '${actor}','${locationId}','${itemId}','${request}','${quantity}','Counted at the counter'
    ) as result`;
  const dispatch = (request, attempt) =>
    `select public.service_mark_church_square_count_dispatched('${request}','${attempt}') as result`;
  const finish = (request, attempt, status, provider = null) =>
    `select public.service_finish_church_square_count('${request}','${attempt}','${status}',${provider ? `'${provider}'` : "null"}) as result`;
  const asService = () => claims(db, undefined, "service_role");
  const expire = async (request, countAge = "5 minutes") => {
    await db.exec("reset role");
    await db.query(`
      update private.church_square_count_requests
      set observed_at = clock_timestamp() - $2::interval, attempt_expires_at = clock_timestamp() - interval '1 second'
      where id = $1
    `, [request, countAge]);
    await asService();
  };

  await claims(db, ownerId);
  assert.deepEqual(await read(list()), []);
  await expectDenial(db, list(restaurantLocationId), "42501", "Square count listing is Church only");
  // Supabase PostgreSQL 17.6 can terminate the backend on a direct ACL-denied
  // call to a definer RPC. Check the exact execution privilege without invoking it.
  assert.equal(await read(`select has_function_privilege(
    current_user, 'public.service_configure_church_square_count_item(uuid,uuid,uuid,text,text,text,text,boolean)', 'EXECUTE'
  ) as result`), false, "Authenticated owner cannot call privileged mapping directly");
  await claims(db, churchEmployeeId);
  await expectDenial(db, list(), "42501", "Prep staff require a separate count capability");
  await asService();
  await expectDenial(db, configure(churchEmployeeId), "42501", "Only an owner or admin may allowlist a Square variation");
  await expectDenial(db, claim(), "42501", "Service-role calls still authorize the represented actor");
  assert.deepEqual(await read(configure()), { id: itemId, enabled: true });
  await expectDenial(db, configure(ownerId, randomUUID(), "M_OTHER"), "PT409", "Church may use one exact merchant and location");
  await expectDenial(db, configure(ownerId, itemId, "M_TEST", "V_OTHER"), "PT409", "Mapped item identity cannot change");

  await db.exec("reset role");
  await db.query(`
    insert into public.user_capability_overrides (
      organization_id,user_id,capability_key,location_id,effect,reason,created_by,updated_by,effective_from
    ) values ($1,$2,'inventory.count.create',$3,'grant','Pilot test',$4,$4,current_date - 1)
  `, [churchId, churchEmployeeId, locationId, ownerId]);
  await claims(db, churchEmployeeId);
  assert.deepEqual(await read(list()), [{
    id: itemId, label: "Fixture Sandwich", pendingRequestId: null, pendingQuantity: null,
    pendingReason: null, pendingObservedAt: null, lastConfirmedQuantity: null, lastConfirmedObservedAt: null,
  }]);
  assert.equal(await read(`select has_function_privilege(
    current_user, 'public.service_claim_church_square_count(uuid,uuid,uuid,uuid,text,text)', 'EXECUTE'
  ) as result`), false, "Authenticated staff cannot get provider scope from service claim");
  await asService();
  await expectDenial(db, claim(churchEmployeeId, requestId, "1.5"), "22023", "Only whole item counts are allowed");
  const pending = await read(claim());
  assert.equal(pending.status, "pending");
  assert.equal(pending.wasDispatched, false);
  assert.equal(pending.variationId, "V_TEST");
  const precision = await db.query("select $1::timestamptz = date_trunc('milliseconds', $1::timestamptz) as exact", [pending.observedAt]);
  assert.equal(precision.rows[0].exact, true);
  await expectDenial(db, finish(requestId, pending.attemptId, "confirmed"), "PT409", "Unsent count cannot be reported confirmed");
  await expectDenial(db, claim(churchEmployeeId, requestId, "2"), "PT409", "Same request ID cannot change the count");
  await expectDenial(db, claim(churchEmployeeId, randomUUID()), "PT409", "Unresolved count blocks newer counts on the item");
  await expectDenial(db, configure(ownerId, itemId, "M_TEST", "V_TEST", false), "PT409", "Pending item cannot be disabled to bypass conflict");
  assert.equal((await read(claim(ownerId))).status, "in_progress");
  await claims(db, churchEmployeeId);
  const [withPending] = await read(list());
  assert.equal(withPending.pendingRequestId, requestId);
  assert.equal(withPending.pendingObservedAt, pending.observedAt);
  assert.equal(withPending.pendingQuantity, "0");
  assert.equal(withPending.pendingReason, "Counted at the counter");
  assert.equal(JSON.stringify(withPending).includes("V_TEST"), false);

  await asService();
  assert.equal(await read(dispatch(requestId, pending.attemptId)), true);
  await expectDenial(db, finish(requestId, pending.attemptId, "rejected"), "PT409", "Dispatch marker prevents declaring an ambiguous count rejected");
  await expire(requestId, "25 hours");
  const recovery = await read(claim(ownerId));
  assert.equal(recovery.status, "recovery_required");
  assert.equal(recovery.wasDispatched, true);
  await expectDenial(db, finish(requestId, pending.attemptId, "confirmed", "PC_TEST"), "PT409", "A previous attempt cannot finalize the current lease");
  await expectDenial(db, dispatch(requestId, recovery.attemptId), "PT409", "Expired physical counts are readback-only");
  await expectDenial(db, finish(requestId, recovery.attemptId, "confirmed"), "PT409", "Late confirmation requires the exact provider receipt");
  assert.equal((await read(finish(requestId, recovery.attemptId, "confirmed", "PC_TEST"))).status, "confirmed");
  assert.equal((await read(claim())).status, "confirmed");

  const revokedId = randomUUID();
  const revoked = await read(claim(churchEmployeeId, revokedId, "6"));
  await db.exec("reset role");
  await db.query(`
    update public.user_capability_overrides set is_active = false
    where organization_id = $1 and user_id = $2 and capability_key = 'inventory.count.create'
  `, [churchId, churchEmployeeId]);
  await asService();
  await expectDenial(db, dispatch(revokedId, revoked.attemptId), "PT409", "Revoked actor cannot dispatch a previously claimed write");
  assert.equal((await read(finish(revokedId, revoked.attemptId, "rejected"))).status, "rejected");
  await db.exec("reset role");
  await db.query(`
    update public.user_capability_overrides set is_active = true
    where organization_id = $1 and user_id = $2 and capability_key = 'inventory.count.create'
  `, [churchId, churchEmployeeId]);
  await asService();

  const unsentId = randomUUID();
  await read(claim(churchEmployeeId, unsentId, "4"));
  await expire(unsentId, "25 hours");
  const unsent = await read(claim(ownerId, unsentId, "4"));
  assert.equal(unsent.status, "recovery_required");
  assert.equal(unsent.wasDispatched, false);
  assert.equal((await read(finish(unsentId, unsent.attemptId, "rejected"))).status, "rejected");
  await claims(db, churchEmployeeId);
  const [confirmed] = await read(list());
  assert.equal(confirmed.pendingRequestId, null);
  assert.equal(confirmed.lastConfirmedQuantity, "0");
  assert.equal(JSON.stringify(confirmed).includes("PC_TEST"), false);
  process.stdout.write("PASS Church Street Square count authorization, isolation, replay and expired recovery\n");
}

async function verifyChurchSquareWebhookProjection(db, locationId) {
  const read = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
  const list = () => read("select public.list_church_square_stock_alerts($1::uuid) as result", [locationId]);
  const acknowledgment = (id, episode, location = locationId) =>
    `select public.acknowledge_church_square_stock_alert('${location}','${id}','${episode}') as result`;
  const record = (id, quantity, instant, merchant = "M_TEST", variation = "V_TEST") => read(`
    select public.service_record_church_square_webhook(
      $1, 'L_TEST', $2, 'inventory.count.updated', $3::timestamptz,
      'inventory-event-object', $4::jsonb
    ) as result
  `, [merchant, id, instant, JSON.stringify([{ variationId: variation, quantity, calculatedAt: instant }])]);
  const assertRestricted = () => read(`
    select has_function_privilege(
      current_user,
      'public.service_record_church_square_webhook(text,text,text,text,timestamptz,text,jsonb,text)',
      'execute'
    ) as result
  `);
  const times = Array.from({ length: 7 }, (_, index) => `2026-11-14T12:00:0${index}.0000002Z`);

  await claims(db, undefined, "service_role");
  assert.equal(await record("square-event-1", "100", times[0]), true);
  assert.equal(await record("square-event-2", "5.00000", times[1]), true);
  await claims(db, churchEmployeeId);
  assert.equal(await assertRestricted(), false);
  const [initial] = await list();
  assert.equal(initial.quantity, "5");
  assert.equal(initial.label, "Fixture Sandwich");
  assert.equal(initial.acknowledgedAt, null);
  assert.equal(initial.acknowledgedByName, null);
  assert.equal(JSON.stringify(initial).includes("V_TEST"), false);
  assert.match(initial.episode, /^[a-f0-9-]{36}$/);
  const revision = () => read("select revision::int as result from public.church_square_stock_invalidation_signals where location_id = $1::uuid", [locationId]);
  assert.equal(await revision(), 1);

  await claims(db, undefined, "service_role");
  assert.equal(await record("square-event-2", "1", times[2]), false);
  assert.equal(await record("square-event-stale", "9", times[0]), true);
  assert.equal(await record("square-event-unmapped", "1", times[2], "M_TEST", "UNMAPPED"), true);
  await claims(db, churchEmployeeId);
  assert.deepEqual(await list(), [initial]);
  assert.equal(await revision(), 1);
  await expectDenial(db, acknowledgment(initial.id, randomUUID()), "PT409", "Current episode must match");
  await expectDenial(db, acknowledgment(initial.id, initial.episode, restaurantLocationId), "42501", "Acknowledgment is Church Street only");
  assert.equal(await revision(), 1);
  const acknowledged = await read(acknowledgment(initial.id, initial.episode));
  assert.ok(Number.isFinite(Date.parse(acknowledged.acknowledgedAt)));
  assert.ok(acknowledged.acknowledgedByName.length > 0);
  assert.deepEqual(Object.keys(acknowledged).sort(), ["acknowledgedAt", "acknowledgedByName"]);
  assert.deepEqual(await list(), [{ ...initial, ...acknowledged }]);
  assert.equal(await revision(), 2);
  await claims(db, ownerId);
  assert.deepEqual(await list(), [{ ...initial, ...acknowledged }], "A second operator sees the first actor's receipt");
  assert.deepEqual(await read(acknowledgment(initial.id, initial.episode)), acknowledged, "First action persists across operators");
  assert.equal(await revision(), 2, "Replay does not fire another refresh");

  await db.exec("reset role");
  const prepProfile = await db.query("select preferred_name from public.profiles where id = $1", [churchEmployeeId]);
  assert.equal(prepProfile.rows.length, 1);
  await db.query("update public.profiles set preferred_name = 'Renamed rehearsal prep actor' where id = $1", [churchEmployeeId]);
  await claims(db, ownerId);
  assert.notEqual(acknowledged.acknowledgedByName, "Renamed rehearsal prep actor");
  assert.deepEqual(await list(), [{ ...initial, ...acknowledged }], "Renaming a user preserves the original receipt");

  await claims(db, undefined, "service_role");
  assert.equal(await record("square-event-3", "4", times[3]), true);
  await claims(db, churchEmployeeId);
  const [stillLow] = await list();
  assert.equal(stillLow.quantity, "4");
  assert.equal(stillLow.episode, initial.episode);
  assert.equal(stillLow.acknowledgedAt, acknowledged.acknowledgedAt);
  assert.equal(await revision(), 3);

  await claims(db, undefined, "service_role");
  assert.equal(await record("square-event-4", "100", times[4]), true);
  await claims(db, churchEmployeeId);
  assert.deepEqual(await list(), []);
  await expectDenial(db, acknowledgment(initial.id, initial.episode), "PT409", "Closed episodes reject a retry");
  assert.equal(await revision(), 4);
  await claims(db, undefined, "service_role");
  assert.equal(await record("square-event-5", "5", times[5]), true);
  await claims(db, churchEmployeeId);
  const [again] = await list();
  assert.equal(again.quantity, "5");
  assert.notEqual(again.episode, initial.episode);
  assert.equal(again.acknowledgedAt, null);
  assert.equal(again.acknowledgedByName, null);
  await expectDenial(db, acknowledgment(again.id, initial.episode), "PT409", "Stale action cannot acknowledge a new episode");
  assert.equal(await revision(), 5);
  await expectDenial(db, `select public.list_church_square_webhook_receipts('${locationId}')`, "42501",
    "Resource receipt history requires Church Street management");
  await claims(db, ownerId);
  const recent = await read("select public.list_church_square_webhook_receipts($1::uuid) as result", [locationId]);
  assert.equal(recent.length, 7);
  assert.deepEqual(Object.keys(recent[0]).sort(), ["createdAt", "receivedAt", "type"]);
  const acknowledgedAgain = await read(acknowledgment(again.id, again.episode));
  assert.ok(Number.isFinite(Date.parse(acknowledgedAgain.acknowledgedAt)));
  assert.notEqual(acknowledgedAgain.acknowledgedByName, acknowledged.acknowledgedByName);
  assert.equal(await revision(), 6);
  await claims(db, churchEmployeeId);
  assert.deepEqual(await list(), [{ ...again, ...acknowledgedAgain }]);
  assert.deepEqual(await read(acknowledgment(again.id, again.episode)), acknowledgedAgain, "The other actor can acknowledge first on a new episode");
  assert.equal(await revision(), 6, "A second acknowledgment leaves the first actor and revision intact");

  await claims(db, restaurantEmployeeId);
  assert.equal(await revision(), undefined);
  await expectDenial(db, `select public.list_church_square_stock_alerts('${locationId}')`, "42501",
    "Other tenants cannot read the Church Street alert queue");
  await expectDenial(db, acknowledgment(again.id, again.episode), "42501", "Other tenants cannot acknowledge Church Street alerts");
  await claims(db, undefined, "service_role");
  assert.equal(await record("square-event-6", "100", times[6]), true);
  await claims(db, ownerId);
  assert.deepEqual(await list(), []);
  await claims(db, churchEmployeeId);
  assert.deepEqual(await list(), []);
  await expectDenial(db, acknowledgment(again.id, again.episode), "PT409", "The second restock closes the second episode");

  await db.exec("reset role");
  await db.query("update public.profiles set preferred_name = $2 where id = $1", [churchEmployeeId, prepProfile.rows[0].preferred_name]);
  const audit = await db.query(
    "select acknowledged_by::text, episode_id::text, acknowledged_by_name from private.church_square_stock_acknowledgments where item_id = $1 order by acknowledged_by",
    [initial.id],
  );
  assert.deepEqual(audit.rows, [
    { acknowledged_by: ownerId, episode_id: again.episode, acknowledged_by_name: acknowledgedAgain.acknowledgedByName },
    { acknowledged_by: churchEmployeeId, episode_id: initial.episode, acknowledged_by_name: acknowledged.acknowledgedByName },
  ]);
  await expectDenial(db, `update private.church_square_stock_acknowledgments set acknowledged_by_name = 'Changed' where item_id = '${initial.id}'`,
    "42501", "Acknowledgment audit is append-only");
  process.stdout.write("PASS Church Street webhook replay, stale exclusion, low-stock alert rearming, and two-operator acknowledgment\n");
}

async function verifyChurchSquareStockRecovery(db, locationId) {
  const read = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
  const list = () => read("select public.list_church_square_stock_alerts($1::uuid) as result", [locationId]);
  const mappings = (merchant = "M_TEST", squareLocation = "L_TEST") => read(
    "select public.service_list_church_square_stock_mappings($1,$2) as result", [merchant, squareLocation],
  );
  const reconcile = (observations, merchant = "M_TEST", squareLocation = "L_TEST") => read(
    "select public.service_reconcile_church_square_stock($1,$2,$3::jsonb) as result", [merchant, squareLocation, JSON.stringify(observations)],
  );
  const countRows = () => read(`
    select jsonb_build_array((select count(*) from private.church_square_webhook_receipts),
      (select count(*) from private.church_square_count_requests)) as result
  `);
  const asService = () => claims(db, undefined, "service_role");
  const observation = (quantity, second, variationId = "V_TEST") => ({ variationId, quantity, calculatedAt: `2026-11-14T12:00:${second}Z` });

  await db.exec("reset role");
  const before = await countRows();
  await asService();
  assert.deepEqual(await reconcile([observation("0", "10")]), { applied: 1, ignored: 0 });
  await claims(db, churchEmployeeId);
  const [initial] = await list();
  assert.equal(initial.quantity, "0");
  assert.equal(await read(`select has_function_privilege(current_user,
    'public.service_reconcile_church_square_stock(text,text,jsonb)','EXECUTE') as result`), false);
  assert.equal(await read(`select has_function_privilege(current_user,
    'public.service_list_church_square_stock_mappings(text,text)','EXECUTE') as result`), false);
  await read(`select public.acknowledge_church_square_stock_alert($1::uuid,$2::uuid,$3::uuid) as result`,
    [locationId, initial.id, initial.episode]);

  await asService();
  assert.deepEqual(await mappings(), ["V_TEST"]);
  await assert.rejects(mappings("OTHER"), { code: "42501" });
  await assert.rejects(reconcile([], "M_TEST", "OTHER"), { code: "42501" });
  assert.deepEqual(await reconcile([]), { applied: 0, ignored: 0 });
  assert.deepEqual(await reconcile([observation("100", "01")]), { applied: 0, ignored: 1 });
  await assert.rejects(reconcile([observation("100", "20"), observation("0", "20")]), { code: "22023" });
  await assert.rejects(reconcile([observation("100", "20"), observation("100", "20", "OTHER")]), { code: "PT409" });
  await assert.rejects(reconcile([42]), { code: "22023" });
  await assert.rejects(reconcile([{ ...observation("100", "20"), calculatedAt: "infinity" }]), { code: "22023" });
  await assert.rejects(reconcile([{ ...observation("100", "20"), calculatedAt: "2026-02-30T00:00:00Z" }]), { code: "22023" });
  await assert.rejects(reconcile([observation("100", "20"), { ...observation("100", "21", "DIFFERENT"), extra: "junk" }]), { code: "22023" });
  await claims(db, churchEmployeeId);
  const [afterInvalid] = await list();
  assert.equal(afterInvalid.episode, initial.episode);
  assert.ok(afterInvalid.acknowledgedAt);
  await asService();
  assert.deepEqual(await reconcile([observation("-0.12500", "20")]), { applied: 1, ignored: 0 });
  await claims(db, churchEmployeeId);
  const [stillLow] = await list();
  assert.equal(stillLow.quantity, "-0.125");
  assert.equal(stillLow.episode, initial.episode);
  assert.equal(stillLow.acknowledgedAt, afterInvalid.acknowledgedAt);

  await asService();
  assert.deepEqual(await reconcile([observation("100", "21")]), { applied: 1, ignored: 0 });
  assert.deepEqual(await reconcile([observation("1", "21")]), { applied: 0, ignored: 1 });
  await claims(db, churchEmployeeId);
  assert.deepEqual(await list(), []);
  await asService();
  assert.deepEqual(await reconcile([observation("0", "22")]), { applied: 1, ignored: 0 });
  await claims(db, churchEmployeeId);
  const [rearmed] = await list();
  assert.equal(rearmed.quantity, "0");
  assert.notEqual(rearmed.episode, initial.episode);
  assert.equal(rearmed.acknowledgedAt, null);

  await db.exec("reset role");
  assert.deepEqual(await countRows(), before, "Snapshot does not create webhook or physical-count receipts");
  await asService();
  assert.equal(await read(`select public.service_record_church_square_webhook('M_TEST','L_TEST','stock-recovery-race-webhook',
    'inventory.count.updated','2026-11-14T12:00:24Z','inventory-event-object',$1::jsonb) as result`,
  [JSON.stringify([observation("110", "24")])]), true);
  assert.deepEqual(await reconcile([observation("1", "23")]), { applied: 0, ignored: 1 });
  await db.exec("reset role");
  const latest = await read("select trim_scale(quantity)::text as result from private.church_square_stock_state where item_id=$1", [initial.id]);
  assert.equal(latest, "110", "Newer webhook wins the recovery race");
  process.stdout.write("PASS Church Street mapped stock recovery, scope, monotonic ordering, revision safety, and independent receipt counts\n");
}

async function verifyChurchSquareReceiptProcessing(db, locationId) {
  const read = async (sql, args = []) => (await db.query(sql, args)).rows[0]?.result;
  const list = () => read("select public.list_church_square_reconciliation($1::uuid) as result", [locationId]);
  const add = (event, type, resource) => read(`
    select public.service_record_church_square_webhook(
      'M_TEST', 'L_TEST', $1, $2, now(), $3, '[]'::jsonb
    ) as result`, [event, type, resource]);
  const claim = () => read("select public.service_claim_church_square_receipts('M_TEST','L_TEST') as result");
  const complete = ({ eventId, lease }, facts, failure = null) => read(`
    select public.service_complete_church_square_receipt('M_TEST','L_TEST',$1,$2::uuid,$3::jsonb,$4) as result
  `, [eventId, lease, facts ? JSON.stringify(facts) : null, failure]);

  await claims(db, undefined, "service_role");
  await add("invoice-newer", "invoice.payment_made", "invoice:1");
  await add("invoice-earlier", "invoice.updated", "invoice:1");
  await add("refund-temp", "refund.created", "refund:1");
  await add("order-needs-review", "order.updated", "order:1");
  const jobs = await claim();
  assert.equal(jobs.length, 4, "Only non-inventory receipts are leased");
  assert.deepEqual(await claim(), [], "A second worker cannot take active leases");
  const job = (eventId) => jobs.find((candidate) => candidate.eventId === eventId);
  const facts = {
    kind: "invoice", id: "invoice:1", locationId: "L_TEST", currency: "USD", version: 2,
    updatedAt: new Date().toISOString(), status: "PARTIALLY_PAID", orderId: "order:catering",
    deposit: { state: "satisfied", dueCents: 5000, completedCents: 5000 },
  };
  assert.equal(await complete({ ...job("invoice-newer"), lease: randomUUID() }, facts), false);
  assert.equal(await complete(job("invoice-newer"), facts), true);
  assert.equal(await complete(job("invoice-earlier"), { ...facts, version: 1, status: "UNPAID" }), true);
  assert.equal(await complete(job("refund-temp"), null, "square_unavailable"), true);
  assert.equal(await complete(job("order-needs-review"), null, "scope_mismatch"), true);
  assert.deepEqual(await claim(), [], "Transient failures back off; scope mismatches require review");
  await claims(db, ownerId);
  const summary = await list();
  assert.equal(summary.pending, 1);
  assert.equal(summary.needsReview, 1);
  assert.equal(summary.resources.length, 1);
  assert.equal(summary.resources[0].status, "PARTIALLY_PAID", "An older invoice version cannot overwrite a paid deposit");
  assert.equal(summary.resources[0].depositCompletedCents, 5000);
  await claims(db, churchEmployeeId);
  await expectDenial(db, `select public.list_church_square_reconciliation('${locationId}')`, "42501",
    "Kitchen count permission does not confer Square reconciliation access");
  await claims(db, restaurantEmployeeId);
  await expectDenial(db, `select public.list_church_square_reconciliation('${locationId}')`, "42501",
    "The other tenant cannot read Church Street financial records");
  process.stdout.write("PASS Church Street receipts claim, retry, version order, and reconciliation permissions\n");
}

export async function verifyChurchStreetTenant(db) {
  const roster = [
    { user_id: ownerId, role: "owner" },
    { user_id: churchEmployeeId, role: "employee", job_code: "PREP" },
  ];
  const provision = (members = roster) => `select public.service_provision_church_street('${JSON.stringify(members)}') as result`;
  const get = async (sql) => (await db.query(sql)).rows[0];
  // The verifier owns a disposable database and runs each request in its own
  // transaction, matching Supabase's RPC connection behavior.
  await db.exec("reset role; select set_config('request.jwt.claims', '{}', false);");
  try {
    await db.exec(`
      insert into auth.users(id, email, email_confirmed_at, raw_user_meta_data)
      values ('${churchEmployeeId}', 'church.staff@example.invalid', now(), '{"display_name":"Church Staff"}');
    `);

    assert.deepEqual(await get(`
      select
        has_function_privilege('authenticated', 'public.service_provision_church_street(jsonb)', 'EXECUTE') as staff_provision,
        has_function_privilege('anon', 'public.service_provision_church_street(jsonb)', 'EXECUTE') as anonymous_provision,
        has_function_privilege('service_role', 'public.service_provision_church_street(jsonb)', 'EXECUTE') as service_provision,
        has_function_privilege('authenticated', 'public.service_set_church_street_active(uuid, boolean)', 'EXECUTE') as staff_activate,
        has_function_privilege('service_role', 'public.service_set_church_street_active(uuid, boolean)', 'EXECUTE') as service_activate
    `), { staff_provision: false, anonymous_provision: false, service_provision: true, staff_activate: false, service_activate: true });
    await claims(db, undefined, "service_role");
    await expectDenial(db, provision([{ ...roster[0], user_id: "10000000-0000-4000-8000-000000000012" }]), "22023",
      "unknown owner account rejects provisioning atomically");
    const { result: created } = await get(provision());
    assert.equal(created.created, true);
    const churchId = created.organization_id;
    const churchLocationId = created.location_id;
    assert.notEqual(churchId, restaurantId);
    assert.notEqual(churchLocationId, restaurantLocationId);

    const { result: retry } = await get(provision([...roster].reverse()));
    assert.deepEqual(retry, { ...created, created: false });
    await expectDenial(db, provision([roster[0]]), "23505", "a retry cannot change the reviewed roster");
    await expectDenial(db, `select public.service_set_church_street_active('${restaurantId}', false)`, "22023",
      "lifecycle action cannot target the restaurant");

    await db.exec("reset role");
    const initial = await get(`
      select organization.status, location.is_active, settings.feature_flags,
        (select count(*)::int from public.organization_memberships where organization_id = organization.id) as members,
        (select count(*)::int from public.job_roles where organization_id = organization.id) as jobs,
        (select count(*)::int from public.chat_channels where organization_id = organization.id) as channels,
        (select count(*)::int from public.user_invitations where organization_id = organization.id) as invitations,
        (select count(*)::int from public.reservation_settings where organization_id = organization.id) as reservations,
        (select count(*)::int from public.integration_connections where organization_id = organization.id) as connections
      from public.organizations organization
      join public.organization_settings settings on settings.organization_id = organization.id
      join public.locations location on location.id = settings.default_location_id
      where organization.id = '${churchId}'
    `);
    assert.deepEqual(initial, {
      status: "suspended", is_active: false, feature_flags: { service_model: "counter" },
      members: 2, jobs: 4, channels: 2, invitations: 0, reservations: 0, connections: 0,
    });
    await claims(db, ownerId);
    assert.deepEqual(await get(`
      select public.can_access_org('${churchId}') as church,
        public.can_access_org('${restaurantId}') as restaurant
    `), { church: false, restaurant: true });

    await claims(db, undefined, "service_role");
    const activation = `select public.service_set_church_street_active('${churchId}', true) as result`;
    assert.equal((await get(activation)).result.status, "active");
    assert.equal((await get(activation)).result.status, "active");
    await claims(db, ownerId);
    assert.deepEqual(await get(`
      select public.can_access_org('${churchId}') as church,
        public.can_access_org('${restaurantId}') as restaurant,
        public.has_capability('${churchId}', '${churchLocationId}', 'prep.manage') as church_prep,
        public.has_capability('${churchId}', '${churchLocationId}', 'reservations.configure') as church_reservations,
        public.has_capability('${churchId}', '${churchLocationId}', 'guest.manage') as church_guests,
        public.has_capability('${churchId}', '${churchLocationId}', 'tip.calculate') as church_tips,
        public.has_capability('${churchId}', '${churchLocationId}', 'integrations.manage') as church_integrations,
        public.has_capability('${restaurantId}', '${restaurantLocationId}', 'reservations.configure') as restaurant_reservations
    `), {
      church: true, restaurant: true, church_prep: true, church_reservations: false,
      church_guests: false, church_tips: false, church_integrations: false, restaurant_reservations: true,
    });
    await expectDenial(db, `
      update public.organization_settings set feature_flags = '{}' where organization_id = '${churchId}'
    `, "42501", "workspace owner cannot erase the service model");
    await expectDenial(db, `
      update public.organizations set status = 'suspended' where id = '${churchId}'
    `, "42501", "workspace owner cannot bypass audited activation command");
    await expectDenial(db, `
      update public.locations set code = 'ANOTHER' where id = '${churchLocationId}'
    `, "42501", "workspace owner cannot change the provisioned location key");
    const { accessible_rows: activeCounterSettings } = await get(`
      select count(*)::int as accessible_rows from public.reservation_settings where organization_id = '${churchId}'
    `);
    assert.equal(activeCounterSettings, 0);
    await expectDenial(db, `
      select public.configure_reservation_location(gen_random_uuid(), '${churchLocationId}', 'settings.save', '{}')
    `, "42501", "reservation RPC respects the service model for owners");
    await expectDenial(db, `
      insert into public.reservation_settings (organization_id, location_id)
      values ('${churchId}', '${churchLocationId}')
    `, "42501", "authenticated reservation table writes respect the service model");
    const task = await get(`
      select (public.create_task(gen_random_uuid(), '${churchLocationId}', 'Open counter', 'Prepare the counter', 'normal')).organization_id as organization_id
    `);
    assert.equal(task.organization_id, churchId);

    await db.exec("reset role");
    await expectDenial(db, `
      insert into public.booking_api_clients (organization_id, location_id)
      values ('${churchId}', '${churchLocationId}')
    `, "42501", "the privileged booking writer cannot add Church Street");
    await expectDenial(db, `
      insert into public.reservation_message_outbox (organization_id, location_id)
      values ('${churchId}', '${churchLocationId}')
    `, "42501", "the privileged worker cannot queue Church Street reservation messages");

    await claims(db, restaurantEmployeeId);
    assert.deepEqual(await get(`
      select public.can_access_location('${churchId}', '${churchLocationId}') as church,
        public.can_access_location('${restaurantId}', '${restaurantLocationId}') as restaurant
    `), { church: false, restaurant: true });
    await claims(db, churchEmployeeId);
    assert.deepEqual(await get(`
      select public.can_access_location('${churchId}', '${churchLocationId}') as church,
        public.can_access_location('${restaurantId}', '${restaurantLocationId}') as restaurant,
        public.has_capability('${churchId}', '${churchLocationId}', 'prep.complete') as prep,
        public.has_capability('${churchId}', '${churchLocationId}', 'prep.manage') as manages_prep
    `), { church: true, restaurant: false, prep: true, manages_prep: false });

    await verifyChurchSquareCountLedger(db, churchId, churchLocationId);
    await verifyChurchSquareWebhookProjection(db, churchLocationId);
    await verifyChurchSquareReceiptProcessing(db, churchLocationId);
    await verifyChurchSquareStockRecovery(db, churchLocationId);

    await claims(db, undefined, "service_role");
    assert.equal((await get(`select public.service_set_church_street_active('${churchId}', false) as result`)).result.status, "suspended");
    await claims(db, ownerId);
    assert.deepEqual(await get(`
      select public.can_access_org('${churchId}') as church,
        public.can_access_org('${restaurantId}') as restaurant,
        (select count(*)::int from public.tasks where organization_id = '${churchId}') as church_tasks
    `), { church: false, restaurant: true, church_tasks: 0 });
    await db.exec("reset role");
    assert.deepEqual(await get(`
      select
        (select count(*)::int from public.tasks where organization_id = '${churchId}') as retained_tasks,
        (select count(*)::int from public.audit_events where organization_id = '${churchId}' and action = 'church_street.status') as status_events
    `), { retained_tasks: 1, status_events: 2 });
  } finally {
    await db.exec("reset role; select set_config('request.jwt.claims', '{}', false);").catch(() => {});
  }
  process.stdout.write("PASS Church Street provisioning, tenant and role isolation, module guards, and lifecycle\n");
}
