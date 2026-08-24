import type { Metadata } from "next";
import { LiveTeamWorkspace } from "@/components/team/live-team-workspace";
import { TeamWorkspace } from "@/components/team/team-workspace";
import { loadLiveTeam } from "@/data/read-models/team";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/team", resolution.context);
  if (resolution.context.mode === "demo") return <TeamWorkspace />;
  const model = await loadLiveTeam(resolution.context);
  return <LiveTeamWorkspace workspace={resolution.context} model={model} />;
}
