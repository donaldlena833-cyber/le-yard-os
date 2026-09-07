import type { Metadata } from "next";
import { LiveServiceControlWorkspace } from "@/components/service/live-service-control-workspace";
import { loadLiveServiceControl } from "@/data/read-models/service-control";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { hasCapability } from "@/lib/permissions/capabilities";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";
import { isFullServiceDayPreview } from "@/lib/demo";
import { fullServiceDayScenario } from "@/lib/simulation/full-service-day-v1.ts";

export const metadata: Metadata = { title: "Service control" };

export default async function ServicePage() {
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/service", resolution.context);
  const result = resolution.context.mode === "live"
    ? await loadLiveServiceControl(resolution.context)
    : { ok: true as const, data: {
        date: isFullServiceDayPreview
          ? fullServiceDayScenario.businessDate
          : new Date().toISOString().slice(0, 10),
        timeZone: "America/New_York",
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
        availabilitySubjects: [{
          id: "10000000-0000-4000-8000-000000000101",
          subjectType: "menu_item" as const,
          label: isFullServiceDayPreview ? "Oysters du Jour" : "Steak frites",
        }],
        availability: [{
          id: "demo-availability",
          subjectId: "10000000-0000-4000-8000-000000000101",
          subjectType: "menu_item",
          subjectLabel: isFullServiceDayPreview ? "Oysters du Jour" : "Steak frites",
          status: isFullServiceDayPreview ? "eighty_sixed" : "running_low",
          estimatedPortions: isFullServiceDayPreview ? 0 : 7,
          reason: isFullServiceDayPreview
            ? "Synthetic pressure test · equal-price seafood substitution approved"
            : "Synthetic demo service state",
          effectiveAt: isFullServiceDayPreview
            ? "2026-04-18T19:45:00-04:00"
            : new Date().toISOString(),
          expectedRestorationAt: null,
          notes: isFullServiceDayPreview
            ? "Source: full-service-day-v1 · fixed clock"
            : null,
        }],
        managerLog: [], preshifts: [],
      } };
  return <LiveServiceControlWorkspace workspace={resolution.context} result={result} />;
}
