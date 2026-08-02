"use client";

import { CircleAlert, RefreshCw } from "lucide-react";
import { useEffect } from "react";
import { Button } from "@/components/ui/button";

export default function WorkspaceError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    void fetch("/api/client-errors", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        digest: error.digest,
      }),
    });
  }, [error]);

  return (
    <div className="flex min-h-[calc(100svh-74px)] items-center justify-center px-5 py-12">
      <section className="w-full max-w-lg rounded-[24px] border border-[var(--line)] bg-[var(--paper)] p-6 text-center sm:p-9">
        <span className="mx-auto flex size-11 items-center justify-center rounded-2xl bg-[var(--danger-soft)] text-[var(--danger)]"><CircleAlert className="size-5" /></span>
        <p className="eyebrow mt-6">Recovery boundary</p>
        <h2 className="mt-3 text-2xl font-medium tracking-[-0.045em]">This workspace hit a snag.</h2>
        <p className="mt-3 text-xs leading-5 text-[var(--ink-faint)]">Your saved records were not changed. The incident was safely reported with a tenant-scoped fingerprint; sensitive form values were excluded.</p>
        {error.digest ? <p className="mt-4 font-mono text-[9px] text-[var(--ink-faint)]">Reference {error.digest}</p> : null}
        <Button className="mt-6" onClick={reset}><RefreshCw className="size-4" /> Try this workspace again</Button>
      </section>
    </div>
  );
}
