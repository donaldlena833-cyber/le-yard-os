"use client";

import { motion } from "motion/react";
import { X } from "lucide-react";
import { type ReactNode, useRef } from "react";
import { createPortal } from "react-dom";
import { useModalDialog } from "@/lib/accessibility/use-modal-dialog";
import { cn } from "@/lib/utils";

export function InventoryModalFrame({
  title,
  description,
  labelledBy,
  notice,
  onClose,
  returnFocus,
  children,
  width = "max-w-3xl",
  layout = "scroll",
}: {
  title: string;
  description: string;
  labelledBy: string;
  notice?: string;
  onClose: () => void;
  returnFocus?: HTMLElement | null;
  children: ReactNode;
  width?: string;
  layout?: "scroll" | "task";
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  useModalDialog({
    dialogRef,
    overlayRef,
    onClose,
    initialFocusSelector: "[autofocus], [data-modal-initial]",
    returnFocusTarget: returnFocus,
  });

  if (typeof document === "undefined") return null;

  return createPortal(
    <motion.div
      ref={overlayRef}
      data-inventory-modal-overlay
      className="fixed inset-0 z-[100] flex items-stretch justify-center bg-black/35 p-0 backdrop-blur-[4px] sm:items-center sm:p-6"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <motion.section
        ref={dialogRef}
        data-inventory-modal-layout={layout}
        aria-labelledby={labelledBy}
        aria-describedby={`${labelledBy}-description`}
        aria-modal="true"
        role="dialog"
        tabIndex={-1}
        className={cn(
          "relative flex h-[100dvh] max-h-[100dvh] w-full flex-col overflow-hidden bg-[var(--paper-strong)] shadow-[var(--shadow-float)] sm:h-auto sm:max-h-[calc(100dvh-3rem)] sm:rounded-[26px] sm:border sm:border-[var(--line)]",
          layout === "task" && "sm:h-[min(840px,calc(100dvh-3rem))]",
          width,
        )}
        initial={{ y: 14, scale: 0.985 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 10, scale: 0.985 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <header className="flex shrink-0 items-start justify-between gap-5 border-b border-[var(--line)] bg-[var(--paper-strong)] px-4 pt-[calc(1rem+env(safe-area-inset-top))] pb-4 sm:px-7 sm:py-5">
          <div>
            <h3 id={labelledBy} className="text-xl font-medium tracking-[-0.04em]">
              {title}
            </h3>
            <p id={`${labelledBy}-description`} className="mt-1 max-w-xl text-[13px] leading-5 text-[var(--ink-faint)]">
              {description}
            </p>
          </div>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="focus-ring flex size-11 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] transition hover:bg-[var(--canvas-strong)] hover:text-[var(--ink)]">
            <X className="size-4" />
          </button>
        </header>
        {notice ? (
          <div role="alert" aria-live="assertive" className="mx-5 mt-4 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-xs leading-4 text-[var(--danger)] sm:mx-7">
            {notice}
          </div>
        ) : null}
        <div
          data-inventory-modal-body
          className={cn(
            "min-h-0 flex-1",
            layout === "scroll" ? "overflow-y-auto overscroll-contain" : "overflow-hidden",
          )}
        >
          {children}
        </div>
      </motion.section>
    </motion.div>,
    document.body,
  );
}
