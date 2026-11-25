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
  it.each([200, 204])("checks reported state after a bodyless %i command response", async (status) => {
    let changed = false;
    fetcher.mockImplementation((url: string, init: RequestInit) => {
      if (init.method === "PUT") { changed = true; return new Response(null, { status }); }
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
  it("activates a visible inactive speaker before resuming its retained session", async () => {
    let active = false;
    let playing = false;
    fetcher.mockImplementation((url: string, init: RequestInit) => {
      if (init.method === "PUT") {
        if (url.endsWith("/me/player")) active = true;
        if (url.includes("/play?")) playing = true;
        return new Response(null, { status: 204 });
      }
      return Response.json(url.endsWith("/devices") ? { devices: [{ ...device, is_active: active }] }
        : active ? { device, is_playing: playing } : {});
    });
    const result = await runMusicRequest(scope, { action: "play" });
    expect(result.result).toBe("confirmed");
    const writes = fetcher.mock.calls.filter(([, init]) => init.method === "PUT");
    expect(JSON.parse(writes[0][1].body)).toEqual({ device_ids: ["speaker"], play: false });
    expect(writes[1][0]).toContain("/play?device_id=speaker");
  });
  it("can start the selected playlist when activation has no retained playback item", async () => {
    let active = false;
    let playing = false;
    fetcher.mockImplementation((url: string, init: RequestInit) => {
      if (init.method === "PUT") {
        if (url.endsWith("/me/player")) active = true;
        if (url.includes("/play?")) playing = true;
        return new Response(null, { status: 204 });
      }
      return Response.json(url.endsWith("/devices") ? { devices: [{ ...device, is_active: active }] }
        : playing ? { device, is_playing: true } : {});
    });
    const result = await runMusicRequest(scope, { action: "play" }, { playlist: "spotify:playlist:1234567890123456789012" });
    expect(result.result).toBe("confirmed");
    expect(JSON.parse(fetcher.mock.calls.find(([url, init]) => init.method === "PUT" && url.includes("/play?"))![1].body)).toEqual({ context_uri: "spotify:playlist:1234567890123456789012" });
  });
  it("does not restart the playlist when an already playing start is retried", async () => {
    fetcher.mockImplementation(player(85));
    const result = await runMusicRequest(scope, { action: "play" }, { volume: 85, playlist: "spotify:playlist:1234567890123456789012" });
    expect(result.result).toBe("confirmed");
    expect(fetcher.mock.calls.filter(([, init]) => init.method === "PUT").map(([url]) => url)).toEqual(["https://api.spotify.com/v1/me/player/volume?device_id=speaker&volume_percent=85"]);
  });
  it("fails closed when another server holds the token refresh lease", async () => {
    mocks.grant.mockResolvedValue(sealMusicValue({ accessToken: "expired", refreshToken: "test-refresh", expiresAt: 1 }, "org:room"));
    const result = await runMusicRequest(scope, { action: "status" });
    expect(result.message).toContain("refreshing"); expect(fetcher).not.toHaveBeenCalled();
  });
});
