"use client";

import type { ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import {
  getObjectActionResolutions,
  type ActionResolutionContext,
  type ObjectActionMetadata,
} from "@/lib/actions/action-registry";

export interface ObjectActionBarProps {
  entity: ObjectActionMetadata["entity"];
  state: string;
  context: ActionResolutionContext;
  handlers: Readonly<Record<string, () => void | Promise<void>>>;
  icons?: Readonly<Record<string, ReactNode>>;
  variants?: Readonly<Record<string, ButtonProps["variant"]>>;
  labels?: Readonly<Record<string, ReactNode>>;
  ariaLabels?: Readonly<Record<string, string>>;
  disabled?: Readonly<Record<string, boolean>>;
  describedBy?: Readonly<Record<string, string | undefined>>;
  unauthorizedDescriptionId?: string;
  busy?: boolean;
  label?: string;
  className?: string;
  size?: ButtonProps["size"];
}

/**
 * Renders state-applicable record actions from the shared action registry.
 * Unauthorized actions remain visible but disabled when a handler is supplied,
 * allowing the owning workflow to explain the exact missing permission.
 */
export function ObjectActionBar({
  entity,
  state,
  context,
  handlers,
  icons = {},
  variants = {},
  labels = {},
  ariaLabels = {},
  disabled = {},
  describedBy = {},
  unauthorizedDescriptionId,
  busy = false,
  label = "Record actions",
  className = "grid grid-cols-2 gap-2",
  size = "md",
}: ObjectActionBarProps) {
  const actions = getObjectActionResolutions(entity, state, context).filter(
    ({ action }) => Boolean(handlers[action.id]),
  );

  if (!actions.length) return null;

  return (
    <div role="group" aria-label={label} className={className}>
      {actions.map(({ action, available }) => (
        <Button
          key={action.id}
          type="button"
          size={size}
          variant={
            variants[action.id] ??
            (action.urgency === "urgent" ? "accent" : "secondary")
          }
          disabled={busy || !available || Boolean(disabled[action.id])}
          aria-label={ariaLabels[action.id]}
          aria-describedby={
            !available ? unauthorizedDescriptionId : describedBy[action.id]
          }
          data-action-id={action.id}
          onClick={() => void handlers[action.id]?.()}
        >
          {icons[action.id]}
          {labels[action.id] ?? action.shortLabel}
        </Button>
      ))}
    </div>
  );
}
