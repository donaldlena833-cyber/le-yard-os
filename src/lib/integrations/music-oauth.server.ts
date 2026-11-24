import "server-only";
import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import { z } from "zod";
import type { MusicScope } from "./music.server";
import { MUSIC_SCOPES } from "./music.server";
import { openMusicValue, sealMusicValue } from "./music-crypto.server";

export const MUSIC_OAUTH_COOKIE = "__Host-le-yard-music-link";
export const musicCookieOptions = { httpOnly: true, secure: true, sameSite: "lax" as const, path: "/", maxAge: 600 };
const stateSchema = z.object({
  state: z.string().length(43), verifier: z.string().min(43).max(128), clientId: z.string().regex(/^[a-f0-9]{32}$/),
  organizationId: z.string().uuid(), locationId: z.string().uuid(), userId: z.string().uuid(), createdAt: z.number(),
});
export function musicRedirectUri() {
  const origin = new URL(process.env.NEXT_PUBLIC_APP_URL ?? "");
  if (origin.protocol !== "https:" || origin.username || origin.password || origin.search || origin.hash) throw new Error("Music callback configuration is unavailable.");
  return new URL("/api/workspace/music/callback", origin.origin).href;
}
export function beginMusicOAuth(scope: MusicScope, clientId: string) {
  const state = randomBytes(32).toString("base64url");
  const verifier = randomBytes(48).toString("base64url");
  const url = new URL("https://accounts.spotify.com/authorize");
  url.search = new URLSearchParams({ response_type: "code", client_id: clientId, scope: MUSIC_SCOPES,
    redirect_uri: musicRedirectUri(), state, code_challenge_method: "S256",
    code_challenge: createHash("sha256").update(verifier).digest("base64url"), show_dialog: "true" }).toString();
  return { url: url.href, cookie: sealMusicValue({ ...scope, state, verifier, clientId, createdAt: Date.now() }, "oauth") };
}
export function validateMusicOAuth(cookie: string, state: string, scope: MusicScope, now = Date.now()) {
  const parsed = stateSchema.parse(openMusicValue(cookie, "oauth"));
  const actual = Buffer.from(state);
  const expected = Buffer.from(parsed.state);
  if (actual.length !== expected.length || !timingSafeEqual(actual, expected)
    || now < parsed.createdAt || now - parsed.createdAt > 600_000
    || parsed.organizationId !== scope.organizationId || parsed.locationId !== scope.locationId || parsed.userId !== scope.userId) {
    throw new Error("Spotify link expired or workspace changed. Start again from Music.");
  }
  return parsed;
}
