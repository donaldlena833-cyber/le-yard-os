import type { Metadata } from "next";
import { LiveTeamWorkspace } from "@/components/team/live-team-workspace";
import { TeamWorkspace } from "@/components/team/team-workspace";
import { loadLiveTeam } from "@/data/read-models/team";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Team" };

export default async function TeamPage() {
  if (isDemoMode) return <TeamWorkspace />;

  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  const model = await loadLiveTeam(resolution.context);
  return <LiveTeamWorkspace workspace={resolution.context} model={model} />;
}
