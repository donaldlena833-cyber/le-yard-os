import type { Metadata } from "next";
import { ConnectedReceiptsWorkspace } from "@/components/receipts/connected-receipts-workspace";
import { ReceiptsWorkspace } from "@/components/receipts/receipts-workspace";
import { loadLiveReceipts } from "@/data/read-models/receipts";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Receipts" };

export default async function ReceiptsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[]; p?: string | string[] }>;
}) {
  if (isDemoMode) return <ReceiptsWorkspace />;
  const params = await searchParams;
  const search = (Array.isArray(params.q) ? params.q[0] : params.q ?? "")
    .trim()
    .slice(0, 120);
  const pageValue = Number(Array.isArray(params.p) ? params.p[0] : params.p ?? "1");
  const page = Number.isSafeInteger(pageValue) && pageValue > 0 ? pageValue : 1;
  return (
    <ConnectedReceiptsWorkspace
      key={`${search}:${page}`}
      initialSearch={search}
      model={await loadLiveReceipts(search, page)}
    />
  );
}
