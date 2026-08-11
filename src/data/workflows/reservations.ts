import "server-only";

import { assertFound, throwDatabaseError, WorkflowError } from "../errors";
import type { WorkflowContext } from "../execute";
import type {
  ApproveReservationDraftInput,
  AssignReservationTablesInput,
  CancelReservationInput,
  ConfigureServiceShiftExceptionInput,
  InstallReservationDraftInput,
  ModifyReservationInput,
  ReservationLifecycleHeadInput,
  RevokeServiceShiftExceptionInput,
  SaveReservationInput,
  SaveReservationWithGuestInput,
  SaveWaitlistEntryInput,
  SeatWaitlistEntryInput,
  SetReservationTableStatusInput,
  TransitionReservationInput,
  TransitionWaitlistEntryInput,
} from "../reservation-schemas";
import {
  reservationLifecycleHeadSchema,
  reservationLifecycleRpcResultSchema,
} from "../reservation-schemas";

type ReservationLifecycleRpc = {
  (
    name: "modify_reservation",
    args: {
      p_request_id: string;
      p_location_id: string;
      p_reservation_id: string;
      p_expected_version: number;
      p_reserved_at: string;
      p_duration_minutes: number;
      p_party_size: number;
      p_special_requests: string | null;
      p_table_ids: string[];
      p_reason: string;
    },
  ): Promise<{ data: unknown | null; error: unknown | null }>;
  (
    name: "cancel_reservation",
    args: {
      p_request_id: string;
      p_location_id: string;
      p_reservation_id: string;
      p_expected_version: number;
      p_reason: string;
    },
  ): Promise<{ data: unknown | null; error: unknown | null }>;
  (
    name: "service_reservation_lifecycle_head",
    args: {
      p_location_id: string;
      p_reservation_id: string;
    },
  ): Promise<{ data: unknown | null; error: unknown | null }>;
};

function parseReservationLifecycleResult(value: unknown) {
  const parsed = reservationLifecycleRpcResultSchema.safeParse(value);
  if (!parsed.success) {
    throw new WorkflowError(
      "database",
      "The reservation changed, but its revision evidence could not be verified. Refresh before taking another action.",
    );
  }
  return parsed.data;
}

function parseReservationLifecycleHead(value: unknown) {
  const parsed = reservationLifecycleHeadSchema.safeParse(value);
  if (!parsed.success) {
    throw new WorkflowError(
      "database",
      "The latest reservation details could not be verified. Refresh before taking another action.",
    );
  }
  return parsed.data;
}

export async function configureServiceShiftException(
  { supabase }: WorkflowContext,
  input: ConfigureServiceShiftExceptionInput,
) {
  const { data, error } = await supabase.rpc(
    "configure_service_shift_exception",
    {
      p_request_id: input.requestId,
      p_organization_id: input.organizationId,
      p_location_id: input.locationId,
      p_service_shift_id: input.serviceShiftId,
      p_exception_kind: input.exceptionKind,
      p_effective_starts_at: input.effectiveStartsAt,
      p_effective_ends_at: input.effectiveEndsAt,
      p_pacing_interval_minutes: input.pacingIntervalMinutes,
      p_pacing_cover_limit: input.pacingCoverLimit,
      p_opening_buffer_minutes: input.openingBufferMinutes,
      p_closing_buffer_minutes: input.closingBufferMinutes,
      p_reason: input.reason,
      p_active: input.active,
    },
  );
  if (error)
    throwDatabaseError(error, "The service exception could not be saved.");
  return assertFound(data, "The service exception was not returned.");
}

export async function revokeServiceShiftException(
  { supabase }: WorkflowContext,
  input: RevokeServiceShiftExceptionInput,
) {
  const { data, error } = await supabase.rpc(
    "revoke_service_shift_exception",
    {
      p_request_id: input.requestId,
      p_exception_id: input.exceptionId,
      p_reason: input.reason,
    },
  );
  if (error)
    throwDatabaseError(error, "The service exception could not be revoked.");
  return assertFound(data, "The revoked service exception was not returned.");
}

