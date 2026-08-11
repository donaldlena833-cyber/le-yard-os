import {
  CircleAlert,
  CircleCheck,
  Info,
  TriangleAlert,
} from "lucide-react";
import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

export type InlineNoticeTone =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";
export type InlineNoticeAnnouncement = "off" | "polite" | "assertive";

const toneClasses: Record<InlineNoticeTone, string> = {
  neutral:
    "border-[var(--line)] bg-[var(--canvas-strong)] text-[var(--ink-soft)]",
  info:
    "border-[color-mix(in_srgb,var(--accent-strong)_18%,transparent)] bg-[var(--accent-soft)]/55 text-[var(--accent-strong)]",
  success:
    "border-[color-mix(in_srgb,var(--positive)_18%,transparent)] bg-[var(--positive-soft)] text-[var(--positive)]",
  warning:
    "border-[color-mix(in_srgb,var(--warning)_18%,transparent)] bg-[var(--warning-soft)] text-[var(--warning)]",
  danger:
    "border-[color-mix(in_srgb,var(--danger)_18%,transparent)] bg-[var(--danger-soft)] text-[var(--danger)]",
};

const toneIcons = {
  neutral: Info,
  info: Info,
  success: CircleCheck,
  warning: TriangleAlert,
  danger: CircleAlert,
} satisfies Record<InlineNoticeTone, typeof Info>;

export interface InlineNoticeProps
  extends Omit<
    HTMLAttributes<HTMLDivElement>,
    "aria-atomic" | "aria-live" | "children" | "role" | "title"
  > {
  children: ReactNode;
  title?: ReactNode;
  tone?: InlineNoticeTone;
  announce?: InlineNoticeAnnouncement;
  icon?: ReactNode;
  action?: ReactNode;
}

/**
 * A compact, non-modal notice. Announcement behavior is opt-in so static guidance
 * does not repeatedly interrupt screen-reader users.
 */
export function InlineNotice({
  children,
  title,
  tone = "neutral",
  announce = "off",
  icon,
  action,
  className,
  ...props
}: InlineNoticeProps) {
  const ToneIcon = toneIcons[tone];
  const role = announce === "assertive" ? "alert" : announce === "polite" ? "status" : "note";

  return (
    <div
      {...props}
      role={role}
      aria-live={announce === "off" ? undefined : announce}
      aria-atomic={announce === "off" ? undefined : true}
      className={cn(
        "flex min-w-0 flex-col gap-3 rounded-[16px] border px-4 py-3.5 text-sm leading-5 sm:flex-row sm:items-start",
        toneClasses[tone],
        className,
      )}
      data-slot="inline-notice"
    >
      <div className="flex min-w-0 flex-1 items-start gap-3">
        {icon === null ? null : (
          <span
            aria-hidden="true"
            className="mt-0.5 flex size-5 shrink-0 items-center justify-center"
          >
            {icon ?? <ToneIcon className="size-4" />}
          </span>
        )}
        <div className="min-w-0 flex-1">
          {title ? (
            <p className="font-semibold text-current">{title}</p>
          ) : null}
          <div className={cn("text-pretty", title && "mt-1")}>{children}</div>
        </div>
      </div>
      {action ? (
        <div className="shrink-0 self-start [&_a]:inline-flex [&_a]:min-h-11 [&_a]:min-w-11 [&_a]:items-center [&_button]:min-h-11 [&_button]:min-w-11 sm:self-center">
          {action}
        </div>
      ) : null}
    </div>
  );
}
