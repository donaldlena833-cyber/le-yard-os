import "server-only";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { musicEncryptionReady, openMusicValue, sealMusicValue } from "./music-crypto.server";
import { projectMusicPlayback, targetMusicDevice, type MusicRequest, type MusicSnapshot } from "./music";

export type MusicScope = { organizationId: string; locationId: string; userId: string };
const deviceSchema = z.object({
  id: z.string().nullable(), name: z.string(), type: z.string(), is_active: z.boolean(),
  is_restricted: z.boolean(), volume_percent: z.number().int().min(0).max(100).nullable(), supports_volume: z.boolean().optional(),
});
const playbackSchema = z.object({ device: deviceSchema.optional(), is_playing: z.boolean().optional(),
  item: z.object({ name: z.string().optional(), artists: z.array(z.object({ name: z.string() })).optional(),
    external_urls: z.object({ spotify: z.string().optional() }).optional() }).nullable().optional() });
const grantSchema = z.object({ accessToken: z.string().min(1), refreshToken: z.string().min(1), expiresAt: z.number() });
type Grant = z.infer<typeof grantSchema>;
const tokenSchema = z.object({ access_token: z.string().min(1), refresh_token: z.string().min(1).optional(), expires_in: z.number().positive(), scope: z.string().optional() });
const purpose = (scope: MusicScope) => `${scope.organizationId}:${scope.locationId}`;
const SCOPES = ["user-read-playback-state", "user-modify-playback-state"];
export const MUSIC_SCOPES = SCOPES.join(" ");

