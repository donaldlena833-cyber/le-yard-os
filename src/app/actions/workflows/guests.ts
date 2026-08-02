"use server";

import { revalidatePath } from "next/cache";
import { executeWorkflowAction } from "@/data/execute";
import {
  addGuestNoteInputSchema,
  mergeGuestInputSchema,
  recordGuestConsentInputSchema,
  saveGuestInputSchema,
} from "@/data/guest-schemas";
import { searchGuestsInputSchema } from "@/data/schemas";
import {
  addGuestNote,
  mergeGuest,
  recordGuestConsent,
  saveGuest,
  searchGuests,
} from "@/data/workflows/guests";

export async function searchGuestsAction(input: unknown) {
  return executeWorkflowAction({
    operation: "guest.search",
    schema: searchGuestsInputSchema,
    input,
    persists: false,
    run: searchGuests,
  });
}

export async function saveGuestAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "guest.save",
    schema: saveGuestInputSchema,
    input,
    run: saveGuest,
  });
  if (result.ok && result.persisted) revalidatePath("/guests");
  return result;
}

export async function addGuestNoteAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "guest.note_add",
    schema: addGuestNoteInputSchema,
    input,
    run: addGuestNote,
  });
  if (result.ok && result.persisted) revalidatePath("/guests");
  return result;
}

export async function recordGuestConsentAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "guest.consent_record",
    schema: recordGuestConsentInputSchema,
    input,
    run: recordGuestConsent,
  });
  if (result.ok && result.persisted) revalidatePath("/guests");
  return result;
}

export async function mergeGuestAction(input: unknown) {
  const result = await executeWorkflowAction({
    operation: "guest.merge",
    schema: mergeGuestInputSchema,
    input,
    run: mergeGuest,
  });
  if (result.ok && result.persisted) revalidatePath("/guests");
  return result;
}
