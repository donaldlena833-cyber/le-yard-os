import type { Metadata } from "next";
import { KeyRound, LockKeyhole, ShieldCheck } from "lucide-react";
import { InvitePasswordForm } from "@/components/auth/invite-password-form";
import { BrandMark } from "@/components/ui/brand-mark";

export const metadata: Metadata = { title: "Accept invitation" };

export default async function InvitePage({
  searchParams,
}: {
  searchParams: Promise<{ organization?: string | string[] }>;
}) {
  const params = await searchParams;
  const organizationId = typeof params.organization === "string" ? params.organization : "";
  return (
    <main className="paper-noise relative flex min-h-svh items-center justify-center overflow-hidden bg-[var(--graphite)] px-4 py-10">
      <div className="absolute inset-0 workspace-grid opacity-20" />
      <section className="relative w-full max-w-[470px] rounded-[28px] bg-[var(--paper-strong)] p-6 shadow-[var(--shadow-float)] sm:p-9">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-sm font-semibold tracking-[-0.025em]">Le Yard OS</p>
            <p className="mt-0.5 text-[9px] font-semibold tracking-[.13em] text-[var(--ink-faint)] uppercase">Private invitation</p>
          </div>
        </div>

        <span className="mt-10 flex size-11 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
          <KeyRound className="size-5" />
        </span>
        <h1 className="mt-5 text-3xl font-medium tracking-[-0.055em]">Make the account yours.</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--ink-faint)]">
          Your invitation proves access. Set a private password that no owner, administrator, or teammate can retrieve.
        </p>

        <InvitePasswordForm organizationId={organizationId} />

        <div className="mt-7 grid gap-3 border-t border-[var(--line)] pt-5 sm:grid-cols-2">
          <p className="flex items-start gap-2 text-[9px] leading-4 text-[var(--ink-faint)]">
            <LockKeyhole className="mt-0.5 size-3.5 shrink-0 text-[var(--positive)]" />
            Passwords are handled only by Supabase Auth and never stored in restaurant records.
          </p>
          <p className="flex items-start gap-2 text-[9px] leading-4 text-[var(--ink-faint)]">
            <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-[var(--positive)]" />
            Password access is sufficient during this rollout; any role may optionally enroll MFA.
          </p>
        </div>
      </section>
    </main>
  );
}
