"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import type { ReportView } from "@/components/reports/report-data";
import { loadLiveReport } from "@/data/read-models/reports";
import { addIsoDays, localDateKey } from "@/data/read-models/shared";
import { runOwnerIntelligence } from "@/lib/ai/owner-intelligence-provider.server";
import type { OperationsAnswer } from "@/lib/ai/guardrails";
import {
  intelligenceTaskProposalSchema,
  type IntelligenceEvidence,
  type OwnerIntelligenceAnswer,
} from "@/lib/ai/intelligence-contract";
import { reportKindForOperationsQuery } from "@/lib/ai/query-routing";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { createClient } from "@/lib/supabase/server";
import type { Json } from "@/types/database.generated";
import type { ReportKind } from "@/types";

const querySchema = z.string().trim().min(2).max(500);
const proposalDecisionSchema = z.object({
  proposalId: z.uuid(),
  confirmationFingerprint: z.string().regex(/^[a-f0-9]{64}$/),
});
const proposalUndoSchema = z.object({
  proposalId: z.uuid(),
  reason: z.string().trim().min(2).max(1_000),
});
const completionSchema = z.object({
  runId: z.uuid(),
  proposalId: z.uuid().nullable(),
  confirmationFingerprint: z.string().regex(/^[a-f0-9]{64}$/).nullable(),
});
const taskMutationResultSchema = z.object({
  proposalId: z.uuid(),
  taskId: z.uuid(),
  status: z.string(),
  replayed: z.boolean(),
});

export type AskLiveOperationsResult =
  | { ok: true; answer: OperationsAnswer }
  | { ok: false; message: string };

export type AskOwnerIntelligenceResult =
  | { ok: true; answer: OwnerIntelligenceAnswer }
  | { ok: false; message: string };

export type OwnerIntelligenceMutationResult =
  | { ok: true; proposalId: string; taskId: string; status: string }
  | { ok: false; message: string };

const citationEntity: Record<ReportKind, string> = {
  labor: "timecard",
  attendance: "timecard",
  overtime: "timecard",
  tips: "tip_run",
  payroll: "payroll_evidence",
  sales_to_labor: "closeout",
  receipts: "receipt",
  expenses: "expense",
  inventory_variance: "inventory_count",
  cogs: "inventory_period",
  waste: "waste_record",
  vendor_pricing: "inventory_price",
  shift_performance: "closeout",
  guest_activity: "guest_activity",
};

function answerFromReport(view: ReportView, truncated: boolean): OperationsAnswer | null {
  if (!view.rows.length || !view.freshnessAt) return null;
  const sourceObservedAt = view.freshnessAt;
  const citations = view.rows.slice(0, 4).map((row) => {
    const visibleCells = view.columns
      .map((column) => [column.label, row.cells[column.key]] as const)
      .filter((entry) => Boolean(entry[1]));
    return {
      id: `assistant:${view.kind}:${row.id}`,
      entityType: citationEntity[view.kind],
      entityId: row.id,
      label: visibleCells[0]?.[1] ?? `${view.sourceLabel} record`,
      excerpt: visibleCells.slice(0, 3).map(([label, value]) => `${label}: ${value}`).join("; "),
      occurredAt: sourceObservedAt,
    };
  });
  const metricSummary = view.metrics
    .slice(0, 3)
    .map((metric) => `${metric.label}: ${metric.value}`)
    .join(" · ");
  return {
    id: `live-answer:${view.kind}:${sourceObservedAt}`,
    title: view.title,
    summary: `${metricSummary}. ${view.coverageNote}${truncated ? " The source row limit was reached, so open the full report before relying on totals." : ""}`,
    confidence: truncated ? 0.7 : 0.99,
    citations,
    proposedAction: null,
    sourceMode: "tenant_records",
  };
}

function evidenceFromReport(view: ReportView, requestId: string, question: string): IntelligenceEvidence[] {
  const evidence: IntelligenceEvidence[] = [{
    sourceTable: "owner_request",
    sourceRecordId: requestId,
    label: "Your instruction",
    excerpt: question,
  }];
  if (view.freshnessAt) {
    evidence.push({
      sourceTable: "report_summary",
      sourceRecordId: `${view.kind}:${view.freshnessAt}`,
      label: view.title,
      excerpt: `${view.metrics.slice(0, 4).map((metric) => `${metric.label}: ${metric.value}`).join("; ")}. ${view.coverageNote}`,
    });
  }
  for (const row of view.rows.slice(0, 10)) {
    const visibleCells = view.columns
      .map((column) => [column.label, row.cells[column.key]] as const)
      .filter((entry) => Boolean(entry[1]));
    evidence.push({
      sourceTable: citationEntity[view.kind],
      sourceRecordId: row.id,
      label: visibleCells[0]?.[1] ?? `${view.sourceLabel} record`,
      excerpt: visibleCells.slice(0, 5).map(([label, value]) => `${label}: ${value}`).join("; "),
    });
  }
  return evidence;
}

