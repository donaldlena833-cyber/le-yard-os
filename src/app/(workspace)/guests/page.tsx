import type { Metadata } from "next";
import { LiveGuestsWorkspace } from "@/components/guests/live-guests-workspace";
import { GuestsWorkspace } from "@/components/guests/guests-workspace";
import { loadLiveGuests } from "@/data/read-models/guests";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Guests" };

export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/guests", resolution.context);
  if (isDemoMode || resolution.context.mode === "demo") return <GuestsWorkspace />;
  const params = await searchParams;
  const search = (Array.isArray(params.q) ? params.q[0] : params.q ?? "")
    .trim()
    .slice(0, 120);
  return (
    <LiveGuestsWorkspace
      key={`${resolution.context.activeLocation.id}:${search}`}
      workspace={resolution.context}
      result={await loadLiveGuests(resolution.context, search)}
      initialSearch={search}
    />
  );
}
