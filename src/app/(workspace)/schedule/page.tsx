import type { Metadata } from "next";
import { LiveScheduleWorkspace } from "@/components/schedule/live-schedule-workspace";
import { ScheduleWorkspace } from "@/components/schedule/schedule-workspace";
import { loadLiveSchedule } from "@/data/read-models/schedule";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Schedule" };

export default async function SchedulePage({
  searchParams,
}: {
  searchParams: Promise<{ week?: string }>;
}) {
  const [resolution, query] = await Promise.all([resolveWorkspaceSession(), searchParams]);
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/schedule", resolution.context);
  if (resolution.context.mode === "demo") return <ScheduleWorkspace />;
  const model = await loadLiveSchedule(resolution.context, query.week);
  return <LiveScheduleWorkspace workspace={resolution.context} model={model} />;
}
