"use client";

import { useState, type FormEvent } from "react";
import { Button } from "@/components/ui/button";

export const marketplaceChannels = { DOORDASH: "DoorDash", UBER_EATS: "Uber Eats", GRUBHUB: "Grubhub" } as const;
export const marketplaceEvidenceLabels = {
  merchant_order: "Staff matched the merchant order",
  payout_statement: "Staff matched the order on the payout statement",
} as const;
export type MarketplaceLinkInput = {
  channel: keyof typeof marketplaceChannels;
  externalStoreId: string;
  externalOrderId: string;
  evidence: keyof typeof marketplaceEvidenceLabels;
};

const fieldClass = "focus-ring mt-1 block w-full min-w-0 rounded-lg border border-[var(--line)] bg-[var(--paper-strong)] px-3 py-2 font-normal";

export function ChurchSquareMarketplaceLinkForm({ disabled, onSave, statementChannel }: {
  disabled: boolean;
  onSave: (input: MarketplaceLinkInput) => void;
  statementChannel?: MarketplaceLinkInput["channel"];
}) {
  const [validation, setValidation] = useState("");
  const title = statementChannel ? "Record a payout statement match" : "Record a marketplace order link";

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disabled) return;
    const data = new FormData(event.currentTarget);
    const channel = statementChannel ?? data.get("channel");
    const evidence = statementChannel ? "payout_statement" : data.get("evidence");
    const externalStoreId = String(data.get("externalStoreId") ?? "").trim();
    const externalOrderId = String(data.get("externalOrderId") ?? "").trim();
    if ((channel !== "DOORDASH" && channel !== "UBER_EATS" && channel !== "GRUBHUB")
      || (evidence !== "merchant_order" && evidence !== "payout_statement")) {
      setValidation("Choose the marketplace and evidence source.");
      return;
    }
    if (!/^[A-Za-z0-9_:-]{1,100}$/.test(externalStoreId) || !/^[A-Za-z0-9_:-]{12,100}$/.test(externalOrderId)) {
      setValidation("Enter the exact store ID and a full marketplace order ID of 12 to 100 characters.");
      return;
    }
    setValidation("");
    onSave({ channel, externalStoreId, externalOrderId, evidence });
  }

  return (
    <details className="border-t border-[var(--line)] pt-2">
      <summary className="focus-ring cursor-pointer rounded text-xs font-semibold">{title}</summary>
      <form aria-label={title} className="mt-2" onSubmit={submit} noValidate>
        <fieldset disabled={disabled} className="space-y-2">
          <p className="text-xs text-[var(--ink-soft)]">{statementChannel
            ? `Re-enter both ${marketplaceChannels[statementChannel]} IDs exactly as they appear on the payout statement.`
            : "Compare the same order in Square and the marketplace. Copy the full marketplace IDs from the merchant order details or payout statement."}</p>
          <p className="text-xs text-[var(--ink-soft)]">Use the full DoorDash marketplace order UUID, Uber Eats Workflow ID from Payment Details, or full Grubhub order UUID. Leave the link pending if you only have a short display code, delivery ID or payout ID.</p>
          <div className="grid gap-2 sm:grid-cols-2">
            {!statementChannel && <><label className="block text-xs font-semibold">Marketplace
              <select className={fieldClass} name="channel" required defaultValue="">
                <option value="">Choose a marketplace</option>
                {Object.entries(marketplaceChannels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
              </select>
            </label>
            <label className="block text-xs font-semibold">Matched against
              <select className={fieldClass} name="evidence" required defaultValue="">
                <option value="">Choose the evidence source</option>
                <option value="merchant_order">Merchant order details</option>
                <option value="payout_statement">Marketplace payout statement</option>
              </select>
            </label></>}
            <label className="block text-xs font-semibold">Marketplace store ID
              <input className={`${fieldClass} font-mono`} name="externalStoreId" spellCheck={false} autoComplete="off" maxLength={100} required />
            </label>
            <label className="block text-xs font-semibold">Marketplace order ID
              <input className={`${fieldClass} font-mono`} name="externalOrderId" spellCheck={false} autoComplete="off" minLength={12} maxLength={100} required />
            </label>
          </div>
          <Button type="submit" variant="secondary" size="sm">{statementChannel ? "Save statement match" : "Save marketplace link"}</Button>
        </fieldset>
        {validation && <p role="status" className="mt-2 text-xs text-[var(--ink-soft)]">{validation}</p>}
      </form>
    </details>
  );
}
