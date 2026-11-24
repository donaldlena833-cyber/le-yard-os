import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { expect, it } from "vitest";
import { bootstrap } from "../../scripts/lib/pglite-platform-bootstrap.mjs";

const owner = "10000000-0000-4000-8000-000000000001";
const prep = "10000000-0000-4000-8000-000000000005";
const other = "10000000-0000-4000-8000-000000000006";
const otherLocation = "30000000-0000-4000-8000-000000000001";

async function assumeRole(db, sub, role = "authenticated") {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub, role, aal: "aal1" })]);
  await db.exec(role === "service_role" ? "set role service_role" : "set role authenticated");
}

it("shows the soonest actionable Church fulfillment heads without exposing financial or private facts", async () => {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  try {
    const migrations = new URL("../../supabase/migrations/", import.meta.url);
    await db.exec(bootstrap);
    for (const name of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(name, migrations), "utf8"));
    }
    await db.exec(await readFile(new URL("../../supabase/seed.sql", import.meta.url), "utf8"));
    await assumeRole(db, undefined, "service_role");
    const provision = await db.query("select public.service_provision_church_street($1::jsonb) as result", [JSON.stringify([
      { user_id: owner, role: "owner" }, { user_id: prep, role: "employee", job_code: "PREP" },
    ])]);
    const { organization_id: organization, location_id: location } = provision.rows[0].result;
    await db.query("select public.service_set_church_street_active($1::uuid, true)", [organization]);
    await assumeRole(db, owner);
    const watch = async (locationId = location) => (await db.query(
      "select public.list_church_square_order_watch($1::uuid) as result", [locationId],
    )).rows[0].result;
    expect(await watch()).toEqual({ checkedAt: expect.any(String), orderCoverageThrough: null, hasMore: false, orders: [] });
    await expect(watch(otherLocation)).rejects.toMatchObject({ code: "42501" });

    await db.exec("reset role");
    const now = Date.now();
    const relative = (minutes) => new Date(now + minutes * 60_000).toISOString();
    const state = async (id, fulfillments, { status = "OPEN", sourceHint = "DOORDASH", minutes = -1 } = {}) => db.query(`
      insert into private.church_square_resource_state (
        merchant_id,square_location_id,organization_id,location_id,resource_kind,resource_id,source_updated_at,facts
      ) values ('M_TEST','L_TEST',$1,$2,'order',$3,$4::timestamptz,$5::jsonb)
    `, [organization, location, id, relative(minutes), JSON.stringify({
      status, sourceHint, fulfillments, totalCents: 98765, customer: "PRIVATE-CUSTOMER", orderReference: "PRIVATE-REFERENCE",
    })]);
    const pickup = (promisedAt, facts = {}) => ({ type: "PICKUP", status: "PROPOSED", promisedAt, ...facts });
    const coverage = relative(-2);
    await db.query(`insert into private.church_square_order_backfill (
      organization_id,location_id,merchant_id,square_location_id,scan_started_at,covered_through
    ) values ($1,$2,'M_TEST','L_TEST',$3::timestamptz,$4::timestamptz)`, [organization, location, relative(-60), coverage]);
    await state("PRIVATE-ORDER-earliest48", [
      pickup(relative(-18), { id: "PRIVATE-FULFILLMENT", readyAt: relative(-20), name: "PRIVATE-GUEST" }),
      pickup(relative(-25), { status: "COMPLETED" }),
      pickup(relative(-25), { handoffAt: relative(-22) }),
      pickup(relative(-25), { canceledAt: relative(-22) }),
      pickup(relative(-25), { rejectedAt: relative(-22) }),
      pickup(relative(-25), { completedAt: relative(-22) }),
      pickup(relative(-25), { type: "SHIPMENT" }),
    ]);
    await state("next", [pickup(relative(0), { type: "DELIVERY", status: "PREPARED" })], { sourceHint: "PRIVATE-SOURCE" });
    await state("unknown", [pickup("2026-02-30T00:00:00Z", { readyAt: "PRIVATE-INVALID" })]);
    await state("closed", [pickup(relative(-200))], { status: "COMPLETED" });
    await state("too-old", [pickup(relative(-200))], { minutes: -1441 });
    await state("future", [pickup(relative(-200))], { minutes: 10 });
    await state("wrong-shape", { PRIVATE: true });
    await state("no-action", [pickup(relative(-300), { status: "RESERVED", handoffAt: relative(-310) })]);

    await assumeRole(db, owner);
    const result = await watch();
    expect(result.hasMore).toBe(false);
    expect(Date.parse(result.orderCoverageThrough)).toBe(Date.parse(coverage));
    expect(result.orders.map(({ reference }) => reference)).toEqual(["earliest48", "next", "unknown"]);
    expect(result.orders[0]).toEqual({ reference: "earliest48", source: "DOORDASH", status: "OPEN", updatedAt: expect.any(String),
      fulfillments: [{ type: "PICKUP", status: "PROPOSED", promisedAt: expect.any(String), readyAt: expect.any(String),
        handoffAt: null, completedAt: null, canceledAt: null, rejectedAt: null }],
    });
    expect(Date.parse(result.orders[0].fulfillments[0].promisedAt)).toBe(Date.parse(relative(-18)));
    expect(result.orders[1]).toMatchObject({ source: "UNKNOWN", fulfillments: [{ type: "DELIVERY", status: "PREPARED" }] });
    expect(result.orders[2].fulfillments[0]).toMatchObject({ promisedAt: null, readyAt: null });
    expect(JSON.stringify(result)).not.toMatch(/PRIVATE|customer|98765|amount|total/);

    await assumeRole(db, prep);
    await expect(watch()).rejects.toMatchObject({ code: "42501" });
    await assumeRole(db, other);
    await expect(watch()).rejects.toMatchObject({ code: "42501" });
    await db.exec("reset role");
    await db.query(`insert into public.user_capability_overrides (
      organization_id,user_id,capability_key,location_id,effect,reason,created_by,updated_by,effective_from
    ) values ($1,$2,'reports.financial.view',$3,'grant','Test role boundary',$4,$4,current_date - 1)`,
    [organization, prep, location, owner]);
    await assumeRole(db, prep);
    await expect(watch()).rejects.toMatchObject({ code: "42501" });
    await db.exec("reset role");
    await db.query(`insert into private.church_square_resource_state (
      merchant_id,square_location_id,organization_id,location_id,resource_kind,resource_id,source_updated_at,facts
    ) select 'M_TEST','L_TEST',$1,$2,'order','later-'||lpad(i::text,2,'0'),$3::timestamptz,
      jsonb_build_object('status','OPEN','fulfillments',jsonb_build_array(jsonb_build_object('type','PICKUP',
        'status','RESERVED','promisedAt',to_char($4::timestamptz at time zone 'UTC','YYYY-MM-DD"T"HH24:MI:SS"Z"'))))
    from generate_series(1,52) numbers(i)`, [organization, location, relative(-1), relative(15)]);
    await assumeRole(db, owner);
    const bounded = await watch();
    expect(bounded.hasMore).toBe(true);
    expect(bounded.orders).toHaveLength(50);
    expect(bounded.orders.slice(0, 3).map(({ reference }) => reference)).toEqual(["earliest48", "next", "later-01"]);
    expect(bounded.orders.at(-1).reference).toBe("later-48");
  } finally {
    await db.close();
  }
}, 90_000);
