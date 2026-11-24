import { type NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { appSurface } from "@/lib/app-surface";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { verifyChurchMusicScope } from "@/data/read-models/church-music.server";
import { MusicError, saveMusicAuthorization } from "@/lib/integrations/music.server";
import { MusicStoreError } from "@/lib/integrations/music-store.server";
import { MUSIC_OAUTH_COOKIE, musicCookieOptions, musicRedirectUri, validateMusicOAuth } from "@/lib/integrations/music-oauth.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;
export async function GET(request: NextRequest) {
  if (appSurface !== "operations") return new Response(null, { status: 404 });
  const result = new URL("/music", musicRedirectUri());
  result.searchParams.set("connection", "failed");
  let stage = "session";
  try {
    const session = await resolveWorkspaceSession();
    stage = "workspace_scope";
    if (session.status === "ready" && await verifyChurchMusicScope(session.context)) {
      const scope = { organizationId: session.context.organization.id, locationId: session.context.activeLocation.id, userId: session.context.identity.userId };
      const cookie = request.cookies.get(MUSIC_OAUTH_COOKIE)?.value;
      const state = request.nextUrl.searchParams.get("state");
      const code = request.nextUrl.searchParams.get("code");
      stage = "state_cookie";
      if (cookie && state) {
        stage = "state_validation";
        const verified = validateMusicOAuth(cookie, state, scope);
        if (request.nextUrl.searchParams.has("error")) result.searchParams.set("connection", "declined");
        else if (code && code.length <= 4096) {
          stage = "authorization_save";
          await saveMusicAuthorization(scope, verified.clientId, code, verified.verifier, musicRedirectUri());
          result.searchParams.set("connection", "linked");
        }
      }
    }
  } catch (error) {
    // These two classes contain application-authored messages only. Never log
    // OAuth codes, cookies, grants, provider bodies, or arbitrary error messages.
    console.warn("music_oauth_failed", { stage,
      reason: error instanceof MusicError || error instanceof MusicStoreError ? error.message : "validation_or_transport_failure",
      ...(error instanceof z.ZodError ? { fields: error.issues.map((issue) => issue.path.join(".")).slice(0, 8) } : {}),
    });
    stage = "reported";
  }
  if (result.searchParams.get("connection") === "failed" && stage !== "reported") console.warn("music_oauth_failed", { stage, reason: "incomplete_flow" });
  const response = NextResponse.redirect(result);
  response.cookies.set(MUSIC_OAUTH_COOKIE, "", { ...musicCookieOptions, maxAge: 0 });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Referrer-Policy", "no-referrer");
  return response;
}
