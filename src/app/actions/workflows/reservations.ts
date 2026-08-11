"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  approveReservationDraftInputSchema,
  assignReservationTablesInputSchema,
  configureServiceShiftExceptionInputSchema,
  installReservationDraftInputSchema,
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
  configureServiceShiftException,
  installReservationDraft,
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
