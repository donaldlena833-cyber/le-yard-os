import { describe, expect, it } from "vitest";
import { defaultMusicSchedule, latestMusicEvent, musicScheduleSettings, playlistUri } from "@/lib/integrations/music-schedule";
const settings = { ...defaultMusicSchedule, enabled: true };
describe("New York music schedule", () => {
  it.each(["2026-11-25T11:30:00Z", "2026-07-25T10:30:00Z"])("starts at 6:30 across UTC offsets: %s", (time) => {
    expect(latestMusicEvent(settings, new Date(time))).toMatchObject({ action: "play", ageMinutes: 0 });
  });
  it("stops at 5pm and never resumes during off hours", () => {
    expect(latestMusicEvent(settings, new Date("2026-11-25T22:00:00Z"))).toMatchObject({ action: "pause", ageMinutes: 0 });
    expect(latestMusicEvent(settings, new Date("2026-11-26T08:00:00Z"))).toMatchObject({ action: "pause", ageMinutes: 600 });
  });
  it("honors selected weekdays", () => {
    expect(latestMusicEvent({ ...settings, days: [1] }, new Date("2026-11-25T11:30:00Z"))).toMatchObject({ key: "2026-11-23T17:00:pause" });
  });
  it("stops an overnight Monday session on Tuesday", () => {
    const overnight = { ...settings, days: [1], start: "22:00", stop: "02:00" };
    expect(latestMusicEvent(overnight, new Date("2026-11-24T06:00:00Z"))).toMatchObject({ key: "2026-11-23T22:00:play", ageMinutes: 180 });
    expect(latestMusicEvent(overnight, new Date("2026-11-24T07:00:00Z"))).toMatchObject({ key: "2026-11-24T02:00:pause", ageMinutes: 0 });
  });
  it("deduplicates the repeated fall-back minute", () => {
    const early = { ...settings, start: "01:30", stop: "17:00" };
    expect(latestMusicEvent(early, new Date("2026-11-01T05:30:00Z"))?.key).toEqual(latestMusicEvent(early, new Date("2026-11-01T06:30:00Z"))?.key);
  });
  it("does not replay the previous stop when autumn clocks move backward", () => {
    const early = { ...settings, start: "01:30", stop: "17:00" };
    expect(latestMusicEvent(early, new Date("2026-11-01T06:05:00Z"))).toMatchObject({ key: "2026-11-01T01:30:play", ageMinutes: 35 });
  });
  it("shifts nonexistent spring hours forward by the DST gap", () => {
    const early = { ...settings, start: "02:30", stop: "17:00" };
    expect(latestMusicEvent(early, new Date("2026-03-08T07:30:00Z"))).toMatchObject({ key: "2026-03-08T02:30:play", ageMinutes: 0 });
  });
  it("rejects empty days, equal hours, and invalid playlists", () => {
    expect(musicScheduleSettings.safeParse({ ...settings, days: [] }).success).toBe(false);
    expect(musicScheduleSettings.safeParse({ ...settings, stop: settings.start }).success).toBe(false);
    expect(() => playlistUri("https://evil.test/playlist/123")).toThrow();
    expect(playlistUri("https://open.spotify.com/playlist/1234567890123456789012?si=abc")).toBe("spotify:playlist:1234567890123456789012");
  });
});
