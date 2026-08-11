import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface StickyActionBarProps {
  title: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  actions: ReactNode;
  label?: string;
  className?: string;
}

/**
 * Keeps the decisive action for a long workflow within reach without covering
 * the mobile dock or device safe area. Callers retain ownership of permission,
 * loading, confirmation, and mutation behavior.
 */
export function StickyActionBar({
  title,
  detail,
  icon,
  actions,
  label = "Workflow actions",
  className,
}: StickyActionBarProps) {
  return (
    <footer
      role="region"
      aria-label={label}
      className={cn(
        "sticky bottom-[calc(72px+env(safe-area-inset-bottom)+0.75rem)] z-20 mt-7 rounded-[18px] border border-white/10 bg-[var(--graphite)] px-4 py-3 text-white shadow-[var(--shadow-float)] lg:bottom-3",
        "sm:flex sm:items-center sm:justify-between sm:gap-5",
        className,
      )}
    >
      <div className="flex min-w-0 items-center gap-3">
        {icon ? (
          <span
            aria-hidden="true"
            className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-white/10"
          >
            {icon}
          </span>
        ) : null}
        <div className="min-w-0">
          <p className="truncate text-[13px] font-semibold">{title}</p>
          {detail ? (
            <p className="mt-1 text-xs leading-4 text-white/55">{detail}</p>
          ) : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2 sm:mt-0 sm:shrink-0 [&>*]:min-h-11 [&>*]:grow sm:[&>*]:grow-0">
        {actions}
      </div>
    </footer>
  );
}
