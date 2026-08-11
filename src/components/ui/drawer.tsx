"use client";

import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import type { ReactNode } from "react";
import { useRef } from "react";
import { createPortal } from "react-dom";

import { useModalDialog } from "@/lib/accessibility/use-modal-dialog";
import { cn } from "@/lib/utils";

type DrawerAccessibleName =
  | { labelledBy: string; ariaLabel?: never }
  | { labelledBy?: never; ariaLabel: string };

export type DrawerProps = DrawerAccessibleName & {
  open: boolean;
  onClose(): void;
  children: ReactNode;
  side?: "left" | "right";
  width?: "sm" | "md" | "lg";
  layer?: "navigation" | "default" | "elevated";
  surface?: "paper" | "graphite";
  className?: string;
  overlayClassName?: string;
  initialFocusSelector?: string;
  returnFocusTarget?: HTMLElement | null;
};

const widthClass = {
  sm: "w-[min(88vw,360px)]",
  md: "w-[min(94vw,540px)]",
  lg: "w-[min(96vw,600px)]",
} as const;

const layerClass = {
  navigation: "z-[60]",
  default: "z-[70]",
  elevated: "z-[100]",
} as const;

/**
 * A modal side panel with shared focus containment, Escape/backdrop dismissal,
 * return-focus behavior, scroll locking, reduced motion, and safe portalling.
 */
export function Drawer({
  open,
  onClose,
  children,
  side = "right",
  width = "md",
  layer = "default",
  surface = "paper",
  className,
  overlayClassName,
  initialFocusSelector,
  returnFocusTarget,
  labelledBy,
  ariaLabel,
}: DrawerProps) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const drawerRef = useRef<HTMLDivElement>(null);
  const reduceMotion = useReducedMotion();

  useModalDialog({
    active: open,
    dialogRef: drawerRef,
    overlayRef,
    onClose,
    returnFocusTarget,
    ...(initialFocusSelector ? { initialFocusSelector } : {}),
  });

  const drawer = (
    <AnimatePresence>
      {open ? (
        <motion.div
          ref={overlayRef}
          className={cn(
            "fixed inset-0 bg-black/30 backdrop-blur-[3px]",
            layerClass[layer],
            overlayClassName,
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
            ref={drawerRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby={labelledBy}
            aria-label={ariaLabel}
            tabIndex={-1}
            className={cn(
              "absolute inset-y-0 flex max-w-full flex-col overflow-y-auto shadow-[var(--shadow-float)]",
              side === "right" ? "right-0" : "left-0",
              widthClass[width],
              surface === "graphite"
                ? "bg-[var(--graphite)] text-white"
                : "bg-[var(--paper-strong)] text-[var(--ink)]",
              className,
            )}
            initial={
              reduceMotion ? false : { x: side === "right" ? "100%" : "-100%" }
            }
            animate={{ x: 0 }}
            exit={{ x: side === "right" ? "100%" : "-100%" }}
            transition={
              reduceMotion
                ? { duration: 0 }
                : { type: "spring", stiffness: 360, damping: 38 }
            }
          >
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  );

  return typeof document === "undefined"
    ? null
    : createPortal(drawer, document.body);
}
