import { loadChurchBatchLabels, loadChurchBatchQueue } from "@/data/read-models/church-ingredient-batches.server";
import { canReadChurchIngredientEvidence, loadChurchIngredientEvidence } from "@/data/read-models/church-ingredient-evidence.server";
import { appSurface } from "@/lib/app-surface";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchBatchBoardScopeHeader, churchBatchBoardScopeValue, type ChurchBatchBoardSnapshot } from "@/lib/kitchen/church-batch-board";

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
  if (new URL(request.url).searchParams.size) return emptyResponse(400);

  try {
    const session = await resolveWorkspaceSession();
    if (session.status === "unauthenticated") return emptyResponse(401);
    if (session.status === "data_error" || session.status === "configuration_error") return emptyResponse(503);
    if (session.status !== "ready" || !canReadChurchIngredientEvidence(session.context)) return emptyResponse(403);

    const workspace = session.context;
    const scope = {
      organizationId: workspace.organization.id,
      locationId: workspace.activeLocation.id,
      userId: workspace.identity.userId,
    };
    if (request.headers.get(churchBatchBoardScopeHeader) !== churchBatchBoardScopeValue(scope)) return emptyResponse(403);

    const checkedAt = new Date().toISOString();
    const [evidence, records, queue] = await Promise.all([
      loadChurchIngredientEvidence(workspace),
      loadChurchBatchLabels(workspace),
      loadChurchBatchQueue(workspace),
    ]);
    if (!evidence || !records || !queue) return emptyResponse(403);
    if (!evidence.ok || !records.ok || !queue.ok) return emptyResponse(503);

    return Response.json({
      ...scope,
      checkedAt,
      evidence: evidence.data,
      records: records.data,
      queue: queue.data,
    } satisfies ChurchBatchBoardSnapshot, { headers });
  } catch {
    return emptyResponse(503);
  }
}
