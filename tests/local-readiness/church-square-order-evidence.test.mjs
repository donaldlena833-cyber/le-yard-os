import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { it } from "vitest";
import { bootstrap } from "../../scripts/lib/pglite-platform-bootstrap.mjs";

const owner = "10000000-0000-4000-8000-000000000001";
const manager = "10000000-0000-4000-8000-000000000004";
const prep = "10000000-0000-4000-8000-000000000005";
const other = "10000000-0000-4000-8000-000000000006";
const otherLocation = "30000000-0000-4000-8000-000000000001";
const orderId = "cafe-order-1234567890";
const savedTime = "2026-11-14T15:00:00.123456Z";
const sameTimeInNewYork = "2026-11-14T10:00:00.123456-05:00";
const laterTime = "2026-11-14T15:00:00.123457Z";

async function assumeRole(db, role, sub) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub, role, aal: "aal1" })]);
  if (role === "authenticated") await db.exec("set role authenticated");
  if (role === "anon") await db.exec("set role anon");
  if (role === "service_role") await db.exec("set role service_role");
}

async function verifyOrderEvidence(db) {
  const migrations = new URL("../../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, migrations), "utf8"));
  }
  await db.exec(await readFile(new URL("../../supabase/seed.sql", import.meta.url), "utf8"));
  await assumeRole(db, "service_role");
  const provision = await db.query("select public.service_provision_church_street($1::jsonb) as result", [JSON.stringify([
    { user_id: owner, role: "owner" }, { user_id: manager, role: "manager" }, { user_id: prep, role: "employee", job_code: "PREP" },
  ])]);
  const { organization_id: organization, location_id: location } = provision.rows[0].result;
  await db.query("select public.service_set_church_street_active($1::uuid, true)", [organization]);

  await db.exec("reset role");
  const seed = ({ merchant = "M_TEST", squareLocation = "L_TEST", kind = "order", id = orderId, updatedAt = savedTime, version = 8 } = {}) =>
    db.query(`
      insert into private.church_square_resource_state (
        merchant_id,square_location_id,organization_id,location_id,resource_kind,resource_id,source_updated_at,source_version,facts
      ) values ($1,$2,$3,$4,$5,$6,$7::timestamptz,$8::bigint,$9::jsonb)
    `, [merchant, squareLocation, organization, location, kind, id, updatedAt, version,
      JSON.stringify({ status: "COMPLETED", customer: "PRIVATE-CUSTOMER", totalCents: 98765 })]);
  const evidence = async ({
    workspaceLocation = location, merchant = "M_TEST", squareLocation = "L_TEST", id = orderId, updatedAt = savedTime, version = 8,
  } = {}) => (await db.query(`
    select public.get_church_square_order_evidence($1::uuid,$2::text,$3::text,$4::text,$5::timestamptz,$6::bigint) as result
  `, [workspaceLocation, merchant, squareLocation, id, updatedAt, version])).rows[0].result;

  await seed({ id: "different-order-1234567890" });
  await seed({ merchant: "M_OTHER" });
  await seed({ squareLocation: "L_OTHER" });
  await seed({ kind: "payment" });
  await assumeRole(db, "authenticated", owner);
  assert.equal(await evidence(), null);
  await db.exec("reset role");
  await seed();
  await seed({ id: "order-without-provider-version", version: null });

  await assumeRole(db, "authenticated", owner);
  const observed = await evidence({ updatedAt: sameTimeInNewYork });
  assert.deepEqual(Object.keys(observed).sort(), ["matches", "recoveredAt", "savedAt", "source", "updatedAt"]);
  assert.equal(observed.matches, true);
  assert.equal(observed.recoveredAt, null);
  assert.equal(observed.source, null);
  assert.equal(observed.savedAt, null);
  assert.equal(Date.parse(observed.updatedAt), Date.parse(savedTime));
  assert.equal((await evidence({ updatedAt: laterTime })).matches, false);
  assert.equal((await evidence({ version: 9 })).matches, false);
  assert.equal((await evidence({ version: null })).matches, false);
  assert.equal((await evidence({ id: "order-without-provider-version", version: null })).matches, true);
  assert.equal((await evidence({ id: "order-without-provider-version" })).matches, false);
  assert.equal(await evidence({ merchant: "M_ABSENT" }), null);
  assert.equal(await evidence({ squareLocation: "L_ABSENT" }), null);
  assert.equal(await evidence({ id: "1234567890" }), null);
  await assert.rejects(evidence({ updatedAt: "infinity" }), { code: "22023" });
  await assert.rejects(evidence({ workspaceLocation: otherLocation }), { code: "42501" });
  await assert.rejects(db.exec("select * from private.church_square_resource_state"), { code: "42501" });

  await assumeRole(db, "authenticated", manager);
  await assert.rejects(evidence(), { code: "42501" });
  await db.exec("reset role");
  for (const user of [manager, prep]) {
    await db.query(`
      insert into public.user_capability_overrides (
        organization_id,user_id,capability_key,location_id,effect,reason,created_by,updated_by,effective_from
      ) values ($1,$2,'reports.financial.view',$3,'grant','Order evidence test',$4,$4,current_date - 1)
    `, [organization, user, location, owner]);
  }
  await assumeRole(db, "authenticated", manager);
  assert.deepEqual(await evidence(), observed);

  for (const [role, user] of [
    ["authenticated", prep], ["authenticated", other], ["authenticated", undefined], ["anon", undefined], ["service_role", undefined],
  ]) {
    await assumeRole(db, role, user);
    await assert.rejects(evidence(), { code: "42501" });
  }

  await verifyExactOrderRecovery(db, { organization, location, evidence });
  await verifyReceiptProvenance(db, { organization, location, evidence });
}

