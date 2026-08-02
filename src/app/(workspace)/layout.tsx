import { LockKeyhole, LogOut, MapPinOff, ShieldAlert } from "lucide-react";
import { redirect } from "next/navigation";
import { signOutAction } from "@/app/actions/auth";
import { OwnerMfaGate } from "@/components/auth/owner-mfa-gate";
import { WorkspaceProvider } from "@/components/providers/workspace-provider";
import { AppShell } from "@/components/shell/app-shell";
import { BrandMark } from "@/components/ui/brand-mark";
import { Button } from "@/components/ui/button";
import {
  resolveWorkspaceSession,
  type WorkspaceSessionResolution,
} from "@/lib/auth/workspace-session";
import { requiresOwnerMfaGate } from "@/lib/auth/mfa";

function WorkspaceAccessState({
  resolution,
}: {
  resolution: Exclude<WorkspaceSessionResolution, { status: "ready" | "unauthenticated" }>;
}) {
  const content = {
    no_access: {
      icon: LockKeyhole,
      eyebrow: "Access pending",
      title: "No active workspace membership",
      detail:
        "You are signed in, but this account is not assigned to an active organization. Ask an owner or admin to review your invitation.",
    },
    no_location: {
      icon: MapPinOff,
      eyebrow: "Location access",
      title: "No active location is available",
      detail:
        "Your organization membership is active, but there is no active restaurant location in your access scope.",
    },
    configuration_error: {
      icon: ShieldAlert,
      eyebrow: "Connected mode",
      title: "Workspace configuration is incomplete",
      detail:
        "The live workspace cannot start until its Supabase public environment is configured.",
    },
    data_error: {
      icon: ShieldAlert,
      eyebrow: "Workspace unavailable",
      title: "Tenant access could not be verified",
      detail:
        "Le Yard OS could not safely resolve your organization and location. Try again, then contact an owner if this continues.",
    },
  }[resolution.status];
  const Icon = content.icon;

  return (
    <main className="flex min-h-svh items-center justify-center bg-[var(--canvas)] px-5 py-12">
      <section className="w-full max-w-lg rounded-[28px] border border-[var(--line)] bg-[var(--paper-strong)] p-7 shadow-[var(--shadow-card)] sm:p-9">
        <div className="flex items-center gap-3">
          <BrandMark />
          <div>
            <p className="text-sm font-semibold tracking-[-0.02em]">Le Yard OS</p>
            <p className="mt-0.5 text-[10px] text-[var(--ink-faint)]">Secure operator workspace</p>
          </div>
        </div>
        <span className="mt-10 flex size-11 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
          <Icon className="size-5" />
        </span>
        <p className="eyebrow mt-5">{content.eyebrow}</p>
        <h1 className="mt-2 text-2xl font-medium tracking-[-0.045em]">{content.title}</h1>
        <p className="mt-3 text-sm leading-6 text-[var(--ink-faint)]">{content.detail}</p>
        {resolution.identity ? (
          <div className="mt-6 rounded-2xl bg-[var(--canvas)] px-4 py-3">
            <p className="text-xs font-semibold">{resolution.identity.displayName}</p>
            {resolution.identity.email ? (
              <p className="mt-1 text-[10px] text-[var(--ink-faint)]">{resolution.identity.email}</p>
            ) : null}
          </div>
        ) : null}
        <form action={signOutAction} className="mt-7">
          <Button type="submit" variant="secondary" className="w-full">
            <LogOut className="size-4" />
            Sign out
          </Button>
        </form>
      </section>
    </main>
  );
}

export default async function WorkspaceLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const resolution = await resolveWorkspaceSession();

  if (resolution.status === "unauthenticated") redirect("/sign-in");

  if (resolution.status !== "ready") {
    return <WorkspaceAccessState resolution={resolution} />;
  }

  if (requiresOwnerMfaGate(resolution.context)) {
    return (
      <OwnerMfaGate
        displayName={resolution.context.identity.displayName}
        email={resolution.context.identity.email}
        organizationName={resolution.context.organization.name}
      />
    );
  }

  return (
    <WorkspaceProvider value={resolution.context}>
      <AppShell>{children}</AppShell>
    </WorkspaceProvider>
  );
}
