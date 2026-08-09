import type { HTMLAttributes, ReactNode } from "react";
import { cn } from "@/lib/utils";

type SurfaceElement = "div" | "section" | "article" | "aside";
type SurfaceVariant = "plain" | "outlined" | "raised" | "inset" | "accent";
type SurfacePadding = "none" | "sm" | "md" | "lg";

const variantClasses: Record<SurfaceVariant, string> = {
  plain: "",
  outlined:
    "border border-[var(--line)] bg-[var(--paper-strong)]",
  raised:
    "border border-[var(--line)] bg-[var(--paper-strong)] shadow-[var(--shadow-raised)]",
  inset:
    "border border-[var(--line)] bg-[var(--canvas-strong)] shadow-[0_1px_2px_rgba(25,28,24,.025)_inset]",
  accent:
    "border border-[color-mix(in_srgb,var(--accent-strong)_16%,transparent)] bg-[var(--accent-soft)]",
};

const paddingClasses: Record<SurfacePadding, string> = {
  none: "",
  sm: "p-3 sm:p-4",
  md: "p-4 sm:p-5",
  lg: "p-5 sm:p-6 lg:p-7",
};

export interface SurfaceProps extends HTMLAttributes<HTMLElement> {
  as?: SurfaceElement;
  children: ReactNode;
  variant?: SurfaceVariant;
  padding?: SurfacePadding;
}

export function Surface({
  as: Component = "section",
  children,
  variant = "plain",
  padding = "none",
  className,
  ...props
}: SurfaceProps) {
  return (
    <Component
      className={cn(
        "relative min-w-0",
        variant !== "plain" && "overflow-hidden rounded-[18px] sm:rounded-[20px]",
        variantClasses[variant],
        paddingClasses[padding],
        className,
      )}
      {...props}
    >
      {children}
    </Component>
  );
}

export interface CardProps extends Omit<SurfaceProps, "variant"> {
  variant?: Exclude<SurfaceVariant, "plain">;
}

export function Card({
  as = "article",
  variant = "outlined",
  padding = "md",
  ...props
}: CardProps) {
  return <Surface as={as} variant={variant} padding={padding} {...props} />;
}
