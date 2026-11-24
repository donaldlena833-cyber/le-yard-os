import "server-only";
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

function key() {
  const encoded = process.env.MUSIC_TOKEN_ENCRYPTION_KEY?.trim() ?? "";
  const value = Buffer.from(encoded, "base64");
  if (value.length !== 32 || value.toString("base64") !== encoded) throw new Error("Music connection setup is incomplete.");
  return value;
}
export function musicEncryptionReady() {
  try { key(); return true; } catch { return false; }
}
export function sealMusicValue(value: unknown, purpose: string) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), nonce);
  cipher.setAAD(Buffer.from(`le-yard-music-v1:${purpose}`));
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value)), cipher.final()]);
  return Buffer.concat([nonce, cipher.getAuthTag(), ciphertext]).toString("base64url");
}
export function openMusicValue(value: string, purpose: string): unknown {
  const bytes = Buffer.from(value, "base64url");
  if (bytes.length < 29 || bytes.length > 20000) throw new Error("Invalid music connection.");
  const decipher = createDecipheriv("aes-256-gcm", key(), bytes.subarray(0, 12));
  decipher.setAAD(Buffer.from(`le-yard-music-v1:${purpose}`));
  decipher.setAuthTag(bytes.subarray(12, 28));
  return JSON.parse(Buffer.concat([decipher.update(bytes.subarray(28)), decipher.final()]).toString("utf8"));
}
