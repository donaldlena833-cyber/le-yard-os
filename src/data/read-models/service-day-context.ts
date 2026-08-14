import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/server";
import { readFailure, readSuccess, type LiveReadResult } from "./shared";

export interface LiveServiceDayContext {
  businessDate: string;
  calendarDate: string;
  timeZone: string;
  source:
    | "materialized_service_shift"
    | "reservation_service_period"
    | "published_shift"
    | "calendar";
  servicePeriodId: string | null;
  serviceName: string | null;
  startsAt: string | null;
  endsAt: string | null;
  pacingIntervalMinutes: number | null;
  pacingCoverLimit: number | null;
  configurationState:
    | "approved"
    | "internal"
    | "closed"
    | "schedule_only"
    | "unconfigured";
}

export async function loadLiveServiceDayContext(
  workspace: WorkspaceContextValue,
  observedAt = new Date().toISOString(),
): Promise<LiveReadResult<LiveServiceDayContext>> {
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("service_day_business_date", {
      p_organization_id: workspace.organization.id,
      p_location_id: workspace.activeLocation.id,
      p_observed_at: observedAt,
    });
    const row = data?.[0];
    if (error || !row) {
      return readFailure("The operating business date could not be resolved.");
    }
    return readSuccess(row as LiveServiceDayContext);
  } catch {
    return readFailure("The operating business date could not be resolved.");
  }
}