export async function installReservationDraft(
  { supabase }: WorkflowContext,
  input: InstallReservationDraftInput,
) {
  const { data, error } = await supabase.rpc(
    "install_le_yard_reservation_draft",
    { p_request_id: input.requestId, p_location_id: input.locationId },
  );
  if (error)
    throwDatabaseError(
      error,
      "The Le Yard reservation draft could not be installed.",
    );
  return assertFound(data, "The installed reservation draft was not returned.");
}

export async function approveReservationDraft(
  { supabase }: WorkflowContext,
  input: ApproveReservationDraftInput,
) {
  const { data, error } = await supabase.rpc(
    "approve_le_yard_reservation_draft",
    {
      p_request_id: input.requestId,
      p_location_id: input.locationId,
      p_enable_online: input.enableOnline,
      p_enable_messaging: input.enableMessaging,
      p_enable_staff_push: input.enableStaffPush,
      p_verification_note: input.verificationNote,
    },
  );
  if (error)
    throwDatabaseError(error, "The reservation draft could not be approved.");
  return assertFound(data, "The reservation approval result was not returned.");
}

export async function saveReservation(
  { supabase }: WorkflowContext,
  input: SaveReservationInput,
) {
  const { data, error } = await supabase.rpc("save_reservation", {
    p_request_id: input.requestId,
    p_location_id: input.locationId,
    p_reservation_id: input.reservationId,
    p_guest_id: input.guestId,
    p_reserved_at: input.reservedAt,
    p_duration_minutes: input.durationMinutes,
    p_party_size: input.partySize,
    p_special_requests: input.specialRequests,
    p_source: input.source,
    p_table_ids: input.tableIds,
  });
  if (error) throwDatabaseError(error, "The reservation could not be saved.");
  return assertFound(data, "The saved reservation was not returned.");
}

export async function saveReservationWithGuest(
  { supabase }: WorkflowContext,
  input: SaveReservationWithGuestInput,
) {
  const { data, error } = await supabase.rpc("save_reservation_with_guest", {
    p_request_id: input.requestId,
    p_location_id: input.locationId,
    p_display_name: input.displayName,
    p_email: input.email,
    p_phone: input.phone,
    p_reserved_at: input.reservedAt,
    p_duration_minutes: input.durationMinutes,
    p_party_size: input.partySize,
    p_special_requests: input.specialRequests,
    p_source: input.source,
    p_table_ids: input.tableIds,
  });
  if (error) throwDatabaseError(error, "The reservation could not be saved.");
  return assertFound(data, "The saved reservation was not returned.");
}

export async function transitionReservation(
  { supabase }: WorkflowContext,
  input: TransitionReservationInput,
) {
  const { data, error } = await supabase.rpc("transition_reservation", {
    p_request_id: input.requestId,
    p_reservation_id: input.reservationId,
    p_target_status: input.targetStatus,
    p_note: input.note,
  });
  if (error)
    throwDatabaseError(error, "The reservation status could not be changed.");
  return assertFound(data, "The reservation transition was not returned.");
}

export async function modifyReservation(
  { supabase }: WorkflowContext,
  input: ModifyReservationInput,
) {
  const lifecycleRpc = supabase.rpc as unknown as ReservationLifecycleRpc;
  const { data, error } = await lifecycleRpc("modify_reservation", {
    p_request_id: input.requestId,
    p_location_id: input.locationId,
    p_reservation_id: input.reservationId,
    p_expected_version: input.expectedVersion,
    p_reserved_at: input.reservedAt,
    p_duration_minutes: input.durationMinutes,
    p_party_size: input.partySize,
    p_special_requests: input.specialRequests,
    p_table_ids: input.tableIds,
    p_reason: input.reason,
  });
  if (error)
    throwDatabaseError(error, "The reservation could not be changed.");
  return parseReservationLifecycleResult(
    assertFound(data, "The reservation revision was not returned."),
  );
}

