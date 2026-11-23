import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { describe, expect, it } from "vitest";

describe("music grant storage", () => {
  it("denies anonymous and staff access to encrypted grants and enforces location ownership", async () => {
    const db = new PGlite();
    try {
      await db.exec(`create schema auth; create role anon; create role authenticated; create role service_role bypassrls;
        create table auth.users (id uuid primary key);
        create table public.organizations (id uuid primary key);
        create table public.locations (id uuid primary key, organization_id uuid, unique(organization_id,id));
        create schema private;
        create table private.runtime_schema_contract_expected (contract_version text, migration_head text, table_fingerprint text, function_fingerprint text, access_fingerprint text, captured_at timestamptz);
        insert into private.runtime_schema_contract_expected (contract_version) values ('runtime-schema-v2');
        create function private.compute_runtime_schema_fingerprints() returns jsonb language sql as $$ select '{"tableFingerprint":"test-table","functionFingerprint":"test-function","accessFingerprint":"test-access"}'::jsonb $$;`);
      await db.exec(await readFile(new URL("../../../supabase/migrations/20261123190628_church_music_connection.sql", import.meta.url), "utf8"));
      for (const role of ["anon", "authenticated"]) {
        for (const statement of ["select * from public.music_connections", "delete from public.music_connections", "update public.music_connections set client_id = repeat('a',32)", "insert into public.music_connections default values"]) {
          await db.exec(`set role ${role}`);
          await expect(db.exec(statement)).rejects.toThrow(/permission denied/);
          await db.exec("reset role");
        }
      }
      const permission = await db.query<{ rls: boolean; forced: boolean }>("select relrowsecurity as rls, relforcerowsecurity as forced from pg_class where oid = 'public.music_connections'::regclass");
      expect(permission.rows[0]).toEqual({ rls: true, forced: true });
      expect((await db.query<{ migration_head: string }>("select migration_head from private.runtime_schema_contract_expected")).rows[0].migration_head).toBe("20261123190628");
      await db.exec(`insert into organizations values ('00000000-0000-4000-8000-000000000001'), ('00000000-0000-4000-8000-000000000002');
        insert into locations values ('00000000-0000-4000-8000-000000000003','00000000-0000-4000-8000-000000000002');
        insert into auth.users values ('00000000-0000-4000-8000-000000000004');`);
      await expect(db.exec(`insert into music_connections (organization_id,location_id,client_id,encrypted_grant,connected_by)
        values ('00000000-0000-4000-8000-000000000001','00000000-0000-4000-8000-000000000003',repeat('a',32),repeat('x',40),'00000000-0000-4000-8000-000000000004')`)).rejects.toThrow(/foreign key/);
    } finally { await db.close(); }
  });
});
