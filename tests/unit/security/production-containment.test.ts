import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";

function run(environment: Record<string, string | undefined>) {
  return spawnSync(process.execPath, [resolve("scripts/verify-production-containment.mjs")], {
    cwd: resolve("."),
    encoding: "utf8",
    env: { ...process.env, ...environment },
  });
}

describe("production containment", () => {
  it("accepts only the synthetic production playground contract", () => {
    const result = run({
      VERCEL_ENV: "production",
      LE_YARD_PLAYGROUND_MODE: "production-playground",
      NEXT_PUBLIC_DEMO_MODE: "true",
      LE_YARD_PLAYGROUND_SESSION_SECRET: "configured",
      LE_YARD_PLAYGROUND_USERS_JSON: "configured",
      NEXT_PUBLIC_SUPABASE_URL: "",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
      SUPABASE_SECRET_KEY: "",
    });
    expect(result.status).toBe(0);
  });

  it("rejects connected production", () => {
    const result = run({
      VERCEL_ENV: "production",
      LE_YARD_PLAYGROUND_MODE: "production-playground",
      NEXT_PUBLIC_DEMO_MODE: "false",
      LE_YARD_PLAYGROUND_SESSION_SECRET: "configured",
      LE_YARD_PLAYGROUND_USERS_JSON: "configured",
      NEXT_PUBLIC_SUPABASE_URL: "https://example.supabase.co",
    });
    expect(result.status).toBe(1);
  });
});
