import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

const temporaryDirectories: string[] = [];

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

function approvedConfig() {
  return {
    organization: {
      name: "North River Hospitality",
      slug: "north-river-hospitality",
      timezone: "America/New_York",
      currencyCode: "USD",
    },
    locations: [{
      name: "Garden Room",
      code: "GARDEN",
      timezone: "America/New_York",
      phone: "+1 212 555 0147",
      address: {
        line1: "10 Orchard Street",
        line2: null,
        city: "New York",
        region: "NY",
        postalCode: "10002",
        country: "US",
      },
    }],
  };
}

function runBootstrap(config: unknown, extraEnvironment: Record<string, string> = {}) {
  const directory = mkdtempSync(join(tmpdir(), "le-yard-bootstrap-"));
  temporaryDirectories.push(directory);
  const configPath = join(directory, "approved.json");
  writeFileSync(configPath, JSON.stringify(config));
  return spawnSync(
    process.execPath,
    [resolve("scripts/bootstrap-initial-owners.mjs"), "--config", configPath, ...(extraEnvironment.EXECUTE === "true" ? ["--execute"] : [])],
    {
      cwd: resolve("."),
      encoding: "utf8",
      env: {
        ...process.env,
        OWNER_1_EMAIL: "owner-one@north-river.test",
        OWNER_1_DISPLAY_NAME: "Owner One",
        OWNER_2_EMAIL: "owner-two@north-river.test",
        OWNER_2_DISPLAY_NAME: "Owner Two",
        ...extraEnvironment,
      },
    },
  );
}

describe("initial Owner bootstrap CLI", () => {
  it("creates a deterministic, non-mutating plan before credentials are needed", () => {
    const first = runBootstrap(approvedConfig());
    const second = runBootstrap(approvedConfig());

    expect(first.status).toBe(0);
    expect(second.status).toBe(0);
    const firstPlan = JSON.parse(first.stdout.slice(0, first.stdout.indexOf("\nDry run only.")));
    const secondPlan = JSON.parse(second.stdout.slice(0, second.stdout.indexOf("\nDry run only.")));
    expect(firstPlan).toEqual(secondPlan);
    expect(firstPlan.mode).toBe("dry-run");
    expect(firstPlan.owners).toEqual([
      { displayName: "Owner One", email: "owner-one@north-river.test", role: "owner" },
      { displayName: "Owner Two", email: "owner-two@north-river.test", role: "owner" },
    ]);
    expect(firstPlan.confirmation).toMatch(/^bootstrap:[0-9a-f]{20}$/);
  });

  it("rejects unresolved restaurant placeholders", () => {
    const config = approvedConfig();
    config.organization.name = "REPLACE WITH RESTAURANT NAME";
    const result = runBootstrap(config);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("custom");
  });

  it("refuses execution without the exact plan confirmation before any network call", () => {
    const result = runBootstrap(approvedConfig(), {
      EXECUTE: "true",
      NEXT_PUBLIC_DEMO_MODE: "false",
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("LE_YARD_BOOTSTRAP_CONFIRM");
  });
});
