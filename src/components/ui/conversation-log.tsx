import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ConversationLogEntry {
  id: string;
  summary: ReactNode;
  body: ReactNode;
  leading?: ReactNode;
  context?: ReactNode;
  timestamp?: {
    dateTime: string;
    label: ReactNode;
  };
  trailing?: ReactNode;
}

export interface ConversationLogProps {
  entries: readonly ConversationLogEntry[];
  label: string;
  empty: ReactNode;
  className?: string;
}

/** A semantic, source-ordered record of human operational context. */
export function ConversationLog({
  entries,
  label,
  empty,
  className,
}: ConversationLogProps) {
  if (!entries.length) {
    return (
      <div
        role="status"
        className={cn(
          "border-y border-[var(--line)] py-5 text-center text-xs text-[var(--ink-faint)]",
          className,
        )}
      >
        {empty}
      </div>
    );
  }

  return (
    <ol
      aria-label={label}
      className={cn(
        "divide-y divide-[var(--line)] border-y border-[var(--line)]",
        className,
      )}
    >
      {entries.map((entry) => (
        <li key={entry.id} className="py-4">
          <article>
            <header className="flex items-start gap-2.5">
              {entry.leading ? (
                <span className="mt-0.5 flex size-5 shrink-0 items-center justify-center text-[var(--ink-faint)]">
                  {entry.leading}
                </span>
              ) : null}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-semibold text-[var(--ink)]">
                  {entry.summary}
                </p>
                {entry.context ? (
                  <div className="mt-1 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-xs text-[var(--ink-faint)]">
                    {entry.context}
                  </div>
                ) : null}
              </div>
              {entry.timestamp ? (
                <time
                  dateTime={entry.timestamp.dateTime}
                  className="numeric shrink-0 text-xs text-[var(--ink-faint)]"
                >
                  {entry.timestamp.label}
                </time>
              ) : null}
              {entry.trailing ? (
                <div className="shrink-0">{entry.trailing}</div>
              ) : null}
            </header>
            <div className="mt-2 whitespace-pre-wrap text-[13px] leading-5 text-[var(--ink-soft)]">
              {entry.body}
            </div>
          </article>
        </li>
      ))}
    </ol>
  );
}
