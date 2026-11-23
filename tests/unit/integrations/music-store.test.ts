import { beforeEach, describe, expect, it, vi } from "vitest";
const state = vi.hoisted(() => ({ row: null as Record<string, unknown> | null, files: new Map<string, string>() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: () => ({
  from: () => {
    let operation = "read";
    let patch: Record<string, unknown> = {};
    const filters: [string, unknown][] = [];
    const query: Record<string, unknown> = {};
    query.select = () => query;
    query.eq = (column: string, value: unknown) => { filters.push([column, value]); return query; };
    query.update = (value: Record<string, unknown>) => { operation = "update"; patch = value; return query; };
    query.insert = (value: Record<string, unknown>) => { operation = "insert"; patch = value; return query; };
    query.delete = () => { operation = "delete"; return query; };
    const execute = async () => {
      if (operation === "insert") {
        if (state.row) return { data: null, error: new Error("unique constraint") };
        state.row = { ...patch, id: "connection" }; return { data: { ...state.row }, error: null };
      }
      const found = state.row && filters.every(([column, value]) => column === "configuration"
        ? JSON.stringify(state.row![column]) === value : state.row![column] === value);
      if (!found) return { data: null, error: null };
      if (operation === "update") state.row = { ...state.row, ...patch };
      if (operation === "delete") { state.row = null; return { data: null, error: null }; }
      return { data: { ...state.row }, error: null };
    };
    query.single = execute; query.maybeSingle = execute;
    query.then = (resolve: (result: unknown) => unknown) => execute().then(resolve);
    return query;
  },
  storage: { from: () => ({
    upload: async (path: string, body: Buffer) => {
      if (state.files.has(path)) return { data: null, error: new Error("exists") };
      state.files.set(path, body.toString()); return { data: { path }, error: null };
    },
    download: async (path: string) => ({ data: state.files.has(path) ? new Blob([state.files.get(path)!]) : null, error: null }),
    remove: async (paths: string[]) => { for (const path of paths) state.files.delete(path); return { error: null }; },
    list: async (prefix: string, options: { offset: number; limit: number }) => ({ error: null,
      data: [...state.files.keys()].filter((key) => key.startsWith(`${prefix}/`)).map((key) => ({ name: key.split("/").at(-1)! }))
        .sort((a, b) => a.name.localeCompare(b.name)).slice(options.offset, options.offset + options.limit) }),
  }) },
}) }));
import { claimMusicRefresh, disconnectMusic, readMusicConnection, readMusicGrant, releaseMusicRefresh, saveMusicGrant } from "@/lib/integrations/music-store.server";
const scope = { organizationId: "org", locationId: "room", userId: "owner" };
const clientId = "a".repeat(32);
beforeEach(() => { state.row = null; state.files.clear(); });

describe("music encrypted file custody", () => {
  it("keeps grants out of integration metadata and replaces only the old scoped file", async () => {
    await saveMusicGrant(scope, clientId, "encrypted-one");
    const first = (await readMusicConnection(scope))!;
    expect(JSON.stringify(state.row)).not.toContain("encrypted-one");
    expect(await readMusicGrant(scope, first)).toBe("encrypted-one");
    state.files.set("another-org/room/other.bin", "unrelated");
    await saveMusicGrant(scope, clientId, "encrypted-two", first);
    expect(state.files.size).toBe(2);
    expect(state.files.get("another-org/room/other.bin")).toBe("unrelated");
    expect(await readMusicGrant(scope, (await readMusicConnection(scope))!)).toBe("encrypted-two");
  });
  it("cleans an orphan upload if a concurrent metadata change defeats the compare-and-set", async () => {
    await saveMusicGrant(scope, clientId, "encrypted-one");
    const first = (await readMusicConnection(scope))!;
    state.row = { ...state.row, configuration: { ...first.configuration, clientId: "b".repeat(32) } };
    await expect(saveMusicGrant(scope, clientId, "encrypted-two", first)).rejects.toThrow(/changed/);
    expect([...state.files.values()]).toEqual(["encrypted-one"]);
  });
  it("does not overwrite a different custom provider in the existing integration slot", async () => {
    state.row = { id: "other", organization_id: "org", location_id: "room", provider: "other", adapter_version: "unrelated-v1" };
    await expect(saveMusicGrant(scope, clientId, "encrypted-one")).rejects.toThrow(/Another custom integration/);
    expect(state.files.size).toBe(0);
    await expect(disconnectMusic(scope)).rejects.toThrow(/another integration/);
    expect(state.row?.id).toBe("other");
  });
  it("holds one refresh lease and safely releases it", async () => {
    await saveMusicGrant(scope, clientId, "encrypted-one");
    const lease = await claimMusicRefresh(scope, (await readMusicConnection(scope))!);
    await expect(claimMusicRefresh(scope, (await readMusicConnection(scope))!)).rejects.toThrow(/refreshing/);
    await releaseMusicRefresh(scope, lease);
    expect((await readMusicConnection(scope))?.configuration.refreshLease).toBeNull();
  });
  it("disconnect removes current and obsolete scoped files while preserving another location", async () => {
    await saveMusicGrant(scope, clientId, "encrypted-one");
    state.files.set("org/room/00000000-0000-4000-8000-000000000001.bin", "retired");
    state.files.set("org/other/00000000-0000-4000-8000-000000000002.bin", "other-room");
    await disconnectMusic(scope);
    expect(state.row).toBeNull();
    expect([...state.files.values()]).toEqual(["other-room"]);
  });
});
