"use client";
import { useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import { regularsCounterSnapshot, regularsCroissantChoices, type RegularsCounterSnapshot } from "@/lib/integrations/church-regulars-streak";

export function RegularsStreakPanel({ accountId }: { accountId: string }) {
  const [open, setOpen] = useState(false);
  const [snapshot, setSnapshot] = useState<RegularsCounterSnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [labels, setLabels] = useState<Record<string, string>>({});
  const inFlight = useRef(false);
  const requests = useRef(new Map<string, string>());
  async function act(input: Record<string, unknown>) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setOpen(true);
    try {
      const response = await fetch("/api/workspace/church-regulars", { method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...input, accountId }), cache: "no-store", signal: AbortSignal.timeout(170_000) });
      const data = await response.json();
      const parsed = regularsCounterSnapshot.safeParse(data.journey);
      if (!response.ok || !parsed.success) throw new Error(response.status === 409 ? "The treat changed. Refresh before handoff."
        : response.status === 401 || response.status === 403 ? "Your access changed. Reload Operations."
          : "Purchase history could not be verified. Refresh before promising a treat.");
      setSnapshot(parsed.data);
    } catch (cause) { setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "The check took too long. Refresh to recover any saved reservation."); }
    finally { inFlight.current = false; setBusy(false); }
  }
  function reserve(milestone: number, earnedOn: string) {
    const key = `${accountId}:${milestone}:${earnedOn}`;
    if (!requests.current.has(key)) requests.current.set(key, crypto.randomUUID());
    void act({ action: "reserve", milestone, earnedOn, requestId: requests.current.get(key) });
  }
  return <div className="mt-3 max-w-lg text-sm">
    <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act({ action: "read" })}>{busy ? "Checking purchases…" : open ? "Refresh daily ritual" : "Check daily ritual"}</Button>
    {open && <div className="mt-3 border-l-2 border-[var(--line)] pl-3" aria-busy={busy}>
      {error && <p role="alert" className="text-[var(--danger)]">{error}</p>}
      {snapshot && <>
        <p className="font-semibold">{snapshot.currentStreak} consecutive {snapshot.currentStreak === 1 ? "day" : "days"}{snapshot.visitedToday ? " · Visited today" : ""}</p>
        <p className="mt-1 text-xs text-[var(--ink-soft)]">3 days: croissant of their choice. 7 days: a surprise chosen here. Reserve before preparing; record the item in Square and confirm handoff below.</p>
        {!snapshot.rewards.length && <p className="mt-2 text-xs">No treat earned yet from verified paid purchases.</p>}
        <ul className="mt-3 space-y-4">{snapshot.rewards.map(reward => <li key={`${reward.milestone}:${reward.earnedOn}`} className="border-t border-[var(--line)] pt-3">
          <p className="font-medium">{reward.name}</p><p className="text-xs text-[var(--ink-soft)]">Earned {reward.earnedOn}</p>
          {!reward.claim ? <Button size="sm" className="mt-2" disabled={busy || Boolean(error)} onClick={() => reserve(reward.milestone, reward.earnedOn)}>Reserve treat</Button>
            : reward.claim.status === "fulfilled" ? <p className="mt-1 text-xs">Given: {reward.claim.itemLabel}</p>
              : <div className="mt-2 space-y-2"><p className="text-xs font-semibold">Reserved for handoff</p>
                <label className="block text-xs">Treat chosen (no guest or allergy details)
                  {reward.milestone === 3 ? <select className="focus-ring mt-1 block min-h-10 w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-2" value={labels[reward.claim.id] ?? ""} disabled={busy}
                    onChange={event => setLabels(current => ({ ...current, [reward.claim!.id]: event.target.value }))}>
                    <option value="">Choose a croissant</option>{regularsCroissantChoices.map(label => <option key={label}>{label}</option>)}
                  </select> : <input className="focus-ring mt-1 block min-h-10 w-full rounded-md border border-[var(--line)] bg-[var(--paper)] px-2"
                    value={labels[reward.claim.id] ?? ""} maxLength={160} disabled={busy} placeholder="Describe the surprise given"
                    onChange={event => setLabels(current => ({ ...current, [reward.claim!.id]: event.target.value }))} />}
                </label><div className="flex flex-wrap gap-2">
                  <Button size="sm" disabled={busy || Boolean(error) || !labels[reward.claim.id]?.trim()} onClick={() => void act({ action: "fulfill", claimId: reward.claim!.id, itemLabel: labels[reward.claim!.id]?.trim() })}>Confirm handed over</Button>
                  <Button size="sm" variant="secondary" disabled={busy} onClick={() => void act({ action: "cancel", claimId: reward.claim!.id })}>Release unused reservation</Button>
                </div></div>}
        </li>)}</ul>
        {snapshot.reviewClaims.length > 0 && <div className="mt-3 border-t border-[var(--line)] pt-3"><p className="text-xs text-[var(--danger)]">Purchase history changed for an earlier treat. Review refunds before giving anything else.</p>
          {snapshot.reviewClaims.filter(claim => claim.status === "reserved").map(claim => <Button key={claim.id} size="sm" variant="secondary" disabled={busy} onClick={() => void act({ action: "cancel", claimId: claim.id })}>Release unfulfilled treat</Button>)}
        </div>}
      </>}
    </div>}
  </div>;
}