async function verifyExactOrderRecovery(db, { organization, location, evidence }) {
  const id = "recovery-order-0987654321";
  const scanStartedAt = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const updatedAt = new Date(Date.now() - 72 * 60 * 60 * 1000).toISOString();
  const updatedLater = updatedAt; // Square advanced the version within the same timestamp.
  const facts = {
    kind: "order", id, locationId: "L_TEST", currency: "USD", status: "COMPLETED",
    createdAt: updatedAt, updatedAt, version: 1, sourceHint: "UNKNOWN",
    totalCents: 100, fulfillments: [], lineItems: [], tenders: [], refundIds: [],
  };
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0].result;
  const recover = ({
    actor = owner, workspaceLocation = location, merchant = "M_TEST", squareLocation = "L_TEST",
    requestedId = id, orderFacts = facts,
  } = {}) => one(`
    select public.service_recover_church_square_order($1::uuid,$2::uuid,$3::text,$4::text,$5::text,$6::jsonb) as result
  `, [actor, workspaceLocation, merchant, squareLocation, requestedId, JSON.stringify(orderFacts)]);
  const reconcile = () => one("select public.list_church_square_reconciliation($1::uuid) as result", [location]);
  const sameSuffix = (snapshot) => snapshot.resources.filter(({ reference }) => reference === id.slice(-10));

  await assert.rejects(recover(), { code: "42501" }); // Provider scope is not configured.
  await db.exec("reset role");
  await db.query(`
    insert into private.church_square_order_backfill (
      organization_id,location_id,merchant_id,square_location_id,scan_started_at,covered_through
    ) values ($1,$2,'M_TEST','L_TEST',$3::timestamptz,$3::timestamptz)
  `, [organization, location, scanStartedAt]);
  for (const [kind, resourceId, amount] of [
    ["order", "other-order-0987654321", 200],
    ["payment", id, 300],
    ["refund", id, 400],
    ["invoice", id, 500],
  ]) {
    const projection = { kind, status: "COMPLETED", amountCents: amount, orderId: id, privateFixture: "PRIVATE-CUSTOMER" };
    await db.query(`
      insert into private.church_square_resource_state (
        merchant_id,square_location_id,organization_id,location_id,resource_kind,resource_id,source_updated_at,source_version,facts
      ) values ('M_TEST','L_TEST',$1,$2,$3,$4,$5::timestamptz,1,$6::jsonb)
    `, [organization, location, kind, resourceId, updatedAt, JSON.stringify(projection)]);
  }

  for (const [role, user] of [["authenticated", owner], ["authenticated", manager], ["anon", undefined]]) {
    await assumeRole(db, role, user);
    await assert.rejects(recover(), { code: "42501" });
  }
  await assumeRole(db, "service_role");
  for (const actor of [other, prep, null]) await assert.rejects(recover({ actor }), { code: "42501" });
  await assert.rejects(recover({ workspaceLocation: otherLocation }), { code: "42501" });
  await assert.rejects(recover({ merchant: "M_OTHER" }), { code: "42501" });
  await assert.rejects(recover({ squareLocation: "L_OTHER", orderFacts: { ...facts, locationId: "L_OTHER" } }), { code: "42501" });
  await assert.rejects(recover({ requestedId: "different-order-0987654321" }), { code: "22023" });
  for (const orderFacts of [
    { ...facts, kind: "payment" }, { ...facts, locationId: "L_OTHER" }, { ...facts, currency: "EUR" },
    { ...facts, createdAt: "infinity" }, { ...facts, updatedAt: "infinity" }, { ...facts, version: -1 },
  ]) {
    await assert.rejects(recover({ orderFacts }), { code: "22023" });
  }

  await db.exec("reset role");
  await db.query(`
    insert into public.user_capability_overrides (
      organization_id,user_id,capability_key,location_id,effect,reason,created_by,updated_by,effective_from
    ) values ($1,$2,'manager_log.manage',$3,'deny','Recovery capability test',$4,$4,current_date - 1)
  `, [organization, manager, location, owner]);
  await assumeRole(db, "service_role");
  await assert.rejects(recover({ actor: manager }), { code: "42501" });
  await db.exec("reset role");
  await db.query(`
    update public.user_capability_overrides set effect = 'grant'
    where user_id = $1 and location_id = $2 and capability_key = 'manager_log.manage'
  `, [manager, location]);

  await assumeRole(db, "authenticated", manager);
  assert.equal(await evidence({ id, version: 1, updatedAt }), null);
  await assumeRole(db, "service_role");
  assert.equal(await recover({ actor: manager }), true);
  assert.equal(await recover({ actor: manager }), false);
  await assumeRole(db, "authenticated", manager);
  const recovered = await evidence({ id, version: 1, updatedAt });
  assert.deepEqual(Object.keys(recovered).sort(), ["matches", "recoveredAt", "savedAt", "source", "updatedAt"]);
  assert.equal(recovered.matches, true);
  assert(Number.isFinite(Date.parse(recovered.recoveredAt)));
  assert.equal(recovered.source, "manual");
  assert(Date.parse(recovered.savedAt) <= Date.parse(recovered.recoveredAt));
  await assert.rejects(db.exec("select * from private.church_square_order_recoveries"), { code: "42501" });
  const wrongVersion = await evidence({ id, version: 0, updatedAt });
  assert.equal(wrongVersion.matches, false);
  const reconciled = await reconcile();
  assert.deepEqual(sameSuffix(reconciled).map(({ kind, amountCents, recoveredAt }) => [kind, amountCents, recoveredAt])
    .sort((left, right) => left[1] - right[1]), [
    ["order", 100, recovered.recoveredAt], ["order", 200, null],
    ["payment", 300, null], ["refund", 400, null], ["invoice", 500, null],
  ]);
  assert(!JSON.stringify(reconciled).includes(id));
  assert(!JSON.stringify(reconciled).includes("PRIVATE-CUSTOMER"));

  await assumeRole(db, "service_role");
  assert.equal(await recover({ orderFacts: { ...facts, version: 0 } }), false);
  const laterFacts = { ...facts, updatedAt: updatedLater, version: 2 };
  assert.equal(await one(`
    select public.service_record_church_square_webhook('M_TEST','L_TEST','recovery-test-update','order.updated',
      $1::timestamptz,$2::text,'[]'::jsonb) as result
  `, [updatedLater, id]), true);
  const claims = await one("select public.service_claim_church_square_receipts('M_TEST','L_TEST') as result");
  const claim = claims.find((receipt) => receipt.eventId === "recovery-test-update");
  assert(claim);
  assert.equal(await one(`
    select public.service_complete_church_square_receipt('M_TEST','L_TEST','recovery-test-update',$1::uuid,$2::jsonb) as result
  `, [claim.lease, JSON.stringify(laterFacts)]), true);
  assert.equal(await recover({ actor: manager }), false);

  await assumeRole(db, "authenticated", owner);
  const synced = await evidence({ id, version: 2, updatedAt: updatedLater });
  assert.equal(synced.matches, true);
  assert.equal(synced.recoveredAt, null);
  assert.equal(synced.source, "webhook");
  assert(Date.parse(synced.savedAt) >= Date.parse(recovered.savedAt));
  const afterWebhook = sameSuffix(await reconcile());
  assert.equal(afterWebhook.length, 5);
  assert(afterWebhook.every(({ recoveredAt }) => recoveredAt === null));
  await db.exec("reset role");
  assert.deepEqual(await one(`
    select jsonb_build_object(
      'ledgerRows', (select count(*) from private.church_square_order_recoveries where order_id = $1),
      'recordedActor', (select recovered_by from private.church_square_order_recoveries where order_id = $1),
      'providerReceipts', (select count(*) from private.church_square_webhook_receipts where resource_id = $1),
      'orderStateRows', (select count(*) from private.church_square_resource_state where resource_kind = 'order'
        and resource_id = $1 and merchant_id = 'M_TEST' and square_location_id = 'L_TEST')
    ) as result
  `, [id]), { ledgerRows: 1, recordedActor: manager, providerReceipts: 1, orderStateRows: 1 });
  assert.equal(await one(`
    select (covered_through = $1::timestamptz and scan_started_at = $1::timestamptz) as result
    from private.church_square_order_backfill where location_id = $2
  `, [scanStartedAt, location]), true);
}


