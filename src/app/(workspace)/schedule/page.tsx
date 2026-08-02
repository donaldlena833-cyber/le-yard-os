import type { Metadata } from "next";
import { LiveScheduleWorkspace } from "@/components/schedule/live-schedule-workspace";
import { ScheduleWorkspace } from "@/components/schedule/schedule-workspace";
import { loadLiveSchedule } from "@/data/read-models/schedule";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  if (isDemoMode) return <ScheduleWorkspace />;

  const [resolution, query] = await Promise.all([resolveWorkspaceSession(), searchParams]);
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  const model = await loadLiveSchedule(resolution.context, query.week);
  return <LiveScheduleWorkspace workspace={resolution.context} model={model} />;
}
