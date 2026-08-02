import type { Metadata } from "next";
import { LiveTasksWorkspace } from "@/components/tasks/live-tasks-workspace";
import { TasksWorkspace } from "@/components/tasks/tasks-workspace";
import { loadLiveOperations } from "@/data/read-models/operations";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Tasks & SOPs" };

export default async function TasksPage() {
  if (isDemoMode) return <TasksWorkspace />;

  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  return (
    <LiveTasksWorkspace
      key={resolution.context.activeLocation.id}
      workspace={resolution.context}
      result={await loadLiveOperations(resolution.context)}
    />
  );
}
