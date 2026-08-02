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
  return configuration
    ? authenticatePlaygroundCredentials(configuration, identifier, password)
    : null;
}

export function issuePlaygroundSessionToken(
  principal: PlaygroundPrincipalId,
): string | null {
  const configuration = getPlaygroundAuthAssessment().configuration;
  return configuration
    ? createPlaygroundSessionToken(configuration, principal)
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
