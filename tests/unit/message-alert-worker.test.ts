import { afterEach, beforeEach, expect, it, vi } from "vitest";
import worker, { drain } from "../../workers/message-alerts/src/worker.mjs";

const secret = "unit-test-only-alert-secret-not-a-credential";
const processor = "https://phone.leyardny.com/api/internal/communications/owner-alerts";
const fetcher = vi.fn();

beforeEach(() => {
  fetcher.mockReset().mockResolvedValue(Response.json({ ok: true }));
  vi.stubGlobal("fetch", fetcher);
});
afterEach(() => vi.unstubAllGlobals());

it("keeps the public fetch endpoint inert even with valid worker configuration", async () => {
  // Cloudflare supplies request and env even though the handler needs neither.
  const handler = worker.fetch as (request: Request, env: unknown) => Response;
  for (const method of ["GET", "POST", "DELETE"]) {
    const response = handler(new Request("https://alerts.example.test/run?url=https://other.example.test", { method }), { OWNER_SMS_ALERTS_SECRET: secret });
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ service: "le-yard-message-alerts", ok: true });
  }
  expect(fetcher).not.toHaveBeenCalled();
});

it("schedules only a protected GET to the fixed Phone processor without following redirects", async () => {
  await worker.scheduled({}, { OWNER_SMS_ALERTS_SECRET: secret, PROCESSOR: "https://other.example.test" });
  expect(fetcher).toHaveBeenCalledTimes(1);
  expect(fetcher).toHaveBeenCalledWith(processor, {
    method: "GET",
    headers: { authorization: `Bearer ${secret}` },
    redirect: "manual",
    signal: expect.any(AbortSignal),
  });
});

it.each([undefined, "", "short"])("does not contact any processor without a valid secret: %j", async (value) => {
  await expect(drain({ OWNER_SMS_ALERTS_SECRET: value })).rejects.toThrow("not configured");
  expect(fetcher).not.toHaveBeenCalled();
});

it.each([302, 403, 503])("does not accept or follow a %s processor response", async (status) => {
  fetcher.mockResolvedValue(new Response(null, { status, headers: { location: "https://other.example.test" } }));
  await expect(worker.scheduled({}, { OWNER_SMS_ALERTS_SECRET: secret })).rejects.toThrow(`returned ${status}`);
  expect(fetcher).toHaveBeenCalledTimes(1);
});

it.each([{ ok: false }, {}, { ok: "true" }])("requires explicit processor acknowledgement: %j", async (body) => {
  fetcher.mockResolvedValue(Response.json(body));
  await expect(drain({ OWNER_SMS_ALERTS_SECRET: secret })).rejects.toThrow("not acknowledged");
});

it("propagates processor network failures to the scheduler", async () => {
  fetcher.mockRejectedValue(Error("network unavailable"));
  await expect(worker.scheduled({}, { OWNER_SMS_ALERTS_SECRET: secret })).rejects.toThrow("network unavailable");
});
