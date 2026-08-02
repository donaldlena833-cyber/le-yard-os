import "server-only";

import { createCipheriv, createHash, randomBytes } from "node:crypto";

export interface BrowserPushSubscription {
  endpoint: string;
  expirationTime: number | null;
  keys: { p256dh: string; auth: string };
}

function readEncryptionKey(encoded = process.env.PUSH_SUBSCRIPTION_ENCRYPTION_KEY) {
  const normalized = encoded?.trim() ?? "";
  const key = Buffer.from(normalized, "base64");
  const canonical = key.toString("base64").replace(/=+$/u, "");
  if (key.length !== 32 || canonical !== normalized.replace(/=+$/u, "")) {
    throw new Error("PUSH_SUBSCRIPTION_ENCRYPTION_KEY must be a base64-encoded 32-byte key.");
  }
  return key;
}

export function pushEndpointHash(endpoint: string) {
  return createHash("sha256").update(endpoint, "utf8").digest("hex");
}

export function encryptPushSubscription(
  subscription: BrowserPushSubscription,
  encodedKey?: string,
) {
  const key = readEncryptionKey(encodedKey);
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, nonce);
  const plaintext = Buffer.from(JSON.stringify(subscription), "utf8");
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([Buffer.from([1]), nonce, tag, ciphertext]);
}
