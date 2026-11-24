import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { MusicWorkspace } from "@/components/music/music-workspace";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { verifyChurchMusicScope } from "@/data/read-models/church-music.server";

export const metadata: Metadata = { title: "Music" };
export default async function MusicPage({ searchParams }: { searchParams: Promise<{ connection?: string }> }) {
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") return null;
  if (!await verifyChurchMusicScope(session.context)) notFound();
  const query = await searchParams;
  const notice = query.connection === "linked" ? "Spotify connected to Operations."
    : query.connection === "declined" ? "Spotify connection was cancelled."
      : query.connection === "failed" ? "Spotify connection could not be completed. Please try again." : undefined;
  return <MusicWorkspace key={`${session.context.identity.userId}:${session.context.organization.id}:${session.context.activeLocation.id}`} notice={notice} />;
}
