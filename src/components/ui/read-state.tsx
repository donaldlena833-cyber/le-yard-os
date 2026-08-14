import {
  CircleAlert,
  CloudOff,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  RefreshCw,
} from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ReadStateKind =
  "loading" | "empty" | "unavailable" | "stale" | "restricted";

const statePresentation = {
  loading: {
    icon: LoaderCircle,
    iconClass: "bg-[var(--accent-soft)] text-[var(--accent-strong)]",
  },
  empty: {
    icon: Inbox,
    iconClass: "bg-[var(--canvas-strong)] text-[var(--ink-faint)]",
  },
  unavailable: {
    icon: CloudOff,
    iconClass: "bg-[var(--warning-soft)] text-[var(--warning)]",
  },
  stale: {
    icon: RefreshCw,
    iconClass: "bg-[var(--warning-soft)] text-[var(--warning)]",
  },
  restricted: {
    icon: LockKeyhole,
    iconClass: "bg-[var(--canvas-strong)] text-[var(--ink-faint)]",
  },
} satisfies Record<
  ReadStateKind,
  { icon: typeof CircleAlert; iconClass: string }
>;

export interface ReadStateProps extends Omit<
  HTMLAttributes<HTMLElement>,
  "children" | "title"
> {
  state: ReadStateKind;
  title: ReactNode;
  description: ReactNode;
  action?: ReactNode;
  detail?: ReactNode;
  icon?: ReactNode;
  headingLevel?: 1 | 2 | 3;
  announce?: "off" | "polite" | "assertive";
  compact?: boolean;
}

/**
 * Shared read-only boundary for loading, empty, stale, restricted, and failed reads.
 * Announcements are opt-in so server-rendered states do not repeatedly interrupt users.
 */
export function ReadState({
  state,
  title,
  description,
  action,
  detail,
  icon,
  headingLevel = 2,
  announce = "off",
  compact = false,
  className,
  ...props
}: ReadStateProps) {
  const presentation = statePresentation[state];
  const StateIcon = presentation.icon;
  const Heading = `h${headingLevel}` as "h1" | "h2" | "h3";
  const role =
    announce === "assertive"
      ? "alert"
      : announce === "polite"
        ? "status"
        : undefined;

  return (
    <section
      {...props}
      role={role}
      aria-live={announce === "off" ? undefined : announce}
      aria-atomic={announce === "off" ? undefined : true}
      aria-busy={state === "loading" ? true : undefined}
      data-read-state={state}
      className={cn(
        "rounded-[24px] border border-[var(--line)] bg-[var(--paper-strong)] text-center shadow-[var(--shadow-card)]",
        compact ? "px-5 py-7" : "px-6 py-10 sm:px-8 sm:py-12",
        className,
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "mx-auto flex size-11 items-center justify-center rounded-[15px]",
          presentation.iconClass,
        )}
      >
        {icon ?? (
          <StateIcon
            className={cn(
              "size-5",
              state === "loading" && "animate-spin motion-reduce:animate-none",
            )}
          />
        )}
      </span>
      <Heading
        className={cn(
          "font-medium tracking-[-0.04em]",
          compact ? "mt-3 text-lg" : "mt-4 text-xl",
        )}
      >
        {title}
      </Heading>
      <div className="mx-auto mt-2 max-w-xl text-pretty text-sm leading-6 text-[var(--ink-faint)]">
        {description}
      </div>
      {detail ? (
        <div className="mx-auto mt-3 max-w-xl text-xs leading-5 text-[var(--ink-faint)]">
          {detail}
        </div>
      ) : null}
      {action ? (
        <div className="mt-5 flex flex-wrap justify-center gap-2 [&_a]:inline-flex [&_a]:min-h-11 [&_a]:items-center [&_button]:min-h-11">
          {action}
        </div>
      ) : null}
    </section>
  );
}
