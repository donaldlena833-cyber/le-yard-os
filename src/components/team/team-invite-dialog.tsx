"use client";

import { AnimatePresence, motion } from "motion/react";
import { KeyRound, MailPlus, X } from "lucide-react";
import { useActionState } from "react";
import { inviteUserAction, type AuthActionState } from "@/app/actions/auth";
import { Button } from "@/components/ui/button";
import type { WorkspaceLocation } from "@/lib/auth/workspace-context";
import { cn } from "@/lib/utils";
import type { AppRole } from "@/types";

const initialInviteState: AuthActionState = { status: "idle" };
const labels: Record<AppRole, string> = {
  owner: "Owner",
  admin: "Admin",
  manager: "Manager",
  employee: "Employee",
};

export function TeamInviteDialog({
  open,
  onClose,
  organizationId,
  locations,
  roles,
  actorRole,
}: {
  open: boolean;
  onClose: () => void;
  organizationId: string;
  locations: readonly Pick<WorkspaceLocation, "id" | "name">[];
  roles: readonly AppRole[];
  actorRole: AppRole;
}) {
  const [state, formAction, pending] = useActionState(
    inviteUserAction,
    initialInviteState,
  );
  const defaultRole = roles.includes("employee") ? "employee" : roles[0];
  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-4 backdrop-blur-[3px]"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onMouseDown={(event) => {
            if (event.currentTarget === event.target) onClose();
          }}
        >
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-labelledby="live-invite-title"
            className="w-full max-w-xl rounded-[24px] bg-[var(--paper-strong)] p-5 shadow-[var(--shadow-float)] sm:p-7"
            initial={{ y: 14, scale: 0.98 }}
            animate={{ y: 0, scale: 1 }}
            exit={{ y: 10, scale: 0.98 }}
          >
            <div className="flex items-start justify-between gap-4">
              <div>
                <span className="flex size-10 items-center justify-center rounded-2xl bg-[var(--accent-soft)] text-[var(--accent-strong)]">
                  <MailPlus className="size-4" />
                </span>
                <h3
                  id="live-invite-title"
                  className="mt-4 text-xl font-medium tracking-[-0.04em]"
                >
                  Invite a teammate
                </h3>
                <p className="mt-1 text-[13px] leading-5 text-[var(--ink-faint)]">
                  They receive a one-time invitation and create their own
                  password.
                </p>
              </div>
              <Button
                variant="quiet"
                size="icon"
                aria-label="Close invitation"
                onClick={onClose}
              >
                <X className="size-4" />
              </Button>
            </div>
            <form
              action={formAction}
              className="mt-6 grid gap-4 sm:grid-cols-2"
            >
              <input
                type="hidden"
                name="organizationId"
                value={organizationId}
              />
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold">
                  Full name
                </span>
                <input
                  name="fullName"
                  required
                  autoComplete="name"
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"
                />
              </label>
              <label className="sm:col-span-2">
                <span className="mb-1.5 block text-xs font-semibold">
                  Work email
                </span>
                <input
                  name="email"
                  required
                  type="email"
                  autoComplete="email"
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"
                />
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-semibold">
                  Access role
                </span>
                <select
                  name="role"
                  defaultValue={defaultRole}
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"
                >
                  {roles.map((role) => (
                    <option key={role} value={role}>
                      {labels[role]}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                <span className="mb-1.5 block text-xs font-semibold">
                  Primary location
                </span>
                <select
                  name="locationId"
                  defaultValue={locations[0]?.id}
                  className="h-11 w-full rounded-xl border border-[var(--line)] bg-[var(--paper)] px-3 text-xs"
                >
                  {locations.map((location) => (
                    <option key={location.id} value={location.id}>
                      {location.name}
                    </option>
                  ))}
                </select>
              </label>
              <div className="sm:col-span-2 rounded-xl bg-[var(--canvas)] px-3.5 py-3 text-xs leading-4 text-[var(--ink-faint)]">
                <span className="flex items-center gap-2 font-semibold text-[var(--ink-soft)]">
                  <KeyRound className="size-3.5" /> Secure account handoff
                </span>
                <p className="mt-1">
                  {actorRole === "admin"
                    ? "Admins cannot grant owner access."
                    : "Owner access is protected by the authenticated password session."}
                </p>
              </div>
              {state.status !== "idle" ? (
                <p
                  role="status"
                  aria-live="polite"
                  className={cn(
                    "sm:col-span-2 rounded-xl px-3.5 py-3 text-[13px]",
                    state.status === "success"
                      ? "bg-[var(--positive-soft)] text-[var(--positive)]"
                      : "bg-[var(--danger-soft)] text-[var(--danger)]",
                  )}
                >
                  {state.message}
                </p>
              ) : null}
              <div className="mt-1 flex justify-end gap-2 sm:col-span-2">
                <Button variant="quiet" onClick={onClose}>
                  Cancel
                </Button>
                <Button type="submit" variant="accent" disabled={pending}>
                  {pending ? "Preparing…" : "Send invitation"}
                </Button>
              </div>
            </form>
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
