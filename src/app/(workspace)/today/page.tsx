import type { Metadata } from "next";
import { LiveTodayWorkspace } from "@/components/today/live-today-workspace";
import { TodayWorkspace } from "@/components/today/today-workspace";
import { loadLiveServiceDaySnapshot } from "@/data/read-models/service-day-snapshot";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  if (isDemoMode) return <TodayWorkspace />;

  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  const snapshot = await loadLiveServiceDaySnapshot(resolution.context);

  return (
    <LiveTodayWorkspace
      workspace={resolution.context}
      snapshot={snapshot}
    />
  );
}
