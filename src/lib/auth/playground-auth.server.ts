import "server-only";

import {
  assessPlaygroundAuthConfiguration,
  authenticatePlaygroundCredentials,
  createPlaygroundSessionToken,
  verifyPlaygroundSessionToken,
  type PlaygroundAuthAssessment,
  type PlaygroundPrincipalId,
} from "@/lib/auth/playground-auth-core";

export {
  PLAYGROUND_PASSWORD_MINIMUM_LENGTH,
  PLAYGROUND_REMEMBERED_SESSION_TTL_SECONDS,
  PLAYGROUND_SESSION_COOKIE,
  PLAYGROUND_SESSION_TTL_SECONDS,
} from "@/lib/auth/playground-auth-core";
export type { PlaygroundPrincipalId } from "@/lib/auth/playground-auth-core";

export function getPlaygroundAuthAssessment(): PlaygroundAuthAssessment {
  return assessPlaygroundAuthConfiguration({
    mode: process.env.LE_YARD_PLAYGROUND_MODE,
    vercelEnvironment: process.env.VERCEL_ENV,
    sessionSecret: process.env.LE_YARD_PLAYGROUND_SESSION_SECRET,
    usersJson: process.env.LE_YARD_PLAYGROUND_USERS_JSON,
  });
}

export function authenticatePlaygroundUser(
  identifier: string,
  password: string,
): PlaygroundPrincipalId | null {
  const configuration = getPlaygroundAuthAssessment().configuration;
  if (!configuration) return null;

  const primary = authenticatePlaygroundCredentials(
    configuration,
    identifier,
    password,
  );
  if (primary) return primary;

  const supplementalHash = process.env.LE_YARD_PLAYGROUND_DONALD_PASSWORD_HASH;
  const normalizedIdentifier = identifier
    .normalize("NFKC")
    .trim()
    .toLowerCase();
  if (!supplementalHash || normalizedIdentifier !== "donaldlena") return null;

  const supplementalConfiguration = {
    ...configuration,
    users: configuration.users.map((user) =>
      user.principal === "donald"
        ? {
            ...user,
            username: "donaldlena",
            passwordHash: supplementalHash,
          }
        : user,
    ),
  };
  return authenticatePlaygroundCredentials(
    supplementalConfiguration,
    identifier,
    password,
  );
}

export function issuePlaygroundSessionToken(
  principal: PlaygroundPrincipalId,
  ttlSeconds: number,
): string | null {
  const configuration = getPlaygroundAuthAssessment().configuration;
  return configuration
    ? createPlaygroundSessionToken(
        configuration,
        principal,
        Math.floor(Date.now() / 1_000),
        ttlSeconds,
      )
    : null;
}

export function readPlaygroundSessionToken(
  token: string | null | undefined,
): PlaygroundPrincipalId | null {
  const configuration = getPlaygroundAuthAssessment().configuration;
  return configuration
    ? verifyPlaygroundSessionToken(configuration, token)
    : null;
}
