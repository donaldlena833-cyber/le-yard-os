"use server";

import { z } from "zod";
import type { ReportView } from "@/components/reports/report-data";
import { loadLiveReport } from "@/data/read-models/reports";
import { addIsoDays, localDateKey } from "@/data/read-models/shared";
import type { OperationsAnswer } from "@/lib/ai/guardrails";
import { reportKindForOperationsQuery } from "@/lib/ai/query-routing";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { createClient } from "@/lib/supabase/server";
import type { ReportKind } from "@/types";

const querySchema = z.string().trim().min(2).max(500);

export type AskLiveOperationsResult =
  | { ok: true; answer: OperationsAnswer }
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
  if (!view.rows.length) return null;
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
      occurredAt: view.freshnessAt,
    };
  });
  const metricSummary = view.metrics
    .slice(0, 3)
    .map((metric) => `${metric.label}: ${metric.value}`)
    .join(" · ");
  return {
    id: `live-answer:${view.kind}:${view.freshnessAt}`,
    title: view.title,
    summary: `${metricSummary}. ${view.coverageNote}${truncated ? " The source row limit was reached, so open the full report before relying on totals." : ""}`,
    confidence: truncated ? 0.7 : 0.99,
    citations,
    proposedAction: null,
    sourceMode: "tenant_records",
  };
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
