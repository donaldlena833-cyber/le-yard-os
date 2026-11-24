import { after } from "next/server";
import { verifyChurchSquareOrderWindowScope } from "@/data/read-models/church-square-order-window.server";
import { appSurface } from "@/lib/app-surface";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { processChurchSquareReceipts } from "@/lib/integrations/church-square-event-worker.server";
import { churchSquareReconciliationResponse } from "@/lib/integrations/church-square-reconciliation";
import { createClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 45;

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request) {
  if (appSurface !== "operations") return new Response(null, { status: 404, headers });
  if (new URL(request.url).search) return new Response(null, { status: 400, headers });
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403, headers });

  try {
    const session = await resolveWorkspaceSession();
    if (session.status === "unauthenticated") return new Response(null, { status: 401, headers });
    if (session.status === "data_error" || session.status === "configuration_error") {
      return new Response(null, { status: 503, headers });
    }
    if (session.status !== "ready" || !await verifyChurchSquareOrderWindowScope(session.context)) {
      return new Response(null, { status: 403, headers });
    }

    const client = await createClient();
    const { data, error } = await client.rpc("list_church_square_reconciliation", {
      p_location_id: session.context.activeLocation.id,
    }).abortSignal(AbortSignal.timeout(6_000));
    if (error) return new Response(null, { status: error.code === "42501" ? 403 : 503, headers });

    const result = churchSquareReconciliationResponse.safeParse(data);
    if (!result.success) return new Response(null, { status: 503, headers });
    if (result.data.pending > 0) after(processChurchSquareReceipts);
    return Response.json(result.data, { headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
