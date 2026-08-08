import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export function PageFrame({
  children,
  className,
  width = "wide",
}: {
  children: ReactNode;
  className?: string;
  width?: "wide" | "standard" | "full";
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-5 sm:px-6 sm:py-7 lg:px-8 lg:py-8",
        width === "wide" && "max-w-[1520px]",
        width === "standard" && "max-w-[1240px]",
        width === "full" && "max-w-none",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function SectionHeading({
  eyebrow,
  title,
  detail,
  action,
  className,
}: {
  eyebrow?: string;
  title: string;
  detail?: string;
  action?: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("mb-4 flex items-end justify-between gap-4", className)}>
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h2 className="text-[15px] font-semibold tracking-[-0.025em] text-[var(--ink)] sm:text-base">
          {title}
        </h2>
        {detail ? (
          <p className="mt-1 text-[11px] leading-4 text-[var(--ink-faint)]">{detail}</p>
        ) : null}
      </div>
      {action}
    </div>
  );
}

export function Metric({
  label,
  value,
  detail,
  trend,
  className,
}: {
  label: string;
  value: string;
  detail?: string;
  trend?: { label: string; tone: "positive" | "negative" | "neutral" };
  className?: string;
}) {
  return (
    <div className={cn("min-w-0 px-4 py-4 first:pl-0 sm:px-5", className)}>
      <p className="text-[11px] font-medium text-[var(--ink-faint)]">{label}</p>
      <div className="mt-2 flex items-baseline gap-2">
        <p className="numeric truncate text-[1.65rem] leading-none font-medium tracking-[-0.055em] text-[var(--ink)] sm:text-[1.95rem]">
          {value}
        </p>
        {trend ? (
          <span
            className={cn(
              "text-[10px] font-semibold",
              trend.tone === "positive" && "text-[var(--positive)]",
              trend.tone === "negative" && "text-[var(--danger)]",
              trend.tone === "neutral" && "text-[var(--ink-faint)]",
            )}
          >
            {trend.label}
          </span>
        ) : null}
      </div>
      {detail ? (
        <p className="mt-2 truncate text-[10px] text-[var(--ink-faint)]">{detail}</p>
      ) : null}
    </div>
  );
}

export function DividerList({ children }: { children: ReactNode }) {
  return <div className="divide-y divide-[var(--line)] border-y border-[var(--line)]">{children}</div>;
}
