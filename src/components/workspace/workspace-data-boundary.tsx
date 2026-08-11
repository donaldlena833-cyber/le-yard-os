import { Cable, DatabaseZap, ShieldCheck } from "lucide-react";
import { PageFrame } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { isDemoMode } from "@/lib/env";

/**
 * Prevents a connected tenant from seeing or mutating the in-memory showcase.
 * Each feature removes this boundary only after its live read model and action
 * wiring pass connected acceptance against a nonproduction Supabase project.
 */
export function WorkspaceDataBoundary({
  feature,
  children,
}: {
  feature: string;
  children: React.ReactNode;
}) {
  if (isDemoMode) return children;

  return (
    <PageFrame width="wide">
      <section className="mx-auto mt-[8svh] max-w-2xl rounded-[28px] border border-[var(--line)] bg-[var(--paper-strong)] p-7 shadow-[var(--shadow-card)] sm:p-10">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone="positive" dot>Tenant verified</StatusPill>
          <StatusPill tone="warning">Activation gate</StatusPill>
        </div>
        <span className="mt-8 flex size-12 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
          <DatabaseZap className="size-5" />
        </span>
        <p className="eyebrow mt-6">Connected data boundary</p>
        <h2 className="mt-2 text-3xl font-medium tracking-[-0.055em]">
          {feature} is ready for live acceptance.
        </h2>
        <p className="mt-4 text-sm leading-6 text-[var(--ink-faint)]">
          This tenant is authenticated, but its live {feature.toLowerCase()} read model has not
          been activated against the approved Supabase project. Le Yard OS will not show
          synthetic records or simulate a successful write in connected mode.
        </p>

        <div className="mt-8 grid gap-3 sm:grid-cols-2">
          <div className="rounded-2xl bg-[var(--canvas)] p-4">
            <ShieldCheck className="size-4 text-[var(--positive)]" />
            <p className="mt-3 text-xs font-semibold">Safety preserved</p>
            <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">
              Tenant RLS, workflow RPCs, and audit guards remain active. No restaurant record was changed.
            </p>
          </div>
          <div className="rounded-2xl bg-[var(--canvas)] p-4">
            <Cable className="size-4 text-[var(--accent-strong)]" />
            <p className="mt-3 text-xs font-semibold">Next launch step</p>
            <p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">
              Connect the approved preview project, run the live acceptance suite, then enable this surface.
            </p>
          </div>
        </div>
      </section>
    </PageFrame>
  );
}
