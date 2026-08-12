import { afterEach, describe, expect, it, vi } from "vitest";

const originalKey = process.env.RESEND_API_KEY;
const originalFrom = process.env.RESERVATION_EMAIL_FROM;

afterEach(() => {
  vi.unstubAllGlobals();
  if (originalKey === undefined) delete process.env.RESEND_API_KEY;
  else process.env.RESEND_API_KEY = originalKey;
  if (originalFrom === undefined) delete process.env.RESERVATION_EMAIL_FROM;
  else process.env.RESERVATION_EMAIL_FROM = originalFrom;
});

describe("email health route", () => {
  it("reports ready only when the configured sender domain is verified", async () => {
    process.env.RESEND_API_KEY = "re_test";
    process.env.RESERVATION_EMAIL_FROM =
      "Le Yard <reservations@send.donaldlena.com>";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        Response.json({
          data: [{ name: "send.donaldlena.com", status: "verified" }],
        }),
      ),
    );
    const { GET } = await import("@/app/api/health/email/route");
    const response = await GET();
    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ state: "ready" });
  });

  it("fails closed when delivery is not configured", async () => {
    delete process.env.RESEND_API_KEY;
    const { GET } = await import("@/app/api/health/email/route");
    const response = await GET();
    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toEqual({
      state: "not_configured",
    });
  });
});
