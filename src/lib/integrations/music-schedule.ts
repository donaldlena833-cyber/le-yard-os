import { z } from "zod";

export const MUSIC_TIME_ZONE = "America/New_York";
const clock = z.string().regex(/^(?:[01]\d|2[0-3]):[0-5]\d$/);
export const musicScheduleSettings = z.object({
  enabled: z.boolean(), start: clock, stop: clock,
  days: z.array(z.number().int().min(0).max(6)).min(1).max(7).refine((days) => new Set(days).size === days.length),
  volume: z.number().int().min(0).max(100),
  playlist: z.string().regex(/^spotify:playlist:[A-Za-z0-9]{22}$/).nullable(),
}).strict().refine((value) => value.start !== value.stop, { message: "Choose different start and end times.", path: ["stop"] });
export type MusicScheduleSettings = z.infer<typeof musicScheduleSettings>;
export const defaultMusicSchedule: MusicScheduleSettings = { enabled: false, start: "06:30", stop: "17:00", days: [0, 1, 2, 3, 4, 5, 6], volume: 85, playlist: null };
export const musicScheduleRuntime = z.object({
  checkedAt: z.string().datetime(), eventKey: z.string(), attempts: z.number().int().min(0),
  result: z.enum(["waiting", "confirmed", "accepted", "failed", "missed"]), message: z.string().max(500),
  attemptedAt: z.string().datetime().nullable(), lease: z.object({ id: z.string().uuid(), until: z.string().datetime() }).nullable(),
});
export type MusicScheduleRuntime = z.infer<typeof musicScheduleRuntime>;
export const musicScheduleView = z.object({ settings: musicScheduleSettings, runtime: musicScheduleRuntime.nullable(), configured: z.boolean() });

export function playlistUri(value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (/^spotify:playlist:[A-Za-z0-9]{22}$/.test(trimmed)) return trimmed;
  try {
    const url = new URL(trimmed);
    if (url.protocol === "https:" && url.hostname === "open.spotify.com" && /^\/playlist\/[A-Za-z0-9]{22}$/.test(url.pathname)) return `spotify:playlist:${url.pathname.split("/")[2]}`;
  } catch { /* Invalid user input. */ }
  throw new Error("Use a Spotify playlist link or leave it blank to resume the last session.");
}

const localClock = new Intl.DateTimeFormat("en-CA", { timeZone: MUSIC_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", hourCycle: "h23" });
function wallTimeEpoch(value: Date) {
  const parts = Object.fromEntries(localClock.formatToParts(value).map(({ type, value }) => [type, value]));
  return Date.parse(`${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:00Z`);
}
function boundaryInstant(wall: number) {
  // Offsets on either side of the boundary cover both DST transitions. Choose
  // the first occurrence in autumn; nonexistent spring hours move by the gap.
  const offsets = new Set([-86400000, 0, 86400000].map((delta) => wallTimeEpoch(new Date(wall + delta)) - (wall + delta)));
  const candidates = [...offsets].map((offset) => wall - offset).sort((a, b) => a - b);
  return candidates.find((candidate) => wallTimeEpoch(new Date(candidate)) === wall)
    ?? candidates.find((candidate) => wallTimeEpoch(new Date(candidate)) > wall)!;
}

export function latestMusicEvent(settings: MusicScheduleSettings, now = new Date()) {
  const localNow = wallTimeEpoch(now);
  const midnight = Math.floor(localNow / 86400000) * 86400000;
  const events: { key: string; action: "play" | "pause"; ageMinutes: number }[] = [];
  for (let offset = -8; offset <= 0; offset++) {
    const day = new Date(midnight + offset * 86400000);
    if (!settings.days.includes(day.getUTCDay())) continue;
    for (const action of ["play", "pause"] as const) {
      const time = action === "play" ? settings.start : settings.stop;
      const nextDay = action === "pause" && settings.stop < settings.start ? 86400000 : 0;
      const wall = Date.parse(`${day.toISOString().slice(0, 10)}T${time}:00Z`) + nextDay;
      const instant = boundaryInstant(wall);
      if (instant <= now.getTime()) events.push({ key: `${new Date(wall).toISOString().slice(0, 16)}:${action}`, action, ageMinutes: Math.floor((now.getTime() - instant) / 60000) });
    }
  }
  return events.sort((a, b) => a.ageMinutes - b.ageMinutes)[0] ?? null;
}
