import { cn } from "@/lib/utils";

const palette = [
  "bg-[#d9aa68] text-[#39220e]",
  "bg-[#b8cdc2] text-[#173427]",
  "bg-[#c9c2da] text-[#302648]",
  "bg-[#d9bdb6] text-[#45241e]",
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
        "inline-flex shrink-0 items-center justify-center rounded-full font-semibold tracking-[-0.03em] ring-2 ring-[var(--paper)]",
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
