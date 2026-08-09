import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-4 text-sm leading-none font-semibold whitespace-nowrap transition-[background-color,color,transform,border-color,box-shadow] duration-150 ease-out select-none touch-manipulation disabled:pointer-events-none disabled:translate-y-0 disabled:opacity-45 disabled:shadow-none motion-reduce:transform-none motion-reduce:transition-none hover:-translate-y-px active:translate-y-0 active:scale-[.98]",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--ink)] text-[var(--paper)] shadow-[0_1px_0_rgba(255,255,255,.12)_inset,0_1px_2px_rgba(25,28,24,.12)] hover:bg-[var(--accent-strong)] hover:shadow-[0_1px_0_rgba(255,255,255,.14)_inset,0_8px_20px_rgba(25,28,24,.14)] dark:bg-[var(--accent)] dark:text-[#171a17] dark:hover:bg-[var(--accent-strong)]",
        accent:
          "bg-[var(--accent)] text-[#171a17] shadow-[0_1px_0_rgba(255,255,255,.28)_inset,0_1px_2px_rgba(151,79,8,.14)] hover:bg-[var(--accent-strong)] hover:text-white hover:shadow-[0_1px_0_rgba(255,255,255,.16)_inset,0_8px_20px_rgba(201,130,34,.24)]",
        secondary:
          "border border-[var(--line)] bg-[var(--paper-strong)] text-[var(--ink)] shadow-[0_1px_0_rgba(255,255,255,.38)_inset,0_1px_2px_rgba(25,28,24,.04)] hover:border-[var(--line-strong)] hover:bg-[var(--paper)] hover:shadow-[0_1px_0_rgba(255,255,255,.4)_inset,0_6px_16px_rgba(25,28,24,.08)]",
        quiet:
          "text-[var(--ink-soft)] hover:bg-[var(--canvas-strong)] hover:text-[var(--ink)]",
        danger:
          "border border-transparent bg-[var(--danger-soft)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white hover:shadow-[0_8px_20px_rgba(166,66,53,.18)]",
      },
      size: {
        sm: "min-h-11 rounded-lg px-3.5 text-xs",
        md: "min-h-11 px-4",
        lg: "min-h-12 rounded-[14px] px-5",
        icon: "size-11 min-h-11 shrink-0 p-0",
      },
    },
    defaultVariants: {
      variant: "primary",
      size: "md",
    },
  },
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {}

export function Button({
  className,
  variant,
  size,
  type = "button",
  ...props
}: ButtonProps) {
  return (
    <button
      type={type}
      className={cn(buttonVariants({ variant, size }), className)}
      {...props}
    />
  );
}
