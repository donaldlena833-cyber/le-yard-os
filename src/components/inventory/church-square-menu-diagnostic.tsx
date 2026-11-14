"use client";

import { useState } from "react";
import { getChurchSquareMenuDiagnosticAction } from "@/app/actions/workflows/church-square-menu-diagnostic";
import { Button } from "@/components/ui/button";
import type { ChurchSquareMenuDiagnostic as Diagnostic } from "@/lib/integrations/church-square-menu-diagnostic";

type Variation = Diagnostic["items"][number]["variations"][number];
type MatchedItem = Extract<Diagnostic["items"][number], { status: "matched" }>;
const descriptionLabel: Record<MatchedItem["presentation"]["description"], string> = {
  present: "Present",
  missing: "Missing",
  unverified: "Unverified",
};
const sellabilityLabel: Record<Variation["presentation"]["sellability"], string> = {
  sellable: "Yes",
  not_sellable: "No",
  unspecified: "Unspecified",
};
const soldOutLabel: Record<Variation["presentation"]["soldOut"]["status"], string> = {
  sold_out: "Flagged sold out",
  expiration_unverified: "Flagged sold out · Expiration unverified",
  expired: "Flag expired",
  clear: "No sold-out flag",
  unverified: "Unverified",
};
const trackingLabel: Record<Variation["tracking"], string> = {
  tracked: "Tracked",
  untracked: "Tracking off",
  default_off: "Tracking off by default",
};
const mappingLabel: Record<Variation["mapping"], string> = {
  mapped: "Mapped in Operations",
  unmapped: "No active Operations mapping",
  unknown: "Operations mapping unverified",
};
const physicalCountLabel: Record<Variation["openingCount"], string> = {
  confirmed: "Operations physical count recorded",
  unrecorded: "No Operations physical count recorded",
  unknown: "Operations physical count unverified",
};
const time = new Intl.DateTimeFormat("en-US", {
  dateStyle: "medium", timeStyle: "short", timeZone: "America/New_York",
});

