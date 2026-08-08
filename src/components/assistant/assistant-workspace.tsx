"use client";

import Link from "next/link";
import {
  ArrowRight,
  BookOpenCheck,
  CircleAlert,
  CornerDownLeft,
  FileSearch,
  LoaderCircle,
  LockKeyhole,
  Search,
  ShieldCheck,
  Sparkles,
} from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";
import { askLiveOperationsAction } from "@/app/actions/workflows/assistant";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { confidenceBand, guardedActionPolicy, validateCitations, type OperationsAnswer } from "@/lib/ai/guardrails";
import { runDemoOperationsQuery } from "@/lib/ai/demo-search";
import { cn } from "@/lib/utils";

const prompts = [
  "What needs attention before service?",
  "Which receipts need review?",
  "Summarize labor and pending punches",
  "What inventory is below par?",
];

const recordRoutes: Record<string, string> = {
  receipt: "/receipts",
  inventory_item: "/inventory",
  inventory_price: "/inventory",
  timecard: "/vendors",
  timecard_correction: "/vendors",
  shift: "/schedule",
  guest: "/guests",
  closeout: "/closeout",
  tip_run: "/closeout",
  payroll_evidence: "/reports?type=payroll",
  expense: "/reports?type=expenses",
  inventory_count: "/inventory?tab=counts",
  inventory_period: "/reports?type=cogs",
  waste_record: "/inventory?tab=waste",
  guest_activity: "/guests",
};

function AnswerCard({ answer }: { answer: OperationsAnswer }) {
  const citations = validateCitations(answer.citations);
  const policy = guardedActionPolicy(answer.proposedAction);
  const band = confidenceBand(answer.confidence);
  return (
    <article className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--paper)]">
      <div className="p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={band === "high" ? "positive" : band === "medium" ? "warning" : "danger"}>{Math.round(answer.confidence * 100)}% confidence</StatusPill>
          <StatusPill><BookOpenCheck className="size-3" /> {answer.citations.length} cited record{answer.citations.length === 1 ? "" : "s"}</StatusPill>
          <StatusPill tone="accent">{answer.sourceMode === "tenant_records" ? "Tenant records" : "Evidence preview"}</StatusPill>
        </div>
        <h3 className="mt-5 text-xl font-medium tracking-[-0.04em]">{answer.title}</h3>
        <p className="mt-3 max-w-3xl text-[13px] leading-6 text-[var(--ink-soft)]">{answer.summary}</p>
        {policy.humanApprovalRequired ? <p className="mt-4 flex items-start gap-2 rounded-[14px] bg-[var(--warning-soft)] p-3 text-[10px] leading-4 text-[var(--warning)]"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />This proposal cannot execute until an authorized person reviews and approves it.</p> : null}
      </div>
      <div className="border-t border-[var(--line)] bg-[var(--canvas)] px-5 py-4 sm:px-7">
        <p className="text-[9px] font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase">Underlying records</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {answer.citations.map((source) => (
            <Link key={source.id} href={recordRoutes[source.entityType] || "/reports"} className="focus-ring group flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-[var(--paper)]">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--paper-strong)]"><FileSearch className="size-3.5 text-[var(--ink-faint)]" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-[10px] font-semibold">{source.label}</span><span className="mt-1 block line-clamp-2 text-[9px] leading-4 text-[var(--ink-faint)]">{source.excerpt}</span></span>
              <ArrowRight className="mt-2 size-3 text-[var(--ink-faint)] transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
        {!citations.valid ? <p role="alert" className="mt-2 text-[9px] text-[var(--danger)]">{citations.reason}</p> : null}
      </div>
    </article>
  );
}

