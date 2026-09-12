import { MessagesHub } from "@/components/messages/messages-hub";
import type { CommunicationGroup } from "@/lib/communication-groups";
import type { Metadata } from "next";
import { LiveMessagesWorkspace } from "@/components/messages/live-messages-workspace";
import { MessagesWorkspace } from "@/components/messages/messages-workspace";
import { loadLiveMessages } from "@/data/read-models/messages";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";
import { resolveCommunicationMessageLink } from "@/lib/communication-message-link.server";
import { redirect } from "next/navigation";

export const metadata: Metadata = { title: "Groups" };

export default async function MessagesPage({
  searchParams,
}: {
  searchParams: Promise<{
    group?: string | string[];
    phone?: string | string[];
    message?: string | string[];
  }>;
}) {
  const params = await searchParams;
  const resolution = await resolveWorkspaceSession();
  if (resolution.status === "unauthenticated") {
    const query = new URLSearchParams();
    for (const key of ["group", "phone", "message"] as const) {
      const value = params[key];
      for (const item of Array.isArray(value) ? value : value == null ? [] : [value]) {
        query.append(key, item);
      }
    }
    const destination = `/messages${query.size ? `?${query}` : ""}`;
    redirect(`/sign-in?${new URLSearchParams({ next: destination })}`);
  }
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/messages", resolution.context);
  const hasMessageLink = params.message !== undefined;
  if (resolution.context.mode === "demo") {
    return hasMessageLink ? (
      <p role="alert" className="mx-6 mt-5 text-sm">
        Conversation alerts open in the live Le Yard workspace. This is the demo workspace.{" "}
        <a className="underline" href="/messages">Open demo messages</a>.
      </p>
    ) : <MessagesWorkspace />;
  }
  const model = await loadLiveMessages(resolution.context);
  const channels = <LiveMessagesWorkspace workspace={resolution.context} model={model} />;
  if (!["owner", "admin"].includes(resolution.context.role)) {
    return <>
      {hasMessageLink ? <p role="alert" className="mx-6 mt-5 text-sm">This conversation link requires a Le Yard owner or admin account.</p> : null}
      <p className="mx-6 mt-5 text-sm">Work requests and pictures: <a className="underline" href="sms:+13328779035">text Le Yard at (332) 877-9035</a>. Use the number recorded on your employee profile.</p>
      {channels}
    </>;
  }
  const requested = params.group;
  let initialPhone = typeof params.phone === "string" && /^\+[1-9]\d{7,14}$/.test(params.phone) ? params.phone : undefined;
  let initialGroup: CommunicationGroup | "channels" = typeof requested === "string" && ["clients", "team", "tickets", "channels"].includes(requested) ? requested as CommunicationGroup | "channels" : "clients";
  let messageLinkError: string | undefined;
  if (hasMessageLink) {
    const target = await resolveCommunicationMessageLink(resolution.context, params.message);
    // A source link takes precedence over legacy phone/group filters, including
    // when resolution fails. Never fall back to a different guest's conversation.
    initialPhone = target.status === "ready" ? target.phone : undefined;
    initialGroup = target.status === "ready" ? target.group : "clients";
    messageLinkError = target.status === "unavailable" ? target.message : undefined;
  }
  return (
    <MessagesHub
      key={JSON.stringify([resolution.context.organization.id, resolution.context.activeLocation.id, params.message ?? null, initialGroup, initialPhone ?? null])}
      initialGroup={initialGroup}
      initialPhone={initialPhone}
      messageLinkError={messageLinkError}
    >
      {channels}
    </MessagesHub>
  );
}
