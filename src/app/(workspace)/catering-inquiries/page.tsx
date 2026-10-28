import type { Metadata } from "next";
import { CateringRegister } from "@/components/catering/catering-register";
import { loadCateringRegister } from "@/data/read-models/catering-inquiries";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";
import { parseCateringRegisterQuery } from "@/lib/catering-register";
import { demoCateringRegister } from "@/lib/catering-register-demo";

export const metadata: Metadata = { title: "Catering inquiries", robots: { index: false, follow: false } };
export const dynamic = "force-dynamic";
export default async function CateringInquiriesPage({ searchParams }: { searchParams: Promise<{ audience?: string | string[]; page?: string | string[] }> }) {
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") return null;
  requireWorkspaceRouteAccess("/catering-inquiries", session.context);
  const query = parseCateringRegisterQuery(await searchParams);
  const demo = session.context.mode === "demo";
  const result = demo ? demoCateringRegister(query) : await loadCateringRegister(session.context, query);
  return <CateringRegister result={result} query={query} demo={demo} locationName={session.context.activeLocation.name} />;
}
