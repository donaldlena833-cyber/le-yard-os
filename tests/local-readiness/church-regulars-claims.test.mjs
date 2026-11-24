import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { it } from "vitest";
import { Pool } from "pg";

it("protects, reserves, recovers and audits actual treat claims", async () => {
  const socket = process.env.REGULARS_TEST_SOCKET;
  if (socket && socket !== "/Users/donaldlena/Documents/Codex/2026-11-23/niw/work/pg-r/socket") throw new Error("Use the isolated Regulars test cluster only.");
  const pool = socket ? new Pool({ host: socket, port: 59234, user: "postgres", database: "regulars_test", max: 3 }) : null;
  const fixture = pool ? await pool.connect() : null;
  const db = fixture ? { exec: fixture.query.bind(fixture), query: fixture.query.bind(fixture) }
    : new PGlite({ extensions: { btree_gist, pgcrypto, pg_trgm } });
  const owner = "10000000-0000-4000-8000-000000000001";
  const outsider = "10000000-0000-4000-8000-000000000006";
  try {
    // The full migration replay is verified separately. This fixture isolates the
    // new service boundary, real claim table, locking and audit trigger.
    await db.exec(`create role anon; create role authenticated; create role service_role bypassrls;
      create schema private;
      create table public.organizations(id uuid primary key,slug text,status text);
      create table public.locations(id uuid primary key,organization_id uuid,code text,is_active boolean);
      create table public.organization_memberships(organization_id uuid,user_id uuid,status text,role text);
      grant select,update on public.organizations,public.locations,public.organization_memberships to service_role;
      create table private.runtime_schema_contract_expected(contract_version text,migration_head text,
        table_fingerprint text,function_fingerprint text,access_fingerprint text,captured_at timestamptz);
      create function private.compute_runtime_schema_fingerprints() returns jsonb language sql as $$ select '{}'::jsonb $$;
      create function public.prevent_ledger_mutation() returns trigger language plpgsql as $$ begin raise exception 'Append only'; end $$;`);
    await db.exec(await readFile(new URL("../../supabase/migrations/20261124051528_church_regulars_treat_claims.sql", import.meta.url), "utf8"));
    const one = async (query, args = []) => (await db.query(query, args)).rows[0].result;
    const organization = "20000000-0000-4000-8000-000000000009";
    const location = "30000000-0000-4000-8000-000000000009";
    await db.query("insert into public.organizations values($1,'le-yard-church-street','active')", [organization]);
    await db.query("insert into public.locations values($1,$2,'CHURCH',true)", [location,organization]);
    await db.query("insert into public.organization_memberships values($1,$2,'active','owner')", [organization,owner]);
    const call = (action, payload = {}, actor = owner, member = "account") => one("select public.service_church_regulars_treat($1,$2,$3,$4,$5::jsonb) as result", [actor, location, member, action, JSON.stringify(payload)]);
    const evidence = { milestone: 3, cycleStart: "2026-11-24", cycleEnd: "2026-11-26", earnedOn: "2026-11-26",
      qualifyingDays: ["2026-11-24", "2026-11-25", "2026-11-26"], orderIds: ["order1", "order2", "order3"], requestId: randomUUID() };
    // Freeze only the test fixture's clock eligibility by moving the evidence into
    // the future relative to program launch if the host clock is earlier.
    const definition = (await db.query("select pg_get_functiondef('public.service_church_regulars_treat(uuid,uuid,text,text,jsonb)'::regprocedure) as value")).rows[0].value;
    const fixed = definition.replace("(clock_timestamp() at time zone 'America/New_York')::date", "'2026-12-01'::date");
    assert.notEqual(fixed,definition); await db.exec(fixed);
    await db.exec("set role anon");
    await assert.rejects(call("read"), { code: "42501" });
    await assert.rejects(db.exec("select * from private.church_regulars_treat_claims"), { code: "42501" });
    await db.exec("reset role; set role authenticated");
    await assert.rejects(call("reserve", evidence), { code: "42501" });
    await db.exec("reset role; set role service_role");
    await assert.rejects(call("read", {}, outsider), { code: "42501" });
    const first = await call("reserve", evidence);
    assert.equal(first.claims.length, 1); assert.equal(first.claims[0].status, "reserved");
    assert.equal((await call("reserve", { ...evidence, requestId: randomUUID() })).selectedClaimId, first.selectedClaimId);
    assert.equal((await call("reserve", { ...evidence, cycleEnd: "2026-11-27", requestId: randomUUID() })).claims.length, 1);
    const given = await call("fulfill", { claimId: first.selectedClaimId, itemLabel: "Almond Croissant" });
    assert.equal(given.claims[0].status, "fulfilled");
    assert.equal((await call("fulfill", { claimId: first.selectedClaimId, itemLabel: "Almond Croissant" })).claims.length, 1);
    await assert.rejects(call("fulfill", { claimId: first.selectedClaimId, itemLabel: "Different treat" }), { code: "PT409" });
    await assert.rejects(call("cancel", { claimId: first.selectedClaimId }), { code: "PT409" });
    await assert.rejects(call("reserve", { ...evidence, orderIds: ["same", "same", "same"], requestId: randomUUID() }, owner, "another"), { code: "22023" });
    const second = await call("reserve", { ...evidence, requestId: randomUUID() }, owner, "another");
    await call("cancel", { claimId: second.selectedClaimId }, owner, "another");
    const recovered = await call("reserve", { ...evidence, requestId: randomUUID() }, owner, "another");
    assert.notEqual(recovered.selectedClaimId, second.selectedClaimId);
    if (pool) {
      async function concurrentReserve() {
        const connection = await pool.connect();
        try {
          await connection.query("begin; set local role service_role");
          const result = await connection.query("select public.service_church_regulars_treat($1,$2,'concurrent','reserve',$3::jsonb) as result", [owner,location,JSON.stringify({ ...evidence,requestId:randomUUID() })]);
          await connection.query("commit"); return result.rows[0].result.selectedClaimId;
        } catch (error) { await connection.query("rollback"); throw error; }
        finally { connection.release(); }
      }
      const ids = await Promise.all([concurrentReserve(),concurrentReserve()]);
      assert.equal(ids[0],ids[1]);
      assert.equal((await call("read",{},owner,"concurrent")).claims.length,1);
    }
    await db.exec("reset role");
    assert.equal((await db.query("select count(*)::integer as n from private.church_regulars_treat_audit where claim_id=$1", [first.selectedClaimId])).rows[0].n, 2);
    await assert.rejects(db.exec("delete from private.church_regulars_treat_audit"));
    await assert.rejects(db.query("update private.church_regulars_treat_claims set account_id='other' where id=$1", [first.selectedClaimId]));
  } finally { if (fixture) { fixture.release(); await pool.end(); } else await db.close(); }
}, 120_000);
