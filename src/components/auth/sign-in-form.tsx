"use client";

import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import { ArrowRight, Eye, EyeOff } from "lucide-react";
import {
  signInAction,
  type AuthActionState,
} from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

const initialState: AuthActionState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? "Signing in…" : "Sign in"}
      {!pending ? <ArrowRight className="size-4" /> : null}
    </Button>
  );
}

export function SignInForm({
  demoMode,
  playgroundMode,
  nextPath,
}: {
  demoMode: boolean;
  playgroundMode: boolean;
  nextPath: string;
}) {
  const [state, action] = useActionState(signInAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={action} className="mt-9 space-y-5">
      <input type="hidden" name="next" value={nextPath} />
      <label className="block">
        <span className="mb-2 block text-xs font-semibold text-[var(--ink-soft)]">
          {playgroundMode ? "Username" : "Username or work email"}
        </span>
        <input
          required
          name="identifier"
          type="text"
          autoComplete="username"
          placeholder={playgroundMode ? "Your preview username" : "donaldlena or you@leyard.com"}
          className="h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm outline-none transition-colors placeholder:text-[var(--ink-faint)] hover:border-[var(--line-strong)] focus:border-[var(--accent)]"
        />
      </label>
      <label className="block">
        <span className="mb-2 flex items-center justify-between text-xs font-semibold text-[var(--ink-soft)]">
          Password
          <span className="font-normal text-[var(--ink-faint)]">
            {playgroundMode ? "Temporary preview access" : "Managed securely"}
          </span>
        </span>
        <span className="relative block">
          <input
            required
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="current-password"
            placeholder="••••••••••••"
            className="h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 pr-12 text-sm outline-none transition-colors placeholder:text-[var(--ink-faint)] hover:border-[var(--line-strong)] focus:border-[var(--accent)]"
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((value) => !value)}
            className="focus-ring absolute inset-y-0 right-1 flex w-10 items-center justify-center rounded-lg text-[var(--ink-faint)]"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </span>
      </label>

      {state.status === "error" ? (
        <p role="alert" className="rounded-xl bg-[var(--danger-soft)] px-3 py-2.5 text-xs font-medium text-[var(--danger)]">
          {state.message}
        </p>
      ) : null}

      <SubmitButton />

      {demoMode && !playgroundMode ? (
        <p className="text-center text-xs leading-4 text-[var(--ink-faint)]">
          Local demo mode accepts any non-empty sign-in values.
        </p>
      ) : null}
    </form>
  );
}
