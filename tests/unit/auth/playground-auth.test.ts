import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  PLAYGROUND_SESSION_TTL_SECONDS,
  assessPlaygroundAuthConfiguration,
  authenticatePlaygroundCredentials,
  createPlaygroundPasswordHash,
  createPlaygroundSessionSecret,
  createPlaygroundSessionToken,
  verifyPlaygroundSessionToken,
  type PlaygroundAuthConfiguration,
} from "@/lib/auth/playground-auth-core";

const secret = Buffer.from(
  Uint8Array.from({ length: 48 }, (_, index) => index + 1),
).toString("base64url");

function configuration(): PlaygroundAuthConfiguration {
  return {
    sessionSecret: secret,
    users: [
      {
        principal: "donald",
        username: "owner-one",
        passwordHash: createPlaygroundPasswordHash(
          "fixture-password-one1",
          Buffer.alloc(16, 1),
        ),
      },
      {
        principal: "maris",
        username: "owner-two",
        passwordHash: createPlaygroundPasswordHash(
          "fixture password two2",
          Buffer.alloc(16, 2),
        ),
      },
    ],
  };
}

function assessmentSource(config = configuration()) {
  return {
    mode: "preview",
    vercelEnvironment: "preview",
    sessionSecret: config.sessionSecret,
    usersJson: JSON.stringify(config.users),
  };
}

describe("playground authentication", () => {
  it("accepts exactly two salted owner credentials only in Vercel Preview", () => {
    const accepted = assessPlaygroundAuthConfiguration(assessmentSource());
    const wrongEnvironment = assessPlaygroundAuthConfiguration({
      ...assessmentSource(),
      vercelEnvironment: "production",
    });
    const incompleteUsers = assessPlaygroundAuthConfiguration({
      ...assessmentSource(),
      usersJson: JSON.stringify([configuration().users[0]]),
    });

    expect(accepted.ready).toBe(true);
    expect(accepted.configuration?.users.map((user) => user.principal)).toEqual([
      "donald",
      "maris",
    ]);
    expect(wrongEnvironment.ready).toBe(false);
    expect(wrongEnvironment.issues).toContain("playground_not_vercel_preview");
    expect(incompleteUsers.ready).toBe(false);
    expect(incompleteUsers.issues).toContain("playground_users_invalid");
  });

  it("accepts production-playground only in Vercel Production", () => {
    const accepted = assessPlaygroundAuthConfiguration({
      ...assessmentSource(),
      mode: "production-playground",
      vercelEnvironment: "production",
    });
    const wrongEnvironment = assessPlaygroundAuthConfiguration({
      ...assessmentSource(),
      mode: "production-playground",
      vercelEnvironment: "preview",
    });
    const previewModeInProduction = assessPlaygroundAuthConfiguration({
      ...assessmentSource(),
      vercelEnvironment: "production",
    });
    const nearMiss = assessPlaygroundAuthConfiguration({
      ...assessmentSource(),
      mode: "production",
      vercelEnvironment: "production",
    });
    const padded = assessPlaygroundAuthConfiguration({
      ...assessmentSource(),
      mode: " production-playground ",
      vercelEnvironment: "production",
    });

    expect(accepted.ready).toBe(true);
    expect(accepted.enabled).toBe(true);
    expect(wrongEnvironment.ready).toBe(false);
    expect(wrongEnvironment.issues).toContain(
      "playground_not_vercel_production",
    );
    expect(previewModeInProduction.ready).toBe(false);
    expect(previewModeInProduction.issues).toContain(
      "playground_not_vercel_preview",
    );
    expect(nearMiss.ready).toBe(false);
    expect(nearMiss.enabled).toBe(false);
    expect(nearMiss.issues).toContain("playground_mode_invalid");
    expect(padded.ready).toBe(false);
    expect(padded.issues).toContain("playground_mode_invalid");
  });

  it("authenticates each distinct username without storing plaintext", () => {
    const config = configuration();

    expect(
      authenticatePlaygroundCredentials(
        config,
        " OWNER-ONE ",
        "fixture-password-one1",
      ),
    ).toBe("donald");
    expect(
      authenticatePlaygroundCredentials(
        config,
        "owner-two",
        "fixture password two2",
      ),
    ).toBe("maris");
    expect(
      authenticatePlaygroundCredentials(config, "owner-one", "incorrect"),
    ).toBeNull();
    expect(
      authenticatePlaygroundCredentials(config, "unknown", "incorrect"),
    ).toBeNull();
    expect(config.users[0]?.passwordHash).not.toContain("fixture-password-one1");
  });

  it("requires an exact registry, distinct hashes, and a canonical high-entropy secret", () => {
    const config = configuration();
    const withUnknownField = config.users.map((user, index) =>
      index === 0 ? { ...user, password: "must-never-be-accepted" } : user,
    );
    const duplicateHash = config.users.map((user) => ({
      ...user,
      passwordHash: config.users[0]!.passwordHash,
    }));
    const repeatedSecret = "A".repeat(64);

    expect(
      assessPlaygroundAuthConfiguration({
        ...assessmentSource(),
        usersJson: JSON.stringify(withUnknownField),
      }).issues,
    ).toContain("playground_users_invalid");
    expect(
      assessPlaygroundAuthConfiguration({
        ...assessmentSource(),
        usersJson: JSON.stringify(duplicateHash),
      }).issues,
    ).toContain("playground_users_invalid");
    expect(
      assessPlaygroundAuthConfiguration({
        ...assessmentSource(),
        sessionSecret: repeatedSecret,
      }).issues,
    ).toContain("playground_session_secret_invalid");

    const generated = createPlaygroundSessionSecret();
    expect(generated).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(
      assessPlaygroundAuthConfiguration({
        ...assessmentSource(),
        sessionSecret: generated,
      }).ready,
    ).toBe(true);
  });

  it("refuses to create weak preview password hashes", () => {
    expect(() =>
      createPlaygroundPasswordHash("short1", Buffer.alloc(16, 3)),
    ).toThrow(/10–128/);
    expect(() =>
      createPlaygroundPasswordHash("letters-only", Buffer.alloc(16, 3)),
    ).toThrow(/letter and number/);
  });

  it("issues signed eight-hour sessions and rejects tampering or expiry", () => {
    const config = configuration();
    const issuedAt = 2_000_000_000;
    const token = createPlaygroundSessionToken(config, "maris", issuedAt);
    const tampered = `${token.slice(0, -1)}${token.endsWith("a") ? "b" : "a"}`;

    expect(verifyPlaygroundSessionToken(config, token, issuedAt + 1)).toBe("maris");
    expect(
      verifyPlaygroundSessionToken(
        config,
        token,
        issuedAt + PLAYGROUND_SESSION_TTL_SECONDS,
      ),
    ).toBeNull();
    expect(verifyPlaygroundSessionToken(config, tampered, issuedAt + 1)).toBeNull();
  });

  it("rejects a correctly signed token with an unexpected payload field", () => {
    const config = configuration();
    const payload = Buffer.from(
      JSON.stringify({
        v: 1,
        sub: "donald",
        iat: 2_000_000_000,
        exp: 2_000_000_000 + PLAYGROUND_SESSION_TTL_SECONDS,
        role: "owner",
      }),
    ).toString("base64url");
    const input = `v1.${payload}`;
    const signature = createHmac("sha256", config.sessionSecret)
      .update(input)
      .digest("base64url");

    expect(
      verifyPlaygroundSessionToken(config, `${input}.${signature}`, 2_000_000_001),
    ).toBeNull();
  });
});
