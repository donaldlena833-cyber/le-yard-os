import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { Pool } from "pg";
import { it } from "vitest";
import { bootstrap } from "../../scripts/lib/pglite-platform-bootstrap.mjs";

const owner = "10000000-0000-4000-8000-000000000001";
const manager = "10000000-0000-4000-8000-000000000004";
const outsider = "10000000-0000-4000-8000-000000000006";
const outsideLocation = "30000000-0000-4000-8000-000000000001";
const item = "71000000-0000-4000-8000-000000000001";
const firstHash = "a".repeat(64);
const secondHash = "b".repeat(64);
const ciphertext = `01${"c0".repeat(40)}`;

it("fences stock push to new Church episodes and the exact opted-in device version", async () => {
  const isolatedSocket = process.env.CHURCH_STOCK_PUSH_TEST_SOCKET;
  const native = isolatedSocket ? new Pool({ host: isolatedSocket, port: 5432, user: "postgres", database: "church_stock_push_test", max: 3 }) : null;
  const fixture = native ? await native.connect() : null;
  const db = fixture ? { query: fixture.query.bind(fixture), exec: fixture.query.bind(fixture) }
    : new PGlite({ extensions: { btree_gist, pgcrypto, pg_trgm } });
  try {
    await db.exec(bootstrap);
    const migrations = new URL("../../supabase/migrations/", import.meta.url);
    for (const name of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(name, migrations), "utf8"));
    }
    await db.exec(await readFile(new URL("../../supabase/seed.sql", import.meta.url), "utf8"));
    const one = async (sql, args = []) => (await db.query(sql, args)).rows[0].result;
    async function role(roleName, user) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: user, role: roleName, aal: "aal1" })]);
      await db.exec(`set role ${roleName}`);
    }
    await role("service_role");
    const { organization_id: organization, location_id: location } = await one(
      "select public.service_provision_church_street($1::jsonb) as result", [JSON.stringify([
        { user_id: owner, role: "owner" }, { user_id: manager, role: "manager" },
      ])],
    );
    await db.query("select public.service_set_church_street_active($1::uuid,true)", [organization]);
    await db.exec("reset role");
    await db.query(`insert into private.church_square_count_items
      (id,organization_id,location_id,label,merchant_id,square_location_id,variation_id,is_enabled,configured_by)
      values ($1,$2,$3,'Isolated rehearsed item','M_TEST','L_TEST','V_TEST',true,$4)`, [item, organization, location, owner]);

    const enable = (hash = firstHash, data = ciphertext, site = location) =>
      one("select public.save_church_square_stock_push_device($1,$2,decode($3,'hex')) as result", [site, hash, data]);
    const enabled = (hash = firstHash, site = location) => one("select public.get_church_square_stock_push_device($1,$2) as result", [site, hash]);
    const disable = (hash = firstHash) => one("select public.remove_church_square_stock_push_device($1,$2) as result", [location, hash]);
    const claim = () => one("select public.service_claim_church_square_stock_push($1) as result", [randomUUID()]);
    const complete = (delivery, status, token = delivery.claimToken) =>
      one("select public.service_complete_church_square_stock_push($1,$2,$3) as result", [delivery.id, token, status]);
    const postStock = async (quantity, age = "0 seconds") => {
      const episode = quantity <= 5 ? randomUUID() : null;
      await db.query(`insert into private.church_square_stock_state as stock (item_id,quantity,calculated_at,episode_id)
        values ($1,$2,clock_timestamp()-$3::interval,$4)
        on conflict (item_id) do update set quantity=excluded.quantity,calculated_at=excluded.calculated_at,
          episode_id=case when excluded.episode_id is not null then coalesce(stock.episode_id,excluded.episode_id) end`, [item, quantity, age, episode]);
      return one("select episode_id as result from private.church_square_stock_state where item_id=$1", [item]);
    };
    const deviceVersion = (hash = firstHash) => one("select version_id as result from private.church_square_stock_push_devices where endpoint_hash=$1", [hash]);

    // A new opt-in cannot see a prior low-stock episode or intercept someone else's endpoint.
    await postStock(5);
    await role("authenticated", owner);
    await assert.rejects(enable(firstHash, ciphertext, outsideLocation), { code: "42501" });
    await assert.rejects(enable(firstHash, `02${"c0".repeat(40)}`), { code: "22023" });
    assert.equal(await enabled(), false);
    assert.equal(await enable(), true);
    assert.equal(await enabled(), true);
    await assert.rejects(claim(), { code: "42501" });
    await assert.rejects(db.exec("select * from private.church_square_stock_push_devices"), { code: "42501" });
    await db.exec("reset role");
    const original = await deviceVersion();
    await role("authenticated", owner);
    assert.equal(await enable(), true);
    await db.exec("reset role");
    assert.equal(await deviceVersion(), original);
    await role("authenticated", manager);
    assert.equal(await enabled(), false);
    await assert.rejects(enable(), { code: "PT409" });
    assert.equal(await disable(), true);
    await role("authenticated", outsider);
    await assert.rejects(enabled(), { code: "42501" });
    await role("service_role");
    assert.equal(await claim(), null);
    await assert.rejects(enabled(), { code: "42501" });

    // Acknowledge cancels the pending send; a no-op low update cannot re-arm it.
    await db.exec("reset role");
    await postStock(40);
    const acknowledgedEpisode = await postStock(5);
    await role("authenticated", owner);
    await db.query("select public.acknowledge_church_square_stock_alert($1,$2,$3)", [location, item, acknowledgedEpisode]);
    await db.exec("reset role");
    await postStock(4);
    await role("service_role");
    assert.equal(await claim(), null);

    // Exactly one claim, an exact-token result and no requeue after restock.
    await db.exec("reset role");
    await postStock(40);
    const episode = await postStock(5);
    await role("service_role");
    const delivery = await claim();
    assert.equal(delivery.episodeId, episode);
    assert.equal(delivery.encryptedSubscription, `\\x${ciphertext}`);
    assert.equal(await claim(), null);
    assert.equal(await complete(delivery, "sent", randomUUID()), false);
    assert.equal(await complete(delivery, "sent"), true);
    assert.equal(await complete(delivery, "sent"), true);
    assert.equal(await complete(delivery, "gone"), false);

    // A provider gone result can revoke only the exact reserved version, never a replacement owner.
    await db.exec("reset role");
    await postStock(40);
    await postStock(5);
    await role("service_role");
    const previousOwner = await claim();
    await role("authenticated", owner);
    assert.equal(await disable(), true);
    assert.equal(await enabled(), false);
    await role("authenticated", manager);
    assert.equal(await enable(), true);
    await role("authenticated", owner);
    assert.equal(await disable(), true);
    await role("service_role");
    assert.equal(await complete(previousOwner, "gone"), true);
    assert.equal(await claim(), null);
    await role("authenticated", manager);
    assert.equal(await enabled(), true);
    assert.equal(await enable(secondHash), true);

    // Polling skips a revoked device and a disabled mapping, and expires abandoned dispatch.
    await db.exec("reset role");
    await postStock(40);
    await postStock(5);
    await role("authenticated", manager);
    await disable(secondHash);
    await role("service_role");
    const abandoned = await claim();
    assert(abandoned);
    assert.equal(await claim(), null);
    await db.exec("reset role");
    await db.query("update private.church_square_stock_push_outbox set claimed_at=clock_timestamp()-interval '61 seconds' where id=$1", [abandoned.id]);
    await role("service_role");
    assert.equal(await claim(), null);
    assert.equal(await complete(abandoned, "sent"), false);
    await db.exec("reset role");
    assert.equal(await one("select status as result from private.church_square_stock_push_outbox where id=$1", [abandoned.id]), "uncertain");

    await postStock(40);
    await postStock(5);
    await db.query("update private.church_square_count_items set is_enabled=false where id=$1", [item]);
    await role("service_role");
    assert.equal(await claim(), null);
    await db.exec("reset role");
    await db.query("update private.church_square_count_items set is_enabled=true where id=$1", [item]);
    await postStock(40);
    await postStock(5, "13 minutes");
    await role("service_role");
    assert.equal(await claim(), null);

    await db.exec("reset role");
    await postStock(40);
    await postStock(5);
    await db.query("update private.church_square_stock_push_outbox set enqueued_at=clock_timestamp()-interval '14 minutes',expires_at=clock_timestamp()-interval '1 minute' where status='pending'");
    await role("service_role");
    assert.equal(await claim(), null);
    await db.exec("reset role");
    assert.equal(await one("select count(*)::int as result from private.church_square_stock_push_outbox where status='pending'"), 0);

    // Re-evaluate the member's count capability at the claim boundary.
    await postStock(40);
    await postStock(5);
    await db.query(`insert into public.user_capability_overrides
      (organization_id,user_id,capability_key,location_id,effect,reason,created_by,updated_by,effective_from)
      values ($1,$2,'inventory.count.create',$3,'deny','Isolated review',$4,$4,current_date-1)`, [organization, manager, location, owner]);
    await role("service_role");
    assert.equal(await claim(), null);
    if (native) {
      await db.exec("reset role");
      await role("authenticated", owner);
      await enable(secondHash);
      await db.exec("reset role");
      await postStock(40);
      await postStock(5);
      const first = await native.connect();
      const second = await native.connect();
      try {
        for (const connection of [first, second]) await connection.query("set role service_role");
        await first.query("begin");
        const simultaneous = async (connection) => (await connection.query(
          "select public.service_claim_church_square_stock_push($1) as result", [randomUUID()],
        )).rows[0].result;
        const reserved = await simultaneous(first);
        assert(reserved);
        assert.equal(await simultaneous(second), null);
        await first.query("commit");
        assert.equal(await simultaneous(second), null);

        await db.exec("reset role");
        await postStock(40);
        await postStock(5);
        await second.query("reset role");
        await second.query("select set_config('request.jwt.claims',$1,false)", [JSON.stringify({ sub: owner, role: "authenticated", aal: "aal1" })]);
        await second.query("set role authenticated");
        await second.query("begin");
        await second.query("select public.remove_church_square_stock_push_device($1,$2)", [location, secondHash]);
        const attempt = simultaneous(first);
        await second.query("commit");
        assert.equal(await attempt, null);
      } finally {
        await Promise.allSettled([first.query("rollback"), second.query("rollback")]);
        first.release();
        second.release();
      }
    }
  } finally {
    if (native && fixture) {
      fixture.release();
      await native.end();
    } else await db.close();
  }
}, 90_000);
