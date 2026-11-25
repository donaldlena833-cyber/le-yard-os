import "server-only";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { createAdminClient } from "@/lib/supabase/admin";
import { musicScheduleSettings, musicScheduleRuntime } from "./music-schedule";
import type { MusicScope } from "./music.server";

export const MUSIC_BUCKET = "music-connections";
const metadataSchema = z.object({ clientId: z.string().regex(/^[a-f0-9]{32}$/), grantVersion: z.string().uuid(),
  schedule: musicScheduleSettings.optional(), scheduleRuntime: musicScheduleRuntime.optional(),
  refreshLease: z.object({ id: z.string().uuid(), until: z.string().datetime() }).nullable() });
type Metadata = z.infer<typeof metadataSchema>;
export type MusicConnection = { id: string; configuration: Metadata };
export class MusicStoreError extends Error {}
const prefix = (scope: MusicScope) => `${scope.organizationId}/${scope.locationId}`;
const path = (scope: MusicScope, version: string) => `${prefix(scope)}/${version}.bin`;
function connections(scope: MusicScope) {
  return createAdminClient().from("music_connections").select("id,status,configuration")
    .eq("organization_id", scope.organizationId).eq("location_id", scope.locationId);
}
export async function readMusicConnection(scope: MusicScope): Promise<MusicConnection | null> {
  const result = await connections(scope).maybeSingle();
  if (result.error) throw new MusicStoreError("Music connection could not be loaded. Try again.");
  if (!result.data) return null;
  if (result.data.status === "disabled") throw new MusicStoreError("Music disconnection needs another cleanup attempt. Use Disconnect again.");
  return { id: result.data.id, configuration: metadataSchema.parse(result.data.configuration) };
}
export async function compareAndSetMusicConnection(scope: MusicScope, row: MusicConnection, configuration: Metadata) {
  const result = await createAdminClient().from("music_connections").update({ configuration })
    .eq("id", row.id).eq("organization_id", scope.organizationId).eq("location_id", scope.locationId)
    .eq("status", "connected").eq("configuration", JSON.stringify(row.configuration))
    .select("id").maybeSingle();
  if (result.error || !result.data) throw new MusicStoreError("Music connection changed. Refresh before continuing.");
  return { id: row.id, configuration };
}
export async function readMusicGrant(scope: MusicScope, row: MusicConnection) {
  const result = await createAdminClient().storage.from(MUSIC_BUCKET).download(path(scope, row.configuration.grantVersion));
  if (result.error || !result.data || result.data.size > 20000) throw new MusicStoreError("The saved music connection is unavailable. Reconnect Spotify.");
  return result.data.text();
}
async function writeGrant(scope: MusicScope, encrypted: string, version: string) {
  const result = await createAdminClient().storage.from(MUSIC_BUCKET).upload(path(scope, version), Buffer.from(encrypted),
    { contentType: "application/octet-stream", cacheControl: "0", upsert: false });
  if (result.error) throw new MusicStoreError("Spotify authorization could not be saved. Try connecting again.");
}
// Delete obsolete encrypted files without copying any grant into integration audit history.
async function cleanGrants(scope: MusicScope, keep?: string) {
  const bucket = createAdminClient().storage.from(MUSIC_BUCKET);
  let offset = 0;
  const remove: string[] = [];
  for (;;) {
    const listed = await bucket.list(prefix(scope), { limit: 100, offset, sortBy: { column: "name", order: "asc" } });
    if (listed.error) throw new MusicStoreError("Music connection cleanup needs a retry.");
    for (const object of listed.data ?? []) {
      if (/^[a-f0-9-]{36}\.bin$/.test(object.name) && object.name !== `${keep}.bin`) remove.push(`${prefix(scope)}/${object.name}`);
    }
    if (!listed.data || listed.data.length < 100) break;
    offset += 100;
    if (offset > 10000) throw new MusicStoreError("Music connection cleanup needs assistance.");
  }
  for (let index = 0; index < remove.length; index += 100) {
    const result = await bucket.remove(remove.slice(index, index + 100));
    if (result.error) throw new MusicStoreError("Music connection cleanup needs a retry.");
  }
}
export async function saveMusicGrant(scope: MusicScope, clientId: string, encrypted: string, current?: MusicConnection) {
  const row = current ?? await readMusicConnection(scope);
  const version = randomUUID();
  await writeGrant(scope, encrypted, version);
  const configuration: Metadata = { ...row?.configuration, clientId, grantVersion: version, refreshLease: null };
  let stored = false;
  try {
    if (row) await compareAndSetMusicConnection(scope, row, configuration);
    else {
      const created = await createAdminClient().from("music_connections").insert({
        organization_id: scope.organizationId, location_id: scope.locationId, status: "connected",
        configuration, created_by: scope.userId,
      }).select("id").single();
      if (created.error || !created.data) throw new MusicStoreError("Music connection changed. Try connecting again.");
    }
    stored = true;
    // Only the exact previous version can be removed here. A concurrent grant save
    // may already have uploaded its next version before its metadata compare-and-set.
    if (row) {
      const removed = await createAdminClient().storage.from(MUSIC_BUCKET).remove([path(scope, row.configuration.grantVersion)]);
      if (removed.error) throw new MusicStoreError("Music connected, but older encrypted files need cleanup. Disconnect and reconnect before continuing.");
    }
  } finally {
    if (!stored) await createAdminClient().storage.from(MUSIC_BUCKET).remove([path(scope, version)]);
  }
}
export async function claimMusicRefresh(scope: MusicScope, row: MusicConnection) {
  if (row.configuration.refreshLease && Date.parse(row.configuration.refreshLease.until) > Date.now()) {
    throw new MusicStoreError("Spotify connection is refreshing. Try again shortly.");
  }
  return compareAndSetMusicConnection(scope, row, { ...row.configuration,
    refreshLease: { id: randomUUID(), until: new Date(Date.now() + 20_000).toISOString() } });
}
export async function releaseMusicRefresh(scope: MusicScope, row: MusicConnection) {
  try { await compareAndSetMusicConnection(scope, row, { ...row.configuration, refreshLease: null }); } catch { /* Already replaced or disconnected. */ }
}
export async function disconnectMusic(scope: MusicScope) {
  const result = await connections(scope).maybeSingle();
  if (result.error) throw new MusicStoreError("Music connection could not be loaded.");
  if (result.data) {
    const disabled = await createAdminClient().from("music_connections").update({ status: "disabled" })
      .eq("id", result.data.id).eq("organization_id", scope.organizationId).eq("location_id", scope.locationId)
      .eq("configuration", JSON.stringify(result.data.configuration)).select("id").maybeSingle();
    if (disabled.error || !disabled.data) throw new MusicStoreError("Music connection changed. Refresh and disconnect again.");
  }
  await cleanGrants(scope);
  if (result.data) {
    const deleted = await createAdminClient().from("music_connections").delete().eq("id", result.data.id)
      .eq("organization_id", scope.organizationId).eq("location_id", scope.locationId).eq("status", "disabled");
    if (deleted.error) throw new MusicStoreError("Music connection cleanup needs a retry.");
  }
}
