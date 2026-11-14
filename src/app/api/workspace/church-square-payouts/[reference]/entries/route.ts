import { verifyChurchSquareOrderWindowScope } from "@/data/read-models/church-square-order-window.server";
import { appSurface } from "@/lib/app-surface";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSquareResourceId } from "@/lib/integrations/church-square-order-projection";
import { churchSquarePayoutEntriesResponse } from "@/lib/integrations/church-square-payout-window";
import {
  ChurchSquarePayoutClient, ChurchSquarePayoutReadError, churchSquarePayoutConfiguration,
} from "@/lib/integrations/church-square-payouts.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 30;

const headers = {
  "Cache-Control": "private, no-store, max-age=0",
  Vary: "Cookie",
  "X-Content-Type-Options": "nosniff",
};
const maxCents = BigInt(Number.MAX_SAFE_INTEGER);

function safeCents(amount: bigint) {
  return amount >= -maxCents && amount <= maxCents ? Number(amount) : null;
}

function unavailable(status: "setup_pending" | "payout_permission_unavailable" | "unavailable" = "unavailable") {
  return Response.json({ status }, { status: 503, headers });
}

export async function GET(request: Request, { params }: { params: Promise<{ reference: string }> }) {
  if (appSurface !== "operations") return new Response(null, { status: 404, headers });
  if (new URL(request.url).search) return new Response(null, { status: 400, headers });
  if (request.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403, headers });
  const reference = churchSquareResourceId.safeParse((await params).reference);
  if (!reference.success) return new Response(null, { status: 400, headers });

  try {
    const session = await resolveWorkspaceSession();
    if (session.status === "unauthenticated") return new Response(null, { status: 401, headers });
    if (session.status === "data_error" || session.status === "configuration_error") return unavailable();
    if (session.status !== "ready" || !await verifyChurchSquareOrderWindowScope(session.context)) {
      return new Response(null, { status: 403, headers });
    }

    const config = churchSquarePayoutConfiguration();
    if (!config) return unavailable("setup_pending");
    const result = await new ChurchSquarePayoutClient(config).getPayoutEntries(reference.data);
    if (!result) return new Response(null, { status: 404, headers });

    const { payout, entries, hasMore } = result;
    if (payout.id !== reference.data) return unavailable();
    const allNetCents = entries.map(({ netCents }) => netCents);
    const netTotalCents = !hasMore && allNetCents.length > 0 && allNetCents.every((value) => value !== null)
      ? safeCents(allNetCents.reduce((sum, value) => sum + BigInt(value), BigInt(0))) : null;
    const differenceCents = payout.payoutType === "BATCH" && payout.amountCents !== null && netTotalCents !== null
      ? safeCents(BigInt(netTotalCents) - BigInt(payout.amountCents)) : null;
    const projection = churchSquarePayoutEntriesResponse.safeParse({
      reference: reference.data, checkedAt: new Date().toISOString(), payoutType: payout.payoutType,
      amountCents: payout.amountCents, hasMore, entries, netTotalCents, differenceCents,
    });
    return projection.success ? Response.json(projection.data, { headers }) : unavailable();
  } catch (error) {
    if (error instanceof ChurchSquarePayoutReadError && (error.status === 401 || error.status === 403)) {
      return unavailable("payout_permission_unavailable");
    }
    return unavailable();
  }
}
