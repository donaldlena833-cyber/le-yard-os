"use client";

import { type KeyboardEvent, type ReactNode, useRef } from "react";

import { cn } from "@/lib/utils";

export interface ViewSwitcherItem<Id extends string> {
  id: Id;
  label: ReactNode;
  badge?: ReactNode;
  controls?: string;
}

export interface ViewSwitcherProps<Id extends string> {
  items: readonly ViewSwitcherItem<Id>[];
  value: Id;
  onValueChange(value: Id): void;
  label: string;
  className?: string;
}

/**
 * A compact alternative-view control for layouts that remain regions rather
 * than tab panels at larger breakpoints. Arrow, Home, and End keys both move
 * focus and activate the next view so repeated operational switching is fast.
 */
export function ViewSwitcher<Id extends string>({
  items,
  value,
  onValueChange,
  label,
  className,
}: ViewSwitcherProps<Id>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function activate(index: number) {
    const item = items[index];
    if (!item) return;
    onValueChange(item.id);
    buttonRefs.current[index]?.focus();
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextIndex = (index + 1) % items.length;
    }
    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextIndex = (index - 1 + items.length) % items.length;
    }
    if (event.key === "Home") nextIndex = 0;
    if (event.key === "End") nextIndex = items.length - 1;
    if (nextIndex === null) return;
    event.preventDefault();
    activate(nextIndex);
  }

  return (
    <div
      role="group"
      aria-label={label}
      className={cn(
        "grid grid-flow-col auto-cols-fr gap-1 rounded-xl bg-[var(--canvas-strong)] p-1",
        className,
      )}
    >
      {items.map((item, index) => {
        const active = item.id === value;
        return (
          <button
            key={item.id}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            type="button"
            aria-pressed={active}
            aria-controls={item.controls}
            data-state={active ? "active" : "inactive"}
            onClick={() => onValueChange(item.id)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "focus-ring flex min-h-11 min-w-0 items-center justify-center gap-2 rounded-lg px-3 text-xs font-semibold transition-colors",
              active
                ? "bg-[var(--paper-strong)] text-[var(--ink)] shadow-sm"
                : "text-[var(--ink-faint)] hover:text-[var(--ink)]",
            )}
          >
            <span className="truncate">{item.label}</span>
            {item.badge !== undefined ? (
              <span
                className={cn(
                  "numeric flex min-h-6 min-w-6 shrink-0 items-center justify-center rounded-full px-1.5 text-[10px]",
                  active
                    ? "bg-[var(--accent-soft)] text-[var(--accent-strong)]"
                    : "bg-[var(--paper)] text-[var(--ink-faint)]",
                )}
              >
                {item.badge}
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}
