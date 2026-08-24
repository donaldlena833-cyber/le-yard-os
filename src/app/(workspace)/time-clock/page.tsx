import type { Metadata } from "next";
import { LiveTimeClockWorkspace } from "@/components/time-clock/live-time-clock-workspace";
import { TimeClockWorkspace } from "@/components/time-clock/time-clock-workspace";
import { loadLiveTimeClock } from "@/data/read-models/time-clock";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Time clock" };

export default async function TimeClockPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/time-clock", resolution.context);
  if (resolution.context.mode === "demo") return <TimeClockWorkspace />;
  return (
    <LiveTimeClockWorkspace
      workspace={resolution.context}
      result={await loadLiveTimeClock(resolution.context)}
    />
  );
}
