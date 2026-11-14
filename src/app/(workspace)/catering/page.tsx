import type { Metadata } from "next";
import { listChurchSquareCateringJobsAction } from "@/app/actions/workflows/church-square-catering-jobs";
import { ChurchCateringWorkspace } from "@/components/catering/church-catering-workspace";
import { verifyChurchSquareOrderWindowScope } from "@/data/read-models/church-square-order-window.server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Catering" };

export default async function CateringPage() {
  const session = await resolveWorkspaceSession();
  if (session.status !== "ready") return null;
  const workspace = session.context;
  const allowed = await verifyChurchSquareOrderWindowScope(workspace).catch(() => false);
  requireWorkspaceRouteAccess("/catering", workspace, allowed);
  const result = await listChurchSquareCateringJobsAction();
  return (
    <ChurchCateringWorkspace
      key={`${workspace.identity.userId}:${workspace.organization.id}:${workspace.activeLocation.id}`}
      initialJobs={result.ok && result.mode === "live" ? result.data : null}
      showIntake
    />
  );
}
