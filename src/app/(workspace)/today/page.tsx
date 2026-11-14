import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { listChurchSquareCateringJobsAction } from "@/app/actions/workflows/church-square-catering-jobs";
import { ChurchSquareOrderWatchPanel } from "@/components/today/church-square-order-watch";
import { ChurchSquareOrderWindow } from "@/components/today/church-square-order-window";
import { LiveTodayWorkspace } from "@/components/today/live-today-workspace";
import { TodayWorkspace } from "@/components/today/today-workspace";
import { verifyChurchSquareOrderWindowScope } from "@/data/read-models/church-square-order-window.server";
import { addIsoDays, localDateKey } from "@/data/read-models/local-time";
import { loadLiveServiceDaySnapshot } from "@/data/read-models/service-day-snapshot";
import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Today" };

async function ChurchSquareOrderSection({ workspace }: {
  workspace: WorkspaceContextValue;
}) {
  const allowed = await verifyChurchSquareOrderWindowScope(workspace).catch(() => false);
  return allowed
    ? (
      <>
        <ChurchSquareOrderWatchPanel
          key={`${workspace.identity.userId}:${workspace.organization.id}:${workspace.activeLocation.id}`}
          locationId={workspace.activeLocation.id}
        />
        <Suspense fallback={null}><ChurchCateringThisWeek /></Suspense>
        <ChurchSquareOrderWindow key={`${workspace.organization.id}:${workspace.activeLocation.id}`} />
      </>
    )
    : null;
}

async function ChurchCateringThisWeek() {
  const result = await listChurchSquareCateringJobsAction().catch(() => null);
  const today = localDateKey(new Date(), "America/New_York");
  const until = addIsoDays(today, 7);
  const jobs = result?.ok && result.mode === "live" ? result.data : null;
  const thisWeek = jobs?.filter(({ serviceDate, stage }) =>
    serviceDate >= today && serviceDate < until && (stage === "quoted" || stage === "confirmed"),
  );
  const confirmed = thisWeek?.filter(({ stage }) => stage === "confirmed").length;
  const quoted = thisWeek?.filter(({ stage }) => stage === "quoted").length;

  return (
    <section aria-labelledby="church-catering-week" className="mt-8 rounded-2xl border border-[var(--line)] bg-[var(--paper-strong)] p-4 sm:p-5">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h3 id="church-catering-week" className="text-lg font-semibold">Catering in the next 7 days</h3>
        <Link href="/catering" className="focus-ring rounded text-sm font-semibold underline underline-offset-2">Open Catering</Link>
      </div>
      {thisWeek ? (
        <p className="mt-2 text-sm text-[var(--ink-soft)]">
          {confirmed} confirmed · {quoted} quoted{jobs && jobs.length >= 100 ? " among the first 100 jobs shown in Catering." : ""}
        </p>
      ) : <p className="mt-2 text-sm text-[var(--ink-soft)]">Catering counts are unavailable. Open Catering to retry.</p>}
    </section>
  );
}

export default async function TodayPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/today", resolution.context);
  if (resolution.context.mode === "demo") return <TodayWorkspace />;
  const workspace = resolution.context;
  const snapshot = await loadLiveServiceDaySnapshot(workspace);

  return (
    <LiveTodayWorkspace
      workspace={workspace}
      snapshot={snapshot}
      additionalSection={<Suspense fallback={null}><ChurchSquareOrderSection workspace={workspace} /></Suspense>}
    />
  );
}
