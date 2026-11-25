// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MusicWorkspace } from "@/components/music/music-workspace";
import { defaultMusicSchedule } from "@/lib/integrations/music-schedule";
import type { MusicSnapshot } from "@/lib/integrations/music";
const snapshot: MusicSnapshot = { status: "connected", checkedAt: "2026-11-23T19:00:00Z", device: { available: true, active: true, restricted: false, volume: 85 }, playing: true,
  track: { name: "Test Track", artist: "Test Artist", url: "https://open.spotify.com/track/abc" }, otherDevicePlaying: false, message: "Status reported by Spotify.", clientId: "a".repeat(32), result: "none",
  schedule: { settings: { ...defaultMusicSchedule, enabled: true }, configured: true, runtime: null } };
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
describe("dashboard music", () => {
  it("shows live playback and editable hours without opening another page", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => Response.json(snapshot)));
    render(<MusicWorkspace />);
    expect(await screen.findByText("Test Track")).toBeTruthy();
    expect(screen.getByText(/Reported: 85%/)).toBeTruthy();
    expect(screen.getByLabelText("Start time")).toHaveProperty("value", "06:30");
    expect(screen.getByLabelText("End time")).toHaveProperty("value", "17:00");
    expect(screen.getByRole("button", { name: "Pause music" })).toHaveProperty("disabled", false);
  });
  it("clears stale music and disables controls after access is lost", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValueOnce(Response.json(snapshot)).mockResolvedValueOnce(Response.json({ message: "Forbidden" }, { status: 403 })));
    render(<MusicWorkspace />); await screen.findByText("Test Track");
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => expect(screen.queryByText("Test Track")).toBeNull());
    expect(screen.getByRole("button", { name: "Play music" })).toHaveProperty("disabled", true);
    expect(screen.getByRole("alert").textContent).toContain("Your access changed");
  });
  it("opening the dashboard only reads status and initializes the actual volume", async () => {
    const fetch = vi.fn(async () => Response.json({ ...snapshot, device: { ...snapshot.device, volume: 60 } })); vi.stubGlobal("fetch", fetch);
    render(<MusicWorkspace />); await screen.findByText("Test Track");
    expect(fetch.mock.calls).toHaveLength(1);
    expect(screen.getByLabelText("Volume (%)")).toHaveProperty("value", "60");
    expect(JSON.parse((fetch.mock.calls[0] as unknown as [string, RequestInit])[1].body as string)).toEqual({ action: "status" });
  });
  it("submits an explicit volume change", async () => {
    const fetch = vi.fn().mockResolvedValueOnce(Response.json(snapshot)).mockResolvedValueOnce(Response.json({ ...snapshot, device: { ...snapshot.device, volume: 60 }, message: "Spotify reports Le Yard at 60%.", result: "confirmed" }));
    vi.stubGlobal("fetch", fetch); render(<MusicWorkspace />); await screen.findByText("Test Track");
    fireEvent.change(screen.getByLabelText("Volume (%)"), { target: { value: "60" } });
    fireEvent.click(screen.getByRole("button", { name: "Set volume" }));
    expect(await screen.findByText(/Reported: 60%/)).toBeTruthy();
    expect(JSON.parse(fetch.mock.calls[1][1].body)).toEqual({ action: "volume", volume: 60 });
  });
  it("preserves unsaved hours across refresh and persists only on Save", async () => {
    const fetch = vi.fn(async () => Response.json(snapshot)); vi.stubGlobal("fetch", fetch);
    render(<MusicWorkspace />); await screen.findByText("Test Track");
    fireEvent.change(screen.getByLabelText("Start time"), { target: { value: "07:00" } });
    fireEvent.click(screen.getByRole("button", { name: "Refresh status" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.getByRole("button", { name: "Save schedule" })).toHaveProperty("disabled", false));
    expect(screen.getByLabelText("Start time")).toHaveProperty("value", "07:00");
    fireEvent.click(screen.getByRole("button", { name: "Save schedule" }));
    await waitFor(() => expect(fetch).toHaveBeenCalledTimes(3));
    expect(JSON.parse((fetch.mock.calls[2] as unknown as [string, RequestInit])[1].body as string)).toMatchObject({ action: "save_schedule", schedule: { start: "07:00", stop: "17:00", enabled: true } });
  });
});
