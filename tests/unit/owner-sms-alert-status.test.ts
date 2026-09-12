import { createClient } from "@supabase/supabase-js";
import { afterEach, beforeEach, expect, it, vi } from "vitest";

const m = vi.hoisted(() => ({
  valid: vi.fn(), tenant: vi.fn(), from: vi.fn(), admin: vi.fn(),
  provider: vi.fn(), message: vi.fn(), fetch: vi.fn(), recipients: vi.fn(),
  notify: vi.fn(), archive: vi.fn(), log: vi.fn(),
}));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: m.admin }));
vi.mock("@/lib/twilio.server", () => ({
  readTwilioForm: async (request: Request) => ({ params: new URLSearchParams(await request.text()) }),
  validateTwilioRequest: m.valid,
  twilioForwardNumbers: m.recipients,
  twilioPhoneNumber: () => "+13328779035",
  twilioRestClient: m.provider,
}));
vi.mock("@/lib/communications.server", () => ({
  resolveLeYardTenant: m.tenant,
  notifyOwnersOfCommunication: m.notify,
  logCommunicationEvent: m.log,
}));
vi.mock("@/lib/communication-groups.server", () => ({ saveCommunicationMessage: m.archive }));

import { POST } from "@/app/api/twilio/sms/owner-alert-status/route";

const id = "11111111-1111-4111-8111-111111111111";
const sid = `SM${"a".repeat(32)}`;
const sourceSid = `SM${"b".repeat(32)}`;
const numbers = { donald: "+12125550101", maris: "+12125550102" };
const tenant = { organizationId: "test-org", locationId: "test-location" };
let alert: { id: string; recipient: string; source_sid: string | null; provider_sid: string | null; status: string } | null;
let readError = false;
let updateError = false;
let updatedRows: { id: string }[] = [];
const requests: { url: URL; method: string; body: Record<string, unknown> | null }[] = [];

function request(options: { id?: string; sid?: string; status?: string } = {}) {
  return new Request(`https://phone.leyardny.com/api/twilio/sms/owner-alert-status?${new URLSearchParams({ alert: options.id ?? id })}`, {
    method: "POST",
    headers: { "x-twilio-signature": "unit-test-signature" },
    body: new URLSearchParams({ MessageSid: options.sid ?? sid, MessageStatus: options.status ?? "sent" }),
  });
}

function providerMessage(overrides: Record<string, unknown> = {}) {
  return { sid, from: "+13328779035", to: numbers.donald, direction: "outbound-api", status: "delivered", errorCode: null, ...overrides };
}

function updates() { return requests.filter((entry) => entry.method === "PATCH"); }

beforeEach(() => {
  vi.resetAllMocks();
  requests.length = 0;
  readError = false;
  updateError = false;
  updatedRows = [{ id }];
  alert = { id, recipient: "donald", source_sid: sourceSid, provider_sid: sid, status: "accepted" };
  m.valid.mockReturnValue(true);
  m.tenant.mockResolvedValue(tenant);
  m.recipients.mockReturnValue(numbers);
  m.provider.mockReturnValue({ messages: m.message });
  m.message.mockReturnValue({ fetch: m.fetch });
  m.fetch.mockResolvedValue(providerMessage());
  m.notify.mockResolvedValue(undefined);
  const client = createClient("https://database.example.test", "unit-test-only-key", {
    auth: { persistSession: false },
    global: { fetch: async (input, init) => {
      const method = init?.method ?? "GET";
      requests.push({ url: new URL(String(input)), method, body: init?.body ? JSON.parse(String(init.body)) : null });
      if (method === "GET") return Response.json(readError ? { message: "database unavailable" } : alert, { status: readError ? 400 : 200 });
      if (updateError) return Response.json({ message: "write unavailable" }, { status: 400 });
      return Response.json(updatedRows);
    } },
  });
  m.from.mockImplementation((table) => client.from(table));
  m.admin.mockReturnValue({ from: m.from });
});

afterEach(() => {
  expect(m.archive).not.toHaveBeenCalled();
  expect(m.log).not.toHaveBeenCalled();
  expect(requests.every(({ url }) => url.pathname === "/rest/v1/owner_sms_alerts")).toBe(true);
});

it("rejects an invalid signature before tenant, database, or provider access", async () => {
  m.valid.mockReturnValue(false);
  expect((await POST(request())).status).toBe(403);
  expect(m.tenant).not.toHaveBeenCalled();
  expect(m.admin).not.toHaveBeenCalled();
  expect(m.provider).not.toHaveBeenCalled();
});

it.each([
  { id: "" }, { id: "not-a-uuid" }, { id: `${id},or(id.neq.null)` },
  { sid: "" }, { sid: "SMinvalid" }, { sid: `CA${"a".repeat(32)}` },
])("rejects malformed alert identities before accessing data: %j", async (options) => {
  expect((await POST(request(options))).status).toBe(400);
  expect(m.tenant).not.toHaveBeenCalled();
  expect(m.provider).not.toHaveBeenCalled();
});

it("scopes both the lookup and update to the configured organization, location, and alert", async () => {
  expect((await POST(request())).status).toBe(204);
  expect(requests).toHaveLength(2);
  for (const { url } of requests) {
    expect(url.searchParams.get("organization_id")).toBe(`eq.${tenant.organizationId}`);
    expect(url.searchParams.get("location_id")).toBe(`eq.${tenant.locationId}`);
    expect(url.searchParams.get("id")).toBe(`eq.${id}`);
  }
  expect(updates()[0].url.searchParams.get("status")).toBe("neq.delivered");
});

