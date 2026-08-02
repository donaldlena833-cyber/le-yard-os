import type { Metadata } from "next";
import { LiveTimeClockWorkspace } from "@/components/time-clock/live-time-clock-workspace";
import { TimeClockWorkspace } from "@/components/time-clock/time-clock-workspace";
import { loadLiveTimeClock } from "@/data/read-models/time-clock";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Time clock" };

export default async function TimeClockPage() {
  if (isDemoMode) return <TimeClockWorkspace />;
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  return (
    <LiveTimeClockWorkspace
      workspace={resolution.context}
      result={await loadLiveTimeClock(resolution.context)}
    />
  );
}
