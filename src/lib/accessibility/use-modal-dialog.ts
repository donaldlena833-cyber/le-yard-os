"use client";

import { type RefObject, useEffect, useRef } from "react";

const focusableSelector = [
  "a[href]",
  "button:not([disabled])",
  "input:not([disabled]):not([type='hidden'])",
  "select:not([disabled])",
  "textarea:not([disabled])",
  "[tabindex]:not([tabindex='-1'])",
].join(",");

interface InertSnapshot {
  element: HTMLElement;
  inert: boolean;
  ariaHidden: string | null;
}

function hideOutsideTree(overlay: HTMLElement): InertSnapshot[] {
  const snapshots: InertSnapshot[] = [];
  let branch: HTMLElement = overlay;

  while (branch.parentElement) {
    for (const sibling of Array.from(branch.parentElement.children)) {
      if (sibling === branch || !(sibling instanceof HTMLElement)) continue;
      snapshots.push({
        element: sibling,
        inert: Boolean(sibling.inert),
        ariaHidden: sibling.getAttribute("aria-hidden"),
      });
      sibling.inert = true;
      sibling.setAttribute("aria-hidden", "true");
    }
    branch = branch.parentElement;
  }

  return snapshots;
}

export function useModalDialog({
  dialogRef,
  overlayRef,
  onClose,
  initialFocusSelector = "[autofocus], [data-modal-initial]",
}: {
  dialogRef: RefObject<HTMLElement | null>;
  overlayRef: RefObject<HTMLElement | null>;
  onClose: () => void;
  initialFocusSelector?: string;
}) {
  const onCloseRef = useRef(onClose);

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    const dialog = dialogRef.current;
    const overlay = overlayRef.current;
    if (!dialog || !overlay) return;

    const returnTarget = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const previousOverflow = document.body.style.overflow;
    const outsideSnapshots = hideOutsideTree(overlay);
    document.body.style.overflow = "hidden";

    const focusInitial = window.requestAnimationFrame(() => {
      const initial = dialog.querySelector<HTMLElement>(initialFocusSelector)
        ?? dialog.querySelector<HTMLElement>(focusableSelector)
        ?? dialog;
      initial.focus();
    });

    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialog!.querySelectorAll<HTMLElement>(focusableSelector),
      ).filter((element) => !element.hidden && element.getAttribute("aria-hidden") !== "true");
      if (!focusable.length) {
        event.preventDefault();
        dialog!.focus();
        return;
      }

      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (event.shiftKey && (active === first || !dialog!.contains(active))) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !dialog!.contains(active))) {
        event.preventDefault();
        first.focus();
      }
    }

    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.cancelAnimationFrame(focusInitial);
      window.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
      for (const snapshot of outsideSnapshots) {
        snapshot.element.inert = snapshot.inert;
        if (snapshot.ariaHidden === null) snapshot.element.removeAttribute("aria-hidden");
        else snapshot.element.setAttribute("aria-hidden", snapshot.ariaHidden);
      }
      if (returnTarget?.isConnected) returnTarget.focus();
    };
  }, [dialogRef, initialFocusSelector, overlayRef]);
}
