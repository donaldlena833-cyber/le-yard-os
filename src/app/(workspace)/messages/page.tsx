import type { Metadata } from "next";
import { LiveMessagesWorkspace } from "@/components/messages/live-messages-workspace";
import { MessagesWorkspace } from "@/components/messages/messages-workspace";
import { loadLiveMessages } from "@/data/read-models/messages";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  if (isDemoMode) return <MessagesWorkspace />;

  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
  const model = await loadLiveMessages(resolution.context);
  return <LiveMessagesWorkspace workspace={resolution.context} model={model} />;
}
