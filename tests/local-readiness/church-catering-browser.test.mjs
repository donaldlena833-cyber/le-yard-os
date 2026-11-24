import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { PGlite } from "@electric-sql/pglite";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { chromium } from "playwright";
import { expect, it, vi } from "vitest";
import { bootstrap } from "../../scripts/lib/pglite-platform-bootstrap.mjs";

const admin = vi.hoisted(() => ({ rpc: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => admin }));

const websiteCheckout = process.env.CATERING_WEBSITE_CHECKOUT;
const owner = "10000000-0000-4000-8000-000000000001";
const prep = "10000000-0000-4000-8000-000000000005";
const endpoint = "/api/v1/church-catering-inquiries";
const preview = "/sandwicherie/catering";
const guestEmail = "guest@example.invalid";

// Opt-in cross-repo test. Use a dep-installed website checkout with no hosted
// credentials and install the Operations checkout's Playwright Chromium first.
async function listen(server) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });
  return `http://127.0.0.1:${server.address().port}`;
}

async function close(server) {
  if (!server.listening) return;
  server.closeAllConnections();
  await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
}

async function waitForWebsite(origin, child) {
  for (let attempt = 0; attempt < 90; attempt += 1) {
    if (child.exitCode !== null || child.signalCode) throw new Error("The isolated website exited before its preview was available.");
    const response = await fetch(`${origin}${preview}`, { signal: AbortSignal.timeout(1_000) }).catch(() => null);
    const html = await response?.text();
    if (response?.ok && html?.includes("Catering inquiries on Church Street")) return;
    await delay(500);
  }
  throw new Error("The isolated Church Street website preview did not start.");
}

async function stopWebsite(process) {
  if (!process || process.exitCode !== null || process.signalCode) return;
  const closed = new Promise((resolve) => process.once("exit", resolve));
  process.kill("SIGTERM");
  await Promise.race([closed, delay(5_000)]);
  if (process.exitCode === null && !process.signalCode) process.kill("SIGKILL");
}

