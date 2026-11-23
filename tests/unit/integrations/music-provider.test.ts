import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const mocks = vi.hoisted(() => ({ row: null as unknown, lease: null as unknown, updates: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({ from: () => {
  let mutation = false;
  const query: Record<string, unknown> = {};
  for (const method of ["select", "eq", "or", "upsert", "delete"]) query[method] = () => query;
  query.update = (value: unknown) => { mutation = true; mocks.updates(value); return query; };
  query.maybeSingle = async () => ({ data: mutation ? mocks.lease : mocks.row, error: null });
  query.then = (resolve: (value: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(resolve);
  return query;
} }) }));
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
  mocks.row = { client_id: "a".repeat(32), encrypted_grant: sealMusicValue({ accessToken: "test-token", refreshToken: "test-refresh", expiresAt: Date.now() + 3600_000 }, "org:room") };
  mocks.lease = null;
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
    mocks.row = { client_id: "a".repeat(32), encrypted_grant: sealMusicValue({ accessToken: "expired", refreshToken: "test-refresh", expiresAt: 1 }, "org:room") };
    const result = await runMusicRequest(scope, { action: "status" });
    expect(result.message).toContain("refreshing"); expect(fetcher).not.toHaveBeenCalled();
  });
});
