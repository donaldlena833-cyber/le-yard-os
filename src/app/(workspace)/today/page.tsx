import type { Metadata } from "next";
import { LiveTodayWorkspace } from "@/components/today/live-today-workspace";
import { TodayWorkspace } from "@/components/today/today-workspace";
import { loadLiveToday } from "@/data/read-models/today";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Today" };

export default async function TodayPage() {
  if (isDemoMode) return <TodayWorkspace />;

  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  const model = await loadLiveToday(resolution.context);
  return <LiveTodayWorkspace workspace={resolution.context} model={model} />;
}
