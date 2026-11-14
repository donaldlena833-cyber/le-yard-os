import type { Metadata } from "next";
import { LiveTasksWorkspace } from "@/components/tasks/live-tasks-workspace";
import { TasksWorkspace } from "@/components/tasks/tasks-workspace";
import { loadLiveOperations } from "@/data/read-models/operations";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Tasks & SOPs" };

export default async function TasksPage({ searchParams }: { searchParams: Promise<{ tab?: string | string[] }> }) {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/tasks", resolution.context);
  if (resolution.context.mode === "demo") return <TasksWorkspace />;
  const { tab } = await searchParams;
  const initialTab = tab === "checklists" ? "checklists" : "tasks";
  return (
    <LiveTasksWorkspace
      key={`${resolution.context.activeLocation.id}:${initialTab}`}
      workspace={resolution.context}
      result={await loadLiveOperations(resolution.context)}
      initialTab={initialTab}
    />
  );
}
