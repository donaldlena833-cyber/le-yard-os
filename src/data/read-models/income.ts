import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import {
  parseIncomeOperatingModel,
  type IncomeOperatingModel,
} from "@/lib/income/model";
import { createClient } from "@/lib/supabase/server";
import { readFailure, readSuccess, type LiveReadResult } from "./shared";

export async function loadLiveIncome(
  workspace: WorkspaceContextValue,
  historyDays = 28,
): Promise<LiveReadResult<IncomeOperatingModel>> {
  const boundedHistoryDays =
    historyDays === 7 || historyDays === 56 ? historyDays : 28;
  try {
    const supabase = await createClient();
    const { data, error } = await supabase.rpc("income_operating_snapshot", {
      p_organization_id: workspace.organization.id,
      p_location_id: workspace.activeLocation.id,
      p_observed_at: new Date().toISOString(),
      p_history_days: boundedHistoryDays,
    });
    if (error) throw error;
    const model = parseIncomeOperatingModel(data);
    return model
      ? readSuccess(model)
      : readFailure(
          "Income data returned an unexpected shape. No financial values were shown.",
        );
  } catch {
    return readFailure(
      "Income data is unavailable. No financial values were estimated or substituted.",
    );
  }
}