async function resolveOwnerIntelligenceContext() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") {
    return { ok: false as const, message: "A connected tenant session is required." };
  }
  if (resolution.context.role !== "owner" || resolution.context.identity.aal !== "aal2") {
    return { ok: false as const, message: "Ask Le Yard intelligence requires your owner account with MFA verified." };
  }
  const supabase = await createClient();
  const { data: authorized, error } = await supabase.rpc("can_use_owner_intelligence", {
    p_organization_id: resolution.context.organization.id,
  });
  if (error || !authorized) {
    return { ok: false as const, message: "This owner account is not authorized for the intelligence beta." };
  }
  return { ok: true as const, context: resolution.context, supabase };
}

export async function askLiveOperationsAction(input: unknown): Promise<AskLiveOperationsResult> {
  const query = querySchema.safeParse(input);
  if (!query.success) return { ok: false, message: "Ask a question between 2 and 500 characters." };

  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") {
    return { ok: false, message: "A connected tenant session is required." };
  }
  if (resolution.context.role === "employee") {
    return {
      ok: false,
      message: "Connected operational search is currently limited to managers, admins, and owners. Your own schedule, clock, chat, and tasks remain available in their workspaces.",
    };
  }

  const supabase = await createClient();
  const { data: location, error: locationError } = await supabase
    .from("locations")
    .select("timezone")
    .eq("organization_id", resolution.context.organization.id)
    .eq("id", resolution.context.activeLocation.id)
    .single();
  if (locationError || !location) {
    return { ok: false, message: "The active location scope could not be verified." };
  }

  const endsOn = localDateKey(new Date(), location.timezone);
  const report = await loadLiveReport(
    resolution.context,
    reportKindForOperationsQuery(query.data),
    {
      locationId: resolution.context.activeLocation.id,
      startsOn: addIsoDays(endsOn, -29),
      endsOn,
    },
  );
  if (!report.ok) return { ok: false, message: report.message };
  const answer = answerFromReport(report.data.view, report.data.truncated);
  if (!answer) {
    return {
      ok: false,
      message: "No source records match that question in the active location’s last 30 days. Try another topic or open Reports for a wider date range.",
    };
  }
  return { ok: true, answer };
}

