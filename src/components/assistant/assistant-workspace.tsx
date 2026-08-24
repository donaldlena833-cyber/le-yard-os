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
  RotateCcw,
  Search,
  ShieldCheck,
  Sparkles,
  WandSparkles,
} from "lucide-react";
import { type FormEvent, useState, useTransition } from "react";
import {
  askLiveOperationsAction,
  askOwnerIntelligenceAction,
  executeOwnerIntelligenceProposalAction,
  undoOwnerIntelligenceProposalAction,
} from "@/app/actions/workflows/assistant";
import { useWorkspaceContext } from "@/components/providers/workspace-provider";
import { Button } from "@/components/ui/button";
import { ConfirmActionDialog } from "@/components/ui/confirm-action-dialog";
import { PageFrame, SectionHeading } from "@/components/ui/page-frame";
import { StatusPill } from "@/components/ui/status-pill";
import { confidenceBand, guardedActionPolicy, validateCitations, type OperationsAnswer } from "@/lib/ai/guardrails";
import type { OwnerIntelligenceAnswer } from "@/lib/ai/intelligence-contract";
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
  owner_request: "/assistant",
  report_summary: "/reports",
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
        {policy.humanApprovalRequired ? <p className="mt-4 flex items-start gap-2 rounded-[14px] bg-[var(--warning-soft)] p-3 text-xs leading-4 text-[var(--warning)]"><CircleAlert className="mt-0.5 size-3.5 shrink-0" />This proposal cannot execute until an authorized person reviews and approves it.</p> : null}
      </div>
      <div className="border-t border-[var(--line)] bg-[var(--canvas)] px-5 py-4 sm:px-7">
        <p className="text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase">Underlying records</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {answer.citations.map((source) => (
            <Link key={source.id} href={recordRoutes[source.entityType] || "/reports"} className="focus-ring group flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-[var(--paper)]">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--paper-strong)]"><FileSearch className="size-3.5 text-[var(--ink-faint)]" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{source.label}</span><span className="mt-1 block line-clamp-2 text-xs leading-4 text-[var(--ink-faint)]">{source.excerpt}</span></span>
              <ArrowRight className="mt-2 size-3 text-[var(--ink-faint)] transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
        {!citations.valid ? <p role="alert" className="mt-2 text-xs text-[var(--danger)]">{citations.reason}</p> : null}
      </div>
    </article>
  );
}

function OwnerAnswerCard({
  answer,
  onReview,
  onUndo,
  busy,
}: {
  answer: OwnerIntelligenceAnswer;
  onReview: () => void;
  onUndo: () => void;
  busy: boolean;
}) {
  const band = confidenceBand(answer.confidence);
  const proposal = answer.proposal;
  return (
    <article className="overflow-hidden rounded-[24px] border border-[var(--line)] bg-[var(--paper)]">
      <div className="p-5 sm:p-7">
        <div className="flex flex-wrap items-center gap-2">
          <StatusPill tone={band === "high" ? "positive" : band === "medium" ? "warning" : "danger"}>{Math.round(answer.confidence * 100)}% confidence</StatusPill>
          <StatusPill><BookOpenCheck className="size-3" /> {answer.citations.length} source{answer.citations.length === 1 ? "" : "s"}</StatusPill>
          <StatusPill tone="accent"><WandSparkles className="size-3" /> Codex subscription</StatusPill>
        </div>
        <h3 className="mt-5 text-xl font-medium tracking-[-0.04em]">{answer.title}</h3>
        <p className="mt-3 max-w-3xl text-[13px] leading-6 text-[var(--ink-soft)]">{answer.summary}</p>

        {proposal ? (
          <section className="mt-6 rounded-[18px] border border-[var(--accent)]/35 bg-[var(--accent-soft)] p-4 sm:p-5">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <p className="text-[11px] font-semibold tracking-[.12em] text-[var(--accent-strong)] uppercase">Proposed task · not saved</p>
                <h4 className="mt-2 text-sm font-semibold">{proposal.change.title}</h4>
                {proposal.change.description ? <p className="mt-1 text-xs leading-5 text-[var(--ink-soft)]">{proposal.change.description}</p> : null}
                <p className="mt-3 text-xs text-[var(--ink-faint)]">Priority: {proposal.change.priority}{proposal.change.dueAt ? ` · Due ${new Date(proposal.change.dueAt).toLocaleString()}` : " · No due date"} · Unassigned</p>
              </div>
              {proposal.status === "pending" ? (
                <Button type="button" variant="accent" onClick={onReview} disabled={busy}>Review & save</Button>
              ) : proposal.status === "applied" ? (
                <Button type="button" variant="secondary" onClick={onUndo} disabled={busy}><RotateCcw className="size-3.5" /> Undo task</Button>
              ) : (
                <StatusPill>Undone</StatusPill>
              )}
            </div>
            <p className="mt-4 flex items-start gap-2 text-xs leading-4 text-[var(--accent-strong)]"><ShieldCheck className="mt-0.5 size-3.5 shrink-0" />The model drafted this change. Nothing is written until you confirm the exact values.</p>
          </section>
        ) : null}
      </div>
      <div className="border-t border-[var(--line)] bg-[var(--canvas)] px-5 py-4 sm:px-7">
        <p className="text-xs font-semibold tracking-[.12em] text-[var(--ink-faint)] uppercase">Evidence used</p>
        <div className="mt-2 grid gap-1 sm:grid-cols-2">
          {answer.citations.map((source) => (
            <Link key={`${source.sourceTable}:${source.sourceRecordId}`} href={recordRoutes[source.sourceTable] || "/reports"} className="focus-ring group flex items-start gap-3 rounded-xl p-3 transition-colors hover:bg-[var(--paper)]">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-xl bg-[var(--paper-strong)]"><FileSearch className="size-3.5 text-[var(--ink-faint)]" /></span>
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-semibold">{source.label}</span><span className="mt-1 block line-clamp-2 text-xs leading-4 text-[var(--ink-faint)]">{source.excerpt}</span></span>
              <ArrowRight className="mt-2 size-3 text-[var(--ink-faint)] transition-transform group-hover:translate-x-0.5" />
            </Link>
          ))}
        </div>
      </div>
    </article>
  );
}

