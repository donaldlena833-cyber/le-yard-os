import type { Metadata } from "next";

import { IncomeWorkspace } from "@/components/income/income-workspace";
import { loadLiveIncome } from "@/data/read-models/income";
import { readSuccess } from "@/data/read-models/shared";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { isDemoMode } from "@/lib/env";
import { createDemoIncomeModel } from "@/lib/income/model";
import { requireWorkspaceRouteAccess } from "@/lib/permissions/route-access.server";

export const metadata: Metadata = { title: "Income" };

function historyDays(value: string | string[] | undefined): 7 | 28 | 56 {
  const first = Array.isArray(value) ? value[0] : value;
  return first === "7" ? 7 : first === "56" ? 56 : 28;
}

export default async function IncomePage({
  searchParams,
}: {
  searchParams: Promise<{ days?: string | string[] }>;
}) {
  const days = historyDays((await searchParams).days);
  if (isDemoMode) {
    const model = createDemoIncomeModel();
    model.historyDays = days;
    return (
      <IncomeWorkspace
        result={readSuccess(model)}
        locationName="Le Yard — Playground"
        demo
      />
    );
  }

  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready" || resolution.context.mode !== "live")
    return null;
  requireWorkspaceRouteAccess("/income", resolution.context);
  return (
    <IncomeWorkspace
      result={await loadLiveIncome(resolution.context, days)}
      locationName={resolution.context.activeLocation.name}
      realtimeScope={{
        organizationId: resolution.context.organization.id,
        locationId: resolution.context.activeLocation.id,
      }}
    />
  );
}
