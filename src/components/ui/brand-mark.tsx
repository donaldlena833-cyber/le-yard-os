import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={cn(
        "relative inline-flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-[#f2efe6] text-[10px] font-bold tracking-[-0.08em] text-[#1a1d19] shadow-[inset_0_0_0_1px_rgba(255,255,255,.24)]",
        className,
      )}
    >
      L<span className="text-[#c98222]">Y</span>
    </span>
  );
}
