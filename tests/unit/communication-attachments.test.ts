import { beforeEach, expect, it, vi } from "vitest";
const m = vi.hoisted(() => ({ access: vi.fn(), upload: vi.fn() }));
vi.mock("@/lib/phone-access.server", () => ({ requirePhoneAccess: m.access }));
vi.mock("@/lib/supabase/admin", () => ({
  createAdminClient: () => ({
    storage: { from: () => ({ upload: m.upload }) },
  }),
}));
import { POST } from "@/app/api/phone/attachments/route";
const origin = "https://operations.leyardny.com";
function request(file: File, source = origin) {
  const form = new FormData();
  form.set("file", file);
  return new Request(origin + "/api/phone/attachments", {
    method: "POST",
    headers: { origin: source },
    body: form,
  });
}
const png = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0,
]);
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("NEXT_PUBLIC_APP_URL", origin);
  m.access.mockResolvedValue({
    organization: { id: "org" },
    identity: { userId: "owner" },
  });
  m.upload.mockResolvedValue({ error: null });
});
it("places a verified image in private storage within the current operator scope", async () => {
  const r = await POST(
    request(new File([png], "shift.png", { type: "image/png" })),
  );
  expect(r.status).toBe(201);
  expect((await r.json()).path).toMatch(/^org\/owner\/[0-9a-f-]+\.png$/);
  expect(m.upload.mock.calls[0][2]).toEqual({
    contentType: "image/png",
    upsert: false,
  });
});
it("rejects a disguised HTML file before storing it", async () => {
  expect(
    (
      await POST(
        request(
          new File(["<script>alert(1)</script>"], "bad.png", {
            type: "image/png",
          }),
        ),
      )
    ).status,
  ).toBe(400);
  expect(m.upload).not.toHaveBeenCalled();
});
it("rejects oversized media before parsing or storing it", async () => {
  expect(
    (
      await POST(
        request(
          new File([new Uint8Array(4_200_000)], "large.png", {
            type: "image/png",
          }),
        ),
      )
    ).status,
  ).toBe(413);
  expect(m.upload).not.toHaveBeenCalled();
});
it("enforces origin and owner authorization before reading image bytes", async () => {
  expect(
    (
      await POST(
        request(
          new File([png], "ok.png", { type: "image/png" }),
          "https://other.test",
        ),
      )
    ).status,
  ).toBe(403);
  expect(m.access).not.toHaveBeenCalled();
  m.access.mockRejectedValue(new Response("Forbidden", { status: 403 }));
  expect(
    (await POST(request(new File([png], "ok.png", { type: "image/png" }))))
      .status,
  ).toBe(403);
  expect(m.upload).not.toHaveBeenCalled();
});
