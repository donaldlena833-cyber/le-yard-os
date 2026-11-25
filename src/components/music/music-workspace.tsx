"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Check, Clock3, Music2, Pause, Play, RefreshCw, Settings2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { MUSIC_DEVICE_NAME, musicSnapshot, type MusicRequest, type MusicSnapshot } from "@/lib/integrations/music";
import { defaultMusicSchedule, MUSIC_TIME_ZONE, musicScheduleSettings, playlistUri, type MusicScheduleSettings } from "@/lib/integrations/music-schedule";

const field = "focus-ring min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-sm disabled:opacity-50";
const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const timeLabel = (value: string) => new Intl.DateTimeFormat("en-US", { hour: "numeric", minute: "2-digit", timeZone: "UTC" }).format(new Date(`2000-01-01T${value}:00Z`));
const checkedLabel = (value: string) => new Intl.DateTimeFormat("en-US", { timeZone: MUSIC_TIME_ZONE, hour: "numeric", minute: "2-digit" }).format(new Date(value));

export function MusicWorkspace({ notice }: { notice?: string }) {
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<MusicSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [volume, setVolume] = useState(85);
  const [settings, setSettings] = useState<MusicScheduleSettings>(defaultMusicSchedule);
  const [playlist, setPlaylist] = useState("");
  const [clientId, setClientId] = useState("");
  const initialized = useRef(false);
  const volumeEdited = useRef(false);
  const inFlight = useRef(false);

  const request = useCallback(async (input: MusicRequest) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    if (input.action !== "status") setFeedback(null);
    try {
      const response = await fetch("/api/workspace/music", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
        cache: "no-store", signal: AbortSignal.timeout(40000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403
        ? "Your access changed. Reload Operations and select Church Street."
        : typeof data.message === "string" ? data.message : "Music could not be checked. Try again.");
      if (input.action === "connect") {
        const url = new URL(data.authorizeUrl);
        if (url.origin !== "https://accounts.spotify.com" || url.pathname !== "/authorize") throw new Error("Spotify connection could not be opened.");
        window.location.assign(url.href);
        return;
      }
      const next = musicSnapshot.parse(data);
      setSnapshot(next);
      if (next.clientId) setClientId((current) => current || next.clientId!);
      if (!volumeEdited.current && next.device.volume !== null) setVolume(next.device.volume);
      if (next.schedule && (!initialized.current || input.action === "save_schedule")) {
        setSettings(next.schedule.settings);
        setPlaylist(next.schedule.settings.playlist ? `https://open.spotify.com/playlist/${next.schedule.settings.playlist.split(":")[2]}` : "");
        initialized.current = true;
      }
      if (input.action === "save_schedule") setFeedback("Schedule saved. New hours apply from the next start or end time. Use Play to start now.");
      else if (input.action !== "status") setFeedback(next.message);
    } catch (cause) {
      // Do not retain a stale track or enable commands after losing access.
      setSnapshot(null);
      setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Music took too long to respond. Refresh before trying again.");
    } finally { inFlight.current = false; setBusy(false); }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => { void request({ action: "status" }); }, 0);
    const refresh = () => { if (document.visibilityState === "visible") void request({ action: "status" }); };
    const interval = setInterval(refresh, 30000);
    document.addEventListener("visibilitychange", refresh);
    return () => { clearTimeout(initial); clearInterval(interval); document.removeEventListener("visibilitychange", refresh); };
  }, [request]);

  const connected = snapshot?.status === "connected";
  const controls = connected && snapshot.device.available && !snapshot.device.restricted && !busy;
  const status = !snapshot ? busy ? "Checking…" : "Not checked" : snapshot.status === "setup_needed" ? "Setup needed"
    : snapshot.status === "disconnected" ? "Connect Spotify" : snapshot.status === "reconnect" ? "Reconnect Spotify"
      : snapshot.status === "unavailable" ? "Check connection" : !snapshot.device.available ? "Speaker unavailable"
        : snapshot.playing ? "Playing" : "Paused";
  const saved = snapshot?.schedule;
  const runtime = saved?.runtime;
  const schedulerHealthy = Boolean(runtime && Date.parse(snapshot!.checkedAt) - Date.parse(runtime.checkedAt) < 10 * 60000);
  const needsConnection = snapshot && ["disconnected", "reconnect", "setup_needed"].includes(snapshot.status);
  const dirty = saved && (JSON.stringify(settings) !== JSON.stringify(saved.settings) || playlist.trim() !== (saved.settings.playlist ? `https://open.spotify.com/playlist/${saved.settings.playlist.split(":")[2]}` : ""));

  function saveSchedule(event: React.FormEvent) {
    event.preventDefault();
    try {
      const candidate = musicScheduleSettings.safeParse({ ...settings, playlist: playlistUri(playlist) });
      if (!candidate.success) throw new Error("Choose different start and end times, at least one day, and a volume from 0 to 100.");
      void request({ action: "save_schedule", schedule: candidate.data });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Check the schedule settings."); }
  }

  return (
    <section id="music" aria-labelledby="music-title" className="mt-3 w-full max-w-md scroll-mt-24">
      <h2 id="music-title" className="sr-only">Music</h2>
      <div className="flex h-11 min-w-0 items-center gap-2 text-xs" aria-busy={busy}>
        <Music2 className={`size-3.5 shrink-0 ${snapshot?.playing ? "text-[var(--accent-strong)]" : "text-[var(--ink-faint)]"}`} aria-hidden="true" />
        <span role="status" className="sr-only">{MUSIC_DEVICE_NAME}: {status}</span>
        <div className="min-w-0 flex-1 truncate" title={`${status}${snapshot?.track?.artist ? ` · ${snapshot.track.artist}` : ""}`}>
          {snapshot?.track?.url ? <a href={snapshot.track.url} target="_blank" rel="noopener noreferrer" className="focus-ring rounded text-[var(--ink-soft)] hover:text-[var(--ink)]">{snapshot.track.name}</a> : <span className="text-[var(--ink-soft)]">{snapshot?.track?.name ?? status}</span>}
        </div>
        <Button variant="quiet" size="icon" className="!size-8 !min-h-8 shadow-none" title={snapshot?.playing ? "Pause" : "Play"} disabled={!controls || snapshot?.otherDevicePlaying} aria-label={snapshot?.playing ? "Pause music" : "Play music"} onClick={() => void request({ action: snapshot?.playing ? "pause" : "play" })}>{snapshot?.playing ? <Pause className="size-3.5" aria-hidden="true" /> : <Play className="size-3.5" aria-hidden="true" />}</Button>
        <form className="flex shrink-0 items-center gap-1.5" onSubmit={(event) => { event.preventDefault(); void request({ action: "volume", volume }); }}>
          <label htmlFor="music-volume" className="sr-only">Volume (%)</label>
          <input id="music-volume" type="range" min="0" max="100" step="1" value={volume} disabled={!controls} onChange={(event) => { volumeEdited.current = true; setVolume(Number(event.target.value)); }} className="focus-ring h-8 w-16 accent-[var(--accent-strong)]" />
          <output htmlFor="music-volume" className="w-7 text-right text-[10px] tabular-nums text-[var(--ink-faint)]">{volume}%</output>
          {snapshot?.device.volume !== volume ? <Button variant="quiet" type="submit" size="icon" className="!size-7 !min-h-7 shadow-none" aria-label="Set volume" disabled={!controls}><Check className="size-3" aria-hidden="true" /></Button> : null}
        </form>
        <Button variant="quiet" size="icon" className="!size-8 !min-h-8 shadow-none" aria-label="Music settings" aria-expanded={settingsOpen} aria-controls="music-settings" onClick={() => setSettingsOpen((open) => !open)}><Settings2 className="size-3.5" aria-hidden="true" /></Button>
      </div>
      {error ? <p role="alert" className="truncate text-xs text-[var(--danger)]" title={error}>{error}</p> : null}
      {settingsOpen ? <div id="music-settings" className="mt-2 rounded-xl border border-[var(--line)] bg-[var(--paper-strong)]">
        <div className="flex items-center justify-between gap-3 px-4 py-2 text-xs text-[var(--ink-soft)]"><span>{status} · {snapshot?.device.volume != null ? `Reported: ${snapshot.device.volume}%` : "Volume not reported"}</span><Button size="icon" variant="quiet" className="!size-8 !min-h-8 shadow-none" aria-label="Refresh status" disabled={busy} onClick={() => void request({ action: "status" })}><RefreshCw className={`size-3.5 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" /></Button></div>
        {notice || feedback ? <p role="status" className="px-4 pb-3 text-xs text-[var(--ink-soft)]">{feedback ?? notice}</p> : null}
        {snapshot && snapshot.status !== "connected" || snapshot?.device.restricted || snapshot?.otherDevicePlaying || connected && !snapshot.device.available ? <p className="px-4 pb-3 text-xs text-[var(--ink-soft)]">{snapshot?.message}</p> : null}
      <details open className="group border-t border-[var(--line)]">
        <summary className="focus-ring flex min-h-11 cursor-pointer list-none flex-wrap items-center justify-between gap-2 px-4 text-xs"><span className="flex items-center gap-2"><Clock3 className="size-4 text-[var(--ink-faint)]" aria-hidden="true" />{saved?.settings.enabled ? `${timeLabel(saved.settings.start)} – ${timeLabel(saved.settings.stop)}` : "Automatic playback off"}<span className="text-xs text-[var(--ink-faint)]">New York</span></span><span className="flex items-center gap-2 text-xs text-[var(--ink-soft)]">Edit schedule<Settings2 className="size-3.5 transition-transform group-open:rotate-90 motion-reduce:transition-none" aria-hidden="true" /></span></summary>
        <form onSubmit={saveSchedule} className="space-y-4 px-4 pb-4 pt-2">
          <label className="flex min-h-11 items-center gap-3 text-sm font-medium"><input type="checkbox" checked={settings.enabled} onChange={(event) => setSettings({ ...settings, enabled: event.target.checked })} className="size-4 accent-[var(--accent-strong)]" />Start and stop automatically</label>
          <div className="grid gap-4 sm:grid-cols-3"><label className="space-y-2 text-xs font-medium"><span>Start time</span><input type="time" required value={settings.start} onChange={(event) => setSettings({ ...settings, start: event.target.value })} className={field} /></label><label className="space-y-2 text-xs font-medium"><span>End time</span><input type="time" required value={settings.stop} onChange={(event) => setSettings({ ...settings, stop: event.target.value })} className={field} /></label><label className="space-y-2 text-xs font-medium"><span>Starting volume (%)</span><input type="number" required min="0" max="100" step="1" value={Number.isNaN(settings.volume) ? "" : settings.volume} onChange={(event) => setSettings({ ...settings, volume: event.target.valueAsNumber })} className={field} /></label></div>
          <fieldset><legend className="mb-2 text-xs font-medium">Days</legend><div className="flex flex-wrap gap-1.5">{days.map((day, index) => <button key={day} type="button" aria-pressed={settings.days.includes(index)} onClick={() => setSettings({ ...settings, days: settings.days.includes(index) ? settings.days.filter((value) => value !== index) : [...settings.days, index].sort() })} className={`focus-ring min-h-11 min-w-11 rounded-xl px-3 text-xs font-medium transition-colors ${settings.days.includes(index) ? "bg-[var(--accent-strong)] text-white" : "bg-[var(--paper)] text-[var(--ink-soft)]"}`}>{day}</button>)}</div></fieldset>
          <label className="block space-y-2 text-xs font-medium"><span>Spotify playlist (optional)</span><input type="text" value={playlist} onChange={(event) => setPlaylist(event.target.value)} placeholder="Paste a Spotify playlist link" className={field} /><span className="block font-normal text-[var(--ink-soft)]">Leave blank to resume the previous session. Overnight hours end the following day.</span></label>
          <div className="flex flex-wrap items-center gap-3"><Button type="submit" disabled={busy || !snapshot?.clientId || !dirty}>Save schedule</Button><p className="text-xs text-[var(--ink-soft)]">All times use New York time, including daylight saving.</p></div>
          <div className="space-y-1 text-xs leading-5 text-[var(--ink-soft)]"><p>{!saved?.configured ? "Automatic playback is being prepared." : saved.settings.enabled ? schedulerHealthy ? `Schedule checked ${checkedLabel(runtime!.checkedAt)} · Runs even when this page is closed.` : "Waiting for the scheduler to check in. Refresh in a few minutes." : "Turn on automatic playback to use these hours."}</p>{runtime ? <p>Last schedule result: {runtime.message}{runtime.attemptedAt ? ` (${checkedLabel(runtime.attemptedAt)})` : ""}</p> : null}<p>The speaker must be available in Spotify. Failed commands retry up to five times; missed starts stop retrying after 15 minutes.</p></div>
        </form>
      </details>
      <details open={needsConnection || undefined} className="border-t border-[var(--line)]">
        <summary className="focus-ring flex min-h-11 cursor-pointer items-center justify-between px-4 text-xs text-[var(--ink-soft)]"><span>Spotify connection</span><span>{connected ? "Connected" : "Manage"}</span></summary>
        <div className="space-y-3 px-4 pb-4">
          {!connected ? <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void request({ action: "connect", clientId: clientId.trim() }); }}><label className="flex-1 space-y-2 text-xs font-medium"><span>Spotify app client ID</span><input value={clientId} required pattern="[a-f0-9]{32}" maxLength={32} autoComplete="off" spellCheck={false} onChange={(event) => setClientId(event.target.value)} className={field} /></label><Button type="submit" disabled={busy || snapshot?.status === "setup_needed"}>{snapshot?.clientId ? "Reconnect Spotify" : "Connect Spotify"}<ArrowUpRight className="size-4" aria-hidden="true" /></Button></form> : null}
          {connected && clientId ? <Button variant="secondary" size="sm" disabled={busy} onClick={() => void request({ action: "connect", clientId: clientId.trim() })}>Switch Spotify account</Button> : null}
          {snapshot?.clientId ? <Button variant="quiet" size="sm" disabled={busy} onClick={() => void request({ action: "disconnect" })}>Disconnect Spotify and remove schedule</Button> : null}
          <p className="text-xs leading-5 text-[var(--ink-soft)]">Only the Le Yard speaker is controlled. Music playing on another device is left alone.</p>
          <p className="text-xs leading-5 text-[var(--ink-faint)]">{!clientId ? <>Register the Operations callback in <a href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Spotify Developer Dashboard</a>: <span className="break-all">https://operations.leyardny.com/api/workspace/music/callback</span>. </> : null}<a href="https://support.spotify.com/us/article/spotify-public-commercial-use/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Spotify usage policy</a></p>
        </div>
      </details>
      </div> : null}
    </section>
  );
}
