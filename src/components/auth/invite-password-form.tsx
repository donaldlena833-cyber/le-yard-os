"use client";

import { Check, Eye, EyeOff, LoaderCircle, ShieldCheck } from "lucide-react";
import { useActionState, useState } from "react";
import { useFormStatus } from "react-dom";
import {
  setInvitedUserPasswordAction,
  type AuthActionState,
} from "@/app/actions/auth";
import { Button } from "@/components/ui/button";

const initialState: AuthActionState = { status: "idle" };

function SubmitButton() {
  const { pending } = useFormStatus();
  return (
    <Button type="submit" size="lg" className="w-full" disabled={pending}>
      {pending ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}
      {pending ? "Securing account…" : "Set password and continue"}
    </Button>
  );
}

export function InvitePasswordForm({ organizationId }: { organizationId: string }) {
  const [state, action] = useActionState(setInvitedUserPasswordAction, initialState);
  const [showPassword, setShowPassword] = useState(false);

  return (
    <form action={action} className="mt-8 space-y-5">
      <input type="hidden" name="organizationId" value={organizationId} />
      <label className="block">
        <span className="mb-2 block text-xs font-semibold text-[var(--ink-soft)]">New password</span>
        <span className="relative block">
          <input
            required
            minLength={12}
            name="password"
            type={showPassword ? "text" : "password"}
            autoComplete="new-password"
            className="h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 pr-12 text-sm outline-none transition-colors hover:border-[var(--line-strong)] focus:border-[var(--accent)]"
          />
          <button
            type="button"
            aria-label={showPassword ? "Hide password" : "Show password"}
            onClick={() => setShowPassword((current) => !current)}
            className="focus-ring absolute inset-y-0 right-1 flex w-10 items-center justify-center rounded-lg text-[var(--ink-faint)]"
          >
            {showPassword ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
          </button>
        </span>
      </label>

      <label className="block">
        <span className="mb-2 block text-xs font-semibold text-[var(--ink-soft)]">Confirm password</span>
        <input
          required
          minLength={12}
          name="confirmPassword"
          type={showPassword ? "text" : "password"}
          autoComplete="new-password"
          className="h-12 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-4 text-sm outline-none transition-colors hover:border-[var(--line-strong)] focus:border-[var(--accent)]"
        />
      </label>

      <div className="grid gap-2 text-[10px] text-[var(--ink-faint)] sm:grid-cols-3">
        {["12+ characters", "Upper & lowercase", "At least one number"].map((rule) => (
          <span key={rule} className="flex items-center gap-1.5">
            <Check className="size-3 text-[var(--positive)]" /> {rule}
          </span>
        ))}
      </div>

      {state.message ? (
        <p
          role={state.status === "error" ? "alert" : "status"}
          className={
            state.status === "error"
              ? "rounded-xl bg-[var(--danger-soft)] px-3 py-2.5 text-xs font-medium text-[var(--danger)]"
              : "rounded-xl bg-[var(--positive-soft)] px-3 py-2.5 text-xs font-medium text-[var(--positive)]"
          }
        >
          {state.message}
        </p>
      ) : null}

      <SubmitButton />
    </form>
  );
}
