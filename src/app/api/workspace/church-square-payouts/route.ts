import { verifyChurchSquareOrderWindowScope } from "@/data/read-models/church-square-order-window.server";
import { appSurface } from "@/lib/app-surface";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import {
  churchSquarePayoutWindowDays,
  churchSquarePayoutWindowLimit,
  churchSquarePayoutWindowResponse,
} from "@/lib/integrations/church-square-payout-window";
import {
  ChurchSquarePayoutClient,
  ChurchSquarePayoutReadError,
  churchSquarePayoutConfiguration,
} from "@/lib/integrations/church-square-payouts.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};

function unavailable(status: "setup_pending" | "payout_permission_unavailable" | "unavailable" = "unavailable") {
  return Response.json({ status }, { status: 503, headers });
}

export async function GET(request: Request) {
  if (appSurface !== "operations") return new Response(null, { status: 404, headers });
  if (new URL(request.url).search) return new Response(null, { status: 400, headers });
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403, headers });

  try {
    const session = await resolveWorkspaceSession();
    if (session.status === "unauthenticated") return new Response(null, { status: 401, headers });
    if (session.status === "data_error" || session.status === "configuration_error") return unavailable();
    if (session.status !== "ready" || !await verifyChurchSquareOrderWindowScope(session.context)) {
      return new Response(null, { status: 403, headers });
    }

    const config = churchSquarePayoutConfiguration();
    if (!config) return unavailable("setup_pending");
    const now = Date.now();
    const checkedAt = new Date(now).toISOString();
    const { payouts, nextCursor } = await new ChurchSquarePayoutClient(config).listPayouts({
      from: new Date(now - churchSquarePayoutWindowDays * 24 * 60 * 60 * 1_000).toISOString(),
      to: checkedAt,
    });
    const projection = churchSquarePayoutWindowResponse.safeParse({
      checkedAt,
      hasMore: Boolean(nextCursor) || payouts.length > churchSquarePayoutWindowLimit,
      payouts: payouts.slice(0, churchSquarePayoutWindowLimit).map((payout) => ({
        reference: payout.id,
        status: payout.status,
        amountCents: payout.amountCents,
        createdAt: payout.createdAt,
        updatedAt: payout.updatedAt,
        arrivalDate: payout.arrivalDate,
      })),
    });
    return projection.success ? Response.json(projection.data, { headers }) : unavailable();
  } catch (error) {
    if (error instanceof ChurchSquarePayoutReadError && (error.status === 401 || error.status === 403)) {
      return unavailable("payout_permission_unavailable");
    }
    return unavailable();
  }
}
