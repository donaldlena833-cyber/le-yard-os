import type { Metadata } from "next";

import { LiveReportsWorkspace } from "@/components/reports/live-reports-workspace";
import { ReportsWorkspace } from "@/components/reports/reports-workspace";
import { isLiveReportKind, loadLiveReport } from "@/data/read-models/reports";
import { addIsoDays, isIsoCalendarDate } from "@/data/read-models/shared";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Reports" };

function first(value: string | string[] | undefined): string {
  return (Array.isArray(value) ? value[0] : value ?? "").trim();
}

export default async function ReportsPage({
  searchParams,
}: {
  searchParams: Promise<{
    type?: string | string[];
    location?: string | string[];
    from?: string | string[];
    to?: string | string[];
  }>;
}) {
  if (isDemoMode) return <ReportsWorkspace />;
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  const params = await searchParams;
  const requestedKind = first(params.type);
  const kind = isLiveReportKind(requestedKind) ? requestedKind : "labor";
  const defaultEnd = new Date().toISOString().slice(0, 10);
  const requestedStart = first(params.from);
  const requestedEnd = first(params.to);
  const startsOn = isIsoCalendarDate(requestedStart) ? requestedStart : addIsoDays(defaultEnd, -29);
  const endsOn = isIsoCalendarDate(requestedEnd) ? requestedEnd : defaultEnd;
  const locationId = first(params.location) || resolution.context.activeLocation.id;
  const filters = { locationId, startsOn, endsOn };
  return (
    <LiveReportsWorkspace
      key={`${kind}:${locationId}:${startsOn}:${endsOn}`}
      workspace={resolution.context}
      result={await loadLiveReport(resolution.context, kind, filters)}
    />
  );
}
