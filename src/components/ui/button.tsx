import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-[background,color,transform,border-color,box-shadow] duration-200 will-change-transform disabled:pointer-events-none disabled:opacity-45 hover:-translate-y-px active:translate-y-0 active:scale-[.98]",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--accent-strong)] hover:shadow-[0_8px_20px_rgba(25,28,24,.14)] dark:bg-[var(--accent)] dark:text-[#171a17] dark:hover:bg-[var(--accent-strong)]",
        accent:
          "bg-[var(--accent)] text-[#171a17] hover:bg-[var(--accent-strong)] hover:text-white hover:shadow-[0_8px_20px_rgba(201,130,34,.24)]",
        secondary:
          "border border-[var(--line)] bg-[var(--paper-strong)] text-[var(--ink)] hover:border-[var(--line-strong)] hover:bg-[var(--paper)] hover:shadow-[0_6px_16px_rgba(25,28,24,.08)]",
        quiet:
          "text-[var(--ink-soft)] hover:bg-[var(--canvas-strong)] hover:text-[var(--ink)]",
        danger:
          "bg-[var(--danger-soft)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white hover:shadow-[0_8px_20px_rgba(166,66,53,.18)]",
      },
      size: {
        sm: "min-h-8 rounded-lg px-3 text-xs",
        md: "min-h-10 px-4",
        lg: "min-h-12 rounded-[14px] px-5",
        icon: "size-10 min-h-10 p-0",
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
