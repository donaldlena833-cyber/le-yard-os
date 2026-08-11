import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REALTIME_OPERATIONAL_TABLES } from "@/lib/realtime/publication-contract";

describe("Realtime publication contract", () => {
  it("keeps the generated publication migration aligned with browser bindings", () => {
    const migrationDirectory = join(process.cwd(), "supabase", "migrations");
    const migrationName = readdirSync(migrationDirectory).find((name) =>
      name.endsWith("_realtime_operational_invalidation_publication.sql"),
    );
    expect(migrationName).toBeTruthy();

    const sql = readFileSync(join(migrationDirectory, migrationName!), "utf8");
    const list = sql.match(
      /foreach table_name in array array\[([\s\S]*?)\]\s*loop/,
    );
    expect(list).toBeTruthy();
    const migrationTables = Array.from(
      list![1].matchAll(/'([a-z_]+)'/g),
      (match) => match[1],
    );

    expect(migrationTables).toEqual([...REALTIME_OPERATIONAL_TABLES]);
    expect(sql).not.toMatch(/['"]income_sales_checks['"]/);
    expect(sql).not.toMatch(/replica identity full/i);
  });
});
