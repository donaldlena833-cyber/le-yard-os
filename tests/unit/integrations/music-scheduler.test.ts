import { beforeEach, describe, expect, it, vi } from "vitest";
import { defaultMusicSchedule } from "@/lib/integrations/music-schedule";
const mocks = vi.hoisted(() => ({ row: null as unknown, read: vi.fn(), cas: vi.fn(), run: vi.fn() }));
vi.mock("@/lib/integrations/music-store.server", () => ({ readMusicConnection: mocks.read, compareAndSetMusicConnection: mocks.cas, MusicStoreError: class extends Error {} }));
vi.mock("@/lib/integrations/music.server", () => ({ runMusicRequest: mocks.run }));
import { processMusicSchedule, saveMusicSchedule } from "@/lib/integrations/music-schedule.server";
import type { MusicConnection } from "@/lib/integrations/music-store.server";
const scope = { organizationId: "org", locationId: "room", userId: "owner" };
const now = new Date("2026-11-25T11:30:00Z");
const row = () => mocks.row as MusicConnection;
beforeEach(() => {
  vi.clearAllMocks();
  mocks.row = { id: "connection", configuration: { clientId: "a".repeat(32), grantVersion: "00000000-0000-4000-8000-000000000001", refreshLease: null, schedule: { ...defaultMusicSchedule, enabled: true } } };
  mocks.read.mockImplementation(async () => structuredClone(mocks.row));
  mocks.cas.mockImplementation(async (_scope, old, configuration) => {
    if (JSON.stringify(old) !== JSON.stringify(mocks.row)) throw new Error("concurrent change");
    mocks.row = { ...old, configuration }; return mocks.row;
  });
  mocks.run.mockResolvedValue({ result: "confirmed", message: "Spotify reports Le Yard playing." });
});
describe("hosted music runner", () => {
  it("executes a due start once, including the saved volume and playlist", async () => {
    await processMusicSchedule(scope, now);
    await processMusicSchedule(scope, now);
    expect(mocks.run).toHaveBeenCalledTimes(1);
    expect(mocks.run).toHaveBeenCalledWith(scope, { action: "play" }, { volume: 85, playlist: undefined });
    expect(row().configuration.scheduleRuntime?.result).toBe("confirmed");
  });
  it("only one concurrent runner acquires the command lease", async () => {
    const results = await Promise.allSettled([processMusicSchedule(scope, now), processMusicSchedule(scope, now)]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(mocks.run).toHaveBeenCalledTimes(1);
  });
  it("does not restart a missed morning more than 15 minutes late", async () => {
    await processMusicSchedule(scope, new Date("2026-11-25T12:00:00Z"));
    expect(mocks.run).not.toHaveBeenCalled();
    expect(row().configuration.scheduleRuntime?.result).toBe("missed");
  });
  it("retries failures at two minute intervals, with a five attempt limit", async () => {
    mocks.run.mockResolvedValue({ result: "none", message: "Speaker unavailable." });
    for (let minute = 0; minute <= 12; minute++) await processMusicSchedule(scope, new Date(now.getTime() + minute * 60000));
    expect(mocks.run).toHaveBeenCalledTimes(5);
    expect(row().configuration.scheduleRuntime?.message).toContain("retries ended");
  });
  it("stops late without issuing a play request", async () => {
    await processMusicSchedule(scope, new Date("2026-11-25T22:10:00Z"));
    expect(mocks.run).toHaveBeenCalledWith(scope, { action: "pause" }, undefined);
  });
  it("preserves a grant pointer rotated during the command", async () => {
    mocks.run.mockImplementation(async () => {
      mocks.row = { ...row(), configuration: { ...row().configuration, grantVersion: "00000000-0000-4000-8000-000000000002" } };
      return { result: "confirmed", message: "Playing." };
    });
    await processMusicSchedule(scope, now);
    expect(row().configuration.grantVersion).toBe("00000000-0000-4000-8000-000000000002");
    expect(row().configuration.scheduleRuntime?.lease).toBeNull();
  });
  it("saving applies future boundaries without an immediate command", async () => {
    await saveMusicSchedule(scope, { ...defaultMusicSchedule, enabled: true }, now);
    await processMusicSchedule(scope, now);
    expect(mocks.run).not.toHaveBeenCalled();
    expect(row().configuration.scheduleRuntime?.result).toBe("waiting");
  });
  it("disabled schedules never send playback commands", async () => {
    row().configuration.schedule!.enabled = false;
    await processMusicSchedule(scope, now);
    expect(mocks.run).not.toHaveBeenCalled();
  });
});
