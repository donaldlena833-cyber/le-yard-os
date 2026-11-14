import { z } from "zod";
import { churchSquareCloseWindow, loadChurchSquareClosePreview } from "@/data/read-models/church-square-close-preview.server";
import { verifyChurchSquareOrderWindowScope } from "@/data/read-models/church-square-order-window.server";
import { appSurface } from "@/lib/app-surface";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSquareClosePreviewResponse } from "@/lib/integrations/church-square-close-preview";
import { ChurchSquareOrderClient, churchSquareOrderConfiguration } from "@/lib/integrations/church-square-orders.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

function emptyResponse(status: number) {
  return new Response(null, { status, headers });
}

export async function GET(request: Request) {
  if (appSurface !== "operations") return emptyResponse(404);
  if (request.headers.get("sec-fetch-site") === "cross-site") return emptyResponse(403);

  const search = new URL(request.url).searchParams;
  const date = search.get("date");
  const location = z.uuid().safeParse(search.get("locationId"));
  if (!date || !location.success || search.size !== 2) return emptyResponse(400);
  const now = new Date();
  const window = churchSquareCloseWindow(date, now);
  if (!window) return emptyResponse(400);

  try {
    const session = await resolveWorkspaceSession();
    if (session.status === "unauthenticated") return emptyResponse(401);
    if (session.status === "data_error" || session.status === "configuration_error") return emptyResponse(503);
    if (session.status !== "ready" || session.context.activeLocation.id !== location.data
        || !await verifyChurchSquareOrderWindowScope(session.context)) return emptyResponse(403);

    const config = churchSquareOrderConfiguration();
    if (!config) return emptyResponse(503);
    const preview = await loadChurchSquareClosePreview(new ChurchSquareOrderClient(config), date, now, window);
    if (preview.payments.coverage === "unavailable" && preview.refunds.coverage === "unavailable") return emptyResponse(503);
    const parsed = churchSquareClosePreviewResponse.safeParse(preview);
    return parsed.success ? Response.json(parsed.data, { headers }) : emptyResponse(503);
  } catch {
    return emptyResponse(503);
  }
}
