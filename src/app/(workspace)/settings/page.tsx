import type { Metadata } from "next";
import { LiveSettingsWorkspace } from "@/components/settings/live-settings-workspace";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";
import { loadLiveSettings } from "@/data/read-models/settings";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/settings", resolution.context);
  if (isDemoMode || resolution.context.mode === "demo") return <SettingsWorkspace />;
  return (
    <LiveSettingsWorkspace
      workspace={resolution.context}
      result={await loadLiveSettings(resolution.context)}
    />
  );
}
