import type { Metadata } from "next";

import { LiveReportsWorkspace } from "@/components/reports/live-reports-workspace";
import { ReportsWorkspace } from "@/components/reports/reports-workspace";
import { isLiveReportKind, loadLiveReport } from "@/data/read-models/reports";
import { addIsoDays, isIsoCalendarDate } from "@/data/read-models/shared";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";
import {
  accessibleReportKinds,
  canAccessReportKind,
} from "@/lib/permissions/report-access";

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
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/reports", resolution.context);
  if (isDemoMode || resolution.context.mode === "demo") return <ReportsWorkspace />;
  const params = await searchParams;
  const requestedKind = first(params.type);
  const authorizedKinds = accessibleReportKinds(resolution.context);
  const kind =
    isLiveReportKind(requestedKind) &&
    canAccessReportKind(resolution.context, requestedKind)
      ? requestedKind
      : authorizedKinds[0];
  if (!kind) return null;
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
