"use client";

import type { FormEvent, ReactNode } from "react";
import { Button, type ButtonProps } from "@/components/ui/button";
import { Modal } from "@/components/ui/modal";

export interface ConfirmActionDialogProps {
  open: boolean;
  labelledBy: string;
  title: ReactNode;
  description: ReactNode;
  confirmLabel: string;
  onClose: () => void;
  onConfirm: () => void | Promise<void>;
  children?: ReactNode;
  busy?: boolean;
  confirmDisabled?: boolean;
  cancelLabel?: string;
  confirmVariant?: ButtonProps["variant"];
  noValidate?: boolean;
}

/**
 * Shared confirmation boundary for consequential actions. The safe cancel
 * action receives initial focus; callers retain ownership of validation and
 * mutation state.
 */
export function ConfirmActionDialog({
  open,
  labelledBy,
  title,
  description,
  confirmLabel,
  onClose,
  onConfirm,
  children,
  busy = false,
  confirmDisabled = false,
  cancelLabel = "Cancel",
  confirmVariant = "danger",
  noValidate = false,
}: ConfirmActionDialogProps) {
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!busy && !confirmDisabled) void onConfirm();
  }

  return (
    <Modal
      open={open}
      onClose={busy ? () => undefined : onClose}
      labelledBy={labelledBy}
      role="alertdialog"
      initialFocusSelector="[data-confirm-cancel]"
      position="responsive-sheet"
      className="max-w-lg rounded-b-none sm:rounded-[22px]"
    >
      <form onSubmit={submit} aria-busy={busy} noValidate={noValidate}>
        <div className="border-b border-[var(--line)] px-5 py-5 sm:px-6">
          <h2 id={labelledBy} className="text-lg font-semibold tracking-tight">
            {title}
          </h2>
          <div className="mt-2 text-sm leading-6 text-[var(--ink-faint)]">
            {description}
          </div>
        </div>
        {children ? <div className="px-5 py-5 sm:px-6">{children}</div> : null}
        <div className="flex flex-col-reverse gap-2 border-t border-[var(--line)] px-5 py-4 sm:flex-row sm:justify-end sm:px-6">
          <Button
            data-confirm-cancel
            type="button"
            variant="secondary"
            onClick={onClose}
            disabled={busy}
          >
            {cancelLabel}
          </Button>
          <Button
            type="submit"
            variant={confirmVariant}
            disabled={busy || confirmDisabled}
          >
            {busy ? "Saving…" : confirmLabel}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
