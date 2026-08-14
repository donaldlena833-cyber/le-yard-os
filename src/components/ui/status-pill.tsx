import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function StatusPill({
  children,
  tone = "neutral",
  dot = false,
  size = "md",
  className,
}: {
  children: ReactNode;
  tone?: "neutral" | "positive" | "warning" | "danger" | "accent";
  dot?: boolean;
  size?: "sm" | "md";
  className?: string;
}) {
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border font-semibold whitespace-nowrap",
        size === "sm" && "min-h-6 px-2 text-xs leading-none",
        size === "md" && "min-h-7 px-2.5 text-[13px] leading-none",
        tone === "neutral" &&
          "border-[var(--line)] bg-[var(--canvas-strong)] text-[var(--ink-soft)]",
        tone === "positive" &&
          "border-[color-mix(in_srgb,var(--positive)_18%,transparent)] bg-[var(--positive-soft)] text-[var(--positive)]",
        tone === "warning" &&
          "border-[color-mix(in_srgb,var(--warning)_18%,transparent)] bg-[var(--warning-soft)] text-[var(--warning)]",
        tone === "danger" &&
          "border-[color-mix(in_srgb,var(--danger)_18%,transparent)] bg-[var(--danger-soft)] text-[var(--danger)]",
        tone === "accent" &&
          "border-[color-mix(in_srgb,var(--accent-strong)_18%,transparent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]",
        className,
      )}
    >
      {dot ? (
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 shrink-0 rounded-full bg-current",
            tone === "positive" && "pulse-dot",
          )}
        />
      ) : null}
      {children}
    </span>
  );
}
