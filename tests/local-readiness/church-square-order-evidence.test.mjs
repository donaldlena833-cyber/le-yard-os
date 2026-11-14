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
  assert.deepEqual(Object.keys(observed).sort(), ["matches", "updatedAt"]);
  assert.equal(observed.matches, true);
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
}

it("corroborates only an exact Church Street order update and limits who can read it", async () => {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  try {
    await db.exec(bootstrap);
    await verifyOrderEvidence(db);
  } finally {
    await db.close();
  }
}, 90_000);
