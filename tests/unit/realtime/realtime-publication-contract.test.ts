import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { REALTIME_OPERATIONAL_TABLES } from "@/lib/realtime/publication-contract";

describe("Realtime publication contract", () => {
  it("keeps the generated publication migration aligned with browser bindings", () => {
    const migrationDirectory = join(process.cwd(), "supabase", "migrations");
    const publicationSql = readdirSync(migrationDirectory)
      .filter(
        (name) =>
          name.endsWith(".sql") &&
          name.includes("realtime") &&
          name.includes("invalidation"),
      )
      .map((name) => readFileSync(join(migrationDirectory, name), "utf8"))
      .filter((sql) =>
        /alter publication supabase_realtime add table/i.test(sql),
      );
    expect(publicationSql.length).toBeGreaterThan(0);

    const migrationTables = new Set<string>();
    for (const sql of publicationSql) {
      for (const list of sql.matchAll(
        /foreach table_name in array array\[([\s\S]*?)\]\s*loop/g,
      )) {
        for (const table of list[1].matchAll(/'([a-z_]+)'/g)) {
          migrationTables.add(table[1]);
        }
      }
      for (const direct of sql.matchAll(
        /alter publication supabase_realtime add table public\.([a-z_]+)/gi,
      )) {
        migrationTables.add(direct[1]);
      }
    }

    expect([...migrationTables].sort()).toEqual(
      [...REALTIME_OPERATIONAL_TABLES].sort(),
    );
    expect(publicationSql.join("\n")).not.toMatch(
      /['"]income_sales_checks['"]/,
    );
    expect(publicationSql.join("\n")).not.toMatch(/replica identity full/i);
    expect(publicationSql.join("\n")).toMatch(
      /alter publication supabase_realtime set\s*\(\s*publish\s*=\s*'insert, update'\s*\)/i,
    );
  });
});
