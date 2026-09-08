import { cn } from "@/lib/utils";
import { LyMonogram } from "@/components/ly-monogram";

export function BrandMark({ className }: { className?: string }) {
  return <LyMonogram className={cn("ly-workspace-mark", className)} />;
}
