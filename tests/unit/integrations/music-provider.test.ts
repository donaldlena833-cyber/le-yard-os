import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ read: vi.fn(), grant: vi.fn(), claim: vi.fn(), save: vi.fn(), release: vi.fn(), disconnect: vi.fn() }));
vi.mock("@/lib/integrations/music-store.server", () => ({
  readMusicConnection: mocks.read, readMusicGrant: mocks.grant, claimMusicRefresh: mocks.claim,
  saveMusicGrant: mocks.save, releaseMusicRefresh: mocks.release, disconnectMusic: mocks.disconnect,
  MusicStoreError: class MusicStoreError extends Error {},
}));
import { MusicStoreError } from "@/lib/integrations/music-store.server";
import { runMusicRequest } from "@/lib/integrations/music.server";
import { sealMusicValue } from "@/lib/integrations/music-crypto.server";
const scope = { organizationId: "org", locationId: "room", userId: "actor" };
const device = { id: "speaker", name: "Le Yard", type: "Speaker", is_active: true, is_restricted: false, volume_percent: 70 };
const fetcher = vi.fn();
function player(volume = 70, activeDevice = "speaker", restricted = false) {
  return (url: string, init?: RequestInit) => {
    if (init?.method === "PUT") return Promise.resolve(new Response(null, { status: 204 }));
    return Promise.resolve(Response.json(url.endsWith("/devices") ? { devices: [{ ...device, volume_percent: volume, is_restricted: restricted }] }
      : { device: { ...device, id: activeDevice }, is_playing: true, item: { name: "Track" } }));
  };
}
beforeEach(() => {
  vi.clearAllMocks();
  vi.stubEnv("MUSIC_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
  vi.stubGlobal("fetch", fetcher);
  mocks.read.mockResolvedValue({ id: "connection", configuration: { clientId: "a".repeat(32) } });
  mocks.grant.mockResolvedValue(sealMusicValue({ accessToken: "test-token", refreshToken: "test-refresh", expiresAt: Date.now() + 3600_000 }, "org:room"));
  mocks.claim.mockRejectedValue(new MusicStoreError("Spotify connection is refreshing. Try again shortly."));
});
afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });

describe("music provider command safety", () => {
  it("does not interrupt another active device", async () => {
    fetcher.mockImplementation(player(70, "phone"));
    const result = await runMusicRequest(scope, { action: "play" });
    expect(result.status).toBe("unavailable"); expect(result.message).toContain("another device");
    expect(fetcher.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });
  it("refuses restricted speakers without sending a command", async () => {
    fetcher.mockImplementation(player(70, "speaker", true));
    expect((await runMusicRequest(scope, { action: "pause" })).message).toContain("restricted");
    expect(fetcher.mock.calls.every(([, init]) => init.method === "GET")).toBe(true);
  });
  it("targets the freshly discovered speaker and confirms reported volume", async () => {
    let changed = false;
    fetcher.mockImplementation((url: string, init: RequestInit) => {
      if (init.method === "PUT") { changed = true; return new Response(null, { status: 204 }); }
      return player(changed ? 85 : 70)(url, init);
    });
    const result = await runMusicRequest(scope, { action: "volume", volume: 85 });
    expect(fetcher.mock.calls.find(([, init]) => init.method === "PUT")?.[0]).toBe("https://api.spotify.com/v1/me/player/volume?device_id=speaker&volume_percent=85");
    expect(result.result).toBe("confirmed"); expect(result.device.volume).toBe(85);
  });
  it("does not call an accepted command confirmed when the reported setting did not change", async () => {
    fetcher.mockImplementation(player());
    const result = await runMusicRequest(scope, { action: "volume", volume: 85 });
    expect(result.result).toBe("accepted"); expect(result.device.volume).toBe(70);
  });
  it("fails closed when another server holds the token refresh lease", async () => {
    mocks.grant.mockResolvedValue(sealMusicValue({ accessToken: "expired", refreshToken: "test-refresh", expiresAt: 1 }, "org:room"));
    const result = await runMusicRequest(scope, { action: "status" });
    expect(result.message).toContain("refreshing"); expect(fetcher).not.toHaveBeenCalled();
  });
});
