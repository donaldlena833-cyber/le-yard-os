import { cn } from "@/lib/utils";

const palette = [
  "bg-[#bfc8ae] text-[#35402c]",
  "bg-[#d9c3a0] text-[#63503a]",
  "bg-[#bcb9af] text-[#47483f]",
  "bg-[#858a73] text-[#f8f7ed]",
];

export function Avatar({
  name,
  size = "md",
  className,
  index = 0,
}: {
  name: string;
  size?: "sm" | "md" | "lg";
  className?: string;
  index?: number;
}) {
  const initials = name
    .split(" ")
    .map((part) => part[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();

  return (
    <span
      aria-label={name}
      title={name}
      className={cn(
        "workspace-avatar inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-[-0.03em]",
        palette[index % palette.length],
        size === "sm" && "size-7 text-xs",
        size === "md" && "size-9 text-xs",
        size === "lg" && "size-12 text-sm",
        className,
      )}
    >
      {initials}
    </span>
  );
}
