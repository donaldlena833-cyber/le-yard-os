import { afterEach, describe, expect, it, vi } from "vitest";
const process = vi.hoisted(() => vi.fn());
vi.mock("@/lib/integrations/music-schedule.server", () => ({ processChurchMusicSchedules: process }));
import { POST } from "@/app/api/internal/music/schedule/route";
afterEach(() => { vi.unstubAllEnvs(); vi.clearAllMocks(); });
describe("music scheduler authentication", () => {
  it("rejects missing and invalid credentials before accessing music", async () => {
    vi.stubEnv("MUSIC_SCHEDULER_SECRET", "a".repeat(32));
    for (const authorization of ["", "Bearer wrong", `Bearer ${"é".repeat(32)}`]) {
      expect((await POST(new Request("https://operations.leyardny.com/api/internal/music/schedule", { method: "POST", headers: { authorization } }))).status).toBe(401);
    }
    expect(process).not.toHaveBeenCalled();
  });
  it("accepts the dedicated service secret and reports actual processing failure", async () => {
    vi.stubEnv("MUSIC_SCHEDULER_SECRET", "a".repeat(32));
    const request = () => new Request("https://operations.leyardny.com/api/internal/music/schedule", { method: "POST", headers: { authorization: `Bearer ${"a".repeat(32)}` } });
    expect((await POST(request())).status).toBe(200);
    process.mockRejectedValueOnce(new Error("test"));
    expect((await POST(request())).status).toBe(503);
  });
});
