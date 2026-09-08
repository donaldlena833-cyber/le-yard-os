import { MessagesHub } from "@/components/messages/messages-hub";
import type { CommunicationGroup } from "@/lib/communication-groups";
import type { Metadata } from "next";
import { LiveMessagesWorkspace } from "@/components/messages/live-messages-workspace";
import { MessagesWorkspace } from "@/components/messages/messages-workspace";
import { loadLiveMessages } from "@/data/read-models/messages";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Groups" };

export default async function MessagesPage({searchParams}:{searchParams:Promise<{group?:string;phone?:string}>}) {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/messages", resolution.context);
  if (resolution.context.mode === "demo") return <MessagesWorkspace />;
  const model = await loadLiveMessages(resolution.context);
  const channels = <LiveMessagesWorkspace workspace={resolution.context} model={model} />;
  if (!["owner","admin"].includes(resolution.context.role)) return <><p className="mx-6 mt-5 text-sm">Work requests and pictures: <a className="underline" href="sms:+13328779035">text Le Yard at (332) 877-9035</a>. Use the number recorded on your employee profile.</p>{channels}</>;
  const params = await searchParams;
  const requested = params.group;
  const initialPhone = /^\+[1-9]\d{7,14}$/.test(params.phone??'') ? params.phone : undefined;
  const initialGroup = ['clients','team','tickets','channels'].includes(requested??'') ? requested as CommunicationGroup | 'channels' : 'clients';
  return <MessagesHub initialGroup={initialGroup} initialPhone={initialPhone}>{channels}</MessagesHub>;
}
