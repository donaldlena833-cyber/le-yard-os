import type { Metadata } from "next";
import { LiveGuestsWorkspace } from "@/components/guests/live-guests-workspace";
import { GuestsWorkspace } from "@/components/guests/guests-workspace";
import { loadLiveGuests } from "@/data/read-models/guests";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";

export const metadata: Metadata = { title: "Guests" };

export default async function GuestsPage({
  searchParams,
}: {
  searchParams: Promise<{ q?: string | string[] }>;
}) {
  if (isDemoMode) return <GuestsWorkspace />;
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live") return null;
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
