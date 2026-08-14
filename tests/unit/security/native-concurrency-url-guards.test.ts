import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const harnesses = [
  {
    label: "reservation",
    path: resolve("scripts/verify-reservation-concurrency-postgres.mjs"),
    variable: "RESERVATION_TEST_DATABASE_URL",
  },
  {
    label: "schedule",
    path: resolve("scripts/verify-schedule-atomic-concurrency-postgres.mjs"),
    variable: "SCHEDULE_TEST_DATABASE_URL",
  },
] as const;

function runHarness(
  harness: (typeof harnesses)[number],
  value?: string,
) {
  const environment = { ...process.env };
  delete environment.RESERVATION_TEST_DATABASE_URL;
  delete environment.SCHEDULE_TEST_DATABASE_URL;
  if (value !== undefined) environment[harness.variable] = value;

  return spawnSync(process.execPath, [harness.path], {
    cwd: resolve("."),
    encoding: "utf8",
    env: environment,
    timeout: 5_000,
  });
}

describe("native PostgreSQL concurrency URL guards", () => {
  for (const harness of harnesses) {
    it(`${harness.label} refuses a missing control URL before connecting`, () => {
      const result = runHarness(harness);

      expect(result.status).toBe(1);
      expect(result.signal).toBeNull();
      expect(result.stderr).toContain("is required");
    });

    it(`${harness.label} refuses a remote host without exposing credentials`, () => {
      const username = "guard_remote_user";
      const password = "guard_remote_password";
      const hostname = "shared-db.invalid";
      const result = runHarness(
        harness,
        `postgresql://${username}:${password}@${hostname}:5432/postgres`,
      );
      const output = `${result.stdout}\n${result.stderr}`;

      expect(result.status).toBe(1);
      expect(result.signal).toBeNull();
      expect(output).toContain("shared and remote databases are refused");
      expect(output).not.toContain(username);
      expect(output).not.toContain(password);
      expect(output).not.toContain(hostname);
    });

    it(`${harness.label} refuses a loopback URL aimed at a non-control database`, () => {
      const result = runHarness(
        harness,
        "postgresql://postgres:local-only@127.0.0.1:5432/template1",
      );

      expect(result.status).toBe(1);
      expect(result.signal).toBeNull();
      expect(result.stderr).toContain("postgres control database");
    });
  }
});
