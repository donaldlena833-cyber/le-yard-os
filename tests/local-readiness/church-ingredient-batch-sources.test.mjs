import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { it } from "vitest";
import { bootstrap } from "../../scripts/lib/pglite-platform-bootstrap.mjs";

const owner = "10000000-0000-4000-8000-000000000001";
const prep = "10000000-0000-4000-8000-000000000005";
const otherLocation = "30000000-0000-4000-8000-000000000001";
const ingredient = "French-style ham";
const lot = "SYNTHETIC-LOT";

async function assumeRole(db, role, userId) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: userId, role, aal: "aal1" })]);
  await db.exec(`set role ${role}`);
}

async function verifyBatchSources(db) {
  const directory = new URL("../../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, directory), "utf8"));
  }
  await db.exec(await readFile(new URL("../../supabase/seed.sql", import.meta.url), "utf8"));
  const one = async (sql, args = []) => (await db.query(sql, args)).rows[0].result;

  await assumeRole(db, "service_role");
  const { organization_id: organization, location_id: location } = await one(
    "select public.service_provision_church_street($1::jsonb) as result", [JSON.stringify([
      { user_id: owner, role: "owner" }, { user_id: prep, role: "employee", job_code: "PREP" },
    ])],
  );
  await db.query("select public.service_set_church_street_active($1::uuid,true)", [organization]);
  await assumeRole(db, "authenticated", owner);

  const saveEvidence = (revision = 0, status = "reviewed") => one(
    "select public.save_church_ingredient_evidence($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12) as result", [
      randomUUID(), location, ingredient, revision, status, "SYNTHETIC-SKU", "Test supplier label",
      "Test allergen note", "Test cross-contact note", "Chilled fixture", "Opened fixture", "Prepped fixture",
    ],
  );
  const now = Date.now();
  const at = (offsetSeconds) => new Date(now + offsetSeconds * 1000).toISOString();
  const recordRoot = (code, { id = randomUUID(), handledAt = at(-360), discardAt = at(3600), handledAs = "opened", revision = 1 } = {}) => one(
    "select public.record_church_ingredient_batch($1,$2,$3,$4,$5,$6,$7,$8,$9) as result",
    [id, location, ingredient, revision, lot, code, handledAs, handledAt, discardAt],
  );
  const derive = (source, code, {
    id = randomUUID(), workspaceLocation = location, handledAt = at(-120), discardAt = at(1200),
  } = {}) => one("select public.record_church_ingredient_batch_from_source($1,$2,$3,$4,$5,$6) as result",
    [id, workspaceLocation, source, code, handledAt, discardAt]);
  const measure = (batch, { id = randomUUID(), previousId = null } = {}) => one(
    "select public.record_church_ingredient_batch_measurement($1,$2,$3,$4,$5,$6) as result",
    [location, batch, id, previousId, 12, at(-10)],
  );
  const resolve = (batch, outcome) => one("select public.resolve_church_ingredient_batch($1,$2,$3,$4) as result",
    [location, batch, randomUUID(), outcome]);
  const voidBatch = (batch) => one("select public.void_church_ingredient_batch($1,$2,$3,$4) as result",
    [location, batch, randomUUID(), "Incorrect source label"]);
  const queue = async (batch) => (await one("select public.list_church_ingredient_batch_queue($1) as result",
    [location])).batches.find((entry) => entry.id === batch);

  await saveEvidence();
  const independent = await recordRoot("INDEPENDENT-PREP", { handledAs: "prepped", handledAt: at(-120), discardAt: at(1200) });
  assert.equal(independent.sourceBatch, null);
  const opened = await recordRoot("OPENED-HAM");
  assert.equal(opened.sourceBatch, null);
  assert.equal(opened.sourceNeedsReview, false);
  const request = { id: randomUUID(), discardAt: at(3600) };
  const derived = await derive(opened.id, "SLICED-HAM", request);
  assert.equal(derived.id, request.id);
  assert.equal(derived.ingredientKey, ingredient);
  assert.equal(derived.evidenceRevision, opened.evidenceRevision);
  assert.equal(derived.supplierSku, opened.supplierSku);
  assert.equal(derived.supplierLot, lot);
  assert.equal(derived.handledAs, "prepped");
  assert.equal(derived.handlingRule, "Prepped fixture");
  assert.deepEqual(derived.sourceBatch, { id: opened.id, batchCode: "OPENED-HAM", discardAt: opened.discardAt });
  assert.equal(derived.sourceNeedsReview, false);
  assert.equal(Date.parse(derived.discardAt), Date.parse(opened.discardAt));
  assert.deepEqual(await derive(opened.id, "SLICED-HAM", request), derived);
  await assert.rejects(derive(opened.id, "CHANGED-CODE", request), { code: "PT409" });
  await assert.rejects(derive(opened.id, "INDEPENDENT-PREP", { id: independent.id }), { code: "PT409" });
  assert.equal((await queue(independent.id)).sourceBatch, null);
  await assert.rejects(derive(opened.id, "AFTER-SOURCE-DEADLINE", { discardAt: at(3601) }), { code: "22023" });
  await assert.rejects(derive(opened.id, "BEFORE-SOURCE-HANDLING", { handledAt: at(-361) }), { code: "22023" });
  await assert.rejects(derive(opened.id, "WRONG-WORKSPACE", { workspaceLocation: otherLocation }), { code: "42501" });

  assert.equal((await resolve(opened.id, "used_up")).disposition.outcome, "used_up");
  assert.equal((await queue(derived.id)).sourceNeedsReview, false);
  assert.deepEqual(await derive(opened.id, "SLICED-HAM", request), derived);
  await assert.rejects(derive(opened.id, "ALREADY-USED"), { code: "PT409" });
  assert.equal((await measure(derived.id)).quantity, 12);
  const grandchildOfUsed = await derive(derived.id, "FIT-FOR-USE", { handledAt: at(-60), discardAt: at(900) });
  assert.equal(grandchildOfUsed.sourceNeedsReview, false);
  assert.equal((await resolve(grandchildOfUsed.id, "used_up")).disposition.outcome, "used_up");

  const voided = await recordRoot("OPENED-VOID");
  const childOfVoided = await derive(voided.id, "CHILD-VOID");
  const grandchild = await derive(childOfVoided.id, "GRANDCHILD-VOID", { handledAt: at(-60), discardAt: at(900) });
  const readingId = randomUUID();
  const priorReading = await measure(grandchild.id, { id: readingId });
  await voidBatch(voided.id);
  for (const descendant of [childOfVoided, grandchild]) {
    assert.equal((await queue(descendant.id)).sourceNeedsReview, true);
    await assert.rejects(derive(descendant.id, "ANCESTOR-VOID"), { code: "PT409" });
    await assert.rejects(resolve(descendant.id, "used_up"), { code: "PT409" });
  }
  await assert.rejects(measure(grandchild.id, { previousId: priorReading.id }), { code: "PT409" });
  assert.deepEqual(await measure(grandchild.id, { id: readingId }), priorReading);
  assert.equal((await resolve(grandchild.id, "discarded")).disposition.outcome, "discarded");

  const discarded = await recordRoot("OPENED-DISCARD");
  const childOfDiscarded = await derive(discarded.id, "CHILD-DISCARD");
  await resolve(discarded.id, "discarded");
  assert.equal((await queue(childOfDiscarded.id)).sourceNeedsReview, true);
  await assert.rejects(measure(childOfDiscarded.id), { code: "PT409" });
  await assert.rejects(derive(discarded.id, "ALREADY-DISCARDED"), { code: "PT409" });

  await db.exec("reset role");
  const expiredId = randomUUID();
  await db.query(`insert into private.church_ingredient_batches (
    organization_id,location_id,id,ingredient_key,evidence_revision,supplier_sku,supplier_lot,batch_code,
    handled_as,handled_at,discard_at,storage_rule,handling_rule,recorded_at,recorded_by,recorded_by_name
  ) values ($1,$2,$3,$4,1,'SYNTHETIC-SKU',$5,'OPENED-EXPIRED','opened',$6,$7,
    'Chilled fixture','Opened fixture',$8,$9,'Fixture preparer')`,
  [organization, location, expiredId, ingredient, lot, at(-500), at(-100), at(-360), owner]);
  await assumeRole(db, "authenticated", owner);
  await assert.rejects(derive(expiredId, "EXPIRED", { handledAt: at(-180), discardAt: at(-100) }), { code: "PT409" });
  const stale = await recordRoot("OPENED-STALE");
  await saveEvidence(1, "hold");
  await assert.rejects(derive(stale.id, "STALE-EVIDENCE"), { code: "PT409" });
  await assert.rejects(db.exec("select * from private.church_ingredient_batch_sources"), { code: "42501" });
  await assumeRole(db, "authenticated", prep);
  await assert.rejects(derive(stale.id, "PREP-ROLE-CANNOT-MANAGE"), { code: "42501" });
}

it("preserves the batch source, deadline and usable stock rules across prep and disposition", async () => {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  try {
    await db.exec(bootstrap);
    await verifyBatchSources(db);
  } finally {
    await db.close();
  }
});
