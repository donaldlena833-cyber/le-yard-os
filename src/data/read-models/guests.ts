import "server-only";

import type { WorkspaceContextValue } from "@/lib/auth/workspace-context";
import { createClient } from "@/lib/supabase/server";
import { readFailure, readSuccess, type LiveReadResult } from "./shared";

export interface LiveGuestContact {
  id: string;
  type: string;
  label: string | null;
  value: string;
  primary: boolean;
  verifiedAt: string | null;
}

export interface LiveGuestConsent {
  id: string;
  channel: string;
  status: string;
  capturedAt: string;
  revokedAt: string | null;
  source: string;
}

export interface LiveGuestNote {
  id: string;
  note: string;
  sensitive: boolean;
  locationName: string | null;
  authorName: string;
  createdAt: string;
}

export interface LiveGuestVisit {
  id: string;
  locationName: string;
  timeZone: string;
  visitedAt: string;
  partySize: number | null;
  covers: number | null;
  spendCents: number | null;
  source: string;
  notes: string | null;
}

export interface LiveGuestReservation {
  id: string;
  locationName: string;
  timeZone: string;
  reservedAt: string;
  partySize: number;
  status: string;
  tableLabel: string | null;
  specialRequests: string | null;
  source: string;
}

export interface LiveGuest {
  id: string;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  email: string | null;
  phone: string | null;
  birthday: string | null;
  vip: boolean;
  preferences: string | null;
  allergies: string | null;
  notes: string | null;
  firstVisitAt: string | null;
  lastVisitAt: string | null;
  visitCount: number;
  lifetimeSpendCents: number;
  source: string;
  currentLocationVisits: number;
  currentLocationSpendCents: number;
  contacts: LiveGuestContact[];
  consents: LiveGuestConsent[];
  tags: Array<{ id: string; name: string; color: string | null }>;
  guestNotes: LiveGuestNote[];
  visits: LiveGuestVisit[];
  reservations: LiveGuestReservation[];
}

export interface LiveGuestDuplicateCandidate {
  leftGuestId: string;
  rightGuestId: string;
  leftName: string;
  rightName: string;
  left: LiveGuestDuplicateProfile;
  right: LiveGuestDuplicateProfile;
  reason: string;
}

export interface LiveGuestDuplicateProfile {
  id: string;
  displayName: string;
  email: string | null;
  phone: string | null;
  vip: boolean;
  lastVisitAt: string | null;
  visitCount: number;
  lifetimeSpendCents: number;
  source: string;
}

export interface LiveGuestsModel {
  search: string;
  currencyCode: string;
  guests: LiveGuest[];
  metrics: {
    activeProfiles: number;
    vipProfiles: number;
    profilesWithAllergies: number;
    upcomingReservations: number;
  };
  duplicateCandidates: LiveGuestDuplicateCandidate[];
  duplicateScopeLimited: boolean;
}

function normalizedPhone(value: string | null): string | null {
  if (!value) return null;
  const digits = value.replace(/\D/g, "");
  return digits.length >= 7 ? digits : null;
}

type DuplicateRow = {
  id: string;
  display_name: string;
  email: string | null;
  phone: string | null;
  vip: boolean;
  last_visit_at: string | null;
  visit_count: number;
  lifetime_spend_cents: number;
  source: string;
};

function duplicateProfile(row: DuplicateRow): LiveGuestDuplicateProfile {
  return {
    id: row.id,
    displayName: row.display_name,
    email: row.email,
    phone: row.phone,
    vip: row.vip,
    lastVisitAt: row.last_visit_at,
    visitCount: row.visit_count,
    lifetimeSpendCents: Number(row.lifetime_spend_cents),
    source: row.source,
  };
}