export async function cancelReservation(
  { supabase }: WorkflowContext,
  input: CancelReservationInput,
) {
  const lifecycleRpc = supabase.rpc as unknown as ReservationLifecycleRpc;
  const { data, error } = await lifecycleRpc("cancel_reservation", {
    p_request_id: input.requestId,
    p_location_id: input.locationId,
    p_reservation_id: input.reservationId,
    p_expected_version: input.expectedVersion,
    p_reason: input.reason,
  });
  if (error)
    throwDatabaseError(error, "The reservation could not be cancelled.");
  return parseReservationLifecycleResult(
    assertFound(data, "The cancellation revision was not returned."),
  );
}

export async function loadReservationLifecycleHead(
  { supabase }: WorkflowContext,
  input: ReservationLifecycleHeadInput,
) {
  const lifecycleRpc = supabase.rpc as unknown as ReservationLifecycleRpc;
  const { data, error } = await lifecycleRpc(
    "service_reservation_lifecycle_head",
    {
      p_location_id: input.locationId,
      p_reservation_id: input.reservationId,
    },
  );
  if (error)
    throwDatabaseError(error, "The latest reservation details could not be loaded.");
  return parseReservationLifecycleHead(
    assertFound(data, "The latest reservation details were not returned."),
  );
}

export async function assignReservationTables(
  { supabase }: WorkflowContext,
  input: AssignReservationTablesInput,
) {
  const { data, error } = await supabase.rpc("assign_reservation_tables", {
    p_request_id: input.requestId,
    p_reservation_id: input.reservationId,
    p_table_ids: input.tableIds,
    p_override_note: input.overrideNote,
  });
  if (error)
    throwDatabaseError(error, "The table assignment could not be saved.");
  return assertFound(data, "The table assignment was not returned.");
}

export async function saveWaitlistEntry(
  { supabase }: WorkflowContext,
  input: SaveWaitlistEntryInput,
) {
  const { data, error } = await supabase.rpc("save_waitlist_entry_v2", {
    p_request_id: input.requestId,
    p_location_id: input.locationId,
    p_guest_id: input.guestId,
    p_display_name: input.displayName,
    p_email: input.email,
    p_phone: input.phone,
    p_party_size: input.partySize,
    p_desired_from: input.desiredFrom,
    p_desired_to: input.desiredTo,
    p_quoted_wait_minutes: input.quotedWaitMinutes,
    p_notes: input.notes,
  });
  if (error)
    throwDatabaseError(error, "The waitlist entry could not be saved.");
  return assertFound(data, "The waitlist entry was not returned.");
}

export async function transitionWaitlistEntry(
  { supabase }: WorkflowContext,
  input: TransitionWaitlistEntryInput,
) {
  const { data, error } = await supabase.rpc("transition_waitlist_entry", {
    p_request_id: input.requestId,
    p_waitlist_entry_id: input.waitlistEntryId,
    p_target_status: input.targetStatus,
    p_note: input.note,
  });
  if (error)
    throwDatabaseError(error, "The waitlist status could not be changed.");
  return assertFound(data, "The waitlist transition was not returned.");
}

export async function seatWaitlistEntry(
  { supabase }: WorkflowContext,
  input: SeatWaitlistEntryInput,
) {
  const { data, error } = await supabase.rpc("seat_waitlist_entry", {
    p_request_id: input.requestId,
    p_waitlist_entry_id: input.waitlistEntryId,
    p_table_ids: input.tableIds,
    p_duration_minutes: input.durationMinutes,
  });
  if (error)
    throwDatabaseError(error, "The waitlist party could not be seated.");
  return assertFound(data, "The seated reservation was not returned.");
}

export async function setReservationTableStatus(
  { supabase }: WorkflowContext,
  input: SetReservationTableStatusInput,
) {
  const { data, error } = await supabase.rpc("set_reservation_table_status", {
    p_request_id: input.requestId,
    p_table_id: input.tableId,
    p_status: input.status,
    p_note: input.note,
    p_reservation_id: input.reservationId,
  });
  if (error) throwDatabaseError(error, "The table status could not be saved.");
  return assertFound(data, "The table status was not returned.");
}
