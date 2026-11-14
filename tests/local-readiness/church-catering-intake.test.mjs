import { createHash, randomUUID } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { expect, it } from "vitest";
import { bootstrap } from "../../scripts/lib/pglite-platform-bootstrap.mjs";
import { receiveCateringInquiry } from "@/lib/catering-receiver.server";
import { churchCateringIntakeDetailSchema, churchCateringIntakeSummarySchema } from "@/lib/integrations/church-catering-intake";
import { cateringJobSchema } from "@/lib/integrations/church-square-catering-jobs";

const owner = "10000000-0000-4000-8000-000000000001";
const prep = "10000000-0000-4000-8000-000000000005";
const wrongLocation = "30000000-0000-4000-8000-000000000001";
const key = "local-fixture-key-for-church-catering-only";
const brief = {
  audience: "corporate", contactName: "Synthetic Contact", email: "test@example.net", occasion: "Private occasion",
  guestCount: 25, source: "website", channel: "website", purpose: "catering_service_inquiry",
  noticeVersion: "catering-2026-10-21", emailMarketingConsent: false, smsMarketingConsent: false, profileConsent: false,
};

async function assume(db, role, actor) {
  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: actor, role, aal: "aal1" })]);
  await db.exec(role === "service_role" ? "set role service_role" : "set role authenticated");
}

it("commits the website wire request once and converts it into a scoped inquiry with no Square action", async () => {
  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  try {
    const directory = new URL("../../supabase/migrations/", import.meta.url);
    await db.exec(bootstrap);
    for (const name of (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(name, directory), "utf8"));
    }
    await db.exec(await readFile(new URL("../../supabase/seed.sql", import.meta.url), "utf8"));
    const one = async (sql, params = []) => (await db.query(sql, params)).rows[0].result;
    await assume(db, "service_role");
    const { organization_id: org, location_id: loc } = await one("select public.service_provision_church_street($1::jsonb) as result", [JSON.stringify([
      { user_id: owner, role: "owner" }, { user_id: prep, role: "employee", job_code: "PREP" },
    ])]);
    await db.query("select public.service_set_church_street_active($1::uuid, true)", [org]);
    await db.exec("reset role");
    await db.query(`insert into catering_private.catering_api_clients
      (organization_id,location_id,key_hash,name,is_active,contact_hourly_limit)
      values ($1,$2,$3,'fixture website',true,1)`, [org, loc, createHash("sha256").update(key).digest("hex")]);
    const rpc = async (sql, params) => {
      try { return { data: await one(sql, params), error: null }; }
      catch (error) { return { data: null, error }; }
    };
    const store = {
      authenticate: (digest) => rpc("select public.service_authenticate_catering_client($1) as result", [digest]),
      capture: (client, id, payload) => rpc("select public.service_capture_catering_inquiry($1,$2,$3) as result", [client, id, payload]),
    };
    const receiptKey = randomUUID();
    const receive = (id, payload = brief, token = key) => receiveCateringInquiry(new Request("https://ops.invalid/api/v1/church-catering-inquiries", {
      method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json", "idempotency-key": id },
      body: JSON.stringify(payload),
    }), { enabled: true, store: () => store });
    await assume(db, "service_role");
    expect((await receive(receiptKey, brief, "wrong-token-".repeat(5))).status).toBe(401);
    const accepted = await receive(receiptKey, { ...brief, dietaryNeeds: "DISCARD THIS", notes: "DISCARD THESE" });
    expect(accepted.status).toBe(201);
    const { inquiryId } = (await accepted.json()).data;
    expect((await (await receive(receiptKey, { ...brief, dietaryNeeds: "DISCARD THIS", notes: "DISCARD THESE" })).json()).data.inquiryId).toBe(inquiryId);
    expect((await receive(receiptKey, { ...brief, occasion: "Changed" })).status).toBe(409);
    expect((await receive(randomUUID())).status).toBe(429);
    await expect(one("select public.list_church_catering_inquiries($1) as result", [loc])).rejects.toMatchObject({ code: "42501" });
    await assume(db, "authenticated", prep);
    await expect(one("select public.get_church_catering_inquiry($1,$2) as result", [loc, inquiryId])).rejects.toMatchObject({ code: "42501" });
    await assume(db, "authenticated", owner);
    await expect(one("select public.get_church_catering_inquiry($1,$2) as result", [wrongLocation, inquiryId])).rejects.toMatchObject({ code: "42501" });
    const overview = await one("select public.list_church_catering_inquiries($1) as result", [loc]);
    expect(overview).toHaveLength(1);
    expect(churchCateringIntakeSummarySchema.parse(overview[0])).toMatchObject({ id: inquiryId, eventDate: null, guestCount: 25, jobId: null });
    expect(JSON.stringify(overview)).not.toMatch(/Synthetic Contact|Private occasion|example\.net|DISCARD/);
    const detail = await one("select public.get_church_catering_inquiry($1,$2) as result", [loc, inquiryId]);
    expect(churchCateringIntakeDetailSchema.parse(detail)).toMatchObject({ contactName: "Synthetic Contact", email: "test@example.net", eventDate: null });
    expect(JSON.stringify(detail)).not.toMatch(/DISCARD/);
    expect(await one("select public.list_church_catering_jobs($1) as result", [loc])).toEqual([]);
    const convert = (id) => one("select public.convert_church_catering_inquiry($1,$2,$3,$4,$5) as result", [id, loc, inquiryId, "Office lunch inquiry", "2027-01-05"]);
    const jobKey = randomUUID();
    const job = cateringJobSchema.parse(await convert(jobKey));
    expect(job).toMatchObject({ stage: "inquiry", title: "Office lunch inquiry", prepPublishedAt: null, invoice: null });
    expect(await convert(jobKey)).toMatchObject({ id: job.id });
    await expect(convert(randomUUID())).rejects.toMatchObject({ code: "PT409" });
    expect(await one("select public.list_church_catering_inquiries($1) as result", [loc])).toEqual([expect.objectContaining({ id: inquiryId, jobId: job.id })]);
    await db.exec("reset role");
    const payload = await one("select payload as result from catering_private.catering_inquiries where id=$1", [inquiryId]);
    expect(JSON.stringify(payload)).not.toMatch(/DISCARD|dietaryNeeds|notes/);
  } finally {
    await db.close();
  }
}, 120_000);
