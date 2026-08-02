import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatusPill({
  children,
  tone = "neutral",
  dot = false,
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "danger" | "accent";
  dot?: boolean;
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex min-h-6 items-center gap-1.5 rounded-full px-2.5 text-[11px] font-semibold whitespace-nowrap",
        tone === "neutral" && "bg-[var(--canvas-strong)] text-[var(--ink-soft)]",
        tone === "positive" && "bg-[var(--positive-soft)] text-[var(--positive)]",
        tone === "warning" && "bg-[var(--warning-soft)] text-[var(--warning)]",
        tone === "danger" && "bg-[var(--danger-soft)] text-[var(--danger)]",
        tone === "accent" && "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
        className,
      )}
    >
      {dot ? (
        <span
          className={cn(
            "size-1.5 rounded-full bg-current",
            tone === "positive" && "pulse-dot",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
