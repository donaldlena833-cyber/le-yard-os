import { readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  EXPECTED_SCHEMA_CONTRACT,
  matchesRuntimeSchemaContract,
} from "@/lib/security/schema-contract";

describe("runtime schema contract", () => {
  it("tracks the newest checked-in migration", () => {
    const migrationHead = readdirSync(resolve(process.cwd(), "supabase/migrations"))
      .map((name) => name.match(/^(\d{14})_/)?.[1] ?? null)
      .filter((version): version is string => version !== null)
      .sort()
      .at(-1);

    expect(EXPECTED_SCHEMA_CONTRACT.migrationHead).toBe(migrationHead);
  });

  it("accepts the exact checked-in migration and function contract", () => {
    expect(matchesRuntimeSchemaContract({
      ...EXPECTED_SCHEMA_CONTRACT,
      publicFunctionCount: 1,
      tableFingerprint: "a".repeat(64),
      functionFingerprint: "b".repeat(64),
      accessFingerprint: "c".repeat(64),
      schemaFingerprint: "d".repeat(64),
      matchesExpected: true,
    })).toBe(true);
  });

  it.each([
    { migrationHead: "20260812013549" },
    { contractVersion: "runtime-schema-v0" },
    { matchesExpected: false },
    { schemaFingerprint: "not-a-fingerprint" },
  ])("rejects drift: %o", (drift) => {
    expect(
      matchesRuntimeSchemaContract({
        ...EXPECTED_SCHEMA_CONTRACT,
        publicFunctionCount: 1,
        tableFingerprint: "a".repeat(64),
        functionFingerprint: "b".repeat(64),
        accessFingerprint: "c".repeat(64),
        schemaFingerprint: "d".repeat(64),
        matchesExpected: true,
        ...drift,
      }),
    ).toBe(false);
  });
});
