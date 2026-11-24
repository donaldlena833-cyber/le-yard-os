import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ChurchLoyaltyWorkspace } from "@/components/loyalty/church-loyalty-workspace";
import { verifyChurchLoyaltyScope } from "@/data/read-models/church-square-loyalty.server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";

export const metadata: Metadata = { title: "Loyalty" };

export default async function LoyaltyPage() {
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") return null;
  if (!await verifyChurchLoyaltyScope(session.context)) notFound();
  return <ChurchLoyaltyWorkspace key={`${session.context.identity.userId}:${session.context.organization.id}:${session.context.activeLocation.id}`} />;
}
