"use client";

import { useEffect, useState, type FormEvent } from "react";
import { KeyRound, LoaderCircle, ShieldCheck } from "lucide-react";
import { MfaEnrollment } from "@/components/settings/mfa-enrollment";
import { Button } from "@/components/ui/button";
import { selectTotpFactorState, type TotpFactorState } from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/client";

export function MfaGate() {
  const [state, setState] = useState<TotpFactorState | null>(null);
  const [code, setCode] = useState("");
  const [busy, setBusy] = useState(true);
  const [message, setMessage] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let active = true;
    async function discover() {
      const { data, error } = await createClient().auth.mfa.listFactors();
      if (!active) return;
      if (error || !data) setMessage("Your authenticator could not be checked. Retry or sign in again.");
      else { setState(selectTotpFactorState(data.all)); setMessage(""); }
      setBusy(false);
    }
    void discover();
    return () => { active = false; };
  }, [attempt]);

  async function verify(event: FormEvent) {
    event.preventDefault();
    if (state?.kind !== "challenge" || !/^\d{6}$/.test(code)) return;
    setBusy(true);
    setMessage("");
    const client = createClient();
    const result = await client.auth.mfa.challengeAndVerify({ factorId: state.factor.id, code });
    const assurance = result.error ? null : await client.auth.mfa.getAuthenticatorAssuranceLevel();
    if (result.error || assurance?.error || assurance?.data.currentLevel !== "aal2") {
      setMessage("That code could not be verified. Enter the latest six-digit code and retry.");
      setBusy(false);
      return;
    }
    window.location.reload();
  }

  if (busy && !state) return <div className="mt-7 flex items-center gap-3 text-xs text-[var(--ink-faint)]"><LoaderCircle className="size-4 animate-spin" />Checking your authenticator…</div>;

  return <div className="mt-7 border-t border-[var(--line)] pt-6">
    {state?.kind === "enroll" ? <MfaEnrollment knownFactorState={state} presentation="gate" onVerified={() => window.location.reload()} /> : null}
    {state?.kind === "challenge" ? <form onSubmit={verify} className="space-y-4">
      <div className="flex items-start gap-3 rounded-2xl bg-[var(--accent-soft)] p-4"><KeyRound className="mt-0.5 size-4 shrink-0 text-[var(--accent-strong)]" /><div><p className="text-xs font-semibold">{state.factor.friendlyName}</p><p className="mt-1 text-[10px] leading-4 text-[var(--ink-faint)]">Enter the current code from your authenticator app.</p></div></div>
      <label className="block"><span className="mb-2 block text-xs font-semibold text-[var(--ink-soft)]">Six-digit code</span><input required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))} className="h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm outline-none focus:border-[var(--accent)]" /></label>
      <Button type="submit" className="w-full" disabled={busy || code.length !== 6}><ShieldCheck className="size-4" />{busy ? "Verifying…" : "Verify and continue"}</Button>
    </form> : null}
    {message ? <p role="alert" className="mt-4 rounded-xl bg-[var(--danger-soft)] px-3 py-2.5 text-xs font-medium text-[var(--danger)]">{message}</p> : null}
    {!state ? <Button variant="secondary" className="mt-4 w-full" onClick={() => { setBusy(true); setAttempt((value) => value + 1); }}>Retry authenticator check</Button> : null}
  </div>;
}
