import type { Metadata } from "next";
import { LiveMessagesWorkspace } from "@/components/messages/live-messages-workspace";
import { MessagesWorkspace } from "@/components/messages/messages-workspace";
import { loadLiveMessages } from "@/data/read-models/messages";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Messages" };

export default async function MessagesPage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/messages", resolution.context);
  if (resolution.context.mode === "demo") return <MessagesWorkspace />;
  const model = await loadLiveMessages(resolution.context);
  return <LiveMessagesWorkspace workspace={resolution.context} model={model} />;
}
