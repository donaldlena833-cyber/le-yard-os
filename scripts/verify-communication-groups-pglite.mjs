import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
const generator = await readFile("scripts/generate-database-types.mjs", "utf8");
const bootstrap = generator.match(/const bootstrap = `([\s\S]*?)`;/)?.[1];
assert(bootstrap, "Database platform bootstrap must be available");
const org = "10000000-0000-4000-8000-000000000001",
  other = "10000000-0000-4000-8000-000000000002";
const loc = "20000000-0000-4000-8000-000000000001",
  otherLoc = "20000000-0000-4000-8000-000000000002";
const owner = "30000000-0000-4000-8000-000000000001",
  employee = "30000000-0000-4000-8000-000000000002",
  outsider = "30000000-0000-4000-8000-000000000003";
const sid = "SM" + "a".repeat(32),
  ticket = "40000000-0000-4000-8000-000000000001";
async function denied(sql, code) {
  await assert.rejects(db.exec(sql), (e) => e.code === code);
}
async function actor(id) {
  await db.exec(
    `reset role;set request.jwt.claims='{"sub":"${id}","role":"authenticated","aal":"aal1"}';set role authenticated;`,
  );
}
let failed = false;
try {
  await db.exec(bootstrap);
  await db.exec("create schema supabase_migrations; create table supabase_migrations.schema_migrations(version text primary key);");
  for (const file of (await readdir("supabase/migrations"))
    .filter((f) => f.endsWith(".sql"))
    .sort()) {
    await db.exec(await readFile(`supabase/migrations/${file}`, "utf8"));
    await db.query("insert into supabase_migrations.schema_migrations(version) values ($1)", [file.split("_")[0]]);
  }
  await db.exec(`set request.jwt.claims='{"role":"service_role"}';`);
  const contract = (
    await db.query("select public.service_runtime_schema_contract() as value")
  ).rows[0].value;
  assert.equal(contract.migrationHead, "20260908120001");
  assert.equal(
    contract.matchesExpected,
    true,
    "Runtime schema fingerprint must match after migration",
  );
  await db.exec(`set request.jwt.claims='{"role":"service_role"}'; insert into auth.users(id,email) values('${owner}','owner@fixture.test'),('${employee}','employee@fixture.test'),('${outsider}','outsider@fixture.test');
    insert into public.profiles(id,display_name) values('${owner}','Owner'),('${employee}','Employee'),('${outsider}','Other owner') on conflict(id) do update set display_name=excluded.display_name;
    insert into public.organizations(id,name,slug) values('${org}','Fixture','fixture-communications'),('${other}','Other','other-communications');
    insert into public.locations(id,organization_id,name,code,timezone) values('${loc}','${org}','Le Yard','LY','America/New_York'),('${otherLoc}','${other}','Other','OT','America/New_York');
    insert into public.organization_memberships(organization_id,user_id,role,status,joined_at) values('${org}','${owner}','owner','active',now()),('${org}','${employee}','employee','active',now()),('${other}','${outsider}','owner','active',now());
    insert into public.employees(organization_id,user_id,display_name,phone) values('${org}','${employee}','Employee','(212) 555-0123');
    insert into public.communication_messages(organization_id,location_id,sid,from_number,to_number,body,direction,sender_kind,status,sent_at) values('${org}','${loc}','${sid}','+12125550123','+13328779035',E'  exact\\ntext  ','inbound','client','received',now());
    insert into public.communication_cases(id,organization_id,location_id,kind,title,source_sid) values('${ticket}','${org}','${loc}','ticket','Follow up','${sid}');
    insert into public.communication_case_notes(id,organization_id,case_id,author_id,author_name,body,status,created_at) values('50000000-0000-4000-8000-000000000001','${org}','${ticket}','${owner}','Owner','Resolved','resolved','2026-09-08T12:00Z'),('50000000-0000-4000-8000-000000000002','${org}','${ticket}','${owner}','Owner','Additional internal note',null,'2026-09-08T12:01Z');`);
  assert.equal(
    (
      await db.query(
        `select display_name from public.communication_employee_for_phone('${org}','+12125550123')`,
      )
    ).rows[0].display_name,
    "Employee",
  );
  assert.equal(
    (
      await db.query(
        `select * from public.communication_employee_for_phone('${other}','+12125550123')`,
      )
    ).rows.length,
    0,
  );
  await db.exec(
    `set request.jwt.claims='{"sub":"${owner}","role":"authenticated","aal":"aal1"}';`,
  );
  await db.exec(
    `update public.employees set employment_status='terminated' where user_id='${employee}'`,
  );
  assert.equal(
    (
      await db.query(
        `select * from public.communication_employee_for_phone('${org}','+12125550123')`,
      )
    ).rows.length,
    0,
  );
  await actor(owner);
  assert.equal(
    (await db.query("select * from public.communication_messages")).rows.length,
    1,
  );
  assert.equal(
    (await db.query("select body from public.communication_messages")).rows[0]
      .body,
    "  exact\ntext  ",
  );
  assert.equal(
    (await db.query("select status from public.communication_case_summaries"))
      .rows[0].status,
    "resolved",
  );
  await denied(
    `update public.communication_messages set body='tamper'`,
    "42501",
  );
  await denied(`delete from public.communication_case_notes`, "42501");
  await denied(
    `select * from public.communication_employee_for_phone('${org}','+12125550123')`,
    "42501",
  );
  for (const user of [employee, outsider]) {
    await actor(user);
    for (const table of [
      "communication_messages",
      "communication_cases",
      "communication_case_notes",
      "communication_threads",
      "communication_case_summaries",
    ])
      assert.equal(
        (await db.query(`select * from public.${table}`)).rows.length,
        0,
        `${table} leaks to ${user}`,
      );
  }
  await db.exec("reset role");
  await denied(
    `insert into public.communication_cases(id,organization_id,location_id,kind,title,source_sid) values(gen_random_uuid(),'${other}','${otherLoc}','ticket','Cross tenant','${sid}')`,
    "23503",
  );
  await denied(
    `insert into public.communication_threads(organization_id,location_id,phone) values('${org}','${otherLoc}','+12125550123')`,
    "23503",
  );
  await denied(
    `insert into public.communication_messages(organization_id,location_id,sid,from_number,to_number,body,direction,sender_kind,status,sent_at) select organization_id,location_id,sid,from_number,to_number,body,direction,sender_kind,status,sent_at from public.communication_messages`,
    "23505",
  );
  assert.equal(
    (
      await db.query(
        "select public from storage.buckets where id='phone-attachments'",
      )
    ).rows[0].public,
    false,
  );
  console.log(
    "PASS: complete migration chain; owner reads; employee and cross-tenant isolation; append-only transcript access; employee phone routing; stable ticket status; private MMS bucket; composite tenant constraints.",
  );
} catch (error) {
  console.error("FAIL:", error.message, error.code ?? "");
  failed = true;
} finally {
  await db.close();
}

if (failed) process.exitCode = 1;
