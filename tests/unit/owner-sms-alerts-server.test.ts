import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import type { Database } from "@/types/database.generated";

const mocks = vi.hoisted(() => ({ from: vi.fn(), rpc: vi.fn(), send: vi.fn(), notify: vi.fn(), smsEnabled: true }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: mocks.from, rpc: mocks.rpc }) }));
vi.mock("@/lib/communications.server", () => ({
  resolveLeYardTenant: async () => ({ organizationId: "org", locationId: "loc" }),
  notifyOwnersOfCommunication: mocks.notify,
}));
vi.mock("@/lib/twilio.server", () => ({
  twilioForwardNumbers: () => ({ donald: "+12125550101", maris: "+12125550102" }),
  twilioPhoneNumber: () => "+13328779035",
  twilioSmsEnabled: () => mocks.smsEnabled,
  twilioAbsoluteUrl: (path: string) => `https://phone.leyardny.com${path}`,
  twilioRestClient: () => ({ messages: { create: mocks.send } }),
}));

import {
  enqueueOwnerSmsAlerts,
  enqueueOwnerSmsReplyGuidance,
  enqueueOwnerSmsSetup,
  isOwnerSmsAlertRecipient,
  ownerSmsAlertsEnabled,
  processOwnerSmsAlertQueue,
} from "@/lib/owner-sms-alerts.server";

type Alert = Database["public"]["Tables"]["owner_sms_alerts"]["Row"];
const sourceSid = `SM${"a".repeat(32)}`;
const providerSid = `SM${"f".repeat(32)}`;
let rows: Alert[];
let calls: { url: URL; method: string; body: unknown }[];
let sequence: number;

function fixture(overrides: Partial<Alert> = {}): Alert {
  return {
    id: `00000000-0000-4000-8000-${String(++sequence).padStart(12, "0")}`,
    organization_id: "org", location_id: "loc", source_sid: sourceSid,
    source_key: sourceSid, recipient: "donald", part: 1, body: "Le Yard Messages\nFixture alert",
    status: "queued", provider_sid: null, provider_status: null, error_code: null,
    created_at: "2026-09-12T12:00:00.000Z", started_at: null,
    updated_at: "2026-09-12T12:00:00.000Z", completed_at: null,
    ...overrides,
  };
}

function matches(row: Alert, url: URL) {
  for (const [key, value] of url.searchParams) {
    if (key in row) {
      const actual = row[key as keyof Alert];
      if (value.startsWith("eq.") && String(actual) !== value.slice(3)) return false;
      if (value.startsWith("lt.") && !(Number(actual) < Number(value.slice(3)))) return false;
      if (value.startsWith("gt.") && !(Number(actual) > Number(value.slice(3)))) return false;
      if (value.startsWith("in.(") && !value.slice(4, -1).split(",").includes(String(actual))) return false;
    }
  }
  return true;
}

beforeEach(() => {
  vi.clearAllMocks();
  rows = []; calls = []; sequence = 0;
  mocks.smsEnabled = true;
  vi.stubEnv("TWILIO_OWNER_SMS_ALERTS_ENABLED", "true");
  vi.stubEnv("TWILIO_MESSAGING_SERVICE_SID", `MG${"b".repeat(32)}`);
  mocks.send.mockResolvedValue({ sid: providerSid, status: "queued", errorCode: null });
  mocks.notify.mockResolvedValue(undefined);
  const client = createClient("https://database.example.test", "fixture-key", {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const url = new URL(String(input));
      const method = init?.method ?? "GET";
      const body = init?.body ? JSON.parse(String(init.body)) : null;
      calls.push({ url, method, body });
      expect(url.pathname).toBe("/rest/v1/owner_sms_alerts");
      if (method === "POST") {
        const inserted: Alert[] = [];
        for (const item of body) {
          if (rows.some((row) => row.organization_id === item.organization_id && row.source_key === item.source_key && row.recipient === item.recipient && row.part === item.part)) continue;
          const row = fixture(item); rows.push(row); inserted.push(row);
        }
        expect(new Headers(init?.headers).get("prefer")).toContain("resolution=ignore-duplicates");
        return Response.json(inserted);
      }
      let selected = rows.filter((row) => matches(row, url));
      if (method === "PATCH") {
        selected.forEach((row) => Object.assign(row, body));
        return Response.json(selected);
      }
      if (url.searchParams.has("or")) {
        selected = selected.filter((row) => row.status === "queued" || (row.status === "sending" && new Date(row.started_at ?? row.created_at).getTime() < Date.now() - 120000));
      }
      selected = selected.sort((a, b) => a.created_at.localeCompare(b.created_at) || a.source_key.localeCompare(b.source_key) || a.part - b.part || a.recipient.localeCompare(b.recipient));
      selected = selected.slice(0, Number(url.searchParams.get("limit") ?? selected.length));
      return Response.json(selected);
    } },
  });
  mocks.from.mockImplementation((table) => client.from(table));
  mocks.rpc.mockImplementation(async (_name, args) => {
    const row = rows.find((item) => item.id === args.p_id && item.organization_id === args.p_organization_id);
    if (!row) return { data: { status: "missing" }, error: null };
    if (row.status === "sending" && new Date(row.started_at ?? row.created_at).getTime() < Date.now() - 120000) {
      row.status = "uncertain"; row.error_code = "worker_interrupted";
    }
    if (row.status !== "queued") return { data: { status: row.status, alert: { ...row } }, error: null };
    const earlier = rows.filter((item) => item.source_key === row.source_key && item.recipient === row.recipient && item.part < row.part && ["accepted", "delivered"].includes(item.status));
    if (earlier.length !== row.part - 1) return { data: { status: "busy", alert: { ...row } }, error: null };
    row.status = "sending"; row.started_at = new Date().toISOString();
    return { data: { status: "claimed", alert: { ...row } }, error: null };
  });
});
afterEach(() => { vi.unstubAllEnvs(); vi.useRealTimers(); });

