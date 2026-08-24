import "server-only";

import { assertCondition, assertFound, throwDatabaseError } from "../errors";
import { requireAccessibleLocation } from "../resources";
import type { WorkflowContext } from "../execute";
import type {
  CompletePrepTaskInput,
  CorrectPrepCompletionInput,
  PreviewPrepCompletionInput,
  SavePrepTaskInput,
  TransitionPrepTaskInput,
} from "../schemas";
import type { OperationalCapability } from "@/lib/permissions/capabilities";

async function requirePrepCapability(
  context: WorkflowContext,
  locationId: string,
  capability: OperationalCapability,
) {
  const location = await requireAccessibleLocation(
    context.supabase,
    context.actor,
    locationId,
  );
  const { data, error } = await context.supabase.rpc("has_capability", {
    p_organization_id: location.organizationId,
    p_location_id: location.id,
    p_capability_key: capability,
  });
  if (error) throwDatabaseError(error, "Your prep permission could not be verified.");
  assertCondition(
    data === true,
    "forbidden",
    "This prep action is not assigned to your job role at this location.",
  );
  return location;
}

function prepResult(data: unknown) {
  const row = assertFound(data, "The prep task was not returned.");
  assertCondition(
    typeof row === "object" && row !== null && "id" in row && "version" in row,
    "database",
    "The saved prep task was invalid.",
  );
  const task = row as { id: unknown; state: unknown; version: unknown };
  return {
    id: String(task.id),
    state: String(task.state),
    version: Number(task.version),
  };
}

export async function savePrepTask(
  context: WorkflowContext,
  input: SavePrepTaskInput,
) {
  await requirePrepCapability(context, input.locationId, "prep.manage");
  const { data, error } = await context.supabase.rpc("save_prep_task", {
    p_request_id: input.requestId,
    p_task_id: input.taskId,
    p_location_id: input.locationId,
    p_business_date: input.businessDate,
    p_service_period: input.servicePeriod,
    p_station: input.station,
    p_recipe_id: input.recipeId ?? null,
    p_output_inventory_item_id: input.outputInventoryItemId ?? null,
    p_target_quantity: input.targetQuantity,
    p_target_unit_id: input.targetUnitId,
    p_due_at: input.dueAt,
    p_assignee_user_id: input.assigneeUserId ?? null,
    p_note: input.note ?? null,
    p_expected_version: input.expectedVersion ?? null,
  });
  if (error) throwDatabaseError(error, "The prep draft could not be saved.");
  return prepResult(data);
}

async function loadTaskLocation(context: WorkflowContext, taskId: string) {
  const { data, error } = await context.supabase
    .from("prep_tasks")
    .select("location_id")
    .eq("id", taskId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The prep task could not be verified.");
  return assertFound(data, "The prep task was not found.").location_id;
}

export async function transitionPrepTask(
  context: WorkflowContext,
  input: TransitionPrepTaskInput,
) {
  const locationId = await loadTaskLocation(context, input.taskId);
  await requirePrepCapability(
    context,
    locationId,
    input.command === "publish" ? "prep.manage" : "prep.complete",
  );
  const { data, error } = await context.supabase.rpc("transition_prep_task", {
    p_request_id: input.requestId,
    p_task_id: input.taskId,
    p_expected_version: input.expectedVersion,
    p_command: input.command,
  });
  if (error) throwDatabaseError(error, `The prep task could not ${input.command}.`);
  return prepResult(data);
}

export async function previewPrepCompletion(
  context: WorkflowContext,
  input: PreviewPrepCompletionInput,
) {
  const locationId = await loadTaskLocation(context, input.taskId);
  await requirePrepCapability(context, locationId, "prep.complete");
  const { data, error } = await context.supabase.rpc("preview_prep_completion", {
    p_task_id: input.taskId,
    p_actual_yield: input.actualYield,
  });
  if (error) throwDatabaseError(error, "The prep completion preview could not be built.");
  assertCondition(
    typeof data === "object" && data !== null && "movements" in data,
    "database",
    "The prep completion preview was invalid.",
  );
  return data;
}

export async function completePrepTask(
  context: WorkflowContext,
  input: CompletePrepTaskInput,
) {
  const locationId = await loadTaskLocation(context, input.taskId);
  await requirePrepCapability(context, locationId, "prep.complete");
  const { data, error } = await context.supabase.rpc("complete_prep_task", {
    p_request_id: input.requestId,
    p_task_id: input.taskId,
    p_expected_version: input.expectedVersion,
    p_actual_yield: input.actualYield,
    p_override_insufficient: input.overrideInsufficient,
    p_completion_note: input.completionNote ?? null,
  });
  if (error) throwDatabaseError(error, "The prep completion could not be posted.");
  return prepResult(data);
}

export async function correctPrepCompletion(
  context: WorkflowContext,
  input: CorrectPrepCompletionInput,
) {
  const locationId = await loadTaskLocation(context, input.taskId);
  await requirePrepCapability(context, locationId, "prep.manage");
  const { data, error } = await context.supabase.rpc("correct_prep_completion", {
    p_request_id: input.requestId,
    p_task_id: input.taskId,
    p_expected_version: input.expectedVersion,
    p_correction_note: input.correctionNote,
  });
  if (error) throwDatabaseError(error, "The prep correction could not be posted.");
  return prepResult(data);
}
