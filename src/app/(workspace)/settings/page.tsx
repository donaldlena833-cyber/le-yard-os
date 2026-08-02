import type { Metadata } from "next";
import { LiveSettingsWorkspace } from "@/components/settings/live-settings-workspace";
import { SettingsWorkspace } from "@/components/settings/settings-workspace";
import { loadLiveSettings } from "@/data/read-models/settings";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Settings" };

export default async function SettingsPage() {
  if (isDemoMode) return <SettingsWorkspace />;
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  return (
    <LiveSettingsWorkspace
      workspace={resolution.context}
      result={await loadLiveSettings(resolution.context)}
    />
  );
}