it.skipIf(!websiteCheckout)("moves one guest form through the real Church Street relay to a single manager-converted job", async () => {
  const website = resolve(websiteCheckout);
  const next = join(website, "node_modules/next/dist/bin/next");
  if (!existsSync(next) || !existsSync(join(website, "src/app/sandwicherie/catering/page.tsx"))) {
    throw new Error("CATERING_WEBSITE_CHECKOUT must point to the installed Le Yard website checkout with the Church Street form.");
  }
  if ([".env", ".env.local", ".env.development", ".env.development.local"].some((file) => existsSync(join(website, file)))) {
    throw new Error("Use an isolated website checkout without local environment files.");
  }

  const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });
  const key = randomUUID();
  const receipts = [];
  let receiverError;
  let handleIntake;
  vi.stubEnv("LE_YARD_CHURCH_CATERING_RECEIVER_ENABLED", "true");
  vi.stubEnv("NEXT_PUBLIC_APP_SURFACE", "operations");
  const receiver = createServer(async (incoming, outgoing) => {
    if (incoming.url !== endpoint || incoming.method !== "POST") return outgoing.writeHead(404).end();
    try {
      const body = [];
      for await (const chunk of incoming) body.push(chunk);
      const request = new Request(`http://127.0.0.1${endpoint}`, {
        method: "POST", headers: incoming.headers, body: Buffer.concat(body),
      });
      const response = await handleIntake(request);
      const payload = await response.json();
      receipts.push({ status: response.status, id: payload.data?.inquiryId, key: incoming.headers["idempotency-key"] });
      // Drop the acknowledgment after the first commit. The browser must retry
      // with the same request identity rather than create a second inquiry.
      if (receipts.length === 1 && response.ok) return outgoing.writeHead(503).end();
      outgoing.writeHead(response.status, { "content-type": "application/json" }).end(JSON.stringify(payload));
    } catch (error) {
      receiverError = error;
      outgoing.writeHead(500).end();
    }
  });
  let webProcess;
  let browser;
  try {
    ({ POST: handleIntake } = await import("@/app/api/v1/church-catering-inquiries/route"));
    const migrations = new URL("../../supabase/migrations/", import.meta.url);
    await db.exec(bootstrap);
    for (const name of (await readdir(migrations)).filter((name) => name.endsWith(".sql")).sort()) {
      await db.exec(await readFile(new URL(name, migrations), "utf8"));
    }
    await db.exec(await readFile(new URL("../../supabase/seed.sql", import.meta.url), "utf8"));
    async function assume(role, actor) {
      await db.exec("reset role");
      await db.query("select set_config('request.jwt.claims', $1, false)", [JSON.stringify({ sub: actor, role, aal: "aal1" })]);
      await db.exec(role === "service_role" ? "set role service_role" : "set role authenticated");
    }
    const result = async (sql, params = []) => (await db.query(sql, params)).rows[0].result;
    await assume("service_role");
    const actors = [{ user_id: owner, role: "owner" }, { user_id: prep, role: "employee", job_code: "PREP" }];
    const { organization_id: organizationId, location_id: locationId } = await result(
      "select public.service_provision_church_street($1::jsonb) as result", [JSON.stringify(actors)],
    );
    await db.query("select public.service_set_church_street_active($1::uuid, true)", [organizationId]);
    await db.exec("reset role");
    await db.query(`insert into catering_private.catering_api_clients
      (organization_id, location_id, key_hash, name, is_active) values ($1, $2, $3, 'Loopback rehearsal', true)`,
    [organizationId, locationId, createHash("sha256").update(key).digest("hex")]);
    admin.rpc.mockImplementation((name, input) => ({
      async abortSignal() {
        try {
          if (name === "service_authenticate_catering_client") return {
            data: await result("select public.service_authenticate_catering_client($1) as result", [input.p_key_hash]), error: null,
          };
          if (name === "service_capture_catering_inquiry") return {
            data: await result("select public.service_capture_catering_inquiry($1,$2,$3) as result", [input.p_client_id, input.p_request_id, input.p_payload]), error: null,
          };
          throw new Error("Unexpected Supabase call in the isolated receiver.");
        } catch (error) {
          return { data: null, error };
        }
      },
    }));
    await assume("service_role");

    const receiverOrigin = await listen(receiver);
    const portProbe = createServer();
    const websiteOrigin = await listen(portProbe);
    await close(portProbe);
    webProcess = spawn(process.execPath, [next, "dev", "--hostname", "127.0.0.1", "--port", new URL(websiteOrigin).port], {
      cwd: website,
      env: {
        PATH: process.env.PATH,
        NEXT_TELEMETRY_DISABLED: "1",
        LE_YARD_CHURCH_STREET_PREVIEW_ENABLED: "true",
        LE_YARD_CHURCH_CATERING_PREVIEW_ENABLED: "true",
        LE_YARD_CHURCH_CATERING_INTAKE_ENABLED: "true",
        LE_YARD_CHURCH_CATERING_INTAKE_URL: `${receiverOrigin}${endpoint}`,
        LE_YARD_CHURCH_CATERING_INTAKE_KEY: key,
        LE_YARD_CHURCH_CATERING_INTAKE_OWNER: "Local rehearsal owner",
      },
      stdio: "ignore",
    });
    await waitForWebsite(websiteOrigin, webProcess);
    browser = await chromium.launch();
    const page = await browser.newPage();
    await page.route("**/*", (route) => new URL(route.request().url()).origin === websiteOrigin ? route.continue() : route.abort());
    await page.goto(`${websiteOrigin}${preview}`);
    await page.getByRole("radio", { name: "A work gathering" }).check();
    await page.getByLabel("Your name").fill("Synthetic Catering Guest");
    await page.getByLabel("Email", { exact: false }).fill(guestEmail);
    await page.getByLabel("The occasion").fill("Office lunch rehearsal");
    await page.getByLabel("Guest count").fill("24");
    await page.getByRole("button", { name: "Review your brief" }).click();
    expect(await page.getByLabel("Prepared brief").inputValue()).toContain("140 Church Street");
    expect(receipts).toHaveLength(0);
    const send = page.getByRole("button", { name: "Send an inquiry" });
    await send.click();
    await page.getByText(/couldn.t confirm that your inquiry was saved/).waitFor();
    await send.click();
    await page.getByText(/Your inquiry is saved/).waitFor();
    expect(receiverError).toBeUndefined();
    expect(receipts).toHaveLength(2);
    expect(receipts[0]).toEqual(receipts[1]);
    expect(receipts[0]).toMatchObject({ status: 201, id: expect.any(String), key: expect.any(String) });
    const inquiryId = receipts[0].id;
    await browser.close();
    browser = undefined;

    await assume("authenticated", prep);
    await expect(result("select public.get_church_catering_inquiry($1,$2) as result", [locationId, inquiryId])).rejects.toMatchObject({ code: "42501" });
    await assume("authenticated", owner);
    const inbox = await result("select public.list_church_catering_inquiries($1) as result", [locationId]);
    expect(inbox).toEqual([expect.objectContaining({ id: inquiryId, guestCount: 24, jobId: null })]);
    expect(JSON.stringify(inbox)).not.toContain(guestEmail);
    expect(await result("select public.get_church_catering_inquiry($1,$2) as result", [locationId, inquiryId])).toMatchObject({ email: guestEmail });
    const jobs = () => result("select public.list_church_catering_jobs($1) as result", [locationId]);
    expect(await jobs()).toEqual([]);
    const date = await result("select ((now() at time zone 'America/New_York')::date + 21)::text as result");
    const convert = (id) => result("select public.convert_church_catering_inquiry($1,$2,$3,$4,$5) as result", [id, locationId, inquiryId, "Office lunch rehearsal", date]);
    const requestId = randomUUID();
    const job = await convert(requestId);
    expect(job).toMatchObject({ stage: "inquiry", prepPublishedAt: null, invoice: null });
    expect(await convert(requestId)).toMatchObject({ id: job.id });
    await expect(convert(randomUUID())).rejects.toMatchObject({ code: "PT409" });
    expect(await jobs()).toEqual([expect.objectContaining({ id: job.id, stage: "inquiry" })]);
    expect(await result("select public.list_church_catering_inquiries($1) as result", [locationId]))
      .toEqual([expect.objectContaining({ id: inquiryId, jobId: job.id })]);
  } finally {
    const cleanup = await Promise.allSettled([browser?.close(), stopWebsite(webProcess), close(receiver)]);
    vi.unstubAllEnvs();
    vi.resetAllMocks();
    await db.close();
    const failed = cleanup.find((result) => result.status === "rejected");
    if (failed) throw failed.reason;
  }
}, 180_000);
