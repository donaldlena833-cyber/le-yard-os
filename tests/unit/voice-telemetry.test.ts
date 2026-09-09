import { afterEach, describe, expect, it, vi } from "vitest";
vi.mock("@/lib/communications.server", () => ({ logCommunicationEvent: vi.fn() }));
import { logCommunicationEvent } from "@/lib/communications.server";
import { recordVoiceEvent } from "@/lib/voice-telemetry.server";
afterEach(() => { vi.useRealTimers(); vi.resetAllMocks(); });
describe("voice telemetry response budget", () => {
  it("returns within300ms when the database never responds", async () => {
    vi.useFakeTimers();
    vi.mocked(logCommunicationEvent).mockImplementation(() => new Promise(() => {}));
    let completed = false;
    const pending = recordVoiceEvent({ eventType: "voice.test", message: "Synthetic" }).then(() => { completed = true; });
    await vi.advanceTimersByTimeAsync(299);
    expect(completed).toBe(false);
    await vi.advanceTimersByTimeAsync(1);
    await pending;
    expect(completed).toBe(true);
  });
  it("contains database rejection without losing the call response", async () => {
    vi.mocked(logCommunicationEvent).mockRejectedValue(new Error("database unavailable"));
    await expect(recordVoiceEvent({ eventType: "voice.test", message: "Synthetic" })).resolves.toBeUndefined();
  });
});
