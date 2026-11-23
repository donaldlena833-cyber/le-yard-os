import { NextRequest } from "next/server";
import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), scope: vi.fn(), save: vi.fn(), validate: vi.fn() }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/data/read-models/church-music.server", () => ({ verifyChurchMusicScope: mocks.scope }));
vi.mock("@/lib/integrations/music.server", () => ({ saveMusicAuthorization: mocks.save, MusicError: class extends Error {} }));
vi.mock("@/lib/integrations/music-store.server", () => ({ MusicStoreError: class extends Error {} }));
vi.mock("@/lib/integrations/music-oauth.server", () => ({
  MUSIC_OAUTH_COOKIE: "__Host-le-yard-music-link", musicCookieOptions: { secure: true, httpOnly: true, sameSite: "lax", path: "/", maxAge: 600 },
  musicRedirectUri: () => "https://operations.leyardny.com/api/workspace/music/callback", validateMusicOAuth: mocks.validate,
}));
import { GET } from "@/app/api/workspace/music/callback/route";
import { MusicStoreError } from "@/lib/integrations/music-store.server";
const context = { organization: { id: "org" }, activeLocation: { id: "room" }, identity: { userId: "owner" } };
function request(cookie = true) {
  return new NextRequest("https://operations.leyardny.com/api/workspace/music/callback?code=private-test-code&state=test-state", {
    headers: cookie ? { cookie: "__Host-le-yard-music-link=encrypted-cookie" } : {},
  });
}
beforeEach(() => {
  vi.clearAllMocks(); mocks.session.mockResolvedValue({ status: "ready", context }); mocks.scope.mockResolvedValue(true);
  mocks.validate.mockReturnValue({ clientId: "a".repeat(32), verifier: "private-test-verifier" }); mocks.save.mockResolvedValue(undefined);
});
describe("music OAuth callback", () => {
  it("saves an approved actor-bound grant and removes state from the browser", async () => {
    const response = await GET(request());
    expect(response.headers.get("location")).toBe("https://operations.leyardny.com/music?connection=linked");
    expect(mocks.save).toHaveBeenCalledWith({ organizationId: "org", locationId: "room", userId: "owner" }, "a".repeat(32), "private-test-code", "private-test-verifier", "https://operations.leyardny.com/api/workspace/music/callback");
    expect(response.headers.get("set-cookie")).toContain("Max-Age=0");
  });
  it("does not exchange a code if the initiating state cookie is missing", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try { expect((await GET(request(false))).headers.get("location")).toContain("connection=failed"); expect(mocks.save).not.toHaveBeenCalled(); }
    finally { warn.mockRestore(); }
  });
  it("provides safe stage diagnostics without copying authorization secrets", async () => {
    mocks.save.mockRejectedValue(new MusicStoreError("Music connection changed. Try connecting again."));
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    try {
      const response = await GET(request());
      expect(response.headers.get("location")).toBe("https://operations.leyardny.com/music?connection=failed");
      expect(warn).toHaveBeenCalledWith("music_oauth_failed", { stage: "authorization_save", reason: "Music connection changed. Try connecting again." });
      expect(JSON.stringify(warn.mock.calls)).not.toContain("private-test-code");
      expect(JSON.stringify(warn.mock.calls)).not.toContain("private-test-verifier");
    } finally { warn.mockRestore(); }
  });
});
