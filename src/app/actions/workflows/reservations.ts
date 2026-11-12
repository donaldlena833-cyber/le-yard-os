"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  staffReservationTurnInputSchema,
  approveReservationDraftInputSchema,
  assignReservationTablesInputSchema,
  cancelReservationInputSchema,
  correctReservationStatusInputSchema,
  configureServiceShiftExceptionInputSchema,
  installReservationDraftInputSchema,
  modifyReservationInputSchema,
  moveReservationTableInputSchema,
  reservationLifecycleHeadInputSchema,
  saveReservationInputSchema,
  saveReservationFloorPositionsInputSchema,
  saveReservationWithGuestInputSchema,
  saveWaitlistEntryInputSchema,
  revokeServiceShiftExceptionInputSchema,
  retryWaitlistDeliveryInputSchema,
  seatWaitlistEntryInputSchema,
  setReservationTableStatusInputSchema,
  transitionReservationInputSchema,
  transitionWaitlistEntryInputSchema,
  undoWaitlistRemovalInputSchema,
} from "@/data/reservation-schemas";
import {
  quoteStaffReservationTurn,
  approveReservationDraft,
  assignReservationTables,
  cancelReservation,
  correctReservationStatus,
  configureServiceShiftException,
  installReservationDraft,
  loadReservationLifecycleHead,
  modifyReservation,
  moveReservationTable,
  saveReservation,
  saveReservationFloorPositions,
  saveReservationWithGuest,
  saveWaitlistEntry,
  revokeServiceShiftException,
  retryWaitlistDelivery,
  seatWaitlistEntry,
  setReservationTableStatus,
  transitionReservation,
  transitionWaitlistEntry,
  undoWaitlistRemoval,
} from "@/data/workflows/reservations";

export async function quoteStaffReservationTurnAction(input: unknown) {
  return executeWorkflowAction({
    operation: "reservation.turn_quote",
    requiredTenantFeature: "reservations",
    schema: staffReservationTurnInputSchema,
    input,
    persists: false,
    run: quoteStaffReservationTurn,
  });
}

function refreshOnSuccess(result: { ok: boolean; persisted: boolean }) {
  if (result.ok && result.persisted) {
    revalidatePath("/reservations");
    revalidatePath("/reservations/setup");
    revalidatePath("/today");
  }
}

export async function configureServiceShiftExceptionAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "service_shift.exception.configure",
    requiredTenantFeature: "reservations",
    schema: configureServiceShiftExceptionInputSchema,
    input,
    run: configureServiceShiftException,
  });
  refreshOnSuccess(result);
  return result;
}

export async function revokeServiceShiftExceptionAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "service_shift.exception.revoke",
    requiredTenantFeature: "reservations",
    schema: revokeServiceShiftExceptionInputSchema,
    input,
    run: revokeServiceShiftException,
  });
  refreshOnSuccess(result);
  return result;
}

export async function saveReservationAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.save",
    requiredTenantFeature: "reservations",
    schema: saveReservationInputSchema,
    input,
    run: saveReservation,
  });
  refreshOnSuccess(result);
  return result;
}

export async function saveReservationWithGuestAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.save_with_guest",
    requiredTenantFeature: "reservations",
    schema: saveReservationWithGuestInputSchema,
    input,
    run: saveReservationWithGuest,
  });
  refreshOnSuccess(result);
  return result;
}

export async function saveReservationFloorPositionsAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.floor_positions.save",
    requiredTenantFeature: "reservations",
    schema: saveReservationFloorPositionsInputSchema,
    input,
    run: saveReservationFloorPositions,
  });
  refreshOnSuccess(result);
  return result;
}

export async function installReservationDraftAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.install_draft",
    requiredTenantFeature: "reservations",
    schema: installReservationDraftInputSchema,
    input,
    run: installReservationDraft,
  });
  refreshOnSuccess(result);
  return result;
}

export async function approveReservationDraftAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.approve_draft",
    requiredTenantFeature: "reservations",
    schema: approveReservationDraftInputSchema,
    input,
    run: approveReservationDraft,
  });
  refreshOnSuccess(result);
  return result;
}

export async function transitionReservationAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.transition",
    requiredTenantFeature: "reservations",
    schema: transitionReservationInputSchema,
    input,
    run: transitionReservation,
  });
  refreshOnSuccess(result);
  return result;
}

export async function correctReservationStatusAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.status.correct",
    requiredTenantFeature: "reservations",
    schema: correctReservationStatusInputSchema,
    input,
    run: correctReservationStatus,
  });
  refreshOnSuccess(result);
  return result;
}

export async function modifyReservationAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.modify",
    requiredTenantFeature: "reservations",
    schema: modifyReservationInputSchema,
    input,
    run: modifyReservation,
  });
  refreshOnSuccess(result);
  return result;
}

export async function cancelReservationAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.cancel",
    requiredTenantFeature: "reservations",
    schema: cancelReservationInputSchema,
    input,
    run: cancelReservation,
  });
  refreshOnSuccess(result);
  return result;
}

export async function loadReservationLifecycleHeadAction(input: unknown) {
  return executeWorkflowAction({
    operation: "reservation.lifecycle_head",
    requiredTenantFeature: "reservations",
    schema: reservationLifecycleHeadInputSchema,
    input,
    persists: false,
    run: loadReservationLifecycleHead,
  });
}

export async function assignReservationTablesAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.assign_tables",
    requiredTenantFeature: "reservations",
    schema: assignReservationTablesInputSchema,
    input,
    run: assignReservationTables,
  });
  refreshOnSuccess(result);
  return result;
}

export async function saveWaitlistEntryAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.waitlist_save",
    requiredTenantFeature: "reservations",
    schema: saveWaitlistEntryInputSchema,
    input,
    run: saveWaitlistEntry,
  });
  refreshOnSuccess(result);
  return result;
}

export async function transitionWaitlistEntryAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.waitlist_transition",
    requiredTenantFeature: "reservations",
    schema: transitionWaitlistEntryInputSchema,
    input,
    run: transitionWaitlistEntry,
  });
  refreshOnSuccess(result);
  return result;
}

export async function seatWaitlistEntryAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.waitlist_seat",
    requiredTenantFeature: "reservations",
    schema: seatWaitlistEntryInputSchema,
    input,
    run: seatWaitlistEntry,
  });
  refreshOnSuccess(result);
  return result;
}

export async function retryWaitlistDeliveryAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.waitlist_delivery_retry",
    requiredTenantFeature: "reservations",
    schema: retryWaitlistDeliveryInputSchema,
    input,
    run: retryWaitlistDelivery,
  });
  refreshOnSuccess(result);
  return result;
}

export async function undoWaitlistRemovalAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.waitlist_removal_undo",
    requiredTenantFeature: "reservations",
    schema: undoWaitlistRemovalInputSchema,
    input,
    run: undoWaitlistRemoval,
  });
  refreshOnSuccess(result);
  return result;
}

export async function setReservationTableStatusAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.table_status",
    requiredTenantFeature: "reservations",
    schema: setReservationTableStatusInputSchema,
    input,
    run: setReservationTableStatus,
  });
  refreshOnSuccess(result);
  return result;
}

export async function moveReservationTableAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.table_move",
    requiredTenantFeature: "reservations",
    schema: moveReservationTableInputSchema,
    input,
    run: moveReservationTable,
  });
  refreshOnSuccess(result);
  return result;
}
