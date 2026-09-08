import type { Metadata } from "next";
import { AuthFrame } from "@/components/auth/auth-frame";
import { SignInForm } from "@/components/auth/sign-in-form";
import { safeInternalRedirect } from "@/lib/auth/safe-redirect";
import { isDemoMode } from "@/lib/env";
import { getServerRuntimeConfiguration } from "@/lib/env.server";
import {
  defaultWorkspacePath,
  isHostSurface,
  isPhoneSurface,
  surfaceProductName,
} from "@/lib/app-surface";

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
    defaultWorkspacePath,
  );
  const localSignOutNotice = params.notice === "local_sign_out";
  const sessionExpiredNotice = params.notice === "session_expired";

  return (
    <AuthFrame product={surfaceProductName}>
      <p className="eyebrow">
        {isPhoneSurface
          ? "Phone access"
          : isHostSurface
            ? "Host access"
            : "Operator access"}
      </p>
      <h1 className="auth-greeting">Welcome back.</h1>
      <p className="mt-3 text-sm text-[var(--muted)]">
        {playgroundMode
          ? "Use your temporary playground account."
          : "Sign in with your Le Yard account."}
      </p>
      {localSignOutNotice || sessionExpiredNotice ? (
        <p
          role="status"
          className="mt-5 rounded-[16px] bg-[var(--warning-soft)] px-4 py-3 text-xs leading-5 text-[var(--warning)]"
        >
          {sessionExpiredNotice
            ? "Your session expired on this device. Sign in again to continue."
            : "This device was signed out, but the identity provider could not confirm a global sign-out. Other active devices may remain signed in."}
        </p>
      ) : null}
      <SignInForm
        demoMode={isDemoMode}
        playgroundMode={playgroundMode}
        nextPath={nextPath}
      />
      <p className="auth-access-note">
        Need access? Ask an owner or administrator.
      </p>
    </AuthFrame>
  );
}
