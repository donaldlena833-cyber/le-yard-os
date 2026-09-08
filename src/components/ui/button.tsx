import { cva, type VariantProps } from "class-variance-authority";
import type { ComponentPropsWithRef } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "focus-ring inline-flex min-h-11 items-center justify-center gap-2 rounded-full px-4 text-sm leading-none font-semibold whitespace-nowrap transition-[background-color,color,transform,box-shadow] duration-150 ease-out select-none touch-manipulation disabled:pointer-events-none disabled:opacity-45 motion-reduce:transform-none motion-reduce:transition-none active:scale-[.96]",
  {
    variants: {
      variant: {
        primary:
          "bg-[var(--primary)] text-[var(--on-primary)] shadow-[var(--shadow-primary)] hover:bg-[var(--primary-hover)]",
        accent:
          "bg-[var(--primary)] text-[var(--on-primary)] shadow-[var(--shadow-primary)] hover:bg-[var(--primary-hover)]",
        secondary:
          "bg-[var(--button)] text-[var(--strong)] shadow-[var(--shadow-button)] hover:bg-[var(--inner)]",
        quiet:
          "bg-[var(--button)] text-[var(--strong)] shadow-[var(--shadow-button)] hover:bg-[var(--inner)]",
        danger:
          "bg-[var(--danger-soft)] text-[var(--danger)] shadow-[var(--shadow-button)] hover:brightness-95",
      },
      size: {
        sm: "min-h-11 px-3.5 text-xs",
        md: "min-h-11 px-4",
        lg: "min-h-[46px] px-5",
        icon: "size-11 min-h-11 shrink-0 rounded-full p-0",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends
    ComponentPropsWithRef<"button">,
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