it("rejects a missing alert without a provider lookup", async () => {
  alert = null;
  expect((await POST(request())).status).toBe(403);
  expect(m.provider).not.toHaveBeenCalled();
  expect(updates()).toHaveLength(0);
});

it("rejects a callback SID different from the alert's saved provider SID", async () => {
  alert!.provider_sid = `SM${"c".repeat(32)}`;
  expect((await POST(request())).status).toBe(403);
  expect(m.provider).not.toHaveBeenCalled();
  expect(updates()).toHaveLength(0);
});

it("rejects a provider resource whose SID differs from the signed callback", async () => {
  m.fetch.mockResolvedValue(providerMessage({ sid: `SM${"c".repeat(32)}` }));
  expect((await POST(request())).status).toBe(403);
  expect(updates()).toHaveLength(0);
});

it.each([
  { from: "+12125550199" }, { to: numbers.maris },
  { to: "+12125550199" }, { direction: "inbound" },
])("rejects a provider message outside the exact outbound recipient: %j", async (overrides) => {
  m.fetch.mockResolvedValue(providerMessage(overrides));
  expect((await POST(request())).status).toBe(403);
  expect(updates()).toHaveLength(0);
  expect(m.notify).not.toHaveBeenCalled();
});

it.each(["donald", "maris"] as const)("accepts only the configured %s destination", async (recipient) => {
  alert!.recipient = recipient;
  m.fetch.mockResolvedValue(providerMessage({ to: numbers[recipient] }));
  expect((await POST(request())).status).toBe(204);
  expect(m.message).toHaveBeenCalledWith(sid);
  expect(updates()[0].body).toMatchObject({ provider_sid: sid, status: "delivered" });
});

it("uses current provider status instead of an older callback value", async () => {
  expect((await POST(request({ status: "failed" }))).status).toBe(204);
  expect(updates()[0].body).toMatchObject({ provider_status: "delivered", status: "delivered", error_code: null, completed_at: expect.any(String) });
  expect(m.notify).not.toHaveBeenCalled();
});

it("accepts a fast signed callback before the sender saves its provider SID", async () => {
  alert!.provider_sid = null;
  alert!.status = "sending";
  expect((await POST(request())).status).toBe(204);
  expect(updates()[0].body).toMatchObject({ provider_sid: sid, status: "delivered" });
});

it("does not bind a fast callback when the provider destination is wrong", async () => {
  alert!.provider_sid = null;
  m.fetch.mockResolvedValue(providerMessage({ to: numbers.maris }));
  expect((await POST(request())).status).toBe(403);
  expect(updates()).toHaveLength(0);
});

it.each(["sent", "queued", "failed", "undelivered"])("never regresses a delivered alert to %s", async (status) => {
  alert!.status = "delivered";
  m.fetch.mockResolvedValue(providerMessage({ status }));
  expect((await POST(request())).status).toBe(204);
  expect(updates()).toHaveLength(0);
  expect(m.notify).not.toHaveBeenCalled();
});

it("protects a concurrently delivered row even when its initial read was accepted", async () => {
  m.fetch.mockResolvedValue(providerMessage({ status: "sent" }));
  expect((await POST(request())).status).toBe(204);
  expect(updates()[0].url.searchParams.get("status")).toBe("neq.delivered");
  expect(updates()[0].body).toMatchObject({ status: "accepted", completed_at: null });
});

it("records authoritative failure and points its notification at the original inbox message", async () => {
  m.fetch.mockResolvedValue(providerMessage({ status: "undelivered", errorCode: 30007 }));
  expect((await POST(request({ status: "delivered" }))).status).toBe(204);
  expect(updates()[0].body).toMatchObject({ status: "failed", provider_status: "undelivered", error_code: "30007" });
  expect(m.notify).toHaveBeenCalledWith(expect.objectContaining({ eventType: "owner_sms_alert_failed", actionUrl: `/messages?message=${sourceSid}` }));
});

it("does not issue a false failure notice when a concurrent delivery leaves zero changed rows", async () => {
  updatedRows = [];
  m.fetch.mockResolvedValue(providerMessage({ status: "undelivered", errorCode: 30007 }));
  expect((await POST(request())).status).toBe(204);
  expect(updates()).toHaveLength(1);
  expect(updates()[0].url.searchParams.get("status")).toBe("neq.delivered");
  expect(updates()[0].url.searchParams.get("select")).toBe("id");
  expect(m.notify).not.toHaveBeenCalled();
});

it.each(["tenant", "read", "provider", "write", "configuration"])("returns a retryable 503 for %s failure", async (stage) => {
  if (stage === "tenant") m.tenant.mockRejectedValue(Error("unavailable"));
  if (stage === "read") readError = true;
  if (stage === "provider") m.fetch.mockRejectedValue(Error("unavailable"));
  if (stage === "write") updateError = true;
  if (stage === "configuration") m.recipients.mockImplementation(() => { throw Error("unconfigured"); });
  expect((await POST(request())).status).toBe(503);
  expect(m.notify).not.toHaveBeenCalled();
});
