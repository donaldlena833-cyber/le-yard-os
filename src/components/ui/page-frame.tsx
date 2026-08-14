import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

type PageWidth = "wide" | "standard" | "full";

const pageWidths: Record<PageWidth, string> = {
  wide: "max-w-[1520px]",
  standard: "max-w-[1240px]",
  full: "max-w-none",
};

export function PageFrame({
  children,
  className,
  width = "wide",
}: {
  children: ReactNode;
  className?: string;
  width?: PageWidth;
}) {
  return (
    <div
      className={cn(
        "mx-auto w-full px-4 py-6 sm:px-6 sm:py-8 lg:px-8 lg:py-10",
        pageWidths[width],
        className,
      )}
    >
      {children}
    </div>
  );
}

export function PageHeader({
  eyebrow,
  title,
  detail,
  status,
  actions,
  className,
}: {
  eyebrow?: ReactNode;
  title: ReactNode;
  detail?: ReactNode;
  status?: ReactNode;
  actions?: ReactNode;
  className?: string;
}) {
  return (
    <header
      className={cn(
        "flex flex-col gap-5 border-b border-[var(--line)] pb-6 sm:gap-6 sm:pb-8 lg:flex-row lg:items-end lg:justify-between",
        className,
      )}
    >
      <div className="min-w-0 max-w-3xl">
        {eyebrow || status ? (
          <div className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-2 text-xs font-medium text-[var(--ink-faint)]">
            {eyebrow ? <span>{eyebrow}</span> : null}
            {status}
          </div>
        ) : null}
        <h2 className="text-[1.75rem] leading-[1.08] font-semibold tracking-[-0.045em] text-balance text-[var(--ink)] sm:text-[2rem] lg:text-[2.25rem]">
          {title}
        </h2>
        {detail ? (
          <div className="mt-3 max-w-2xl text-sm leading-6 text-pretty text-[var(--ink-soft)] sm:text-[15px]">
            {detail}
          </div>
        ) : null}
      </div>
      {actions ? (
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto lg:shrink-0 lg:justify-end">
          {actions}
        </div>
      ) : null}
    </header>
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
    <div
      className={cn(
        "mb-5 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between sm:gap-5",
        className,
      )}
    >
      <div className="min-w-0">
        {eyebrow ? <p className="eyebrow mb-2">{eyebrow}</p> : null}
        <h2 className="text-[17px] leading-6 font-semibold tracking-[-0.025em] text-[var(--ink)] sm:text-lg">
          {title}
        </h2>
        {detail ? (
          <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-[var(--ink-faint)]">
            {detail}
          </p>
        ) : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
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
    <div className={cn("min-w-0 px-4 py-5 first:pl-0 sm:px-5 sm:py-6", className)}>
      <p className="text-xs leading-4 font-medium text-[var(--ink-faint)]">{label}</p>
      <div className="mt-2.5 flex flex-wrap items-baseline gap-x-2.5 gap-y-1">
        <p className="numeric min-w-0 truncate text-[1.9rem] leading-none font-semibold tracking-[-0.055em] text-[var(--ink)] sm:text-[2.15rem]">
          {value}
        </p>
        {trend ? (
          <span
            className={cn(
              "text-[13px] leading-4 font-semibold",
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
        <p className="mt-2 text-xs leading-4 text-[var(--ink-faint)]">{detail}</p>
      ) : null}
    </div>
  );
}

export function DividerList({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "divide-y divide-[var(--line)] border-y border-[var(--line)]",
        className,
      )}
    >
      {children}
    </div>
  );
}
