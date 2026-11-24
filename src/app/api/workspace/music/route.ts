import { NextResponse } from "next/server";
import { z } from "zod";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { verifyChurchMusicScope } from "@/data/read-models/church-music.server";
import { appSurface } from "@/lib/app-surface";
import { musicRequest } from "@/lib/integrations/music";
import { runMusicRequest } from "@/lib/integrations/music.server";
import { beginMusicOAuth, MUSIC_OAUTH_COOKIE, musicCookieOptions } from "@/lib/integrations/music-oauth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;
const headers = { "Cache-Control": "private, no-store, max-age=0", Vary: "Cookie", "X-Content-Type-Options": "nosniff", "Referrer-Policy": "no-referrer" };
const respond = (status: number, message: string) => NextResponse.json({ message }, { status, headers });

export async function POST(request: Request) {
  if (appSurface !== "operations") return respond(404, "Not found.");
  const url = new URL(request.url);
  if (request.headers.get("origin") !== url.origin || request.headers.get("sec-fetch-site") === "cross-site") return respond(403, "Request not allowed.");
  if (url.search || request.headers.get("content-type")?.split(";", 1)[0].trim() !== "application/json") return respond(400, "Invalid music request.");
  try {
    const session = await resolveWorkspaceSession();
    if (session.status === "unauthenticated") return respond(401, "Sign in to Operations.");
    if (session.status === "data_error" || session.status === "configuration_error") return respond(503, "Operations is unavailable. Try again.");
    if (session.status !== "ready" || !await verifyChurchMusicScope(session.context)) return respond(403, "Music requires Church Street owner or admin access.");
    if (Number(request.headers.get("content-length")) > 4096) return respond(413, "Music request is too large.");
    const reader = request.body?.getReader();
    if (!reader) return respond(400, "Invalid music request.");
    let length = 0;
    const chunks: Uint8Array[] = [];
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        length += value.byteLength;
        if (length > 4096) { await reader.cancel(); return respond(413, "Music request is too large."); }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    const input = musicRequest.parse(JSON.parse(Buffer.concat(chunks, length).toString("utf8")));
    const scope = { organizationId: session.context.organization.id, locationId: session.context.activeLocation.id, userId: session.context.identity.userId };
    if (input.action === "connect") {
      const authorization = beginMusicOAuth(scope, input.clientId);
      const response = NextResponse.json({ authorizeUrl: authorization.url }, { headers });
      response.cookies.set(MUSIC_OAUTH_COOKIE, authorization.cookie, musicCookieOptions);
      return response;
    }
    return NextResponse.json(await runMusicRequest(scope, input), { headers });
  } catch (error) {
    const invalid = error instanceof SyntaxError || error instanceof z.ZodError;
    return respond(invalid ? 400 : 503, invalid ? "Invalid music request." : "Music could not be checked. Refresh before trying again.");
  }
}
