import "server-only";

import {
  assertCondition,
  assertFound,
  throwDatabaseError,
  WorkflowError,
} from "../errors";
import type {
  AddGuestNoteInput,
  MergeGuestInput,
  RecordGuestConsentInput,
  SaveGuestInput,
} from "../guest-schemas";
import { requireManagementRead, requireOrganizationOperations } from "../policy";
import { requireManagedLocation } from "../resources";
import type { WorkflowContext } from "../execute";
import type { SearchGuestsInput } from "../schemas";

interface GuestSearchRow {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  vip: boolean;
  preferences: string | null;
  allergies: string | null;
  last_visit_at: string | null;
  visit_count: number;
  lifetime_spend_cents: number;
}

export async function searchGuests(
  { supabase, actor }: WorkflowContext,
  input: SearchGuestsInput,
) {
  requireManagementRead(actor, input.organizationId);

  const { data, error } = await supabase.rpc("search_guests", {
    p_organization_id: input.organizationId,
    p_query: input.query,
    p_limit: input.limit,
  });
  if (error) throwDatabaseError(error, "Guests could not be searched.");

  return ((data ?? []) as GuestSearchRow[]).map((guest) => ({
    id: guest.id as string,
    displayName: guest.display_name as string,
    email: guest.email as string | null,
    phone: guest.phone as string | null,
    vip: guest.vip as boolean,
    preferences: guest.preferences as string | null,
    allergies: guest.allergies as string | null,
    lastVisitAt: guest.last_visit_at as string | null,
    visitCount: guest.visit_count as number,
    lifetimeSpendCents: guest.lifetime_spend_cents as number,
  }));
}

function nullable(value: string | null | undefined): string | null {
  const normalized = value?.trim();
  return normalized ? normalized : null;
}

async function requireGuest(
  context: WorkflowContext,
  organizationId: string,
  guestId: string,
) {
  requireOrganizationOperations(context.actor, organizationId);
  const { data, error } = await context.supabase
    .from("guests")
    .select("id, organization_id, merged_into_id")
    .eq("organization_id", organizationId)
    .eq("id", guestId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The guest could not be verified.");
  const guest = assertFound(data, "The guest was not found.");
  assertCondition(!guest.merged_into_id, "conflict", "This profile has already been merged.");
  return guest;
}

function guestValues(input: SaveGuestInput) {
  return {
    first_name: nullable(input.firstName),
    last_name: nullable(input.lastName),
    display_name: input.displayName.trim(),
    email: nullable(input.email)?.toLowerCase() ?? null,
    phone: nullable(input.phone),
    birthday: input.birthday ?? null,
    vip: input.vip,
    preferences: nullable(input.preferences),
    allergies: nullable(input.allergies),
    notes: nullable(input.notes),
  };
}

export async function saveGuest(
  context: WorkflowContext,
  input: SaveGuestInput,
) {
  requireOrganizationOperations(context.actor, input.organizationId);
  const values = guestValues(input);

  if (values.email) {
    const { data: duplicate, error: duplicateError } = await context.supabase
      .from("guests")
      .select("id")
      .eq("organization_id", input.organizationId)
      .is("merged_into_id", null)
      .ilike("email", values.email)
      .neq("id", input.guestId ?? input.requestId)
      .limit(1)
      .maybeSingle();
    if (duplicateError) {
      throwDatabaseError(duplicateError, "The guest contact could not be checked.");
    }
    if (duplicate) {
      throw new WorkflowError(
        "conflict",
        "Another active guest already uses this email. Review the existing profile instead.",
      );
    }
  }

  if (input.guestId) {
    await requireGuest(context, input.organizationId, input.guestId);
    const { data, error } = await context.supabase.rpc("save_guest", {
      p_request_id: input.requestId,
      p_organization_id: input.organizationId,
      p_guest_id: input.guestId,
      p_first_name: values.first_name,
      p_last_name: values.last_name,
      p_display_name: values.display_name,
      p_email: values.email,
      p_phone: values.phone,
      p_birthday: values.birthday,
      p_vip: values.vip,
      p_preferences: values.preferences,
      p_allergies: values.allergies,
      p_notes: values.notes,
    });
    if (error) throwDatabaseError(error, "The guest profile could not be updated.");
    const guest = assertFound(data, "The updated guest profile was not returned.");
    return {
      id: guest.id,
      displayName: guest.display_name,
      updatedAt: guest.updated_at,
      created: false,
    };
  }

  const { data: existing, error: existingError } = await context.supabase
    .from("guests")
    .select("id, organization_id, display_name, email")
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError, "The guest request could not be checked.");
  const { data, error } = await context.supabase.rpc("save_guest", {
    p_request_id: input.requestId,
    p_organization_id: input.organizationId,
    p_guest_id: null,
    p_first_name: values.first_name,
    p_last_name: values.last_name,
    p_display_name: values.display_name,
    p_email: values.email,
    p_phone: values.phone,
    p_birthday: values.birthday,
    p_vip: values.vip,
    p_preferences: values.preferences,
    p_allergies: values.allergies,
    p_notes: values.notes,
  });
  if (error) throwDatabaseError(error, "The guest profile could not be created.");
  const guest = assertFound(data, "The created guest profile was not returned.");
  return {
    id: guest.id,
    displayName: guest.display_name,
    updatedAt: guest.updated_at,
    created: existing === null,
  };
}

