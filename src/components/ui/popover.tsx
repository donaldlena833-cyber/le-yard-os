"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { type ReactNode, useEffect, useId, useRef } from "react";

import { cn } from "@/lib/utils";

export interface PopoverProps {
  open: boolean;
  onOpenChange(open: boolean): void;
  label: string;
  trigger: ReactNode;
  triggerLabel: string;
  triggerClassName?: string;
  children: ReactNode;
  align?: "start" | "end";
  className?: string;
  contentClassName?: string;
}

/**
 * A non-modal anchored surface. Focus stays in the normal document order;
 * Escape returns to the trigger and pointer interaction outside dismisses it.
 */
export function Popover({
  open,
  onOpenChange,
  label,
  trigger,
  triggerLabel,
  triggerClassName,
  children,
  align = "end",
  className,
  contentClassName,
}: PopoverProps) {
  const generatedId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const reduceMotion = useReducedMotion();
  const triggerId = `${generatedId}-trigger`;
  const contentId = `${generatedId}-content`;

  useEffect(() => {
    if (!open) return;

    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== "Escape") return;
      event.preventDefault();
      onOpenChange(false);
      triggerRef.current?.focus();
    }

    function onPointerDown(event: PointerEvent) {
      if (rootRef.current?.contains(event.target as Node)) return;
      onOpenChange(false);
    }

    document.addEventListener("keydown", onKeyDown);
    document.addEventListener("pointerdown", onPointerDown, true);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.removeEventListener("pointerdown", onPointerDown, true);
    };
  }, [onOpenChange, open]);

  return (
    <div ref={rootRef} className={cn("relative inline-flex", className)}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        aria-label={triggerLabel}
        aria-expanded={open}
        aria-controls={contentId}
        aria-haspopup="dialog"
        onClick={() => onOpenChange(!open)}
        className={triggerClassName}
      >
        {trigger}
      </button>
      <AnimatePresence>
        {open ? (
          <motion.div
            id={contentId}
            role="dialog"
            aria-label={label}
            className={cn(
              "absolute top-[calc(100%+.5rem)] z-50 w-[min(92vw,360px)] rounded-[20px] border border-[var(--line)] bg-[var(--paper-strong)] p-2 shadow-[var(--shadow-float)]",
              align === "end" ? "right-0" : "left-0",
              contentClassName,
            )}
            initial={reduceMotion ? false : { y: -8, opacity: 0, scale: 0.98 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: -6, opacity: 0, scale: 0.98 }}
            transition={{ duration: reduceMotion ? 0 : 0.14 }}
          >
            {children}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </div>
  );
}
