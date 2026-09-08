import { afterEach, beforeEach, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({
  access: vi.fn(),
  status: vi.fn(),
  worker: vi.fn(),
  after: vi.fn(),
}));
vi.mock("next/server", () => ({ after: mocks.after }));
vi.mock("@/lib/phone-access.server", () => ({
  requirePhoneAccess: mocks.access,
}));
vi.mock("@/lib/sms-ai-pilot.server", () => ({
  smsPilotStatus: mocks.status,
  processSmsPilotQueue: mocks.worker,
}));
import { GET, POST } from "@/app/api/communications/pilot/route";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://operations.leyardny.com");
  mocks.access.mockResolvedValue({
    identity: { userId: "11111111-1111-4111-8111-111111111111" },
  });
  mocks.status.mockResolvedValue({ enabled: true });
});
afterEach(() => vi.unstubAllEnvs());
it("requires authenticated phone access for status", async () => {
  mocks.access.mockRejectedValue(new Response("Unauthorized", { status: 401 }));
  expect((await GET()).status).toBe(401);
  expect(mocks.status).not.toHaveBeenCalled();
});
it("does not cache private status", async () => {
  expect((await GET()).headers.get("cache-control")).toBe("private, no-store");
});
it.each(["https://elsewhere.example", null])(
  "rejects queue requests from origin %s",
  async (origin) => {
    const headers = origin ? { origin } : undefined;
    expect(
      (
        await POST(
          new Request(
            "https://operations.leyardny.com/api/communications/pilot",
            { method: "POST", headers },
          ),
        )
      ).status,
    ).toBe(403);
    expect(mocks.after).not.toHaveBeenCalled();
  },
);
it("rejects identities outside the two pilot owners", async () => {
  mocks.access.mockResolvedValue({
    identity: { userId: "33333333-3333-4333-8333-333333333333" },
  });
  expect(
    (
      await POST(
        new Request(
          "https://operations.leyardny.com/api/communications/pilot",
          {
            method: "POST",
            headers: { origin: "https://operations.leyardny.com" },
          },
        ),
      )
    ).status,
  ).toBe(403);
  expect(mocks.after).not.toHaveBeenCalled();
});
it("schedules bounded processing after an authorized response", async () => {
  expect(
    (
      await POST(
        new Request(
          "https://operations.leyardny.com/api/communications/pilot",
          {
            method: "POST",
            headers: { origin: "https://operations.leyardny.com" },
          },
        ),
      )
    ).status,
  ).toBe(202);
  expect(mocks.after).toHaveBeenCalledWith(mocks.worker);
});
