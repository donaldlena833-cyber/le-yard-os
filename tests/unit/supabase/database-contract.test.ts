import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  PRIVATE_BUCKET_DATABASE_POLICIES,
  PRIVATE_BUCKETS,
} from "@/lib/storage/private-files";
import {
  DatabaseConstants,
  DatabaseObjectNames,
} from "@/types/database.generated";

const root = process.cwd();
const execFileAsync = promisify(execFile);

async function migrationSql() {
  const directory = join(root, "supabase", "migrations");
  const files = (await readdir(directory))
    .filter((file) => file.endsWith(".sql"))
    .sort();
  return (
    await Promise.all(files.map((file) => readFile(join(directory, file), "utf8")))
  ).join("\n");
}

function captures(source: string, pattern: RegExp): string[] {
  return [...source.matchAll(pattern)].map((match) => match[1]!).sort();
}

type PublicObjectKind = "Tables" | "Views" | "Functions" | "Enums";

function publicObjectKind(sqlKind: string): PublicObjectKind {
  switch (sqlKind.toLowerCase()) {
    case "table":
      return "Tables";
    case "view":
      return "Views";
    case "function":
      return "Functions";
    case "type":
      return "Enums";
    default:
      throw new Error(`Unsupported public SQL object kind: ${sqlKind}`);
  }
}

function finalMigratedObjectNames(
  source: string,
): Record<PublicObjectKind, Set<string>> {
  const names: Record<PublicObjectKind, Set<string>> = {
    Tables: new Set(),
    Views: new Set(),
    Functions: new Set(),
    Enums: new Set(),
  };
  const functionDefinitionCounts = new Map<string, number>();
  const events = source.matchAll(
    /\b(?:(create)(?:\s+or\s+replace)?\s+(?:materialized\s+)?(table|view|function|type)(?:\s+if\s+not\s+exists)?\s+public\.([a-z0-9_]+)|(drop)\s+(?:materialized\s+)?(table|view|function|type)(?:\s+if\s+exists)?\s+public\.([a-z0-9_]+)|(alter)\s+function\s+public\.([a-z0-9_]+)\s*\([^)]*\)\s+rename\s+to\s+([a-z0-9_]+))/gi,
  );
  for (const event of events) {
    const createdKind = event[2];
    const createdName = event[3];
    const droppedKind = event[5];
    const droppedName = event[6];
    const renamedFrom = event[8];
    const renamedTo = event[9];
    if (createdKind && createdName) {
      names[publicObjectKind(createdKind)].add(createdName);
      if (createdKind.toLowerCase() === "function") {
        functionDefinitionCounts.set(
          createdName,
          (functionDefinitionCounts.get(createdName) ?? 0) + 1,
        );
      }
    }
    if (droppedKind && droppedName) {
      if (droppedKind.toLowerCase() === "function") {
        const remaining = Math.max(
          0,
          (functionDefinitionCounts.get(droppedName) ?? 0) - 1,
        );
        functionDefinitionCounts.set(droppedName, remaining);
        if (remaining === 0) names.Functions.delete(droppedName);
      } else {
        names[publicObjectKind(droppedKind)].delete(droppedName);
      }
    }
    if (renamedFrom && renamedTo) {
      names.Functions.delete(renamedFrom);
      names.Functions.add(renamedTo);
    }
  }
  return names;
}

describe("generated Supabase contract", () => {
  it("is byte-for-byte current with the ordered migrations", async () => {
    await expect(
      execFileAsync(process.execPath, ["scripts/generate-database-types.mjs", "--check"], {
        cwd: root,
      }),
    ).resolves.toMatchObject({
      stdout: expect.stringContaining("Verified generated database contract"),
    });
  }, 30_000);

  it("exactly matches every final migrated public table, view, function, and enum", async () => {
    const sql = await migrationSql();
    const migratedNames = finalMigratedObjectNames(sql);
    for (const kind of ["Tables", "Views", "Functions", "Enums"] as const) {
      expect(
        [...DatabaseObjectNames.public[kind]].sort(),
        `Generated ${kind.toLowerCase()} differ from the final migrated schema`,
      ).toEqual([...migratedNames[kind]].sort());
    }
  });

  it("keeps enum constants aligned with the migrated enum values", () => {
    expect(DatabaseConstants.public.Enums.app_role).toEqual([
      "owner",
      "admin",
      "manager",
      "employee",
    ]);
    expect(DatabaseConstants.public.Enums.review_status).toEqual([
      "pending",
      "in_review",
      "approved",
      "rejected",
    ]);
    expect(DatabaseConstants.public.Enums.job_status).toContain("partially_succeeded");
  });

  it("types every private bucket declared by the storage migration", async () => {
    const sql = await migrationSql();
    const bucketInsert = sql.match(
      /insert into storage\.buckets[\s\S]*?on conflict \(id\) do update set public = false;/i,
    )?.[0];
    expect(bucketInsert).toBeTruthy();
    const migratedBuckets = captures(bucketInsert!, /\('([a-z0-9-]+)'/g);
    expect([...PRIVATE_BUCKETS].sort()).toEqual(migratedBuckets);
    expect(PRIVATE_BUCKET_DATABASE_POLICIES["employee-documents"].maxBytes).toBe(
      25 * 1_048_576,
    );
    expect(PRIVATE_BUCKET_DATABASE_POLICIES.imports.maxBytes).toBe(100 * 1_048_576);
  });
});