function duplicateCandidates(rows: DuplicateRow[]): LiveGuestDuplicateCandidate[] {
  const groups = new Map<string, { channel: "email" | "phone"; rows: DuplicateRow[] }>();
  for (const row of rows) {
    const phone = normalizedPhone(row.phone);
    const email = row.email?.trim().toLocaleLowerCase("en-US") || null;
    if (phone) {
      const key = `phone:${phone}`;
      groups.set(key, {
        channel: "phone",
        rows: [...(groups.get(key)?.rows ?? []), row],
      });
    }
    if (email) {
      const key = `email:${email}`;
      groups.set(key, {
        channel: "email",
        rows: [...(groups.get(key)?.rows ?? []), row],
      });
    }
  }

  const pairs = new Map<
    string,
    { left: DuplicateRow; right: DuplicateRow; channels: Set<"email" | "phone"> }
  >();
  for (const group of groups.values()) {
    for (let leftIndex = 0; leftIndex < group.rows.length; leftIndex += 1) {
      for (let rightIndex = leftIndex + 1; rightIndex < group.rows.length; rightIndex += 1) {
        const first = group.rows[leftIndex];
        const second = group.rows[rightIndex];
        const [left, right] = first.id < second.id ? [first, second] : [second, first];
        const key = `${left.id}:${right.id}`;
        const pair = pairs.get(key) ?? { left, right, channels: new Set() };
        pair.channels.add(group.channel);
        pairs.set(key, pair);
      }
    }
  }

  return [...pairs.values()]
    .map(({ left, right, channels }) => ({
      leftGuestId: left.id,
      rightGuestId: right.id,
      leftName: left.display_name,
      rightName: right.display_name,
      left: duplicateProfile(left),
      right: duplicateProfile(right),
      reason:
        channels.size === 2
          ? "Exact normalized phone and email match"
          : channels.has("phone")
            ? "Exact normalized phone match"
            : "Exact normalized email match",
    }))
    .sort((left, right) =>
      `${left.leftName}:${left.rightName}`.localeCompare(
        `${right.leftName}:${right.rightName}`,
      ),
    )
    .slice(0, 50);
}

