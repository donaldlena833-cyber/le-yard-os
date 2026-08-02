import { cva, type VariantProps } from "class-variance-authority";
import type { ButtonHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

const buttonVariants = cva(
  "focus-ring inline-flex min-h-10 items-center justify-center gap-2 rounded-xl px-4 text-sm font-semibold transition-[background,color,transform,border-color] duration-200 disabled:pointer-events-none disabled:opacity-45 active:scale-[.98]",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--ink)] text-[var(--paper)] hover:bg-[var(--accent-strong)] dark:bg-[var(--accent)] dark:text-[#171a17] dark:hover:bg-[var(--accent-strong)]",
        accent:
          "bg-[var(--accent)] text-[#171a17] hover:bg-[var(--accent-strong)] hover:text-white",
        secondary:
          "border border-[var(--line)] bg-[var(--paper-strong)] text-[var(--ink)] hover:border-[var(--line-strong)] hover:bg-[var(--paper)]",
        quiet:
          "text-[var(--ink-soft)] hover:bg-[var(--canvas-strong)] hover:text-[var(--ink)]",
        danger:
          "bg-[var(--danger-soft)] text-[var(--danger)] hover:bg-[var(--danger)] hover:text-white",
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