export async function addGuestNote(
  context: WorkflowContext,
  input: AddGuestNoteInput,
) {
  await requireGuest(context, input.organizationId, input.guestId);
  if (input.locationId) {
    const location = await requireManagedLocation(
      context.supabase,
      context.actor,
      input.locationId,
    );
    assertCondition(
      location.organizationId === input.organizationId,
      "forbidden",
      "The note location is outside this organization.",
    );
  }

  const { data: existing, error: existingError } = await context.supabase
    .from("guest_notes")
    .select("id, organization_id, guest_id, note, is_sensitive")
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError, "The note request could not be checked.");
  const { data, error } = await context.supabase.rpc("add_guest_note", {
    p_request_id: input.requestId,
    p_guest_id: input.guestId,
    p_location_id: input.locationId ?? null,
    p_note: input.note,
    p_is_sensitive: input.sensitive,
  });
  if (error) throwDatabaseError(error, "The hospitality note could not be added.");
  const note = assertFound(data, "The hospitality note was not returned.");
  return { id: note.id, created: existing === null };
}

export async function recordGuestConsent(
  context: WorkflowContext,
  input: RecordGuestConsentInput,
) {
  await requireGuest(context, input.organizationId, input.guestId);
  const { data: existing, error: existingError } = await context.supabase
    .from("guest_consents")
    .select("id, organization_id, guest_id, channel, status")
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) {
    throwDatabaseError(existingError, "The consent event could not be checked.");
  }
  const { data, error } = await context.supabase.rpc("record_guest_consent", {
    p_request_id: input.requestId,
    p_guest_id: input.guestId,
    p_channel: input.channel,
    p_status: input.status,
    p_evidence_note: input.evidenceNote ?? null,
  });
  if (error) throwDatabaseError(error, "The consent event could not be recorded.");
  const consent = assertFound(data, "The consent event was not returned.");
  return { id: consent.id, created: existing === null };
}

/**
 * Explicit human-reviewed merge command. Candidate detection never calls this
 * workflow automatically; callers must provide both profiles and a fresh
 * idempotency request identifier.
 */
export async function mergeGuest(
  context: WorkflowContext,
  input: MergeGuestInput,
) {
  const [sourceGuest, targetGuest] = await Promise.all([
    requireGuest(context, input.organizationId, input.sourceGuestId),
    requireGuest(context, input.organizationId, input.targetGuestId),
  ]);
  assertCondition(
    sourceGuest.id !== targetGuest.id,
    "validation",
    "Choose two different guest profiles.",
  );

  const { data: existing, error: existingError } = await context.supabase
    .from("guest_merge_events")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) {
    throwDatabaseError(existingError, "The guest merge request could not be checked.");
  }

  const { data, error } = await context.supabase.rpc("merge_guests", {
    p_request_id: input.requestId,
    p_source_guest_id: sourceGuest.id,
    p_target_guest_id: targetGuest.id,
    p_match_score: input.matchScore ?? null,
    p_reasons: input.reasons,
  });
  if (error) throwDatabaseError(error, "The guest profiles could not be merged.");
  const event = assertFound(data, "The guest merge evidence was not returned.");
  return {
    id: event.id,
    sourceGuestId: event.source_guest_id,
    targetGuestId: event.target_guest_id,
    mergedAt: event.merged_at,
    alreadyApplied: existing !== null,
  };
}
