"use client";

import { Check, Link2, Sparkles, TriangleAlert } from "lucide-react";
import { useMemo, useState } from "react";
import { Button } from "@/components/ui/button";
import { SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import {
  recognizeInvoiceLines,
  type InvoiceCatalogItem,
} from "@/lib/invoices/invoice-matching";

export function InvoiceInventoryMatches({
  text,
  catalog,
  onAssign,
  compact = false,
}: {
  text: string;
  catalog: InvoiceCatalogItem[];
  onAssign?: (input: {
    lineKey: string;
    description: string;
    inventoryItemId: string;
    confidence: number;
  }) => Promise<boolean>;
  compact?: boolean;
}) {
  const suggestions = useMemo(
    () => recognizeInvoiceLines(text, catalog).slice(0, 12),
    [catalog, text],
  );
  const [assigned, setAssigned] = useState<Record<string, boolean>>({});
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const confidentCount = suggestions.filter((line) => line.inventoryItemId && line.confidence >= 0.8).length;

  if (!suggestions.length) {
    return (
      <section className="mt-7 border-t border-[var(--line)] pt-6">
        <SectionHeading title="Inventory assignment" detail="No line items were recognized yet." />
        <div className="mt-3 flex items-start gap-3 rounded-xl bg-[var(--accent-soft)]/45 p-4 text-[10px] leading-4 text-[var(--accent-strong)]">
          <Sparkles className="mt-0.5 size-4 shrink-0" />
          <span>OCR or an intelligence provider can populate line items later. The review surface is ready and will never post an inventory adjustment without manager confirmation.</span>
        </div>
      </section>
    );
  }

  return (
    <section className="mt-7 border-t border-[var(--line)] pt-6">
      <div className="flex items-end justify-between gap-3">
        <SectionHeading title="Inventory assignment" detail="Recognized invoice lines are matched to catalog items for manager review." />
        <StatusPill tone={confidentCount === suggestions.length ? "positive" : "warning"}>{confidentCount}/{suggestions.length} confident</StatusPill>
      </div>
      <div className="mt-3 space-y-2">
        {suggestions.map((line, index) => {
          const key = `${line.description}:${index}`;
          const confident = Boolean(line.inventoryItemId && line.confidence >= 0.8);
          const isAssigned = assigned[key] ?? false;
          return (
            <div key={key} className="rounded-xl bg-[var(--canvas)] p-3">
              <div className="flex flex-wrap items-center gap-2">
                <p className="min-w-0 flex-1 truncate text-[10px] font-semibold">{line.description}</p>
                {confident ? <StatusPill tone="positive">{Math.round(line.confidence * 100)}%</StatusPill> : <StatusPill tone="warning"><TriangleAlert className="size-3" /> Review</StatusPill>}
              </div>
              <div className="mt-2 flex flex-wrap items-center gap-2 text-[9px] text-[var(--ink-faint)]">
                <span className="flex-1">{line.inventoryItemName ? `→ ${line.inventoryItemName} · ${line.reason}` : line.reason}</span>
                <Button
                  variant={isAssigned ? "quiet" : "secondary"}
                  size="sm"
                  disabled={!line.inventoryItemId || busyKey === key}
                  onClick={() => {
                    if (!line.inventoryItemId) return;
                    if (isAssigned) {
                      setAssigned((current) => ({ ...current, [key]: false }));
                      return;
                    }
                    setBusyKey(key);
                    void (onAssign
                      ? onAssign({ lineKey: key, description: line.description, inventoryItemId: line.inventoryItemId, confidence: line.confidence })
                      : Promise.resolve(true)
                    ).then((saved) => {
                      if (saved) setAssigned((current) => ({ ...current, [key]: true }));
                    }).finally(() => setBusyKey(null));
                  }}
                >
                  {isAssigned ? <Check className="size-3.5 text-[var(--positive)]" /> : <Link2 className="size-3.5" />}
                  {isAssigned ? "Assigned" : "Assign"}
                </Button>
              </div>
            </div>
          );
        })}
      </div>
      {!compact ? <p className="mt-3 text-[9px] leading-4 text-[var(--ink-faint)]">Assignments are staged for review in this release. Posting delivery lines and price history remains a separate manager-approved action.</p> : null}
    </section>
  );
}
