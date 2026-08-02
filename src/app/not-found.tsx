import Link from "next/link";
import { ArrowLeft, Compass } from "lucide-react";
import { BrandMark } from "@/components/ui/brand-mark";

export default function NotFound() {
  return (
    <main className="flex min-h-svh items-center justify-center bg-[var(--canvas)] px-5">
      <section className="w-full max-w-md text-center">
        <BrandMark className="mx-auto size-11 rounded-[14px]" />
        <span className="mx-auto mt-8 flex size-10 items-center justify-center rounded-2xl bg-[var(--canvas-strong)] text-[var(--ink-faint)]"><Compass className="size-4" /></span>
        <p className="eyebrow mt-5">404 · Not found</p>
        <h1 className="mt-3 text-3xl font-medium tracking-[-0.055em]">This workspace isn’t here.</h1>
        <p className="mt-3 text-xs leading-5 text-[var(--ink-faint)]">The link may be stale, or your location and role may not include this record.</p>
        <Link href="/today" className="focus-ring mx-auto mt-7 inline-flex h-10 items-center gap-2 rounded-xl bg-[var(--ink)] px-4 text-xs font-semibold text-[var(--paper)]"><ArrowLeft className="size-3.5" /> Back to Today</Link>
      </section>
    </main>
  );
}