export async function loadLiveGuests(
  workspace: WorkspaceContextValue,
  search = "",
): Promise<LiveReadResult<LiveGuestsModel>> {
  if (workspace.role === "employee") return readFailure("Management access is required.");

  try {
    const supabase = await createClient();
    const organizationId = workspace.organization.id;
    const locationId = workspace.activeLocation.id;
    const normalizedSearch = search.trim().slice(0, 120);
    const now = new Date().toISOString();

    let guestQuery = supabase
      .from("guests")
      .select(
        "id, first_name, last_name, display_name, email, phone, birthday, vip, preferences, allergies, notes, first_visit_at, last_visit_at, visit_count, lifetime_spend_cents, source",
      )
      .eq("organization_id", organizationId)
      .is("merged_into_id", null)
      .order("last_visit_at", { ascending: false, nullsFirst: false })
      .limit(250);
    if (normalizedSearch) {
      guestQuery = guestQuery.textSearch("search_vector", normalizedSearch, {
        config: "simple",
        type: "websearch",
      });
    }

    const [
      guestResult,
      profileCountResult,
      vipCountResult,
      allergyCountResult,
      reservationCountResult,
      duplicateBaseResult,
      tagResult,
      locationResult,
      organizationResult,
    ] = await Promise.all([
      guestQuery,
      supabase
        .from("guests")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("merged_into_id", null),
      supabase
        .from("guests")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("merged_into_id", null)
        .eq("vip", true),
      supabase
        .from("guests")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .is("merged_into_id", null)
        .not("allergies", "is", null)
        .neq("allergies", ""),
      supabase
        .from("reservations")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", organizationId)
        .eq("location_id", locationId)
        .gte("reserved_at", now)
        .in("status", ["booked", "confirmed"]),
      supabase
        .from("guests")
        .select(
          "id, display_name, email, phone, vip, last_visit_at, visit_count, lifetime_spend_cents, source",
        )
        .eq("organization_id", organizationId)
        .is("merged_into_id", null)
        .or("phone.not.is.null,email.not.is.null")
        .order("id")
        .limit(1_001),
      supabase
        .from("guest_tags")
        .select("id, name, color")
        .eq("organization_id", organizationId)
        .order("name"),
      supabase
        .from("locations")
        .select("id, name, timezone")
        .eq("organization_id", organizationId),
      supabase
        .from("organizations")
        .select("currency_code")
        .eq("id", organizationId)
        .single(),
    ]);

    if (
      guestResult.error ||
      profileCountResult.error ||
      vipCountResult.error ||
      allergyCountResult.error ||
      reservationCountResult.error ||
      duplicateBaseResult.error ||
      tagResult.error ||
      locationResult.error ||
      organizationResult.error
    ) {
      return readFailure();
    }

    const guests = guestResult.data ?? [];
    const guestIds = guests.map((guest) => guest.id);
    if (!guestIds.length) {
      return readSuccess({
        search: normalizedSearch,
        currencyCode: organizationResult.data.currency_code,
        guests: [],
        metrics: {
          activeProfiles: profileCountResult.count ?? 0,
          vipProfiles: vipCountResult.count ?? 0,
          profilesWithAllergies: allergyCountResult.count ?? 0,
          upcomingReservations: reservationCountResult.count ?? 0,
        },
        duplicateCandidates: duplicateCandidates(duplicateBaseResult.data ?? []),
        duplicateScopeLimited: (duplicateBaseResult.data?.length ?? 0) > 1_000,
      });
    }

    const [
      guestLocationResult,
      contactResult,
      assignmentResult,
      noteResult,
      consentResult,
      visitResult,
      reservationResult,
    ] = await Promise.all([
      supabase
        .from("guest_locations")
        .select("guest_id, visit_count, spend_cents")
        .eq("organization_id", organizationId)
        .eq("location_id", locationId)
        .in("guest_id", guestIds),
      supabase
        .from("guest_contacts")
        .select("id, guest_id, contact_type, label, value, is_primary, verified_at")
        .eq("organization_id", organizationId)
        .in("guest_id", guestIds),
      supabase
        .from("guest_tag_assignments")
        .select("guest_id, tag_id")
        .eq("organization_id", organizationId)
        .in("guest_id", guestIds),
      supabase
        .from("guest_notes")
        .select("id, guest_id, location_id, note, is_sensitive, author_id, created_at")
        .eq("organization_id", organizationId)
        .in("guest_id", guestIds)
        .order("created_at", { ascending: false })
        .limit(750),
      supabase
        .from("guest_consents")
        .select("id, guest_id, channel, status, captured_at, revoked_at, source")
        .eq("organization_id", organizationId)
        .in("guest_id", guestIds)
        .order("captured_at", { ascending: false })
        .limit(750),
      supabase
        .from("guest_visits")
        .select("id, guest_id, location_id, visited_at, party_size, covers, spend_cents, source, notes")
        .eq("organization_id", organizationId)
        .in("guest_id", guestIds)
        .order("visited_at", { ascending: false })
        .limit(1_000),
      supabase
        .from("reservations")
        .select("id, guest_id, location_id, reserved_at, party_size, status, table_label, special_requests, source")
        .eq("organization_id", organizationId)
        .in("guest_id", guestIds)
        .order("reserved_at", { ascending: false })
        .limit(1_000),
    ]);
    if (
      guestLocationResult.error ||
      contactResult.error ||
      assignmentResult.error ||
      noteResult.error ||
      consentResult.error ||
      visitResult.error ||
      reservationResult.error
    ) {
      return readFailure();
    }

    const authorIds = [
      ...new Set((noteResult.data ?? []).map((note) => note.author_id)),
    ];
    const profileResult = authorIds.length
      ? await supabase
          .from("profiles")
          .select("id, display_name, preferred_name")
          .in("id", authorIds)
      : { data: [], error: null };
    if (profileResult.error) return readFailure();

    const tags = new Map((tagResult.data ?? []).map((tag) => [tag.id, tag]));
    const locations = new Map(
      (locationResult.data ?? []).map((location) => [location.id, location]),
    );
    const profiles = new Map(
      (profileResult.data ?? []).map((profile) => [
        profile.id,
        profile.preferred_name?.trim() || profile.display_name,
      ]),
    );
    const guestLocations = new Map(
      (guestLocationResult.data ?? []).map((row) => [row.guest_id, row]),
    );

    return readSuccess({
      search: normalizedSearch,
      currencyCode: organizationResult.data.currency_code,
      metrics: {
        activeProfiles: profileCountResult.count ?? 0,
        vipProfiles: vipCountResult.count ?? 0,
        profilesWithAllergies: allergyCountResult.count ?? 0,
        upcomingReservations: reservationCountResult.count ?? 0,
      },
      duplicateCandidates: duplicateCandidates(duplicateBaseResult.data ?? []),
      duplicateScopeLimited: (duplicateBaseResult.data?.length ?? 0) > 1_000,
      guests: guests.map((guest) => {
        const locationSummary = guestLocations.get(guest.id);
        return {
          id: guest.id,
          firstName: guest.first_name,
          lastName: guest.last_name,
          displayName: guest.display_name,
          email: guest.email,
          phone: guest.phone,
          birthday: guest.birthday,
          vip: guest.vip,
          preferences: guest.preferences,
          allergies: guest.allergies,
          notes: guest.notes,
          firstVisitAt: guest.first_visit_at,
          lastVisitAt: guest.last_visit_at,
          visitCount: guest.visit_count,
          lifetimeSpendCents: Number(guest.lifetime_spend_cents),
          source: guest.source,
          currentLocationVisits: locationSummary?.visit_count ?? 0,
          currentLocationSpendCents: Number(locationSummary?.spend_cents ?? 0),
          contacts: (contactResult.data ?? [])
            .filter((contact) => contact.guest_id === guest.id)
            .map((contact) => ({
              id: contact.id,
              type: contact.contact_type,
              label: contact.label,
              value: contact.value,
              primary: contact.is_primary,
              verifiedAt: contact.verified_at,
            })),
          consents: (consentResult.data ?? [])
            .filter((consent) => consent.guest_id === guest.id)
            .map((consent) => ({
              id: consent.id,
              channel: consent.channel,
              status: consent.status,
              capturedAt: consent.captured_at,
              revokedAt: consent.revoked_at,
              source: consent.source,
            })),
          tags: (assignmentResult.data ?? [])
            .filter((assignment) => assignment.guest_id === guest.id)
            .map((assignment) => tags.get(assignment.tag_id))
            .filter((tag): tag is NonNullable<typeof tag> => Boolean(tag))
            .map((tag) => ({ id: tag.id, name: tag.name, color: tag.color })),
          guestNotes: (noteResult.data ?? [])
            .filter((note) => note.guest_id === guest.id)
            .map((note) => ({
              id: note.id,
              note: note.note,
              sensitive: note.is_sensitive,
              locationName: note.location_id
                ? locations.get(note.location_id)?.name ?? "Location"
                : null,
              authorName: profiles.get(note.author_id) ?? "Team member",
              createdAt: note.created_at,
            })),
          visits: (visitResult.data ?? [])
            .filter((visit) => visit.guest_id === guest.id)
            .map((visit) => ({
              id: visit.id,
              locationName: locations.get(visit.location_id)?.name ?? "Location",
              timeZone: locations.get(visit.location_id)?.timezone ?? "UTC",
              visitedAt: visit.visited_at,
              partySize: visit.party_size,
              covers: visit.covers,
              spendCents: visit.spend_cents == null ? null : Number(visit.spend_cents),
              source: visit.source,
              notes: visit.notes,
            })),
          reservations: (reservationResult.data ?? [])
            .filter((reservation) => reservation.guest_id === guest.id)
            .map((reservation) => ({
              id: reservation.id,
              locationName: locations.get(reservation.location_id)?.name ?? "Location",
              timeZone: locations.get(reservation.location_id)?.timezone ?? "UTC",
              reservedAt: reservation.reserved_at,
              partySize: reservation.party_size,
              status: reservation.status,
              tableLabel: reservation.table_label,
              specialRequests: reservation.special_requests,
              source: reservation.source,
            })),
        };
      }),
    });
  } catch {
    return readFailure();
  }
}
