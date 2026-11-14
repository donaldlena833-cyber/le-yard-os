import { afterEach, describe, expect, it, vi } from "vitest";
import { cateringInquirySchema } from "@/lib/catering-inquiry";
import { receiveCateringInquiry } from "@/lib/catering-receiver.server";
const key = "local-test-only-".padEnd(48, "x");
const id = "11111111-1111-4111-8111-111111111111";
const body = {
  audience: "corporate",
  contactName: "Example Guest",
  email: "guest@example.com",
  occasion: "Team gathering",
  source: "direct",
  channel: "website",
  purpose: "catering_service_inquiry",
  noticeVersion: "catering-2026-10-21",
  emailMarketingConsent: false,
  smsMarketingConsent: false,
  profileConsent: false,
};
function request(value: unknown = body, headers = {}) {
  return new Request("https://os.example/api/v1/catering-inquiries", {
    method: "POST",
    headers: {
      authorization: `Bearer ${key}`,
      "content-type": "application/json",
      "idempotency-key": id,
      ...headers,
    },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}
function setup() {
  const authenticate = vi.fn().mockResolvedValue({ data: { id }, error: null });
  const capture = vi
    .fn()
    .mockResolvedValue({
      data: { status: "accepted", stored: true, inquiryId: id },
      error: null,
    });
  return { authenticate, capture };
}
afterEach(() => vi.unstubAllEnvs());
describe("catering service receiver", () => {
  it("does not access credentials or storage while disabled", async () => {
    const store = vi.fn();
    const r = await receiveCateringInquiry(request(), {
      enabled: false,
      store,
    });
    expect(r.status).toBe(503);
    expect(store).not.toHaveBeenCalled();
  });
  it("requires a separate valid catering client before reading a brief", async () => {
    const store = setup();
    expect(
      (
        await receiveCateringInquiry(
          request(body, { authorization: "Bearer booking-key" }),
          { enabled: true, store: () => store },
        )
      ).status,
    ).toBe(401);
    expect(store.authenticate).not.toHaveBeenCalled();
    store.authenticate.mockResolvedValue({ data: null, error: null });
    expect(
      (
        await receiveCateringInquiry(request(), {
          enabled: true,
          store: () => store,
        })
      ).status,
    ).toBe(401);
    expect(store.capture).not.toHaveBeenCalled();
    expect(store.authenticate.mock.calls[0][0]).toMatch(/^[0-9a-f]{64}$/);
  });
  it.each(["corporate", "private_party"])(
    "accepts %s with undecided event details and no signup",
    async (audience) => {
      const store = setup();
      const r = await receiveCateringInquiry(request({ ...body, audience }), {
        enabled: true,
        store: () => store,
      });
      expect(r.status).toBe(201);
      expect((await r.json()).data).toEqual({
        status: "accepted",
        stored: true,
        inquiryId: id,
      });
      const payload = store.capture.mock.calls[0][2];
      expect(payload.guestCount).toBeNull();
      expect(payload.eventDate).toBe("");
      expect(payload.emailMarketingConsent).toBe(false);
      expect(payload.profileConsent).toBe(false);
    },
  );
  it.each([
    { emailMarketingConsent: true },
    { profileConsent: true },
    { extra: "unknown" },
    { eventDate: "2027-02-30" },
    { guestCount: 1.5 },
    { notes: "x".repeat(1201) },
  ])("rejects unsupported consent or event data: %j", async (extra) => {
    const store = setup();
    const r = await receiveCateringInquiry(request({ ...body, ...extra }), {
      enabled: true,
      store: () => store,
    });
    expect(r.status).toBe(400);
    expect(store.capture).not.toHaveBeenCalled();
  });
  it("bounds even chunked bodies and leaves receiver storage untouched", async () => {
    const store = setup();
    const r = await receiveCateringInquiry(request(" ".repeat(16385)), {
      enabled: true,
      store: () => store,
    });
    expect(r.status).toBe(413);
    expect(store.capture).not.toHaveBeenCalled();
  });
  it.each([
    ["23505", "private conflict details", 409],
    ["22023", "bad input", 400],
    ["28000", "revoked", 401],
    ["P0001", "catering_rate_limited", 429],
    ["08006", "private database details", 503],
  ])(
    "maps database %s without exposing internal text",
    async (code, message, status) => {
      const store = setup();
      store.capture.mockResolvedValue({ data: null, error: { code, message } });
      const r = await receiveCateringInquiry(request(), {
        enabled: true,
        store: () => store,
      });
      expect(r.status).toBe(status);
      const responseText = await r.text();
      expect(responseText).not.toContain("private");
    },
  );
  it("does not mistake a successful RPC response for a durable record", async () => {
    const store = setup();
    store.capture.mockResolvedValue({ data: { ok: true }, error: null });
    expect(
      (
        await receiveCateringInquiry(request(), {
          enabled: true,
          store: () => store,
        })
      ).status,
    ).toBe(503);
  });
  it("normalizes contacts and removes stale company data from private celebrations", () => {
    const parsed = cateringInquirySchema.parse({
      ...body,
      audience: "private_party",
      company: "Old company",
      email: " Guest@Example.com ",
    });
    expect(parsed.email).toBe("guest@example.com");
    expect(parsed.company).toBe("");
  });
});
