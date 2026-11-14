import type { Metadata } from "next";
import { Suspense } from "react";
import { ChurchSquareOrderWindow } from "@/components/today/church-square-order-window";
import { LiveTodayWorkspace } from "@/components/today/live-today-workspace";
import { TodayWorkspace } from "@/components/today/today-workspace";
import { verifyChurchSquareOrderWindowScope } from "@/data/read-models/church-square-order-window.server";
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
    ? <ChurchSquareOrderWindow key={`${workspace.organization.id}:${workspace.activeLocation.id}`} />
    : null;
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
