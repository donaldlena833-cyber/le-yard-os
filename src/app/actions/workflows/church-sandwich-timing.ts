"use server";

import { revalidatePath } from "next/cache";
import { assertCondition, throwDatabaseError } from "@/data/errors";
import { executeWorkflowAction } from "@/data/execute";
import { canRecordChurchSandwichTiming } from "@/data/read-models/church-sandwich-timing.server";
import { resolveWorkspaceSession } from "@/lib/auth/workspace-session";
import { churchSandwichTimingRun, recordChurchSandwichTimingRunInput } from "@/lib/kitchen/church-sandwich-timing";

export async function recordChurchSandwichTimingRunAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "church.kitchen.sandwich-timing.record",
    schema: recordChurchSandwichTimingRunInput,
    input,
    run: async (context, run) => {
      const session = await resolveWorkspaceSession();
      assertCondition(session.status === "ready" &&
        session.context.identity.userId === context.actor.userId &&
        canRecordChurchSandwichTiming(session.context),
      "forbidden", "Church Street recipe or prep management access is required.");
      const { data, error } = await context.supabase.rpc("record_church_sandwich_timing_run", {
        p_location_id: session.context.activeLocation.id,
        p_request_id: run.requestId,
        p_recipe_key: run.recipeKey,
        p_attempted: run.attempted,
        p_accepted: run.accepted,
        p_crew_size: run.crewSize,
        p_build_seconds: run.buildSeconds,
        p_reference: run.reference,
        ...(run.formulaRevision !== null ? { p_formula_revision: run.formulaRevision } : {}),
        ...(run.prepSeconds !== null ? { p_prep_seconds: run.prepSeconds } : {}),
        ...(run.packSeconds !== null ? { p_pack_seconds: run.packSeconds } : {}),
        ...(run.note !== null ? { p_note: run.note } : {}),
      }).abortSignal(AbortSignal.timeout(6_000));
      if (error) throwDatabaseError(error, "The Church Street timing run could not be recorded.");
      const recorded = churchSandwichTimingRun.safeParse(data);
      assertCondition(recorded.success, "database", "The recorded timing run could not be confirmed.");
      return recorded.data;
    },
  });
  if (result.ok && result.persisted) revalidatePath("/kitchen");
  return result;
}
