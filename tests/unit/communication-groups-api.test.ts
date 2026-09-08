import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ access: vi.fn(), from: vi.fn(), mode: vi.fn() }));
vi.mock("@/lib/phone-access.server", () => ({ requirePhoneAccess: m.access }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({ from: m.from }),
}));
vi.mock("@/lib/communication-groups.server", () => ({
  setCommunicationThreadMode: m.mode,
}));
import { GET, POST } from "@/app/api/communications/groups/route";
const origin = "https://operations.leyardny.com";
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  m.access.mockResolvedValue({
    organization: { id: "org" },
    activeLocation: { id: "loc" },
    identity: { userId: "owner", displayName: "Owner" },
  });
  m.mode.mockResolvedValue(undefined);
});
it.each([401, 403])(
  "denies unauthorized history access with %s without reading records",
  async (status) => {
    m.access.mockRejectedValue(new Response("Denied", { status }));
    expect(
      (await GET(new Request(origin + "/api/communications/groups"))).status,
    ).toBe(status);
    expect(m.from).not.toHaveBeenCalled();
  },
);
it("rejects a phone filter that attempts to broaden the database query", async () => {
  expect(
    (
      await GET(
        new Request(
          origin +
            "/api/communications/groups?phone=%2B12125550123%2Cor%28id.neq.null%29",
        ),
      )
    ).status,
  ).toBe(400);
  expect(m.from).not.toHaveBeenCalled();
});
it("requires a same-origin signed-in operator to change handoff state", async () => {
  const payload = { action: "mode", phone: "+12125550123", mode: "automation" };
  const req = (source: string) =>
    new Request(origin + "/api/communications/groups", {
      method: "POST",
      headers: { origin: source },
      body: JSON.stringify(payload),
    });
  expect((await POST(req("https://other.test"))).status).toBe(403);
  expect(m.mode).not.toHaveBeenCalled();
  expect((await POST(req(origin))).status).toBe(200);
  expect(m.mode).toHaveBeenCalledWith(
    payload.phone,
    "automation",
    "Changed by an operator in Groups.",
  );
});
it("returns unavailable on database failure rather than an empty inbox", async () => {
  m.from.mockImplementation(() => {
    throw Error("database offline");
  });
  const r = await GET(new Request(origin + "/api/communications/groups"));
  expect(r.status).toBe(503);
  expect(await r.json()).not.toHaveProperty("messages");
});

it("scopes every history read and supports PostgreSQL timestamp offsets in keyset cursors", async () => {
  const { createClient } = await import("@supabase/supabase-js");
  const urls: string[] = [];
  const client = createClient("https://database.example.test", "fixture-key", {
    global: {
      fetch: async (input) => {
        urls.push(String(input));
        return Response.json([]);
      },
    },
    auth: { persistSession: false },
  });
  m.from.mockImplementation((table) => client.from(table));
  const q = new URLSearchParams({
    group: "clients",
    phone: "+12125550123",
    before: "2026-09-08T12:00:00+00:00",
    beforeSid: "SM" + "a".repeat(32),
  });
  expect(
    (await GET(new Request(origin + "/api/communications/groups?" + q))).status,
  ).toBe(200);
  expect(urls.length).toBe(3);
  for (const url of urls) {
    expect(new URL(url).searchParams.get("organization_id")).toBe("eq.org");
    expect(new URL(url).searchParams.get("location_id")).toBe("eq.loc");
  }
  const message = new URL(
    urls.find((u) => u.includes("/communication_messages"))!,
  );
  expect(message.searchParams.get("phone")).toBe("eq.+12125550123");
  expect(message.searchParams.get("or")).toContain("sid.lt.SM");
  expect(message.searchParams.get("limit")).toBe("101");
});