async function verifyReceiptProvenance(db, { organization, location, evidence }) {
  const order = "scheduled-first-order-0123456789";
  const sibling = "different-order-0123456789";
  const undatedOrder = "payment-only-order";
  const conflictOrder = "conflicting-payment-order";
  const paymentFallback = "unlinked-in-envelope-payment";
  const paymentConflict = "conflicting-order-payment";
  const scope = ["M_TEST", "L_TEST"];
  const eventCreated = "2026-11-14T12:00:00Z";
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0].result;
  const receiptEvidence = ({ id = order, workspace = location, merchant = scope[0], squareLocation = scope[1] } = {}) => one(
    "select public.get_church_square_order_receipt_evidence($1::uuid,$2,$3,$4) as result",
    [workspace, merchant, squareLocation, id]);
  const record = (eventId, eventType, resourceId, relatedOrder = null) => one(
    "select public.service_record_church_square_webhook($1,$2,$3,$4,$5::timestamptz,$6,'[]'::jsonb,$7) as result",
    [...scope, eventId, eventType, eventCreated, resourceId, relatedOrder]);
  const claims = () => one("select public.service_claim_church_square_receipts($1,$2) as result", scope);
  const complete = (claimed, facts = null, failure = null) => one(
    "select public.service_complete_church_square_receipt($1,$2,$3,$4::uuid,$5::jsonb,$6) as result",
    [...scope, claimed.eventId, claimed.lease, facts === null ? null : JSON.stringify(facts), failure]);

  await assumeRole(db, "authenticated", owner);
  assert.deepEqual(await receiptEvidence(), { order: null, payment: null });
  await assert.rejects(receiptEvidence({ id: "invalid: order" }), { code: "22023" });
  await assert.rejects(receiptEvidence({ workspace: otherLocation }), { code: "42501" });
  await assert.rejects(db.exec("select * from private.church_square_webhook_receipts"), { code: "42501" });

  for (const [role, user] of [
    ["authenticated", prep], ["authenticated", other], ["authenticated", undefined], ["anon", undefined], ["service_role", undefined],
  ]) {
    await assumeRole(db, role, user);
    await assert.rejects(receiptEvidence(), { code: "42501" });
  }

  // A scan first saves one revision. A signed order receipt initially has no saved facts.
  const scan = await one("select public.service_claim_church_square_order_backfill($1,$2) as result", scope);
  assert(scan);
  const updatedAt = new Date((Date.parse(scan.from) + Date.parse(scan.to)) / 2).toISOString();
  const projection = { id: order, kind: "order", locationId: scope[1], updatedAt, createdAt: updatedAt,
    version: 7, currency: "USD", status: "OPEN" };
  assert.equal(await one("select public.service_commit_church_square_order_backfill($1,$2,$3::uuid,$4::jsonb) as result",
    [...scope, scan.lease, JSON.stringify([projection])]), true);
  for (const [eventId, eventType, resourceId, relatedOrder] of [
    ["first-direct-order", "order.created", order], ["later-direct-order", "order.updated", order],
    ["sibling-order", "order.updated", sibling], ["same-id-invoice", "invoice.updated", undatedOrder, order],
    ["first-pay-order", "payment.created", "direct-linked-payment", order],
    ["unlinked-pay-order", "payment.created", paymentFallback],
    ["conflict-pay-order", "payment.updated", paymentConflict, conflictOrder],
  ]) {
    assert.equal(await record(eventId, eventType, resourceId, relatedOrder), true);
  }
  assert.equal(await record("first-direct-order", "order.created", order), false);
  await db.exec("reset role");
  // Use explicit offsets to test earliest receipt ordering, independent of database clock precision.
  await db.query(`
    update private.church_square_webhook_receipts set received_at = statement_timestamp() - case event_id
      when 'first-direct-order' then interval '40 seconds'
      when 'later-direct-order' then interval '20 seconds'
      else interval '10 seconds' end
    where event_id in ('first-direct-order','later-direct-order','first-pay-order')
  `);
  await db.query(`
    insert into private.church_square_webhook_receipts (
      merchant_id,square_location_id,event_id,event_type,resource_id,related_order_id,organization_id,location_id,created_at,received_at
    ) values ('M_TEST','L_OTHER','wrong-scoped-order','order.created',$1,null,$2,$3,$4::timestamptz,statement_timestamp() - interval '1 minute')
  `, [order, organization, location, eventCreated]);

  await assumeRole(db, "authenticated", manager);
  const current = await evidence({ id: order, updatedAt, version: 7 });
  assert.equal(current.source, "scheduled");
  assert(Number.isFinite(Date.parse(current.savedAt)));
  const initial = await receiptEvidence();
  assert.deepEqual(Object.keys(initial.order).sort(), ["eventType", "processedAt", "receivedAt", "squareCreatedAt", "state"]);
  assert.deepEqual(Object.keys(initial.payment).sort(), ["eventType", "processedAt", "receivedAt", "squareCreatedAt", "state"]);
  assert.equal(initial.order.eventType, "order.created");
  assert.equal(initial.order.state, "pending");
  assert.equal(initial.order.processedAt, null);
  assert.equal(new Date(initial.order.squareCreatedAt).toISOString(), new Date(eventCreated).toISOString());
  assert.equal(initial.payment.eventType, "payment.created");
  assert.equal(initial.payment.state, "pending");
  assert.equal((await receiptEvidence({ id: sibling })).order.eventType, "order.updated");
  assert.deepEqual(await receiptEvidence({ id: undatedOrder }), { order: null, payment: null });
  assert.deepEqual(await receiptEvidence({ merchant: "M_OTHER" }), { order: null, payment: null });
  assert.deepEqual(await receiptEvidence({ id: order.slice(-10) }), { order: null, payment: null });

  // A same-revision webhook completion cannot rewrite the scan provenance, but its receipt is verified.
  await db.exec("reset role");
  await db.exec("delete from private.church_square_webhook_receipts where event_id = 'wrong-scoped-order'");
  await assumeRole(db, "service_role");
  const batch = [...await claims(), ...await claims()];
  const claim = (eventId) => {
    const claimed = batch.find((entry) => entry.eventId === eventId);
    assert(claimed, `Expected a lease for ${eventId}`);
    return claimed;
  };
  assert.equal(await complete(claim("first-direct-order"), projection), true);
  assert.equal(await complete(claim("first-pay-order"), null, "invalid_resource"), true);
  const paymentFacts = (id, orderId) => ({
    id, kind: "payment", orderId, locationId: scope[1], currency: "USD",
    createdAt: updatedAt, updatedAt, version: null, status: "COMPLETED",
  });
  assert.equal(await complete(claim("unlinked-pay-order"), paymentFacts(paymentFallback, undatedOrder)), true);
  assert.equal(await complete(claim("conflict-pay-order"), paymentFacts(paymentConflict, sibling)), true);
  assert.equal(await one("select public.service_recover_church_square_order($1::uuid,$2::uuid,$3,$4,$5,$6::jsonb) as result",
    [owner, location, ...scope, order, JSON.stringify(projection)]), false);
  await assumeRole(db, "authenticated", owner);
  assert.deepEqual(await evidence({ id: order, updatedAt, version: 7 }), current);
  const checked = await receiptEvidence();
  assert.equal(checked.order.state, "verified");
  assert.equal(checked.order.receivedAt, initial.order.receivedAt);
  assert(Date.parse(checked.order.processedAt) >= Date.parse(checked.order.receivedAt));
  assert.equal(checked.payment.state, "needs_review");
  assert.equal(checked.payment.processedAt, null);
  const paymentOnly = await receiptEvidence({ id: undatedOrder });
  assert.equal(paymentOnly.order, null);
  assert.equal(paymentOnly.payment.state, "verified");
  assert.equal(await evidence({ id: undatedOrder }), null);
  assert.equal((await receiptEvidence({ id: conflictOrder })).payment, null);
  assert.equal((await receiptEvidence({ id: sibling })).payment, null);
}

it("corroborates and recovers exact Church Street order updates with current authority", async () => {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  try {
    await db.exec(bootstrap);
    await verifyOrderEvidence(db);
  } finally {
    await db.close();
  }
}, 120_000);
