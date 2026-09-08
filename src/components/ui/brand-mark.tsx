import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex size-9 shrink-0 items-center justify-center rounded-full bg-[var(--button)] text-base font-semibold tracking-[-0.08em] text-[var(--strong)] shadow-[var(--shadow-button)]",
        className,
      )}
    >
      L<span className="text-[var(--brass,#9a7846)]">Y</span>
    </span>
  );
}