export async function askOwnerIntelligenceAction(input: unknown): Promise<AskOwnerIntelligenceResult> {
  const query = querySchema.safeParse(input);
  if (!query.success) return { ok: false, message: "Ask a question between 2 and 500 characters." };
  if (process.env.LE_YARD_OWNER_INTELLIGENCE_ENABLED?.trim() !== "true") {
    return { ok: false, message: "Owner intelligence is not enabled on this server." };
  }

  const resolution = await resolveOwnerIntelligenceContext();
  if (!resolution.ok) return resolution;
  const { context, supabase } = resolution;
  const locationResult = await supabase
    .from("locations")
    .select("timezone")
    .eq("organization_id", context.organization.id)
    .eq("id", context.activeLocation.id)
    .single();
  if (locationResult.error || !locationResult.data) {
    return { ok: false, message: "The active location scope could not be verified." };
  }

  const runId = crypto.randomUUID();
  const localDate = localDateKey(new Date(), locationResult.data.timezone);
  const report = await loadLiveReport(
    context,
    reportKindForOperationsQuery(query.data),
    { locationId: context.activeLocation.id, startsOn: addIsoDays(localDate, -29), endsOn: localDate },
  );
  if (!report.ok) return { ok: false, message: report.message };
  const evidence = evidenceFromReport(report.data.view, runId, query.data);

  const beginResult = await supabase.rpc("begin_owner_intelligence_run", {
    p_request_id: runId,
    p_location_id: context.activeLocation.id,
    p_prompt: query.data,
    p_input_parameters: {
      reportKind: report.data.view.kind,
      evidenceCount: evidence.length,
      localDate,
    },
  });
  if (beginResult.error) return { ok: false, message: "The intelligence request could not be opened safely." };

  try {
    const providerResult = await runOwnerIntelligence({
      question: query.data,
      locationName: context.activeLocation.name,
      localDate,
      evidence,
    });
    const { output } = providerResult;
    const allowedCitations = new Set(evidence.map((item) => `${item.sourceTable}\u0000${item.sourceRecordId}`));
    if (output.citations.some((citation) => !allowedCitations.has(`${citation.sourceTable}\u0000${citation.sourceRecordId}`))) {
      throw new Error("The intelligence response cited evidence outside the authorized context.");
    }
    const proposal = output.proposal ? intelligenceTaskProposalSchema.parse(output.proposal) : null;
    if (proposal?.dueAt) {
      const dueAt = new Date(proposal.dueAt).getTime();
      const now = Date.now();
      if (dueAt < now - 5 * 60_000 || dueAt > now + 90 * 86_400_000) {
        throw new Error("The proposed task due date is outside the allowed window.");
      }
    }

    const completeResult = await supabase.rpc("complete_owner_intelligence_run", {
      p_request_id: crypto.randomUUID(),
      p_ai_run_id: runId,
      p_output: output as unknown as Json,
      p_confidence: output.confidence,
      p_citations: output.citations as unknown as Json,
      p_proposal: proposal as unknown as Json,
    });
    if (completeResult.error) throw new Error("The intelligence result could not be recorded safely.");
    const completion = completionSchema.parse(completeResult.data);
    if (proposal && (!completion.proposalId || !completion.confirmationFingerprint)) {
      throw new Error("The proposed action is missing its confirmation proof.");
    }
    return {
      ok: true,
      answer: {
        ...output,
        runId,
        model: providerResult.model,
        sourceMode: providerResult.sourceMode,
        proposal: proposal && completion.proposalId && completion.confirmationFingerprint
          ? {
              id: completion.proposalId,
              confirmationFingerprint: completion.confirmationFingerprint,
              change: { ...proposal, locationId: context.activeLocation.id },
              status: "pending",
              taskId: null,
            }
          : null,
      },
    };
  } catch (error) {
    await supabase.rpc("fail_owner_intelligence_run", {
      p_request_id: crypto.randomUUID(),
      p_ai_run_id: runId,
      p_error_message: error instanceof Error ? error.message : "The intelligence provider did not complete.",
    });
    return { ok: false, message: error instanceof Error ? error.message : "Ask Le Yard could not complete that request." };
  }
}

export async function executeOwnerIntelligenceProposalAction(input: unknown): Promise<OwnerIntelligenceMutationResult> {
  const parsed = proposalDecisionSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "The reviewed proposal confirmation is invalid." };
  const resolution = await resolveOwnerIntelligenceContext();
  if (!resolution.ok) return resolution;
  const result = await resolution.supabase.rpc("execute_owner_intelligence_task_proposal", {
    p_request_id: crypto.randomUUID(),
    p_proposal_id: parsed.data.proposalId,
    p_confirmation_fingerprint: parsed.data.confirmationFingerprint,
  });
  if (result.error) return { ok: false, message: result.error.message };
  const data = taskMutationResultSchema.safeParse(result.data);
  if (!data.success) return { ok: false, message: "The task was not returned with valid execution evidence." };
  revalidatePath("/assistant");
  revalidatePath("/tasks");
  return { ok: true, proposalId: data.data.proposalId, taskId: data.data.taskId, status: data.data.status };
}

export async function undoOwnerIntelligenceProposalAction(input: unknown): Promise<OwnerIntelligenceMutationResult> {
  const parsed = proposalUndoSchema.safeParse(input);
  if (!parsed.success) return { ok: false, message: "An undo reason between 2 and 1,000 characters is required." };
  const resolution = await resolveOwnerIntelligenceContext();
  if (!resolution.ok) return resolution;
  const result = await resolution.supabase.rpc("undo_owner_intelligence_task_proposal", {
    p_request_id: crypto.randomUUID(),
    p_proposal_id: parsed.data.proposalId,
    p_reason: parsed.data.reason,
  });
  if (result.error) return { ok: false, message: result.error.message };
  const data = taskMutationResultSchema.safeParse(result.data);
  if (!data.success) return { ok: false, message: "The task undo did not return valid evidence." };
  revalidatePath("/assistant");
  revalidatePath("/tasks");
  return { ok: true, proposalId: data.data.proposalId, taskId: data.data.taskId, status: data.data.status };
}
