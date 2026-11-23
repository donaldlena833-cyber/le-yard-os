import { type NextRequest, NextResponse } from "next/server";
import { appSurface } from "@/lib/app-surface";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { verifyChurchMusicScope } from "@/data/read-models/church-music.server";
import { saveMusicAuthorization } from "@/lib/integrations/music.server";
import { MUSIC_OAUTH_COOKIE, musicCookieOptions, musicRedirectUri, validateMusicOAuth } from "@/lib/integrations/music-oauth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: NextRequest) {
  if (appSurface !== "operations") return new Response(null, { status: 404 });
  const result = new URL("/music", musicRedirectUri());
  result.searchParams.set("connection", "failed");
  try {
    const session = await resolveWorkspaceSession();
    if (session.status === "ready" && await verifyChurchMusicScope(session.context)) {
      const scope = { organizationId: session.context.organization.id, locationId: session.context.activeLocation.id, userId: session.context.identity.userId };
      const cookie = request.cookies.get(MUSIC_OAUTH_COOKIE)?.value;
      const state = request.nextUrl.searchParams.get("state");
      const code = request.nextUrl.searchParams.get("code");
      if (cookie && state) {
        const verified = validateMusicOAuth(cookie, state, scope);
        if (request.nextUrl.searchParams.has("error")) result.searchParams.set("connection", "declined");
        else if (code && code.length <= 4096) {
          await saveMusicAuthorization(scope, verified.clientId, code, verified.verifier, musicRedirectUri());
          result.searchParams.set("connection", "linked");
        }
      }
    }
  } catch { /* Never return OAuth codes, grants or provider error bodies to the browser. */ }
  const response = NextResponse.redirect(result);
  response.cookies.set(MUSIC_OAUTH_COOKIE, "", { ...musicCookieOptions, maxAge: 0 });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
