import { z } from "zod";
import { musicScheduleSettings, musicScheduleView } from "./music-schedule";

export const MUSIC_DEVICE_NAME = "Le Yard";
export const musicRequest = z.discriminatedUnion("action", [
  z.object({ action: z.literal("status") }).strict(),
  z.object({ action: z.literal("play") }).strict(),
  z.object({ action: z.literal("pause") }).strict(),
  z.object({ action: z.literal("volume"), volume: z.number().int().min(0).max(100) }).strict(),
  z.object({ action: z.literal("disconnect") }).strict(),
  z.object({ action: z.literal("save_schedule"), schedule: musicScheduleSettings }).strict(),
  z.object({ action: z.literal("connect"), clientId: z.string().regex(/^[a-f0-9]{32}$/) }).strict(),
]);
export type MusicRequest = z.infer<typeof musicRequest>;
export const musicSnapshot = z.object({
  status: z.enum(["setup_needed", "disconnected", "connected", "reconnect", "unavailable"]),
  checkedAt: z.string().datetime(),
  device: z.object({ available: z.boolean(), active: z.boolean(), restricted: z.boolean(), volume: z.number().int().min(0).max(100).nullable() }),
  playing: z.boolean(),
  track: z.object({ name: z.string(), artist: z.string(), url: z.string().url().nullable() }).nullable(),
  otherDevicePlaying: z.boolean(),
  message: z.string(),
  clientId: z.string().nullable(),
  schedule: musicScheduleView.optional(),
  result: z.enum(["confirmed", "accepted", "none"]).default("none"),
});
export type MusicSnapshot = z.infer<typeof musicSnapshot>;

export type SpotifyDevice = { id: string | null; name: string; type: string; is_active: boolean; is_restricted: boolean; volume_percent: number | null; supports_volume?: boolean };
export type SpotifyPlayback = { device?: SpotifyDevice; is_playing?: boolean; item?: { name?: string; artists?: { name: string }[]; external_urls?: { spotify?: string } } | null };

export function targetMusicDevice(devices: SpotifyDevice[]) {
  const matches = devices.filter((device) => device.name === MUSIC_DEVICE_NAME && device.type.toLowerCase() === "speaker" && device.id);
  // Duplicate names are ambiguous: never fall back to another speaker or a phone.
  return matches.length === 1 ? matches[0] : null;
}

export function projectMusicPlayback(devices: SpotifyDevice[], playback: SpotifyPlayback | null) {
  const target = targetMusicDevice(devices);
  const active = Boolean(target && playback?.device?.id === target.id);
  const rawUrl = active ? playback?.item?.external_urls?.spotify : undefined;
  const url = rawUrl && /^https:\/\/open\.spotify\.com\/(track|episode)\/[A-Za-z0-9]+$/.test(rawUrl) ? rawUrl : null;
  return {
    device: { available: Boolean(target), active, restricted: target?.is_restricted ?? false, volume: target?.volume_percent ?? null },
    playing: active && playback?.is_playing === true,
    track: active && playback?.item?.name ? { name: playback.item.name, artist: playback.item.artists?.map((artist) => artist.name).join(", ") ?? "", url } : null,
    otherDevicePlaying: Boolean(playback?.is_playing && !active),
  };
}
