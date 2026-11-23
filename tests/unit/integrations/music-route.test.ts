import { beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ session: vi.fn(), scope: vi.fn(), run: vi.fn(), oauth: vi.fn() }));
vi.mock("@/lib/auth/workspace-session", () => ({ resolveWorkspaceSession: mocks.session }));
vi.mock("@/data/read-models/church-music.server", () => ({ verifyChurchMusicScope: mocks.scope }));
vi.mock("@/lib/integrations/music.server", () => ({ runMusicRequest: mocks.run }));
vi.mock("@/lib/integrations/music-oauth.server", () => ({ beginMusicOAuth: mocks.oauth, MUSIC_OAUTH_COOKIE: "__Host-le-yard-music-link", musicCookieOptions: { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 } }));
import { POST } from "@/app/api/workspace/music/route";
const origin = "https://operations.leyardny.com";
const request = (body = '{"action":"status"}', from = origin) => new Request(`${origin}/api/workspace/music`, { method: "POST", headers: { origin: from, "Content-Type": "application/json" }, body });
beforeEach(() => {
  vi.clearAllMocks(); mocks.scope.mockResolvedValue(true);
  mocks.session.mockResolvedValue({ status: "ready", context: { organization: { id: "org" }, activeLocation: { id: "room" }, identity: { userId: "actor" } } });
  mocks.run.mockResolvedValue({ status: "connected" });
  mocks.oauth.mockReturnValue({ url: "https://accounts.spotify.com/authorize", cookie: "encrypted-state" });
});
describe("music route access boundary", () => {
  it("blocks cross-site requests before authentication or Spotify", async () => {
    expect((await POST(request(undefined, "https://other.invalid"))).status).toBe(403);
    expect(mocks.session).not.toHaveBeenCalled(); expect(mocks.run).not.toHaveBeenCalled();
  });
  it("requires session and exact Church Street owner/admin scope", async () => {
    mocks.session.mockResolvedValueOnce({ status: "unauthenticated" });
    expect((await POST(request())).status).toBe(401);
    mocks.scope.mockResolvedValue(false);
    expect((await POST(request())).status).toBe(403);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("rejects oversized streamed bodies and client-controlled tenant/device IDs", async () => {
    expect((await POST(request(" ".repeat(4097)))).status).toBe(413);
    expect((await POST(request('{"action":"play","deviceId":"phone"}'))).status).toBe(400);
    expect(mocks.run).not.toHaveBeenCalled();
  });
  it("derives scope from the session and prevents caching", async () => {
    const response = await POST(request('{"action":"volume","volume":85}'));
    expect(response.status).toBe(200); expect(response.headers.get("cache-control")).toContain("no-store");
    expect(mocks.run).toHaveBeenCalledWith({ organizationId: "org", locationId: "room", userId: "actor" }, { action: "volume", volume: 85 });
  });
  it("stores OAuth state only in a secure HttpOnly cookie", async () => {
    const response = await POST(request(JSON.stringify({ action: "connect", clientId: "a".repeat(32) })));
    expect(response.headers.get("set-cookie")).toContain("HttpOnly");
    expect(response.headers.get("set-cookie")).toContain("Secure");
    expect(await response.json()).toEqual({ authorizeUrl: "https://accounts.spotify.com/authorize" });
  });
});
