import "server-only";

import { assertCondition, throwDatabaseError } from "@/data/errors";
import { requireManagedLocation } from "@/data/resources";
import type { WorkflowContext } from "@/data/execute";
import type {
  AcknowledgePreshiftInput,
  RecordServiceAvailabilityInput,
  SaveManagerLogInput,
  SavePreshiftInput,
} from "@/data/service-control-schemas";

async function scopedLocation(context: WorkflowContext, locationId: string) {
  return requireManagedLocation(context.supabase, context.actor, locationId);
}

export async function recordServiceAvailability(
  context: WorkflowContext,
  input: RecordServiceAvailabilityInput,
) {
  const location = await scopedLocation(context, input.locationId);
  const { data, error } = await context.supabase.rpc("record_canonical_service_availability_event", {
    p_request_id: input.requestId,
    p_organization_id: location.organizationId,
    p_location_id: location.id,
    p_subject_type: input.subjectType,
    p_subject_id: input.subjectId,
    p_expected_event_id: input.expectedEventId ?? null,
    p_status: input.status,
    p_estimated_portions: input.estimatedPortions ?? null,
    p_reason: input.reason ?? null,
    p_effective_at: input.effectiveAt,
    p_expected_restoration_at: input.expectedRestorationAt ?? null,
    p_notes: input.notes ?? null,
  });
  if (error) throwDatabaseError(error, "Availability could not be updated.");
  assertCondition(data, "database", "The availability event was not returned.");
  return data;
}

export async function saveManagerLog(context: WorkflowContext, input: SaveManagerLogInput) {
  const location = await scopedLocation(context, input.locationId);
  const { data, error } = await context.supabase.rpc("save_manager_log_entry", {
    p_request_id: input.requestId,
    p_entry_id: input.entryId ?? null,
    p_organization_id: location.organizationId,
    p_location_id: location.id,
    p_business_date: input.businessDate,
    p_service_period: input.servicePeriod,
    p_category: input.category,
    p_severity: input.severity,
    p_title: input.title,
    p_narrative: input.narrative,
    p_related_employee_id: null,
    p_related_guest_id: null,
    p_related_reservation_id: null,
    p_related_inventory_item_id: null,
    p_follow_up_owner_id: null,
    p_due_date: input.dueDate ?? null,
    p_status: input.status,
    p_resolution: input.resolution ?? null,
    p_attachment_path: null,
  });
  if (error) throwDatabaseError(error, "Manager log could not be saved.");
  assertCondition(data, "database", "The manager-log entry was not returned.");
  return data;
}

export async function savePreshift(context: WorkflowContext, input: SavePreshiftInput) {
  const location = await scopedLocation(context, input.locationId);
  const { data, error } = await context.supabase.rpc("save_preshift", {
    p_request_id: input.requestId,
    p_preshift_id: input.preshiftId ?? null,
    p_organization_id: location.organizationId,
    p_location_id: location.id,
    p_business_date: input.businessDate,
    p_service_period: input.servicePeriod,
    p_status: input.status,
    p_booked_covers: input.bookedCovers ?? null,
    p_projected_covers: input.projectedCovers ?? null,
    p_vip_notes: input.vipNotes ?? null,
    p_allergy_notes: input.allergyNotes ?? null,
    p_large_party_notes: input.largePartyNotes ?? null,
    p_specials: input.specials ?? null,
    p_staffing_notes: input.staffingNotes ?? null,
    p_station_assignments: [],
    p_previous_handoff: null,
    p_service_goal: input.serviceGoal ?? null,
    p_training_point: input.trainingPoint ?? null,
    p_manager_notes: input.managerNotes ?? null,
  });
  if (error) throwDatabaseError(error, "Pre-shift could not be saved.");
  assertCondition(data, "database", "The pre-shift was not returned.");
  return data;
}

export async function acknowledgePreshift(
  context: WorkflowContext,
  input: AcknowledgePreshiftInput,
) {
  const { data, error } = await context.supabase.rpc("acknowledge_preshift", {
    p_request_id: input.requestId,
    p_preshift_id: input.preshiftId,
    p_comment: input.comment ?? null,
  });
  if (error) throwDatabaseError(error, "Pre-shift acknowledgement could not be saved.");
  assertCondition(data, "database", "The acknowledgement was not returned.");
  return data;
}
