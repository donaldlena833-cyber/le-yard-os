"use client";

import Image from "next/image";
import {
  Check,
  KeyRound,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  X,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  selectTotpFactorState,
  type TotpFactorState,
} from "@/lib/auth/mfa";
import { isDemoMode } from "@/lib/env";
import { createClient } from "@/lib/supabase/client";

type Enrollment = {
  factorId: string;
  qrCode: string;
  secret: string;
};

type EnrollmentStatus =
  | "checking"
  | "idle"
  | "loading"
  | "verified"
  | "error";

export function MfaEnrollment({
  knownFactorState,
  onFactorDiscovered,
  onVerified,
  presentation = "settings",
}: {
  /** A gate that already listed factors passes its result to avoid a duplicate request. */
  knownFactorState?: TotpFactorState;
  onFactorDiscovered?: (state: TotpFactorState) => void;
  onVerified?: () => void | Promise<void>;
  presentation?: "settings" | "gate";
}) {
  const clientRef = useRef<ReturnType<typeof createClient> | null>(null);
  const [factorState, setFactorState] = useState<TotpFactorState | null>(
    isDemoMode ? { kind: "enroll" } : knownFactorState ?? null,
  );
  const [enrollment, setEnrollment] = useState<Enrollment | null>(null);
  const [code, setCode] = useState("");
  const [status, setStatus] = useState<EnrollmentStatus>(
    isDemoMode || knownFactorState ? "idle" : "checking",
  );
  const [message, setMessage] = useState("");
  const [discoveryAttempt, setDiscoveryAttempt] = useState(0);

  function getClient() {
    clientRef.current ??= createClient();
    return clientRef.current;
  }

  useEffect(() => {
    if (isDemoMode || knownFactorState) return;
    let active = true;

    async function discover() {
      const { data, error } = await getClient().auth.mfa.listFactors();
      if (!active) return;
      if (error || !data) {
        setStatus("error");
        setMessage("Authenticator status could not be checked. Retry after confirming your session.");
        return;
      }
      setFactorState(selectTotpFactorState(data.all));
      setStatus("idle");
    }

    void discover();
    return () => {
      active = false;
    };
  }, [discoveryAttempt, knownFactorState]);

  async function beginEnrollment() {
    setStatus("loading");
    setMessage("");
    if (isDemoMode) {
      setEnrollment({
        factorId: "demo-factor",
        qrCode: "",
        secret: "DEMO-ONLY-NO-SECRET",
      });
      setStatus("idle");
      return;
    }

    // Re-check immediately before enrollment so another verified factor cannot
    // be duplicated from a stale Settings tab.
    const factors = await getClient().auth.mfa.listFactors();
    if (factors.error || !factors.data) {
      setStatus("error");
      setMessage("Authenticator status could not be confirmed. Retry before enrolling.");
      return;
    }
    const latestFactorState = selectTotpFactorState(factors.data.all);
    if (latestFactorState.kind === "challenge") {
      setFactorState(latestFactorState);
      setStatus("idle");
      onFactorDiscovered?.(latestFactorState);
      return;
    }

    const { data, error } = await getClient().auth.mfa.enroll({
      factorType: "totp",
      friendlyName: "Le Yard OS authenticator",
    });
    if (error) {
      setStatus("error");
      setMessage("MFA enrollment could not start. Sign in again and retry.");
      return;
    }
    setEnrollment({
      factorId: data.id,
      qrCode: data.totp.qr_code,
      secret: data.totp.secret,
    });
    setStatus("idle");
  }

  async function verifyEnrollment() {
    if (!enrollment || !/^\d{6}$/.test(code)) {
      setStatus("error");
      setMessage("Enter the six-digit code from your authenticator.");
      return;
    }
    setStatus("loading");
    setMessage("");
    if (isDemoMode) {
      setEnrollment(null);
      setStatus("verified");
      setMessage("Demo MFA enrollment verified locally.");
      await onVerified?.();
      return;
    }

    const { error } = await getClient().auth.mfa.challengeAndVerify({
      factorId: enrollment.factorId,
      code,
    });
    if (error) {
      setStatus("error");
      setMessage("That code could not be verified. Wait for a new code and retry.");
      return;
    }
    const { error: refreshError } = await getClient().auth.refreshSession();
    if (refreshError) {
      setStatus("error");
      setMessage("The factor was verified, but the secure session could not refresh. Sign in again.");
      return;
    }

    // Remove the one-time secret from React state as soon as verification succeeds.
    setEnrollment(null);
    setCode("");
    setFactorState({
      kind: "challenge",
      factor: {
        id: enrollment.factorId,
        friendlyName: "Le Yard OS authenticator",
        updatedAt: new Date().toISOString(),
      },
    });
    setStatus("verified");
    setMessage("MFA is active on your account.");
    await onVerified?.();
  }

  if (status === "checking") {
    return (
      <div className="flex items-center gap-3 border-y border-[var(--line)] py-5" aria-live="polite" aria-busy="true">
        <LoaderCircle className="size-4 animate-spin text-[var(--accent-strong)]" />
        <div>
          <p className="text-xs font-semibold">Checking authenticator status</p>
          <p className="mt-1 text-xs text-[var(--ink-faint)]">Verified factors are read directly from your Auth account.</p>
        </div>
      </div>
    );
  }

  if (status === "verified" || factorState?.kind === "challenge") {
    return (
      <div className="flex items-start gap-3 rounded-[16px] bg-[var(--positive-soft)] p-4 text-[var(--positive)]">
        <ShieldCheck className="mt-0.5 size-4 shrink-0" />
        <div>
          <p className="text-xs font-semibold">Authenticator already enrolled</p>
          <p className="mt-1 text-xs leading-4">
            {message || `${factorState?.kind === "challenge" ? factorState.factor.friendlyName : "A verified TOTP factor"} is active. A duplicate factor will not be created.`}
          </p>
        </div>
      </div>
    );
  }

  if (!enrollment) {
    return (
      <div className={presentation === "gate" ? "border-y border-[var(--line)] py-5" : "rounded-[18px] border border-[var(--line)] p-4"}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center">
          <span className="flex size-10 shrink-0 items-center justify-center rounded-[13px] bg-[var(--accent-soft)] text-[var(--accent-strong)]">
            <KeyRound className="size-4" />
          </span>
          <div className="min-w-0 flex-1">
            <p className="text-xs font-semibold">Authenticator app</p>
            <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">Use a time-based one-time code. The setup secret is shown only during enrollment.</p>
          </div>
          <Button variant="secondary" size="sm" onClick={() => void beginEnrollment()} disabled={status === "loading"}>
            {status === "loading" ? <LoaderCircle className="size-3.5 animate-spin" /> : <ShieldCheck className="size-3.5" />}
            Enroll
          </Button>
        </div>
        {status === "error" && message ? (
          <div className="mt-4 flex items-start justify-between gap-3 rounded-xl bg-[var(--danger-soft)] px-3 py-3 text-[var(--danger)]">
            <p role="alert" className="text-xs leading-4">{message}</p>
            {!knownFactorState && !isDemoMode ? (
              <Button
                variant="quiet"
                size="sm"
                onClick={() => {
                  setStatus("checking");
                  setMessage("");
                  setDiscoveryAttempt((attempt) => attempt + 1);
                }}
              >
                <RefreshCw className="size-3.5" /> Retry
              </Button>
            ) : null}
          </div>
        ) : null}
      </div>
    );
  }

  return (
    <div className={presentation === "gate" ? "border-y border-[var(--line)] py-5" : "rounded-[18px] border border-[var(--line)] p-4"}>
      <div className="flex items-start justify-between gap-4">
        <div>
          <p className="text-xs font-semibold">Scan with your authenticator</p>
          <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">The setup secret is shown once and is never written to application data.</p>
        </div>
        <Button
          variant="quiet"
          size="icon"
          aria-label="Cancel MFA enrollment"
          onClick={() => {
            setEnrollment(null);
            setCode("");
            setMessage("");
            setStatus("idle");
          }}
        >
          <X className="size-4" />
        </Button>
      </div>
      <div className="mt-4 grid gap-5 sm:grid-cols-[152px_1fr] sm:items-center">
        <div className="flex size-[152px] items-center justify-center rounded-[16px] bg-white p-2">
          {enrollment.qrCode ? (
            <Image
              src={enrollment.qrCode}
              alt="Authenticator enrollment QR code"
              width={136}
              height={136}
              unoptimized
            />
          ) : (
            <div className="text-center text-xs leading-4 text-[#4f554d]">Demo mode<br />No scannable secret</div>
          )}
        </div>
        <div>
          <label className="block">
            <span className="mb-1.5 block text-xs font-semibold">Six-digit verification code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              pattern="[0-9]{6}"
              maxLength={6}
              value={code}
              onChange={(event) => setCode(event.target.value.replace(/\D/g, "").slice(0, 6))}
              className="numeric h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-sm tracking-[.2em] outline-none focus:border-[var(--accent)]"
              placeholder="000000"
            />
          </label>
          <div className="mt-3">
            <p className="text-xs font-semibold text-[var(--ink-soft)]">Manual setup key</p>
            <code className="mt-1 block break-all rounded-lg bg-[var(--canvas)] px-2.5 py-2 font-mono text-xs text-[var(--ink-faint)]">
              {enrollment.secret}
            </code>
          </div>
          {message ? <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{message}</p> : null}
          <Button className="mt-3" variant="accent" size="sm" onClick={() => void verifyEnrollment()} disabled={status === "loading" || code.length !== 6}>
            {status === "loading" ? <LoaderCircle className="size-3.5 animate-spin" /> : <Check className="size-3.5" />}
            Verify and enable
          </Button>
        </div>
      </div>
    </div>
  );
}
