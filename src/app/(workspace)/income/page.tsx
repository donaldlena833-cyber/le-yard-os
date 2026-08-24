import type { Metadata } from "next";

import {
  IncomeWorkspace,
  type IncomeActionAccess,
} from "@/components/income/income-workspace";
import { loadLiveIncome } from "@/data/read-models/income";
import { readSuccess } from "@/data/read-models/shared";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
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
  const resolution = await resolveWorkspaceSession();
  if (resolution.status !== "ready") return null;
  requireWorkspaceRouteAccess("/income", resolution.context);
  if (resolution.context.mode === "demo") {
    const model = createDemoIncomeModel();
    model.historyDays = days;
    return (
      <IncomeWorkspace
        result={readSuccess(model)}
        locationName="Le Yard — Playground"
        actionAccess={{
          canManageSchedule: true,
          canViewSchedule: true,
          canOpenTimeClock: true,
          canManageIntegrations: true,
        }}
        demo
      />
    );
  }

  const privileged =
    resolution.context.role === "owner" || resolution.context.role === "admin";
  const capabilities = new Set(resolution.context.capabilities);
  const actionAccess: IncomeActionAccess = {
    canManageSchedule: privileged || capabilities.has("schedule.manage"),
    canViewSchedule: true,
    canOpenTimeClock: true,
    canManageIntegrations:
      privileged || capabilities.has("integrations.manage"),
  };
  return (
    <IncomeWorkspace
      result={await loadLiveIncome(resolution.context, days)}
      locationName={resolution.context.activeLocation.name}
      actionAccess={actionAccess}
      realtimeScope={{
        organizationId: resolution.context.organization.id,
        locationId: resolution.context.activeLocation.id,
      }}
    />
  );
}
