"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { createPortal } from "react-dom";
import { useModalDialog } from "@/lib/accessibility/use-modal-dialog";
import { cn } from "@/lib/utils";

type ModalAccessibleName =
  | { labelledBy: string; ariaLabel?: never }
  | { labelledBy?: never; ariaLabel: string };

export type ModalProps = ModalAccessibleName & {
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  className?: string;
  initialFocusSelector?: string;
  position?: "center" | "top" | "responsive-sheet";
  role?: "dialog" | "alertdialog";
  returnFocusTarget?: HTMLElement | null;
};

export function Modal({
  open,
  onClose,
  children,
  className,
  initialFocusSelector,
  position = "center",
  role = "dialog",
  returnFocusTarget,
  labelledBy,
  ariaLabel,
}: ModalProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useModalDialog({
    active: open,
    dialogRef,
    overlayRef,
    onClose,
    returnFocusTarget,
    ...(initialFocusSelector ? { initialFocusSelector } : {}),
  });

  const modal = (
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={overlayRef}
          className={cn(
            "fixed inset-0 z-[70] flex justify-center bg-black/30 backdrop-blur-[5px]",
            position === "top"
              ? "items-start px-4 pt-[10svh]"
              : position === "responsive-sheet"
                ? "items-end p-0 sm:items-center sm:p-5"
                : "items-center px-4 py-6",
          )}
          initial={reduceMotion ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.16 }}
          onMouseDown={(event) => {
            if (event.target === event.currentTarget) onClose();
          }}
        >
          <motion.div
            ref={dialogRef}
            role={role}
            aria-modal="true"
            aria-labelledby={labelledBy}
            aria-label={ariaLabel}
            tabIndex={-1}
            className={cn(
              "w-full overflow-hidden rounded-[22px] border border-[var(--line)] bg-[var(--paper-strong)] shadow-[var(--shadow-float)]",
              className,
            )}
            initial={
              reduceMotion
                ? false
                : {
                    y: position === "responsive-sheet" ? 10 : -10,
                    scale: 0.985,
                    opacity: 0,
                  }
            }
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{
              y: position === "responsive-sheet" ? 6 : -6,
              scale: 0.99,
              opacity: 0,
            }}
            transition={{ duration: reduceMotion ? 0 : 0.16 }}
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return typeof document === "undefined" ? null : createPortal(modal, document.body);
}
