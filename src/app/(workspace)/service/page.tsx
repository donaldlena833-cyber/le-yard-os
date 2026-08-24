import type { Metadata } from "next";
import { LiveServiceControlWorkspace } from "@/components/service/live-service-control-workspace";
import { loadLiveServiceControl } from "@/data/read-models/service-control";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { hasCapability } from "@/lib/permissions/capabilities";

export const metadata: Metadata = { title: "Service control" };

export default async function ServicePage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  const result = resolution.context.mode === "live"
    ? await loadLiveServiceControl(resolution.context)
    : { ok: true as const, data: {
        date: new Date().toISOString().slice(0, 10), timeZone: "America/New_York",
        canManageAvailability: hasCapability(
          resolution.context.capabilities,
          "service.availability.manage",
        ),
        canManageLog: hasCapability(
          resolution.context.capabilities,
          "manager_log.manage",
        ),
        canManagePreshift: hasCapability(
          resolution.context.capabilities,
          "preshift.manage",
        ),
        availabilitySubjects: [{ id: "10000000-0000-4000-8000-000000000101", subjectType: "menu_item" as const, label: "Steak frites" }],
        availability: [{ id: "demo-availability", subjectId: "10000000-0000-4000-8000-000000000101", subjectType: "menu_item", subjectLabel: "Steak frites", status: "running_low", estimatedPortions: 7, reason: "Synthetic demo service state", effectiveAt: new Date().toISOString(), expectedRestorationAt: null, notes: null }],
        managerLog: [], preshifts: [],
      } };
  return <LiveServiceControlWorkspace workspace={resolution.context} result={result} />;
}
