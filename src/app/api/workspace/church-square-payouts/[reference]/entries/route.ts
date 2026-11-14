import { verifyChurchSquareOrderWindowScope } from "@/data/read-models/church-square-order-window.server";
import { appSurface } from "@/lib/app-surface";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSquareResourceId } from "@/lib/integrations/church-square-order-projection";
import { ChurchSquareOrderClient } from "@/lib/integrations/church-square-orders.server";
import { churchSquarePayoutEntriesResponse, type ChurchSquarePayoutOrderEvidence } from "@/lib/integrations/church-square-payout-window";
import {
  ChurchSquarePayoutClient, ChurchSquarePayoutReadError, churchSquarePayoutConfiguration, type ChurchSquarePayoutEntries,
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
const maxTransactionLookups = 8;

type PayoutTransaction = NonNullable<ChurchSquarePayoutEntries["entries"][number]["transaction"]>;

async function verifyOrderLink(
  square: ChurchSquareOrderClient, transaction: PayoutTransaction, readOrder: (orderId: string) => Promise<unknown>, signal: AbortSignal,
): Promise<ChurchSquarePayoutOrderEvidence> {
  try {
    const resource = transaction.kind === "charge"
      ? await square.get("payment", transaction.paymentId, signal)
      : await square.get("refund", transaction.refundId, signal);
    if (resource.kind === "refund" && transaction.kind === "refund"
      && transaction.paymentId !== null && resource.paymentId !== transaction.paymentId) {
      return { status: "unavailable" };
    }
    if (!resource.orderId) return { status: "unlinked" };
    await readOrder(resource.orderId);
    return { status: "linked", orderReference: resource.orderId.slice(-10) };
  } catch {
    return { status: "unavailable" };
  }
}

async function verifyEntryLinks(
  config: NonNullable<ReturnType<typeof churchSquarePayoutConfiguration>>,
  entries: ChurchSquarePayoutEntries["entries"], requestSignal: AbortSignal,
) {
  const square = new ChurchSquareOrderClient(config);
  const signal = AbortSignal.any([AbortSignal.timeout(8_000), requestSignal]);
  const verifiedOrders = new Map<string, Promise<unknown>>();
  const readOrder = (orderId: string) => {
    const cached = verifiedOrders.get(orderId);
    if (cached) return cached;
    const verified = square.get("order", orderId, signal);
    verifiedOrders.set(orderId, verified);
    return verified;
  };
  const links = new Map<string, Promise<ChurchSquarePayoutOrderEvidence>>();

  return Promise.all(entries.map(async ({ transaction, ...entry }) => {
    if (entry.type !== "CHARGE" && entry.type !== "REFUND") return entry;
    if (!transaction || (entry.type === "CHARGE") !== (transaction.kind === "charge")) {
      return { ...entry, orderEvidence: { status: "unlinked" } };
    }
    const key = transaction.kind === "charge" ? `charge:${transaction.paymentId}`
      : JSON.stringify([transaction.kind, transaction.refundId, transaction.paymentId]);
    let link = links.get(key);
    if (!link) {
      if (links.size >= maxTransactionLookups) return { ...entry, orderEvidence: { status: "unavailable" } };
      link = verifyOrderLink(square, transaction, readOrder, signal);
      links.set(key, link);
    }
    return { ...entry, orderEvidence: await link };
  }));
}

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
    const auditedEntries = await verifyEntryLinks(config, entries, request.signal);
    const projection = churchSquarePayoutEntriesResponse.safeParse({
      reference: reference.data, checkedAt: new Date().toISOString(), payoutType: payout.payoutType,
      amountCents: payout.amountCents, hasMore, entries: auditedEntries, netTotalCents, differenceCents,
    });
    return projection.success ? Response.json(projection.data, { headers }) : unavailable();
  } catch (error) {
    if (error instanceof ChurchSquarePayoutReadError && (error.status === 401 || error.status === 403)) {
      return unavailable("payout_permission_unavailable");
    }
    return unavailable();
  }
}
