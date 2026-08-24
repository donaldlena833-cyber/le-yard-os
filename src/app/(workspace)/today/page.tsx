import type { Metadata } from "next";
import { LiveTodayWorkspace } from "@/components/today/live-today-workspace";
import { TodayWorkspace } from "@/components/today/today-workspace";
import { loadLiveServiceDaySnapshot } from "@/data/read-models/service-day-snapshot";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/today", resolution.context);
  if (resolution.context.mode === "demo") return <TodayWorkspace />;
  const snapshot = await loadLiveServiceDaySnapshot(resolution.context);

  return (
    <LiveTodayWorkspace
      workspace={resolution.context}
      snapshot={snapshot}
    />
  );
}
