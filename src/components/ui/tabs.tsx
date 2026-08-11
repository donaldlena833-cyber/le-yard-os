"use client";

import { type KeyboardEvent, type ReactNode, useRef } from "react";

import { cn } from "@/lib/utils";

export interface TabItem<Value extends string> {
  value: Value;
  label: ReactNode;
  badge?: ReactNode;
  disabled?: boolean;
}

export interface TabsProps<Value extends string> {
  id: string;
  items: readonly TabItem<Value>[];
  value: Value;
  onValueChange(value: NoInfer<Value>): void;
  label: string;
  className?: string;
  size?: "default" | "large";
}

function tabId(baseId: string, value: string) {
  return `${baseId}-tab-${value}`;
}

function panelId(baseId: string, value: string) {
  return `${baseId}-panel-${value}`;
}

/**
 * Controlled operational tabs with automatic activation. Arrow keys wrap
 * across enabled tabs; Home and End jump to the first and last enabled tab.
 */
export function Tabs<const Value extends string>({
  id,
  items,
  value,
  onValueChange,
  label,
  className,
  size = "default",
}: TabsProps<Value>) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);

  function activate(index: number) {
    const item = items[index];
    if (!item || item.disabled) return;
    onValueChange(item.value);
    buttonRefs.current[index]?.focus();
  }

  function nextEnabledIndex(index: number, direction: 1 | -1) {
    for (let offset = 1; offset <= items.length; offset += 1) {
      const candidate =
        (index + direction * offset + items.length) % items.length;
      if (!items[candidate]?.disabled) return candidate;
    }
    return null;
  }

  function edgeEnabledIndex(fromEnd: boolean) {
    const indexes = Array.from({ length: items.length }, (_, index) => index);
    if (fromEnd) indexes.reverse();
    return indexes.find((index) => !items[index]?.disabled) ?? null;
  }

  function handleKeyDown(
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let nextIndex: number | null = null;
    if (event.key === "ArrowRight") nextIndex = nextEnabledIndex(index, 1);
    if (event.key === "ArrowLeft") nextIndex = nextEnabledIndex(index, -1);
    if (event.key === "Home") nextIndex = edgeEnabledIndex(false);
    if (event.key === "End") nextIndex = edgeEnabledIndex(true);
    if (nextIndex === null) return;
    event.preventDefault();
    activate(nextIndex);
  }

  return (
    <div
      role="tablist"
      aria-label={label}
      aria-orientation="horizontal"
      className={cn(
        "flex items-center gap-1 overflow-x-auto border-b border-[var(--line)]",
        className,
      )}
    >
      {items.map((item, index) => {
        const active = item.value === value;
        return (
          <button
            key={item.value}
            ref={(node) => {
              buttonRefs.current[index] = node;
            }}
            id={tabId(id, item.value)}
            type="button"
            role="tab"
            aria-selected={active}
            aria-controls={panelId(id, item.value)}
            tabIndex={active ? 0 : -1}
            disabled={item.disabled}
            onClick={() => onValueChange(item.value)}
            onKeyDown={(event) => handleKeyDown(event, index)}
            className={cn(
              "focus-ring relative flex shrink-0 items-center justify-center gap-1.5 px-3 text-[13px] font-semibold transition-colors disabled:cursor-not-allowed disabled:opacity-45",
              size === "large" ? "min-h-12" : "min-h-11",
              active
                ? "text-[var(--ink)]"
                : "text-[var(--ink-faint)] hover:text-[var(--ink-soft)]",
            )}
          >
            <span>{item.label}</span>
            {item.badge !== undefined ? (
              <span className="numeric rounded-full bg-[var(--canvas-strong)] px-1.5 py-0.5 text-[10px] text-[var(--ink-faint)]">
                {item.badge}
              </span>
            ) : null}
            {active ? (
              <span
                aria-hidden="true"
                className="absolute inset-x-2 bottom-0 h-0.5 rounded-full bg-[var(--accent)]"
              />
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

export function TabPanel({
  id,
  value,
  children,
  className,
}: {
  id: string;
  value: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      id={panelId(id, value)}
      role="tabpanel"
      aria-labelledby={tabId(id, value)}
      className={className}
    >
      {children}
    </div>
  );
}
