"use client";

import { useRef, useState, type FormEvent } from "react";
import { ArrowUpRight, RefreshCw, WalletCards } from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { loyaltySnapshot, type LoyaltySnapshot } from "@/lib/integrations/church-square-loyalty";

const statusCopy: Record<LoyaltySnapshot["status"], { label: string; detail: string }> = {
  active: { label: "Square program active", detail: "Points and rewards below are read directly from Square." },
  inactive: { label: "Square program inactive", detail: "Reactivate the loyalty program in Square to accept new members." },
  not_configured: { label: "Square Loyalty setup needed", detail: "Check the Church Street loyalty program and location in Square Dashboard." },
  permissions_required: { label: "Square access needs attention", detail: "The café connection needs permission to read loyalty accounts." },
  unavailable: { label: "Square could not be reached", detail: "Try again. Existing customer cards and checkout rewards are managed by Square." },
};

function birthdayLabel(value: string | null) {
  return value ? new Intl.DateTimeFormat("en-US", { month: "short", day: "numeric", timeZone: "UTC" })
    .format(new Date(`2000-${value}T12:00:00Z`)) : "Not shared";
}

export function ChurchLoyaltyWorkspace() {
  const [snapshot, setSnapshot] = useState<LoyaltySnapshot | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [phone, setPhone] = useState("");
  const [queryPhone, setQueryPhone] = useState<string | undefined>();
  const [history, setHistory] = useState<(string | undefined)[]>([undefined]);
  const [page, setPage] = useState(0);
  const inFlight = useRef(false);

  async function load(input: { phone?: string; cursor?: string }, nextPage: number, nextHistory: (string | undefined)[]) {
    if (inFlight.current) return;
    inFlight.current = true;
    setBusy(true);
    setError(null);
    // Remove the previous search's private data before starting another read.
    setSnapshot(null);
    try {
      const response = await fetch("/api/workspace/church-square-loyalty", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify(input), cache: "no-store", signal: AbortSignal.timeout(40_000),
      });
      const data = await response.json();
      const parsed = loyaltySnapshot.safeParse(data);
      if (!parsed.success) {
        throw new Error(response.status === 401 || response.status === 403
          ? "Your access changed. Reload Operations and select the Church Street workspace."
          : "Loyalty could not be loaded. Please try again.");
      }
      setSnapshot(parsed.data);
      setQueryPhone(input.phone);
      setPage(nextPage);
      setHistory(nextHistory);
    } catch (cause) {
      setError(cause instanceof Error && cause.name !== "TimeoutError" ? cause.message : "Square took too long to respond. Please try again.");
    } finally { inFlight.current = false; setBusy(false); }
  }

  function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const digits = phone.replace(/[\s().-]/g, "");
    if (digits && !/^\+[1-9]\d{7,14}$/.test(digits)) {
      setError("Enter the member’s phone number with country code, for example +1 212 555 0100.");
      return;
    }
    void load({ ...(digits ? { phone: digits } : {}) }, 0, [undefined]);
  }

  const status = snapshot ? statusCopy[snapshot.status] : null;
  const ready = snapshot?.status === "active";

  return (
    <main className="mx-auto w-full max-w-6xl space-y-8 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[.16em] text-[var(--ink-soft)]">140 Church Street</p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight">Loyalty</h1>
          <p className="mt-2 max-w-xl text-sm text-[var(--ink-soft)]">Square members, rewards and Apple Wallet setup.</p>
        </div>
        <a className={buttonVariants({ variant: "secondary" })} href="https://app.squareup.com/dashboard/loyalty" target="_blank" rel="noopener noreferrer">
          Open Square <ArrowUpRight className="size-4" aria-hidden="true" />
        </a>
      </header>

      <section aria-labelledby="wallet-title" className="grid gap-6 border-y border-[var(--line)] py-6 sm:grid-cols-[1fr_1.3fr]">
        <div>
          <WalletCards className="size-7 text-[var(--primary)]" aria-hidden="true" />
          <h2 id="wallet-title" className="mt-3 text-xl font-semibold">Le Yard in Apple Wallet</h2>
          <p className="mt-2 max-w-sm text-sm leading-6 text-[var(--ink-soft)]">Customers can join after paying with Apple Pay, save their card and check in on future visits.</p>
        </div>
        <ol className="space-y-3 text-sm leading-6">
          <li><span className="font-semibold">1. Activate the program.</span> Choose the earning rule and reward in Square, including Church Street.</li>
          <li><span className="font-semibold">2. Enable Apple Wallet.</span> In Square Loyalty settings, allow enrollment and check-in using Apple Wallet. Review the logo and brand color.</li>
          <li><span className="font-semibold">3. Test at the café.</span> Pay with Apple Pay, accept the invitation and save the pass. Check points and redemption on a return visit.</li>
          <li className="text-[var(--ink-soft)]">The Wallet setting and pass installation are verified in Square and on an iPhone; an active program alone does not confirm them.</li>
        </ol>
      </section>

      <section aria-labelledby="members-title" aria-busy={busy}>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 id="members-title" className="text-xl font-semibold">Members & rewards</h2>
            <p className="mt-1 text-sm text-[var(--ink-soft)]">Load 20 accounts at a time, oldest first, or find a member by phone.</p>
          </div>
          <Button disabled={busy} variant="secondary" onClick={() => { setPhone(""); void load({}, 0, [undefined]); }}>
            <RefreshCw className={`size-4 ${busy ? "motion-safe:animate-spin" : ""}`} aria-hidden="true" />
            {busy ? "Loading…" : snapshot ? "Refresh members" : "Load from Square"}
          </Button>
        </div>
        <form onSubmit={search} className="mt-5 flex max-w-xl flex-wrap items-end gap-3">
          <label className="min-w-48 flex-1 text-sm font-medium">Member phone
            <input type="tel" autoComplete="off" value={phone} disabled={busy} onChange={event => setPhone(event.target.value)} placeholder="+1 212 555 0100"
              className="focus-ring mt-2 block min-h-11 w-full rounded-lg border border-[var(--line)] bg-[var(--paper)] px-3 text-[var(--ink)]" />
          </label>
          <Button type="submit" disabled={busy}>Find member</Button>
        </form>
        <div aria-live="polite" className="mt-5">
          {error && <p role="alert" className="text-sm text-[var(--danger)]">{error}</p>}
          {status && <div className="border-l-2 border-[var(--primary)] pl-4">
            <p className="font-semibold">{status.label}</p><p className="mt-1 text-sm text-[var(--ink-soft)]">{status.detail}</p>
            <p className="mt-1 text-xs text-[var(--ink-soft)]">Checked {new Date(snapshot!.checkedAt).toLocaleString("en-US", { timeZone: "America/New_York", dateStyle: "medium", timeStyle: "short" })} ET</p>
          </div>}
          {!snapshot && !busy && !error && <p className="text-sm text-[var(--ink-soft)]">Member details appear after you load them. This view is available to Church Street owners and admins.</p>}
        </div>
        {snapshot?.program && <div className="mt-5 flex flex-wrap gap-x-8 gap-y-2 border-y border-[var(--line)] py-4 text-sm">
          {snapshot.program.rewards.map((reward, index) => <p key={`${reward.points}:${index}`}><strong>{reward.points} {snapshot.program!.pointsLabel}</strong> · {reward.name}</p>)}
          {!snapshot.program.rewards.length && <p>No reward tiers returned by Square.</p>}
        </div>}
        {snapshot?.program?.sharedAcrossLocations && <p className="mt-3 text-sm text-[var(--ink-soft)]">This Square program is shared across locations. These accounts are program members; they are not a count of Church Street visits.</p>}
        {ready && <>
          {!snapshot.profilesComplete && <p role="status" className="mt-3 text-sm text-[var(--ink-soft)]">Some customer profiles could not be read. Names and birthdays may be unavailable; point balances are from Square.</p>}
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[620px] text-left text-sm">
              <caption className="sr-only">Square loyalty accounts, page {page + 1}</caption>
              <thead className="text-xs uppercase tracking-wide text-[var(--ink-soft)]"><tr>{["Member", snapshot.program?.pointsLabel || "Points", "Next reward", "Birthday"].map(label => <th key={label} scope="col" className="border-b border-[var(--line)] py-3 pr-4 font-medium">{label}</th>)}</tr></thead>
              <tbody>{snapshot.members.map(member => <tr key={member.id} className="border-b border-[var(--line)]">
                <td className="py-4 pr-4"><p className="font-semibold">{member.name}</p><p className="mt-1 text-xs text-[var(--ink-soft)]">Phone ending {member.phoneSuffix}{!member.enrolledAt ? " · Enrollment not confirmed" : ""}</p></td>
                <td className="py-4 pr-4 font-semibold tabular-nums">{member.points}</td>
                <td className="py-4 pr-4">{member.nextReward ? <><p>{member.nextReward.name}</p><p className="mt-1 text-xs text-[var(--ink-soft)]">{member.nextReward.pointsRemaining === 0 ? "Point threshold reached · redeem in Square" : `${member.nextReward.pointsRemaining} more ${snapshot.program?.pointsLabel || "points"}`}</p></> : "—"}</td>
                <td className="py-4 pr-4">{member.profileAvailable ? birthdayLabel(member.birthday) : "Profile unavailable"}</td>
              </tr>)}</tbody>
            </table>
          </div>
          {!snapshot.members.length && <p className="py-6 text-sm text-[var(--ink-soft)]">{queryPhone ? "No loyalty account matches that phone number." : "Square returned no loyalty accounts."}</p>}
          <div className="mt-4 flex items-center gap-3">
            <Button variant="secondary" disabled={busy || page === 0} onClick={() => void load({ phone: queryPhone, cursor: history[page - 1] }, page - 1, history)}>Previous</Button>
            <span className="text-sm text-[var(--ink-soft)]">Page {page + 1}</span>
            <Button variant="secondary" disabled={busy || !snapshot.cursor} onClick={() => { const cursor = snapshot.cursor!; void load({ phone: queryPhone, cursor }, page + 1, [...history.slice(0, page + 1), cursor]); }}>Next</Button>
          </div>
        </>}
      </section>
      <footer className="border-t border-[var(--line)] pt-5 text-sm leading-6 text-[var(--ink-soft)]">
        Birthdays shown here were recorded in Square. Joining loyalty or saving a Wallet pass does not establish permission for every marketing channel. Manage customer enrollment, rewards and communication permissions in Square.
      </footer>
    </main>
  );
}
