import { NextResponse } from "next/server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { workspaceAccessRevision } from "@/lib/auth/workspace-access.server";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const headers = { "Cache-Control": "private, no-store, max-age=0", "Vary": "Cookie", "X-Content-Type-Options": "nosniff" };
function unavailable(status = 503) {
  return NextResponse.json({ status: "unavailable" }, { status, headers });
}

export async function GET(request: Request) {
  // The endpoint accepts no browser-selected actor, tenant or location.
  if (new URL(request.url).search) return unavailable(400);
  try {
    const supabase = await createClient();
    const user = await supabase.auth.getUser();
    if (user.error) {
      return user.error.status === 401 || user.error.status === 403
        ? NextResponse.json({ status: "unauthenticated" }, { status: 401, headers })
        : unavailable();
    }
    if (!user.data.user) return NextResponse.json({ status: "unauthenticated" }, { status: 401, headers });
    const session = await resolveWorkspaceSession();
    if (session.status === "unauthenticated") return NextResponse.json({ status: "unauthenticated" }, { status: 401, headers });
    if (session.status === "no_access" || session.status === "no_location") return NextResponse.json({ status: "access_changed" }, { status: 403, headers });
    if (session.status !== "ready" || session.context.mode !== "live") return unavailable();
    if (session.context.identity.userId !== user.data.user.id) return unavailable();
    return NextResponse.json({ status: "ready", revision: workspaceAccessRevision(session.context) }, { headers });
  } catch {
    return unavailable();
  }
}
