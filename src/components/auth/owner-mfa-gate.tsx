"use client";

import { AnimatePresence, motion } from "motion/react";
import {
  ArrowRight,
  Check,
  KeyRound,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  RefreshCw,
  ShieldCheck,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { type FormEvent, useEffect, useRef, useState } from "react";
import { signOutAction } from "@/app/actions/auth";
import { MfaEnrollment } from "@/components/settings/mfa-enrollment";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import {
  selectTotpFactorState,
  type TotpFactorState,
} from "@/lib/auth/mfa";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

type GateState =
  | { kind: "checking" }
  | { kind: "error" }
  | { kind: "success" }
  | TotpFactorState;

export function OwnerMfaGate({
  displayName,
  email,
  organizationName,
}: {
  displayName: string;
  email: string | null;
  organizationName: string;
}) {
  const router = useRouter();
  const clientRef = useRef<ReturnType<typeof createClient> | null>(null);
  const [state, setState] = useState<GateState>({ kind: "checking" });
  const [code, setCode] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [discoveryAttempt, setDiscoveryAttempt] = useState(0);

  function getClient() {
    clientRef.current ??= createClient();
    return clientRef.current;
  }

  useEffect(() => {
    let active = true;

    async function discover() {
      const { data, error } = await getClient().auth.mfa.listFactors();
      if (!active) return;
      if (error || !data) {
        setState({ kind: "error" });
        setMessage("Your authenticator status could not be checked. Retry or sign out.");
        return;
      }
      setState(selectTotpFactorState(data.all));
    }

    void discover();
    return () => {
      active = false;
    };
  }, [discoveryAttempt]);

  async function refreshWorkspace() {
    const { error } = await getClient().auth.refreshSession();
    if (error) {
      setState({ kind: "error" });
      setMessage("Verification succeeded, but the secure session could not refresh. Sign in again.");
      return;
    }
    setState({ kind: "success" });
    setMessage("Identity verified. Opening the operator workspace…");
    router.refresh();
  }

  async function verifyChallenge(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (state.kind !== "challenge") return;
    if (!/^\d{6}$/.test(code)) {
      setMessage("Enter the six-digit code from your authenticator app.");
      return;
    }

    setBusy(true);
    setMessage("");
    const { error } = await getClient().auth.mfa.challengeAndVerify({
      factorId: state.factor.id,
      code,
    });
    if (error) {
      setBusy(false);
      setCode("");
      setMessage("That code could not be verified. Wait for a new code and try again.");
      return;
    }

    await refreshWorkspace();
    setBusy(false);
  }

  function handleEnrollmentVerified() {
    setState({ kind: "success" });
    setMessage("Authenticator enrolled. Opening the operator workspace…");
    router.refresh();
  }

  return (
    <main className="grid min-h-svh bg-[var(--graphite)] text-white lg:grid-cols-[minmax(0,1.05fr)_minmax(440px,.95fr)]">
      <motion.section
        className="relative flex min-h-[42svh] flex-col justify-between overflow-hidden px-6 py-7 sm:px-10 sm:py-9 lg:min-h-svh lg:px-[clamp(3rem,7vw,7rem)] lg:py-12"
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        transition={{ duration: 0.35 }}
      >
        <div className="absolute -right-24 bottom-[-17rem] size-[34rem] rounded-full border border-white/[0.06]" aria-hidden="true" />
        <div className="absolute -right-8 bottom-[-11rem] size-[24rem] rounded-full border border-[#dfa14a]/20" aria-hidden="true" />
        <div className="relative flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-sm font-semibold tracking-[-0.02em]">Le Yard OS</p>
            <p className="mt-0.5 text-xs tracking-[0.08em] text-white/55 uppercase">Owner verification</p>
          </div>
        </div>

        <div className="relative max-w-xl py-12 lg:py-0">
          <span className="flex size-11 items-center justify-center rounded-2xl bg-[#dfa14a]/15 text-[#dfa14a]">
            <LockKeyhole className="size-5" />
          </span>
          <p className="mt-7 text-xs font-semibold tracking-[0.18em] text-[#dfa14a] uppercase">Second factor required</p>
          <h1 className="mt-3 max-w-lg text-[clamp(2.35rem,5vw,4.8rem)] font-medium leading-[.96] tracking-[-0.065em]">
            Verify before operations.
          </h1>
          <p className="mt-5 max-w-md text-sm leading-6 text-white/60">
            Owner sessions must reach AAL2 before tenant records or operational tools are rendered.
          </p>
        </div>

        <div className="relative hidden items-center gap-3 text-xs text-white/55 lg:flex">
          <ShieldCheck className="size-4 text-[#dfa14a]" />
          <span>{organizationName} · session protected</span>
        </div>
      </motion.section>

      <section className="flex min-h-[58svh] items-center bg-[var(--paper-strong)] px-5 py-10 text-[var(--ink)] sm:px-10 lg:min-h-svh lg:px-[clamp(3rem,6vw,6rem)]">
        <motion.div
          className="mx-auto w-full max-w-md"
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.3, delay: 0.08 }}
        >
          <div className="flex items-center justify-between gap-4 border-b border-[var(--line)] pb-5">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{displayName}</p>
              <p className="mt-1 truncate text-xs text-[var(--ink-faint)]">{email || "Authenticated Owner"}</p>
            </div>
            <span className="rounded-full border border-[var(--line)] px-2.5 py-1 text-xs font-semibold text-[var(--ink-faint)]">AAL1</span>
          </div>

          <div className="pt-8" aria-live="polite" aria-busy={state.kind === "checking" || busy}>
            <AnimatePresence mode="wait" initial={false}>
              {state.kind === "checking" ? (
                <motion.div key="checking" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-10 text-center">
                  <LoaderCircle className="mx-auto size-5 animate-spin text-[var(--accent-strong)]" />
                  <p className="mt-4 text-xs font-semibold">Checking authenticators</p>
                  <p className="mt-1 text-xs text-[var(--ink-faint)]">Only verified TOTP factors can unlock Owner access.</p>
                </motion.div>
              ) : null}

              {state.kind === "challenge" ? (
                <motion.div key="challenge" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
                  <span className="flex size-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]"><KeyRound className="size-4" /></span>
                  <h2 className="mt-5 text-xl font-medium tracking-[-0.04em]">Enter your authenticator code</h2>
                  <p className="mt-2 text-[13px] leading-5 text-[var(--ink-faint)]">Use the current six-digit code from {state.factor.friendlyName}.</p>
                  <form onSubmit={(event) => void verifyChallenge(event)} className="mt-6">
                    <label className="block">
                      <span className="mb-2 block text-xs font-semibold">Six-digit code</span>
                      <input
                        autoFocus
                        aria-describedby={message ? "owner-mfa-message" : undefined}
                        inputMode="numeric"
                        autoComplete="one-time-code"
                        pattern="[0-9]{6}"
                        maxLength={6}
                        value={code}
                        onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
                        className={cn(
                          "numeric h-14 w-full rounded-2xl border bg-[var(--paper)] px-4 text-center text-xl tracking-[.5em] outline-none transition-colors placeholder:tracking-[.5em]",
                          message ? "border-[var(--danger)]" : "border-[var(--line)] focus:border-[var(--accent)]",
                        )}
                        placeholder="000000"
                      />
                    </label>
                    {message ? <p id="owner-mfa-message" role="alert" className="mt-3 text-xs leading-4 text-[var(--danger)]">{message}</p> : null}
                    <Button type="submit" variant="accent" size="lg" className="mt-5 w-full" disabled={busy || code.length !== 6}>
                      {busy ? <LoaderCircle className="size-4 animate-spin" /> : <ArrowRight className="size-4" />}
                      {busy ? "Verifying…" : "Verify and continue"}
                    </Button>
                  </form>
                </motion.div>
              ) : null}

              {state.kind === "enroll" ? (
                <motion.div key="enroll" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }}>
                  <h2 className="text-xl font-medium tracking-[-0.04em]">Add an authenticator</h2>
                  <p className="mt-2 text-[13px] leading-5 text-[var(--ink-faint)]">No verified TOTP factor is attached to this Owner account. Enroll one to continue.</p>
                  <div className="mt-6">
                    <MfaEnrollment
                      knownFactorState={{ kind: "enroll" }}
                      onFactorDiscovered={setState}
                      onVerified={handleEnrollmentVerified}
                      presentation="gate"
                    />
                  </div>
                </motion.div>
              ) : null}

              {state.kind === "error" ? (
                <motion.div key="error" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} className="py-4">
                  <span className="flex size-10 items-center justify-center rounded-2xl bg-[var(--danger-soft)] text-[var(--danger)]"><RefreshCw className="size-4" /></span>
                  <h2 className="mt-5 text-xl font-medium tracking-[-0.04em]">Verification is unavailable</h2>
                  <p role="alert" className="mt-2 text-[13px] leading-5 text-[var(--danger)]">{message}</p>
                  <Button
                    variant="secondary"
                    className="mt-5"
                    onClick={() => {
                      setState({ kind: "checking" });
                      setMessage("");
                      setDiscoveryAttempt((attempt) => attempt + 1);
                    }}
                  >
                    <RefreshCw className="size-4" /> Retry
                  </Button>
                </motion.div>
              ) : null}

              {state.kind === "success" ? (
                <motion.div key="success" initial={{ opacity: 0, scale: 0.98 }} animate={{ opacity: 1, scale: 1 }} className="py-8 text-center">
                  <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-[var(--positive-soft)] text-[var(--positive)]"><Check className="size-5" /></span>
                  <h2 className="mt-5 text-xl font-medium tracking-[-0.04em]">Identity verified</h2>
                  <p className="mt-2 text-[13px] text-[var(--ink-faint)]">{message}</p>
                </motion.div>
              ) : null}
            </AnimatePresence>
          </div>

          <form action={signOutAction} className="mt-8 border-t border-[var(--line)] pt-5">
            <Button type="submit" variant="quiet" className="w-full text-[var(--ink-faint)]">
              <LogOut className="size-4" />
              Sign out instead
            </Button>
          </form>
        </motion.div>
      </section>
    </main>
  );
}
