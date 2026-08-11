import { Fragment, type CSSProperties, type ReactNode } from "react";
import { cn } from "@/lib/utils";

export interface ResponsiveDataColumn<T> {
  key: string;
  label: ReactNode;
  align?: "left" | "right";
  render(item: T): ReactNode;
}

export interface ResponsiveDataViewProps<T> {
  items: readonly T[];
  columns: readonly ResponsiveDataColumn<T>[];
  getItemKey(item: T): string;
  renderCard(item: T): ReactNode;
  renderDetails?(item: T): ReactNode;
  label: string;
  empty: ReactNode;
  minTableWidth?: number;
  className?: string;
  tableClassName?: string;
  rowClassName?: string | ((item: T) => string | undefined);
}

/**
 * Renders one semantic table on wider screens and a purpose-built card/list view
 * on small screens. Both variants remain server-renderable and require no viewport JS.
 */
export function ResponsiveDataView<T>({
  items,
  columns,
  getItemKey,
  renderCard,
  renderDetails,
  label,
  empty,
  minTableWidth = 760,
  className,
  tableClassName,
  rowClassName,
}: ResponsiveDataViewProps<T>) {
  if (!items.length) return <>{empty}</>;

  return (
    <div className={className}>
      <div
        role="region"
        aria-label={label}
        tabIndex={0}
        className="focus-ring hidden overflow-x-auto border-y border-[var(--line)] md:block"
      >
        <table
          className={cn("w-full border-collapse text-left", tableClassName)}
          style={{ minWidth: minTableWidth } as CSSProperties}
        >
          <caption className="sr-only">{label}</caption>
          <thead className="bg-[var(--canvas-strong)]">
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  className={cn(
                    "px-4 py-2.5 text-xs font-semibold tracking-[0.1em] text-[var(--ink-faint)] uppercase",
                    column.align === "right" && "text-right",
                  )}
                >
                  {column.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--line)]">
            {items.map((item) => {
              const details = renderDetails?.(item);
              return (
                <Fragment key={getItemKey(item)}>
                  <tr
                    className={cn(
                      "transition-colors hover:bg-[var(--paper)]",
                      typeof rowClassName === "function"
                        ? rowClassName(item)
                        : rowClassName,
                    )}
                  >
                    {columns.map((column) => (
                      <td
                        key={column.key}
                        className={cn(
                          "px-4 py-3.5 text-xs text-[var(--ink-soft)]",
                          column.align === "right" &&
                            "numeric text-right font-semibold text-[var(--ink)]",
                        )}
                      >
                        {column.render(item)}
                      </td>
                    ))}
                  </tr>
                  {details ? (
                    <tr className="bg-[var(--paper)]">
                      <td colSpan={columns.length} className="px-5 py-4">
                        {details}
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
      <div
        role="list"
        aria-label={`${label}, mobile view`}
        className="divide-y divide-[var(--line)] border-y border-[var(--line)] md:hidden"
      >
        {items.map((item) => (
          <article
            key={getItemKey(item)}
            role="listitem"
            className="py-4 first:pt-3 last:pb-3"
            style={{
              contentVisibility: "auto",
              containIntrinsicSize: "0 112px",
            }}
          >
            {renderCard(item)}
          </article>
        ))}
      </div>
    </div>
  );
}