export function AssistantWorkspace() {
  const workspace = useWorkspaceContext();
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<OperationsAnswer | null>(() => workspace.mode === "demo" ? runDemoOperationsQuery(prompts[0]) : null);
  const [lastQuery, setLastQuery] = useState(workspace.mode === "demo" ? prompts[0] : "");
  const [notice, setNotice] = useState<string | null>(null);
  const [isPending, startTransition] = useTransition();

  function ask(value: string) {
    const clean = value.trim();
    if (!clean) return;
    setLastQuery(clean);
    setQuery("");
    setNotice(null);
    if (workspace.mode === "demo") {
      setAnswer(runDemoOperationsQuery(clean));
      return;
    }
    startTransition(async () => {
      const result = await askLiveOperationsAction(clean);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setAnswer(result.answer);
    });
  }

  function submit(event: FormEvent) {
    event.preventDefault();
    ask(query);
  }

  return (
    <PageFrame width="standard">
      <section className="relative overflow-hidden rounded-[26px] bg-[var(--graphite)] px-5 py-7 text-white sm:px-8 sm:py-9">
        <div className="absolute inset-0 workspace-grid opacity-20" />
        <div className="relative max-w-3xl">
          <div className="flex flex-wrap items-center gap-2"><StatusPill className="bg-white/[.08] text-[#e4aa55]"><Sparkles className="size-3" /> Ask Le Yard</StatusPill><span className="text-[9px] text-white/55">{workspace.mode === "live" ? `${workspace.activeLocation.name} · ${workspace.role}` : "Synthetic demo · owner preview"}</span></div>
          <h2 className="mt-5 text-[clamp(2rem,5vw,3.5rem)] leading-[1.02] font-medium tracking-[-0.06em]">Answers that show their work.</h2>
          <p className="mt-4 max-w-2xl text-xs leading-5 text-white/55">Search the operational record with citations, confidence, and human approval boundaries. This release uses deterministic evidence while external model access remains deferred.</p>
          <form onSubmit={submit} className="mt-7 flex items-center gap-2 rounded-[17px] bg-white/[.08] p-2 ring-1 ring-white/10 focus-within:ring-[#e1a34d]/70">
            <Search className="ml-2 size-4 shrink-0 text-white/55" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Ask a question about restaurant operations" placeholder="Ask about labor, receipts, guests, inventory…" className="h-11 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/55" />
            <Button type="submit" variant="accent" size="icon" aria-label="Ask Le Yard" disabled={!query.trim() || isPending}>{isPending ? <LoaderCircle className="size-4 animate-spin" /> : <CornerDownLeft className="size-4" />}</Button>
          </form>
        </div>
      </section>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
        {prompts.map((prompt) => <button key={prompt} disabled={isPending} onClick={() => ask(prompt)} className={cn("focus-ring shrink-0 rounded-full border px-3 py-2 text-[10px] font-semibold transition-colors disabled:opacity-50", lastQuery === prompt ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "border-[var(--line)] bg-[var(--paper)] text-[var(--ink-faint)] hover:text-[var(--ink)]")}>{prompt}</button>)}
      </div>

      {notice ? <p role="alert" className="mt-5 flex items-start gap-2 rounded-[16px] bg-[var(--warning-soft)] p-4 text-[10px] leading-4 text-[var(--warning)]"><CircleAlert className="mt-0.5 size-4 shrink-0" />{notice}</p> : null}
      <div className="mt-5">{answer ? <AnswerCard answer={answer} /> : <section className="rounded-[24px] border border-dashed border-[var(--line-strong)] bg-[var(--paper)] px-6 py-12 text-center"><FileSearch className="mx-auto size-5 text-[var(--ink-faint)]" /><h3 className="mt-4 text-base font-semibold">Ask from the active location’s record</h3><p className="mx-auto mt-2 max-w-md text-[10px] leading-4 text-[var(--ink-faint)]">Connected search reads the last 30 days through your authenticated tenant and location scope. It returns nothing when it cannot cite a source record.</p></section>}</div>

      <section className="mt-9">
        <SectionHeading title="Hard safety boundaries" detail="These controls apply even after a live model is connected." />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[18px] border border-[var(--line)] p-4"><LockKeyhole className="size-4 text-[var(--accent-strong)]" /><p className="mt-4 text-xs font-semibold">Permission aware</p><p className="mt-1 text-[9px] leading-4 text-[var(--ink-faint)]">Sources inherit the current user’s organization, location, role, and field-level access.</p></div>
          <div className="rounded-[18px] border border-[var(--line)] p-4"><BookOpenCheck className="size-4 text-[var(--positive)]" /><p className="mt-4 text-xs font-semibold">Citations required</p><p className="mt-1 text-[9px] leading-4 text-[var(--ink-faint)]">An answer without identifiable source records is invalid and cannot support an action.</p></div>
          <div className="rounded-[18px] border border-[var(--line)] p-4"><ShieldCheck className="size-4 text-[var(--positive)]" /><p className="mt-4 text-xs font-semibold">No silent mutations</p><p className="mt-1 text-[9px] leading-4 text-[var(--ink-faint)]">Payroll, tips, punches, inventory, and guest changes always require authorized human approval.</p></div>
        </div>
      </section>

      <p className="mt-6 flex items-start gap-2 rounded-[16px] bg-[var(--warning-soft)] p-4 text-[10px] leading-4 text-[var(--warning)]"><CircleAlert className="mt-0.5 size-4 shrink-0" />This release uses cited, deterministic evidence only. Live model calls and provider-backed OCR are not enabled, and no restaurant data is sent externally.</p>
    </PageFrame>
  );
}
