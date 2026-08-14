import type { ReactNode } from "react";

import { cn } from "@/lib/utils";

export interface ScheduleAgendaDay<T> {
  id: string;
  label: ReactNode;
  detail?: ReactNode;
  items: readonly T[];
}

export interface ScheduleAgendaProps<T> {
  days: readonly ScheduleAgendaDay<T>[];
  getItemKey(item: T): string;
  renderItem(item: T): ReactNode;
  label?: string;
  emptyLabel?: string;
  className?: string;
}

/**
 * A narrow-screen schedule projection grouped by day. The desktop board keeps
 * drag-and-drop; this agenda keeps reading and object-level actions linear,
 * keyboard reachable, and free of horizontal scrolling.
 */
export function ScheduleAgenda<T>({
  days,
  getItemKey,
  renderItem,
  label = "Weekly schedule agenda",
  emptyLabel = "No shifts scheduled",
  className,
}: ScheduleAgendaProps<T>) {
  return (
    <div aria-label={label} className={cn("space-y-5", className)}>
      {days.map((day) => (
        <section
          key={day.id}
          aria-labelledby={`schedule-agenda-day-${day.id}`}
          className="rounded-[18px] border border-[var(--line)] bg-[var(--canvas)] p-3"
        >
          <header className="flex min-h-11 items-center justify-between gap-3 px-1">
            <div className="min-w-0">
              <h3
                id={`schedule-agenda-day-${day.id}`}
                className="truncate text-sm font-semibold"
              >
                {day.label}
              </h3>
              {day.detail ? (
                <p className="mt-1 text-xs text-[var(--ink-faint)]">
                  {day.detail}
                </p>
              ) : null}
            </div>
            <span
              aria-label={`${day.items.length} ${day.items.length === 1 ? "shift" : "shifts"}`}
              className="numeric flex min-h-7 min-w-7 shrink-0 items-center justify-center rounded-full bg-[var(--paper-strong)] px-2 text-xs font-semibold text-[var(--ink-soft)]"
            >
              {day.items.length}
            </span>
          </header>

          {day.items.length ? (
            <div
              role="list"
              aria-label={`${typeof day.label === "string" ? day.label : day.id} shifts`}
              className="mt-2 space-y-2"
            >
              {day.items.map((item) => (
                <div key={getItemKey(item)} role="listitem">
                  {renderItem(item)}
                </div>
              ))}
            </div>
          ) : (
            <p className="mt-2 flex min-h-16 items-center justify-center rounded-xl border border-dashed border-[var(--line)] px-4 text-center text-xs text-[var(--ink-faint)]">
              {emptyLabel}
            </p>
          )}
        </section>
      ))}
    </div>
  );
}