it("requires both enable flags before enqueuing or dispatching", async () => {
  vi.stubEnv("TWILIO_OWNER_SMS_ALERTS_ENABLED", "false");
  expect(ownerSmsAlertsEnabled()).toBe(false);
  expect(await enqueueOwnerSmsAlerts({ sourceSid, from: "+12125550123", body: "Hello", mediaCount: 0 })).toEqual([]);
  await processOwnerSmsAlertQueue();
  expect(mocks.from).not.toHaveBeenCalled();
  vi.stubEnv("TWILIO_OWNER_SMS_ALERTS_ENABLED", "true");
  mocks.smsEnabled = false;
  expect(ownerSmsAlertsEnabled()).toBe(false);
  await enqueueOwnerSmsSetup("00000000-0000-4000-8000-000000000001");
  expect(mocks.send).not.toHaveBeenCalled();
  expect(mocks.from).not.toHaveBeenCalled();
});

it("enqueues each complete part for both owner labels and ignores webhook duplicates", async () => {
  vi.stubEnv("COMMUNICATIONS_TEST_RECIPIENT_PHONE", "+12125550123");
  const input = { sourceSid, from: "+12125550123", body: "Hello ".repeat(250), mediaCount: 1 };
  expect(await enqueueOwnerSmsAlerts(input)).toHaveLength(4);
  expect(await enqueueOwnerSmsAlerts(input)).toHaveLength(0);
  expect(rows.map((row) => [row.recipient, row.part])).toEqual([["donald", 1], ["maris", 1], ["donald", 2], ["maris", 2]]);
  for (const row of rows) {
    expect(row.organization_id).toBe("org"); expect(row.location_id).toBe("loc");
    expect(row.source_sid).toBe(sourceSid); expect(row.source_key).toBe(sourceSid);
    expect(row.body).toContain(`https://phone.leyardny.com/messages?message=${sourceSid}`);
    expect(row.body.length).toBeLessThanOrEqual(1600);
  }
  expect(JSON.stringify(calls)).not.toContain("+12125550101");
  expect(JSON.stringify(calls)).not.toContain("+12125550102");
});

it.each(["+12125550101", "+12125550102", "+13328779035"])("never forwards business or founder inbound %s to both owners", async (from) => {
  expect(await enqueueOwnerSmsAlerts({ sourceSid, from, body: "Hi", mediaCount: 0 })).toEqual([]);
  expect(mocks.from).not.toHaveBeenCalled();
});

it("guides only the founder who replied and includes the inbox link", async () => {
  expect(isOwnerSmsAlertRecipient("+12125550101")).toBe(true);
  expect(isOwnerSmsAlertRecipient("+12125550123")).toBe(false);
  expect(await enqueueOwnerSmsReplyGuidance({ sourceSid, from: "+12125550123" })).toEqual([]);
  await enqueueOwnerSmsReplyGuidance({ sourceSid, from: "+12125550102" });
  expect(rows).toHaveLength(1); expect(rows[0].recipient).toBe("maris");
  expect(rows[0].body).toContain("https://phone.leyardny.com/messages");
  expect(rows[0].body).toContain("not the guest");
});

it("creates an idempotent, clearly labeled setup event without inventing a message SID", async () => {
  const id = "00000000-0000-4000-8000-000000000001";
  await expect(enqueueOwnerSmsSetup("invalid")).rejects.toThrow("setup_id_invalid");
  await enqueueOwnerSmsSetup(id); await enqueueOwnerSmsSetup(id);
  expect(rows).toHaveLength(2);
  expect(rows[0]).toMatchObject({ source_sid: null, source_key: `setup:${id}` });
  expect(rows[0].body).toContain("Setup/test");
  expect(rows[0].body).toContain("https://phone.leyardny.com/le-yard-messages.vcf");
});

