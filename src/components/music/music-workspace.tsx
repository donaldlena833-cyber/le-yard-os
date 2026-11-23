"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowUpRight, Clock3, Music2, Pause, Play, RefreshCw, Speaker, Volume2 } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { PageFrame, PageHeader } from "@/components/ui/page-frame";
import { MUSIC_DEVICE_NAME, musicSchedule, musicSnapshot, type MusicRequest, type MusicSnapshot } from "@/lib/integrations/music";

export function MusicWorkspace({ notice }: { notice?: string }) {
  const [snapshot, setSnapshot] = useState<MusicSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [volume, setVolume] = useState<number>(musicSchedule.volume);
  const [clientId, setClientId] = useState("");
  const inFlight = useRef(false);
  const request = useCallback(async (input: MusicRequest) => {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/workspace/music", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
        cache: "no-store", signal: AbortSignal.timeout(40_000),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(response.status === 401 || response.status === 403
        ? "Your access changed. Reload Operations and select Church Street."
        : "Music could not be checked. Refresh before trying again.");
      if (input.action === "connect") {
        const url = new URL(data.authorizeUrl);
        if (url.origin !== "https://accounts.spotify.com" || url.pathname !== "/authorize") throw new Error("Spotify connection could not be opened.");
        window.location.assign(url.href);
        return;
      }
      const next = musicSnapshot.parse(data);
      setSnapshot(next);
      if (next.clientId) setClientId((current) => current || next.clientId!);
    } catch (cause) {
      setSnapshot(null);
      setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Music took too long to respond. Refresh before trying again.");
    } finally { inFlight.current = false; setBusy(false); }
  }, []);

  useEffect(() => {
    const initial = setTimeout(() => { void request({ action: "status" }); }, 0);
    const interval = setInterval(() => {
      if (document.visibilityState === "visible") void request({ action: "status" });
    }, 30_000);
    return () => { clearTimeout(initial); clearInterval(interval); };
  }, [request]);

  const connected = snapshot?.status === "connected";
  const controls = connected && snapshot.device.available && !snapshot.device.restricted && !busy;
  const status = !snapshot ? "Not checked" : snapshot.status === "setup_needed" ? "Setup in progress"
    : snapshot.status === "disconnected" ? "Connect Spotify" : snapshot.status === "reconnect" ? "Reconnect Spotify"
      : snapshot.status === "unavailable" ? "Status unavailable" : !snapshot.device.available ? "Speaker not visible"
        : snapshot.playing ? "Playing" : "Not playing";
  const checkedAt = snapshot?.checkedAt ? new Intl.DateTimeFormat("en-US", { timeZone: musicSchedule.timeZone, hour: "numeric", minute: "2-digit", second: "2-digit" }).format(new Date(snapshot.checkedAt)) : null;

  return (
    <PageFrame width="standard" className="space-y-8">
      <PageHeader eyebrow="140 Church Street" title="Music" detail="Check the Le Yard speaker and control its Spotify playback."
        actions={<Button variant="secondary" disabled={busy} onClick={() => void request({ action: "status" })}><RefreshCw className={`size-4 ${busy ? "animate-spin motion-reduce:animate-none" : ""}`} aria-hidden="true" />Refresh status</Button>} />
      {notice ? <p role="status" className="text-sm text-[var(--ink-soft)]">{notice}</p> : null}
      {error ? <p role="alert" className="text-sm text-[var(--danger)]">{error}</p> : null}

      <section aria-labelledby="speaker-title" aria-busy={busy} className="grid gap-8 border-b border-[var(--line)] pb-8 md:grid-cols-[1fr_1.2fr]">
        <div>
          <Speaker className="size-8 text-[var(--primary)]" aria-hidden="true" />
          <h2 id="speaker-title" className="mt-4 text-2xl font-semibold tracking-tight">{MUSIC_DEVICE_NAME}</h2>
          <p className="mt-2 text-sm font-medium">{status}</p>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--ink-soft)]">{snapshot?.message ?? "Refresh to check the current connection."}</p>
          {checkedAt ? <p className="mt-3 text-xs text-[var(--ink-faint)]">Last checked {checkedAt} · New York</p> : null}
        </div>
        <div className="space-y-6">
          <div className="min-h-20">
            <p className="text-xs font-medium uppercase tracking-widest text-[var(--ink-faint)]">Reported by Spotify</p>
            <h3 className="mt-2 text-xl font-semibold">{snapshot?.track?.name ?? "No track reported"}</h3>
            {snapshot?.track?.artist ? <p className="mt-1 text-sm text-[var(--ink-soft)]">{snapshot.track.artist}</p> : null}
            {snapshot?.track?.url ? <a href={snapshot.track.url} target="_blank" rel="noopener noreferrer" className="focus-ring mt-2 inline-flex min-h-11 items-center gap-1 text-sm underline underline-offset-4">Open in Spotify<ArrowUpRight className="size-3.5" aria-hidden="true" /></a> : null}
          </div>
          {snapshot?.otherDevicePlaying ? <p className="text-sm text-[var(--ink-soft)]">Music is playing on another device. Select Le Yard in Spotify before resuming here.</p> : null}
          <div className="flex flex-wrap gap-3">
            <Button disabled={!controls || snapshot?.playing || snapshot?.otherDevicePlaying} onClick={() => void request({ action: "play" })}><Play className="size-4" aria-hidden="true" />Resume music</Button>
            <Button variant="secondary" disabled={!controls || !snapshot?.playing} onClick={() => void request({ action: "pause" })}><Pause className="size-4" aria-hidden="true" />Pause music</Button>
          </div>
          <form className="flex flex-wrap items-end gap-3" onSubmit={(event) => { event.preventDefault(); void request({ action: "volume", volume }); }}>
            <div>
              <label htmlFor="music-volume" className="flex items-center gap-2 text-sm font-medium"><Volume2 className="size-4" aria-hidden="true" />Volume (%)</label>
              <input id="music-volume" type="number" required min="0" max="100" step="1" value={Number.isNaN(volume) ? "" : volume} disabled={!controls}
                onChange={(event) => setVolume(event.target.valueAsNumber)} className="focus-ring mt-2 min-h-11 w-28 rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 disabled:opacity-50" />
            </div>
            <Button variant="secondary" type="submit" disabled={!controls || !Number.isInteger(volume) || volume < 0 || volume > 100}>Set volume</Button>
            <p className="pb-3 text-sm text-[var(--ink-soft)]">Reported: {snapshot?.device.volume === null || snapshot?.device.volume === undefined ? "Unknown" : `${snapshot.device.volume}%`}</p>
          </form>
        </div>
      </section>

      <section aria-labelledby="music-schedule-title" className="grid gap-6 border-b border-[var(--line)] pb-8 md:grid-cols-[1fr_1.2fr]">
        <div><Clock3 className="size-6 text-[var(--primary)]" aria-hidden="true" /><h2 id="music-schedule-title" className="mt-3 text-xl font-semibold">Daily schedule</h2><p className="mt-2 text-sm text-[var(--ink-soft)]">Managed by Codex · America/New_York</p></div>
        <div>
          <dl className="grid grid-cols-2 gap-x-6 gap-y-4 text-sm">
            <div><dt className="text-[var(--ink-soft)]">Start</dt><dd className="mt-1 text-xl font-semibold">6:30 a.m.</dd></div>
            <div><dt className="text-[var(--ink-soft)]">Stop</dt><dd className="mt-1 text-xl font-semibold">5:00 p.m.</dd></div>
            <div><dt className="text-[var(--ink-soft)]">Days</dt><dd className="mt-1 font-medium">{musicSchedule.days}</dd></div>
            <div><dt className="text-[var(--ink-soft)]">Morning volume</dt><dd className="mt-1 font-medium">{musicSchedule.volume}%</dd></div>
            <div className="col-span-2"><dt className="text-[var(--ink-soft)]">Playlists</dt><dd className="mt-1 font-medium">{musicSchedule.playlists}</dd></div>
          </dl>
          <p className="mt-5 text-sm leading-6 text-[var(--ink-soft)]">Keep the Mac awake with Codex running for the existing schedule. Morning playback resumes the previous session when Spotify makes it available. This page does not verify that a scheduled run succeeded.</p>
        </div>
      </section>

      <section aria-labelledby="music-connection-title" className="grid gap-6 md:grid-cols-[1fr_1.2fr]">
        <div><Music2 className="size-6 text-[var(--primary)]" aria-hidden="true" /><h2 id="music-connection-title" className="mt-3 text-xl font-semibold">Spotify connection</h2><p className="mt-2 max-w-sm text-sm leading-6 text-[var(--ink-soft)]">Operations needs its own authorization to read playback and control the speaker.</p></div>
        <div className="space-y-4">
          {!connected ? <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); void request({ action: "connect", clientId: clientId.trim() }); }}>
            <label htmlFor="spotify-client-id" className="block text-sm font-medium">Spotify app client ID</label>
            <input id="spotify-client-id" value={clientId} required pattern="[a-f0-9]{32}" maxLength={32} autoComplete="off" spellCheck={false}
              onChange={(event) => setClientId(event.target.value)} className="focus-ring min-h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--surface)] px-3 font-mono text-sm" />
            <p className="text-xs leading-5 text-[var(--ink-soft)]">Use the Operations app in Spotify Developer Dashboard. The app’s redirect address must be <span className="break-all">https://operations.leyardny.com/api/workspace/music/callback</span>. A client secret is not needed.</p>
            <Button type="submit" disabled={busy || snapshot?.status === "setup_needed"}>Connect Spotify<ArrowUpRight className="size-4" aria-hidden="true" /></Button>
          </form> : <Button variant="secondary" disabled={busy} onClick={() => void request({ action: "disconnect" })}>Disconnect from Operations</Button>}
          <p className="text-xs leading-5 text-[var(--ink-soft)]">Operations stores an encrypted Spotify grant on its server. It reads current playback and controls only the Le Yard speaker. Track history and account passwords are not stored. Disconnect here to delete the saved grant.</p>
          <a className={buttonVariants({ variant: "secondary", size: "sm" })} href="https://developer.spotify.com/dashboard" target="_blank" rel="noopener noreferrer">Spotify Developer Dashboard<ArrowUpRight className="size-3.5" aria-hidden="true" /></a>
          <p className="text-xs leading-5 text-[var(--ink-soft)]">Spotify is for personal listening. For music heard by customers, use a licensed business music service. <a href="https://support.spotify.com/us/article/spotify-public-commercial-use/" target="_blank" rel="noopener noreferrer" className="underline underline-offset-4">Spotify’s usage policy</a>.</p>
        </div>
      </section>
    </PageFrame>
  );
}
