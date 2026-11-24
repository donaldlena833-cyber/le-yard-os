import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { appSurface } from "@/lib/app-surface";
import {
  loadChurchSquareOrderWindow,
  verifyChurchSquareOrderWindowScope,
} from "@/data/read-models/church-square-order-window.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request) {
  if (appSurface !== "operations") return Response.json({ status: "not_found" }, { status: 404, headers });
  if (new URL(request.url).search) return Response.json({ status: "invalid_request" }, { status: 400, headers });

  try {
    const session = await resolveWorkspaceSession();
    if (session.status === "unauthenticated") return Response.json({ status: "unauthenticated" }, { status: 401, headers });
    if (session.status === "data_error" || session.status === "configuration_error") {
      return Response.json({ status: "unavailable" }, { status: 503, headers });
    }
    if (session.status !== "ready" || !await verifyChurchSquareOrderWindowScope(session.context)) {
      return Response.json({ status: "forbidden" }, { status: 403, headers });
    }

    const window = await loadChurchSquareOrderWindow();
    if (!window) return Response.json({ status: "setup_pending" }, { status: 503, headers });
    return Response.json(window, { headers });
  } catch {
    return Response.json({ status: "unavailable" }, { status: 503, headers });
  }
}
