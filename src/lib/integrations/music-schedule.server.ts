import "server-only";
import { randomUUID } from "node:crypto";
import { createAdminClient } from "@/lib/supabase/admin";
import { compareAndSetMusicConnection, readMusicConnection, MusicStoreError } from "./music-store.server";
import { defaultMusicSchedule, latestMusicEvent, type MusicScheduleSettings, type MusicScheduleRuntime } from "./music-schedule";
import { runMusicRequest, type MusicScope } from "./music.server";

export async function readMusicSchedule(scope: MusicScope) {
  const row = await readMusicConnection(scope);
  return { settings: row?.configuration.schedule ?? defaultMusicSchedule, runtime: row?.configuration.scheduleRuntime ?? null,
    configured: Boolean(process.env.MUSIC_SCHEDULER_SECRET?.trim()) };
}

export async function saveMusicSchedule(scope: MusicScope, schedule: MusicScheduleSettings, now = new Date()) {
  const row = await readMusicConnection(scope);
  if (!row) throw new MusicStoreError("Connect Spotify before saving a schedule.");
  if (row.configuration.refreshLease && Date.parse(row.configuration.refreshLease.until) > now.getTime()) throw new MusicStoreError("Spotify is refreshing. Try saving again shortly.");
  const runtime = row.configuration.scheduleRuntime;
  if (runtime?.lease && Date.parse(runtime.lease.until) > now.getTime()) throw new MusicStoreError("A scheduled command is running. Try saving again shortly.");
  await compareAndSetMusicConnection(scope, row, { ...row.configuration, schedule, scheduleRuntime: {
    checkedAt: runtime?.checkedAt ?? "1970-01-01T00:00:00.000Z", eventKey: latestMusicEvent(schedule, now)?.key ?? "", attempts: 0,
    result: "waiting", message: schedule.enabled ? "Schedule saved. Starts at the next scheduled start; use Play for music now." : "Automatic playback is off.", attemptedAt: null, lease: null,
  } });
}

export async function processMusicSchedule(scope: MusicScope, now = new Date()) {
  const row = await readMusicConnection(scope);
  if (!row) return;
  const settings = row.configuration.schedule;
  if (!settings?.enabled) return;
  const prior = row.configuration.scheduleRuntime;
  if (prior?.lease && Date.parse(prior.lease.until) > now.getTime()) return;
  if (row.configuration.refreshLease && Date.parse(row.configuration.refreshLease.until) > now.getTime()) return;
  const event = latestMusicEvent(settings, now);
  if (!event) return;
  const same = prior?.eventKey === event.key;
  const completed = same && ["waiting", "confirmed", "missed"].includes(prior.result);
  const exhausted = same && prior.attempts >= 5;
  const coolingDown = same && prior.attemptedAt && now.getTime() - Date.parse(prior.attemptedAt) < 120000;
  const lateStart = event.action === "play" && event.ageMinutes >= 15;
  if (completed || exhausted || coolingDown) {
    if (!prior || now.getTime() - Date.parse(prior.checkedAt) < 300000) return;
    await compareAndSetMusicConnection(scope, row, { ...row.configuration, scheduleRuntime: { ...prior, checkedAt: now.toISOString(), lease: null } });
    return;
  }
  if (lateStart) {
    await compareAndSetMusicConnection(scope, row, { ...row.configuration, scheduleRuntime: { checkedAt: now.toISOString(), eventKey: event.key, attempts: same ? prior.attempts : 0,
      result: "missed", message: "Scheduled start could not be confirmed within 15 minutes. Use Play to start now.", attemptedAt: prior?.attemptedAt ?? null, lease: null } });
    return;
  }
  const lease = { id: randomUUID(), until: new Date(now.getTime() + 90000).toISOString() };
  const claimed: MusicScheduleRuntime = { checkedAt: now.toISOString(), eventKey: event.key, attempts: same ? prior.attempts + 1 : 1,
    result: "accepted", message: `Scheduled ${event.action === "play" ? "start" : "stop"} is being checked.`, attemptedAt: now.toISOString(), lease };
  await compareAndSetMusicConnection(scope, row, { ...row.configuration, scheduleRuntime: claimed });
  let result: MusicScheduleRuntime["result"] = "failed";
  let message = "Scheduled playback could not be checked. Another attempt will follow.";
  try {
    const snapshot = await runMusicRequest(scope, { action: event.action }, event.action === "play" ? { playlist: settings.playlist ?? undefined, volume: settings.volume } : undefined);
    result = snapshot.result === "confirmed" ? "confirmed" : snapshot.result === "accepted" ? "accepted" : "failed";
    message = snapshot.message;
  } finally {
    // Token refresh may have replaced the encrypted grant. Merge into the latest
    // metadata rather than restoring the pointer from before the command.
    for (let attempt = 0; attempt < 3; attempt++) {
      const fresh = await readMusicConnection(scope);
      if (!fresh || fresh.configuration.scheduleRuntime?.lease?.id !== lease.id) break;
      try {
        await compareAndSetMusicConnection(scope, fresh, { ...fresh.configuration, scheduleRuntime: { ...claimed, checkedAt: new Date().toISOString(), result,
          message: claimed.attempts >= 5 && result !== "confirmed" ? `${message} Automatic retries ended; check the speaker and use Play or Pause.` : message, lease: null } });
        break;
      } catch (error) { if (attempt === 2) throw error; }
    }
  }
}

export async function processChurchMusicSchedules() {
  const client = createAdminClient();
  // Resolve the allowlisted tenant on every run; request data never picks a target.
  const org = await client.from("organizations").select("id").eq("slug", "le-yard-church-street").eq("status", "active").maybeSingle();
  if (org.error) throw new Error("Music tenant unavailable.");
  if (!org.data) return;
  const location = await client.from("locations").select("id").eq("organization_id", org.data.id).eq("code", "CHURCH").eq("is_active", true).maybeSingle();
  if (location.error) throw new Error("Music location unavailable.");
  if (!location.data) return;
  const connection = await client.from("music_connections").select("created_by").eq("organization_id", org.data.id).eq("location_id", location.data.id).eq("status", "connected").maybeSingle();
  if (connection.error) throw new Error("Music connection unavailable.");
  if (connection.data) await processMusicSchedule({ organizationId: org.data.id, locationId: location.data.id, userId: connection.data.created_by });
}
