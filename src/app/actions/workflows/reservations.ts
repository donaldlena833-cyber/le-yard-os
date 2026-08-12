"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  approveReservationDraftInputSchema,
  assignReservationTablesInputSchema,
  cancelReservationInputSchema,
  configureServiceShiftExceptionInputSchema,
  installReservationDraftInputSchema,
  modifyReservationInputSchema,
  moveReservationTableInputSchema,
  reservationLifecycleHeadInputSchema,
  saveReservationInputSchema,
  saveReservationWithGuestInputSchema,
  saveWaitlistEntryInputSchema,
  revokeServiceShiftExceptionInputSchema,
  seatWaitlistEntryInputSchema,
  setReservationTableStatusInputSchema,
  transitionReservationInputSchema,
  transitionWaitlistEntryInputSchema,
} from "@/data/reservation-schemas";
import {
  approveReservationDraft,
  assignReservationTables,
  cancelReservation,
  configureServiceShiftException,
  installReservationDraft,
  loadReservationLifecycleHead,
  modifyReservation,
  moveReservationTable,
  saveReservation,
  saveReservationWithGuest,
  saveWaitlistEntry,
  revokeServiceShiftException,
  seatWaitlistEntry,
  setReservationTableStatus,
  transitionReservation,
  transitionWaitlistEntry,
} from "@/data/workflows/reservations";

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
    schema: saveReservationWithGuestInputSchema,
    input,
    run: saveReservationWithGuest,
  });
  refreshOnSuccess(result);
  return result;
}

export async function installReservationDraftAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.install_draft",
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
    schema: transitionReservationInputSchema,
    input,
    run: transitionReservation,
  });
  refreshOnSuccess(result);
  return result;
}

export async function modifyReservationAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.modify",
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
    schema: reservationLifecycleHeadInputSchema,
    input,
    persists: false,
    run: loadReservationLifecycleHead,
  });
}

export async function assignReservationTablesAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.assign_tables",
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
    schema: seatWaitlistEntryInputSchema,
    input,
    run: seatWaitlistEntry,
  });
  refreshOnSuccess(result);
  return result;
}

export async function setReservationTableStatusAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "reservation.table_status",
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
    schema: moveReservationTableInputSchema,
    input,
    run: moveReservationTable,
  });
  refreshOnSuccess(result);
  return result;
}
