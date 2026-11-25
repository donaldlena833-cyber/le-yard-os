"use client";

import { ChevronDown } from "lucide-react";
import { type ReactNode, useEffect, useRef } from "react";

export function KitchenSection({ title, children, defaultOpen = false }: {
  title: string;
  children: ReactNode;
  defaultOpen?: boolean;
}) {
  const sectionRef = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    function revealLinkedDetails() {
      const target = document.getElementById(window.location.hash.slice(1));
      if (!section?.contains(target)) return;

      let opened = false;
      for (let details = target?.closest("details"); details && section.contains(details);
        details = details.parentElement?.closest("details") ?? null) {
        if (!details.open) {
          details.open = true;
          opened = true;
        }
      }
      if (opened) target?.scrollIntoView({ block: "start" });
    }

    revealLinkedDetails();
    window.addEventListener("hashchange", revealLinkedDetails);
    return () => window.removeEventListener("hashchange", revealLinkedDetails);
  }, []);

  return (
    <details ref={sectionRef} open={defaultOpen} className="group/kitchen border-b border-[var(--line)]">
      <summary className="focus-ring flex min-h-13 cursor-pointer list-none items-center justify-between gap-3 rounded-md px-1 py-2 text-[15px] font-semibold hover:bg-[var(--canvas-strong)] [&::-webkit-details-marker]:hidden">
        {title}
        <ChevronDown aria-hidden="true" className="size-4 shrink-0 text-[var(--ink-soft)] transition-transform group-open/kitchen:rotate-180 motion-reduce:transition-none" />
      </summary>
      <div className="px-1 pb-5 pt-1">{children}</div>
    </details>
  );
}
