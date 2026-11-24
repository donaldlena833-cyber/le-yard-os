// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MusicWorkspace } from "@/components/music/music-workspace";
import type { MusicSnapshot } from "@/lib/integrations/music";

const snapshot: MusicSnapshot = { status: "connected", checkedAt: "2026-11-23T19:00:00Z", device: { available: true, active: true, restricted: false, volume: 85 }, playing: true,
  track: { name: "Test Track", artist: "Test Artist", url: "https://open.spotify.com/track/abc" }, otherDevicePlaying: false, message: "Status reported by Spotify.", clientId: null, result: "none" };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("music workspace", () => {
  it("shows the actual speaker, reported volume and external schedule ownership", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(snapshot)));
    render(<MusicWorkspace />);
    expect(await screen.findByText("Test Track")).toBeTruthy();
    expect(screen.getByText("Reported: 85%")).toBeTruthy();
    expect(screen.getByText("6:30 a.m.")).toBeTruthy(); expect(screen.getByText("5:00 p.m.")).toBeTruthy();
    expect(screen.getByText("Managed by Codex · America/New_York")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Pause music" })).toHaveProperty("disabled", false);
    expect(screen.getByRole("button", { name: "Resume music" })).toHaveProperty("disabled", true);
  });
  it("clears stale music and disables controls after access is lost", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(snapshot)).mockResolvedValueOnce(Response.json({ message: "Forbidden" }, { status: 403 })));
    render(<MusicWorkspace />); await screen.findByText("Test Track");
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => expect(screen.queryByText("Test Track")).toBeNull());
    expect(screen.getByRole("button", { name: "Pause music" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toContain("Your access changed");
  });
  it("does not send a volume or playback command merely by opening the page", async () => {
    const fetch = vi.fn(async () => Response.json(snapshot)); vi.stubGlobal("fetch", fetch);
    render(<MusicWorkspace />); await screen.findByText("Test Track");
    expect(fetch.mock.calls).toHaveLength(1);
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ action: "status" });
  });
  it("submits an explicit volume change and reflects the returned result", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(snapshot)).mockResolvedValueOnce(Response.json({ ...snapshot, device: { ...snapshot.device, volume: 60 }, message: "Spotify reports Le Yard at 60%.", result: "confirmed" }));
    vi.stubGlobal("fetch", fetch); render(<MusicWorkspace />); await screen.findByText("Test Track");
    fireEvent.change(screen.getByLabelText("Volume (%)"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Set volume" }));
    expect(await screen.findByText("Reported: 60%")).toBeTruthy();
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ action: "volume", volume: 60 });
  });
});