export function AssistantWorkspace() {
  const workspace = useWorkspaceContext();
  const [query, setQuery] = useState("");
  const [answer, setAnswer] = useState<OperationsAnswer | null>(() => workspace.mode === "demo" ? runDemoOperationsQuery(prompts[0]) : null);
  const [ownerAnswer, setOwnerAnswer] = useState<OwnerIntelligenceAnswer | null>(null);
  const [lastQuery, setLastQuery] = useState(workspace.mode === "demo" ? prompts[0] : "");
  const [notice, setNotice] = useState<string | null>(null);
  const [confirmationOpen, setConfirmationOpen] = useState(false);
  const [isPending, startTransition] = useTransition();

  function ask(value: string) {
    const clean = value.trim();
    if (!clean) return;
    setLastQuery(clean);
    setQuery("");
    setNotice(null);
    if (workspace.mode === "demo") {
      setOwnerAnswer(null);
      setAnswer(runDemoOperationsQuery(clean));
      return;
    }
    startTransition(async () => {
      const result = workspace.role === "owner"
        ? await askOwnerIntelligenceAction(clean)
        : await askLiveOperationsAction(clean);
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      if ("model" in result.answer) {
        setAnswer(null);
        setOwnerAnswer(result.answer);
      } else {
        setOwnerAnswer(null);
        setAnswer(result.answer);
      }
    });
  }

  function confirmProposal() {
    const proposal = ownerAnswer?.proposal;
    if (!proposal || proposal.status !== "pending") return;
    setNotice(null);
    startTransition(async () => {
      const result = await executeOwnerIntelligenceProposalAction({
        proposalId: proposal.id,
        confirmationFingerprint: proposal.confirmationFingerprint,
      });
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setConfirmationOpen(false);
      setOwnerAnswer((current) => current?.proposal?.id === result.proposalId
        ? { ...current, proposal: { ...current.proposal, status: "applied", taskId: result.taskId } }
        : current);
      setNotice("Task created. You can undo it here until the task is completed.");
    });
  }

  function undoProposal() {
    const proposal = ownerAnswer?.proposal;
    if (!proposal || proposal.status !== "applied") return;
    setNotice(null);
    startTransition(async () => {
      const result = await undoOwnerIntelligenceProposalAction({
        proposalId: proposal.id,
        reason: "Undone by the owner from Ask Le Yard.",
      });
      if (!result.ok) {
        setNotice(result.message);
        return;
      }
      setOwnerAnswer((current) => current?.proposal?.id === result.proposalId
        ? { ...current, proposal: { ...current.proposal, status: "reverted", taskId: result.taskId } }
        : current);
      setNotice("Task cancelled and the undo was recorded.");
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
          <div className="flex flex-wrap items-center gap-2"><StatusPill className="bg-white/[.08] text-[#e4aa55]"><Sparkles className="size-3" /> Ask Le Yard</StatusPill><span className="text-xs text-white/55">{workspace.mode === "live" ? `${workspace.activeLocation.name} · ${workspace.role}` : "Synthetic demo · owner preview"}</span></div>
          <h2 className="mt-5 text-[clamp(2rem,5vw,3.5rem)] leading-[1.02] font-medium tracking-[-0.06em]">Answers that show their work.</h2>
          <p className="mt-4 max-w-2xl text-xs leading-5 text-white/55">Search the operational record with citations and confidence. Your owner beta can draft a task, but it cannot save anything until you review and confirm the exact change.</p>
          <form onSubmit={submit} className="mt-7 flex items-center gap-2 rounded-[17px] bg-white/[.08] p-2 ring-1 ring-white/10 focus-within:ring-[#e1a34d]/70">
            <Search className="ml-2 size-4 shrink-0 text-white/55" />
            <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Ask a question about restaurant operations" placeholder="Ask about labor, receipts, guests, inventory…" className="h-11 min-w-0 flex-1 bg-transparent text-sm text-white outline-none placeholder:text-white/55" />
            <Button type="submit" variant="accent" size="icon" aria-label="Ask Le Yard" disabled={!query.trim() || isPending}>{isPending ? <LoaderCircle className="size-4 animate-spin" /> : <CornerDownLeft className="size-4" />}</Button>
          </form>
        </div>
      </section>

      <div className="mt-4 flex gap-2 overflow-x-auto pb-2">
        {prompts.map((prompt) => <button key={prompt} disabled={isPending} onClick={() => ask(prompt)} className={cn("focus-ring shrink-0 rounded-full border px-3 py-2 text-xs font-semibold transition-colors disabled:opacity-50", lastQuery === prompt ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent-strong)]" : "border-[var(--line)] bg-[var(--paper)] text-[var(--ink-faint)] hover:text-[var(--ink)]")}>{prompt}</button>)}
      </div>

      {notice ? <p role="alert" className="mt-5 flex items-start gap-2 rounded-[16px] bg-[var(--warning-soft)] p-4 text-xs leading-4 text-[var(--warning)]"><CircleAlert className="mt-0.5 size-4 shrink-0" />{notice}</p> : null}
      <div className="mt-5">{ownerAnswer ? <OwnerAnswerCard answer={ownerAnswer} onReview={() => setConfirmationOpen(true)} onUndo={undoProposal} busy={isPending} /> : answer ? <AnswerCard answer={answer} /> : <section className="rounded-[24px] border border-dashed border-[var(--line-strong)] bg-[var(--paper)] px-6 py-12 text-center"><FileSearch className="mx-auto size-5 text-[var(--ink-faint)]" /><h3 className="mt-4 text-base font-semibold">Ask from the active location’s record</h3><p className="mx-auto mt-2 max-w-md text-xs leading-4 text-[var(--ink-faint)]">Connected search reads the last 30 days through your authenticated tenant and location scope. Every operational statement must cite a supplied source record.</p></section>}</div>

      <section className="mt-9">
        <SectionHeading title="Hard safety boundaries" detail="These controls apply even after a live model is connected." />
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="rounded-[18px] border border-[var(--line)] p-4"><LockKeyhole className="size-4 text-[var(--accent-strong)]" /><p className="mt-4 text-xs font-semibold">Permission aware</p><p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">Sources inherit the current user’s organization, location, role, and field-level access.</p></div>
          <div className="rounded-[18px] border border-[var(--line)] p-4"><BookOpenCheck className="size-4 text-[var(--positive)]" /><p className="mt-4 text-xs font-semibold">Citations required</p><p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">An answer without identifiable source records is invalid and cannot support an action.</p></div>
          <div className="rounded-[18px] border border-[var(--line)] p-4"><ShieldCheck className="size-4 text-[var(--positive)]" /><p className="mt-4 text-xs font-semibold">No silent mutations</p><p className="mt-1 text-xs leading-4 text-[var(--ink-faint)]">Payroll, tips, punches, inventory, and guest changes always require authorized human approval.</p></div>
        </div>
      </section>

      <p className="mt-6 flex items-start gap-2 rounded-[16px] bg-[var(--warning-soft)] p-4 text-xs leading-4 text-[var(--warning)]"><CircleAlert className="mt-0.5 size-4 shrink-0" />Owner beta: operational evidence included in a question is processed through your local Codex subscription session. Access is limited to your explicitly authorized owner account with MFA.</p>

      <ConfirmActionDialog
        open={confirmationOpen && Boolean(ownerAnswer?.proposal)}
        labelledBy="confirm-intelligence-task"
        title="Create this task?"
        description="This is the first point where Ask Le Yard will write to the operating record. Confirm the exact task below."
        confirmLabel="Confirm & create task"
        confirmVariant="accent"
        busy={isPending}
        onClose={() => setConfirmationOpen(false)}
        onConfirm={confirmProposal}
      >
        {ownerAnswer?.proposal ? (
          <dl className="grid gap-3 rounded-[16px] bg-[var(--canvas)] p-4 text-xs">
            <div><dt className="font-semibold text-[var(--ink-faint)]">Title</dt><dd className="mt-1 text-[var(--ink)]">{ownerAnswer.proposal.change.title}</dd></div>
            <div><dt className="font-semibold text-[var(--ink-faint)]">Description</dt><dd className="mt-1 text-[var(--ink)]">{ownerAnswer.proposal.change.description || "None"}</dd></div>
            <div><dt className="font-semibold text-[var(--ink-faint)]">Priority</dt><dd className="mt-1 capitalize text-[var(--ink)]">{ownerAnswer.proposal.change.priority}</dd></div>
            <div><dt className="font-semibold text-[var(--ink-faint)]">Due</dt><dd className="mt-1 text-[var(--ink)]">{ownerAnswer.proposal.change.dueAt ? new Date(ownerAnswer.proposal.change.dueAt).toLocaleString() : "No due date"}</dd></div>
            <div><dt className="font-semibold text-[var(--ink-faint)]">Assigned to</dt><dd className="mt-1 text-[var(--ink)]">Unassigned</dd></div>
          </dl>
        ) : null}
      </ConfirmActionDialog>
    </PageFrame>
  );
}
