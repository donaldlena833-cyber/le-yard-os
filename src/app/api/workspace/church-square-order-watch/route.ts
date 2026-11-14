import { z } from "zod";
import { canRequestChurchSquareOrderWindow } from "@/data/read-models/church-square-order-window.server";
import { appSurface } from "@/lib/app-surface";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSquareOrderWatchResponse } from "@/lib/integrations/church-square-order-watch";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 15;

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
  const location = z.uuid().safeParse(search.get("locationId"));
  if (!location.success || search.size !== 1) return emptyResponse(400);

  try {
    const session = await resolveWorkspaceSession();
    if (session.status === "unauthenticated") return emptyResponse(401);
    if (session.status === "data_error" || session.status === "configuration_error") return emptyResponse(503);
    if (session.status !== "ready" || session.context.activeLocation.id !== location.data
        || !canRequestChurchSquareOrderWindow(session.context)) return emptyResponse(403);

    const client = await createClient();
    const { data, error } = await client.rpc("list_church_square_order_watch", {
      p_location_id: session.context.activeLocation.id,
    }).abortSignal(AbortSignal.timeout(6_000));
    if (error) return emptyResponse(error.code === "42501" ? 403 : 503);

    const parsed = churchSquareOrderWatchResponse.safeParse(data);
    return parsed.success ? Response.json(parsed.data, { headers }) : emptyResponse(503);
  } catch {
    return emptyResponse(503);
  }
}
