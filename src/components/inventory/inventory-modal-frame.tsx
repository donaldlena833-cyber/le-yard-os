"use client";

import { motion } from "motion/react";
import { X } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";
import { cn } from "@/lib/utils";

export function InventoryModalFrame({
  title,
  description,
  labelledBy,
  notice,
  onClose,
  children,
  width = "max-w-3xl",
}: {
  title: string;
  description: string;
  labelledBy: string;
  notice?: string;
  onClose: () => void;
  children: ReactNode;
  width?: string;
}) {
  const overlayRef = useRef<HTMLDivElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const previouslyFocusedRef = useRef<HTMLElement | null>(
    typeof document !== "undefined" && document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null,
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previouslyFocused = previouslyFocusedRef.current;
    const hiddenSiblings: Array<{
      element: HTMLElement;
      inert: boolean;
      ariaHidden: string | null;
    }> = [];
    let branch: HTMLElement | null = overlayRef.current;
    while (branch?.parentElement && branch.parentElement !== document.body) {
      for (const sibling of branch.parentElement.children) {
        if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
        hiddenSiblings.push({
          element: sibling,
          inert: sibling.inert,
          ariaHidden: sibling.getAttribute("aria-hidden"),
        });
        sibling.inert = true;
        sibling.setAttribute("aria-hidden", "true");
      }
      branch = branch.parentElement;
    }
    document.body.style.overflow = "hidden";

    const selector = [
      "button:not([disabled])",
      "[href]",
      "input:not([disabled])",
      "select:not([disabled])",
      "textarea:not([disabled])",
      "[tabindex]:not([tabindex='-1'])",
    ].join(",");
    const focusable = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(selector) ?? [],
    ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");

    function keepFocusInside(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;
      const elements = focusable();
      if (!elements.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = elements[0];
      const last = elements[elements.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialogRef.current?.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }
    document.addEventListener("keydown", keepFocusInside, true);
    if (!dialogRef.current?.contains(document.activeElement)) {
      (dialogRef.current?.querySelector<HTMLElement>("[autofocus]") ??
        focusable()[0] ??
        dialogRef.current)?.focus();
    }
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", keepFocusInside, true);
      for (const { element, inert, ariaHidden } of hiddenSiblings) {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      }
      if (previouslyFocused?.isConnected) previouslyFocused.focus();
    };
  }, []);

  return (
    <motion.div
      ref={overlayRef}
      className="fixed inset-0 z-50 overflow-y-auto bg-black/30 px-3 py-5 backdrop-blur-[3px] sm:py-8"
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      onMouseDown={(event) => {
        if (event.currentTarget === event.target) onClose();
      }}
    >
      <motion.section
        ref={dialogRef}
        aria-labelledby={labelledBy}
        aria-describedby={`${labelledBy}-description`}
        aria-modal="true"
        role="dialog"
        tabIndex={-1}
        className={cn(
          "mx-auto w-full overflow-hidden rounded-[26px] bg-[var(--paper-strong)] shadow-[var(--shadow-float)]",
          width,
        )}
        initial={{ y: 14, scale: 0.985 }}
        animate={{ y: 0, scale: 1 }}
        exit={{ y: 10, scale: 0.985 }}
        transition={{ duration: 0.18, ease: "easeOut" }}
      >
        <header className="flex items-start justify-between gap-5 border-b border-[var(--line)] px-5 py-5 sm:px-7">
          <div>
            <h3 id={labelledBy} className="text-xl font-medium tracking-[-0.04em]">
              {title}
            </h3>
            <p id={`${labelledBy}-description`} className="mt-1 max-w-xl text-[11px] leading-5 text-[var(--ink-faint)]">
              {description}
            </p>
          </div>
          <button type="button" aria-label="Close dialog" onClick={onClose} className="focus-ring flex size-9 shrink-0 items-center justify-center rounded-full text-[var(--ink-faint)] transition hover:bg-[var(--canvas-strong)] hover:text-[var(--ink)]">
            <X className="size-4" />
          </button>
        </header>
        {notice ? (
          <div role="alert" aria-live="assertive" className="mx-5 mt-4 rounded-xl bg-[var(--danger-soft)] px-4 py-3 text-[10px] leading-4 text-[var(--danger)] sm:mx-7">
            {notice}
          </div>
        ) : null}
        {children}
      </motion.section>
    </motion.div>
  );
}
