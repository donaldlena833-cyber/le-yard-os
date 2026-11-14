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
const outsider = "10000000-0000-4000-8000-000000000006";
const outsideLocation = "30000000-0000-4000-8000-000000000001";
const orderId = "square-order-first-1234567890";
const siblingOrder = "square-order-second-1234567890";
const caseOrder = "square-order-case-1234567890";
const orderWithoutVersion = "square-order-no-version";
const sameExternalId = "Provider-Original-0000000001";
const sameStoreId = "Provider-Store-0000000002";
const savedTime = "2026-11-14T15:00:00.123456Z";
const sameTimeInNewYork = "2026-11-14T10:00:00.123456-05:00";
const latest = "2026-11-14T15:00:00.123457Z";

async function asRole(db, role, user) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, role, aal: "aal1" })]);
  await db.exec(`set role ${role}`);
}

async function verifyMarketplaceLinks(db) {
  const migrations = new URL("../../supabase/migrations/", import.meta.url);
  for (const filename of (await readdir(migrations)).filter(name => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(filename, migrations), "utf8"));
  }
  await db.exec(await readFile(new URL("../../supabase/seed.sql", import.meta.url), "utf8"));
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0].result;

  await asRole(db, "service_role");
  const { organization_id: organization, location_id: location } = await one(
    "select public.service_provision_church_street($1::jsonb) as result", [JSON.stringify([
      { user_id: owner, role: "owner" }, { user_id: manager, role: "manager" },
      { user_id: prep, role: "employee", job_code: "PREP" },
    ])]);
  await db.query("select public.service_set_church_street_active($1::uuid,true)", [organization]);

  const get = ({ site = location, merchant = "M_TEST", sellerSite = "L_TEST", id = orderId } = {}) =>
    one("select public.get_church_square_marketplace_link($1::uuid,$2,$3,$4) as result", [site, merchant, sellerSite, id]);
  const save = ({
    site = location, merchant = "M_TEST", sellerSite = "L_TEST", id = orderId, actor = owner,
    time = savedTime, version = 1, channel = "DOORDASH", externalStore = sameStoreId,
    externalOrder = sameExternalId, evidence = "merchant_order",
  } = {}) => one(`
    select public.service_save_church_square_marketplace_link($1::uuid,$2,$3,$4,$5::uuid,
      $6::timestamptz,$7::bigint,$8,$9,$10,$11) as result
  `, [site, merchant, sellerSite, id, actor, time, version, channel, externalStore, externalOrder, evidence]);
  const grant = (user, key, effect = "grant") => db.query(`
    insert into public.user_capability_overrides (
      organization_id,user_id,capability_key,location_id,effect,reason,created_by,updated_by,effective_from
    ) values ($1,$2,$3,$4,$5,'Marketplace evidence test',$6,$6,current_date - 1)
  `, [organization, user, key, location, effect, owner]);
  const seed = (id, kind = "order", version = 1) => db.query(`
    insert into private.church_square_resource_state (
      merchant_id,square_location_id,organization_id,location_id,resource_kind,resource_id,source_updated_at,source_version,facts
    ) values ('M_TEST','L_TEST',$1,$2,$3,$4,$5::timestamptz,$6::bigint,$7::jsonb)
  `, [organization, location, kind, id, savedTime, version, JSON.stringify({ kind, id, sourceHint: "UNKNOWN" })]);

  await assert.rejects(save(), { code: "PT409" });
  await db.exec("reset role");
  await seed(orderId);
  await seed(siblingOrder);
  await seed(caseOrder);
  await seed(orderWithoutVersion, "order", null);
  await seed("payment-with-identical-id", "payment");

  await asRole(db, "authenticated", owner);
  assert.equal(await get(), null);
  await assert.rejects(get({ site: outsideLocation }), { code: "42501" });
  await assert.rejects(get({ id: "order with invalid chars" }), { code: "22023" });
  await assert.rejects(save(), { code: "42501" });
  await assert.rejects(db.exec("select * from private.church_square_marketplace_links"), { code: "42501" });

  for (const [role, actor] of [
    ["anon", undefined], ["service_role", undefined], ["authenticated", undefined],
    ["authenticated", outsider], ["authenticated", prep], ["authenticated", manager],
  ]) {
    await asRole(db, role, actor);
    await assert.rejects(get(), { code: "42501" });
  }

  await asRole(db, "service_role");
  for (const actor of [null, outsider, prep, manager]) await assert.rejects(save({ actor }), { code: "42501" });
  await assert.rejects(save({ site: outsideLocation }), { code: "42501" });
  for (const input of [
    { id: "payment-with-identical-id" }, { merchant: "M_OTHER" }, { sellerSite: "L_OTHER" },
    { id: orderId.slice(-10) }, { time: latest }, { version: 2 }, { version: null },
  ]) await assert.rejects(save(input), { code: "PT409" });
  for (const input of [
    { channel: "SQUARE_POS" }, { evidence: "source_hint" }, { externalStore: "with spaces" },
    { externalStore: "a".repeat(101) }, { externalOrder: "12345" }, { externalOrder: "1234567890" },
    { externalOrder: "a".repeat(101) }, { externalOrder: "contains spaces in the ref" }, { time: "infinity" }, { version: -1 },
  ]) await assert.rejects(save(input), { code: "22023" });

  const original = await save({ time: sameTimeInNewYork });
  assert.deepEqual(original, {
    channel: "DOORDASH", storeReference: sameStoreId.slice(-10), orderReference: sameExternalId.slice(-10),
    recordedAt: original.recordedAt, evidence: "merchant_order",
  });
  assert(Number.isFinite(Date.parse(original.recordedAt)));
  assert.deepEqual(await save(), original);
  assert(!JSON.stringify(original).includes(sameExternalId));
  await assert.rejects(save({ id: siblingOrder }), { code: "23505" });
  await assert.rejects(save({ externalOrder: "Separate-Marketplace-Order-123" }), { code: "23505" });
  await assert.rejects(save({ channel: "UBER_EATS" }), { code: "23505" });
  const caseDistinct = await save({ id: caseOrder, externalOrder: sameExternalId.toLowerCase() });
  assert.equal(caseDistinct.orderReference, original.orderReference);
  const absentVersion = await save({ id: orderWithoutVersion, version: null, channel: "UBER_EATS", externalStore: "X",
    evidence: "payout_statement" });
  assert.equal(absentVersion.storeReference, "X");
  assert.equal(absentVersion.evidence, "payout_statement");

  await db.exec("reset role");
  await grant(manager, "reports.financial.view");
  await grant(manager, "manager_log.manage", "deny");
  await grant(prep, "reports.financial.view");
  await grant(prep, "manager_log.manage");
  await asRole(db, "authenticated", prep);
  await assert.rejects(get(), { code: "42501" });
  await asRole(db, "authenticated", manager);
  assert.deepEqual(await get(), original);
  assert.equal(await get({ id: siblingOrder }), null);
  assert.equal(await get({ id: orderId.slice(-10) }), null);
  assert.equal(await get({ merchant: "M_OTHER" }), null);
  await asRole(db, "service_role");
  await assert.rejects(save({ actor: manager, evidence: "payout_statement" }), { code: "42501" });

  await db.exec("reset role");
  await db.query(`update public.user_capability_overrides set effect = 'grant'
    where user_id=$1 and location_id=$2 and capability_key='manager_log.manage'`, [manager, location]);
  await db.query(`update private.church_square_resource_state
    set source_version = 2, source_updated_at=$1::timestamptz where resource_kind='order' and resource_id=$2`, [latest, orderId]);
  await asRole(db, "service_role");
  await assert.rejects(save({ actor: manager, evidence: "payout_statement" }), { code: "PT409" });
  const upgraded = await save({ actor: manager, version: 2, time: latest, evidence: "payout_statement" });
  assert.deepEqual(upgraded, { ...original, evidence: "payout_statement" });
  assert.deepEqual(await save({ actor: owner, version: 2, time: latest, evidence: "merchant_order" }), upgraded);
  assert.deepEqual(await save({ actor: owner, version: 2, time: latest, evidence: "payout_statement" }), upgraded);

  await db.exec("reset role");
  const audit = await one(`
    select jsonb_build_object('originalActor',recorded_by,'originalVersion',source_version,
      'originalEvidence',original_evidence,'secondActor',payout_evidence_by,'secondVersion',payout_source_version,
      'chronological',payout_evidence_at >= recorded_at) as result
    from private.church_square_marketplace_links where location_id=$1 and order_id=$2
  `, [location, orderId]);
  assert.deepEqual(audit, {
    originalActor: owner, originalVersion: 1, originalEvidence: "merchant_order",
    secondActor: manager, secondVersion: 2, chronological: true,
  });
  assert.equal(await one("select count(*)::int as result from private.church_square_marketplace_links"), 3);
  await asRole(db, "authenticated", manager);
  assert.deepEqual(await get(), upgraded);
  await asRole(db, "service_role");
  await db.query("select public.service_set_church_street_active($1::uuid,false)", [organization]);
  await assert.rejects(save({ version: 2, time: latest }), { code: "42501" });
  await asRole(db, "authenticated", owner);
  await assert.rejects(get(), { code: "42501" });
}

it("records only collision-safe exact Church Street marketplace links and preserves payout-upgrade audit", async () => {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  try {
    await db.exec(bootstrap);
    await verifyMarketplaceLinks(db);
  } finally {
    await db.close();
  }
}, 150_000);
