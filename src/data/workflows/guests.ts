import "server-only";

import {
  assertCondition,
  assertFound,
  throwDatabaseError,
} from "../errors";
import type {
  AddGuestNoteInput,
  MergeGuestInput,
  RecordGuestConsentInput,
  SaveGuestInput,
} from "../guest-schemas";
import { requireLocationAccess, requireOrganizationAccess } from "../policy";
import type { WorkflowContext } from "../execute";
import type { SearchGuestsInput } from "../schemas";

interface GuestSearchRow {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  vip: boolean;
  last_visit_at: string | null;
  visit_count: number;
}

export async function searchGuests(
  { supabase, actor }: WorkflowContext,
  input: SearchGuestsInput,
) {
  requireLocationAccess(actor, input.organizationId, input.locationId);
  const { data, error } = await supabase.rpc("service_guest_profiles", {
    p_organization_id: input.organizationId,
    p_location_id: input.locationId,
    p_query: input.query,
    p_limit: input.limit,
    p_guest_ids: null,
  });
  if (error) throwDatabaseError(error, "Guests could not be searched.");
  return ((data ?? []) as GuestSearchRow[]).map((guest) => ({
    id: guest.id,
    displayName: guest.display_name,
    email: guest.email,
    phone: guest.phone,
    vip: guest.vip,
    lastVisitAt: guest.last_visit_at,
    visitCount: guest.visit_count,
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
  requireOrganizationAccess(context.actor, organizationId);
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

async function requireMergeGuest(
  context: WorkflowContext,
  organizationId: string,
  guestId: string,
  allowedMergedIntoId: string | null,
) {
  requireOrganizationAccess(context.actor, organizationId);
  const { data, error } = await context.supabase
    .from("guests")
    .select("id, organization_id, merged_into_id")
    .eq("organization_id", organizationId)
    .eq("id", guestId)
    .maybeSingle();
  if (error) throwDatabaseError(error, "The guest could not be verified.");
  const guest = assertFound(data, "The guest was not found.");
  assertCondition(
    !guest.merged_into_id || guest.merged_into_id === allowedMergedIntoId,
    "conflict",
    "This profile has already been merged.",
  );
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
  requireLocationAccess(
    context.actor,
    input.organizationId,
    input.locationId,
  );
  const values = guestValues(input);

  if (input.guestId) {
    await requireGuest(context, input.organizationId, input.guestId);
    const { data, error } = await context.supabase.rpc("service_save_guest", {
      p_request_id: input.requestId,
      p_organization_id: input.organizationId,
      p_location_id: input.locationId,
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
    const guest = assertFound(data?.[0], "The updated guest profile was not returned.");
    assertCondition(
      guest.id && guest.display_name && guest.updated_at,
      "database",
      "The updated guest result was incomplete.",
    );
    return {
      id: guest.id,
      displayName: guest.display_name,
      updatedAt: guest.updated_at,
      created: false,
    };
  }

  const { data: existing, error: existingError } = await context.supabase
    .from("guests")
    .select("id, organization_id, display_name")
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError, "The guest request could not be checked.");
  const { data, error } = await context.supabase.rpc("service_save_guest", {
    p_request_id: input.requestId,
    p_organization_id: input.organizationId,
    p_location_id: input.locationId,
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
  const guest = assertFound(data?.[0], "The created guest profile was not returned.");
  assertCondition(
    guest.id && guest.display_name && guest.updated_at,
    "database",
    "The created guest result was incomplete.",
  );
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
  requireLocationAccess(
    context.actor,
    input.organizationId,
    input.locationId,
  );

  const { data: existing, error: existingError } = await context.supabase
    .from("guest_notes")
    .select("id, organization_id, guest_id")
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) throwDatabaseError(existingError, "The note request could not be checked.");
  const { data, error } = await context.supabase.rpc("service_add_guest_note", {
    p_request_id: input.requestId,
    p_guest_id: input.guestId,
    p_location_id: input.locationId,
    p_note: input.note,
    p_is_sensitive: input.sensitive,
  });
  if (error) throwDatabaseError(error, "The hospitality note could not be added.");
  const note = assertFound(data?.[0], "The hospitality note was not returned.");
  assertCondition(note.id, "database", "The hospitality note result was incomplete.");
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
  const { data, error } = await context.supabase.rpc(
    "service_record_guest_consent",
    {
      p_request_id: input.requestId,
      p_organization_id: input.organizationId,
      p_location_id: input.locationId,
      p_guest_id: input.guestId,
      p_channel: input.channel,
      p_status: input.status,
      p_evidence_note: input.evidenceNote ?? null,
    },
  );
  if (error) throwDatabaseError(error, "The consent event could not be recorded.");
  const consent = assertFound(data?.[0], "The consent event was not returned.");
  assertCondition(
    consent.id && consent.captured_at,
    "database",
    "The consent result was incomplete.",
  );
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
  requireLocationAccess(
    context.actor,
    input.organizationId,
    input.locationId,
  );
  assertCondition(
    input.sourceGuestId !== input.targetGuestId,
    "validation",
    "Choose two different guest profiles.",
  );

  await Promise.all([
    requireMergeGuest(
      context,
      input.organizationId,
      input.sourceGuestId,
      input.targetGuestId,
    ),
    requireMergeGuest(
      context,
      input.organizationId,
      input.targetGuestId,
      null,
    ),
  ]);

  const { data: existing, error: existingError } = await context.supabase
    .from("guest_merge_events")
    .select("id")
    .eq("organization_id", input.organizationId)
    .eq("id", input.requestId)
    .maybeSingle();
  if (existingError) {
    throwDatabaseError(existingError, "The guest merge request could not be checked.");
  }

  const { data, error } = await context.supabase.rpc("service_merge_guests", {
    p_request_id: input.requestId,
    p_organization_id: input.organizationId,
    p_location_id: input.locationId,
    p_source_guest_id: input.sourceGuestId,
    p_target_guest_id: input.targetGuestId,
    p_match_score: input.matchScore ?? null,
    p_reasons: input.reasons,
  });
  if (error) throwDatabaseError(error, "The guest profiles could not be merged.");
  const event = assertFound(data?.[0], "The guest merge evidence was not returned.");
  assertCondition(
    event.id &&
      event.source_guest_id &&
      event.target_guest_id &&
      event.merged_at,
    "database",
    "The guest merge result was incomplete.",
  );
  return {
    id: event.id,
    sourceGuestId: event.source_guest_id,
    targetGuestId: event.target_guest_id,
    mergedAt: event.merged_at,
    alreadyApplied: existing !== null,
  };
}
