import type { Metadata } from "next";
import { ArrowUpRight, ShieldCheck } from "lucide-react";
import { SignInForm } from "@/components/auth/sign-in-form";
import { BrandMark } from "@/components/ui/brand-mark";
import { safeInternalRedirect } from "@/lib/auth/safe-redirect";
import { isDemoMode } from "@/lib/env";
import { getServerRuntimeConfiguration } from "@/lib/env.server";

export const metadata: Metadata = {
  title: "Sign in",
  robots: { index: false, follow: false, nocache: true },
};

export default async function SignInPage({
  searchParams,
}: {
  searchParams: Promise<{
    next?: string | string[];
    notice?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const runtime = getServerRuntimeConfiguration();
  const playgroundMode = runtime.playground;
  const nextPath = safeInternalRedirect(
    typeof params.next === "string" ? params.next : undefined,
  );
  const localSignOutNotice = params.notice === "local_sign_out";

  return (
    <main className="paper-noise relative grid min-h-svh overflow-hidden bg-[var(--graphite)] lg:grid-cols-[1.05fr_.95fr]">
      <section className="relative hidden min-h-svh flex-col justify-between p-10 text-white lg:flex xl:p-14">
        <div className="absolute inset-0 workspace-grid opacity-20" />
        <div className="relative flex items-center gap-3">
          <BrandMark className="size-10 rounded-xl" />
          <div>
            <p className="text-base font-semibold tracking-[-0.03em]">Le Yard OS</p>
            <p className="mt-0.5 text-[10px] tracking-[0.13em] text-white/55 uppercase">Private back office</p>
          </div>
        </div>

        <div className="relative max-w-xl">
          <p className="mb-6 flex items-center gap-2 text-xs font-semibold text-[#e1a34d]">
            {isDemoMode ? (
              <span className="pulse-dot size-1.5 rounded-full bg-[#e1a34d]" />
            ) : (
              <ShieldCheck className="size-4" />
            )}
            {playgroundMode
              ? "Owner playground · Mock operating data"
              : isDemoMode
                ? "Synthetic Saturday service preview"
              : "Private, tenant-scoped operator access"}
          </p>
          <h1 className="max-w-lg text-[clamp(2.8rem,5vw,5rem)] leading-[0.96] font-medium tracking-[-0.065em]">
            Everything behind a great night.
          </h1>
          <p className="mt-7 max-w-md text-sm leading-6 text-white/55">
            Schedule the team, close the books, watch inventory, and keep every handoff in one quiet place.
          </p>
        </div>

        <div className="relative grid max-w-xl grid-cols-3 border-t border-white/10 pt-6">
          {(playgroundMode
            ? [
                ["2", "Temporary owner accounts"],
                ["Mock", "Operational records"],
                ["8h", "Secure session window"],
              ]
            : isDemoMode
            ? [
                ["11", "Demo team on floor"],
                ["92%", "Demo prep complete"],
                ["6:00", "Demo doors open"],
              ]
            : [
                ["RLS", "Tenant isolation"],
                ["AAL2", "Owner verification"],
                ["Private", "Operational records"],
              ]
          ).map(([value, label]) => (
            <div key={label}>
              <p className="numeric text-xl font-medium tracking-[-0.04em]">{value}</p>
              <p className="mt-1.5 text-[10px] text-white/55">{label}</p>
            </div>
          ))}
        </div>
      </section>

      <section className="relative flex min-h-svh items-center justify-center bg-[var(--paper-strong)] px-5 py-10 sm:px-10 lg:rounded-l-[34px]">
        <div className="w-full max-w-[390px]">
          <div className="mb-12 flex items-center gap-3 lg:hidden">
            <BrandMark />
            <p className="text-sm font-semibold">Le Yard OS</p>
          </div>
          <p className="eyebrow">Operator access</p>
          <h2 className="mt-4 text-3xl font-medium tracking-[-0.05em] text-[var(--ink)] sm:text-[2.3rem]">
            Welcome back.
          </h2>
          <p className="mt-3 text-sm leading-6 text-[var(--ink-faint)]">
            {playgroundMode
              ? "Use one of the two temporary Owner accounts created for this public demo link."
              : "Sign in with the account your owner or administrator invited."}
          </p>
          {localSignOutNotice ? (
            <p role="status" className="mt-5 rounded-xl bg-[var(--warning-soft)] px-3 py-2.5 text-xs leading-5 text-[var(--warning)]">
              This device was signed out, but the identity provider could not confirm a global sign-out. Other active devices may remain signed in.
            </p>
          ) : null}
          <SignInForm
            demoMode={isDemoMode}
            playgroundMode={playgroundMode}
            nextPath={nextPath}
          />

          <div className="mt-8 flex items-start gap-3 border-t border-[var(--line)] pt-5 text-[10px] leading-4 text-[var(--ink-faint)]">
            <ShieldCheck className="mt-0.5 size-4 shrink-0 text-[var(--positive)]" />
            <p>
              {playgroundMode
                ? "This is a nonproduction playground. Passwords are stored only as salted server-side hashes; MFA and Supabase accounts come later."
                : "Owner accounts require MFA in production. Passwords are hashed by Supabase and are never visible to administrators."}
            </p>
          </div>
          <p className="mt-6 inline-flex items-center gap-1.5 text-[11px] font-semibold text-[var(--ink-soft)]">
            Need access? Ask an owner or administrator
            <ArrowUpRight className="size-3" aria-hidden="true" />
          </p>
        </div>
      </section>
    </main>
  );
}
