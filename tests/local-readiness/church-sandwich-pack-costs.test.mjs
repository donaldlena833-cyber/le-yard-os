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
const manager = "10000000-0000-4000-8000-000000000004";
const prep = "10000000-0000-4000-8000-000000000005";
const outside = "10000000-0000-4000-8000-000000000006";
const outsideLocation = "30000000-0000-4000-8000-000000000001";

async function asRole(db, role, sub) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub, role, aal: "aal1" })]);
  await db.exec(`set role ${role}`);
}

async function verifyPackCosts(db) {
  const migrations = new URL("../../supabase/migrations/", import.meta.url);
  for (const name of (await readdir(migrations)).filter((file) => file.endsWith(".sql")).sort()) {
    await db.exec(await readFile(new URL(name, migrations), "utf8"));
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

  const today = await one("select (now() at time zone 'America/New_York')::date::text as result");
  const yesterday = await one("select ((now() at time zone 'America/New_York')::date - 1)::text as result");
  const tomorrow = await one("select ((now() at time zone 'America/New_York')::date + 1)::text as result");
  const list = (workspace = location) => one("select public.list_church_sandwich_pack_costs($1::uuid) as result", [workspace]);
  const ingest = ({
    workspace = location, request = randomUUID(), ingredient = "Brie", revision = 1,
    quantity = 525.125, cost = 498, date = today, reference = "Invoice 15 · line 2",
  } = {}) => one(`
    select public.record_church_sandwich_pack_cost($1::uuid,$2::uuid,$3::text,$4::int,$5::numeric,$6::bigint,$7::date,$8::text) as result
  `, [workspace, request, ingredient, revision, quantity, cost, date, reference]);
  const review = (ingredient, expected, status = "reviewed", sku = "BRIE-42", label = "Physical label A") => one(`
    select public.save_church_ingredient_evidence($1::uuid,$2::uuid,$3,$4::int,$5,$6,$7,$8,$9,$10,$11,$12) as result
  `, [randomUUID(), location, ingredient, expected, status, sku, label,
    "Milk", "As stated on true test supplier label", "Supplier storage", "Supplier opened", "Supplier prepped"]);

  await asRole(db, "authenticated", owner);
  assert.deepEqual(await list(), []);
  await assert.rejects(ingest(), { code: "PT409" });
  await assert.rejects(list(outsideLocation), { code: "42501" });
  await assert.rejects(ingest({ workspace: outsideLocation }), { code: "42501" });
  await assert.rejects(db.exec("select * from private.church_sandwich_pack_costs"), { code: "42501" });
  assert.equal((await review("Brie", 0)).revision, 1);
  assert.equal((await review("10-inch baguette", 0, "reviewed", "BAG-23")).revision, 1);

  for (const input of [
    { ingredient: "unknown" }, { revision: 0 }, { quantity: 0 }, { quantity: -1 }, { quantity: 1_000_000.001 },
    { quantity: 123.1234 }, { quantity: "NaN" }, { quantity: "Infinity" },
    { ingredient: "10-inch baguette", quantity: 3.5 }, { cost: 0 }, { cost: 100_000_001 },
    { date: tomorrow }, { date: "infinity" }, { date: "-infinity" },
    { reference: "  " }, { reference: "Invoice\n12" }, { reference: "x".repeat(161) },
  ]) {
    await assert.rejects(ingest(input), { code: "22023" });
  }
  await assert.rejects(ingest({ revision: 2 }), { code: "PT409" });

  const request = randomUUID();
  const first = await ingest({ request, reference: "   Invoice 15 · line 2  " });
  assert.deepEqual(first, {
    ingredientKey: "Brie", evidenceRevision: 1, supplierSku: "BRIE-42", packQuantity: 525.125,
    packCostCents: 498, invoiceDate: today, invoiceReference: "Invoice 15 · line 2", recordedAt: first.recordedAt,
  });
  assert(Number.isFinite(Date.parse(first.recordedAt)));
  assert.deepEqual(await ingest({ request }), first);
  await assert.rejects(ingest({ request, cost: 499 }), { code: "PT409" });

  const older = await ingest({ date: yesterday, reference: "Late receipt yesterday", cost: 420 });
  assert.equal(older.invoiceDate, yesterday);
  assert.deepEqual(await list(), [first]);

  const corrected = await ingest({ cost: 505, reference: "Invoice 15 · corrected line 2" });
  assert.deepEqual(await list(), [corrected]);
  assert.deepEqual(await ingest({ request }), first);
  assert.deepEqual(await list(), [corrected]);

  const bread = await ingest({ ingredient: "10-inch baguette", quantity: 6, cost: 1249 });
  assert.deepEqual(await list(), [bread, corrected]);
  const batch = (await db.query("select * from public.list_church_sandwich_pack_costs($1)", [location])).rows;
  assert.equal(batch.length, 1);

  for (const [role, user] of [
    ["anon", undefined], ["service_role", undefined], ["authenticated", undefined],
    ["authenticated", outside], ["authenticated", prep], ["authenticated", manager],
  ]) {
    await asRole(db, role, user);
    await assert.rejects(list(), { code: "42501" });
    await assert.rejects(ingest({ request }), { code: "42501" });
  }

  const addCapability = (user, key) => db.query(`
    insert into public.user_capability_overrides (
      organization_id,user_id,capability_key,location_id,effect,reason,created_by,updated_by,effective_from
    ) values ($1,$2,$3,$4,'grant','Fixture price access',$5,$5,current_date - 1)
  `, [organization, user, key, location, owner]);
  await db.exec("reset role");
  await addCapability(manager, "inventory.price.manage");
  await asRole(db, "authenticated", manager);
  await assert.rejects(list(), { code: "42501" });
  await assert.rejects(ingest(), { code: "42501" });
  await db.exec("reset role");
  await addCapability(manager, "reports.financial.view");
  await addCapability(prep, "reports.financial.view");
  await addCapability(prep, "inventory.price.manage");
  await asRole(db, "authenticated", prep);
  await assert.rejects(list(), { code: "42501" });
  await asRole(db, "authenticated", manager);
  assert.deepEqual(await list(), [bread, corrected]);
  await assert.rejects(ingest({ request }), { code: "PT409" });
  const managerRecord = await ingest({ cost: 490, reference: "Manager invoice correction" });
  assert.deepEqual(await list(), [bread, managerRecord]);

  await asRole(db, "authenticated", owner);
  assert.equal((await review("Brie", 1, "hold")).revision, 2);
  assert.deepEqual(await list(), [bread]);
  await assert.rejects(ingest({ revision: 2 }), { code: "PT409" });
  await assert.rejects(ingest({ revision: 1 }), { code: "PT409" });
  assert.deepEqual(await ingest({ request }), first);
  assert.deepEqual(await list(), [bread]);
  assert.equal((await review("Brie", 2, "reviewed", "BRIE-42", "New label revision")).revision, 3);
  assert.deepEqual(await list(), [bread]);
  const resumed = await ingest({ revision: 3, cost: 525 });
  assert.deepEqual(await list(), [bread, resumed]);
  assert.equal((await review("Brie", 3, "reviewed", "BRIE-84", "New supplying product")).revision, 4);
  assert.deepEqual(await list(), [bread]);
  const replacement = await ingest({ revision: 4, cost: 550 });
  assert.equal(replacement.supplierSku, "BRIE-84");
  assert.deepEqual(await list(), [bread, replacement]);

  await db.exec("reset role");
  assert.equal(await one("select count(*)::int as result from private.church_sandwich_pack_costs"), 7);
  await assert.rejects(db.exec("update private.church_sandwich_pack_costs set pack_cost_cents = 1"));
  await assert.rejects(db.exec("delete from private.church_sandwich_pack_costs"));
  await asRole(db, "service_role");
  await db.query("select public.service_set_church_street_active($1::uuid,false)", [organization]);
  await asRole(db, "authenticated", owner);
  await assert.rejects(list(), { code: "42501" });
  await assert.rejects(ingest({ request }), { code: "42501" });
}

it("keeps only invoice-backed costs for the exact current reviewed Church Street supplier revision", async () => {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  try {
    await db.exec(bootstrap);
    await verifyPackCosts(db);
  } finally {
    await db.close();
  }
}, 120_000);
