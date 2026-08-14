import {
  createHmac,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from "node:crypto";

export const PLAYGROUND_SESSION_COOKIE = "__Host-le-yard-playground-session";
export const PLAYGROUND_SESSION_TTL_SECONDS = 8 * 60 * 60;
export const PLAYGROUND_REMEMBERED_SESSION_TTL_SECONDS = 30 * 24 * 60 * 60;
export const PLAYGROUND_PASSWORD_MINIMUM_LENGTH = 9;

export type PlaygroundPrincipalId = "donald" | "maris" | "irini" | "mateo";

export interface PlaygroundUser {
  principal: PlaygroundPrincipalId;
  username: string;
  passwordHash: string;
}

export interface PlaygroundAuthConfiguration {
  sessionSecret: string;
  users: readonly PlaygroundUser[];
}

export type PlaygroundAuthConfigurationIssue =
  | "playground_mode_missing"
  | "playground_mode_invalid"
  | "playground_not_vercel_preview"
  | "playground_not_vercel_production"
  | "playground_session_secret_missing"
  | "playground_session_secret_invalid"
  | "playground_users_missing"
  | "playground_users_invalid";

export interface PlaygroundAuthAssessment {
  enabled: boolean;
  ready: boolean;
  issues: readonly PlaygroundAuthConfigurationIssue[];
  configuration: PlaygroundAuthConfiguration | null;
}

interface PlaygroundAuthSource {
  mode?: string;
  vercelEnvironment?: string;
  sessionSecret?: string;
  usersJson?: string;
}

interface PlaygroundSessionPayload {
  v: 1;
  sub: PlaygroundPrincipalId;
  iat: number;
  exp: number;
}

const PRINCIPALS: readonly PlaygroundPrincipalId[] = [
  "donald",
  "maris",
  "irini",
  "mateo",
];
const USERNAME_PATTERN = /^[a-z0-9](?:[a-z0-9._-]{1,62}[a-z0-9])?$/;
const HASH_PREFIX = "scrypt-v1";
const ALLOWED_SESSION_TTLS = new Set([
  PLAYGROUND_SESSION_TTL_SECONDS,
  PLAYGROUND_REMEMBERED_SESSION_TTL_SECONDS,
]);
const SCRYPT_OPTIONS = {
  N: 16_384,
  r: 8,
  p: 1,
  maxmem: 64 * 1024 * 1024,
} as const;
const DUMMY_SALT = Buffer.from(
  "bGV5YXJkLXBsYXlncm91bmQtZHVtbXktc2FsdA",
  "base64url",
);
const DUMMY_DIGEST = scryptSync(
  "not-a-real-password",
  DUMMY_SALT,
  64,
  SCRYPT_OPTIONS,
);

function parseSessionSecret(value: string | undefined): string | null {
  if (!value || value !== value.trim() || !/^[A-Za-z0-9_-]{64}$/.test(value)) {
    return null;
  }
  try {
    const bytes = Buffer.from(value, "base64url");
    return bytes.length === 48 &&
      new Set(bytes).size >= 16 &&
      bytes.toString("base64url") === value
      ? value
      : null;
  } catch {
    return null;
  }
}

function meetsPlaygroundPasswordPolicy(password: string): boolean {
  return (
    password.length >= PLAYGROUND_PASSWORD_MINIMUM_LENGTH &&
    password.length <= 128 &&
    /[A-Za-z]/.test(password) &&
    /[0-9]/.test(password) &&
    !/[\u0000-\u001f\u007f]/.test(password)
  );
}

function normalizeUsername(value: string): string {
  return value.normalize("NFKC").trim().toLowerCase();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function parsePasswordHash(
  encoded: string,
): { salt: Buffer; digest: Buffer } | null {
  const parts = encoded.split("$");
  if (parts.length !== 3 || parts[0] !== HASH_PREFIX) return null;
  if (
    !/^[A-Za-z0-9_-]+$/.test(parts[1]!) ||
    !/^[A-Za-z0-9_-]+$/.test(parts[2]!)
  ) {
    return null;
  }

  try {
    const salt = Buffer.from(parts[1]!, "base64url");
    const digest = Buffer.from(parts[2]!, "base64url");
    if (salt.length < 16 || salt.length > 64 || digest.length !== 64)
      return null;
    if (salt.toString("base64url") !== parts[1]) return null;
    if (digest.toString("base64url") !== parts[2]) return null;
    return { salt, digest };
  } catch {
    return null;
  }
}

function parseUsers(value: string): readonly PlaygroundUser[] | null {
  let decoded: unknown;
  try {
    decoded = JSON.parse(value);
  } catch {
    return null;
  }

  if (!Array.isArray(decoded) || decoded.length !== PRINCIPALS.length)
    return null;

  const users: PlaygroundUser[] = [];
  for (const candidate of decoded) {
    if (!isRecord(candidate)) return null;
    if (
      Object.keys(candidate).sort().join(",") !==
      "passwordHash,principal,username"
    ) {
      return null;
    }
    if (
      typeof candidate.principal !== "string" ||
      !PRINCIPALS.includes(candidate.principal as PlaygroundPrincipalId) ||
      typeof candidate.username !== "string" ||
      typeof candidate.passwordHash !== "string"
    ) {
      return null;
    }

    const principal = candidate.principal as PlaygroundPrincipalId;
    const username = normalizeUsername(candidate.username);
    if (
      username !== candidate.username ||
      !USERNAME_PATTERN.test(username) ||
      !parsePasswordHash(candidate.passwordHash)
    ) {
      return null;
    }

    users.push({
      principal,
      username,
      passwordHash: candidate.passwordHash,
    });
  }

  if (
    new Set(users.map((user) => user.principal)).size !== PRINCIPALS.length ||
    new Set(users.map((user) => user.username)).size !== users.length ||
    new Set(users.map((user) => user.passwordHash)).size !== users.length ||
    !PRINCIPALS.every((principal) =>
      users.some((user) => user.principal === principal),
    )
  ) {
    return null;
  }

  return users.sort((left, right) =>
    left.principal.localeCompare(right.principal),
  );
}

export function assessPlaygroundAuthConfiguration(
  source: PlaygroundAuthSource,
): PlaygroundAuthAssessment {
  const issues: PlaygroundAuthConfigurationIssue[] = [];
  const mode = source.mode;
  const preview = mode === "preview";
  const production = mode === "production-playground";
  const enabled = preview || production;

  if (!mode) issues.push("playground_mode_missing");
  else if (!enabled) issues.push("playground_mode_invalid");
  if (preview && source.vercelEnvironment !== "preview") {
    issues.push("playground_not_vercel_preview");
  }
  if (production && source.vercelEnvironment !== "production") {
    issues.push("playground_not_vercel_production");
  }

  const rawSessionSecret = source.sessionSecret;
  const sessionSecret = parseSessionSecret(rawSessionSecret);
  if (!rawSessionSecret) issues.push("playground_session_secret_missing");
  else if (!sessionSecret) issues.push("playground_session_secret_invalid");

  const rawUsers = source.usersJson?.trim();
  const users = rawUsers ? parseUsers(rawUsers) : null;
  if (!rawUsers) issues.push("playground_users_missing");
  else if (!users) issues.push("playground_users_invalid");

  const ready =
    enabled && issues.length === 0 && Boolean(sessionSecret && users);
  return {
    enabled,
    ready,
    issues,
    configuration:
      ready && sessionSecret && users ? { sessionSecret, users } : null,
  };
}

export function createPlaygroundPasswordHash(
  password: string,
  salt: Buffer = randomBytes(16),
): string {
  if (!meetsPlaygroundPasswordPolicy(password)) {
    throw new Error(
      `Playground passwords must be ${PLAYGROUND_PASSWORD_MINIMUM_LENGTH}–128 characters and include a letter and number.`,
    );
  }
  if (salt.length < 16 || salt.length > 64) {
    throw new Error(
      "Playground password salts must be between 16 and 64 bytes.",
    );
  }

  const digest = scryptSync(password, salt, 64, SCRYPT_OPTIONS);
  return `${HASH_PREFIX}$${salt.toString("base64url")}$${digest.toString("base64url")}`;
}

export function createPlaygroundSessionSecret(): string {
  return randomBytes(48).toString("base64url");
}

export function authenticatePlaygroundCredentials(
  configuration: PlaygroundAuthConfiguration,
  identifier: string,
  password: string,
): PlaygroundPrincipalId | null {
  const username = normalizeUsername(identifier);
  const user = configuration.users.find(
    (candidate) => candidate.username === username,
  );
  const parsedHash = user ? parsePasswordHash(user.passwordHash) : null;
  const salt = parsedHash?.salt ?? DUMMY_SALT;
  const expected = parsedHash?.digest ?? DUMMY_DIGEST;

  let actual: Buffer;
  try {
    actual = scryptSync(
      password.length <= 128 ? password : "invalid-password-length",
      salt,
      64,
      SCRYPT_OPTIONS,
    );
  } catch {
    return null;
  }

  return user &&
    actual.length === expected.length &&
    timingSafeEqual(actual, expected)
    ? user.principal
    : null;
}

function signToken(signingInput: string, secret: string): Buffer {
  return createHmac("sha256", secret).update(signingInput).digest();
}

export function createPlaygroundSessionToken(
  configuration: PlaygroundAuthConfiguration,
  principal: PlaygroundPrincipalId,
  nowSeconds = Math.floor(Date.now() / 1_000),
  ttlSeconds = PLAYGROUND_SESSION_TTL_SECONDS,
): string {
  if (!configuration.users.some((user) => user.principal === principal)) {
    throw new Error("Unknown playground principal.");
  }
  if (!ALLOWED_SESSION_TTLS.has(ttlSeconds)) {
    throw new Error("Unsupported playground session duration.");
  }

  const payload: PlaygroundSessionPayload = {
    v: 1,
    sub: principal,
    iat: nowSeconds,
    exp: nowSeconds + ttlSeconds,
  };
  const encodedPayload = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  const signingInput = `v1.${encodedPayload}`;
  const signature = signToken(
    signingInput,
    configuration.sessionSecret,
  ).toString("base64url");
  return `${signingInput}.${signature}`;
}

function hasExactPayloadShape(
  value: Record<string, unknown>,
): value is Record<keyof PlaygroundSessionPayload, unknown> {
  return (
    Object.keys(value).sort().join(",") === "exp,iat,sub,v" &&
    value.v === 1 &&
    PRINCIPALS.includes(value.sub as PlaygroundPrincipalId) &&
    Number.isInteger(value.iat) &&
    Number.isInteger(value.exp)
  );
}

export function verifyPlaygroundSessionToken(
  configuration: PlaygroundAuthConfiguration,
  token: string | null | undefined,
  nowSeconds = Math.floor(Date.now() / 1_000),
): PlaygroundPrincipalId | null {
  if (!token || token.length > 2_048) return null;
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== "v1") return null;

  let suppliedSignature: Buffer;
  try {
    suppliedSignature = Buffer.from(parts[2]!, "base64url");
  } catch {
    return null;
  }
  const signingInput = `${parts[0]}.${parts[1]}`;
  const expectedSignature = signToken(
    signingInput,
    configuration.sessionSecret,
  );
  if (
    suppliedSignature.length !== expectedSignature.length ||
    !timingSafeEqual(suppliedSignature, expectedSignature)
  ) {
    return null;
  }

  let payload: unknown;
  try {
    payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
  } catch {
    return null;
  }
  if (!isRecord(payload) || !hasExactPayloadShape(payload)) return null;

  const issuedAt = payload.iat as number;
  const expiresAt = payload.exp as number;
  const principal = payload.sub as PlaygroundPrincipalId;
  if (
    issuedAt > nowSeconds + 60 ||
    expiresAt <= nowSeconds ||
    expiresAt <= issuedAt ||
    !ALLOWED_SESSION_TTLS.has(expiresAt - issuedAt) ||
    !configuration.users.some((user) => user.principal === principal)
  ) {
    return null;
  }

  return principal;
}
