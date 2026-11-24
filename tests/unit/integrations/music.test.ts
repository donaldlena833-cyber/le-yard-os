import { afterEach, describe, expect, it, vi } from "vitest";
import { musicRequest, projectMusicPlayback, targetMusicDevice, type SpotifyDevice } from "@/lib/integrations/music";
import { beginMusicOAuth, validateMusicOAuth } from "@/lib/integrations/music-oauth.server";
import { openMusicValue, sealMusicValue } from "@/lib/integrations/music-crypto.server";

const scope = { organizationId: "00000000-0000-4000-8000-000000000001", locationId: "00000000-0000-4000-8000-000000000002", userId: "00000000-0000-4000-8000-000000000003" };
const device: SpotifyDevice = { id: "speaker", name: "Le Yard", type: "Speaker", is_active: true, is_restricted: false, volume_percent: 85 };
afterEach(() => vi.unstubAllEnvs());

describe("music target and private playback projection", () => {
  it("does not choose a phone, renamed speaker, or duplicate speaker name", () => {
    expect(targetMusicDevice([{ ...device, type: "Smartphone" }])).toBeNull();
    expect(targetMusicDevice([{ ...device, name: "Other room" }])).toBeNull();
    expect(targetMusicDevice([device, { ...device, id: "second" }])).toBeNull();
  });
  it("does not expose music from another device", () => {
    const projected = projectMusicPlayback([device], { device: { ...device, id: "phone" }, is_playing: true, item: { name: "Private track" } });
    expect(projected.track).toBeNull(); expect(projected.playing).toBe(false); expect(projected.otherDevicePlaying).toBe(true);
  });
  it("reports Spotify metadata only for the exact target and rejects untrusted links", () => {
    const projected = projectMusicPlayback([device], { device, is_playing: true, item: { name: "Track", artists: [{ name: "Artist" }], external_urls: { spotify: "https://malicious.invalid" } } });
    expect(projected.playing).toBe(true); expect(projected.track).toEqual({ name: "Track", artist: "Artist", url: null });
  });
  it("accepts only bounded controls with no device or tenant override", () => {
    expect(musicRequest.safeParse({ action: "volume", volume: 101 }).success).toBe(false);
    expect(musicRequest.safeParse({ action: "play", deviceId: "phone" }).success).toBe(false);
    expect(musicRequest.safeParse({ action: "status", organizationId: "another" }).success).toBe(false);
    expect(musicRequest.safeParse({ action: "volume", volume: 85 }).success).toBe(true);
  });
});
describe("music OAuth and encrypted custody", () => {
  function setup() {
    vi.stubEnv("MUSIC_TOKEN_ENCRYPTION_KEY", Buffer.alloc(32, 3).toString("base64"));
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://operations.leyardny.com");
    return beginMusicOAuth(scope, "a".repeat(32));
  }
  it("uses PKCE and binds the grant to the initiating operator and workspace", () => {
    const flow = setup(); const url = new URL(flow.url); const state = url.searchParams.get("state")!;
    expect(url.searchParams.get("code_challenge_method")).toBe("S256");
    expect(url.searchParams.get("scope")).toBe("user-read-playback-state user-modify-playback-state");
    expect(url.searchParams.get("redirect_uri")).toBe("https://operations.leyardny.com/api/workspace/music/callback");
    expect(validateMusicOAuth(flow.cookie, state, scope).clientId).toBe("a".repeat(32));
    expect(() => validateMusicOAuth(flow.cookie, state, { ...scope, userId: scope.locationId })).toThrow();
    expect(() => validateMusicOAuth(flow.cookie, state, { ...scope, locationId: scope.organizationId })).toThrow();
    expect(() => validateMusicOAuth(flow.cookie, "bad", scope)).toThrow();
    expect(() => validateMusicOAuth(flow.cookie, state, scope, Date.now() + 601_000)).toThrow();
  });
  it("rejects changed ciphertext and cross-location decryption", () => {
    setup(); const encrypted = sealMusicValue({ refreshToken: "secret-refresh" }, "org:room");
    expect(encrypted).not.toContain("secret-refresh");
    expect(openMusicValue(encrypted, "org:room")).toEqual({ refreshToken: "secret-refresh" });
    expect(() => openMusicValue(encrypted, "org:other")).toThrow();
    const bytes = Buffer.from(encrypted, "base64url"); bytes[30] ^= 1;
    expect(() => openMusicValue(bytes.toString("base64url"), "org:room")).toThrow();
  });
});
