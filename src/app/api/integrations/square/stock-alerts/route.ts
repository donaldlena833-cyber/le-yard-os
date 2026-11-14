import { canViewChurchSquareStockAlerts, readChurchSquareStockAlerts } from "@/data/read-models/church-square-stock-alerts";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSquareWebhookConfiguration } from "@/lib/integrations/church-square-webhook.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  "Vary": "Cookie",
  "X-Content-Type-Options": "nosniff",
};

export async function GET(request: Request) {
  if (new URL(request.url).search) return new Response(null, { status: 400, headers });

  try {
    const session = await resolveWorkspaceSession();
    if (session.status === "unauthenticated") return new Response(null, { status: 401, headers });
    if (session.status === "no_access" || session.status === "no_location") {
      return new Response(null, { status: 403, headers });
    }
    if (session.status !== "ready") return new Response(null, { status: 503, headers });

    const { context } = session;
    if (!canViewChurchSquareStockAlerts(context) || !churchSquareWebhookConfiguration()) {
      return new Response(null, { status: 403, headers });
    }

    const result = await readChurchSquareStockAlerts(context.activeLocation.id);
    if (result.status !== "ready") {
      return new Response(null, { status: result.status === "denied" ? 403 : 503, headers });
    }
    return Response.json({
      organizationId: context.organization.id,
      locationId: context.activeLocation.id,
      userId: context.identity.userId,
      alerts: result.alerts,
    }, { headers });
  } catch {
    return new Response(null, { status: 503, headers });
  }
}