export function ChurchSquareMenuDiagnostic({ showCatalogDetails }: { showCatalogDetails: boolean }) {
  const [snapshot, setSnapshot] = useState<Diagnostic>();
  const [loading, setLoading] = useState(false);
  const [message, setMessage] = useState("");

  async function check() {
    if (loading) return;
    setLoading(true);
    setSnapshot(undefined);
    setMessage("Checking Square availability for Church Street…");
    try {
      const result = await getChurchSquareMenuDiagnosticAction();
      if (result.ok && result.mode === "live") {
        setSnapshot(result.data);
        setMessage("Square availability check complete.");
      } else {
        setMessage("message" in result ? result.message : "Square variations could not be checked.");
      }
    } catch {
      setMessage("Square variations could not be checked. Try again.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <details className="mt-4 border-t border-[var(--line)] pt-3">
      <summary className="focus-ring cursor-pointer rounded-md py-1 text-sm font-semibold">Check the six sandwich variations</summary>
      <p className="mt-2 text-sm text-[var(--ink-soft)]">Read Square’s sold-out flag for Church Street. Square can flag an item sold out while the stock count is positive. Use Square’s availability controls to place or clear a temporary hold.</p>
      {showCatalogDetails && <p className="mt-2 text-sm text-[var(--ink-soft)]">Have the manager or chef count the finished units available to sell before enabling tracking or submitting an opening count.</p>}
      <Button type="button" variant="secondary" size="sm" className="mt-2" disabled={loading} onClick={() => void check()}>
        {loading ? "Checking Square…" : snapshot ? "Check again" : "Check Square availability"}
      </Button>
      <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{message}</p>
      {snapshot && (
        <>
          <p className="mt-2 text-xs text-[var(--ink-soft)]">
            Last checked <time dateTime={snapshot.checkedAt}>{time.format(new Date(snapshot.checkedAt))} ET</time>. Check ordering availability in each channel.
          </p>
          {showCatalogDetails && <p className="mt-2 text-xs text-[var(--ink-soft)]">Photo counts are Square catalog references. Verify the actual photos and descriptions on the register and guest menu. Count history refers to Operations entries. Use the tracked item setup below to verify eligibility for physical counts.</p>}
          <ul className="mt-2 divide-y divide-[var(--line)]">
            {snapshot.items.map((item) => (
              <li key={item.key} className="space-y-2 py-3">
                <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
                  <h3 className="text-sm font-semibold">{item.name}</h3>
                  {showCatalogDetails && item.itemId && (
                    <a href={`https://app.squareup.com/dashboard/items/library/${encodeURIComponent(item.itemId)}`}
                      target="_blank" rel="noreferrer" className="focus-ring rounded text-xs font-semibold underline underline-offset-2"
                      aria-label={`Open ${item.name} parent item in Square (new tab)`}>Open parent item in Square</a>
                  )}
                </div>
                {item.status === "missing" && <p className="text-sm text-[var(--ink-soft)]">No exact item at the Church Street location.</p>}
                {item.status === "ambiguous" && <p className="text-sm text-[var(--warning)]">Multiple exact item matches. Resolve the duplicate in Square before setting up counts.</p>}
                {showCatalogDetails && item.status === "matched" && (
                  <dl className="flex flex-wrap gap-x-5 gap-y-1 text-xs text-[var(--ink-soft)]">
                    <div><dt className="inline font-medium">Item photos </dt><dd className="inline tabular-nums">{item.presentation.itemPhotoCount ?? "Unverified"}</dd></div>
                    <div><dt className="inline font-medium">Description </dt><dd className="inline">{descriptionLabel[item.presentation.description]}</dd></div>
                  </dl>
                )}
                {item.status === "matched" && item.variations.length === 0 && <p className="text-sm text-[var(--ink-soft)]">Square returned no matching variations for this item at Church Street.</p>}
                {item.variations.length > 0 && (
                  <ul className="grid gap-2 sm:grid-cols-2">
                    {item.variations.map((variation) => (
                      <li key={variation.id} className="min-w-0 rounded-lg border border-[var(--line)] p-2.5 text-xs">
                        <p className="break-words text-sm font-medium">{variation.name}</p>
                        <dl className="mt-1 space-y-1 text-[var(--ink-soft)]">
                          {showCatalogDetails && <>
                            <div><dt className="inline font-medium">Variation ID </dt><dd className="inline break-all font-mono">{variation.id}</dd></div>
                            <div><dt className="inline font-medium">SKU </dt><dd className="inline break-all font-mono">{variation.sku ?? "Not provided"}</dd></div>
                            <div><dt className="inline font-medium">Variation photos </dt><dd className="inline tabular-nums">{variation.presentation.photoCount ?? "Unverified"}</dd></div>
                          </>}
                          <div><dt className="inline font-medium">Square sellable flag </dt><dd className="inline">{sellabilityLabel[variation.presentation.sellability]}</dd></div>
                          <div>
                            <dt className="inline font-medium">Church Street sold-out flag </dt>
                            <dd className={["sold_out", "expiration_unverified"].includes(variation.presentation.soldOut.status) ? "inline font-semibold text-[var(--warning)]" : "inline"}>
                              {soldOutLabel[variation.presentation.soldOut.status]}
                              {"validUntil" in variation.presentation.soldOut && variation.presentation.soldOut.validUntil && (
                                <> · Expiration <time dateTime={variation.presentation.soldOut.validUntil}>{time.format(new Date(variation.presentation.soldOut.validUntil))} ET</time></>
                              )}
                            </dd>
                          </div>
                        </dl>
                        <p className="mt-2">{trackingLabel[variation.tracking]} · {mappingLabel[variation.mapping]}</p>
                        <p className="mt-1 text-[var(--ink-soft)]">{physicalCountLabel[variation.openingCount]}</p>
                      </li>
                    ))}
                  </ul>
                )}
              </li>
            ))}
          </ul>
        </>
      )}
    </details>
  );
}