it("claims each message once across concurrent workers and uses a dedicated callback", async () => {
  rows = [fixture(), fixture({ recipient: "maris" })];
  await Promise.all([processOwnerSmsAlertQueue(), processOwnerSmsAlertQueue()]);
  expect(mocks.send).toHaveBeenCalledTimes(2);
  expect(rows.every((row) => row.status === "accepted")).toBe(true);
  for (const [input] of mocks.send.mock.calls) {
    expect(input.from).toBe("+13328779035");
    expect(["+12125550101", "+12125550102"]).toContain(input.to);
    const callback = new URL(input.statusCallback);
    expect(callback.pathname).toBe("/api/twilio/sms/owner-alert-status");
    expect(rows.some((row) => row.id === callback.searchParams.get("alert"))).toBe(true);
  }
  expect(calls.every((call) => call.url.pathname.endsWith("owner_sms_alerts"))).toBe(true);
  const read = calls.find((call) => call.method === "GET")!;
  expect(read.url.searchParams.get("limit")).toBe("16");
  expect(read.url.searchParams.get("organization_id")).toBe("eq.org");
  expect(read.url.searchParams.get("location_id")).toBe("eq.loc");
});

it("sends multipart messages sequentially per owner while both owners run independently", async () => {
  rows = [fixture({ part: 1 }), fixture({ part: 2 }), fixture({ recipient: "maris", part: 1 }), fixture({ recipient: "maris", part: 2 })];
  const active = new Set<string>(); let simultaneous = false;
  mocks.send.mockImplementation(async ({ to }) => {
    expect(active.has(to)).toBe(false);
    active.add(to); simultaneous ||= active.size === 2;
    await new Promise((resolve) => setTimeout(resolve, 5));
    active.delete(to);
    return { sid: providerSid, status: "queued" };
  });
  await processOwnerSmsAlertQueue();
  expect(mocks.send).toHaveBeenCalledTimes(4); expect(simultaneous).toBe(true);
  expect(rows.every((row) => row.status === "accepted")).toBe(true);
});

it("preserves a delivered callback that races the provider acceptance response", async () => {
  rows = [fixture()];
  mocks.send.mockImplementation(async () => {
    rows[0].status = "delivered"; rows[0].provider_status = "delivered";
    return { sid: providerSid, status: "queued" };
  });
  await processOwnerSmsAlertQueue();
  expect(rows[0].status).toBe("delivered");
  expect(rows[0].provider_status).toBe("delivered");
  expect(calls.find((call) => call.method === "PATCH")?.url.searchParams.get("status")).toBe("eq.sending");
});

it.each([
  { error: { status: 400, code: 21610, message: "secret destination +12125550101" }, status: "failed", code: "provider_21610" },
  { error: { status: 500, message: "secret destination +12125550101" }, status: "uncertain", code: "provider_http_500" },
  { error: new Error("timeout secret destination +12125550101"), status: "uncertain", code: "provider_unconfirmed" },
])("records $status after provider failure, blocks later parts, and never blindly retries", async ({ error, status, code }) => {
  rows = [fixture(), fixture({ part: 2 }), fixture({ part: 3 })];
  mocks.send.mockRejectedValue(error);
  await processOwnerSmsAlertQueue(); await processOwnerSmsAlertQueue();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(rows[0]).toMatchObject({ status, error_code: code });
  expect(rows.slice(1).every((row) => row.status === "uncertain" && row.error_code === "earlier_part_unconfirmed")).toBe(true);
  expect(mocks.notify).toHaveBeenCalledTimes(1);
  expect(mocks.notify.mock.calls[0][0].actionUrl).toContain(`?message=${sourceSid}`);
  expect(JSON.stringify(mocks.notify.mock.calls)).not.toContain("secret destination");
  expect(JSON.stringify(mocks.notify.mock.calls)).not.toContain("+12125550101");
  expect(mocks.notify.mock.calls[0][0]).not.toHaveProperty("phone");
});

it("moves a stale sending row to uncertain without another provider request", async () => {
  rows = [fixture({ status: "sending", started_at: new Date(Date.now() - 180000).toISOString() }), fixture({ part: 2 })];
  await processOwnerSmsAlertQueue();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(rows.every((row) => row.status === "uncertain")).toBe(true);
  expect(mocks.notify).toHaveBeenCalledTimes(1);
});

it("clears later parts blocked by an earlier callback failure without duplicate review alerts", async () => {
  rows = [fixture({ status: "failed" }), fixture({ part: 2 }), fixture({ part: 3 })];
  await processOwnerSmsAlertQueue();
  expect(mocks.send).not.toHaveBeenCalled();
  expect(rows.slice(1).every((row) => row.status === "uncertain")).toBe(true);
  expect(mocks.notify).not.toHaveBeenCalled();
});

it("stops starting new work before the 50-second route budget is exhausted", async () => {
  vi.spyOn(Date, "now").mockReturnValue(1000000);
  rows = [fixture(), fixture({ source_key: `SM${"b".repeat(32)}`, source_sid: `SM${"b".repeat(32)}` })];
  mocks.send.mockImplementation(async () => {
    vi.mocked(Date.now).mockReturnValue(1040000);
    return { sid: providerSid, status: "queued" };
  });
  const result = await processOwnerSmsAlertQueue();
  expect(mocks.send).toHaveBeenCalledTimes(1);
  expect(result.skipped).toBe(1);
  expect(rows[1].status).toBe("queued");
  vi.mocked(Date.now).mockRestore();
});
