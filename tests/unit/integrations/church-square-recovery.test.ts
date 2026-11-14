import { createHmac } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { POST } from "@/app/api/internal/integrations/church-square-recovery/route";
import { processChurchSquareReceipts } from "@/lib/integrations/church-square-event-worker.server";

const schedule = vi.hoisted(() => vi.fn());
vi.mock("next/server", () => ({ after: schedule }));
vi.mock("@/lib/integrations/church-square-event-worker.server", () => ({
  processChurchSquareReceipts: vi.fn(),
}));

const url = "https://operations.leyardny.com/api/internal/integrations/church-square-recovery";
const secret = "synthetic-church-recovery-key-32-bytes";

const now = "2026-11-14T12:00:00Z";
const currentEpoch = Date.parse(now) / 1_000;

function signedHeaders(epoch = String(currentEpoch), signingSecret = secret) {
  const signature = createHmac("sha256", signingSecret)
    .update(`le-yard-church-square-recovery/v1:${epoch}`, "utf8").digest("hex");
  return { "x-le-yard-epoch": epoch, "x-le-yard-recovery-signature": signature };
}

function request(body?: string, headers: Record<string, string> = signedHeaders(), destination = url) {
  return new Request(destination, {
    method: "POST",
    headers: { ...headers, "Content-Type": "application/json" },
    body,
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date(now));
  vi.stubEnv("VERCEL_ENV", "production");
  vi.stubEnv("LE_YARD_CHURCH_SQUARE_RECOVERY_SECRET", secret);
  vi.stubEnv("LE_YARD_CHURCH_SQUARE_ORDER_READ_ENABLED", "true");
  vi.stubEnv("SQUARE_CHURCH_ACCESS_TOKEN", "synthetic");
  vi.stubEnv("SQUARE_CHURCH_MERCHANT_ID", "MERCHANT_1");
  vi.stubEnv("SQUARE_CHURCH_LOCATION_ID", "CHURCH_1");
});

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
  vi.clearAllMocks();
});

describe("internal Church Street Square recovery trigger", () => {
  it.each([undefined, "{}"])("queues a single existing worker for an authorized request with %s body", async (body) => {
    const response = await POST(request(body));
    expect(response.status).toBe(202);
    expect(await response.text()).toBe("");
    expect(response.headers.get("cache-control")).toBe("no-store");
    expect(schedule).toHaveBeenCalledExactlyOnceWith(processChurchSquareReceipts);
    expect(processChurchSquareReceipts).not.toHaveBeenCalled();
  });

  it("rejects a missing, malformed, incorrect, or expired signature", async () => {
    expect((await POST(request(undefined, { Authorization: `Bearer ${secret}` }))).status).toBe(401);
    expect((await POST(request(undefined, signedHeaders(String(currentEpoch), "wrong-key")))).status).toBe(401);
    expect((await POST(request(undefined, signedHeaders("1")))).status).toBe(401);
    const headers = signedHeaders();
    expect((await POST(request(undefined, { ...headers,
      "x-le-yard-recovery-signature": headers["x-le-yard-recovery-signature"].toUpperCase(),
    }))).status).toBe(401);
    expect((await POST(request(undefined, signedHeaders(String(currentEpoch - 91))))).status).toBe(401);
    expect((await POST(request(undefined, signedHeaders(String(currentEpoch + 91))))).status).toBe(401);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("rejects locations, event IDs, trailing content and noncanonical requests", async () => {
    for (const body of ['{"location":"other"}', "[]", "{ }", "{}\n", "{"]) {
      expect((await POST(request(body))).status).toBe(400);
    }
    expect((await POST(request(undefined, undefined, `${url}?event_id=other`))).status).toBe(400);
    expect((await POST(request(undefined, undefined, url.replace("operations.", "host.")))).status).toBe(400);
    expect((await POST(new Request(url, {
      method: "POST",
      headers: { ...signedHeaders(), "Content-Length": "8192" },
    }))).status).toBe(400);
    expect(schedule).not.toHaveBeenCalled();
  });

  it("stays dark without a configured scoped worker, secret, or production environment", async () => {
    vi.stubEnv("LE_YARD_CHURCH_SQUARE_ORDER_READ_ENABLED", "false");
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("LE_YARD_CHURCH_SQUARE_ORDER_READ_ENABLED", "true");
    vi.stubEnv("LE_YARD_CHURCH_SQUARE_RECOVERY_SECRET", "");
    expect((await POST(request())).status).toBe(503);
    vi.stubEnv("LE_YARD_CHURCH_SQUARE_RECOVERY_SECRET", secret);
    vi.stubEnv("VERCEL_ENV", "preview");
    expect((await POST(request())).status).toBe(503);
    expect(schedule).not.toHaveBeenCalled();
  });
});
