import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  assessPlaygroundAuthConfiguration,
  authenticatePlaygroundCredentials,
  createPlaygroundPasswordHash,
} from "@/lib/auth/playground-auth-core";

const scriptUrl = new URL(
  "../../../scripts/hash-playground-password.mjs",
  import.meta.url,
);
const scriptPath = fileURLToPath(scriptUrl);

describe("playground password hashing script", () => {
  it("reads the password from stdin and emits a compatible salted hash", () => {
    const fixturePassword = "fixture password from stdin7";
    const result = spawnSync(
      process.execPath,
      [scriptPath],
      { input: fixturePassword, encoding: "utf8" },
    );
    const { stdout, stderr } = result;
    const assessment = assessPlaygroundAuthConfiguration({
      mode: "preview",
      vercelEnvironment: "preview",
      sessionSecret: Buffer.from(
        Uint8Array.from({ length: 48 }, (_, index) => index + 1),
      ).toString("base64url"),
      usersJson: JSON.stringify([
        {
          principal: "donald",
          username: "owner-one",
          passwordHash: stdout,
        },
        {
          principal: "maris",
          username: "owner-two",
          passwordHash: createPlaygroundPasswordHash(
            "second fixture password8",
            Buffer.alloc(16, 9),
          ),
        },
      ]),
    });

    expect(stderr).toBe("");
    expect(result.status).toBe(0);
    expect(stdout).toMatch(/^scrypt-v1\$/);
    expect(stdout).not.toContain(fixturePassword);
    expect(assessment.ready).toBe(true);
    expect(
      authenticatePlaygroundCredentials(
        assessment.configuration!,
        "owner-one",
        fixturePassword,
      ),
    ).toBe("donald");
  });

  it("rejects empty stdin", () => {
    const result = spawnSync(process.execPath, [scriptPath], {
      input: "",
      encoding: "utf8",
    });
    expect(result.status).toBe(1);
    expect(result.stderr).toContain("standard input");
  });

  it("rejects short or composition-free passwords", () => {
    for (const input of ["short1", "letters-only-password"]) {
      const result = spawnSync(process.execPath, [scriptPath], {
        input,
        encoding: "utf8",
      });
      expect(result.status).toBe(1);
    }
  });
});