export class MusicError extends Error {
  constructor(message: string, readonly reconnect = false) { super(message); }
}
function db() { return createAdminClient().from("music_connections"); }
async function connection(scope: MusicScope) {
  const result = await db().select("client_id, encrypted_grant, refresh_lease_until")
    .eq("organization_id", scope.organizationId).eq("location_id", scope.locationId).maybeSingle();
  if (result.error) throw new MusicError("Music connection could not be loaded. Try again.");
  return result.data;
}
async function tokenRequest(body: URLSearchParams) {
  const response = await fetch("https://accounts.spotify.com/api/token", {
    method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body,
    cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new MusicError(response.status === 400 || response.status === 401
    ? "Reconnect Spotify to restore access." : "Spotify could not refresh the connection. Try again.", response.status === 400 || response.status === 401);
  return tokenSchema.parse(await response.json());
}

export async function saveMusicAuthorization(scope: MusicScope, clientId: string, code: string, verifier: string, redirectUri: string) {
  const token = await tokenRequest(new URLSearchParams({ grant_type: "authorization_code", code, client_id: clientId, code_verifier: verifier, redirect_uri: redirectUri }));
  if (!token.refresh_token || !SCOPES.every((scope) => token.scope?.split(" ").includes(scope))) {
    throw new MusicError("Spotify did not grant the requested playback permissions.");
  }
  const grant: Grant = { accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + token.expires_in * 1000 };
  const result = await db().upsert({ organization_id: scope.organizationId, location_id: scope.locationId,
    client_id: clientId, encrypted_grant: sealMusicValue(grant, purpose(scope)), refresh_lease_until: null,
    connected_by: scope.userId, connected_at: new Date().toISOString() });
  if (result.error) throw new MusicError("Spotify authorization could not be saved. Try connecting again.");
}

async function accessToken(scope: MusicScope) {
  const row = await connection(scope);
  if (!row) return null;
  const oldGrant = grantSchema.parse(openMusicValue(row.encrypted_grant, purpose(scope)));
  if (oldGrant.expiresAt > Date.now() + 60_000) return oldGrant.accessToken;
  // A compare-and-set lease prevents two server instances rotating the same grant.
  const now = new Date();
  const leaseUntil = new Date(now.getTime() + 20_000).toISOString();
  const lease = await db().update({ refresh_lease_until: leaseUntil })
    .eq("organization_id", scope.organizationId).eq("location_id", scope.locationId)
    .eq("encrypted_grant", row.encrypted_grant)
    .or(`refresh_lease_until.is.null,refresh_lease_until.lt.${now.toISOString()}`)
    .select("organization_id").maybeSingle();
  if (lease.error || !lease.data) throw new MusicError("Spotify connection is refreshing. Try again shortly.");
  try {
    const token = await tokenRequest(new URLSearchParams({ grant_type: "refresh_token", refresh_token: oldGrant.refreshToken, client_id: row.client_id }));
    const grant: Grant = { accessToken: token.access_token, refreshToken: token.refresh_token ?? oldGrant.refreshToken, expiresAt: Date.now() + token.expires_in * 1000 };
    const saved = await db().update({ encrypted_grant: sealMusicValue(grant, purpose(scope)), refresh_lease_until: null })
      .eq("organization_id", scope.organizationId).eq("location_id", scope.locationId)
      .eq("encrypted_grant", row.encrypted_grant).eq("refresh_lease_until", leaseUntil).select("organization_id").maybeSingle();
    if (saved.error || !saved.data) throw new MusicError("Spotify connection changed. Refresh Music before continuing.");
    return grant.accessToken;
  } finally {
    await db().update({ refresh_lease_until: null }).eq("organization_id", scope.organizationId)
      .eq("location_id", scope.locationId).eq("refresh_lease_until", leaseUntil);
  }
}

export async function spotifyMusicRequest(token: string, path: string, method = "GET", body?: object) {
  const response = await fetch(`https://api.spotify.com/v1/me/player${path}`, {
    method, headers: { Authorization: `Bearer ${token}`, ...(body ? { "Content-Type": "application/json" } : {}) },
    ...(body ? { body: JSON.stringify(body) } : {}), cache: "no-store", redirect: "error", signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) {
    const message = response.status === 401 ? "Reconnect Spotify to restore playback access."
      : response.status === 403 ? "Spotify cannot control this session. Check Premium and playback permissions."
        : response.status === 404 ? "Le Yard could not be reached. Start Spotify on the Echo and refresh."
          : response.status === 429 ? "Spotify is busy. Wait a little before trying again."
            : "Spotify did not confirm the request. Refresh status before trying again.";
    throw new MusicError(message, response.status === 401);
  }
  return response.status === 204 ? null : await response.json();
}
async function readPlayer(token: string) {
  const [devices, playback] = await Promise.all([spotifyMusicRequest(token, "/devices"), spotifyMusicRequest(token, "")]);
  return { devices: z.object({ devices: z.array(deviceSchema) }).parse(devices).devices,
    playback: playback === null ? null : playbackSchema.parse(playback) };
}
function emptySnapshot(status: MusicSnapshot["status"], message: string, clientId: string | null = null): MusicSnapshot {
  return { status, message, clientId, checkedAt: new Date().toISOString(), device: { available: false, active: false, restricted: false, volume: null },
    playing: false, track: null, otherDevicePlaying: false, result: "none" };
}

export async function runMusicRequest(scope: MusicScope, input: Exclude<MusicRequest, { action: "connect" }>): Promise<MusicSnapshot> {
  if (!musicEncryptionReady()) return emptySnapshot("setup_needed", "The secure music connection is being prepared.");
  if (input.action === "disconnect") {
    const deleted = await db().delete().eq("organization_id", scope.organizationId).eq("location_id", scope.locationId);
    if (deleted.error) throw new MusicError("Spotify could not be disconnected. Try again.");
    return emptySnapshot("disconnected", "Spotify disconnected from Operations. Alexa and the existing Codex schedule are managed separately.");
  }
  let clientId: string | null = null;
  try {
    const row = await connection(scope);
    clientId = row?.client_id ?? null;
    const token = await accessToken(scope);
    if (!token) return emptySnapshot("disconnected", "Connect Spotify to check and control the Le Yard speaker.");
    const before = await readPlayer(token);
    let player = projectMusicPlayback(before.devices, before.playback);
    let result: MusicSnapshot["result"] = "none";
    let message = player.device.available ? "Status reported by Spotify." : "Le Yard is not visible to Spotify. This does not establish whether the Echo is offline.";
    if (input.action !== "status") {
      const target = targetMusicDevice(before.devices);
      if (!target?.id) throw new MusicError("A unique Le Yard speaker is not available. Start Spotify on the Echo and refresh.");
      if (target.is_restricted) throw new MusicError("Spotify has restricted controls for this speaker.");
      if (input.action === "play" && player.otherDevicePlaying) throw new MusicError("Spotify is playing on another device. Select Le Yard in Spotify before resuming here.");
      if (input.action === "volume" && target.supports_volume === false) throw new MusicError("Spotify cannot adjust this speaker’s volume.");
      const query = `device_id=${encodeURIComponent(target.id)}`;
      const alreadyPaused = input.action === "pause" && !player.playing;
      if (!alreadyPaused) {
        const path = input.action === "volume" ? `/volume?${query}&volume_percent=${input.volume}` : `/${input.action}?${query}`;
        // Never transfer playback, replace the music context, or address the account's default device.
        await spotifyMusicRequest(token, path, "PUT");
        result = "accepted";
        message = "Request sent to Spotify. Speaker confirmation is pending.";
        await new Promise((resolve) => setTimeout(resolve, 650));
        try {
          const after = await readPlayer(token);
          player = projectMusicPlayback(after.devices, after.playback);
        } catch {
          return { ...emptySnapshot("unavailable", "Request sent to Spotify, but the result could not be checked. Refresh before retrying.", clientId), result };
        }
      }
      if ((input.action === "play" && player.playing)
        || (input.action === "pause" && player.device.available && !player.playing)
        || (input.action === "volume" && player.device.volume === input.volume)) {
        result = "confirmed";
        message = input.action === "volume" ? `Spotify reports Le Yard at ${input.volume}%.`
          : input.action === "play" ? "Spotify reports Le Yard playing." : "Spotify reports no playback on Le Yard.";
      }
    }
    return { status: "connected", clientId, checkedAt: new Date().toISOString(), ...player, message, result };
  } catch (error) {
    const known = error instanceof MusicError;
    return emptySnapshot(known && error.reconnect ? "reconnect" : "unavailable",
      known ? error.message : "Music status could not be verified. Refresh before sending another command.", clientId);
  }
}
