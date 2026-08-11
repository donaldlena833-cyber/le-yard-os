import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { PGlite } from "@electric-sql/pglite";
import { pgcrypto } from "@electric-sql/pglite/contrib/pgcrypto";
import { pg_trgm } from "@electric-sql/pglite/contrib/pg_trgm";
import { btree_gist } from "@electric-sql/pglite/contrib/btree_gist";

const root = process.cwd();
const migrationsDirectory = join(root, "supabase", "migrations");
const migrationFiles = (await readdir(migrationsDirectory))
  .filter((file) => file.endsWith(".sql"))
  .sort();
const db = new PGlite({ extensions: { pgcrypto, pg_trgm, btree_gist } });

const ids = {
  organization: "20000000-0000-4000-8000-000000000001",
  otherOrganization: "20000000-0000-4000-8000-000000000002",
  location: "30000000-0000-4000-8000-000000000001",
  otherLocation: "30000000-0000-4000-8000-000000000002",
  otherTenantLocation: "30000000-0000-4000-8000-000000000003",
  manager: "10000000-0000-4000-8000-000000000004",
  owner: "10000000-0000-4000-8000-000000000001",
  employee: "10000000-0000-4000-8000-000000000005",
  otherTenantOwner: "10000000-0000-4000-8000-000000000006",
  area: "d1000000-0000-4000-8000-000000000001",
  table: "d2000000-0000-4000-8000-000000000001",
  otherTable: "d2000000-0000-4000-8000-000000000002",
  period: "d3000000-0000-4000-8000-000000000001",
  staffReservation: "d4000000-0000-4000-8000-000000000001",
  conflictingReservation: "d4000000-0000-4000-8000-000000000002",
  publicRequest: "d5000000-0000-4000-8000-000000000001",
  expiringPublicRequest: "d5000000-0000-4000-8000-000000000002",
  pacingReservation: "d4000000-0000-4000-8000-000000000003",
  smsInjectionRequest: "d5000000-0000-4000-8000-000000000003",
  emailInjectionRequest: "d5000000-0000-4000-8000-000000000004",
  smsFormatReplayRequest: "d5000000-0000-4000-8000-000000000005",
  matchedContactRequest: "d5000000-0000-4000-8000-000000000006",
  crossLocationIdentityGuest: "ae000000-0000-4000-8000-000000000001",
  crossLocationIdentityGuestLocation: "ae100000-0000-4000-8000-000000000001",
  matchedIdentityWaitlist: "ae200000-0000-4000-8000-000000000001",
  crossLocationIdentityWaitlist: "ae200000-0000-4000-8000-000000000002",
  ambiguousIdentityWaitlist: "ae200000-0000-4000-8000-000000000003",
  ambiguousEmailGuest: "ae300000-0000-4000-8000-000000000001",
  ambiguousPhoneGuest: "ae300000-0000-4000-8000-000000000002",
  ambiguousEmailGuestLocation: "ae400000-0000-4000-8000-000000000001",
  ambiguousPhoneGuestLocation: "ae400000-0000-4000-8000-000000000002",
  mergeReplayRequest: "ae500000-0000-4000-8000-000000000001",
  mergeReplayTargetGuest: "ae510000-0000-4000-8000-000000000001",
  mergeReplayTargetGuestLocation: "ae520000-0000-4000-8000-000000000001",
  mergeReplayMergeRequest: "ae530000-0000-4000-8000-000000000001",
  existingReservationCollision: "ae540000-0000-4000-8000-000000000001",
  existingReservationCreationRequest: "ae550000-0000-4000-8000-000000000001",
  publicIdentityCollisionRequest: "ae600000-0000-4000-8000-000000000001",
  capabilityOverride: "d8000000-0000-4000-8000-000000000001",
  managerGuestManageOverride: "d8000000-0000-4000-8000-000000000002",
  managerSensitiveOverride: "d8000000-0000-4000-8000-000000000003",
  employeeSensitiveCommandOverride: "d8000000-0000-4000-8000-000000000004",
  employeeGuestTarget: "b8100000-0000-4000-8000-000000000001",
  employeeGuestSource: "b8100000-0000-4000-8000-000000000002",
  employeeGuestConsent: "b8200000-0000-4000-8000-000000000001",
  employeeGuestNote: "b8300000-0000-4000-8000-000000000001",
  employeeGuestMerge: "b8400000-0000-4000-8000-000000000001",
  mergeRaceSourceGuest: "b8600000-0000-4000-8000-000000000001",
  mergeRaceTargetGuest: "b8600000-0000-4000-8000-000000000002",
  mergeRaceRequest: "b8700000-0000-4000-8000-000000000001",
  mergeRaceInjectedLocation: "b8800000-0000-4000-8000-000000000001",
  mergeEmailSourceGuest: "b8d00000-0000-4000-8000-000000000001",
  mergeEmailTargetGuest: "b8d00000-0000-4000-8000-000000000002",
  mergeEmailThirdGuest: "b8d00000-0000-4000-8000-000000000003",
  mergeEmailRequest: "b8d10000-0000-4000-8000-000000000001",
  mergePhoneSourceGuest: "b8e00000-0000-4000-8000-000000000001",
  mergePhoneTargetGuest: "b8e00000-0000-4000-8000-000000000002",
  mergePhoneThirdGuest: "b8e00000-0000-4000-8000-000000000003",
  mergePhoneRequest: "b8e10000-0000-4000-8000-000000000001",
  mergeResolverSourceGuest: "b8f00000-0000-4000-8000-000000000001",
  mergeResolverTargetGuest: "b8f00000-0000-4000-8000-000000000002",
  mergeResolverInjectedGuest: "b8f00000-0000-4000-8000-000000000003",
  mergeResolverRequest: "b8f10000-0000-4000-8000-000000000001",
  sharedGuestLocation: "b8900000-0000-4000-8000-000000000001",
  sharedEmailConflictGuest: "b8a00000-0000-4000-8000-000000000001",
  sharedPhoneConflictGuest: "b8a00000-0000-4000-8000-000000000002",
  sharedEmailConflictLocation: "b8a10000-0000-4000-8000-000000000001",
  sharedPhoneConflictLocation: "b8a10000-0000-4000-8000-000000000002",
  employeeOtherLocationManageOverride: "b8b00000-0000-4000-8000-000000000001",
  employeeSharedSensitiveAOverride: "b8b00000-0000-4000-8000-000000000002",
  employeeSharedSensitiveBOverride: "b8b00000-0000-4000-8000-000000000003",
  employeeOtherLocationMembership: "b8b10000-0000-4000-8000-000000000001",
  localDuplicateEmailGuest: "da000000-0000-4000-8000-000000000001",
  localMergeSourceGuest: "da000000-0000-4000-8000-000000000002",
  localGuestConsent: "db000000-0000-4000-8000-000000000001",
  localGuestNoteCommand: "dc000000-0000-4000-8000-000000000001",
  localGuestMerge: "dd000000-0000-4000-8000-000000000001",
  crossLocationReservation: "d4000000-0000-4000-8000-000000000004",
  expiredManageReservation: "d4000000-0000-4000-8000-000000000005",
  guestVisit: "d9000000-0000-4000-8000-000000000001",
  crossLocationGuestVisit: "d9000000-0000-4000-8000-000000000002",
  localGuestNote: "f1000000-0000-4000-8000-000000000001",
  localGuestLocation: "f1000000-0000-4000-8000-000000000002",
  remoteGuest: "f2000000-0000-4000-8000-000000000001",
  remoteSourceGuest: "f2000000-0000-4000-8000-000000000002",
  remoteGuestLocation: "f3000000-0000-4000-8000-000000000001",
  remoteSourceGuestLocation: "f3000000-0000-4000-8000-000000000002",
  remoteGuestContact: "f4000000-0000-4000-8000-000000000001",
  remoteGuestNote: "f5000000-0000-4000-8000-000000000001",
  remoteGuestConsent: "f6000000-0000-4000-8000-000000000001",
  remoteGuestTag: "f7000000-0000-4000-8000-000000000001",
  remoteGuestTagAssignment: "f8000000-0000-4000-8000-000000000001",
  remoteGuestMerge: "f9000000-0000-4000-8000-000000000001",
  localSourceRemoteTargetMerge: "f9000000-0000-4000-8000-000000000002",
  remoteSourceLocalTargetMerge: "f9000000-0000-4000-8000-000000000003",
  atomicRequest: "d6000000-0000-4000-8000-000000000001",
  reminderRequest: "d6000000-0000-4000-8000-000000000002",
  waitlistRequest: "d7000000-0000-4000-8000-000000000001",
  expiringWaitlist: "d7000000-0000-4000-8000-000000000002",
  crossBoundaryStaleHold: "ea000000-0000-4000-8000-000000000001",
  crossBoundaryReservation: "ea000000-0000-4000-8000-000000000002",
  lifecycleReservation: "eb000000-0000-4000-8000-000000000001",
  lifecycleMissingReservation: "eb000000-0000-4000-8000-ffffffffffff",
  lifecycleModifyRequest: "eb100000-0000-4000-8000-000000000001",
  lifecycleCancelRequest: "eb100000-0000-4000-8000-000000000002",
  lifecycleStaleRequest: "eb100000-0000-4000-8000-000000000003",
  lifecycleUnauthorizedRequest: "eb100000-0000-4000-8000-000000000004",
  lifecycleCrossLocationRequest: "eb100000-0000-4000-8000-000000000005",
  lifecycleLegacyUpdateRequest: "eb100000-0000-4000-8000-000000000006",
  lifecycleLegacyCancelRequest: "eb100000-0000-4000-8000-000000000007",
  lifecycleMissingModifyRequest: "eb100000-0000-4000-8000-000000000008",
  lifecycleMissingCancelRequest: "eb100000-0000-4000-8000-000000000009",
  lifecycleInvalidRevisionRequest: "eb100000-0000-4000-8000-00000000000a",
  lifecycleInvalidRevision: "eb200000-0000-4000-8000-000000000001",
};

const platformBootstrap = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create schema if not exists storage;
  do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
  create table auth.users (
    instance_id uuid, id uuid primary key, aud text, role text, email text unique,
    encrypted_password text, email_confirmed_at timestamptz,
    raw_app_meta_data jsonb not null default '{}'::jsonb,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now()
  );
  create table auth.identities (
    id uuid primary key, provider_id text not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    identity_data jsonb not null default '{}'::jsonb, provider text not null,
    last_sign_in_at timestamptz, created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(), unique (provider_id, provider)
  );
  create function auth.jwt() returns jsonb language sql stable as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
  $$;
  create function auth.uid() returns uuid language sql stable as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;
  create function auth.role() returns text language sql stable as $$
    select coalesce(nullif(auth.jwt() ->> 'role', ''), current_user::text)
  $$;
  create table storage.buckets (
    id text primary key, name text not null unique, public boolean not null default false,
    file_size_limit bigint, allowed_mime_types text[]
  );
  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets(id) on delete cascade,
    name text not null, owner_id text, metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant usage on schema auth, storage to authenticated;
  grant select on storage.buckets to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`;

function authenticatedClaims(userId) {
  return JSON.stringify({ role: "authenticated", sub: userId, aal: "aal1" });
}

async function assumeUser(userId) {
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    authenticatedClaims(userId),
  ]);
}

async function expectDatabaseError(action, expectedCode, label) {
  try {
    await action();
  } catch (error) {
    if (error && typeof error === "object" && error.code === expectedCode)
      return;
    throw new Error(
      `${label} returned an unexpected error: ${error instanceof Error ? error.message : String(error)}`,
      { cause: error },
    );
  }
  throw new Error(`${label} unexpectedly succeeded`);
}

function expectExactKeys(row, expectedKeys, label) {
  const actualKeys = Object.keys(row ?? {}).sort();
  const expected = [...expectedKeys].sort();
  if (JSON.stringify(actualKeys) !== JSON.stringify(expected)) {
    throw new Error(
      `${label} returned an unsafe DTO: ${JSON.stringify(actualKeys)}`,
    );
  }
}

async function configure(requestId, command, payload) {
  const result = await db.query(
    `select public.configure_reservation_location(
      $1::uuid, $2::uuid, $3::text, $4::jsonb
    ) as result`,
    [requestId, ids.location, command, JSON.stringify(payload)],
  );
  return result.rows[0].result;
}

try {
  await db.exec(platformBootstrap);
  for (const file of migrationFiles) {
    await db.exec(await readFile(join(migrationsDirectory, file), "utf8"));
  }
  await db.exec(await readFile(join(root, "supabase", "seed.sql"), "utf8"));

  const reservationReadAcl = (
    await db.query(
      `select
        has_table_privilege('authenticated', 'public.reservations', 'select') table_select,
        has_column_privilege('authenticated', 'public.reservations', 'id', 'select') id_select,
        has_column_privilege('authenticated', 'public.reservations', 'raw_payload', 'select') raw_payload_select,
        has_column_privilege('authenticated', 'public.reservations', 'external_id', 'select') external_id_select,
        has_column_privilege('authenticated', 'public.reservations', 'public_code', 'select') public_code_select,
        has_column_privilege('service_role', 'public.reservations', 'raw_payload', 'select') service_raw_payload_select`,
    )
  ).rows[0];
  if (
    reservationReadAcl.table_select ||
    !reservationReadAcl.id_select ||
    reservationReadAcl.raw_payload_select ||
    reservationReadAcl.external_id_select ||
    reservationReadAcl.public_code_select ||
    !reservationReadAcl.service_raw_payload_select
  ) {
    throw new Error(
      `Reservation column custody is not explicit: ${JSON.stringify(reservationReadAcl)}`,
    );
  }

  const guestReadAcl = (
    await db.query(
      `select
        has_table_privilege('authenticated', 'public.guests', 'select') guest_table_select,
        has_column_privilege('authenticated', 'public.guests', 'display_name', 'select') display_name_select,
        has_column_privilege('authenticated', 'public.guests', 'allergies', 'select') allergies_select,
        has_column_privilege('authenticated', 'public.guests', 'preferences', 'select') preferences_select,
        has_column_privilege('authenticated', 'public.guests', 'notes', 'select') profile_notes_select,
        has_column_privilege('authenticated', 'public.guests', 'lifetime_spend_cents', 'select') spend_select,
        has_column_privilege('authenticated', 'public.guests', 'external_references', 'select') external_references_select,
        has_column_privilege('authenticated', 'public.guests', 'search_vector', 'select') search_vector_select,
        has_table_privilege('authenticated', 'public.guest_notes', 'select') note_table_select,
        has_column_privilege('authenticated', 'public.guest_notes', 'id', 'select') note_id_select,
        has_column_privilege('authenticated', 'public.guest_notes', 'note', 'select') note_body_select,
        has_column_privilege('authenticated', 'public.guest_notes', 'is_sensitive', 'select') note_sensitivity_select,
        has_column_privilege('service_role', 'public.guests', 'external_references', 'select') service_external_references_select,
        has_column_privilege('service_role', 'public.guest_notes', 'note', 'select') service_note_body_select,
        has_table_privilege('authenticated', 'public.guest_locations', 'select') guest_location_table_select,
        has_column_privilege('authenticated', 'public.guest_locations', 'location_id', 'select') guest_location_id_select,
        has_column_privilege('authenticated', 'public.guest_locations', 'spend_cents', 'select') guest_location_spend_select,
        has_table_privilege('authenticated', 'public.guest_visits', 'select') guest_visit_table_select,
        has_column_privilege('authenticated', 'public.guest_visits', 'id', 'select') guest_visit_id_select,
        has_column_privilege('authenticated', 'public.guest_visits', 'spend_cents', 'select') guest_visit_spend_select,
        has_column_privilege('authenticated', 'public.guest_visits', 'reservation_id_external', 'select') guest_visit_provider_select,
        has_column_privilege('authenticated', 'public.guest_visits', 'check_reference', 'select') guest_visit_check_select,
        has_column_privilege('authenticated', 'public.guest_visits', 'server_employee_id', 'select') guest_visit_server_select,
        has_column_privilege('service_role', 'public.guest_visits', 'reservation_id_external', 'select') service_guest_visit_provider_select,
        has_function_privilege(
          'authenticated',
          'public.save_guest(uuid,uuid,uuid,text,text,text,text,text,date,boolean,text,text,text)',
          'EXECUTE'
        ) raw_save_execute,
        has_function_privilege(
          'authenticated',
          'public.add_guest_note(uuid,uuid,uuid,text,boolean)',
          'EXECUTE'
        ) raw_note_execute,
        has_function_privilege(
          'authenticated',
          'public.save_guest_contact(uuid,uuid,uuid,text,text,text,boolean)',
          'EXECUTE'
        ) raw_contact_execute,
        has_function_privilege(
          'authenticated',
          'public.record_guest_consent(uuid,uuid,text,public.consent_status,text)',
          'EXECUTE'
        ) raw_consent_execute,
        has_function_privilege(
          'authenticated',
          'public.assign_guest_tag(uuid,uuid,uuid)',
          'EXECUTE'
        ) raw_tag_execute,
        has_function_privilege(
          'authenticated',
          'public.merge_guests(uuid,uuid,uuid,numeric,jsonb)',
          'EXECUTE'
        ) raw_merge_execute,
        has_function_privilege(
          'authenticated',
          'public.service_save_guest(uuid,uuid,uuid,uuid,text,text,text,text,text,date,boolean,text,text,text)',
          'EXECUTE'
        ) safe_save_execute,
        has_function_privilege(
          'authenticated',
          'public.service_add_guest_note(uuid,uuid,uuid,text,boolean)',
          'EXECUTE'
        ) safe_note_execute,
        has_function_privilege(
          'authenticated',
          'public.service_record_guest_consent(uuid,uuid,uuid,uuid,text,public.consent_status,text)',
          'EXECUTE'
        ) safe_consent_execute,
        has_function_privilege(
          'authenticated',
          'public.service_merge_guests(uuid,uuid,uuid,uuid,uuid,numeric,jsonb)',
          'EXECUTE'
        ) safe_merge_execute,
        has_function_privilege(
          'service_role',
          'public.save_guest_contact(uuid,uuid,uuid,text,text,text,boolean)',
          'EXECUTE'
        ) service_contact_execute,
        has_function_privilege(
          'service_role',
          'public.record_guest_consent(uuid,uuid,text,public.consent_status,text)',
          'EXECUTE'
        ) service_consent_execute,
        has_function_privilege(
          'service_role',
          'public.assign_guest_tag(uuid,uuid,uuid)',
          'EXECUTE'
        ) service_tag_execute,
        has_function_privilege(
          'service_role',
          'public.merge_guests(uuid,uuid,uuid,numeric,jsonb)',
          'EXECUTE'
        ) service_merge_execute`,
    )
  ).rows[0];
  if (
    guestReadAcl.guest_table_select ||
    !guestReadAcl.display_name_select ||
    guestReadAcl.allergies_select ||
    guestReadAcl.preferences_select ||
    guestReadAcl.profile_notes_select ||
    guestReadAcl.spend_select ||
    guestReadAcl.external_references_select ||
    guestReadAcl.search_vector_select ||
    guestReadAcl.note_table_select ||
    !guestReadAcl.note_id_select ||
    guestReadAcl.note_body_select ||
    guestReadAcl.note_sensitivity_select ||
    !guestReadAcl.service_external_references_select ||
    !guestReadAcl.service_note_body_select ||
    guestReadAcl.guest_location_table_select ||
    !guestReadAcl.guest_location_id_select ||
    guestReadAcl.guest_location_spend_select ||
    guestReadAcl.guest_visit_table_select ||
    !guestReadAcl.guest_visit_id_select ||
    !guestReadAcl.guest_visit_spend_select ||
    guestReadAcl.guest_visit_provider_select ||
    guestReadAcl.guest_visit_check_select ||
    guestReadAcl.guest_visit_server_select ||
    !guestReadAcl.service_guest_visit_provider_select ||
    guestReadAcl.raw_save_execute ||
    guestReadAcl.raw_note_execute ||
    guestReadAcl.raw_contact_execute ||
    guestReadAcl.raw_consent_execute ||
    guestReadAcl.raw_tag_execute ||
    guestReadAcl.raw_merge_execute ||
    !guestReadAcl.safe_save_execute ||
    !guestReadAcl.safe_note_execute ||
    !guestReadAcl.safe_consent_execute ||
    !guestReadAcl.safe_merge_execute ||
    !guestReadAcl.service_contact_execute ||
    !guestReadAcl.service_consent_execute ||
    !guestReadAcl.service_tag_execute ||
    !guestReadAcl.service_merge_execute
  ) {
    throw new Error(
      `Guest sensitive-column custody is not explicit: ${JSON.stringify(guestReadAcl)}`,
    );
  }

  await db.exec("set role authenticated");
  await assumeUser(ids.owner);

  await configure("d0100000-0000-4000-8000-000000000001", "settings.save", {
    onlineBookingEnabled: true,
    guestMessagingEnabled: true,
    verificationChannels: ["email", "sms"],
    staffPushEnabled: true,
    verificationHoldMinutes: 10,
    bookingHorizonDays: 30,
    minimumLeadMinutes: 0,
    slotIntervalMinutes: 15,
    maxOnlinePartySize: 8,
    modificationCutoffMinutes: 120,
    cancellationCutoffMinutes: 120,
    reminderScheduleMinutes: [1440, 120],
    approved: true,
  });
  await configure(ids.area, "area.save", {
    name: "Dining Room",
    sortOrder: 1,
    isActive: true,
  });
  await configure(ids.table, "table.save", {
    diningAreaId: ids.area,
    label: "T1",
    minCapacity: 1,
    maxCapacity: 4,
    positionX: 0.2,
    positionY: 0.2,
    width: 0.12,
    height: 0.08,
    rotationDegrees: 0,
    shape: "rectangle",
    isBookable: true,
    isActive: true,
    approved: true,
  });
  await configure(ids.otherTable, "table.save", {
    diningAreaId: ids.area,
    label: "T2",
    minCapacity: 1,
    maxCapacity: 4,
    positionX: 0.5,
    positionY: 0.2,
    width: 0.12,
    height: 0.08,
    rotationDegrees: 0,
    shape: "rectangle",
    isBookable: true,
    isActive: true,
    approved: true,
  });
  await configure(ids.period, "service_period.save", {
    name: "Dinner",
    daysOfWeek: [0, 1, 2, 3, 4, 5, 6],
    startsLocal: "17:00",
    endsLocal: "23:00",
    defaultDurationMinutes: 120,
    pacingIntervalMinutes: 15,
    pacingCoverLimit: 12,
    minPartySize: 2,
    maxPartySize: 6,
    effectiveFrom: "2026-01-01",
    effectiveTo: null,
    onlineEnabled: true,
    isActive: true,
    approved: true,
  });

  const serviceTime = (
    await db.query(
      `select date_trunc('day', clock_timestamp() + interval '2 days')
        + interval '22 hours' as value`,
    )
  ).rows[0].value;

  const saved = (
    await db.query(
      `select public.save_reservation(
        $1::uuid, $2::uuid, null::uuid, null::uuid, $3::timestamptz,
        120, 4, 'Window if possible', 'phone', array[$4::uuid]
      ) as result`,
      [ids.staffReservation, ids.location, serviceTime, ids.table],
    )
  ).rows[0].result;
  if (
    saved.id !== ids.staffReservation ||
    saved.status !== "booked" ||
    saved.replayed
  ) {
    throw new Error(`Staff reservation save failed: ${JSON.stringify(saved)}`);
  }
  const replayed = (
    await db.query(
      `select public.save_reservation(
        $1::uuid, $2::uuid, null::uuid, null::uuid, $3::timestamptz,
        120, 4, 'Window if possible', 'phone', array[$4::uuid]
      ) as result`,
      [ids.staffReservation, ids.location, serviceTime, ids.table],
    )
  ).rows[0].result;
  if (!replayed.replayed)
    throw new Error("Staff reservation did not replay exactly");

  await expectDatabaseError(
    () =>
      db.query(
        `select public.save_reservation(
          $1::uuid, $2::uuid, null::uuid, null::uuid, $3::timestamptz,
          120, 2, null, 'manual', array[$4::uuid]
        )`,
        [ids.conflictingReservation, ids.location, serviceTime, ids.table],
      ),
    "23P01",
    "overlapping table allocation",
  );

  const arrived = (
    await db.query(
      "select public.transition_reservation($1::uuid, $2::uuid, 'arrived', 'Party checked in') as result",
      ["d4100000-0000-4000-8000-000000000001", ids.staffReservation],
    )
  ).rows[0].result;
  if (arrived.status !== "arrived")
    throw new Error("Arrival transition did not persist");

  await assumeUser(ids.employee);
  await expectDatabaseError(
    () =>
      db.query(
        "select public.transition_reservation($1::uuid, $2::uuid, 'seated', null)",
        ["d4100000-0000-4000-8000-000000000002", ids.staffReservation],
      ),
    "42501",
    "employee reservation transition",
  );

  await assumeUser(ids.owner);
  const seated = (
    await db.query(
      "select public.transition_reservation($1::uuid, $2::uuid, 'seated', null) as result",
      ["d4100000-0000-4000-8000-000000000003", ids.staffReservation],
    )
  ).rows[0].result;
  if (seated.status !== "seated")
    throw new Error("Seating transition did not persist");
  const completed = (
    await db.query(
      "select public.transition_reservation($1::uuid, $2::uuid, 'completed', null) as result",
      ["d4100000-0000-4000-8000-000000000004", ids.staffReservation],
    )
  ).rows[0].result;
  if (completed.status !== "completed")
    throw new Error("Completion transition did not persist");
  const resetState = (
    await db.query(
      "select status from public.table_status_events where table_id = $1::uuid order by occurred_at desc, id desc limit 1",
      [ids.table],
    )
  ).rows[0]?.status;
  if (resetState !== "needs_reset")
    throw new Error("Completed table was not marked for reset");

  // Staff edits and cancellations use their own expected-version commands.
  // Keep this fixture inside an approved materialized service and away from the
  // legacy staff reservation's table/time so later Host and pacing proofs stay
  // independent.
  const lifecycleTime = (
    await db.query(
      `select (
        date_trunc('day', clock_timestamp() at time zone 'America/New_York')
        + interval '2 days 19 hours'
      ) at time zone 'America/New_York' as value`,
    )
  ).rows[0].value;
  const lifecycleMovedTime = new Date(
    new Date(lifecycleTime).valueOf() + 15 * 60_000,
  ).toISOString();
  const lifecycleCreated = (
    await db.query(
      `select public.save_reservation(
        $1::uuid, $2::uuid, null::uuid, null::uuid, $3::timestamptz,
        120, 2, 'Initial lifecycle request', 'phone', array[$4::uuid]
      ) result`,
      [ids.lifecycleReservation, ids.location, lifecycleTime, ids.otherTable],
    )
  ).rows[0].result;
  if (
    lifecycleCreated.id !== ids.lifecycleReservation ||
    lifecycleCreated.version !== 1 ||
    lifecycleCreated.replayed
  ) {
    throw new Error(
      `Lifecycle reservation fixture failed: ${JSON.stringify(lifecycleCreated)}`,
    );
  }

  await assumeUser(ids.employee);
  await expectDatabaseError(
    () =>
      db.query(
        `select public.modify_reservation(
          $1::uuid, $2::uuid, $3::uuid, 1, $4::timestamptz,
          120, 3, 'Lifecycle moved', array[$5::uuid],
          'Employee cannot change this reservation'
        )`,
        [
          ids.lifecycleUnauthorizedRequest,
          ids.location,
          ids.lifecycleReservation,
          lifecycleMovedTime,
          ids.otherTable,
        ],
      ),
    "42501",
    "unauthorized staff reservation modification",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select public.service_reservation_lifecycle_head(
          $1::uuid, $2::uuid
        )`,
        [ids.location, ids.lifecycleReservation],
      ),
    "42501",
    "unauthorized exact reservation lifecycle head",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select public.service_reservation_lifecycle_head(
          $1::uuid, $2::uuid
        )`,
        [ids.location, ids.lifecycleMissingReservation],
      ),
    "42501",
    "unauthorized nonexistent reservation lifecycle head",
  );
  await assumeUser(ids.owner);
  await expectDatabaseError(
    () =>
      db.query(
        `select public.modify_reservation(
          $1::uuid, $2::uuid, $3::uuid, 1, $4::timestamptz,
          120, 3, 'Missing reservation', array[$5::uuid],
          'Authorized actor cannot probe a missing reservation'
        )`,
        [
          ids.lifecycleMissingModifyRequest,
          ids.location,
          ids.lifecycleMissingReservation,
          lifecycleMovedTime,
          ids.otherTable,
        ],
      ),
    "42501",
    "authorized missing reservation modification",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select public.cancel_reservation(
          $1::uuid, $2::uuid, $3::uuid, 1,
          'Authorized actor cannot probe a missing reservation'
        )`,
        [
          ids.lifecycleMissingCancelRequest,
          ids.location,
          ids.lifecycleMissingReservation,
        ],
      ),
    "42501",
    "authorized missing reservation cancellation",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select public.service_reservation_lifecycle_head(
          $1::uuid, $2::uuid
        )`,
        [ids.location, ids.lifecycleMissingReservation],
      ),
    "42501",
    "authorized missing reservation lifecycle head",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select public.cancel_reservation(
          $1::uuid, $2::uuid, $3::uuid, 1,
          'Wrong-location cancellation attempt'
        )`,
        [
          ids.lifecycleCrossLocationRequest,
          ids.otherLocation,
          ids.lifecycleReservation,
        ],
      ),
    "42501",
    "cross-location staff reservation cancellation",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select public.service_reservation_lifecycle_head(
          $1::uuid, $2::uuid
        )`,
        [ids.otherLocation, ids.lifecycleReservation],
      ),
    "42501",
    "cross-location exact reservation lifecycle head",
  );

  await expectDatabaseError(
    () =>
      db.query(
        `select public.save_reservation(
          $1::uuid, $2::uuid, $3::uuid, null::uuid, $4::timestamptz,
          120, 3, 'Legacy update bypass', 'phone', array[$5::uuid]
        )`,
        [
          ids.lifecycleLegacyUpdateRequest,
          ids.location,
          ids.lifecycleReservation,
          lifecycleMovedTime,
          ids.otherTable,
        ],
      ),
    "23514",
    "legacy staff reservation update bypass",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select public.transition_reservation(
          $1::uuid, $2::uuid, 'cancelled', 'Legacy cancellation bypass'
        )`,
        [ids.lifecycleLegacyCancelRequest, ids.lifecycleReservation],
      ),
    "23514",
    "legacy staff reservation cancellation bypass",
  );

  const lifecycleResultKeys = [
    "durationMinutes",
    "guestNotificationQueued",
    "id",
    "partySize",
    "policyEvidenceCaptured",
    "replayed",
    "reservedAt",
    "revisionId",
    "revisionKind",
    "status",
    "version",
  ];
  const lifecycleHeadKeys = [
    "bookingChannel",
    "durationMinutes",
    "id",
    "lastRevision",
    "partySize",
    "policyEvidenceCaptured",
    "reservedAt",
    "source",
    "specialRequests",
    "status",
    "tableIds",
    "version",
  ];
  const modifiedLifecycle = (
    await db.query(
      `select public.modify_reservation(
        $1::uuid, $2::uuid, $3::uuid, 1, $4::timestamptz,
        120, 3, 'Lifecycle moved', array[$5::uuid],
        'Guest requested a later table'
      ) result`,
      [
        ids.lifecycleModifyRequest,
        ids.location,
        ids.lifecycleReservation,
        lifecycleMovedTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  expectExactKeys(modifiedLifecycle, lifecycleResultKeys, "modify_reservation");
  if (
    modifiedLifecycle.id !== ids.lifecycleReservation ||
    modifiedLifecycle.status !== "booked" ||
    modifiedLifecycle.version !== 2 ||
    modifiedLifecycle.partySize !== 3 ||
    modifiedLifecycle.revisionKind !== "staff_modified" ||
    !modifiedLifecycle.policyEvidenceCaptured ||
    modifiedLifecycle.guestNotificationQueued !== false ||
    modifiedLifecycle.replayed ||
    new Date(modifiedLifecycle.reservedAt).valueOf() !==
      new Date(lifecycleMovedTime).valueOf()
  ) {
    throw new Error(
      `Staff reservation modification is incomplete: ${JSON.stringify(modifiedLifecycle)}`,
    );
  }

  await expectDatabaseError(
    () =>
      db.query(
        `select public.modify_reservation(
          $1::uuid, $2::uuid, $3::uuid, 1, $4::timestamptz,
          120, 2, 'Stale lifecycle request', array[$5::uuid],
          'Stale browser state must fail'
        )`,
        [
          ids.lifecycleStaleRequest,
          ids.location,
          ids.lifecycleReservation,
          lifecycleTime,
          ids.otherTable,
        ],
      ),
    "40001",
    "stale expected reservation version",
  );
  const lifecycleHeadAfterStale = (
    await db.query(
      `select public.service_reservation_lifecycle_head(
        $1::uuid, $2::uuid
      ) result`,
      [ids.location, ids.lifecycleReservation],
    )
  ).rows[0].result;
  expectExactKeys(
    lifecycleHeadAfterStale,
    lifecycleHeadKeys,
    "service_reservation_lifecycle_head",
  );
  if (
    lifecycleHeadAfterStale.id !== ids.lifecycleReservation ||
    lifecycleHeadAfterStale.version !== 2 ||
    lifecycleHeadAfterStale.status !== "booked" ||
    lifecycleHeadAfterStale.partySize !== 3 ||
    lifecycleHeadAfterStale.policyEvidenceCaptured !== true ||
    JSON.stringify(lifecycleHeadAfterStale.tableIds) !==
      JSON.stringify([ids.otherTable]) ||
    lifecycleHeadAfterStale.lastRevision?.id !== modifiedLifecycle.revisionId ||
    lifecycleHeadAfterStale.lastRevision?.kind !== "staff_modified" ||
    lifecycleHeadAfterStale.lastRevision?.version !== 2 ||
    lifecycleHeadAfterStale.lastRevision?.previousPartySize !== 2
  ) {
    throw new Error(
      `Lifecycle head did not recover the current version after a stale write: ${JSON.stringify(lifecycleHeadAfterStale)}`,
    );
  }

  const cancelledLifecycle = (
    await db.query(
      `select public.cancel_reservation(
        $1::uuid, $2::uuid, $3::uuid, 2,
        'Guest called to cancel dinner'
      ) result`,
      [ids.lifecycleCancelRequest, ids.location, ids.lifecycleReservation],
    )
  ).rows[0].result;
  expectExactKeys(
    cancelledLifecycle,
    lifecycleResultKeys,
    "cancel_reservation",
  );
  if (
    cancelledLifecycle.status !== "cancelled" ||
    cancelledLifecycle.version !== 3 ||
    cancelledLifecycle.revisionKind !== "staff_cancelled" ||
    !cancelledLifecycle.policyEvidenceCaptured ||
    cancelledLifecycle.guestNotificationQueued !== false ||
    cancelledLifecycle.replayed
  ) {
    throw new Error(
      `Staff reservation cancellation is incomplete: ${JSON.stringify(cancelledLifecycle)}`,
    );
  }

  // The original modification response remains exact after a later mutation.
  const modifyReplayAfterCancel = (
    await db.query(
      `select public.modify_reservation(
        $1::uuid, $2::uuid, $3::uuid, 1, $4::timestamptz,
        120, 3, 'Lifecycle moved', array[$5::uuid],
        'Guest requested a later table'
      ) result`,
      [
        ids.lifecycleModifyRequest,
        ids.location,
        ids.lifecycleReservation,
        lifecycleMovedTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  if (
    !modifyReplayAfterCancel.replayed ||
    modifyReplayAfterCancel.version !== 2 ||
    modifyReplayAfterCancel.status !== "booked" ||
    modifyReplayAfterCancel.revisionId !== modifiedLifecycle.revisionId
  ) {
    throw new Error(
      `Modification did not replay its original revision after cancellation: ${JSON.stringify(modifyReplayAfterCancel)}`,
    );
  }
  await expectDatabaseError(
    () =>
      db.query(
        `select public.modify_reservation(
          $1::uuid, $2::uuid, $3::uuid, 1, $4::timestamptz,
          120, 3, 'Lifecycle moved', array[$5::uuid],
          'Changed reason must not replay'
        )`,
        [
          ids.lifecycleModifyRequest,
          ids.location,
          ids.lifecycleReservation,
          lifecycleMovedTime,
          ids.otherTable,
        ],
      ),
    "23505",
    "changed staff modification replay",
  );
  const cancelReplay = (
    await db.query(
      `select public.cancel_reservation(
        $1::uuid, $2::uuid, $3::uuid, 2,
        'Guest called to cancel dinner'
      ) result`,
      [ids.lifecycleCancelRequest, ids.location, ids.lifecycleReservation],
    )
  ).rows[0].result;
  if (
    !cancelReplay.replayed ||
    cancelReplay.version !== 3 ||
    cancelReplay.revisionId !== cancelledLifecycle.revisionId
  ) {
    throw new Error(
      `Cancellation did not replay exactly: ${JSON.stringify(cancelReplay)}`,
    );
  }
  await expectDatabaseError(
    () =>
      db.query(
        `select public.cancel_reservation(
          $1::uuid, $2::uuid, $3::uuid, 2,
          'Changed cancellation reason'
        )`,
        [ids.lifecycleCancelRequest, ids.location, ids.lifecycleReservation],
      ),
    "23505",
    "changed staff cancellation replay",
  );
  await expectDatabaseError(
    () =>
      db.query(
        "select * from public.reservation_revisions where reservation_id = $1::uuid",
        [ids.lifecycleReservation],
      ),
    "42501",
    "authenticated reservation revision read",
  );

  await db.exec("reset role");
  await expectDatabaseError(
    () =>
      db.query(
        `update public.reservation_revisions
          set reason = 'Tampered revision reason' where id = $1::uuid`,
        [modifiedLifecycle.revisionId],
      ),
    "55000",
    "reservation revision update",
  );
  await expectDatabaseError(
    () =>
      db.query("delete from public.reservation_revisions where id = $1::uuid", [
        modifiedLifecycle.revisionId,
      ]),
    "55000",
    "reservation revision delete",
  );
  const lifecycleEvidence = (
    await db.query(
      `select
        (select version from public.reservations where id = $1::uuid) version,
        (select status from public.reservations where id = $1::uuid) status,
        (select cancellation_reason from public.reservations
          where id = $1::uuid) cancellation_reason,
        (select count(*) from public.reservation_revisions
          where reservation_id = $1::uuid) revision_count,
        (select count(*) from private.operation_requests
          where request_id in ($2::uuid, $3::uuid)
            and completed_at is not null) completed_requests,
        (select count(*) from private.operation_requests
          where request_id = any($4::uuid[])) rejected_request_rows,
        (select count(*) from public.reservation_table_allocations
          where reservation_id = $1::uuid and is_active) active_allocations,
        (select count(*) from public.reservation_events
          where reservation_id = $1::uuid
            and event_type in ('staff_modified', 'staff_cancelled')) lifecycle_events`,
      [
        ids.lifecycleReservation,
        ids.lifecycleModifyRequest,
        ids.lifecycleCancelRequest,
        [
          ids.lifecycleStaleRequest,
          ids.lifecycleUnauthorizedRequest,
          ids.lifecycleCrossLocationRequest,
          ids.lifecycleLegacyUpdateRequest,
          ids.lifecycleLegacyCancelRequest,
          ids.lifecycleMissingModifyRequest,
          ids.lifecycleMissingCancelRequest,
        ],
      ],
    )
  ).rows[0];
  const lifecycleRevisions = (
    await db.query(
      `select mutation_kind, operation_kind, actor_id, version, reason, payload_hash,
        before_state, after_state, service_shift_id, service_shift_evidence,
        policy_hash, policy_evidence, allocation_evidence, result_evidence
      from public.reservation_revisions
      where reservation_id = $1::uuid order by version`,
      [ids.lifecycleReservation],
    )
  ).rows;
  if (
    lifecycleEvidence.version !== 3 ||
    lifecycleEvidence.status !== "cancelled" ||
    lifecycleEvidence.cancellation_reason !== "Guest called to cancel dinner" ||
    Number(lifecycleEvidence.revision_count) !== 2 ||
    Number(lifecycleEvidence.completed_requests) !== 2 ||
    Number(lifecycleEvidence.rejected_request_rows) !== 0 ||
    Number(lifecycleEvidence.active_allocations) !== 0 ||
    Number(lifecycleEvidence.lifecycle_events) !== 2 ||
    lifecycleRevisions.length !== 2 ||
    lifecycleRevisions[0].mutation_kind !== "staff_modified" ||
    lifecycleRevisions[0].operation_kind !== "reservation.modify" ||
    lifecycleRevisions[0].version !== 2 ||
    lifecycleRevisions[0].actor_id !== ids.owner ||
    lifecycleRevisions[0].before_state.version !== 1 ||
    lifecycleRevisions[0].after_state.version !== 2 ||
    lifecycleRevisions[1].mutation_kind !== "staff_cancelled" ||
    lifecycleRevisions[1].operation_kind !== "reservation.cancel" ||
    lifecycleRevisions[1].version !== 3 ||
    lifecycleRevisions[1].before_state.version !== 2 ||
    lifecycleRevisions[1].after_state.version !== 3 ||
    lifecycleRevisions.some(
      (revision) =>
        !/^[0-9a-f]{64}$/.test(revision.payload_hash) ||
        !revision.service_shift_id ||
        !/^[0-9a-f]{64}$/.test(revision.policy_hash) ||
        Object.keys(revision.service_shift_evidence).length === 0 ||
        Object.keys(revision.policy_evidence).length === 0 ||
        Object.keys(revision.allocation_evidence).length === 0 ||
        Object.keys(revision.result_evidence).length === 0,
    )
  ) {
    throw new Error(
      `Staff lifecycle evidence is incomplete: ${JSON.stringify({ lifecycleEvidence, lifecycleRevisions })}`,
    );
  }

  const revisionIntegrityCatalog = (
    await db.query(
      `select
        count(*) constraint_count,
        bool_and(constraint_row.contype in ('c', 'f')) expected_types,
        (select attribute.attgenerated = 's'
          from pg_attribute attribute
          where attribute.attrelid = 'public.reservation_revisions'::regclass
            and attribute.attname = 'operation_kind') operation_kind_generated
      from pg_constraint constraint_row
      where constraint_row.conrelid = 'public.reservation_revisions'::regclass
        and constraint_row.conname = any($1::text[])`,
      [
        [
          "reservation_revisions_operation_kind_check",
          "reservation_revisions_operation_evidence_fkey",
          "reservation_revisions_version_chain_check",
          "reservation_revisions_mutation_state_check",
          "reservation_revisions_result_identity_check",
        ],
      ],
    )
  ).rows[0];
  if (
    Number(revisionIntegrityCatalog.constraint_count) !== 5 ||
    !revisionIntegrityCatalog.expected_types ||
    !revisionIntegrityCatalog.operation_kind_generated
  ) {
    throw new Error(
      `Reservation revision integrity catalog is incomplete: ${JSON.stringify(revisionIntegrityCatalog)}`,
    );
  }

  const invalidRevisionPayloadHash = "ab".repeat(32);
  await db.query(
    `insert into private.operation_requests (
      request_id, operation_kind, organization_id, location_id,
      record_id, actor_id, payload_hash, completed_at
    ) values (
      $1::uuid, 'reservation.modify', $2::uuid, $3::uuid,
      $4::uuid, $5::uuid, $6::text, clock_timestamp()
    )`,
    [
      ids.lifecycleInvalidRevisionRequest,
      ids.organization,
      ids.location,
      ids.lifecycleReservation,
      ids.owner,
      invalidRevisionPayloadHash,
    ],
  );
  await expectDatabaseError(
    () =>
      db.query(
        `insert into public.reservation_revisions (
          id, organization_id, location_id, reservation_id, request_id, actor_id,
          version, mutation_kind, reason, payload_hash,
          before_state, after_state, result_evidence
        ) values (
          $7::uuid, $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
          4, 'staff_modified', 'Attempted malformed revision evidence', $6::text,
          '{"version":1,"status":"booked"}'::jsonb,
          '{"version":4,"status":"booked"}'::jsonb,
          jsonb_build_object(
            'id', $3::uuid, 'revisionId', $7::uuid,
            'version', 4, 'revisionKind', 'staff_modified',
            'status', 'booked'
          )
        )`,
        [
          ids.organization,
          ids.location,
          ids.lifecycleReservation,
          ids.lifecycleInvalidRevisionRequest,
          ids.owner,
          invalidRevisionPayloadHash,
          ids.lifecycleInvalidRevision,
        ],
      ),
    "23514",
    "malformed reservation revision version chain",
  );
  await db.query(
    "delete from private.operation_requests where request_id = $1::uuid",
    [ids.lifecycleInvalidRevisionRequest],
  );

  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  const lifecycleHostRow = (
    await db.query(
      `select * from public.service_reservation_host_snapshot(
        $1::uuid, $2::uuid,
        $3::timestamptz - interval '1 hour',
        $3::timestamptz + interval '1 hour'
      ) where id = $4::uuid`,
      [
        ids.organization,
        ids.location,
        lifecycleMovedTime,
        ids.lifecycleReservation,
      ],
    )
  ).rows[0];
  if (
    !lifecycleHostRow ||
    lifecycleHostRow.version !== 3 ||
    lifecycleHostRow.status !== "cancelled" ||
    !lifecycleHostRow.policy_evidence_captured ||
    lifecycleHostRow.last_revision?.id !== cancelledLifecycle.revisionId ||
    lifecycleHostRow.last_revision?.kind !== "staff_cancelled" ||
    lifecycleHostRow.last_revision?.version !== 3 ||
    lifecycleHostRow.last_revision?.previousPartySize !== 3
  ) {
    throw new Error(
      `Host lifecycle projection is incomplete: ${JSON.stringify(lifecycleHostRow)}`,
    );
  }

  await db.query(
    "select public.set_reservation_table_status($1::uuid, $2::uuid, 'blocked', 'Maintenance check', null)",
    ["d6100000-0000-4000-8000-000000000001", ids.table],
  );
  const atomicTime = (
    await db.query("select clock_timestamp() + interval '30 hours' as value")
  ).rows[0].value;
  await expectDatabaseError(
    () =>
      db.query(
        `select public.save_reservation_with_guest(
          $1::uuid, $2::uuid, 'Atomic Guest', 'atomic@example.invalid',
          '+12125550122', $3::timestamptz, 90, 2, null, 'manual',
          array[$4::uuid]
        )`,
        [ids.atomicRequest, ids.location, atomicTime, ids.table],
      ),
    "23514",
    "blocked table assignment",
  );
  const orphanCount = Number(
    (
      await db.query(
        "select count(*) as count from public.guests where id = $1::uuid",
        [ids.atomicRequest],
      )
    ).rows[0].count,
  );
  if (orphanCount !== 0)
    throw new Error("Failed atomic booking left an orphan guest");
  await db.query(
    "select public.set_reservation_table_status($1::uuid, $2::uuid, 'available', 'Ready for service', null)",
    ["d6100000-0000-4000-8000-000000000002", ids.table],
  );
  const atomicSaved = (
    await db.query(
      `select public.save_reservation_with_guest(
        $1::uuid, $2::uuid, 'Atomic Guest', 'atomic@example.invalid',
        '+12125550122', $3::timestamptz, 90, 2, null, 'manual',
        array[$4::uuid]
      ) as result`,
      [ids.atomicRequest, ids.location, atomicTime, ids.table],
    )
  ).rows[0].result;
  if (atomicSaved.guestId !== ids.atomicRequest || atomicSaved.replayed)
    throw new Error(
      `Atomic staff booking failed: ${JSON.stringify(atomicSaved)}`,
    );
  const atomicReplay = (
    await db.query(
      `select public.save_reservation_with_guest(
        $1::uuid, $2::uuid, 'Atomic Guest', 'atomic@example.invalid',
        '+12125550122', $3::timestamptz, 90, 2, null, 'manual',
        array[$4::uuid]
      ) as result`,
      [ids.atomicRequest, ids.location, atomicTime, ids.table],
    )
  ).rows[0].result;
  if (!atomicReplay.replayed)
    throw new Error("Atomic staff booking did not replay exactly");

  await db.exec("reset role");
  const atomicGuestScope = (
    await db.query(
      `select
        (select count(*) from public.guests guest
          where guest.organization_id = $1::uuid
            and lower(guest.email) = 'atomic@example.invalid'
            and guest.merged_into_id is null) organization_profiles,
        (select count(*) from public.guest_locations guest_location
          where guest_location.organization_id = $1::uuid
            and guest_location.location_id = $2::uuid
            and guest_location.guest_id = $3::uuid) local_links`,
      [ids.organization, ids.location, ids.atomicRequest],
    )
  ).rows[0];
  if (
    Number(atomicGuestScope.organization_profiles) !== 1 ||
    Number(atomicGuestScope.local_links) !== 1
  ) {
    throw new Error(
      `Staff reservation did not create one location-linked identity: ${JSON.stringify(atomicGuestScope)}`,
    );
  }

  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  await db.query(
    `select public.save_waitlist_entry_v2(
      $1::uuid, $2::uuid, null::uuid, 'Atomic Guest',
      'ATOMIC@example.invalid', '1 (212) 555-0122', 2,
      null::timestamptz, null::timestamptz, 10, null
    )`,
    [ids.matchedIdentityWaitlist, ids.location],
  );
  await db.exec("reset role");
  const matchedWaitlistGuestId = (
    await db.query(
      "select guest_id from public.waitlist_entries where id = $1::uuid",
      [ids.matchedIdentityWaitlist],
    )
  ).rows[0].guest_id;
  const atomicProfileCountAfterWaitlist = Number(
    (
      await db.query(
        `select count(*) count
        from public.guests guest
        join public.guest_locations guest_location
          on guest_location.organization_id = guest.organization_id
         and guest_location.guest_id = guest.id
        where guest.organization_id = $1::uuid
          and guest_location.location_id = $2::uuid
          and lower(guest.email) = 'atomic@example.invalid'
          and guest.merged_into_id is null`,
        [ids.organization, ids.location],
      )
    ).rows[0].count,
  );
  if (
    matchedWaitlistGuestId !== ids.atomicRequest ||
    atomicProfileCountAfterWaitlist !== 1
  ) {
    throw new Error(
      `Reservation/waitlist identity resolution diverged: ${JSON.stringify({ matchedWaitlistGuestId, atomicProfileCountAfterWaitlist })}`,
    );
  }

  const mergeReplayTime = new Date(
    new Date(atomicTime).valueOf() + 40 * 86_400_000,
  ).toISOString();
  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  const mergeReplayCreate = (
    await db.query(
      `select public.save_reservation_with_guest(
        $1::uuid, $2::uuid, 'Merge Replay Source',
        'merge.replay.source@example.invalid', '+12125550981',
        $3::timestamptz, 90, 2, 'Immutable replay payload', 'manual',
        array[]::uuid[]
      ) result`,
      [ids.mergeReplayRequest, ids.location, mergeReplayTime],
    )
  ).rows[0].result;
  if (
    mergeReplayCreate.id !== ids.mergeReplayRequest ||
    mergeReplayCreate.guestId !== ids.mergeReplayRequest ||
    mergeReplayCreate.replayed
  ) {
    throw new Error(
      `Merge-replay reservation create failed: ${JSON.stringify(mergeReplayCreate)}`,
    );
  }
  await expectDatabaseError(
    () =>
      db.query(
        `select public.save_reservation_with_guest(
          $1::uuid, $2::uuid, 'Merge Replay Source',
          'changed-contact@example.invalid', '+12125550981',
          $3::timestamptz, 90, 2, 'Immutable replay payload', 'manual',
          array[]::uuid[]
        )`,
        [ids.mergeReplayRequest, ids.location, mergeReplayTime],
      ),
    "23505",
    "save-with-guest changed-contact replay",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select public.save_waitlist_entry_v2(
          $1::uuid, $2::uuid, null::uuid, 'Reservation collision',
          'reservation.collision@example.invalid', '+12125550982', 2,
          null::timestamptz, null::timestamptz, 10, null
        )`,
        [ids.mergeReplayRequest, ids.location],
      ),
    "23505",
    "reservation request reused for waitlist",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select public.save_reservation_with_guest(
          $1::uuid, $2::uuid, 'Waitlist collision',
          'waitlist.collision@example.invalid', '+12125550983',
          $3::timestamptz, 90, 2, null, 'manual', array[]::uuid[]
        )`,
        [ids.matchedIdentityWaitlist, ids.location, mergeReplayTime],
      ),
    "23505",
    "waitlist request reused for reservation",
  );

  await db.exec("reset role");
  await db.query(
    `insert into public.guests (
      id, organization_id, display_name, email, phone, source,
      external_references
    ) values (
      $1::uuid, $2::uuid, 'Merge Replay Target',
      'merge.replay.target@example.invalid', '+12125550984', 'manual',
      '{}'::jsonb
    )`,
    [ids.mergeReplayTargetGuest, ids.organization],
  );
  await db.query(
    `insert into public.guest_locations (
      id, organization_id, guest_id, location_id, is_home_location
    ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, false)`,
    [
      ids.mergeReplayTargetGuestLocation,
      ids.organization,
      ids.mergeReplayTargetGuest,
      ids.location,
    ],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  await db.query(
    `select * from public.service_merge_guests(
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
      1, '["reservation-replay"]'::jsonb
    )`,
    [
      ids.mergeReplayMergeRequest,
      ids.organization,
      ids.location,
      ids.mergeReplayRequest,
      ids.mergeReplayTargetGuest,
    ],
  );
  const mergeReplayResult = (
    await db.query(
      `select public.save_reservation_with_guest(
        $1::uuid, $2::uuid, 'Merge Replay Source',
        'merge.replay.source@example.invalid', '+12125550981',
        $3::timestamptz, 90, 2, 'Immutable replay payload', 'manual',
        array[]::uuid[]
      ) result`,
      [ids.mergeReplayRequest, ids.location, mergeReplayTime],
    )
  ).rows[0].result;
  if (
    mergeReplayResult.id !== ids.mergeReplayRequest ||
    mergeReplayResult.guestId !== ids.mergeReplayTargetGuest ||
    !mergeReplayResult.replayed
  ) {
    throw new Error(
      `Merged reservation did not replay through its active guest target: ${JSON.stringify(mergeReplayResult)}`,
    );
  }
  await db.exec("reset role");
  const mergeReplayEvidence = (
    await db.query(
      `select
        (select guest_id from public.reservations
          where organization_id = $1::uuid and id = $2::uuid) reservation_guest,
        (select merged_into_id from public.guests
          where organization_id = $1::uuid and id = $2::uuid) source_merged_into,
        (select count(*) from private.operation_requests
          where request_id = $2::uuid
            and operation_kind = 'reservation.save-with-guest'
            and completed_at is not null) parent_claims,
        (select count(*) from private.operation_requests
          where organization_id = $1::uuid and location_id = $3::uuid
            and record_id = $2::uuid and request_id <> $2::uuid
            and operation_kind = 'reservation.save'
            and completed_at is not null) child_claims`,
      [ids.organization, ids.mergeReplayRequest, ids.location],
    )
  ).rows[0];
  if (
    mergeReplayEvidence.reservation_guest !== ids.mergeReplayTargetGuest ||
    mergeReplayEvidence.source_merged_into !== ids.mergeReplayTargetGuest ||
    Number(mergeReplayEvidence.parent_claims) !== 1 ||
    Number(mergeReplayEvidence.child_claims) !== 1
  ) {
    throw new Error(
      `Save-with-guest replay evidence is incomplete: ${JSON.stringify(mergeReplayEvidence)}`,
    );
  }

  const existingReservationCollisionTime = new Date(
    new Date(atomicTime).valueOf() + 50 * 86_400_000,
  ).toISOString();
  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  await db.query(
    `select public.save_reservation(
      $1::uuid, $2::uuid, $3::uuid, null::uuid, $4::timestamptz,
      90, 2, null, 'manual', array[]::uuid[]
    )`,
    [
      ids.existingReservationCreationRequest,
      ids.location,
      ids.existingReservationCollision,
      existingReservationCollisionTime,
    ],
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select public.save_reservation_with_guest(
          $1::uuid, $2::uuid, 'Existing reservation collision',
          'existing.reservation.collision@example.invalid', '+12125550985',
          $3::timestamptz, 90, 2, null, 'manual', array[]::uuid[]
        )`,
        [
          ids.existingReservationCollision,
          ids.location,
          existingReservationCollisionTime,
        ],
      ),
    "23505",
    "save-with-guest existing reservation without parent claim",
  );
  await db.exec("reset role");
  const existingReservationCollisionEvidence = (
    await db.query(
      `select
        (select count(*) from public.reservations reservation
          where reservation.id = $1::uuid and reservation.guest_id is null
            and reservation.version = 1) unchanged_reservations,
        (select count(*) from private.operation_requests request
          where request.request_id = $1::uuid) wrapper_claims,
        (select count(*) from public.guests guest
          where guest.id = $1::uuid) collision_guests`,
      [ids.existingReservationCollision],
    )
  ).rows[0];
  if (
    Number(existingReservationCollisionEvidence.unchanged_reservations) !== 1 ||
    Number(existingReservationCollisionEvidence.wrapper_claims) !== 0 ||
    Number(existingReservationCollisionEvidence.collision_guests) !== 0
  ) {
    throw new Error(
      `Existing reservation collision was not transactional: ${JSON.stringify(existingReservationCollisionEvidence)}`,
    );
  }

  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  const reminderTime = (
    await db.query("select clock_timestamp() + interval '90 minutes' as value")
  ).rows[0].value;
  await db.query(
    `select public.save_reservation_with_guest(
      $1::uuid, $2::uuid, 'Reminder Guest', 'reminder@example.invalid',
      '+12125550123', $3::timestamptz, 90, 2, null, 'phone', array[]::uuid[]
    )`,
    [ids.reminderRequest, ids.location, reminderTime],
  );

  await db.exec("reset role");
  const publicIdentityCollisionTime = (
    await db.query(
      `select (
        date_trunc('day', clock_timestamp() at time zone 'America/New_York')
        + interval '15 days 19 hours'
      ) at time zone 'America/New_York' value`,
    )
  ).rows[0].value;
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const publicIdentityCollisionHold = (
    await db.query(
      `select public.service_create_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, 120, 2,
        'Collision', 'Victim', 'hold.collision.victim@example.invalid',
        '+12125550986', null, array[$5::uuid], array['email']::text[]
      ) result`,
      [
        ids.publicIdentityCollisionRequest,
        ids.organization,
        ids.location,
        publicIdentityCollisionTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  await db.exec("reset role");
  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  await expectDatabaseError(
    () =>
      db.query(
        `select public.save_reservation_with_guest(
          $1::uuid, $2::uuid, 'Collision Attacker',
          'hold.collision.attacker@example.invalid', '+12125550987',
          $3::timestamptz, 90, 2, null, 'manual', array[]::uuid[]
        )`,
        [
          publicIdentityCollisionHold.holdId,
          ids.location,
          publicIdentityCollisionTime,
        ],
      ),
    "23505",
    "staff reservation reuse of an opaque booking-hold id",
  );
  await db.exec("reset role");
  const publicIdentityPreconfirmationEvidence = (
    await db.query(
      `select
        (select status from private.public_booking_holds hold
          where hold.id = $1::uuid) hold_status,
        (select count(*) from public.reservations reservation
          where reservation.id = $1::uuid) collision_reservations,
        (select count(*) from public.guests guest
          where guest.id = $1::uuid) collision_guests,
        (select count(*) from private.operation_requests request
          where request.request_id = $1::uuid) wrapper_claims`,
      [publicIdentityCollisionHold.holdId],
    )
  ).rows[0];
  if (
    publicIdentityPreconfirmationEvidence.hold_status !== "pending" ||
    Number(publicIdentityPreconfirmationEvidence.collision_reservations) !==
      0 ||
    Number(publicIdentityPreconfirmationEvidence.collision_guests) !== 0 ||
    Number(publicIdentityPreconfirmationEvidence.wrapper_claims) !== 0
  ) {
    throw new Error(
      `Staff hold-id collision did not roll back cleanly: ${JSON.stringify(publicIdentityPreconfirmationEvidence)}`,
    );
  }
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const publicIdentityCollisionConfirmed = (
    await db.query(
      `select public.service_confirm_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::text,
        'email', array['email']::text[]
      ) result`,
      [
        ids.organization,
        ids.location,
        publicIdentityCollisionHold.holdId,
        "3".repeat(64),
      ],
    )
  ).rows[0].result;
  await db.exec("reset role");
  const publicIdentityCollisionEvidence = (
    await db.query(
      `select reservation.guest_id, guest.email, guest.phone,
        (select status from private.public_booking_holds hold
          where hold.id = $1::uuid) hold_status,
        (select count(*) from public.guests collision_guest
          where collision_guest.id = $1::uuid) hold_id_guest_rows
      from public.reservations reservation
      join public.guests guest
        on guest.organization_id = reservation.organization_id
       and guest.id = reservation.guest_id
      where reservation.id = $2::uuid`,
      [
        publicIdentityCollisionHold.holdId,
        publicIdentityCollisionConfirmed.reservationId,
      ],
    )
  ).rows[0];
  if (
    publicIdentityCollisionConfirmed.status !== "booked" ||
    publicIdentityCollisionEvidence.guest_id ===
      publicIdentityCollisionHold.holdId ||
    publicIdentityCollisionEvidence.email !==
      "hold.collision.victim@example.invalid" ||
    publicIdentityCollisionEvidence.phone !== null ||
    publicIdentityCollisionEvidence.hold_status !== "verified" ||
    Number(publicIdentityCollisionEvidence.hold_id_guest_rows) !== 0
  ) {
    throw new Error(
      `Public confirmation did not isolate its transaction-local guest identity: ${JSON.stringify({ publicIdentityCollisionConfirmed, publicIdentityCollisionEvidence })}`,
    );
  }
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const firstLimit = (
    await db.query(
      "select public.service_claim_booking_rate_limit($1::text, 2, 60) as result",
      ["c".repeat(64)],
    )
  ).rows[0].result;
  const secondLimit = (
    await db.query(
      "select public.service_claim_booking_rate_limit($1::text, 2, 60) as result",
      ["c".repeat(64)],
    )
  ).rows[0].result;
  const deniedLimit = (
    await db.query(
      "select public.service_claim_booking_rate_limit($1::text, 2, 60) as result",
      ["c".repeat(64)],
    )
  ).rows[0].result;
  if (!firstLimit.allowed || !secondLimit.allowed || deniedLimit.allowed)
    throw new Error(
      "Database-backed booking rate limit did not enforce its window",
    );

  const reminderQueued = Number(
    (
      await db.query(
        "select public.service_enqueue_reservation_reminders(clock_timestamp()) as count",
      )
    ).rows[0].count,
  );
  const reminderReplay = Number(
    (
      await db.query(
        "select public.service_enqueue_reservation_reminders(clock_timestamp()) as count",
      )
    ).rows[0].count,
  );
  if (reminderQueued !== 0 || reminderReplay !== 0)
    throw new Error(
      `Unverified staff reminder scheduling did not fail closed: ${reminderQueued}/${reminderReplay}`,
    );
  const publicTime = (
    await db.query(
      `select (
        date_trunc('day', clock_timestamp() at time zone 'America/New_York')
        + interval '3 days 19 hours'
      ) at time zone 'America/New_York' as value`,
    )
  ).rows[0].value;
  await db.exec("reset role");
  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  await db.query(
    `select public.save_reservation(
      $1::uuid, $2::uuid, null::uuid, null::uuid, $3::timestamptz,
      120, 10, 'Pacing boundary fixture', 'phone', array[]::uuid[]
    )`,
    [ids.pacingReservation, ids.location, publicTime],
  );
  await db.exec("reset role");

  await expectDatabaseError(
    () =>
      db.query(
        "select private.assert_reservation_pacing($1::uuid, $2::uuid, $3::timestamptz, 1, null, null)",
        [ids.organization, ids.location, publicTime],
      ),
    "23514",
    "party below service-period minimum",
  );
  await expectDatabaseError(
    () =>
      db.query(
        "select private.assert_reservation_pacing($1::uuid, $2::uuid, $3::timestamptz, 7, null, null)",
        [ids.organization, ids.location, publicTime],
      ),
    "23514",
    "party above service-period maximum",
  );

  await db.query(
    `
    insert into public.reservation_turn_rules (
      organization_id, service_period_id, min_party_size,
      max_party_size, duration_minutes
    ) values ($1::uuid, $2::uuid, 3, 3, 90)
  `,
    [ids.organization, ids.period],
  );
  await db.query(
    "select private.assert_public_reservation_slot_contract($1::uuid, $2::uuid, $3::timestamptz, 90, 3)",
    [ids.organization, ids.location, publicTime],
  );
  await expectDatabaseError(
    () =>
      db.query(
        "select private.assert_public_reservation_slot_contract($1::uuid, $2::uuid, $3::timestamptz, 120, 3)",
        [ids.organization, ids.location, publicTime],
      ),
    "23514",
    "stale duration against party turn rule",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `
      insert into public.reservation_turn_rules (
        organization_id, service_period_id, min_party_size,
        max_party_size, duration_minutes
      ) values ($1::uuid, $2::uuid, 2, 4, 105)
    `,
        [ids.organization, ids.period],
      ),
    "23P01",
    "overlapping party turn rules",
  );
  await expectDatabaseError(
    () =>
      db.query(
        "select private.assert_public_reservation_slot_contract($1::uuid, $2::uuid, $3::timestamptz + interval '3 hours', 120, 2)",
        [ids.organization, ids.location, publicTime],
      ),
    "23514",
    "turn duration extending past service end",
  );

  // A signed slot is only a short-lived proposal. A subsequent policy edit
  // must make the stale duration fail at the database boundary.
  await db.query(
    "select private.assert_public_reservation_slot_contract($1::uuid, $2::uuid, $3::timestamptz, 120, 2)",
    [ids.organization, ids.location, publicTime],
  );
  await db.query(
    "update public.reservation_service_periods set default_duration_minutes = 105 where id = $1::uuid",
    [ids.period],
  );
  await expectDatabaseError(
    () =>
      db.query(
        "select private.assert_public_reservation_slot_contract($1::uuid, $2::uuid, $3::timestamptz, 120, 2)",
        [ids.organization, ids.location, publicTime],
      ),
    "23514",
    "slot signed before service-policy edit",
  );
  await db.query(
    "update public.reservation_service_periods set default_duration_minutes = 120 where id = $1::uuid",
    [ids.period],
  );

  await db.exec("reset role");
  await db.query(
    `insert into public.guests (
      id, organization_id, display_name, email, phone, source,
      external_references
    ) values (
      $1::uuid, $2::uuid, 'Other-location Jamie',
      'jamie.reservation@example.invalid', '+12125550970', 'manual',
      '{}'::jsonb
    )`,
    [ids.crossLocationIdentityGuest, ids.organization],
  );
  await db.query(
    `insert into public.guest_locations (
      id, organization_id, guest_id, location_id, is_home_location
    ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, true)`,
    [
      ids.crossLocationIdentityGuestLocation,
      ids.organization,
      ids.crossLocationIdentityGuest,
      ids.otherLocation,
    ],
  );

  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  await expectDatabaseError(
    () =>
      db.query(
        `select public.save_waitlist_entry_v2(
          $1::uuid, $2::uuid, $3::uuid, 'Remote identifier probe',
          'jamie.reservation@example.invalid', '+12125550970', 2,
          null::timestamptz, null::timestamptz, 10, null
        )`,
        [
          ids.crossLocationIdentityWaitlist,
          ids.location,
          ids.crossLocationIdentityGuest,
        ],
      ),
    "P0002",
    "explicit other-location guest attachment",
  );

  await db.exec("reset role");
  await db.exec("begin");
  await db.query(
    `insert into public.guests (
      id, organization_id, display_name, email, phone, source,
      external_references
    ) values
      ($1::uuid, $3::uuid, 'Ambiguous Email',
        'ambiguous.identity@example.invalid', null, 'manual', '{}'::jsonb),
      ($2::uuid, $3::uuid, 'Ambiguous Phone',
        null, '+12125550971', 'manual', '{}'::jsonb)`,
    [ids.ambiguousEmailGuest, ids.ambiguousPhoneGuest, ids.organization],
  );
  await db.query(
    `insert into public.guest_locations (
      id, organization_id, guest_id, location_id, is_home_location
    ) values
      ($1::uuid, $3::uuid, $4::uuid, $5::uuid, false),
      ($2::uuid, $3::uuid, $6::uuid, $5::uuid, false)`,
    [
      ids.ambiguousEmailGuestLocation,
      ids.ambiguousPhoneGuestLocation,
      ids.organization,
      ids.ambiguousEmailGuest,
      ids.location,
      ids.ambiguousPhoneGuest,
    ],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  await expectDatabaseError(
    () =>
      db.query(
        `select public.save_waitlist_entry_v2(
          $1::uuid, $2::uuid, null::uuid, 'Ambiguous Identity',
          'ambiguous.identity@example.invalid', '+12125550971', 2,
          null::timestamptz, null::timestamptz, 10, null
        )`,
        [ids.ambiguousIdentityWaitlist, ids.location],
      ),
    "23505",
    "ambiguous local guest identity",
  );
  await db.exec("rollback");
  await db.exec("reset role");

  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const confirmationFingerprint = "a".repeat(64);
  const exchangeFingerprint = "d".repeat(64);
  const manageHash = "b".repeat(64);
  const browserBindingHash = "6".repeat(64);
  const unavailableAdapterRequest = "d5000000-0000-4000-8000-000000000099";
  await db.exec("reset role");
  await db.query(
    "update public.reservation_settings set verification_channels = array['email']::text[] where organization_id = $1::uuid and location_id = $2::uuid",
    [ids.organization, ids.location],
  );
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await expectDatabaseError(
    () =>
      db.query(
        `select public.service_create_public_reservation(
          $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, 120, 2,
          'Unavailable', 'Adapter', 'unavailable@example.invalid', '+12125550999',
          null, array[$5::uuid], array['sms']::text[]
        )`,
        [
          unavailableAdapterRequest,
          ids.organization,
          ids.location,
          publicTime,
          ids.otherTable,
        ],
      ),
    "55000",
    "public create without an effective verification adapter",
  );
  await db.exec("reset role");
  const unavailableHoldCount = Number(
    (
      await db.query(
        "select count(*) count from private.public_booking_requests where request_id = $1::uuid",
        [unavailableAdapterRequest],
      )
    ).rows[0].count,
  );
  if (unavailableHoldCount !== 0)
    throw new Error(
      "Failed delivery precondition left a provisional booking record",
    );
  await db.query(
    "update public.reservation_settings set verification_channels = array['email','sms']::text[] where organization_id = $1::uuid and location_id = $2::uuid",
    [ids.organization, ids.location],
  );
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const publicReservation = (
    await db.query(
      `select public.service_create_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, 120, 2,
        'Jamie', 'Guest', 'jamie.reservation@example.invalid', '+12125550145',
        'Anniversary', array[$5::uuid], array['email','sms']::text[]
      ) as result`,
      [
        ids.publicRequest,
        ids.organization,
        ids.location,
        publicTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  if (
    !publicReservation.holdId ||
    publicReservation.deliveryState.email !== "queued" ||
    publicReservation.deliveryState.sms !== "queued"
  ) {
    throw new Error(
      `Public hold was not created: ${JSON.stringify(publicReservation)}`,
    );
  }
  const pacingSnapshot = (
    await db.query(
      `select * from public.service_reservation_pacing_snapshot(
        $1::uuid, $2::uuid, $3::timestamptz - interval '1 hour',
        $3::timestamptz + interval '1 hour'
      )`,
      [ids.organization, ids.location, publicTime],
    )
  ).rows;
  if (
    pacingSnapshot.filter((row) => row.kind === "reservation").length !== 1 ||
    pacingSnapshot.filter((row) => row.kind === "hold").length !== 1 ||
    pacingSnapshot.reduce((sum, row) => sum + Number(row.partySize), 0) !== 12
  ) {
    throw new Error(
      `Pacing snapshot did not expose committed plus live provisional covers: ${JSON.stringify(pacingSnapshot)}`,
    );
  }
  await db.exec("reset role");
  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  const hostCapacitySnapshot = (
    await db.query(
      `select * from public.reservation_capacity_snapshot(
        $1::uuid, $2::uuid, $3::timestamptz - interval '1 hour',
        $3::timestamptz + interval '1 hour'
      )`,
      [ids.organization, ids.location, publicTime],
    )
  ).rows;
  if (
    hostCapacitySnapshot.filter((row) => row.kind === "reservation").length !==
      1 ||
    hostCapacitySnapshot.filter((row) => row.kind === "hold").length !== 1 ||
    hostCapacitySnapshot.reduce(
      (sum, row) => sum + Number(row.partySize),
      0,
    ) !== 12
  ) {
    throw new Error(
      `Host-safe capacity snapshot diverged from DB pacing: ${JSON.stringify(hostCapacitySnapshot)}`,
    );
  }
  await assumeUser(ids.employee);
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.reservation_capacity_snapshot(
        $1::uuid, $2::uuid, $3::timestamptz - interval '1 hour',
        $3::timestamptz + interval '1 hour'
      )`,
        [ids.organization, ids.location, publicTime],
      ),
    "42501",
    "capacity snapshot without a reservation capability",
  );
  await db.exec("reset role");
  const publicReservationIdBeforeVerify = Number(
    (
      await db.query(
        "select count(*) as count from public.reservations where public_code = (select public_code from private.public_booking_holds where id = $1::uuid)",
        [publicReservation.holdId],
      )
    ).rows[0].count,
  );
  const provisionalGuestCount = Number(
    (
      await db.query(
        `select count(*) as count
        from public.guests guest
        join public.guest_locations guest_location
          on guest_location.organization_id = guest.organization_id
         and guest_location.guest_id = guest.id
        where guest.organization_id = $1::uuid
          and guest_location.location_id = $2::uuid
          and lower(guest.email) = 'jamie.reservation@example.invalid'
          and guest.merged_into_id is null`,
        [ids.organization, ids.location],
      )
    ).rows[0].count,
  );
  if (publicReservationIdBeforeVerify !== 0 || provisionalGuestCount !== 0)
    throw new Error("Unverified booking leaked into reservations or guest CRM");

  await expectDatabaseError(
    () =>
      db.query(
        `insert into public.reservation_table_allocations (
          organization_id, location_id, booking_hold_id, table_id,
          allocation_kind, starts_at, ends_at, expires_at
        ) select organization_id, location_id, id, $2::uuid, 'hold',
          reserved_at + interval '30 minutes',
          reserved_at + interval '90 minutes', expires_at
          from private.public_booking_holds where id = $1::uuid`,
        [publicReservation.holdId, ids.otherTable],
      ),
    "23P01",
    "hard GiST overlap invariant",
  );

  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);

  const claimNow = (await db.query("select clock_timestamp() as value")).rows[0]
    .value;
  const allClaimedMessages = (
    await db.query(
      "select * from public.service_claim_reservation_message_outbox($1::uuid, 20, 30, $2::timestamptz)",
      ["d5200000-0000-4000-8000-000000000001", claimNow],
    )
  ).rows;
  const allBegunMessages = [];
  for (const claim of allClaimedMessages) {
    const begun = (
      await db.query(
        `select public.service_begin_reservation_message_delivery(
          $1::uuid, $2::uuid, $3::timestamptz
        ) result`,
        [claim.id, claim.claimToken, claimNow],
      )
    ).rows[0].result;
    allBegunMessages.push({ ...begun, claimToken: claim.claimToken });
  }
  const claimedMessages = allBegunMessages.filter(
    (message) => message.bookingHoldId === publicReservation.holdId,
  );
  if (
    claimedMessages.length !== 2 ||
    claimedMessages.some(
      (message) =>
        message.bookingHoldId !== publicReservation.holdId ||
        message.recipientEmail !== "jamie.reservation@example.invalid",
    )
  ) {
    throw new Error(
      `Provisional outbox claim was incomplete: ${JSON.stringify(claimedMessages)}`,
    );
  }
  for (const message of allBegunMessages.filter(
    (candidate) => candidate.bookingHoldId !== publicReservation.holdId,
  )) {
    await db.query(
      "select public.service_complete_reservation_message_outbox($1::uuid, $2::uuid, 'sent', null, null, 'provider-other')",
      [message.id, message.claimToken],
    );
  }
  await db.query(
    "select public.service_complete_reservation_message_outbox($1::uuid, $2::uuid, 'sent', null, null, 'provider-1')",
    [claimedMessages[0].id, claimedMessages[0].claimToken],
  );
  const postBeginReclaims = (
    await db.query(
      "select * from public.service_claim_reservation_message_outbox($1::uuid, 20, 30, $2::timestamptz)",
      [
        "d5200000-0000-4000-8000-000000000002",
        new Date(new Date(claimNow).valueOf() + 60_000).toISOString(),
      ],
    )
  ).rows;
  if (postBeginReclaims.some((message) => message.id === claimedMessages[1].id))
    throw new Error("An expired post-begin message was replayed");
  await expectDatabaseError(
    () =>
      db.query(
        "select public.service_complete_reservation_message_outbox($1::uuid, $2::uuid, 'sent', null, null, 'late-worker')",
        [claimedMessages[1].id, claimedMessages[1].claimToken],
      ),
    "P0002",
    "uncertain outbox claim completion",
  );
  await db.exec("reset role");
  const uncertainMessage = (
    await db.query(
      `select status, last_error_code, claim_token
      from public.reservation_message_outbox where id = $1::uuid`,
      [claimedMessages[1].id],
    )
  ).rows[0];
  if (
    uncertainMessage.status !== "uncertain" ||
    uncertainMessage.last_error_code !==
      "provider_outcome_unknown_after_lease" ||
    uncertainMessage.claim_token !== null
  ) {
    throw new Error(
      `Expired post-begin delivery was not made terminally uncertain: ${JSON.stringify(uncertainMessage)}`,
    );
  }
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);

  await expectDatabaseError(
    () =>
      db.query(
        "select public.service_confirm_public_reservation($1::uuid, $2::uuid, $3::uuid, $4::text, 'email', array['sms']::text[])",
        [
          ids.organization,
          ids.location,
          publicReservation.holdId,
          confirmationFingerprint,
        ],
      ),
    "55000",
    "confirmation without its verified delivery adapter",
  );
  await db.exec("reset role");
  await db.query(
    "update public.reservation_settings set online_booking_enabled = false where organization_id = $1::uuid and location_id = $2::uuid",
    [ids.organization, ids.location],
  );
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await expectDatabaseError(
    () =>
      db.query(
        "select public.service_confirm_public_reservation($1::uuid, $2::uuid, $3::uuid, $4::text, 'email', array['email','sms']::text[])",
        [
          ids.organization,
          ids.location,
          publicReservation.holdId,
          confirmationFingerprint,
        ],
      ),
    "55000",
    "confirmation after booking kill switch",
  );
  await db.exec("reset role");
  await db.query(
    "update public.reservation_settings set online_booking_enabled = true where organization_id = $1::uuid and location_id = $2::uuid",
    [ids.organization, ids.location],
  );
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const confirmed = (
    await db.query(
      "select public.service_confirm_public_reservation($1::uuid, $2::uuid, $3::uuid, $4::text, 'email', array['email','sms']::text[]) as result",
      [
        ids.organization,
        ids.location,
        publicReservation.holdId,
        confirmationFingerprint,
      ],
    )
  ).rows[0].result;
  if (confirmed.status !== "booked")
    throw new Error("Public reservation was not confirmed");
  const publicReservationId = confirmed.reservationId;
  const confirmationReplay = (
    await db.query(
      "select public.service_confirm_public_reservation($1::uuid, $2::uuid, $3::uuid, $4::text, 'email', array['email','sms']::text[]) as result",
      [
        ids.organization,
        ids.location,
        publicReservation.holdId,
        confirmationFingerprint,
      ],
    )
  ).rows[0].result;
  if (!confirmationReplay.replayed)
    throw new Error("Public confirmation did not replay exactly");
  await db.exec("reset role");
  const verifiedHoldRedacted = Number(
    (
      await db.query(
        `select count(*) count from private.public_booking_holds
        where id = $1::uuid and status = 'verified' and redacted_at is not null
          and first_name is null and last_name is null and email is null
          and phone is null and special_requests is null`,
        [publicReservation.holdId],
      )
    ).rows[0].count,
  );
  if (verifiedHoldRedacted !== 1)
    throw new Error("Successful confirmation retained provisional hold PII");
  const locationScopedPublicIdentity = (
    await db.query(
      `select
        reservation.guest_id,
        (select count(*) from public.guests guest
          where guest.organization_id = $2::uuid
            and lower(guest.email) = 'jamie.reservation@example.invalid'
            and guest.merged_into_id is null) organization_profiles,
        (select count(*) from public.guest_locations guest_location
          where guest_location.organization_id = $2::uuid
            and guest_location.location_id = $3::uuid
            and guest_location.guest_id = reservation.guest_id) local_links,
        (select count(*) from public.guest_locations guest_location
          where guest_location.organization_id = $2::uuid
            and guest_location.location_id = $3::uuid
            and guest_location.guest_id = $4::uuid) remote_guest_local_links
      from public.reservations reservation
      where reservation.id = $1::uuid`,
      [
        publicReservationId,
        ids.organization,
        ids.location,
        ids.crossLocationIdentityGuest,
      ],
    )
  ).rows[0];
  if (
    locationScopedPublicIdentity.guest_id === ids.crossLocationIdentityGuest ||
    Number(locationScopedPublicIdentity.organization_profiles) !== 2 ||
    Number(locationScopedPublicIdentity.local_links) !== 1 ||
    Number(locationScopedPublicIdentity.remote_guest_local_links) !== 0
  ) {
    throw new Error(
      `Verified public identity escaped exact location scope: ${JSON.stringify(locationScopedPublicIdentity)}`,
    );
  }
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const exchanged = (
    await db.query(
      "select public.service_exchange_reservation_management($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text) as result",
      [
        ids.organization,
        ids.location,
        publicReservationId,
        exchangeFingerprint,
        manageHash,
        browserBindingHash,
      ],
    )
  ).rows[0].result;
  if (exchanged.replayed || !exchanged.manageExpiresAt)
    throw new Error("Management exchange did not create a scoped token");
  const exchangeReplay = (
    await db.query(
      "select public.service_exchange_reservation_management($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text) as result",
      [
        ids.organization,
        ids.location,
        publicReservationId,
        exchangeFingerprint,
        manageHash,
        browserBindingHash,
      ],
    )
  ).rows[0].result;
  if (!exchangeReplay.replayed)
    throw new Error("Exact management exchange retry was not replayed");
  await expectDatabaseError(
    () =>
      db.query(
        "select public.service_exchange_reservation_management($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text)",
        [
          ids.organization,
          ids.location,
          publicReservationId,
          exchangeFingerprint,
          "e".repeat(64),
          browserBindingHash,
        ],
      ),
    "23505",
    "mismatched management exchange retry",
  );
  await expectDatabaseError(
    () =>
      db.query(
        "select public.service_exchange_reservation_management($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text)",
        [
          ids.organization,
          ids.location,
          publicReservationId,
          exchangeFingerprint,
          manageHash,
          "5".repeat(64),
        ],
      ),
    "23505",
    "management exchange from a different browser binding",
  );
  await db.exec("reset role");
  await db.exec(
    "alter table public.reservations disable trigger reservations_public_pacing_guard",
  );
  try {
    await db.query(
      `insert into public.reservations (
        id, organization_id, location_id, reserved_at, duration_minutes,
        party_size, status, source, booking_channel
      ) values (
        $1::uuid, $2::uuid, $3::uuid, clock_timestamp() - interval '2 days',
        60, 2, 'booked', 'le_yard_web', 'web'
      )`,
      [ids.expiredManageReservation, ids.organization, ids.location],
    );
  } finally {
    await db.exec(
      "alter table public.reservations enable trigger reservations_public_pacing_guard",
    );
  }
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await expectDatabaseError(
    () =>
      db.query(
        "select public.service_exchange_reservation_management($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text)",
        [
          ids.organization,
          ids.location,
          ids.expiredManageReservation,
          "4".repeat(64),
          "3".repeat(64),
          browserBindingHash,
        ],
      ),
    "P0002",
    "management exchange whose resulting token is already expired",
  );
  const managed = (
    await db.query(
      "select public.service_get_managed_reservation($1::uuid, $2::uuid, $3::text) as result",
      [ids.organization, ids.location, manageHash],
    )
  ).rows[0].result;
  if (managed.guestName !== "Jamie Guest" || managed.tableLabels[0] !== "T2") {
    throw new Error(
      `Managed reservation view is incomplete: ${JSON.stringify(managed)}`,
    );
  }
  const modifiedTime = new Date(
    new Date(publicTime).valueOf() + 86_400_000,
  ).toISOString();
  const modifyRequest = "d5100000-0000-4000-8000-000000000003";
  const modified = (
    await db.query(
      `select public.service_modify_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz, 120, 2,
        'Anniversary updated', array[$6::uuid]
      ) as result`,
      [
        modifyRequest,
        ids.organization,
        ids.location,
        manageHash,
        modifiedTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  if (
    modified.status !== "booked" ||
    modified.replayed ||
    !modified.manageExpiresAt ||
    new Date(modified.manageExpiresAt).valueOf() <=
      new Date(exchanged.manageExpiresAt).valueOf()
  )
    throw new Error(`Public modification failed: ${JSON.stringify(modified)}`);
  const exchangeReplayAfterModify = (
    await db.query(
      "select public.service_exchange_reservation_management($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text) as result",
      [
        ids.organization,
        ids.location,
        publicReservationId,
        exchangeFingerprint,
        manageHash,
        browserBindingHash,
      ],
    )
  ).rows[0].result;
  if (
    !exchangeReplayAfterModify.replayed ||
    new Date(exchangeReplayAfterModify.manageExpiresAt).valueOf() !==
      new Date(modified.manageExpiresAt).valueOf()
  ) {
    throw new Error(
      `Modified management exchange did not replay its refreshed session: ${JSON.stringify(exchangeReplayAfterModify)}`,
    );
  }
  await expectDatabaseError(
    () =>
      db.query(
        "select public.service_exchange_reservation_management($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text)",
        [
          ids.organization,
          ids.location,
          publicReservationId,
          exchangeFingerprint,
          manageHash,
          "5".repeat(64),
        ],
      ),
    "23505",
    "modified management exchange from a different browser binding",
  );
  const modifyReplay = (
    await db.query(
      `select public.service_modify_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz, 120, 2,
        'Anniversary updated', array[$6::uuid]
      ) as result`,
      [
        modifyRequest,
        ids.organization,
        ids.location,
        manageHash,
        modifiedTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  if (!modifyReplay.replayed)
    throw new Error("Public modification did not replay exactly");
  await db.exec("reset role");
  await db.query(
    "update public.reservation_settings set online_booking_enabled = false where organization_id = $1::uuid and location_id = $2::uuid",
    [ids.organization, ids.location],
  );
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await expectDatabaseError(
    () =>
      db.query(
        `select public.service_modify_public_reservation(
          $1::uuid, $2::uuid, $3::uuid, $4::text,
          $5::timestamptz + interval '1 day', 120, 2, null, array[$6::uuid]
        )`,
        [
          "d5100000-0000-4000-8000-000000000004",
          ids.organization,
          ids.location,
          manageHash,
          modifiedTime,
          ids.otherTable,
        ],
      ),
    "23514",
    "public modification after booking kill switch",
  );
  await db.exec("reset role");
  await db.query(
    "update public.reservation_settings set online_booking_enabled = true where organization_id = $1::uuid and location_id = $2::uuid",
    [ids.organization, ids.location],
  );
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await expectDatabaseError(
    () =>
      db.query(
        `select public.service_modify_public_reservation(
          $1::uuid, $2::uuid, $3::uuid, $4::text,
          clock_timestamp() + interval '31 days', 120, 2, null,
          array[$5::uuid]
        )`,
        [
          "d5100000-0000-4000-8000-000000000005",
          ids.organization,
          ids.location,
          manageHash,
          ids.otherTable,
        ],
      ),
    "23514",
    "public modification outside booking horizon",
  );
  const cancelled = (
    await db.query(
      "select public.service_cancel_public_reservation($1::uuid, $2::uuid, $3::uuid, $4::text, 'Plans changed') as result",
      [
        "d5100000-0000-4000-8000-000000000001",
        ids.organization,
        ids.location,
        manageHash,
      ],
    )
  ).rows[0].result;
  if (cancelled.status !== "cancelled")
    throw new Error("Guest cancellation did not persist");
  const cancellationReplay = (
    await db.query(
      "select public.service_cancel_public_reservation($1::uuid, $2::uuid, $3::uuid, $4::text, 'Plans changed') as result",
      [
        "d5100000-0000-4000-8000-000000000001",
        ids.organization,
        ids.location,
        manageHash,
      ],
    )
  ).rows[0].result;
  if (!cancellationReplay.replayed)
    throw new Error("Guest cancellation did not replay after token revocation");

  const smsInjectionTime = new Date(
    new Date(publicTime).valueOf() + 3 * 86_400_000,
  ).toISOString();
  const smsInjectionHold = (
    await db.query(
      `select public.service_create_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, 120, 2,
        'Injected', 'SMS', 'atomic@example.invalid', '+19995550101',
        null, array[$5::uuid], array['email','sms']::text[]
      ) as result`,
      [
        ids.smsInjectionRequest,
        ids.organization,
        ids.location,
        smsInjectionTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  const smsConfirmed = (
    await db.query(
      "select public.service_confirm_public_reservation($1::uuid, $2::uuid, $3::uuid, $4::text, 'sms', array['email','sms']::text[]) as result",
      [ids.organization, ids.location, smsInjectionHold.holdId, "f".repeat(64)],
    )
  ).rows[0].result;
  await db.exec("reset role");
  const smsIdentity = (
    await db.query(
      `select reservation.guest_id, guest.email, guest.phone,
        (select verified_channel from private.public_booking_verifications
          where booking_hold_id = $1::uuid) verified_channel,
        (select array_agg(channel order by channel)
          from public.reservation_message_outbox
          where reservation_id = reservation.id
            and template_key = 'reservation_confirmed') delivery_channels,
        (select count(*) from public.reservation_message_outbox
          where booking_hold_id = $1::uuid
            and template_key = 'reservation_verify'
            and status in ('queued', 'failed', 'sending')) active_verify_messages
      from public.reservations reservation
      join public.guests guest on guest.organization_id = reservation.organization_id
        and guest.id = reservation.guest_id
      where reservation.id = $2::uuid`,
      [smsInjectionHold.holdId, smsConfirmed.reservationId],
    )
  ).rows[0];
  if (
    smsIdentity.guest_id === ids.atomicRequest ||
    smsIdentity.email !== null ||
    smsIdentity.phone !== "+19995550101" ||
    smsIdentity.verified_channel !== "sms" ||
    JSON.stringify(smsIdentity.delivery_channels) !== JSON.stringify(["sms"]) ||
    Number(smsIdentity.active_verify_messages) !== 0
  ) {
    throw new Error(
      `SMS verification trusted an unproven email: ${JSON.stringify(smsIdentity)}`,
    );
  }
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await expectDatabaseError(
    () =>
      db.query(
        "select public.service_confirm_public_reservation($1::uuid, $2::uuid, $3::uuid, $4::text, 'email', array['email','sms']::text[])",
        [
          ids.organization,
          ids.location,
          smsInjectionHold.holdId,
          "f".repeat(64),
        ],
      ),
    "23505",
    "confirmation replay with a confused channel",
  );

  const smsFormatReplayTime = new Date(
    new Date(publicTime).valueOf() + 5 * 86_400_000,
  ).toISOString();
  const smsFormatReplayHold = (
    await db.query(
      `select public.service_create_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, 120, 2,
        'Same', 'Phone', 'unproven-other@example.invalid', '1 (999) 555-0101',
        null, array[$5::uuid], array['sms']::text[]
      ) as result`,
      [
        ids.smsFormatReplayRequest,
        ids.organization,
        ids.location,
        smsFormatReplayTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  const smsFormatConfirmed = (
    await db.query(
      "select public.service_confirm_public_reservation($1::uuid, $2::uuid, $3::uuid, $4::text, 'sms', array['sms']::text[]) as result",
      [
        ids.organization,
        ids.location,
        smsFormatReplayHold.holdId,
        "7".repeat(64),
      ],
    )
  ).rows[0].result;
  await db.exec("reset role");
  const smsFormatGuestId = (
    await db.query(
      "select guest_id from public.reservations where id = $1::uuid",
      [smsFormatConfirmed.reservationId],
    )
  ).rows[0].guest_id;
  if (smsFormatGuestId !== smsIdentity.guest_id)
    throw new Error(
      "Equivalent SMS phone formats created duplicate CRM identities",
    );
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);

  const emailInjectionTime = new Date(
    new Date(publicTime).valueOf() + 4 * 86_400_000,
  ).toISOString();
  const emailInjectionHold = (
    await db.query(
      `select public.service_create_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, 120, 2,
        'Injected', 'Email', 'verified-new@example.invalid', '+12125550122',
        null, array[$5::uuid], array['email','sms']::text[]
      ) as result`,
      [
        ids.emailInjectionRequest,
        ids.organization,
        ids.location,
        emailInjectionTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  const emailConfirmed = (
    await db.query(
      "select public.service_confirm_public_reservation($1::uuid, $2::uuid, $3::uuid, $4::text, 'email', array['email','sms']::text[]) as result",
      [
        ids.organization,
        ids.location,
        emailInjectionHold.holdId,
        "9".repeat(64),
      ],
    )
  ).rows[0].result;
  await db.exec("reset role");
  const emailIdentity = (
    await db.query(
      `select reservation.guest_id, guest.email, guest.phone
      from public.reservations reservation
      join public.guests guest on guest.organization_id = reservation.organization_id
        and guest.id = reservation.guest_id
      where reservation.id = $1::uuid`,
      [emailConfirmed.reservationId],
    )
  ).rows[0];
  if (
    emailIdentity.guest_id === ids.atomicRequest ||
    emailIdentity.email !== "verified-new@example.invalid" ||
    emailIdentity.phone !== null
  ) {
    throw new Error(
      `Email verification trusted an unproven phone: ${JSON.stringify(emailIdentity)}`,
    );
  }
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);

  const matchedContactTime = new Date(
    new Date(publicTime).valueOf() + 6 * 86_400_000,
  ).toISOString();
  const matchedContactHold = (
    await db.query(
      `select public.service_create_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, 120, 2,
        'Existing', 'Guest', 'atomic@example.invalid', '+19995550199',
        null, array[$5::uuid], array['email','sms']::text[]
      ) as result`,
      [
        ids.matchedContactRequest,
        ids.organization,
        ids.location,
        matchedContactTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  const matchedConfirmed = (
    await db.query(
      "select public.service_confirm_public_reservation($1::uuid, $2::uuid, $3::uuid, $4::text, 'email', array['email','sms']::text[]) as result",
      [
        ids.organization,
        ids.location,
        matchedContactHold.holdId,
        "2".repeat(64),
      ],
    )
  ).rows[0].result;
  const matchedExchange = (
    await db.query(
      "select public.service_exchange_reservation_management($1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text) as result",
      [
        ids.organization,
        ids.location,
        matchedConfirmed.reservationId,
        "1".repeat(64),
        "0".repeat(64),
        "a".repeat(64),
      ],
    )
  ).rows[0].result;
  if (!matchedExchange.manageExpiresAt)
    throw new Error("Matched-contact reservation did not establish management");
  const matchedModifiedTime = new Date(
    new Date(matchedContactTime).valueOf() + 86_400_000,
  ).toISOString();
  const matchedModified = (
    await db.query(
      `select public.service_modify_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::timestamptz,
        120, 2, null, array[$6::uuid]
      ) as result`,
      [
        "d5100000-0000-4000-8000-000000000006",
        ids.organization,
        ids.location,
        "0".repeat(64),
        matchedModifiedTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  if (!matchedModified.manageExpiresAt)
    throw new Error("Public modification omitted refreshed management expiry");
  await db.query(
    "select public.service_enqueue_reservation_reminders($1::timestamptz)",
    [
      new Date(
        new Date(matchedModifiedTime).valueOf() - 60 * 60 * 1000,
      ).toISOString(),
    ],
  );
  await db.query(
    "select public.service_cancel_public_reservation($1::uuid, $2::uuid, $3::uuid, $4::text, 'Channel proof test')",
    [
      "d5100000-0000-4000-8000-000000000007",
      ids.organization,
      ids.location,
      "0".repeat(64),
    ],
  );
  await db.exec("reset role");
  const matchedEvidence = (
    await db.query(
      `select reservation.guest_id,
        array_agg(distinct message.channel order by message.channel) channels,
        array_agg(distinct message.template_key order by message.template_key) templates
      from public.reservations reservation
      join public.reservation_message_outbox message
        on message.organization_id = reservation.organization_id
       and message.reservation_id = reservation.id
      where reservation.id = $1::uuid
      group by reservation.guest_id`,
      [matchedConfirmed.reservationId],
    )
  ).rows[0];
  if (
    matchedEvidence.guest_id !== ids.atomicRequest ||
    JSON.stringify(matchedEvidence.channels) !== JSON.stringify(["email"]) ||
    !matchedEvidence.templates.includes("reservation_confirmed") ||
    !matchedEvidence.templates.includes("reservation_modified") ||
    !matchedEvidence.templates.includes("reservation_reminder_2h") ||
    !matchedEvidence.templates.includes("reservation_cancelled")
  ) {
    throw new Error(
      `Public messaging escaped its proven channel: ${JSON.stringify(matchedEvidence)}`,
    );
  }
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);

  const expiringHoldTime = new Date(
    new Date(publicTime).valueOf() + 2 * 86_400_000,
  ).toISOString();
  const expiringHold = (
    await db.query(
      `select public.service_create_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, 120, 2,
        'Expiry', 'Guest', 'expiry@example.invalid', '+12125550146',
        null, array[$5::uuid], array['email']::text[]
      ) as result`,
      [
        ids.expiringPublicRequest,
        ids.organization,
        ids.location,
        expiringHoldTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  if (!expiringHold.holdId)
    throw new Error("Expiring booking hold was not created");

  await db.exec("reset role");
  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  const waitlist = (
    await db.query(
      `select public.save_waitlist_entry_v2(
        $1::uuid, $2::uuid, null::uuid, 'Taylor Walk-in',
        'taylor@example.invalid', '+12125550124', 2,
        null::timestamptz, null::timestamptz, 15, 'Bar if possible'
      ) as result`,
      [ids.waitlistRequest, ids.location],
    )
  ).rows[0].result;
  if (waitlist.status !== "waiting")
    throw new Error("Waitlist save did not persist");
  const notified = (
    await db.query(
      "select public.transition_waitlist_entry($1::uuid, $2::uuid, 'notified', null) as result",
      ["d7100000-0000-4000-8000-000000000001", ids.waitlistRequest],
    )
  ).rows[0].result;
  if (notified.status !== "notified")
    throw new Error("Waitlist notification did not persist");
  const waitlistSeat = (
    await db.query(
      "select public.seat_waitlist_entry($1::uuid, $2::uuid, array[$3::uuid], 90) as result",
      [
        "d7100000-0000-4000-8000-000000000002",
        ids.waitlistRequest,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  if (waitlistSeat.status !== "seated")
    throw new Error("Waitlist seating did not persist");

  await db.query(
    `select public.save_waitlist_entry_v2(
      $1::uuid, $2::uuid, null::uuid, 'Expiring Walk-in',
      'waitlist.expiry@example.invalid', '+12125550147', 2,
      null::timestamptz, null::timestamptz, 15, null
    )`,
    [ids.expiringWaitlist, ids.location],
  );
  await db.query(
    "select public.transition_waitlist_entry($1::uuid, $2::uuid, 'notified', null)",
    ["d7100000-0000-4000-8000-000000000003", ids.expiringWaitlist],
  );
  await db.exec("reset role");
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const expiryNow = (
    await db.query("select clock_timestamp() + interval '20 minutes' as value")
  ).rows[0].value;
  const expired = (
    await db.query(
      "select public.service_expire_reservation_deadlines($1::uuid, $2::uuid, $3::timestamptz, 100) as result",
      [ids.organization, ids.location, expiryNow],
    )
  ).rows[0].result;
  const expiryReplay = (
    await db.query(
      "select public.service_expire_reservation_deadlines($1::uuid, $2::uuid, $3::timestamptz, 100) as result",
      [ids.organization, ids.location, expiryNow],
    )
  ).rows[0].result;
  if (
    expired.holdsExpired !== 1 ||
    expired.waitlistExpired !== 1 ||
    expiryReplay.holdsExpired !== 0 ||
    expiryReplay.waitlistExpired !== 0
  ) {
    throw new Error(
      `Deadline expiry was not atomic/idempotent: ${JSON.stringify({ expired, expiryReplay })}`,
    );
  }
  await expectDatabaseError(
    () =>
      db.query(
        "select public.service_confirm_public_reservation($1::uuid, $2::uuid, $3::uuid, $4::text, 'email', array['email']::text[])",
        [ids.organization, ids.location, expiringHold.holdId, "8".repeat(64)],
      ),
    "23514",
    "expired booking-hold confirmation",
  );
  await db.exec("reset role");
  const expiredEvidence = (
    await db.query(
      `select
        (select status from private.public_booking_holds where id = $1::uuid) hold_status,
        (select redacted_at is not null and first_name is null and last_name is null
          and email is null and phone is null and special_requests is null
          from private.public_booking_holds where id = $1::uuid) hold_redacted,
        (select count(*) from public.reservation_table_allocations
          where booking_hold_id = $1::uuid and is_active) active_hold_allocations,
        (select count(*) from public.reservation_message_outbox
          where booking_hold_id = $1::uuid and status <> 'cancelled') active_hold_messages,
        (select status from public.waitlist_entries where id = $2::uuid) waitlist_status`,
      [expiringHold.holdId, ids.expiringWaitlist],
    )
  ).rows[0];
  if (
    expiredEvidence.hold_status !== "expired" ||
    expiredEvidence.hold_redacted !== true ||
    Number(expiredEvidence.active_hold_allocations) !== 0 ||
    Number(expiredEvidence.active_hold_messages) !== 0 ||
    expiredEvidence.waitlist_status !== "expired"
  ) {
    throw new Error(
      `Expired deadline cleanup is incomplete: ${JSON.stringify(expiredEvidence)}`,
    );
  }

  // A hold that starts on the prior calendar/service day can leave an expired
  // active allocation crossing midnight. Date-scoped cleanup must not find it,
  // while the exact requested interval must release it before the GiST check.
  const crossBoundaryTimes = (
    await db.query(`
      select
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '20 days 23 hours 50 minutes')
          at time zone 'America/New_York') stale_start,
        ((date_trunc('day', clock_timestamp() at time zone 'America/New_York')
          + interval '21 days 10 minutes')
          at time zone 'America/New_York') requested_start
    `)
  ).rows[0];
  await db.exec(
    "alter table private.public_booking_holds disable trigger public_booking_holds_service_contract",
  );
  try {
    await db.query(
      `insert into private.public_booking_holds (
        id, organization_id, location_id, reserved_at, duration_minutes,
        party_size, public_code, first_name, last_name, email, phone,
        special_requests, expires_at, created_at, updated_at
      ) values (
        $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, 60, 2,
        'ZXBND001', 'Boundary', 'Expired', 'boundary.expired@example.invalid',
        '+12125550188', 'Redact this fixture',
        clock_timestamp() - interval '1 hour',
        clock_timestamp() - interval '2 hours', clock_timestamp()
      )`,
      [
        ids.crossBoundaryStaleHold,
        ids.organization,
        ids.location,
        crossBoundaryTimes.stale_start,
      ],
    );
  } finally {
    await db.exec(
      "alter table private.public_booking_holds enable trigger public_booking_holds_service_contract",
    );
  }
  await db.query(
    `insert into public.reservation_table_allocations (
      organization_id, location_id, booking_hold_id, table_id,
      allocation_kind, starts_at, ends_at, expires_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'hold',
      $5::timestamptz, $6::timestamptz + interval '30 minutes',
      clock_timestamp() - interval '1 hour'
    )`,
    [
      ids.organization,
      ids.location,
      ids.crossBoundaryStaleHold,
      ids.otherTable,
      crossBoundaryTimes.stale_start,
      crossBoundaryTimes.requested_start,
    ],
  );
  await db.query(
    `insert into public.reservation_message_outbox (
      organization_id, location_id, booking_hold_id, channel,
      template_key, dedupe_key
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'email',
      'reservation_verify', 'boundary-expired-hold'
    )`,
    [ids.organization, ids.location, ids.crossBoundaryStaleHold],
  );

  await db.query(
    `select private.expire_public_booking_holds(
      $1::uuid, $2::uuid, clock_timestamp(), 1000, $3::timestamptz
    )`,
    [ids.organization, ids.location, crossBoundaryTimes.requested_start],
  );
  const staleAfterDateCleanup = (
    await db.query(
      `select hold.status, allocation.is_active
      from private.public_booking_holds hold
      join public.reservation_table_allocations allocation
        on allocation.booking_hold_id = hold.id
      where hold.id = $1::uuid`,
      [ids.crossBoundaryStaleHold],
    )
  ).rows[0];
  if (
    staleAfterDateCleanup.status !== "pending" ||
    staleAfterDateCleanup.is_active !== true
  ) {
    throw new Error(
      `Date-scoped fixture did not retain the cross-boundary stale allocation: ${JSON.stringify(staleAfterDateCleanup)}`,
    );
  }

  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  const crossBoundarySaved = (
    await db.query(
      `select public.save_reservation(
        $1::uuid, $2::uuid, null::uuid, null::uuid, $3::timestamptz,
        15, 2, null, 'manual', array[$4::uuid]
      ) result`,
      [
        ids.crossBoundaryReservation,
        ids.location,
        crossBoundaryTimes.requested_start,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  if (
    crossBoundarySaved.id !== ids.crossBoundaryReservation ||
    crossBoundarySaved.replayed
  ) {
    throw new Error(
      `Cross-boundary replacement was not saved: ${JSON.stringify(crossBoundarySaved)}`,
    );
  }
  await db.exec("reset role");
  const crossBoundaryEvidence = (
    await db.query(
      `select
        (select status from private.public_booking_holds
          where id = $1::uuid) hold_status,
        (select expired_at is not null and redacted_at is not null
          and first_name is null and last_name is null and email is null
          and phone is null and special_requests is null
          from private.public_booking_holds where id = $1::uuid) hold_redacted,
        (select count(*) from public.reservation_table_allocations
          where booking_hold_id = $1::uuid and is_active) stale_allocations,
        (select count(*) from public.reservation_message_outbox
          where booking_hold_id = $1::uuid and status <> 'cancelled') live_messages,
        (select count(*) from public.audit_events
          where action = 'public_booking_hold_expired'
            and record_id = $1::uuid::text) expiry_audits,
        (select count(*) from public.reservation_table_allocations
          where reservation_id = $2::uuid and is_active) replacement_allocations`,
      [ids.crossBoundaryStaleHold, ids.crossBoundaryReservation],
    )
  ).rows[0];
  if (
    crossBoundaryEvidence.hold_status !== "expired" ||
    crossBoundaryEvidence.hold_redacted !== true ||
    Number(crossBoundaryEvidence.stale_allocations) !== 0 ||
    Number(crossBoundaryEvidence.live_messages) !== 0 ||
    Number(crossBoundaryEvidence.expiry_audits) !== 1 ||
    Number(crossBoundaryEvidence.replacement_allocations) !== 1
  ) {
    throw new Error(
      `Exact cross-boundary expiry lifecycle is incomplete: ${JSON.stringify(crossBoundaryEvidence)}`,
    );
  }

  const inventoryLockDefinition = (
    await db.query(
      "select pg_get_functiondef('private.lock_reservation_inventory_location(uuid)'::regprocedure) definition",
    )
  ).rows[0].definition;
  const privateInventoryGrants = (
    await db.query(`
      select
        has_function_privilege(
          'authenticated',
          'private.lock_reservation_inventory_location(uuid)',
          'EXECUTE'
        ) authenticated_lock,
        has_function_privilege(
          'service_role',
          'private.expire_overlapping_public_booking_holds(uuid,uuid,timestamptz,integer,uuid[],timestamptz,timestamptz)',
          'EXECUTE'
        ) service_expiry
    `)
  ).rows[0];
  if (
    !inventoryLockDefinition.includes("reservation-inventory-location:") ||
    privateInventoryGrants.authenticated_lock ||
    privateInventoryGrants.service_expiry
  ) {
    throw new Error(
      `Reservation inventory lock or private grants are unsafe: ${JSON.stringify(privateInventoryGrants)}`,
    );
  }

  const guestIdentityDefinitions = (
    await db.query(
      `select
        pg_get_functiondef(
          'private.resolve_location_guest_identity(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)'::regprocedure
        ) resolver,
        pg_get_functiondef(
          'public.save_waitlist_entry_v2(uuid,uuid,uuid,text,text,text,integer,timestamptz,timestamptz,integer,text)'::regprocedure
        ) waitlist_writer,
        pg_get_functiondef(
          'public.save_reservation_with_guest(uuid,uuid,text,text,text,timestamptz,integer,integer,text,text,uuid[])'::regprocedure
        ) reservation_writer,
        pg_get_functiondef(
          'public.service_confirm_public_reservation(uuid,uuid,uuid,text,text,text[])'::regprocedure
        ) public_confirmation`,
    )
  ).rows[0];
  const guestIdentityPrivateGrants = (
    await db.query(
      `select
        has_function_privilege(
          'anon',
          'private.resolve_location_guest_identity(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)',
          'EXECUTE'
        ) anon_execute,
        has_function_privilege(
          'authenticated',
          'private.resolve_location_guest_identity(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)',
          'EXECUTE'
        ) authenticated_execute,
        has_function_privilege(
          'service_role',
          'private.resolve_location_guest_identity(uuid,uuid,uuid,uuid,text,text,text,text,text,text,text,jsonb)',
          'EXECUTE'
        ) service_execute`,
    )
  ).rows[0];
  const confirmationIdentityLock =
    guestIdentityDefinitions.public_confirmation.indexOf(
      "resolve_location_guest_identity",
    );
  const confirmationInventoryLock =
    guestIdentityDefinitions.public_confirmation.indexOf(
      "lock_reservation_inventory",
    );
  const confirmationCommandLock =
    guestIdentityDefinitions.public_confirmation.indexOf(
      "public-reservation-confirm:",
    );
  const confirmationFirstReplay =
    guestIdentityDefinitions.public_confirmation.indexOf(
      "from private.public_booking_verifications",
    );
  const reservationWrapperClaim =
    guestIdentityDefinitions.reservation_writer.indexOf(
      "reservation.save-with-guest",
    );
  const reservationIdentityResolution =
    guestIdentityDefinitions.reservation_writer.indexOf(
      "resolve_location_guest_identity",
    );
  const reservationInnerSave =
    guestIdentityDefinitions.reservation_writer.indexOf(
      "result := public.save_reservation",
    );
  const resolverRowLock = guestIdentityDefinitions.resolver.lastIndexOf(
    "for update of guest",
  );
  const resolverFreshCandidate = guestIdentityDefinitions.resolver.indexOf(
    "into fresh_candidate_ids",
  );
  if (
    !guestIdentityDefinitions.resolver.includes("pg_advisory_xact_lock") ||
    !guestIdentityDefinitions.resolver.includes("'guest-email:'") ||
    !guestIdentityDefinitions.resolver.includes("'guest-phone:'") ||
    !guestIdentityDefinitions.resolver.includes("order by identity_lock.key") ||
    !guestIdentityDefinitions.resolver.includes("p_replay_kind") ||
    !guestIdentityDefinitions.resolver.includes("'reservation'") ||
    !guestIdentityDefinitions.resolver.includes("'waitlist'") ||
    !guestIdentityDefinitions.resolver.includes(
      "Guest identity request id was reused",
    ) ||
    !guestIdentityDefinitions.resolver.includes(
      "guest_location.location_id = p_location_id",
    ) ||
    !guestIdentityDefinitions.resolver.includes(
      "Guest contact matches multiple local profiles",
    ) ||
    !guestIdentityDefinitions.resolver.includes(
      "Guest identity changed concurrently; retry the request",
    ) ||
    resolverRowLock < 0 ||
    resolverFreshCandidate < 0 ||
    resolverRowLock >= resolverFreshCandidate ||
    !guestIdentityDefinitions.waitlist_writer.includes(
      "resolve_location_guest_identity",
    ) ||
    !guestIdentityDefinitions.reservation_writer.includes(
      "resolve_location_guest_identity",
    ) ||
    reservationWrapperClaim < 0 ||
    reservationIdentityResolution < 0 ||
    reservationInnerSave < 0 ||
    reservationWrapperClaim >= reservationIdentityResolution ||
    reservationIdentityResolution >= reservationInnerSave ||
    !guestIdentityDefinitions.reservation_writer.includes(
      "reservation_request_id",
    ) ||
    !guestIdentityDefinitions.reservation_writer.includes(
      "private.complete_operation_request(p_request_id)",
    ) ||
    !guestIdentityDefinitions.reservation_writer.includes(
      "from private.public_booking_holds",
    ) ||
    confirmationCommandLock < 0 ||
    confirmationFirstReplay < 0 ||
    confirmationCommandLock >= confirmationFirstReplay ||
    confirmationFirstReplay >= confirmationIdentityLock ||
    !guestIdentityDefinitions.public_confirmation.includes(
      "gen_random_uuid()",
    ) ||
    confirmationIdentityLock < 0 ||
    confirmationInventoryLock < 0 ||
    confirmationIdentityLock >= confirmationInventoryLock ||
    guestIdentityPrivateGrants.anon_execute ||
    guestIdentityPrivateGrants.authenticated_execute ||
    guestIdentityPrivateGrants.service_execute
  ) {
    throw new Error(
      `Location guest identity resolver contract is unsafe: ${JSON.stringify({ guestIdentityPrivateGrants, confirmationCommandLock, confirmationFirstReplay, confirmationIdentityLock, confirmationInventoryLock, reservationWrapperClaim, reservationIdentityResolution, reservationInnerSave, resolverRowLock, resolverFreshCandidate })}`,
    );
  }

  const reservationGuestId = (
    await db.query(
      "select guest_id from public.reservations where id = $1::uuid",
      [publicReservationId],
    )
  ).rows[0].guest_id;
  await db.query("select set_config('request.jwt.claims', '{}', false)");
  await db.query(
    `update public.guests
      set preferences = 'Quiet corner',
          allergies = 'Shellfish',
          notes = 'Local private profile note'
      where id = $1::uuid`,
    [reservationGuestId],
  );
  const localProviderReference = (
    await db.query(
      `select external_references ? 'le_yard_web' as present
      from public.guests where id = $1::uuid`,
      [reservationGuestId],
    )
  ).rows[0];
  if (localProviderReference?.present !== true)
    throw new Error("Provider-reference oracle fixture is missing");
  await db.query(
    `insert into public.guest_visits (
      id, organization_id, location_id, guest_id, visited_at, party_size,
      covers, spend_cents, source
    ) values
      ($1::uuid, $3::uuid, $4::uuid, $5::uuid, clock_timestamp(), 2, 2, 10000, 'manual'),
      ($2::uuid, $3::uuid, $6::uuid, $5::uuid, clock_timestamp(), 2, 2, 12000, 'manual')`,
    [
      ids.guestVisit,
      ids.crossLocationGuestVisit,
      ids.organization,
      ids.location,
      reservationGuestId,
      ids.otherLocation,
    ],
  );
  await db.query(
    `insert into public.guests (
      id, organization_id, display_name, email, preferences, allergies,
      notes, lifetime_spend_cents, source, external_references
    ) values
      ($1::uuid, $3::uuid, 'Remote Guest', 'remote.guest@example.invalid',
        'Remote preference', 'Remote allergy', 'Remote private note', 76543,
        'manual', '{"provider":"remote-private"}'::jsonb),
      ($2::uuid, $3::uuid, 'Remote Source Guest', 'remote.source@example.invalid',
        'Remote source preference', null, 'Remote source private note', 123,
        'manual', '{"provider":"remote-source-private"}'::jsonb)`,
    [ids.remoteGuest, ids.remoteSourceGuest, ids.organization],
  );
  await db.query(
    `insert into public.guest_locations (
      id, organization_id, guest_id, location_id, is_home_location
    ) values
      ($1::uuid, $4::uuid, $5::uuid, $6::uuid, true),
      ($2::uuid, $4::uuid, $7::uuid, $8::uuid, true),
      ($3::uuid, $4::uuid, $9::uuid, $8::uuid, true)
    on conflict (guest_id, location_id) do nothing`,
    [
      ids.localGuestLocation,
      ids.remoteGuestLocation,
      ids.remoteSourceGuestLocation,
      ids.organization,
      reservationGuestId,
      ids.location,
      ids.remoteGuest,
      ids.otherLocation,
      ids.remoteSourceGuest,
    ],
  );
  await db.query(
    `insert into public.guest_contacts (
      id, organization_id, guest_id, contact_type, label, value, is_primary
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'phone', 'Mobile', '+12125550998', true
    )`,
    [ids.remoteGuestContact, ids.organization, ids.remoteGuest],
  );
  await db.query(
    `insert into public.guest_notes (
      id, organization_id, guest_id, location_id, note, is_sensitive, author_id
    ) values
      ($1::uuid, $3::uuid, $4::uuid, $5::uuid,
        'Downtown guest context', true, $6::uuid),
      ($2::uuid, $3::uuid, $7::uuid, $8::uuid,
        'Uptown-only guest context', true, $6::uuid)`,
    [
      ids.localGuestNote,
      ids.remoteGuestNote,
      ids.organization,
      reservationGuestId,
      ids.location,
      ids.owner,
      ids.remoteGuest,
      ids.otherLocation,
    ],
  );
  await db.query(
    `insert into public.guest_consents (
      id, organization_id, guest_id, channel, status, captured_at, source
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'email', 'granted',
      clock_timestamp(), 'fixture'
    )`,
    [ids.remoteGuestConsent, ids.organization, ids.remoteGuest],
  );
  await db.query(
    `insert into public.guest_tags (id, organization_id, name, color)
      values ($1::uuid, $2::uuid, 'Remote-only assignment', '#123456')`,
    [ids.remoteGuestTag, ids.organization],
  );
  await db.query(
    `insert into public.guest_tag_assignments (
      id, organization_id, guest_id, tag_id, assigned_by
    ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid)`,
    [
      ids.remoteGuestTagAssignment,
      ids.organization,
      ids.remoteGuest,
      ids.remoteGuestTag,
      ids.owner,
    ],
  );
  await db.query(
    `insert into public.guest_merge_events (
      id, organization_id, source_guest_id, target_guest_id,
      match_score, reasons, merged_by
    ) values
      ($1::uuid, $4::uuid, $5::uuid, $6::uuid,
        1, '["remote"]'::jsonb, $7::uuid),
      ($2::uuid, $4::uuid, $8::uuid, $6::uuid,
        1, '["local-source"]'::jsonb, $7::uuid),
      ($3::uuid, $4::uuid, $6::uuid, $8::uuid,
        1, '["local-target"]'::jsonb, $7::uuid)`,
    [
      ids.remoteGuestMerge,
      ids.localSourceRemoteTargetMerge,
      ids.remoteSourceLocalTargetMerge,
      ids.organization,
      ids.remoteSourceGuest,
      ids.remoteGuest,
      ids.owner,
      reservationGuestId,
    ],
  );
  await db.exec("set role anon");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "anon" }),
  ]);
  await expectDatabaseError(
    () =>
      db.query(
        "select * from public.service_reservation_guest_summaries($1::uuid, $2::uuid, array[$3::uuid])",
        [ids.organization, ids.location, reservationGuestId],
      ),
    "42501",
    "unauthenticated reservation guest summary",
  );

  await db.exec("reset role");
  await db.exec("set role authenticated");
  await assumeUser(ids.manager);
  const managerReservationCount = Number(
    (
      await db.query(
        "select count(id) count from public.reservations where id = $1::uuid",
        [publicReservationId],
      )
    ).rows[0].count,
  );
  const managerRawGuestCount = Number(
    (
      await db.query(
        "select count(*) count from public.guests where id = $1::uuid",
        [reservationGuestId],
      )
    ).rows[0].count,
  );
  const managerGuestVisitCount = Number(
    (await db.query("select count(*) count from public.guest_visits")).rows[0]
      .count,
  );
  const managerRemoteGuestEvidence = (
    await db.query(
      `select
        (select count(*) from public.guests where id = $1::uuid) guests,
        (select count(*) from public.guest_locations where guest_id = $1::uuid) locations,
        (select count(*) from public.guest_contacts where guest_id = $1::uuid) contacts,
        (select count(*) from public.guest_notes where guest_id = $1::uuid) notes,
        (select count(*) from public.guest_tag_assignments where guest_id = $1::uuid) tag_assignments,
        (select count(*) from public.guest_consents where guest_id = $1::uuid) consents,
        (select count(*) from public.guest_merge_events where id = $2::uuid) merge_events`,
      [ids.remoteGuest, ids.remoteGuestMerge],
    )
  ).rows[0];
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_reservation_host_snapshot(
          $1::uuid, $2::uuid,
          $3::timestamptz - interval '1 hour',
          $3::timestamptz + interval '1 hour'
        )`,
        [ids.organization, ids.location, serviceTime],
      ),
    "42501",
    "reservation snapshot without an exact capability",
  );
  for (const [label, query, params] of [
    [
      "zero-capability Manager legacy save_guest",
      `select public.save_guest(
        'de000000-0000-4000-8000-000000000001'::uuid,
        $1::uuid, null, 'Denied', 'Guest', 'Denied Guest',
        'denied@example.invalid', null, null, false, null, null, null
      )`,
      [ids.organization],
    ],
    [
      "zero-capability Manager legacy add_guest_note",
      `select public.add_guest_note(
        'de000000-0000-4000-8000-000000000002'::uuid,
        $1::uuid, $2::uuid, 'Denied note', true
      )`,
      [reservationGuestId, ids.location],
    ],
    [
      "zero-capability Manager legacy save_guest_contact",
      `select public.save_guest_contact(
        'de000000-0000-4000-8000-000000000003'::uuid,
        $1::uuid, null, 'phone', 'Mobile', '+12125550123', true
      )`,
      [reservationGuestId],
    ],
    [
      "zero-capability Manager legacy record_guest_consent",
      `select public.record_guest_consent(
        'de000000-0000-4000-8000-000000000004'::uuid,
        $1::uuid, 'email', 'granted'::public.consent_status, 'Denied'
      )`,
      [reservationGuestId],
    ],
    [
      "zero-capability Manager legacy assign_guest_tag",
      `select public.assign_guest_tag(
        'de000000-0000-4000-8000-000000000005'::uuid,
        $1::uuid, $2::uuid
      )`,
      [reservationGuestId, ids.remoteGuestTag],
    ],
    [
      "zero-capability Manager legacy merge_guests",
      `select public.merge_guests(
        'de000000-0000-4000-8000-000000000006'::uuid,
        $1::uuid, $2::uuid, 1, '["denied"]'::jsonb
      )`,
      [ids.remoteSourceGuest, ids.remoteGuest],
    ],
    [
      "zero-capability Manager service_save_guest",
      `select * from public.service_save_guest(
        'de000000-0000-4000-8000-000000000007'::uuid,
        $1::uuid, $2::uuid, null, 'Denied', 'Guest', 'Denied Guest',
        'denied.service@example.invalid', null, null, false, null, null, null
      )`,
      [ids.organization, ids.location],
    ],
    [
      "zero-capability Manager service_add_guest_note",
      `select * from public.service_add_guest_note(
        'de000000-0000-4000-8000-000000000008'::uuid,
        $1::uuid, $2::uuid, 'Denied service note', true
      )`,
      [reservationGuestId, ids.location],
    ],
    [
      "zero-capability Manager service_record_guest_consent",
      `select * from public.service_record_guest_consent(
        'de000000-0000-4000-8000-000000000009'::uuid,
        $1::uuid, $2::uuid, $3::uuid,
        'email', 'granted'::public.consent_status, 'Denied service consent'
      )`,
      [ids.organization, ids.location, reservationGuestId],
    ],
    [
      "zero-capability Manager service_merge_guests",
      `select * from public.service_merge_guests(
        'de000000-0000-4000-8000-00000000000a'::uuid,
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, 1, '["denied"]'::jsonb
      )`,
      [
        ids.organization,
        ids.otherLocation,
        ids.remoteSourceGuest,
        ids.remoteGuest,
      ],
    ],
  ]) {
    await expectDatabaseError(() => db.query(query, params), "42501", label);
  }
  if (
    managerReservationCount !== 0 ||
    managerRawGuestCount !== 0 ||
    managerGuestVisitCount !== 0 ||
    Object.values(managerRemoteGuestEvidence).some(
      (value) => Number(value) !== 0,
    )
  )
    throw new Error(
      `Legacy Manager RLS shortcuts still expose reservations or raw CRM: ${JSON.stringify({ managerReservationCount, managerRawGuestCount, managerGuestVisitCount })}`,
    );

  await db.exec("reset role");
  await db.query(
    `insert into public.user_capability_overrides (
      id, organization_id, user_id, capability_key, location_id, effect,
      reason, effective_from, is_active, created_by, updated_by
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'reservations.operate', $4::uuid,
      'grant', 'Reservation Gate 0 authorization test', current_date, true,
      $5::uuid, $5::uuid
    )`,
    [
      ids.capabilityOverride,
      ids.organization,
      ids.employee,
      ids.location,
      ids.owner,
    ],
  );
  await db.query(
    `insert into public.reservations (
      id, organization_id, location_id, guest_id, reserved_at, party_size,
      status, source, booking_channel
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid,
      clock_timestamp() + interval '8 days', 2, 'booked', 'manual', 'staff'
    )`,
    [
      ids.crossLocationReservation,
      ids.organization,
      ids.otherLocation,
      reservationGuestId,
    ],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  const operateReadCount = Number(
    (
      await db.query(
        "select count(id) count from public.reservations where id = $1::uuid",
        [publicReservationId],
      )
    ).rows[0].count,
  );
  await expectDatabaseError(
    () =>
      db.query(
        "select raw_payload from public.reservations where id = $1::uuid",
        [publicReservationId],
      ),
    "42501",
    "Host direct reservation raw payload read",
  );
  const operateHostSnapshot = (
    await db.query(
      `select * from public.service_reservation_host_snapshot(
        $1::uuid, $2::uuid,
        $3::timestamptz - interval '1 hour',
        $3::timestamptz + interval '1 hour'
      )`,
      [ids.organization, ids.location, serviceTime],
    )
  ).rows;
  const expectedHostSnapshotKeys = [
    "booking_channel",
    "duration_minutes",
    "guest_id",
    "id",
    "last_revision",
    "party_size",
    "policy_evidence_captured",
    "reserved_at",
    "source",
    "special_requests",
    "status",
    "table_label",
    "version",
  ];
  const operateHostReservation = operateHostSnapshot.find(
    (reservation) => reservation.id === ids.staffReservation,
  );
  if (
    !operateHostReservation ||
    JSON.stringify(Object.keys(operateHostReservation).sort()) !==
      JSON.stringify(expectedHostSnapshotKeys) ||
    operateHostReservation.party_size !== 4 ||
    operateHostReservation.special_requests !== "Window if possible" ||
    "external_id" in operateHostReservation ||
    "raw_payload" in operateHostReservation ||
    "public_code" in operateHostReservation
  ) {
    throw new Error(
      `Host reservation DTO is not exact: ${JSON.stringify(operateHostReservation)}`,
    );
  }
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_reservation_host_snapshot(
          $1::uuid, $2::uuid, $3::timestamptz,
          $3::timestamptz + interval '30 hours 1 second'
        )`,
        [ids.organization, ids.location, serviceTime],
      ),
    "22023",
    "reservation snapshot window over 30 hours",
  );
  const operateSummary = (
    await db.query(
      "select * from public.service_reservation_guest_summaries($1::uuid, $2::uuid, array[$3::uuid])",
      [ids.organization, ids.location, reservationGuestId],
    )
  ).rows;
  const operateRawGuestCount = Number(
    (
      await db.query(
        "select count(*) count from public.guests where id = $1::uuid",
        [reservationGuestId],
      )
    ).rows[0].count,
  );
  const operateRawVisitCount = Number(
    (await db.query("select count(*) count from public.guest_visits")).rows[0]
      .count,
  );
  if (
    operateReadCount !== 0 ||
    operateSummary.length !== 1 ||
    operateRawGuestCount !== 0 ||
    operateRawVisitCount !== 0
  )
    throw new Error("Operate-only safe read boundary is inconsistent");
  for (const [label, query] of [
    [
      "direct authenticated reservation insert",
      `insert into public.reservations (
        organization_id, location_id, reserved_at, party_size, status
      ) values ('${ids.organization}'::uuid, '${ids.location}'::uuid,
        clock_timestamp() + interval '9 days', 2, 'booked')`,
    ],
    [
      "direct authenticated reservation update",
      `update public.reservations set party_size = party_size
        where id = '${publicReservationId}'::uuid`,
    ],
    [
      "direct authenticated reservation delete",
      `delete from public.reservations where id = '${publicReservationId}'::uuid`,
    ],
  ]) {
    await expectDatabaseError(() => db.exec(query), "42501", label);
  }
  const operateTransition = (
    await db.query(
      "select public.transition_reservation($1::uuid, $2::uuid, 'confirmed', null) result",
      ["d8100000-0000-4000-8000-000000000001", smsConfirmed.reservationId],
    )
  ).rows[0].result;
  if (operateTransition.status !== "confirmed")
    throw new Error(
      "Operate-only capability could not run an approved command",
    );

  await db.exec("reset role");
  await db.query(
    `update public.user_capability_overrides
      set capability_key = 'reservations.view', updated_at = clock_timestamp()
      where id = $1::uuid`,
    [ids.capabilityOverride],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  const viewSummary = (
    await db.query(
      "select * from public.service_reservation_guest_summaries($1::uuid, $2::uuid, array[$3::uuid])",
      [ids.organization, ids.location, reservationGuestId],
    )
  ).rows;
  const viewHostSnapshot = (
    await db.query(
      `select * from public.service_reservation_host_snapshot(
        $1::uuid, $2::uuid,
        $3::timestamptz - interval '1 hour',
        $3::timestamptz + interval '1 hour'
      )`,
      [ids.organization, ids.location, serviceTime],
    )
  ).rows;
  const viewDirectReservationCount = Number(
    (
      await db.query(
        "select count(id) count from public.reservations where id = $1::uuid",
        [ids.staffReservation],
      )
    ).rows[0].count,
  );
  if (
    viewSummary.length !== 1 ||
    !viewHostSnapshot.some((row) => row.id === ids.staffReservation) ||
    viewDirectReservationCount !== 0
  )
    throw new Error(
      "View-only capability could not use the safe read boundary",
    );
  await expectDatabaseError(
    () =>
      db.query(
        "select public.transition_reservation($1::uuid, $2::uuid, 'arrived', null)",
        ["d8100000-0000-4000-8000-000000000002", smsConfirmed.reservationId],
      ),
    "42501",
    "view-only reservation operation",
  );

  await db.exec("reset role");
  await db.query(
    `update public.user_capability_overrides
      set capability_key = 'reservations.override', updated_at = clock_timestamp()
      where id = $1::uuid`,
    [ids.capabilityOverride],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  const overrideHostSnapshot = (
    await db.query(
      `select * from public.service_reservation_host_snapshot(
        $1::uuid, $2::uuid,
        $3::timestamptz - interval '1 hour',
        $3::timestamptz + interval '1 hour'
      )`,
      [ids.organization, ids.location, serviceTime],
    )
  ).rows;
  const overrideDirectReservationCount = Number(
    (
      await db.query(
        "select count(id) count from public.reservations where id = $1::uuid",
        [ids.staffReservation],
      )
    ).rows[0].count,
  );
  if (
    !overrideHostSnapshot.some((row) => row.id === ids.staffReservation) ||
    overrideDirectReservationCount !== 0
  )
    throw new Error("Override-only capability bypassed the safe read boundary");

  await db.exec("reset role");
  await db.query(
    `update public.user_capability_overrides
      set effective_from = current_date - 2, effective_to = current_date - 1,
          updated_at = clock_timestamp()
      where id = $1::uuid`,
    [ids.capabilityOverride],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  const expiredGrantReadCount = Number(
    (
      await db.query(
        "select count(id) count from public.reservations where id = $1::uuid",
        [publicReservationId],
      )
    ).rows[0].count,
  );
  if (expiredGrantReadCount !== 0)
    throw new Error(
      "Expired reservation capability still authorized core reads",
    );
  await expectDatabaseError(
    () =>
      db.query(
        "select * from public.service_reservation_guest_summaries($1::uuid, $2::uuid, array[$3::uuid])",
        [ids.organization, ids.location, reservationGuestId],
      ),
    "42501",
    "expired reservation guest-summary grant",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_reservation_host_snapshot(
          $1::uuid, $2::uuid,
          $3::timestamptz - interval '1 hour',
          $3::timestamptz + interval '1 hour'
        )`,
        [ids.organization, ids.location, serviceTime],
      ),
    "42501",
    "expired reservation Host snapshot grant",
  );

  await db.exec("reset role");
  await db.query(
    `update public.user_capability_overrides
      set capability_key = 'reservations.operate', effective_from = current_date,
          effective_to = null, updated_at = clock_timestamp()
      where id = $1::uuid`,
    [ids.capabilityOverride],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  const crossLocationCount = Number(
    (
      await db.query(
        "select count(id) count from public.reservations where id = $1::uuid",
        [ids.crossLocationReservation],
      )
    ).rows[0].count,
  );
  if (crossLocationCount !== 0)
    throw new Error(
      "Location-scoped reservation grant leaked another location",
    );
  const crossLocationVisitCount = Number(
    (
      await db.query(
        "select count(*) count from public.guest_visits where id = $1::uuid",
        [ids.crossLocationGuestVisit],
      )
    ).rows[0].count,
  );
  if (crossLocationVisitCount !== 0)
    throw new Error(
      "Reservation operate grant leaked cross-location guest visits",
    );
  await expectDatabaseError(
    () =>
      db.query(
        "select * from public.service_reservation_guest_summaries($1::uuid, $2::uuid, array[$3::uuid])",
        [ids.organization, ids.otherLocation, reservationGuestId],
      ),
    "42501",
    "cross-location reservation guest summary",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_reservation_host_snapshot(
          $1::uuid, $2::uuid,
          $3::timestamptz - interval '1 hour',
          $3::timestamptz + interval '1 hour'
        )`,
        [ids.organization, ids.otherLocation, serviceTime],
      ),
    "42501",
    "cross-location reservation Host snapshot",
  );

  await db.exec("reset role");
  await db.query(
    `update public.user_capability_overrides
      set capability_key = 'guest.manage', updated_at = clock_timestamp()
      where id = $1::uuid`,
    [ids.capabilityOverride],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  for (const [label, query, params] of [
    [
      "A-capability service save at B",
      `select * from public.service_save_guest(
        'df000000-0000-4000-8000-000000000001'::uuid,
        $1::uuid, $2::uuid, $3::uuid,
        null, null, 'Remote Guest', 'remote.guest@example.invalid',
        null, null, false, null, null, null
      )`,
      [ids.organization, ids.otherLocation, ids.remoteGuest],
    ],
    [
      "A-capability service note at B",
      `select * from public.service_add_guest_note(
        'df000000-0000-4000-8000-000000000002'::uuid,
        $1::uuid, $2::uuid, 'Cross-location note body', true
      )`,
      [ids.remoteGuest, ids.otherLocation],
    ],
    [
      "A-capability service consent at B",
      `select * from public.service_record_guest_consent(
        'df000000-0000-4000-8000-000000000003'::uuid,
        $1::uuid, $2::uuid, $3::uuid,
        'email', 'granted'::public.consent_status, 'Cross-location evidence'
      )`,
      [ids.organization, ids.otherLocation, ids.remoteGuest],
    ],
    [
      "A-capability service merge at B",
      `select * from public.service_merge_guests(
        'df000000-0000-4000-8000-000000000004'::uuid,
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        1, '["cross-location"]'::jsonb
      )`,
      [
        ids.organization,
        ids.otherLocation,
        ids.remoteSourceGuest,
        ids.remoteGuest,
      ],
    ],
  ]) {
    await expectDatabaseError(() => db.query(query, params), "42501", label);
  }
  const crmReservationRows = (
    await db.query(
      `select id, guest_id, location_id, reserved_at, party_size, status,
        table_label, special_requests, source
      from public.reservations
      where id = $1::uuid`,
      [publicReservationId],
    )
  ).rows;
  if (crmReservationRows.length !== 1)
    throw new Error(
      "Exact guest.manage reservation-history read was not preserved",
    );
  const locationScopedGuestEvidence = (
    await db.query(
      `select
        (select count(*) from public.guests where id = $1::uuid) local_guest,
        (select count(*) from public.guest_notes where id = $2::uuid) local_note,
        (select count(*) from public.guests where id = $3::uuid) remote_guest,
        (select count(*) from public.guest_locations where guest_id = $3::uuid) remote_locations,
        (select count(*) from public.guest_contacts where guest_id = $3::uuid) remote_contacts,
        (select count(*) from public.guest_notes where guest_id = $3::uuid) remote_notes,
        (select count(*) from public.guest_tag_assignments where guest_id = $3::uuid) remote_tag_assignments,
        (select count(*) from public.guest_consents where guest_id = $3::uuid) remote_consents,
        (select count(*) from public.guest_merge_events where target_guest_id = $3::uuid) remote_merges,
        (select count(*) from public.guest_merge_events where id = $5::uuid) cross_source_merge,
        (select count(*) from public.guest_tags where id = $4::uuid) org_tag_definitions`,
      [
        reservationGuestId,
        ids.localGuestNote,
        ids.remoteGuest,
        ids.remoteGuestTag,
        ids.remoteSourceLocalTargetMerge,
      ],
    )
  ).rows[0];
  if (
    Number(locationScopedGuestEvidence.local_guest) !== 1 ||
    Number(locationScopedGuestEvidence.local_note) !== 1 ||
    Number(locationScopedGuestEvidence.org_tag_definitions) !== 1 ||
    [
      "remote_guest",
      "remote_locations",
      "remote_contacts",
      "remote_notes",
      "remote_tag_assignments",
      "remote_consents",
      "remote_merges",
      "cross_source_merge",
    ].some((key) => Number(locationScopedGuestEvidence[key]) !== 0)
  ) {
    throw new Error(
      `Location-scoped guest.manage leaked remote CRM evidence: ${JSON.stringify(locationScopedGuestEvidence)}`,
    );
  }
  const guestManageVisitCount = Number(
    (
      await db.query(
        "select count(*) count from public.guest_visits where guest_id = $1::uuid",
        [reservationGuestId],
      )
    ).rows[0].count,
  );
  if (guestManageVisitCount !== 0)
    throw new Error("guest.manage exposed sensitive visit/spend evidence");
  await expectDatabaseError(
    () =>
      db.query(
        "select spend_cents from public.guest_locations where guest_id = $1::uuid",
        [reservationGuestId],
      ),
    "42501",
    "guest.manage direct guest-location spend",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_add_guest_note(
          'df000000-0000-4000-8000-000000000005'::uuid,
          $1::uuid, $2::uuid, 'Manage-only note body', true
        )`,
        [reservationGuestId, ids.location],
      ),
    "42501",
    "guest.manage-only note append",
  );

  const employeeGuestCreate = (
    await db.query(
      `select * from public.service_save_guest(
        $1::uuid, $2::uuid, $3::uuid, null,
        'Capability', 'Target', 'Capability Target',
        'capability.target@example.invalid', '+12125550131', null, false,
        null, null, null
      )`,
      [ids.employeeGuestTarget, ids.organization, ids.location],
    )
  ).rows[0];
  const employeeGuestReplay = (
    await db.query(
      `select * from public.service_save_guest(
        $1::uuid, $2::uuid, $3::uuid, null,
        'Capability', 'Target', 'Capability Target',
        'capability.target@example.invalid', '+12125550131', null, false,
        null, null, null
      )`,
      [ids.employeeGuestTarget, ids.organization, ids.location],
    )
  ).rows[0];
  const employeeSourceCreate = (
    await db.query(
      `select * from public.service_save_guest(
        $1::uuid, $2::uuid, $3::uuid, null,
        'Capability', 'Source', 'Capability Source',
        'capability.source@example.invalid', null, null, false,
        null, null, null
      )`,
      [ids.employeeGuestSource, ids.organization, ids.location],
    )
  ).rows[0];
  expectExactKeys(
    employeeGuestCreate,
    ["id", "display_name", "updated_at"],
    "capability employee service_save_guest",
  );
  if (
    employeeGuestCreate.id !== ids.employeeGuestTarget ||
    employeeGuestReplay.id !== employeeGuestCreate.id ||
    employeeSourceCreate.id !== ids.employeeGuestSource
  ) {
    throw new Error(
      `Capability-only employee create/replay failed: ${JSON.stringify({ employeeGuestCreate, employeeGuestReplay, employeeSourceCreate })}`,
    );
  }

  const employeeGuestUpdate = (
    await db.query(
      `select * from public.service_save_guest(
        'b8100000-0000-4000-8000-000000000003'::uuid,
        $1::uuid, $2::uuid, $3::uuid,
        'Capability', 'Target', 'Capability Target Updated',
        'capability.target@example.invalid', '+12125550131', null, false,
        null, null, null
      )`,
      [ids.organization, ids.location, ids.employeeGuestTarget],
    )
  ).rows[0];
  if (
    employeeGuestUpdate.id !== ids.employeeGuestTarget ||
    employeeGuestUpdate.display_name !== "Capability Target Updated"
  ) {
    throw new Error(
      `Capability-only employee update failed: ${JSON.stringify(employeeGuestUpdate)}`,
    );
  }

  const employeeConsentCreate = (
    await db.query(
      `select * from public.service_record_guest_consent(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        'sms', 'granted'::public.consent_status, 'Capability employee proof'
      )`,
      [
        ids.employeeGuestConsent,
        ids.organization,
        ids.location,
        ids.employeeGuestTarget,
      ],
    )
  ).rows[0];
  const employeeConsentReplay = (
    await db.query(
      `select * from public.service_record_guest_consent(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        'sms', 'granted'::public.consent_status, 'Capability employee proof'
      )`,
      [
        ids.employeeGuestConsent,
        ids.organization,
        ids.location,
        ids.employeeGuestTarget,
      ],
    )
  ).rows[0];
  expectExactKeys(
    employeeConsentCreate,
    ["id", "captured_at"],
    "capability employee service_record_guest_consent",
  );
  if (
    employeeConsentCreate.id !== ids.employeeGuestConsent ||
    employeeConsentReplay.id !== employeeConsentCreate.id
  ) {
    throw new Error(
      `Capability-only employee consent replay failed: ${JSON.stringify({ employeeConsentCreate, employeeConsentReplay })}`,
    );
  }

  await db.exec("reset role");
  await db.query(
    `insert into public.user_capability_overrides (
      id, organization_id, user_id, capability_key, location_id, effect,
      reason, effective_from, is_active, created_by, updated_by
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'guest.sensitive_notes.view', $4::uuid,
      'grant', 'Capability-only employee note proof', current_date, true,
      $5::uuid, $5::uuid
    )`,
    [
      ids.employeeSensitiveCommandOverride,
      ids.organization,
      ids.employee,
      ids.location,
      ids.owner,
    ],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  const employeeNoteCreate = (
    await db.query(
      `select * from public.service_add_guest_note(
        $1::uuid, $2::uuid, $3::uuid, 'Dual-capability employee note', true
      )`,
      [ids.employeeGuestNote, ids.employeeGuestTarget, ids.location],
    )
  ).rows[0];
  const employeeNoteReplay = (
    await db.query(
      `select * from public.service_add_guest_note(
        $1::uuid, $2::uuid, $3::uuid, 'Dual-capability employee note', true
      )`,
      [ids.employeeGuestNote, ids.employeeGuestTarget, ids.location],
    )
  ).rows[0];
  expectExactKeys(
    employeeNoteCreate,
    ["id", "created_at"],
    "capability employee service_add_guest_note",
  );
  if (
    employeeNoteCreate.id !== ids.employeeGuestNote ||
    employeeNoteReplay.id !== employeeNoteCreate.id
  ) {
    throw new Error(
      `Capability-only employee note replay failed: ${JSON.stringify({ employeeNoteCreate, employeeNoteReplay })}`,
    );
  }

  await db.exec("reset role");
  await db.query(
    `delete from public.user_capability_overrides where id = $1::uuid`,
    [ids.employeeSensitiveCommandOverride],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);

  const employeeMergeCreate = (
    await db.query(
      `select * from public.service_merge_guests(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        1, '["capability-employee"]'::jsonb
      )`,
      [
        ids.employeeGuestMerge,
        ids.organization,
        ids.location,
        ids.employeeGuestSource,
        ids.employeeGuestTarget,
      ],
    )
  ).rows[0];
  const employeeMergeReplay = (
    await db.query(
      `select * from public.service_merge_guests(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        1, '["capability-employee"]'::jsonb
      )`,
      [
        ids.employeeGuestMerge,
        ids.organization,
        ids.location,
        ids.employeeGuestSource,
        ids.employeeGuestTarget,
      ],
    )
  ).rows[0];
  expectExactKeys(
    employeeMergeCreate,
    ["id", "source_guest_id", "target_guest_id", "merged_at"],
    "capability employee service_merge_guests",
  );
  if (
    employeeMergeCreate.id !== ids.employeeGuestMerge ||
    employeeMergeCreate.source_guest_id !== ids.employeeGuestSource ||
    employeeMergeCreate.target_guest_id !== ids.employeeGuestTarget ||
    employeeMergeReplay.id !== employeeMergeCreate.id
  ) {
    throw new Error(
      `Capability-only employee merge replay failed: ${JSON.stringify({ employeeMergeCreate, employeeMergeReplay })}`,
    );
  }

  // Deterministically inject a new B-location link after the wrapper and
  // early kernel authorization checks claim the request, but before the
  // kernel obtains its stable guest-row locks. The post-lock recheck must
  // reject the merge and roll back both the request claim and injected link.
  for (const [guestId, displayName, email] of [
    [
      ids.mergeRaceSourceGuest,
      "Merge Race Source",
      "merge.race.source@example.invalid",
    ],
    [
      ids.mergeRaceTargetGuest,
      "Merge Race Target",
      "merge.race.target@example.invalid",
    ],
  ]) {
    const raceGuest = (
      await db.query(
        `select * from public.service_save_guest(
          $1::uuid, $2::uuid, $3::uuid, null,
          null, null, $4::text, $5::text, null, null, false,
          null, null, null
        )`,
        [guestId, ids.organization, ids.location, displayName, email],
      )
    ).rows[0];
    if (raceGuest.id !== guestId)
      throw new Error("Merge TOCTOU guest fixture creation failed");
  }

  await db.exec("reset role");
  await db.exec(`
    create function private.inject_merge_race_location()
    returns trigger
    language plpgsql security definer
    set search_path = ''
    set row_security = off
    as $$
    begin
      if new.request_id = '${ids.mergeRaceRequest}'::uuid
        and new.operation_kind = 'guest.merge' then
        insert into public.guest_locations (
          id, organization_id, guest_id, location_id, is_home_location
        ) values (
          '${ids.mergeRaceInjectedLocation}'::uuid,
          '${ids.organization}'::uuid,
          '${ids.mergeRaceTargetGuest}'::uuid,
          '${ids.otherLocation}'::uuid,
          false
        );
      end if;
      return new;
    end
    $$;

    revoke all on function private.inject_merge_race_location()
    from public, anon, authenticated, service_role;

    create trigger inject_merge_race_location
    after insert on private.operation_requests
    for each row execute function private.inject_merge_race_location();
  `);
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_merge_guests(
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
          1, '["post-lock-recheck"]'::jsonb
        )`,
        [
          ids.mergeRaceRequest,
          ids.organization,
          ids.location,
          ids.mergeRaceSourceGuest,
          ids.mergeRaceTargetGuest,
        ],
      ),
    "42501",
    "post-lock merge capability recheck",
  );

  await db.exec("reset role");
  await db.exec(`
    drop trigger inject_merge_race_location on private.operation_requests;
    drop function private.inject_merge_race_location();
  `);
  const mergeRaceEvidence = (
    await db.query(
      `select
        (select count(*) from public.guest_merge_events
          where id = $1::uuid) merge_events,
        (select count(*) from private.operation_requests
          where request_id = $1::uuid) operation_requests,
        (select count(*) from public.guest_locations
          where id = $2::uuid) injected_locations,
        (select merged_into_id from public.guests
          where id = $3::uuid) source_merged_into`,
      [
        ids.mergeRaceRequest,
        ids.mergeRaceInjectedLocation,
        ids.mergeRaceSourceGuest,
      ],
    )
  ).rows[0];
  if (
    Number(mergeRaceEvidence.merge_events) !== 0 ||
    Number(mergeRaceEvidence.operation_requests) !== 0 ||
    Number(mergeRaceEvidence.injected_locations) !== 0 ||
    mergeRaceEvidence.source_merged_into !== null
  ) {
    throw new Error(
      `Post-lock merge denial left partial evidence: ${JSON.stringify(mergeRaceEvidence)}`,
    );
  }

  const mergeKernelDefinition = (
    await db.query(
      `select pg_get_functiondef(
        'public.merge_guests(uuid,uuid,uuid,numeric,jsonb)'::regprocedure
      ) definition`,
    )
  ).rows[0].definition.toLowerCase();
  const mergeLockIndex = mergeKernelDefinition.indexOf("for update");
  const mergeRecheckIndex = mergeKernelDefinition.indexOf(
    "the wrapper and the early kernel guard",
  );
  const mergeMutationIndex = mergeKernelDefinition.indexOf(
    "insert into private.guest_merge_requests",
  );
  if (
    mergeLockIndex < 0 ||
    mergeRecheckIndex <= mergeLockIndex ||
    mergeMutationIndex <= mergeRecheckIndex
  ) {
    throw new Error(
      "Merge authorization is not rechecked after stable row locks",
    );
  }

  const mergeIdentityLoopIndex = mergeKernelDefinition.indexOf(
    "for identity_lock_key in",
  );
  const mergeIdentitySortIndex = mergeKernelDefinition.indexOf(
    "order by identity_lock.key",
    mergeIdentityLoopIndex,
  );
  const mergeDriftIndex = mergeKernelDefinition.indexOf(
    "to_jsonb(source_guest) is distinct from to_jsonb(source_snapshot)",
    mergeLockIndex,
  );
  const mergeUnionIndex = mergeKernelDefinition.indexOf(
    "array_agg(distinct guest_location.location_id",
    mergeDriftIndex,
  );
  const mergeCollisionIndex = mergeKernelDefinition.indexOf(
    "resulting guest contact matches another affected profile",
    mergeUnionIndex,
  );
  if (
    mergeIdentityLoopIndex < 0 ||
    mergeIdentitySortIndex <= mergeIdentityLoopIndex ||
    mergeLockIndex <= mergeIdentitySortIndex ||
    mergeDriftIndex <= mergeLockIndex ||
    mergeUnionIndex <= mergeDriftIndex ||
    mergeCollisionIndex <= mergeUnionIndex ||
    mergeMutationIndex <= mergeCollisionIndex ||
    ![
      "source_snapshot.email",
      "source_snapshot.phone",
      "target_snapshot.email",
      "target_snapshot.phone",
      "case when result_email is not null",
      "case when result_phone is not null",
    ].every(
      (marker) =>
        mergeKernelDefinition.indexOf(marker, mergeIdentityLoopIndex) >
        mergeIdentityLoopIndex,
    )
  ) {
    throw new Error(
      "merge_guests does not lock old/result contacts before stable identity and union collision checks",
    );
  }

  await db.query(
    `insert into public.guests (
      id, organization_id, display_name, email, phone, source
    ) values
      ($1::uuid, $9::uuid, 'Merge email source',
        'merge.union.email@example.invalid', null, 'manual'),
      ($2::uuid, $9::uuid, 'Merge email target', null, null, 'manual'),
      ($3::uuid, $9::uuid, 'Merge email third',
        'merge.union.email@example.invalid', null, 'manual'),
      ($4::uuid, $9::uuid, 'Merge phone source',
        null, '+1 (917) 555-0171', 'manual'),
      ($5::uuid, $9::uuid, 'Merge phone target', null, null, 'manual'),
      ($6::uuid, $9::uuid, 'Merge phone third',
        null, '1-917-555-0171', 'manual'),
      ($7::uuid, $9::uuid, 'Merge resolver source',
        'merge.resolver.race@example.invalid', null, 'manual'),
      ($8::uuid, $9::uuid, 'Merge resolver target', null, null, 'manual')`,
    [
      ids.mergeEmailSourceGuest,
      ids.mergeEmailTargetGuest,
      ids.mergeEmailThirdGuest,
      ids.mergePhoneSourceGuest,
      ids.mergePhoneTargetGuest,
      ids.mergePhoneThirdGuest,
      ids.mergeResolverSourceGuest,
      ids.mergeResolverTargetGuest,
      ids.organization,
    ],
  );
  await db.query(
    `insert into public.guest_locations (
      organization_id, guest_id, location_id, is_home_location
    ) values
      ($1::uuid, $2::uuid, $9::uuid, true),
      ($1::uuid, $3::uuid, $8::uuid, true),
      ($1::uuid, $4::uuid, $8::uuid, false),
      ($1::uuid, $5::uuid, $9::uuid, true),
      ($1::uuid, $6::uuid, $8::uuid, true),
      ($1::uuid, $7::uuid, $8::uuid, false),
      ($1::uuid, $10::uuid, $9::uuid, true),
      ($1::uuid, $11::uuid, $8::uuid, true)`,
    [
      ids.organization,
      ids.mergeEmailSourceGuest,
      ids.mergeEmailTargetGuest,
      ids.mergeEmailThirdGuest,
      ids.mergePhoneSourceGuest,
      ids.mergePhoneTargetGuest,
      ids.mergePhoneThirdGuest,
      ids.location,
      ids.otherLocation,
      ids.mergeResolverSourceGuest,
      ids.mergeResolverTargetGuest,
    ],
  );

  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  for (const [label, requestId, sourceId, targetId] of [
    [
      "merge resultant cross-location email collision",
      ids.mergeEmailRequest,
      ids.mergeEmailSourceGuest,
      ids.mergeEmailTargetGuest,
    ],
    [
      "merge resultant normalized-phone collision",
      ids.mergePhoneRequest,
      ids.mergePhoneSourceGuest,
      ids.mergePhoneTargetGuest,
    ],
  ]) {
    await expectDatabaseError(
      () =>
        db.query(
          `select * from public.service_merge_guests(
            $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
            1, '["identity-union"]'::jsonb
          )`,
          [requestId, ids.organization, ids.location, sourceId, targetId],
        ),
      "23505",
      label,
    );
  }

  await db.exec("reset role");
  const sequentialMergeCollisionEvidence = (
    await db.query(
      `select
        (select count(*) from public.guest_merge_events
          where id = any($1::uuid[])) merge_events,
        (select count(*) from private.operation_requests
          where request_id = any($1::uuid[])) operation_requests,
        (select count(*) from public.guests
          where id = any($2::uuid[]) and merged_into_id is not null) merged_sources,
        (select count(*) from public.guests
          where id = $3::uuid and email is null) email_target_unchanged,
        (select count(*) from public.guests
          where id = $4::uuid and phone is null) phone_target_unchanged`,
      [
        [ids.mergeEmailRequest, ids.mergePhoneRequest],
        [ids.mergeEmailSourceGuest, ids.mergePhoneSourceGuest],
        ids.mergeEmailTargetGuest,
        ids.mergePhoneTargetGuest,
      ],
    )
  ).rows[0];
  if (
    Number(sequentialMergeCollisionEvidence.merge_events) !== 0 ||
    Number(sequentialMergeCollisionEvidence.operation_requests) !== 0 ||
    Number(sequentialMergeCollisionEvidence.merged_sources) !== 0 ||
    Number(sequentialMergeCollisionEvidence.email_target_unchanged) !== 1 ||
    Number(sequentialMergeCollisionEvidence.phone_target_unchanged) !== 1
  ) {
    throw new Error(
      `Merge identity collision left partial evidence: ${JSON.stringify(sequentialMergeCollisionEvidence)}`,
    );
  }

  await db.exec(`
    create function private.inject_merge_resolver_identity()
    returns trigger
    language plpgsql security definer
    set search_path = ''
    set row_security = off
    as $$
    begin
      if new.request_id = '${ids.mergeResolverRequest}'::uuid
        and new.operation_kind = 'guest.merge' then
        perform private.resolve_location_guest_identity(
          '${ids.organization}'::uuid,
          '${ids.location}'::uuid,
          null,
          '${ids.mergeResolverInjectedGuest}'::uuid,
          'none',
          'Injected merge resolver guest',
          null,
          null,
          'merge.resolver.race@example.invalid',
          null,
          'manual',
          '{}'::jsonb
        );
      end if;
      return new;
    end
    $$;

    revoke all on function private.inject_merge_resolver_identity()
    from public, anon, authenticated, service_role;

    create trigger inject_merge_resolver_identity
    after insert on private.operation_requests
    for each row execute function private.inject_merge_resolver_identity();
  `);
  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_merge_guests(
          $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
          1, '["resolver-interleaving"]'::jsonb
        )`,
        [
          ids.mergeResolverRequest,
          ids.organization,
          ids.location,
          ids.mergeResolverSourceGuest,
          ids.mergeResolverTargetGuest,
        ],
      ),
    "23505",
    "merge versus reservation identity resolver",
  );

  await db.exec("reset role");
  await db.exec(`
    drop trigger inject_merge_resolver_identity on private.operation_requests;
    drop function private.inject_merge_resolver_identity();
  `);
  const resolverMergeEvidence = (
    await db.query(
      `select
        (select count(*) from public.guest_merge_events
          where id = $1::uuid) merge_events,
        (select count(*) from private.operation_requests
          where request_id = $1::uuid) operation_requests,
        (select count(*) from public.guests
          where id = $2::uuid) injected_guests,
        (select count(*) from public.guest_locations
          where guest_id = $2::uuid) injected_locations,
        (select merged_into_id from public.guests
          where id = $3::uuid) source_merged_into,
        (select email from public.guests
          where id = $4::uuid) target_email`,
      [
        ids.mergeResolverRequest,
        ids.mergeResolverInjectedGuest,
        ids.mergeResolverSourceGuest,
        ids.mergeResolverTargetGuest,
      ],
    )
  ).rows[0];
  if (
    Number(resolverMergeEvidence.merge_events) !== 0 ||
    Number(resolverMergeEvidence.operation_requests) !== 0 ||
    Number(resolverMergeEvidence.injected_guests) !== 0 ||
    Number(resolverMergeEvidence.injected_locations) !== 0 ||
    resolverMergeEvidence.source_merged_into !== null ||
    resolverMergeEvidence.target_email !== null
  ) {
    throw new Error(
      `Merge/resolver denial left partial evidence: ${JSON.stringify(resolverMergeEvidence)}`,
    );
  }

  await db.query(
    `insert into public.guest_locations (
      id, organization_id, guest_id, location_id, is_home_location
    ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, false)`,
    [
      ids.sharedGuestLocation,
      ids.organization,
      ids.employeeGuestTarget,
      ids.otherLocation,
    ],
  );
  await db.query(
    `update public.guests
      set preferences = 'Baseline preference', allergies = 'Baseline allergy',
          notes = 'Baseline private note'
      where id = $1::uuid`,
    [ids.employeeGuestTarget],
  );
  await db.query(
    `insert into public.guests (
      id, organization_id, display_name, email, phone, source
    ) values
      ($1::uuid, $3::uuid, 'Shared email conflict',
        'shared.conflict@example.invalid', '+1 646 555 0101', 'manual'),
      ($2::uuid, $3::uuid, 'Shared phone conflict',
        'shared.phone@example.invalid', '1-212-555-0188', 'manual')`,
    [
      ids.sharedEmailConflictGuest,
      ids.sharedPhoneConflictGuest,
      ids.organization,
    ],
  );
  await db.query(
    `insert into public.guest_locations (
      id, organization_id, guest_id, location_id, is_home_location
    ) values
      ($1::uuid, $5::uuid, $3::uuid, $6::uuid, false),
      ($2::uuid, $5::uuid, $4::uuid, $6::uuid, false)`,
    [
      ids.sharedEmailConflictLocation,
      ids.sharedPhoneConflictLocation,
      ids.sharedEmailConflictGuest,
      ids.sharedPhoneConflictGuest,
      ids.organization,
      ids.otherLocation,
    ],
  );

  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_save_guest(
          'b8c00000-0000-4000-8000-000000000001'::uuid,
          $1::uuid, $2::uuid, $3::uuid,
          'Capability', 'Target', 'A-only must fail',
          'capability.target@example.invalid', '+12125550131', null, false,
          'Attempted preference', 'Attempted allergy', 'Attempted note'
        )`,
        [ids.organization, ids.location, ids.employeeGuestTarget],
      ),
    "42501",
    "A-only shared-profile guest update",
  );

  await db.exec("reset role");
  await db.query(
    `insert into public.location_memberships (
      id, organization_id, location_id, user_id, is_primary
    ) values ($1::uuid, $2::uuid, $3::uuid, $4::uuid, false)`,
    [
      ids.employeeOtherLocationMembership,
      ids.organization,
      ids.otherLocation,
      ids.employee,
    ],
  );
  await db.query(
    `insert into public.user_capability_overrides (
      id, organization_id, user_id, capability_key, location_id, effect,
      reason, effective_from, is_active, created_by, updated_by
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'guest.manage', $4::uuid,
      'grant', 'Shared-profile all-location proof', current_date, true,
      $5::uuid, $5::uuid
    )`,
    [
      ids.employeeOtherLocationManageOverride,
      ids.organization,
      ids.employee,
      ids.otherLocation,
      ids.owner,
    ],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  const sharedManageUpdate = (
    await db.query(
      `select * from public.service_save_guest(
        'b8c00000-0000-4000-8000-000000000002'::uuid,
        $1::uuid, $2::uuid, $3::uuid,
        'Capability', 'Target', 'Shared Target Managed',
        'shared.success@example.invalid', '+1 (212) 555-0142', null, false,
        'Blocked preference', 'Blocked allergy', 'Blocked note'
      )`,
      [ids.organization, ids.location, ids.employeeGuestTarget],
    )
  ).rows[0];
  if (
    sharedManageUpdate.id !== ids.employeeGuestTarget ||
    sharedManageUpdate.display_name !== "Shared Target Managed"
  ) {
    throw new Error(
      `All-location guest.manage update failed: ${JSON.stringify(sharedManageUpdate)}`,
    );
  }
  for (const [label, requestId, email, phone] of [
    [
      "shared-location duplicate email",
      "b8c00000-0000-4000-8000-000000000003",
      "shared.conflict@example.invalid",
      "+1 (212) 555-0142",
    ],
    [
      "shared-location normalized duplicate phone",
      "b8c00000-0000-4000-8000-000000000004",
      "shared.success@example.invalid",
      "+1 (212) 555-0188",
    ],
  ]) {
    await expectDatabaseError(
      () =>
        db.query(
          `select * from public.service_save_guest(
            $1::uuid, $2::uuid, $3::uuid, $4::uuid,
            'Capability', 'Target', 'Duplicate must fail',
            $5::text, $6::text, null, false,
            'Blocked preference', 'Blocked allergy', 'Blocked note'
          )`,
          [
            requestId,
            ids.organization,
            ids.location,
            ids.employeeGuestTarget,
            email,
            phone,
          ],
        ),
      "23505",
      label,
    );
  }

  await db.exec("reset role");
  let sharedGuestState = (
    await db.query(
      `select email, phone, preferences, allergies, notes
      from public.guests where id = $1::uuid`,
      [ids.employeeGuestTarget],
    )
  ).rows[0];
  if (
    sharedGuestState.email !== "shared.success@example.invalid" ||
    sharedGuestState.phone !== "+1 (212) 555-0142" ||
    sharedGuestState.preferences !== "Baseline preference" ||
    sharedGuestState.allergies !== "Baseline allergy" ||
    sharedGuestState.notes !== "Baseline private note"
  ) {
    throw new Error(
      `Manage-only update did not preserve sensitive fields: ${JSON.stringify(sharedGuestState)}`,
    );
  }
  await db.query(
    `insert into public.user_capability_overrides (
      id, organization_id, user_id, capability_key, location_id, effect,
      reason, effective_from, is_active, created_by, updated_by
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'guest.sensitive_notes.view', $4::uuid,
      'grant', 'Shared-profile partial-sensitive proof', current_date, true,
      $5::uuid, $5::uuid
    )`,
    [
      ids.employeeSharedSensitiveAOverride,
      ids.organization,
      ids.employee,
      ids.location,
      ids.owner,
    ],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_save_guest(
          'b8c00000-0000-4000-8000-000000000005'::uuid,
          $1::uuid, $2::uuid, $3::uuid,
          'Capability', 'Target', 'Partial sensitive must fail',
          'shared.success@example.invalid', '+1 (212) 555-0142', null, false,
          'Baseline preference', 'Changed allergy', 'Baseline private note'
        )`,
        [ids.organization, ids.location, ids.employeeGuestTarget],
      ),
    "42501",
    "partial-location sensitive field change",
  );
  const partialSensitiveOperationalUpdate = (
    await db.query(
      `select * from public.service_save_guest(
        'b8c00000-0000-4000-8000-000000000007'::uuid,
        $1::uuid, $2::uuid, $3::uuid,
        'Capability', 'Target', 'Shared Target Partial Sensitive',
        'shared.partial.success@example.invalid', '+1 (212) 555-0143', null, true,
        '  Baseline preference  ', 'Baseline allergy', 'Baseline private note'
      )`,
      [ids.organization, ids.location, ids.employeeGuestTarget],
    )
  ).rows[0];
  if (
    partialSensitiveOperationalUpdate.id !== ids.employeeGuestTarget ||
    partialSensitiveOperationalUpdate.display_name !==
      "Shared Target Partial Sensitive"
  ) {
    throw new Error(
      `Partial-sensitive operational update failed: ${JSON.stringify(partialSensitiveOperationalUpdate)}`,
    );
  }

  await db.exec("reset role");
  sharedGuestState = (
    await db.query(
      `select email, phone, vip, preferences, allergies, notes
      from public.guests where id = $1::uuid`,
      [ids.employeeGuestTarget],
    )
  ).rows[0];
  if (
    sharedGuestState.email !== "shared.partial.success@example.invalid" ||
    sharedGuestState.phone !== "+1 (212) 555-0143" ||
    sharedGuestState.vip !== true ||
    sharedGuestState.preferences !== "Baseline preference" ||
    sharedGuestState.allergies !== "Baseline allergy" ||
    sharedGuestState.notes !== "Baseline private note"
  ) {
    throw new Error(
      `Partial-location sensitive capability changed shared fields: ${JSON.stringify(sharedGuestState)}`,
    );
  }
  await db.query(
    `insert into public.user_capability_overrides (
      id, organization_id, user_id, capability_key, location_id, effect,
      reason, effective_from, is_active, created_by, updated_by
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'guest.sensitive_notes.view', $4::uuid,
      'grant', 'Shared-profile all-sensitive proof', current_date, true,
      $5::uuid, $5::uuid
    )`,
    [
      ids.employeeSharedSensitiveBOverride,
      ids.organization,
      ids.employee,
      ids.otherLocation,
      ids.owner,
    ],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  await db.query(
    `select * from public.service_save_guest(
      'b8c00000-0000-4000-8000-000000000006'::uuid,
      $1::uuid, $2::uuid, $3::uuid,
      'Capability', 'Target', 'Shared Target Fully Sensitive',
      'shared.partial.success@example.invalid', '+1 (212) 555-0143', null, true,
      'Authorized preference', 'Authorized allergy', 'Authorized note'
    )`,
    [ids.organization, ids.location, ids.employeeGuestTarget],
  );

  await db.exec("reset role");
  sharedGuestState = (
    await db.query(
      `select preferences, allergies, notes
      from public.guests where id = $1::uuid`,
      [ids.employeeGuestTarget],
    )
  ).rows[0];
  if (
    sharedGuestState.preferences !== "Authorized preference" ||
    sharedGuestState.allergies !== "Authorized allergy" ||
    sharedGuestState.notes !== "Authorized note"
  ) {
    throw new Error(
      `All-location sensitive update failed: ${JSON.stringify(sharedGuestState)}`,
    );
  }

  const saveGuestDefinition = (
    await db.query(
      `select pg_get_functiondef(
        'public.service_save_guest(uuid,uuid,uuid,uuid,text,text,text,text,text,date,boolean,text,text,text)'::regprocedure
      ) definition`,
    )
  ).rows[0].definition.toLowerCase();
  const identityLoopIndex = saveGuestDefinition.indexOf(
    "for identity_lock_key in",
  );
  const oldEmailKeyIndex = saveGuestDefinition.indexOf(
    "snapshot_guest.email",
    identityLoopIndex,
  );
  const oldPhoneKeyIndex = saveGuestDefinition.indexOf(
    "snapshot_guest.phone",
    identityLoopIndex,
  );
  const newEmailKeyIndex = saveGuestDefinition.indexOf(
    "case when clean_email is not null",
    identityLoopIndex,
  );
  const newPhoneKeyIndex = saveGuestDefinition.indexOf(
    "case when normalized_phone is not null",
    identityLoopIndex,
  );
  const sortedKeyIndex = saveGuestDefinition.indexOf(
    "order by identity_lock.key",
    identityLoopIndex,
  );
  const lockedGuestIndex = saveGuestDefinition.indexOf(
    "select * into locked_guest",
    sortedKeyIndex,
  );
  const staleSnapshotIndex = saveGuestDefinition.indexOf(
    "to_jsonb(locked_guest) is distinct from to_jsonb(snapshot_guest)",
    lockedGuestIndex,
  );
  const freshScopeIndex = saveGuestDefinition.indexOf(
    "p_location_id = any(affected_location_ids)",
    lockedGuestIndex,
  );
  const freshDuplicateIndex = saveGuestDefinition.indexOf(
    "guest_location.location_id = any(affected_location_ids)",
    lockedGuestIndex,
  );
  if (
    identityLoopIndex < 0 ||
    oldEmailKeyIndex <= identityLoopIndex ||
    oldPhoneKeyIndex <= identityLoopIndex ||
    newEmailKeyIndex <= identityLoopIndex ||
    newPhoneKeyIndex <= identityLoopIndex ||
    sortedKeyIndex <=
      Math.max(
        oldEmailKeyIndex,
        oldPhoneKeyIndex,
        newEmailKeyIndex,
        newPhoneKeyIndex,
      ) ||
    lockedGuestIndex <= sortedKeyIndex ||
    staleSnapshotIndex <= lockedGuestIndex ||
    freshScopeIndex <= lockedGuestIndex ||
    freshDuplicateIndex <= lockedGuestIndex
  ) {
    throw new Error(
      "service_save_guest does not lock old/new contacts before its fresh row/scope/duplicate checks",
    );
  }

  await db.query(
    `delete from public.user_capability_overrides
      where id = any($1::uuid[])`,
    [
      [
        ids.employeeOtherLocationManageOverride,
        ids.employeeSharedSensitiveAOverride,
        ids.employeeSharedSensitiveBOverride,
      ],
    ],
  );
  await db.query(`delete from public.guest_locations where id = $1::uuid`, [
    ids.sharedGuestLocation,
  ]);
  await db.query(
    `delete from public.location_memberships where id = $1::uuid`,
    [ids.employeeOtherLocationMembership],
  );
  await db.query(
    `update public.guests
      set preferences = null, allergies = null, notes = null
      where id = $1::uuid`,
    [ids.employeeGuestTarget],
  );

  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  const guestManageOperationalProfile = (
    await db.query(
      `select id, display_name, vip, visit_count, source
      from public.guests
      where id = $1::uuid`,
      [reservationGuestId],
    )
  ).rows[0];
  if (
    guestManageOperationalProfile?.id !== reservationGuestId ||
    guestManageOperationalProfile.display_name !== "Jamie Guest"
  ) {
    throw new Error(
      `guest.manage lost its minimal operational guest DTO: ${JSON.stringify(guestManageOperationalProfile)}`,
    );
  }
  const guestManageDirectory = (
    await db.query(
      `select * from public.service_guest_profiles(
        $1::uuid, $2::uuid, 'Jamie', 100
      )`,
      [ids.organization, ids.location],
    )
  ).rows;
  const guestManageSensitiveSearch = (
    await db.query(
      `select * from public.service_guest_profiles(
        $1::uuid, $2::uuid, 'Shellfish', 100
      )`,
      [ids.organization, ids.location],
    )
  ).rows;
  if (
    !guestManageDirectory.some(
      (guest) =>
        guest.id === reservationGuestId &&
        guest.email === "jamie.reservation@example.invalid",
    ) ||
    guestManageDirectory.some((guest) => guest.id === ids.remoteGuest) ||
    guestManageSensitiveSearch.length !== 0
  ) {
    throw new Error(
      `Operational guest directory leaked location or sensitive search evidence: ${JSON.stringify({ guestManageDirectory, guestManageSensitiveSearch })}`,
    );
  }
  for (const [label, query] of [
    [
      "guest.manage raw contact columns",
      `select email, phone, birthday from public.guests
        where id = '${reservationGuestId}'::uuid`,
    ],
    [
      "guest.manage raw sensitive profile columns",
      `select allergies, preferences, notes, lifetime_spend_cents,
        external_references from public.guests where id = '${reservationGuestId}'::uuid`,
    ],
    [
      "guest.manage raw note body",
      `select note, is_sensitive from public.guest_notes
        where id = '${ids.localGuestNote}'::uuid`,
    ],
    [
      "guest.manage sensitive search vector",
      `select search_vector from public.guests where id = '${reservationGuestId}'::uuid`,
    ],
  ]) {
    await expectDatabaseError(() => db.query(query), "42501", label);
  }
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_guest_sensitive_profiles(
          $1::uuid, $2::uuid, array[$3::uuid]
        )`,
        [ids.organization, ids.location, reservationGuestId],
      ),
    "42501",
    "guest.manage-only sensitive profile DTO",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_guest_sensitive_notes(
          $1::uuid, $2::uuid, array[$3::uuid]
        )`,
        [ids.organization, ids.location, reservationGuestId],
      ),
    "42501",
    "guest.manage-only sensitive note DTO",
  );
  await expectDatabaseError(
    () =>
      db.query(
        "select raw_payload from public.reservations where id = $1::uuid",
        [publicReservationId],
      ),
    "42501",
    "CRM reservation raw payload read",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_reservation_host_snapshot(
          $1::uuid, $2::uuid,
          $3::timestamptz - interval '1 hour',
          $3::timestamptz + interval '1 hour'
        )`,
        [ids.organization, ids.location, serviceTime],
      ),
    "42501",
    "guest.manage-only Host snapshot",
  );

  await db.exec("reset role");
  await db.query(
    `insert into public.user_capability_overrides (
      id, organization_id, user_id, capability_key, location_id, effect,
      reason, effective_from, is_active, created_by, updated_by
    ) values
    (
      $1::uuid, $3::uuid, $4::uuid, 'guest.manage', $5::uuid,
      'grant', 'Exact CRM command-boundary test', current_date, true,
      $6::uuid, $6::uuid
    ),
    (
      $2::uuid, $3::uuid, $4::uuid, 'guest.sensitive_notes.view', $5::uuid,
      'grant', 'Exact CRM note-boundary test', current_date, true,
      $6::uuid, $6::uuid
    )`,
    [
      ids.managerGuestManageOverride,
      ids.managerSensitiveOverride,
      ids.organization,
      ids.manager,
      ids.location,
      ids.owner,
    ],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.manager);

  const localEmailCreate = (
    await db.query(
      `select * from public.service_save_guest(
        $1::uuid, $2::uuid, $3::uuid, null,
        'Location', 'Duplicate', 'Location Duplicate',
        'remote.guest@example.invalid', '+12125550111', null, false,
        null, null, null
      )`,
      [ids.localDuplicateEmailGuest, ids.organization, ids.location],
    )
  ).rows[0];
  const localEmailReplay = (
    await db.query(
      `select * from public.service_save_guest(
        $1::uuid, $2::uuid, $3::uuid, null,
        'Location', 'Duplicate', 'Location Duplicate',
        'remote.guest@example.invalid', '+12125550111', null, false,
        null, null, null
      )`,
      [ids.localDuplicateEmailGuest, ids.organization, ids.location],
    )
  ).rows[0];
  expectExactKeys(
    localEmailCreate,
    ["id", "display_name", "updated_at"],
    "service_save_guest",
  );
  if (
    localEmailCreate.id !== ids.localDuplicateEmailGuest ||
    localEmailReplay.id !== localEmailCreate.id ||
    localEmailReplay.updated_at?.toISOString?.() !==
      localEmailCreate.updated_at?.toISOString?.()
  ) {
    throw new Error(
      `Cross-location email save/replay failed: ${JSON.stringify({ localEmailCreate, localEmailReplay })}`,
    );
  }
  const localEmailScope = (
    await db.query(
      `select count(*) count
      from public.guest_locations
      where organization_id = $1::uuid
        and guest_id = $2::uuid
        and location_id = $3::uuid`,
      [ids.organization, ids.localDuplicateEmailGuest, ids.location],
    )
  ).rows[0];
  if (Number(localEmailScope.count) !== 1)
    throw new Error("Cross-location duplicate email was not linked locally");
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_save_guest(
          'da000000-0000-4000-8000-000000000003'::uuid,
          $1::uuid, $2::uuid, null,
          'Local', 'Conflict', 'Local Conflict',
          'remote.guest@example.invalid', null, null, false,
          null, null, null
        )`,
        [ids.organization, ids.location],
      ),
    "23505",
    "same-location duplicate email",
  );

  const consentCreate = (
    await db.query(
      `select * from public.service_record_guest_consent(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        'email', 'granted'::public.consent_status, 'Front desk opt-in'
      )`,
      [
        ids.localGuestConsent,
        ids.organization,
        ids.location,
        ids.localDuplicateEmailGuest,
      ],
    )
  ).rows[0];
  const consentReplay = (
    await db.query(
      `select * from public.service_record_guest_consent(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid,
        'email', 'granted'::public.consent_status, 'Front desk opt-in'
      )`,
      [
        ids.localGuestConsent,
        ids.organization,
        ids.location,
        ids.localDuplicateEmailGuest,
      ],
    )
  ).rows[0];
  expectExactKeys(
    consentCreate,
    ["id", "captured_at"],
    "service_record_guest_consent",
  );
  if (
    consentCreate.id !== ids.localGuestConsent ||
    consentReplay.id !== consentCreate.id
  ) {
    throw new Error(
      `Consent fixed DTO replay failed: ${JSON.stringify({ consentCreate, consentReplay })}`,
    );
  }

  const noteCreate = (
    await db.query(
      `select * from public.service_add_guest_note(
        $1::uuid, $2::uuid, $3::uuid, 'Combined-capability note', true
      )`,
      [ids.localGuestNoteCommand, ids.localDuplicateEmailGuest, ids.location],
    )
  ).rows[0];
  const noteReplay = (
    await db.query(
      `select * from public.service_add_guest_note(
        $1::uuid, $2::uuid, $3::uuid, 'Combined-capability note', true
      )`,
      [ids.localGuestNoteCommand, ids.localDuplicateEmailGuest, ids.location],
    )
  ).rows[0];
  expectExactKeys(noteCreate, ["id", "created_at"], "service_add_guest_note");
  if (
    noteCreate.id !== ids.localGuestNoteCommand ||
    noteReplay.id !== noteCreate.id
  ) {
    throw new Error(
      `Note fixed DTO replay failed: ${JSON.stringify({ noteCreate, noteReplay })}`,
    );
  }

  const localMergeSource = (
    await db.query(
      `select * from public.service_save_guest(
        $1::uuid, $2::uuid, $3::uuid, null,
        'Merge', 'Source', 'Merge Source',
        'merge.source@example.invalid', null, null, false,
        null, null, null
      )`,
      [ids.localMergeSourceGuest, ids.organization, ids.location],
    )
  ).rows[0];
  if (localMergeSource.id !== ids.localMergeSourceGuest)
    throw new Error("Local merge source creation failed");

  const mergeCreate = (
    await db.query(
      `select * from public.service_merge_guests(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        1, '["same-location-test"]'::jsonb
      )`,
      [
        ids.localGuestMerge,
        ids.organization,
        ids.location,
        ids.localMergeSourceGuest,
        ids.localDuplicateEmailGuest,
      ],
    )
  ).rows[0];
  const mergeReplay = (
    await db.query(
      `select * from public.service_merge_guests(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        1, '["same-location-test"]'::jsonb
      )`,
      [
        ids.localGuestMerge,
        ids.organization,
        ids.location,
        ids.localMergeSourceGuest,
        ids.localDuplicateEmailGuest,
      ],
    )
  ).rows[0];
  expectExactKeys(
    mergeCreate,
    ["id", "source_guest_id", "target_guest_id", "merged_at"],
    "service_merge_guests",
  );
  if (
    mergeCreate.id !== ids.localGuestMerge ||
    mergeCreate.source_guest_id !== ids.localMergeSourceGuest ||
    mergeCreate.target_guest_id !== ids.localDuplicateEmailGuest ||
    mergeReplay.id !== mergeCreate.id
  ) {
    throw new Error(
      `Merge fixed DTO replay failed: ${JSON.stringify({ mergeCreate, mergeReplay })}`,
    );
  }

  await db.exec("reset role");
  await db.query(
    `update public.user_capability_overrides
      set effective_from = current_date - 2, effective_to = current_date - 1,
          updated_at = clock_timestamp()
      where id = $1::uuid`,
    [ids.capabilityOverride],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  const expiredGuestScope = (
    await db.query(
      `select
        (select count(*) from public.guests where id = $1::uuid) guests,
        (select count(*) from public.guest_notes where id = $2::uuid) notes,
        (select count(*) from public.guest_tags where id = $3::uuid) tags`,
      [reservationGuestId, ids.localGuestNote, ids.remoteGuestTag],
    )
  ).rows[0];
  if (Object.values(expiredGuestScope).some((value) => Number(value) !== 0))
    throw new Error("Expired guest.manage capability still exposed CRM rows");
  for (const [label, query, params] of [
    [
      "expired employee guest save",
      `select * from public.service_save_guest(
        'd8500000-0000-4000-8000-000000000001'::uuid,
        $1::uuid, $2::uuid, null,
        'Expired', 'Capability', 'Expired Capability',
        'expired.capability@example.invalid', null, null, false,
        null, null, null
      )`,
      [ids.organization, ids.location],
    ],
    [
      "expired employee guest consent",
      `select * from public.service_record_guest_consent(
        'd8500000-0000-4000-8000-000000000002'::uuid,
        $1::uuid, $2::uuid, $3::uuid,
        'email', 'revoked'::public.consent_status, 'Expired capability'
      )`,
      [ids.organization, ids.location, ids.employeeGuestTarget],
    ],
    [
      "expired employee guest note",
      `select * from public.service_add_guest_note(
        'd8500000-0000-4000-8000-000000000003'::uuid,
        $1::uuid, $2::uuid, 'Expired capability note', true
      )`,
      [ids.employeeGuestTarget, ids.location],
    ],
    [
      "expired employee guest merge replay",
      `select * from public.service_merge_guests(
        $1::uuid, $2::uuid, $3::uuid, $4::uuid, $5::uuid,
        1, '["capability-employee"]'::jsonb
      )`,
      [
        ids.employeeGuestMerge,
        ids.organization,
        ids.location,
        ids.employeeGuestSource,
        ids.employeeGuestTarget,
      ],
    ],
  ]) {
    await expectDatabaseError(() => db.query(query, params), "42501", label);
  }

  await db.exec("reset role");
  await db.query(
    `update public.user_capability_overrides
      set capability_key = 'reports.operational.view',
          effective_from = current_date, effective_to = null,
          updated_at = clock_timestamp()
      where id = $1::uuid`,
    [ids.capabilityOverride],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  const reportReservationRows = (
    await db.query(
      `select id, location_id, guest_id, reserved_at, party_size, status,
        source, created_at, updated_at
      from public.reservations
      where id = $1::uuid`,
      [publicReservationId],
    )
  ).rows;
  if (reportReservationRows.length !== 1)
    throw new Error(
      "Exact reports.operational.view reservation evidence read was not preserved",
    );
  await expectDatabaseError(
    () =>
      db.query(
        "select external_id from public.reservations where id = $1::uuid",
        [publicReservationId],
      ),
    "42501",
    "operational report reservation provider identifier read",
  );

  await db.exec("reset role");
  await db.query(
    `update public.user_capability_overrides
      set capability_key = 'guest.sensitive_notes.view',
          updated_at = clock_timestamp()
      where id = $1::uuid`,
    [ids.capabilityOverride],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  await expectDatabaseError(
    () =>
      db.query(
        `select allergies, preferences, notes, lifetime_spend_cents,
          external_references from public.guests where id = $1::uuid`,
        [reservationGuestId],
      ),
    "42501",
    "sensitive capability direct raw profile read",
  );
  await expectDatabaseError(
    () =>
      db.query(
        "select note, is_sensitive from public.guest_notes where id = $1::uuid",
        [ids.localGuestNote],
      ),
    "42501",
    "sensitive capability direct raw note read",
  );
  const sensitiveProfileDto = (
    await db.query(
      `select * from public.service_guest_sensitive_profiles(
        $1::uuid, $2::uuid, array[$3::uuid, $4::uuid]
      )`,
      [ids.organization, ids.location, reservationGuestId, ids.remoteGuest],
    )
  ).rows;
  const sensitiveDirectorySearch = (
    await db.query(
      `select * from public.service_guest_profiles(
        $1::uuid, $2::uuid, 'Shellfish', 100
      )`,
      [ids.organization, ids.location],
    )
  ).rows;
  const sensitiveDirectoryContactSearch = (
    await db.query(
      `select * from public.service_guest_profiles(
        $1::uuid, $2::uuid, 'jamie.reservation@example.invalid', 100
      )`,
      [ids.organization, ids.location],
    )
  ).rows;
  const sensitiveDirectoryProviderSearch = (
    await db.query(
      `select * from public.service_guest_profiles(
        $1::uuid, $2::uuid, 'le_yard_web', 100
      )`,
      [ids.organization, ids.location],
    )
  ).rows;
  const sensitiveNoteDto = (
    await db.query(
      `select * from public.service_guest_sensitive_notes(
        $1::uuid, $2::uuid, array[$3::uuid, $4::uuid]
      )`,
      [ids.organization, ids.location, reservationGuestId, ids.remoteGuest],
    )
  ).rows;
  const sensitiveVisitRows = (
    await db.query(
      `select id, organization_id, location_id, guest_id, visited_at,
        party_size, covers, spend_cents, source, notes, created_at
      from public.guest_visits
      where guest_id = $1::uuid
      order by visited_at, id`,
      [reservationGuestId],
    )
  ).rows;
  const sensitiveMetrics = (
    await db.query(
      `select * from public.service_guest_sensitive_metrics($1::uuid, $2::uuid)`,
      [ids.organization, ids.location],
    )
  ).rows[0];
  if (
    sensitiveProfileDto.length !== 1 ||
    sensitiveProfileDto[0].id !== reservationGuestId ||
    sensitiveProfileDto[0].allergies !== "Shellfish" ||
    sensitiveProfileDto[0].preferences !== "Quiet corner" ||
    sensitiveProfileDto[0].notes !== "Local private profile note" ||
    Number(sensitiveProfileDto[0].lifetime_spend_cents) !== 0 ||
    sensitiveDirectorySearch.length !== 1 ||
    sensitiveDirectorySearch[0].id !== reservationGuestId ||
    sensitiveDirectorySearch[0].email !== null ||
    sensitiveDirectorySearch[0].phone !== null ||
    sensitiveDirectorySearch[0].birthday !== null ||
    sensitiveDirectoryContactSearch.length !== 0 ||
    sensitiveDirectoryProviderSearch.length !== 0 ||
    sensitiveNoteDto.length !== 1 ||
    sensitiveNoteDto[0].id !== ids.localGuestNote ||
    sensitiveNoteDto[0].note !== "Downtown guest context" ||
    sensitiveNoteDto[0].is_sensitive !== true ||
    sensitiveVisitRows.length !== 1 ||
    sensitiveVisitRows[0].id !== ids.guestVisit ||
    sensitiveVisitRows[0].location_id !== ids.location ||
    Number(sensitiveVisitRows[0].spend_cents) !== 10000 ||
    Number(sensitiveMetrics.profiles_with_allergies) !== 1
  ) {
    throw new Error(
      `Sensitive guest DTO escaped or omitted its exact location scope: ${JSON.stringify({ sensitiveProfileDto, sensitiveDirectorySearch, sensitiveDirectoryContactSearch, sensitiveDirectoryProviderSearch, sensitiveNoteDto, sensitiveVisitRows, sensitiveMetrics })}`,
    );
  }
  await expectDatabaseError(
    () =>
      db.query(
        `select reservation_id_external, check_reference, server_employee_id
        from public.guest_visits where guest_id = $1::uuid`,
        [reservationGuestId],
      ),
    "42501",
    "sensitive capability visit provider/check/server identifiers",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_save_guest(
          'd7300000-0000-4000-8000-000000000001'::uuid,
          $1::uuid,
          $2::uuid,
          null,
          'Probe', 'Guest', 'Probe Guest',
          'jamie.reservation@example.invalid', null, null, false,
          null, null, null
        )`,
        [ids.organization, ids.location],
      ),
    "42501",
    "sensitive-only guest contact command and email probe",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_add_guest_note(
          'df000000-0000-4000-8000-000000000006'::uuid,
          $1::uuid, $2::uuid, 'Sensitive-only note body', true
        )`,
        [reservationGuestId, ids.location],
      ),
    "42501",
    "sensitive-only note append",
  );
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_guest_sensitive_profiles(
          $1::uuid, $2::uuid, array[$3::uuid]
        )`,
        [ids.organization, ids.otherLocation, ids.remoteGuest],
      ),
    "42501",
    "cross-location sensitive profile DTO",
  );
  const sensitiveGuestScope = (
    await db.query(
      `select
        (select count(*) from public.guests where id = $1::uuid) local_guest,
        (select count(*) from public.guest_notes where id = $2::uuid) local_note,
        (select count(*) from public.guests where id = $3::uuid) remote_guest,
        (select count(*) from public.guest_notes where id = $4::uuid) remote_note,
        (select count(*) from public.guest_locations where guest_id = $1::uuid) locations,
        (select count(*) from public.guest_tags where id = $5::uuid) tags`,
      [
        reservationGuestId,
        ids.localGuestNote,
        ids.remoteGuest,
        ids.remoteGuestNote,
        ids.remoteGuestTag,
      ],
    )
  ).rows[0];
  if (
    Number(sensitiveGuestScope.local_guest) !== 1 ||
    Number(sensitiveGuestScope.local_note) !== 1 ||
    ["remote_guest", "remote_note", "locations", "tags"].some(
      (key) => Number(sensitiveGuestScope[key]) !== 0,
    )
  ) {
    throw new Error(
      `Sensitive-note capability escaped its linked guest scope: ${JSON.stringify(sensitiveGuestScope)}`,
    );
  }

  await db.exec("reset role");
  await db.query(
    `update public.user_capability_overrides
      set effect = 'grant', effective_from = current_date - 2,
          effective_to = current_date - 1, updated_at = clock_timestamp()
      where id = $1::uuid`,
    [ids.capabilityOverride],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_guest_sensitive_profiles(
          $1::uuid, $2::uuid, array[$3::uuid]
        )`,
        [ids.organization, ids.location, reservationGuestId],
      ),
    "42501",
    "expired sensitive guest capability",
  );

  await db.exec("reset role");
  await db.query(
    `update public.user_capability_overrides
      set effect = 'deny', effective_from = current_date,
          effective_to = null, updated_at = clock_timestamp()
      where id = $1::uuid`,
    [ids.capabilityOverride],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.employee);
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_guest_sensitive_notes(
          $1::uuid, $2::uuid, array[$3::uuid]
        )`,
        [ids.organization, ids.location, reservationGuestId],
      ),
    "42501",
    "explicitly denied sensitive guest capability",
  );

  await db.exec("reset role");
  await db.exec("set role authenticated");
  await assumeUser(ids.otherTenantOwner);
  const crossTenantDirectCount = Number(
    (
      await db.query(
        "select count(id) count from public.reservations where id = $1::uuid",
        [ids.staffReservation],
      )
    ).rows[0].count,
  );
  if (crossTenantDirectCount !== 0)
    throw new Error("Reservation safe columns leaked across tenants");
  await expectDatabaseError(
    () =>
      db.query(
        `select * from public.service_reservation_host_snapshot(
          $1::uuid, $2::uuid,
          $3::timestamptz - interval '1 hour',
          $3::timestamptz + interval '1 hour'
        )`,
        [ids.organization, ids.location, serviceTime],
      ),
    "42501",
    "cross-tenant reservation Host snapshot",
  );

  await db.exec("reset role");
  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  await expectDatabaseError(
    () =>
      db.query(
        "select allergies, external_references from public.guests where id = $1::uuid",
        [reservationGuestId],
      ),
    "42501",
    "Owner direct raw sensitive guest columns",
  );
  await expectDatabaseError(
    () =>
      db.query(
        "select note, is_sensitive from public.guest_notes where id = $1::uuid",
        [ids.localGuestNote],
      ),
    "42501",
    "Owner direct raw guest note body",
  );
  const ownerSensitiveProfiles = (
    await db.query(
      `select * from public.service_guest_sensitive_profiles(
        $1::uuid, $2::uuid, array[$3::uuid, $4::uuid]
      )`,
      [ids.organization, ids.location, reservationGuestId, ids.remoteGuest],
    )
  ).rows;
  const ownerSensitiveNotes = (
    await db.query(
      `select * from public.service_guest_sensitive_notes(
        $1::uuid, $2::uuid, array[$3::uuid, $4::uuid]
      )`,
      [ids.organization, ids.location, reservationGuestId, ids.remoteGuest],
    )
  ).rows;
  const ownerGuestDirectory = (
    await db.query(
      `select * from public.service_guest_profiles(
        $1::uuid, $2::uuid, null, 100, array[$3::uuid, $4::uuid]
      )`,
      [ids.organization, ids.location, reservationGuestId, ids.remoteGuest],
    )
  ).rows;
  if (
    ownerSensitiveProfiles.length !== 2 ||
    !ownerSensitiveProfiles.some(
      (guest) =>
        guest.id === ids.remoteGuest &&
        guest.notes === "Remote private note" &&
        Number(guest.lifetime_spend_cents) === 76543,
    ) ||
    ownerSensitiveNotes.length !== 2 ||
    !ownerSensitiveNotes.some(
      (note) =>
        note.id === ids.remoteGuestNote &&
        note.note === "Uptown-only guest context",
    ) ||
    ownerGuestDirectory.length !== 2 ||
    !ownerGuestDirectory.some(
      (guest) =>
        guest.id === reservationGuestId &&
        guest.email === "jamie.reservation@example.invalid",
    )
  ) {
    throw new Error(
      `Owner/Admin tenant-wide guest DTO semantics regressed: ${JSON.stringify({ ownerSensitiveProfiles, ownerSensitiveNotes, ownerGuestDirectory })}`,
    );
  }
  const ownerGuestCount = Number(
    (
      await db.query(
        "select count(*) count from public.guests where id = $1::uuid",
        [reservationGuestId],
      )
    ).rows[0].count,
  );
  if (ownerGuestCount !== 1)
    throw new Error(
      "Authorized Guests workspace access was not preserved for Owner",
    );
  const ownerRemoteGuestEvidence = (
    await db.query(
      `select
        (select count(*) from public.guests where id = $1::uuid) guests,
        (select count(*) from public.guest_locations where guest_id = $1::uuid) locations,
        (select count(*) from public.guest_contacts where guest_id = $1::uuid) contacts,
        (select count(*) from public.guest_notes where guest_id = $1::uuid) notes,
        (select count(*) from public.guest_tag_assignments where guest_id = $1::uuid) tag_assignments,
        (select count(*) from public.guest_consents where guest_id = $1::uuid) consents,
        (select count(*) from public.guest_merge_events where id = $2::uuid) merge_events`,
      [ids.remoteGuest, ids.remoteGuestMerge],
    )
  ).rows[0];
  if (
    Object.values(ownerRemoteGuestEvidence).some((value) => Number(value) !== 1)
  ) {
    throw new Error(
      `Owner org-wide guest access was not preserved: ${JSON.stringify(ownerRemoteGuestEvidence)}`,
    );
  }
  await expectDatabaseError(
    () =>
      db.query(
        "select public_code from public.reservations where id = $1::uuid",
        [publicReservationId],
      ),
    "42501",
    "Owner browser reservation management identifier read",
  );
  const ownerVisitCount = Number(
    (await db.query("select count(*) count from public.guest_visits")).rows[0]
      .count,
  );
  if (ownerVisitCount !== 2)
    throw new Error(
      "Authorized guest-visit workspace access was not preserved for Owner",
    );

  await db.exec("reset role");
  await db.query("select set_config('request.jwt.claims', '{}', false)");
  const evidence = (
    await db.query(
      `
      select
        (select count(*) from public.reservation_events
          where reservation_id in ($1::uuid, $2::uuid)) as event_count,
        (select count(*) from public.reservation_message_outbox
          where reservation_id = $2::uuid) as message_count,
        (select count(*) from public.reservation_table_allocations
          where reservation_id = $2::uuid and is_active) as active_allocations
    `,
      [ids.staffReservation, publicReservationId],
    )
  ).rows[0];
  if (
    Number(evidence.event_count) < 4 ||
    Number(evidence.message_count) !== 3 ||
    Number(evidence.active_allocations) !== 0
  ) {
    throw new Error(
      `Reservation evidence is incomplete: ${JSON.stringify(evidence)}`,
    );
  }

  // Keep direct hold fixtures inside the configured 17:00-23:00 service in
  // the location timezone; `serviceTime` is derived in the database session
  // timezone and can land at 23:30 local on non-UTC runners.
  const claimGuardNow = new Date(publicTime).toISOString();
  const claimGuardIds = {
    nonPendingHold: "e1000000-0000-4000-8000-000000000001",
    liveHold: "e1000000-0000-4000-8000-000000000002",
    nearExpiryHold: "e1000000-0000-4000-8000-000000000003",
    expiredWaitlist: "e2000000-0000-4000-8000-000000000001",
    invalidWaitlist: "e2000000-0000-4000-8000-000000000002",
    liveWaitlist: "e2000000-0000-4000-8000-000000000003",
    nearExpiryWaitlist: "e2000000-0000-4000-8000-000000000004",
    cancelledReservation: "e3000000-0000-4000-8000-000000000001",
    pastReservation: "e3000000-0000-4000-8000-000000000002",
    liveReminderReservation: "e3000000-0000-4000-8000-000000000003",
  };

  await db.query(
    `insert into private.public_booking_holds (
      id, organization_id, location_id, reserved_at, duration_minutes,
      party_size, public_code, first_name, last_name, email, phone,
      expires_at, created_at, updated_at
    )
    select
      md5('claim-guard-expired-hold:' || fixture.value::text)::uuid,
      $1::uuid, $2::uuid, $3::timestamptz + interval '1 day', 120, 2,
      'ZX' || lpad(fixture.value::text, 6, '0'), 'Expired', 'Guard',
      'expired.guard@example.invalid', '+12125550100',
      $3::timestamptz - interval '1 minute',
      '1999-01-01 00:00:00+00'::timestamptz
        + fixture.value * interval '1 millisecond',
      $3::timestamptz
    from generate_series(1, 501) fixture(value)`,
    [ids.organization, ids.location, claimGuardNow],
  );
  await db.query(
    `insert into private.public_booking_holds (
      id, organization_id, location_id, reserved_at, duration_minutes,
      party_size, public_code, status, expires_at, verified_at, redacted_at,
      created_at, updated_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::timestamptz + interval '1 day',
      90, 2, 'ZXDONE01', 'verified', $4::timestamptz + interval '1 hour',
      $4::timestamptz, $4::timestamptz,
      '2000-01-02 00:00:00+00'::timestamptz, $4::timestamptz
    )`,
    [
      claimGuardIds.nonPendingHold,
      ids.organization,
      ids.location,
      claimGuardNow,
    ],
  );
  await db.query(
    `insert into private.public_booking_holds (
      id, organization_id, location_id, reserved_at, duration_minutes,
      party_size, public_code, first_name, last_name, email, phone,
      expires_at, created_at, updated_at
    ) values
    (
      $1::uuid, $2::uuid, $3::uuid, $4::timestamptz + interval '1 day',
      120, 2, 'ZXLIVE01', 'Live', 'Guard', 'live.guard@example.invalid',
      '+12125550101', $4::timestamptz + interval '1 hour',
      '2000-01-03 00:00:00+00'::timestamptz, $4::timestamptz
    ),
    (
      $5::uuid, $2::uuid, $3::uuid, $4::timestamptz + interval '1 day',
      120, 2, 'ZXNEAR01', 'Near', 'Expiry', 'near.expiry@example.invalid',
      '+12125550105', $4::timestamptz + interval '15 seconds',
      '2000-01-02 18:00:00+00'::timestamptz, $4::timestamptz
    )`,
    [
      claimGuardIds.liveHold,
      ids.organization,
      ids.location,
      claimGuardNow,
      claimGuardIds.nearExpiryHold,
    ],
  );
  await db.query(
    `insert into public.reservation_message_outbox (
      id, organization_id, location_id, booking_hold_id, channel,
      template_key, dedupe_key, next_attempt_at, created_at, updated_at
    )
    select
      md5('claim-guard-expired-message:' || fixture.value::text)::uuid,
      $1::uuid, $2::uuid,
      md5('claim-guard-expired-hold:' || fixture.value::text)::uuid,
      'email', 'reservation_verify',
      'claim-guard:hold:expired:' || fixture.value::text,
      '1999-01-01 00:00:00+00'::timestamptz
        + fixture.value * interval '1 millisecond',
      '1999-01-01 00:00:00+00'::timestamptz
        + fixture.value * interval '1 millisecond',
      $3::timestamptz
    from generate_series(1, 501) fixture(value)`,
    [ids.organization, ids.location, claimGuardNow],
  );
  await db.query(
    `insert into public.reservation_message_outbox (
      organization_id, location_id, booking_hold_id, channel, template_key,
      template_data, dedupe_key, next_attempt_at, created_at, updated_at
    ) values
      ($1::uuid, $2::uuid, $4::uuid, 'email', 'reservation_verify',
       '{"purpose":"reservation_verify","channel":"email"}'::jsonb,
       'claim-guard:hold:non-pending', '2000-01-02 00:00:00+00',
       '2000-01-02 00:00:00+00', $6::timestamptz),
      ($1::uuid, $3::uuid, $5::uuid, 'email', 'reservation_verify',
       '{"purpose":"reservation_verify","channel":"email"}'::jsonb,
       'claim-guard:hold:wrong-location', '2000-01-02 12:00:00+00',
       '2000-01-02 12:00:00+00', $6::timestamptz),
      ($1::uuid, $2::uuid, $7::uuid, 'email', 'reservation_verify',
       '{"purpose":"reservation_verify","channel":"email"}'::jsonb,
       'claim-guard:hold:near-expiry', '2000-01-02 18:00:00+00',
       '2000-01-02 18:00:00+00', $6::timestamptz),
      ($1::uuid, $2::uuid, $5::uuid, 'email', 'reservation_verify',
       '{"purpose":"reservation_verify","channel":"email"}'::jsonb,
       'claim-guard:hold:live', '2000-01-03 00:00:00+00',
       '2000-01-03 00:00:00+00', $6::timestamptz)`,
    [
      ids.organization,
      ids.location,
      ids.otherLocation,
      claimGuardIds.nonPendingHold,
      claimGuardIds.liveHold,
      claimGuardNow,
      claimGuardIds.nearExpiryHold,
    ],
  );

  await db.query(
    `insert into public.waitlist_entries (
      id, organization_id, location_id, display_name, email, phone,
      party_size, status, notified_at, offer_expires_at, created_at, updated_at
    ) values
      ($1::uuid, $5::uuid, $6::uuid, 'Expired Offer',
       'expired.offer@example.invalid', '+12125550102', 2, 'notified',
       $7::timestamptz - interval '20 minutes',
       $7::timestamptz - interval '5 minutes',
       '2000-01-04 00:00:00+00', $7::timestamptz),
      ($2::uuid, $5::uuid, $6::uuid, 'Accepted Offer',
       'accepted.offer@example.invalid', '+12125550103', 2, 'accepted',
       $7::timestamptz - interval '1 minute',
       $7::timestamptz + interval '15 minutes',
       '2000-01-04 01:00:00+00', $7::timestamptz),
      ($3::uuid, $5::uuid, $6::uuid, 'Near-expiry Offer',
       'near.offer@example.invalid', '+12125550106', 2, 'notified',
       $7::timestamptz - interval '1 minute',
       $7::timestamptz + interval '15 seconds',
       '2000-01-04 02:00:00+00', $7::timestamptz),
      ($4::uuid, $5::uuid, $6::uuid, 'Live Offer',
       'live.offer@example.invalid', '+12125550104', 2, 'notified',
       $7::timestamptz - interval '1 minute',
       $7::timestamptz + interval '15 minutes',
       '2000-01-05 00:00:00+00', $7::timestamptz)`,
    [
      claimGuardIds.expiredWaitlist,
      claimGuardIds.invalidWaitlist,
      claimGuardIds.nearExpiryWaitlist,
      claimGuardIds.liveWaitlist,
      ids.organization,
      ids.location,
      claimGuardNow,
    ],
  );
  await db.query(
    `insert into public.reservation_message_outbox (
      organization_id, location_id, waitlist_entry_id, channel, template_key,
      dedupe_key, next_attempt_at, created_at, updated_at
    ) values
      ($1::uuid, $2::uuid, $4::uuid, 'email', 'waitlist_table_ready',
       'claim-guard:waitlist:expired', '2000-01-04 00:00:00+00',
       '2000-01-04 00:00:00+00', $8::timestamptz),
      ($1::uuid, $2::uuid, $5::uuid, 'email', 'waitlist_table_ready',
       'claim-guard:waitlist:invalid-status', '2000-01-04 01:00:00+00',
       '2000-01-04 01:00:00+00', $8::timestamptz),
      ($1::uuid, $2::uuid, $6::uuid, 'email', 'waitlist_table_ready',
       'claim-guard:waitlist:near-expiry', '2000-01-04 02:00:00+00',
       '2000-01-04 02:00:00+00', $8::timestamptz),
      ($1::uuid, $3::uuid, $7::uuid, 'email', 'waitlist_table_ready',
       'claim-guard:waitlist:wrong-location', '2000-01-04 02:00:00+00',
       '2000-01-04 02:00:00+00', $8::timestamptz),
      ($1::uuid, $2::uuid, $7::uuid, 'email', 'waitlist_table_ready',
       'claim-guard:waitlist:live', '2000-01-05 00:00:00+00',
       '2000-01-05 00:00:00+00', $8::timestamptz)`,
    [
      ids.organization,
      ids.location,
      ids.otherLocation,
      claimGuardIds.expiredWaitlist,
      claimGuardIds.invalidWaitlist,
      claimGuardIds.nearExpiryWaitlist,
      claimGuardIds.liveWaitlist,
      claimGuardNow,
    ],
  );

  await db.query(
    `insert into public.reservations (
      id, organization_id, location_id, reserved_at, duration_minutes,
      party_size, status, source, booking_channel, cancelled_at,
      created_at, updated_at
    ) values
      ($1::uuid, $4::uuid, $5::uuid, $6::timestamptz + interval '1 day',
       90, 2, 'cancelled', 'manual', 'staff', $6::timestamptz,
       '2000-01-06 00:00:00+00', $6::timestamptz),
      ($2::uuid, $4::uuid, $5::uuid, $6::timestamptz - interval '1 minute',
       90, 2, 'booked', 'manual', 'staff', null,
       '2000-01-06 01:00:00+00', $6::timestamptz),
      ($3::uuid, $4::uuid, $5::uuid, $6::timestamptz + interval '1 hour',
       90, 2, 'confirmed', 'manual', 'staff', null,
       '2000-01-07 00:00:00+00', $6::timestamptz)`,
    [
      claimGuardIds.cancelledReservation,
      claimGuardIds.pastReservation,
      claimGuardIds.liveReminderReservation,
      ids.organization,
      ids.location,
      claimGuardNow,
    ],
  );
  await expectDatabaseError(
    () =>
      db.query(
        `insert into public.reservation_message_outbox (
          organization_id, location_id, reservation_id, channel, template_key,
          template_data, dedupe_key, next_attempt_at
        ) values (
          $1::uuid, $2::uuid, $3::uuid, 'email',
          'reservation_reminder_2h',
          jsonb_build_object('reservationVersion', 1),
          'claim-guard:non-web-reminder', clock_timestamp()
        )`,
        [ids.organization, ids.location, claimGuardIds.liveReminderReservation],
      ),
    "23514",
    "non-web reservation lifecycle outbox insert",
  );

  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await db.query(
    "select public.service_enqueue_reservation_reminders($1::timestamptz)",
    [claimGuardNow],
  );
  await db.exec("reset role");
  const nonWebReminderCount = Number(
    (
      await db.query(
        `select count(*) count from public.reservation_message_outbox
        where reservation_id = $1::uuid
          and template_key in (
            'reservation_confirmed', 'reservation_modified',
            'reservation_cancelled', 'reservation_reminder_24h',
            'reservation_reminder_2h'
          )`,
        [claimGuardIds.liveReminderReservation],
      )
    ).rows[0].count,
  );
  if (nonWebReminderCount !== 0) {
    throw new Error("The scheduler queued a non-web reservation message");
  }
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const liveHoldClaim = (
    await db.query(
      "select * from public.service_claim_reservation_message_outbox($1::uuid, 1, 30, $2::timestamptz)",
      ["e4000000-0000-4000-8000-000000000001", claimGuardNow],
    )
  ).rows;
  const liveHoldDispatch = liveHoldClaim[0]
    ? (
        await db.query(
          `select public.service_begin_reservation_message_delivery(
            $1::uuid, $2::uuid, $3::timestamptz
          ) result`,
          [liveHoldClaim[0].id, liveHoldClaim[0].claimToken, claimGuardNow],
        )
      ).rows[0].result
    : null;
  if (
    liveHoldClaim.length !== 1 ||
    liveHoldDispatch?.bookingHoldId !== claimGuardIds.liveHold ||
    liveHoldDispatch?.templateKey !== "reservation_verify"
  ) {
    throw new Error(
      `Stale verification rows blocked the live claim: ${JSON.stringify({ liveHoldClaim, liveHoldDispatch })}`,
    );
  }
  await db.query(
    "select public.service_complete_reservation_message_outbox($1::uuid, $2::uuid, 'sent', null, null, 'claim-guard-hold')",
    [liveHoldClaim[0].id, liveHoldClaim[0].claimToken],
  );

  const liveWaitlistClaim = (
    await db.query(
      "select * from public.service_claim_reservation_message_outbox($1::uuid, 1, 30, $2::timestamptz)",
      ["e4000000-0000-4000-8000-000000000002", claimGuardNow],
    )
  ).rows;
  const liveWaitlistDispatch = liveWaitlistClaim[0]
    ? (
        await db.query(
          `select public.service_begin_reservation_message_delivery(
            $1::uuid, $2::uuid, $3::timestamptz
          ) result`,
          [
            liveWaitlistClaim[0].id,
            liveWaitlistClaim[0].claimToken,
            claimGuardNow,
          ],
        )
      ).rows[0].result
    : null;
  if (
    liveWaitlistClaim.length !== 1 ||
    liveWaitlistDispatch?.waitlistEntryId !== claimGuardIds.liveWaitlist ||
    liveWaitlistDispatch?.templateKey !== "waitlist_table_ready"
  ) {
    throw new Error(
      `Stale waitlist rows blocked the live claim: ${JSON.stringify({ liveWaitlistClaim, liveWaitlistDispatch })}`,
    );
  }
  await db.query(
    "select public.service_complete_reservation_message_outbox($1::uuid, $2::uuid, 'sent', null, null, 'claim-guard-waitlist')",
    [liveWaitlistClaim[0].id, liveWaitlistClaim[0].claimToken],
  );

  await db.exec("reset role");
  const deadClaimEvidence = (
    await db.query(
      `select
        (select count(*) from public.reservation_message_outbox
          where dedupe_key like 'claim-guard:hold:%'
            and dedupe_key <> 'claim-guard:hold:live') hold_count,
        (select count(*) from public.reservation_message_outbox
          where dedupe_key like 'claim-guard:hold:%'
            and dedupe_key <> 'claim-guard:hold:live'
            and status = 'queued' and attempts = 0) untouched_holds,
        (select count(*) from public.reservation_message_outbox
          where dedupe_key like 'claim-guard:waitlist:%'
            and dedupe_key <> 'claim-guard:waitlist:live') waitlist_count,
        (select count(*) from public.reservation_message_outbox
          where dedupe_key like 'claim-guard:waitlist:%'
            and dedupe_key <> 'claim-guard:waitlist:live'
            and status = 'queued' and attempts = 0) untouched_waitlist`,
    )
  ).rows[0];
  if (
    Number(deadClaimEvidence.hold_count) !== 504 ||
    Number(deadClaimEvidence.untouched_holds) !== 503 ||
    Number(deadClaimEvidence.waitlist_count) !== 4 ||
    Number(deadClaimEvidence.untouched_waitlist) !== 3
  ) {
    throw new Error(
      `Dead outbox rows were claimed: ${JSON.stringify(deadClaimEvidence)}`,
    );
  }

  // Staff lifecycle writes preserve a verified web guest's custody contract:
  // refresh the scoped management session, invalidate stale delivery work,
  // and queue only version-bound lifecycle messages on the verified channel.
  const staffWebIds = {
    createRequest: "ec000000-0000-4000-8000-000000000001",
    modifyRequest: "ec100000-0000-4000-8000-000000000001",
    cancelRequest: "ec100000-0000-4000-8000-000000000002",
    destinationDriftModifyRequest: "ec100000-0000-4000-8000-000000000003",
    staleReminder24: "ec200000-0000-4000-8000-000000000001",
    staleReminder2: "ec200000-0000-4000-8000-000000000002",
    staleModified: "ec200000-0000-4000-8000-000000000003",
    staleClaim: "ec300000-0000-4000-8000-000000000001",
    modifiedClaim: "ec300000-0000-4000-8000-000000000002",
    cancelledClaim: "ec300000-0000-4000-8000-000000000003",
    nullableReservation: "ed000000-0000-4000-8000-000000000001",
    nullableCancelRequest: "ed100000-0000-4000-8000-000000000001",
  };
  const staffWebTime = (
    await db.query(
      `select (
        date_trunc('day', clock_timestamp() at time zone 'America/New_York')
        + interval '24 days 19 hours'
      ) at time zone 'America/New_York' value`,
    )
  ).rows[0].value;
  const staffWebMovedTime = new Date(
    new Date(staffWebTime).valueOf() + 86_400_000,
  ).toISOString();
  const staffWebDestinationDriftTime = new Date(
    new Date(staffWebMovedTime).valueOf() + 15 * 60_000,
  ).toISOString();
  const webConfirmationFingerprint = "ac".repeat(32);
  const webExchangeFingerprint = "bd".repeat(32);
  const webManageHash = "ce".repeat(32);
  const webBindingHash = "df".repeat(32);

  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const staffWebHold = (
    await db.query(
      `select public.service_create_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, 120, 2,
        'Lifecycle', 'Web', 'staff.lifecycle.web@example.invalid',
        '+12125550981', null, array[$5::uuid], array['email']::text[]
      ) result`,
      [
        staffWebIds.createRequest,
        ids.organization,
        ids.location,
        staffWebTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  const staffWebConfirmed = (
    await db.query(
      `select public.service_confirm_public_reservation(
        $1::uuid, $2::uuid, $3::uuid, $4::text,
        'email', array['email']::text[]
      ) result`,
      [
        ids.organization,
        ids.location,
        staffWebHold.holdId,
        webConfirmationFingerprint,
      ],
    )
  ).rows[0].result;
  const staffWebReservationId = staffWebConfirmed.reservationId;
  const staffWebExchange = (
    await db.query(
      `select public.service_exchange_reservation_management(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text
      ) result`,
      [
        ids.organization,
        ids.location,
        staffWebReservationId,
        webExchangeFingerprint,
        webManageHash,
        webBindingHash,
      ],
    )
  ).rows[0].result;
  if (
    staffWebConfirmed.status !== "booked" ||
    staffWebExchange.replayed ||
    !staffWebExchange.manageExpiresAt
  ) {
    throw new Error(
      `Verified staff-web lifecycle fixture failed: ${JSON.stringify({ staffWebConfirmed, staffWebExchange })}`,
    );
  }

  await db.exec("reset role");
  const staffWebInitialEvidence = (
    await db.query(
      `select reservation.guest_id,
        (select token.expires_at from private.public_booking_tokens token
          where token.reservation_id = reservation.id
            and token.token_hash = $2::text
            and token.revoked_at is null) token_expires_at,
        (select exchange.manage_expires_at
          from private.public_booking_management_exchanges exchange
          where exchange.reservation_id = reservation.id
            and exchange.exchange_fingerprint = $3::text) exchange_expires_at,
        (select verification.verified_destination_hash
          from private.public_booking_holds hold
          join private.public_booking_verifications verification
            on verification.organization_id = hold.organization_id
           and verification.location_id = hold.location_id
           and verification.booking_hold_id = hold.id
          where hold.reservation_id = reservation.id
          order by verification.consumed_at desc, verification.id
          limit 1) verified_destination_hash
      from public.reservations reservation where reservation.id = $1::uuid`,
      [staffWebReservationId, webManageHash, webExchangeFingerprint],
    )
  ).rows[0];
  if (
    !/^[0-9a-f]{64}$/.test(staffWebInitialEvidence.verified_destination_hash)
  ) {
    throw new Error(
      `Verified staff-web hold omitted destination evidence: ${JSON.stringify(staffWebInitialEvidence)}`,
    );
  }
  await db.query(
    `insert into public.reservation_message_outbox (
      id, organization_id, location_id, reservation_id, guest_id,
      channel, template_key, template_data, status, dedupe_key, attempts,
      next_attempt_at, claim_token, claimed_by, claimed_at, lease_expires_at
    ) values
      (
        $1::uuid, $5::uuid, $6::uuid, $7::uuid, $8::uuid,
        'email', 'reservation_reminder_24h',
        jsonb_build_object('reservationVersion', 1, 'channel', 'email'), 'queued',
        'reservation:' || $7::uuid::text || ':reminder:24h:email',
        0, clock_timestamp(),
        null, null, null, null
      ),
      (
        $2::uuid, $5::uuid, $6::uuid, $7::uuid, $8::uuid,
        'email', 'reservation_reminder_2h',
        jsonb_build_object('reservationVersion', 1, 'channel', 'email'), 'failed',
        'reservation:' || $7::uuid::text || ':reminder:2h:email',
        1, clock_timestamp(),
        null, null, null, null
      ),
      (
        $3::uuid, $5::uuid, $6::uuid, $7::uuid, $8::uuid,
        'email', 'reservation_modified',
        jsonb_build_object('reservationVersion', 1, 'channel', 'email'), 'sending',
        'staff-web-lifecycle:modified-stale', 1, clock_timestamp(),
        $4::uuid, $9::uuid, clock_timestamp(), clock_timestamp() + interval '1 hour'
      )`,
    [
      staffWebIds.staleReminder24,
      staffWebIds.staleReminder2,
      staffWebIds.staleModified,
      staffWebIds.staleClaim,
      ids.organization,
      ids.location,
      staffWebReservationId,
      staffWebInitialEvidence.guest_id,
      ids.owner,
    ],
  );

  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  const staffWebModified = (
    await db.query(
      `select public.modify_reservation(
        $1::uuid, $2::uuid, $3::uuid, 1, $4::timestamptz,
        120, 2, 'Verified web lifecycle moved', array[$5::uuid],
        'Host moved the verified public reservation'
      ) result`,
      [
        staffWebIds.modifyRequest,
        ids.location,
        staffWebReservationId,
        staffWebMovedTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  expectExactKeys(
    staffWebModified,
    lifecycleResultKeys,
    "verified web staff modify",
  );
  if (
    staffWebModified.version !== 2 ||
    staffWebModified.replayed ||
    !staffWebModified.guestNotificationQueued
  ) {
    throw new Error(
      `Verified web staff modification omitted lifecycle delivery evidence: ${JSON.stringify(staffWebModified)}`,
    );
  }

  const oldWindowCount = Number(
    (
      await db.query(
        `select count(*) count from public.service_reservation_host_snapshot(
          $1::uuid, $2::uuid,
          $3::timestamptz - interval '1 hour',
          $3::timestamptz + interval '1 hour'
        ) snapshot where snapshot.id = $4::uuid`,
        [ids.organization, ids.location, staffWebTime, staffWebReservationId],
      )
    ).rows[0].count,
  );
  const staffWebHead = (
    await db.query(
      `select public.service_reservation_lifecycle_head(
        $1::uuid, $2::uuid
      ) result`,
      [ids.location, staffWebReservationId],
    )
  ).rows[0].result;
  expectExactKeys(
    staffWebHead,
    lifecycleHeadKeys,
    "out-of-window lifecycle head",
  );
  if (
    oldWindowCount !== 0 ||
    staffWebHead.version !== 2 ||
    new Date(staffWebHead.reservedAt).valueOf() !==
      new Date(staffWebMovedTime).valueOf() ||
    staffWebHead.lastRevision?.id !== staffWebModified.revisionId
  ) {
    throw new Error(
      `Exact lifecycle head did not recover an out-of-window move: ${JSON.stringify({ oldWindowCount, staffWebHead })}`,
    );
  }

  await db.exec("reset role");
  const expectedStaffWebExpiry =
    new Date(staffWebMovedTime).valueOf() + (120 + 24 * 60) * 60_000;
  const staffWebRefreshEvidence = (
    await db.query(
      `select
        (select token.expires_at from private.public_booking_tokens token
          where token.reservation_id = $1::uuid
            and token.token_hash = $2::text
            and token.revoked_at is null) token_expires_at,
        (select exchange.manage_expires_at
          from private.public_booking_management_exchanges exchange
          where exchange.reservation_id = $1::uuid
            and exchange.exchange_fingerprint = $3::text) exchange_expires_at`,
      [staffWebReservationId, webManageHash, webExchangeFingerprint],
    )
  ).rows[0];
  const staleLifecycleMessages = (
    await db.query(
      `select id, status, dedupe_key, claim_token
      from public.reservation_message_outbox
      where id = any($1::uuid[]) order by id`,
      [
        [
          staffWebIds.staleReminder24,
          staffWebIds.staleReminder2,
          staffWebIds.staleModified,
        ],
      ],
    )
  ).rows;
  const staffWebModifiedMessage = (
    await db.query(
      `select id, guest_id, channel, status, template_data, dedupe_key,
        reservation_version, recipient_destination_hmac
      from public.reservation_message_outbox
      where reservation_id = $1::uuid
        and template_key = 'reservation_modified'
        and dedupe_key = $2::text`,
      [
        staffWebReservationId,
        `reservation:${staffWebReservationId}:modified:2:email`,
      ],
    )
  ).rows[0];
  const staleMessageById = new Map(
    staleLifecycleMessages.map((message) => [message.id, message]),
  );
  if (
    new Date(staffWebRefreshEvidence.token_expires_at).valueOf() !==
      expectedStaffWebExpiry ||
    new Date(staffWebRefreshEvidence.exchange_expires_at).valueOf() !==
      expectedStaffWebExpiry ||
    expectedStaffWebExpiry <=
      new Date(staffWebInitialEvidence.token_expires_at).valueOf() ||
    staleLifecycleMessages.length !== 3 ||
    staleLifecycleMessages.some(
      (message) =>
        message.status !== "cancelled" || message.claim_token !== null,
    ) ||
    staleMessageById.get(staffWebIds.staleReminder24)?.dedupe_key !==
      `reservation:${staffWebReservationId}:reminder:24h:email:v1` ||
    staleMessageById.get(staffWebIds.staleReminder2)?.dedupe_key !==
      `reservation:${staffWebReservationId}:reminder:2h:email:v1` ||
    staffWebModifiedMessage?.status !== "queued" ||
    staffWebModifiedMessage.channel !== "email" ||
    staffWebModifiedMessage.guest_id !== staffWebInitialEvidence.guest_id ||
    staffWebModifiedMessage.template_data.reservationVersion !== 2 ||
    staffWebModifiedMessage.reservation_version !== 2 ||
    !/^[0-9a-f]{64}$/.test(
      staffWebModifiedMessage.recipient_destination_hmac ?? "",
    ) ||
    new Date(staffWebModifiedMessage.template_data.reservedAt).valueOf() !==
      new Date(staffWebMovedTime).valueOf()
  ) {
    throw new Error(
      `Staff modification did not refresh custody and invalidate stale delivery: ${JSON.stringify({ staffWebRefreshEvidence, staleLifecycleMessages, staffWebModifiedMessage })}`,
    );
  }

  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await db.query(
    "select public.service_enqueue_reservation_reminders($1::timestamptz)",
    [
      new Date(
        new Date(staffWebMovedTime).valueOf() - 23 * 60 * 60_000,
      ).toISOString(),
    ],
  );
  await db.exec("reset role");
  const staffWebVersionedReminder = (
    await db.query(
      `select status, channel, template_key, template_data, dedupe_key,
        reservation_version, recipient_destination_hmac
      from public.reservation_message_outbox
      where organization_id = $1::uuid
        and reservation_id = $2::uuid
        and dedupe_key = $3::text`,
      [
        ids.organization,
        staffWebReservationId,
        `reservation:${staffWebReservationId}:reminder:24h:v2:email`,
      ],
    )
  ).rows[0];
  if (
    staffWebVersionedReminder?.status !== "queued" ||
    staffWebVersionedReminder.channel !== "email" ||
    staffWebVersionedReminder.template_key !== "reservation_reminder_24h" ||
    staffWebVersionedReminder.template_data.reservationVersion !== 2 ||
    staffWebVersionedReminder.reservation_version !== 2 ||
    !/^[0-9a-f]{64}$/.test(
      staffWebVersionedReminder.recipient_destination_hmac ?? "",
    ) ||
    staffWebVersionedReminder.template_data.channel !== "email"
  ) {
    throw new Error(
      `Staff move did not permit an exact version-bound reminder: ${JSON.stringify(staffWebVersionedReminder)}`,
    );
  }

  await db.query(
    `update public.reservation_message_outbox
    set status = 'sending', claim_token = $2::uuid, claimed_by = $3::uuid,
      claimed_at = clock_timestamp(), lease_expires_at = clock_timestamp() + interval '1 hour'
    where id = $1::uuid`,
    [staffWebModifiedMessage.id, staffWebIds.modifiedClaim, ids.owner],
  );
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const staffWebExchangeReplay = (
    await db.query(
      `select public.service_exchange_reservation_management(
        $1::uuid, $2::uuid, $3::uuid, $4::text, $5::text, $6::text
      ) result`,
      [
        ids.organization,
        ids.location,
        staffWebReservationId,
        webExchangeFingerprint,
        webManageHash,
        webBindingHash,
      ],
    )
  ).rows[0].result;
  await db.exec("reset role");
  const postModifyClaimState = (
    await db.query(
      `select
        (select status from public.reservation_message_outbox
          where id = $1::uuid) stale_status,
        (select status from public.reservation_message_outbox
          where id = $2::uuid) current_status`,
      [staffWebIds.staleModified, staffWebModifiedMessage.id],
    )
  ).rows[0];
  if (
    !staffWebExchangeReplay.replayed ||
    new Date(staffWebExchangeReplay.manageExpiresAt).valueOf() !==
      expectedStaffWebExpiry ||
    postModifyClaimState.stale_status !== "cancelled" ||
    postModifyClaimState.current_status !== "sending"
  ) {
    throw new Error(
      `Staff modification claim state is incomplete: ${JSON.stringify({ staffWebExchangeReplay, postModifyClaimState })}`,
    );
  }

  await db.query(
    "update public.guests set email = 'changed.staff.lifecycle@example.invalid' where organization_id = $1::uuid and id = $2::uuid",
    [ids.organization, staffWebInitialEvidence.guest_id],
  );
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const changedDestinationDispatch = (
    await db.query(
      `select public.service_begin_reservation_message_delivery(
        $1::uuid, $2::uuid, clock_timestamp()
      ) result`,
      [staffWebModifiedMessage.id, staffWebIds.modifiedClaim],
    )
  ).rows[0].result;
  if (changedDestinationDispatch?.status !== "cancelled") {
    throw new Error(
      `A lifecycle message claim survived CRM destination drift: ${JSON.stringify(changedDestinationDispatch)}`,
    );
  }

  await db.exec("reset role");
  await db.query(
    `update public.reservation_message_outbox
    set status = 'failed', claim_token = null, claimed_by = null,
      claimed_at = null, lease_expires_at = null,
      next_attempt_at = '2000-01-01 00:00:00+00'
    where id = $1::uuid`,
    [staffWebModifiedMessage.id],
  );
  const driftAttemptsBeforeClaim = Number(
    (
      await db.query(
        "select attempts from public.reservation_message_outbox where id = $1::uuid",
        [staffWebModifiedMessage.id],
      )
    ).rows[0].attempts,
  );
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const destinationDriftClaims = (
    await db.query(
      `select * from public.service_claim_reservation_message_outbox(
        $1::uuid, 500, 60, clock_timestamp()
      )`,
      ["ec300000-0000-4000-8000-000000000004"],
    )
  ).rows;
  if (
    destinationDriftClaims.some(
      (message) => message.id === staffWebModifiedMessage.id,
    )
  ) {
    throw new Error(
      "The outbox claim returned an unverified changed destination",
    );
  }
  for (const message of destinationDriftClaims) {
    await db.query(
      `select public.service_complete_reservation_message_outbox(
        $1::uuid, $2::uuid, 'failed', 'test_claim_released',
        clock_timestamp() + interval '1 day', null
      )`,
      [message.id, message.claimToken],
    );
  }
  await db.exec("reset role");
  const driftClaimEvidence = (
    await db.query(
      `select status, attempts, claim_token
      from public.reservation_message_outbox where id = $1::uuid`,
      [staffWebModifiedMessage.id],
    )
  ).rows[0];
  if (
    driftClaimEvidence.status !== "failed" ||
    Number(driftClaimEvidence.attempts) !== driftAttemptsBeforeClaim ||
    driftClaimEvidence.claim_token !== null
  ) {
    throw new Error(
      `Destination-drift claim fence mutated the rejected row: ${JSON.stringify(driftClaimEvidence)}`,
    );
  }

  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  const staffWebDestinationDriftModified = (
    await db.query(
      `select public.modify_reservation(
        $1::uuid, $2::uuid, $3::uuid, 2, $4::timestamptz,
        120, 2, 'Verified web destination drift', array[$5::uuid],
        'Host moved after the verified CRM destination changed'
      ) result`,
      [
        staffWebIds.destinationDriftModifyRequest,
        ids.location,
        staffWebReservationId,
        staffWebDestinationDriftTime,
        ids.otherTable,
      ],
    )
  ).rows[0].result;
  expectExactKeys(
    staffWebDestinationDriftModified,
    lifecycleResultKeys,
    "changed-destination staff modify",
  );
  if (
    staffWebDestinationDriftModified.version !== 3 ||
    staffWebDestinationDriftModified.replayed ||
    staffWebDestinationDriftModified.guestNotificationQueued
  ) {
    throw new Error(
      `Changed CRM destination still queued a lifecycle notification: ${JSON.stringify(staffWebDestinationDriftModified)}`,
    );
  }

  await db.exec("reset role");
  const changedDestinationMessageEvidence = (
    await db.query(
      `select
        (select count(*) from public.reservation_message_outbox message
          where message.organization_id = $1::uuid
            and message.reservation_id = $2::uuid
            and message.dedupe_key = $3::text) new_modified_messages,
        (select status from public.reservation_message_outbox message
          where message.id = $4::uuid) previous_modified_status,
        (select status from public.reservation_message_outbox message
          where message.organization_id = $1::uuid
            and message.reservation_id = $2::uuid
            and message.dedupe_key = $5::text) previous_reminder_status`,
      [
        ids.organization,
        staffWebReservationId,
        `reservation:${staffWebReservationId}:modified:3:email`,
        staffWebModifiedMessage.id,
        `reservation:${staffWebReservationId}:reminder:24h:v2:email`,
      ],
    )
  ).rows[0];
  if (
    Number(changedDestinationMessageEvidence.new_modified_messages) !== 0 ||
    changedDestinationMessageEvidence.previous_modified_status !==
      "cancelled" ||
    changedDestinationMessageEvidence.previous_reminder_status !== "cancelled"
  ) {
    throw new Error(
      `Changed-destination lifecycle invalidation is incomplete: ${JSON.stringify(changedDestinationMessageEvidence)}`,
    );
  }
  await db.query(
    "update public.guests set email = 'staff.lifecycle.web@example.invalid' where organization_id = $1::uuid and id = $2::uuid",
    [ids.organization, staffWebInitialEvidence.guest_id],
  );

  await db.exec("reset role");
  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  const staffWebCancelled = (
    await db.query(
      `select public.cancel_reservation(
        $1::uuid, $2::uuid, $3::uuid, 3,
        'Host cancelled the verified public reservation'
      ) result`,
      [staffWebIds.cancelRequest, ids.location, staffWebReservationId],
    )
  ).rows[0].result;
  expectExactKeys(
    staffWebCancelled,
    lifecycleResultKeys,
    "verified web staff cancel",
  );
  if (
    staffWebCancelled.status !== "cancelled" ||
    staffWebCancelled.version !== 4 ||
    staffWebCancelled.replayed ||
    !staffWebCancelled.guestNotificationQueued
  ) {
    throw new Error(
      `Verified web staff cancellation omitted lifecycle delivery evidence: ${JSON.stringify(staffWebCancelled)}`,
    );
  }

  await db.exec("reset role");
  const staffWebCancellationEvidence = (
    await db.query(
      `select
        (select count(*) from private.public_booking_tokens token
          where token.reservation_id = $1::uuid
            and token.token_hash = $2::text
            and token.revoked_at is not null) revoked_tokens,
        (select count(*) from public.reservation_message_outbox message
          where message.reservation_id = $1::uuid
            and message.template_key <> 'reservation_cancelled'
            and message.status in ('queued', 'failed', 'sending')) live_stale_messages,
        (select count(*) from public.reservation_message_outbox message
          where message.id = $3::uuid and message.status = 'cancelled'
            and message.claim_token is null) cancelled_modified_claims`,
      [staffWebReservationId, webManageHash, staffWebModifiedMessage.id],
    )
  ).rows[0];
  const staffWebCancelledMessage = (
    await db.query(
      `select id, guest_id, channel, status, template_data, dedupe_key,
        reservation_version, recipient_destination_hmac
      from public.reservation_message_outbox
      where reservation_id = $1::uuid
        and template_key = 'reservation_cancelled'`,
      [staffWebReservationId],
    )
  ).rows[0];
  if (
    Number(staffWebCancellationEvidence.revoked_tokens) !== 1 ||
    Number(staffWebCancellationEvidence.live_stale_messages) !== 0 ||
    Number(staffWebCancellationEvidence.cancelled_modified_claims) !== 1 ||
    staffWebCancelledMessage?.status !== "queued" ||
    staffWebCancelledMessage.channel !== "email" ||
    staffWebCancelledMessage.guest_id !== staffWebInitialEvidence.guest_id ||
    staffWebCancelledMessage.template_data.reservationVersion !== 4 ||
    staffWebCancelledMessage.reservation_version !== 4 ||
    !/^[0-9a-f]{64}$/.test(
      staffWebCancelledMessage.recipient_destination_hmac ?? "",
    ) ||
    staffWebCancelledMessage.dedupe_key !==
      `reservation:${staffWebReservationId}:cancelled:4:email`
  ) {
    throw new Error(
      `Staff cancellation did not revoke custody and queue verified delivery: ${JSON.stringify({ staffWebCancellationEvidence, staffWebCancelledMessage })}`,
    );
  }

  await db.query(
    `update public.reservation_message_outbox
    set status = 'sending', claim_token = $2::uuid, claimed_by = $3::uuid,
      claimed_at = clock_timestamp(), lease_expires_at = clock_timestamp() + interval '1 hour'
    where id = $1::uuid`,
    [staffWebCancelledMessage.id, staffWebIds.cancelledClaim, ids.owner],
  );
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const cancelledDispatch = (
    await db.query(
      `select public.service_begin_reservation_message_delivery(
        $1::uuid, $2::uuid, clock_timestamp()
      ) result`,
      [staffWebCancelledMessage.id, staffWebIds.cancelledClaim],
    )
  ).rows[0].result;
  if (
    cancelledDispatch?.status !== "dispatching" ||
    cancelledDispatch.templateKey !== "reservation_cancelled" ||
    cancelledDispatch.recipientEmail !== "staff.lifecycle.web@example.invalid"
  ) {
    throw new Error(
      `Staff cancellation dispatch snapshot is incomplete: ${JSON.stringify(cancelledDispatch)}`,
    );
  }

  await db.exec("reset role");
  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  const staffWebCancelledHead = (
    await db.query(
      `select public.service_reservation_lifecycle_head(
        $1::uuid, $2::uuid
      ) result`,
      [ids.location, staffWebReservationId],
    )
  ).rows[0].result;
  expectExactKeys(
    staffWebCancelledHead,
    lifecycleHeadKeys,
    "cancelled exact lifecycle head",
  );
  if (
    staffWebCancelledHead.version !== 4 ||
    staffWebCancelledHead.status !== "cancelled" ||
    staffWebCancelledHead.tableIds.length !== 0 ||
    staffWebCancelledHead.lastRevision?.id !== staffWebCancelled.revisionId
  ) {
    throw new Error(
      `Cancelled lifecycle head is incomplete: ${JSON.stringify(staffWebCancelledHead)}`,
    );
  }

  // Historical reservation rows can predate duration capture. Cancellation
  // must still append evidence and return the nullable duration safely.
  await db.exec("reset role");
  const nullableDurationTime = new Date(
    new Date(staffWebMovedTime).valueOf() + 86_400_000,
  ).toISOString();
  await db.query(
    `select private.ensure_service_shifts(
      $1::uuid, $2::uuid,
      array[($3::timestamptz at time zone 'America/New_York')::date]
    )`,
    [ids.organization, ids.location, nullableDurationTime],
  );
  await db.query(
    `insert into public.reservations (
      id, organization_id, location_id, reserved_at, duration_minutes,
      party_size, status, source, booking_channel, version
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::timestamptz, null,
      2, 'booked', 'manual', 'staff', 1
    )`,
    [
      staffWebIds.nullableReservation,
      ids.organization,
      ids.location,
      nullableDurationTime,
    ],
  );
  await db.exec("set role authenticated");
  await assumeUser(ids.owner);
  const nullableDurationCancellation = (
    await db.query(
      `select public.cancel_reservation(
        $1::uuid, $2::uuid, $3::uuid, 1,
        'Cancelled legacy reservation without captured duration'
      ) result`,
      [
        staffWebIds.nullableCancelRequest,
        ids.location,
        staffWebIds.nullableReservation,
      ],
    )
  ).rows[0].result;
  expectExactKeys(
    nullableDurationCancellation,
    lifecycleResultKeys,
    "nullable-duration staff cancellation",
  );
  if (
    nullableDurationCancellation.status !== "cancelled" ||
    nullableDurationCancellation.version !== 2 ||
    nullableDurationCancellation.durationMinutes !== null ||
    !nullableDurationCancellation.policyEvidenceCaptured ||
    nullableDurationCancellation.guestNotificationQueued
  ) {
    throw new Error(
      `Nullable-duration cancellation is incomplete: ${JSON.stringify(nullableDurationCancellation)}`,
    );
  }
  await db.exec("reset role");
  const nullableDurationRevision = (
    await db.query(
      `select before_state, after_state from public.reservation_revisions
      where request_id = $1::uuid`,
      [staffWebIds.nullableCancelRequest],
    )
  ).rows[0];
  if (
    nullableDurationRevision?.before_state.durationMinutes !== null ||
    nullableDurationRevision.after_state.durationMinutes !== null
  ) {
    throw new Error(
      `Nullable duration was not preserved in cancellation evidence: ${JSON.stringify(nullableDurationRevision)}`,
    );
  }

  // Delivery authorization is evaluated from the current, exact
  // tenant/location settings both when work is claimed and at the provider
  // boundary. Revocation cancels queued, failed, and leased work atomically;
  // re-enabling permits only newly queued work and never resurrects a row.
  const deliveryFenceIds = {
    queuedHold: "ee000000-0000-4000-8000-000000000001",
    failedHold: "ee000000-0000-4000-8000-000000000002",
    staleLeaseHold: "ee000000-0000-4000-8000-000000000003",
    crossLocationWaitlist: "ee000000-0000-4000-8000-000000000004",
    reenabledHold: "ee000000-0000-4000-8000-000000000005",
    queuedMessage: "ef000000-0000-4000-8000-000000000001",
    failedMessage: "ef000000-0000-4000-8000-000000000002",
    staleLeaseMessage: "ef000000-0000-4000-8000-000000000003",
    crossLocationMessage: "ef000000-0000-4000-8000-000000000004",
    reenabledEmailMessage: "ef000000-0000-4000-8000-000000000005",
    reenabledSmsMessage: "ef000000-0000-4000-8000-000000000006",
    disabledLateMessage: "ef000000-0000-4000-8000-000000000007",
    staleClaim: "f0000000-0000-4000-8000-000000000001",
    staleWorker: "f0000000-0000-4000-8000-000000000002",
    reenabledWorker: "f0000000-0000-4000-8000-000000000003",
  };
  const deliveryFenceNow = (await db.query("select clock_timestamp() value"))
    .rows[0].value;
  const deliveryFenceReservedAt = new Date(
    new Date(staffWebMovedTime).valueOf() + 86_400_000,
  ).toISOString();

  await db.exec("reset role");
  await db.query(
    `select private.ensure_service_shifts(
      $1::uuid, $2::uuid,
      array[($3::timestamptz at time zone 'America/New_York')::date]
    )`,
    [ids.organization, ids.location, deliveryFenceReservedAt],
  );
  await db.query(
    `update public.reservation_settings
    set online_booking_enabled = false,
      guest_messaging_enabled = true,
      verification_channels = array['email','sms']::text[],
      approved_at = coalesce(approved_at, clock_timestamp()),
      approved_by = coalesce(approved_by, $3::uuid),
      updated_at = clock_timestamp()
    where organization_id = $1::uuid and location_id = $2::uuid`,
    [ids.organization, ids.location, ids.owner],
  );
  await db.query(
    `delete from public.reservation_settings
    where organization_id = $1::uuid and location_id = $2::uuid`,
    [ids.organization, ids.otherLocation],
  );
  await db.query(
    `insert into private.public_booking_holds (
      id, organization_id, location_id, reserved_at, duration_minutes,
      party_size, public_code, first_name, last_name, email, phone,
      expires_at, created_at, updated_at
    ) values
      ($1::uuid, $5::uuid, $6::uuid, $8::timestamptz,
        120, 2, 'LYFENCE1', 'Queue', 'Fence',
        'queue.fence@example.invalid', '+12125550201',
        $7::timestamptz + interval '1 day', $7::timestamptz, $7::timestamptz),
      ($2::uuid, $5::uuid, $6::uuid, $8::timestamptz,
        120, 2, 'LYFENCE2', 'Failed', 'Fence',
        'failed.fence@example.invalid', '+12125550202',
        $7::timestamptz + interval '1 day', $7::timestamptz, $7::timestamptz),
      ($3::uuid, $5::uuid, $6::uuid, $8::timestamptz,
        120, 2, 'LYFENCE3', 'Lease', 'Fence',
        'lease.fence@example.invalid', '+12125550203',
        $7::timestamptz + interval '1 day', $7::timestamptz, $7::timestamptz),
      ($4::uuid, $5::uuid, $6::uuid, $8::timestamptz,
        120, 2, 'LYFENCE5', 'Reenabled', 'Fence',
        'reenabled.fence@example.invalid', '+12125550205',
        $7::timestamptz + interval '1 day', $7::timestamptz, $7::timestamptz)`,
    [
      deliveryFenceIds.queuedHold,
      deliveryFenceIds.failedHold,
      deliveryFenceIds.staleLeaseHold,
      deliveryFenceIds.reenabledHold,
      ids.organization,
      ids.location,
      deliveryFenceNow,
      deliveryFenceReservedAt,
    ],
  );
  await db.query(
    `insert into public.waitlist_entries (
      id, organization_id, location_id, display_name, email, phone,
      party_size, status, notified_at, offer_expires_at, created_at, updated_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, 'Cross-location fence',
      'cross.fence@example.invalid', '+12125550204', 2, 'notified',
      $4::timestamptz, $4::timestamptz + interval '1 day',
      $4::timestamptz, $4::timestamptz
    )`,
    [
      deliveryFenceIds.crossLocationWaitlist,
      ids.organization,
      ids.otherLocation,
      deliveryFenceNow,
    ],
  );
  await db.query(
    `insert into public.reservation_message_outbox (
      id, organization_id, location_id, booking_hold_id, channel,
      template_key, template_data, status, dedupe_key, attempts,
      next_attempt_at, claim_token, claimed_by, claimed_at,
      lease_expires_at, created_at, updated_at
    ) values
      ($1::uuid, $9::uuid, $10::uuid, $2::uuid, 'email',
        'reservation_verify',
        '{"purpose":"reservation_verify","channel":"email"}'::jsonb,
        'queued', 'delivery-fence:queued', 0, $11::timestamptz,
        null, null, null, null, $11::timestamptz, $11::timestamptz),
      ($3::uuid, $9::uuid, $10::uuid, $4::uuid, 'email',
        'reservation_verify',
        '{"purpose":"reservation_verify","channel":"email"}'::jsonb,
        'failed', 'delivery-fence:failed', 1,
        $11::timestamptz - interval '1 minute',
        null, null, null, null, $11::timestamptz, $11::timestamptz),
      ($5::uuid, $9::uuid, $10::uuid, $6::uuid, 'email',
        'reservation_verify',
        '{"purpose":"reservation_verify","channel":"email"}'::jsonb,
        'sending', 'delivery-fence:stale-lease', 1,
        $11::timestamptz - interval '1 minute', $7::uuid, $8::uuid,
        $11::timestamptz - interval '2 minutes',
        $11::timestamptz - interval '1 minute',
        $11::timestamptz, $11::timestamptz)`,
    [
      deliveryFenceIds.queuedMessage,
      deliveryFenceIds.queuedHold,
      deliveryFenceIds.failedMessage,
      deliveryFenceIds.failedHold,
      deliveryFenceIds.staleLeaseMessage,
      deliveryFenceIds.staleLeaseHold,
      deliveryFenceIds.staleClaim,
      deliveryFenceIds.staleWorker,
      ids.organization,
      ids.location,
      deliveryFenceNow,
    ],
  );
  await db.query(
    `insert into public.reservation_message_outbox (
      id, organization_id, location_id, waitlist_entry_id, channel,
      template_key, template_data, dedupe_key, next_attempt_at,
      created_at, updated_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'email',
      'waitlist_table_ready', '{"channel":"email"}'::jsonb,
      'delivery-fence:cross-location', $5::timestamptz,
      $5::timestamptz, $5::timestamptz
    )`,
    [
      deliveryFenceIds.crossLocationMessage,
      ids.organization,
      ids.otherLocation,
      deliveryFenceIds.crossLocationWaitlist,
      deliveryFenceNow,
    ],
  );

  await db.query(
    `update public.reservation_settings
    set guest_messaging_enabled = false,
      approved_at = null,
      approved_by = null,
      updated_at = clock_timestamp()
    where organization_id = $1::uuid and location_id = $2::uuid`,
    [ids.organization, ids.location],
  );
  await db.query(
    `insert into public.reservation_message_outbox (
      id, organization_id, location_id, booking_hold_id, channel,
      template_key, template_data, dedupe_key, next_attempt_at,
      created_at, updated_at
    ) values (
      $1::uuid, $2::uuid, $3::uuid, $4::uuid, 'email',
      'reservation_verify',
      '{"purpose":"reservation_verify","channel":"email"}'::jsonb,
      'delivery-fence:disabled-late', $5::timestamptz,
      $5::timestamptz, $5::timestamptz
    )`,
    [
      deliveryFenceIds.disabledLateMessage,
      ids.organization,
      ids.location,
      deliveryFenceIds.reenabledHold,
      deliveryFenceNow,
    ],
  );
  const disabledDeliveryRows = (
    await db.query(
      `select id, status, claim_token, claimed_by, claimed_at,
        lease_expires_at, last_error_code
      from public.reservation_message_outbox
      where id = any($1::uuid[]) order by id`,
      [
        [
          deliveryFenceIds.queuedMessage,
          deliveryFenceIds.failedMessage,
          deliveryFenceIds.staleLeaseMessage,
          deliveryFenceIds.disabledLateMessage,
        ],
      ],
    )
  ).rows;
  if (
    disabledDeliveryRows.length !== 4 ||
    disabledDeliveryRows.some(
      (message) =>
        message.status !== "cancelled" ||
        message.claim_token !== null ||
        message.claimed_by !== null ||
        message.claimed_at !== null ||
        message.lease_expires_at !== null ||
        message.last_error_code !== "messaging_configuration_revoked",
    )
  ) {
    throw new Error(
      `Configuration revocation did not atomically cancel delivery work: ${JSON.stringify(disabledDeliveryRows)}`,
    );
  }

  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const disabledClaims = (
    await db.query(
      `select * from public.service_claim_reservation_message_outbox(
        $1::uuid, 20, 30, $2::timestamptz
      )`,
      [deliveryFenceIds.reenabledWorker, deliveryFenceNow],
    )
  ).rows;
  if (
    disabledClaims.some((message) =>
      [
        deliveryFenceIds.queuedMessage,
        deliveryFenceIds.failedMessage,
        deliveryFenceIds.staleLeaseMessage,
        deliveryFenceIds.disabledLateMessage,
        deliveryFenceIds.crossLocationMessage,
      ].includes(message.id),
    )
  ) {
    throw new Error(
      `Disabled or cross-location delivery work was claimed: ${JSON.stringify(disabledClaims)}`,
    );
  }

  await db.exec("reset role");
  const disabledAudit = (
    await db.query(
      `select metadata from public.audit_events
      where organization_id = $1::uuid and location_id = $2::uuid
        and action = 'reservation_messages_cancelled_by_configuration'
      order by occurred_at desc, id desc limit 1`,
      [ids.organization, ids.location],
    )
  ).rows[0];
  if (
    Number(disabledAudit?.metadata?.cancelledCount ?? 0) < 3 ||
    disabledAudit?.metadata?.reason !== "messaging_configuration_revoked"
  ) {
    throw new Error(
      `Configuration cancellation audit evidence is incomplete: ${JSON.stringify(disabledAudit)}`,
    );
  }

  await db.query(
    `update public.reservation_settings
    set guest_messaging_enabled = true,
      verification_channels = array['email','sms']::text[],
      approved_at = clock_timestamp(),
      approved_by = $3::uuid,
      updated_at = clock_timestamp()
    where organization_id = $1::uuid and location_id = $2::uuid`,
    [ids.organization, ids.location, ids.owner],
  );
  await db.query(
    `insert into public.reservation_message_outbox (
      id, organization_id, location_id, booking_hold_id, channel,
      template_key, template_data, dedupe_key, next_attempt_at,
      created_at, updated_at
    ) values
      ($1::uuid, $4::uuid, $5::uuid, $3::uuid, 'email',
        'reservation_verify',
        '{"purpose":"reservation_verify","channel":"email"}'::jsonb,
        'delivery-fence:reenabled:email', $6::timestamptz,
        $6::timestamptz, $6::timestamptz),
      ($2::uuid, $4::uuid, $5::uuid, $3::uuid, 'sms',
        'reservation_verify',
        '{"purpose":"reservation_verify","channel":"sms"}'::jsonb,
        'delivery-fence:reenabled:sms', $6::timestamptz,
        $6::timestamptz, $6::timestamptz)`,
    [
      deliveryFenceIds.reenabledEmailMessage,
      deliveryFenceIds.reenabledSmsMessage,
      deliveryFenceIds.reenabledHold,
      ids.organization,
      ids.location,
      deliveryFenceNow,
    ],
  );
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const reenabledClaims = (
    await db.query(
      `select * from public.service_claim_reservation_message_outbox(
        $1::uuid, 20, 30, $2::timestamptz
      )`,
      [deliveryFenceIds.reenabledWorker, deliveryFenceNow],
    )
  ).rows;
  const reenabledClaimIds = reenabledClaims
    .map((message) => message.id)
    .filter((id) =>
      [
        deliveryFenceIds.reenabledEmailMessage,
        deliveryFenceIds.reenabledSmsMessage,
      ].includes(id),
    )
    .sort();
  if (
    JSON.stringify(reenabledClaimIds) !==
      JSON.stringify(
        [
          deliveryFenceIds.reenabledEmailMessage,
          deliveryFenceIds.reenabledSmsMessage,
        ].sort(),
      ) ||
    reenabledClaims.some(
      (message) => message.id === deliveryFenceIds.crossLocationMessage,
    )
  ) {
    throw new Error(
      `Re-enabled messaging claimed the wrong delivery set: ${JSON.stringify(reenabledClaims)}`,
    );
  }
  const reenabledById = new Map(
    reenabledClaims.map((message) => [message.id, message]),
  );
  const initialEmailDispatch = (
    await db.query(
      `select public.service_begin_reservation_message_delivery(
        $1::uuid, $2::uuid, $3::timestamptz
      ) begun`,
      [
        deliveryFenceIds.reenabledEmailMessage,
        reenabledById.get(deliveryFenceIds.reenabledEmailMessage)?.claimToken,
        deliveryFenceNow,
      ],
    )
  ).rows[0].begun;
  if (
    initialEmailDispatch?.status !== "dispatching" ||
    initialEmailDispatch.id !== deliveryFenceIds.reenabledEmailMessage ||
    initialEmailDispatch.templateKey !== "reservation_verify" ||
    initialEmailDispatch.recipientEmail !== "reenabled.fence@example.invalid" ||
    initialEmailDispatch.recipientPhone !== "+12125550205" ||
    initialEmailDispatch.configurationVersion < 1
  ) {
    throw new Error(
      `Begin delivery did not return the exact provider snapshot: ${JSON.stringify(initialEmailDispatch)}`,
    );
  }

  await db.exec("reset role");
  await db.query(
    `update public.reservation_settings
    set verification_channels = array['email']::text[],
      updated_at = clock_timestamp()
    where organization_id = $1::uuid and location_id = $2::uuid`,
    [ids.organization, ids.location],
  );
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  await expectDatabaseError(
    () =>
      db.query(
        `select public.service_begin_reservation_message_delivery(
          $1::uuid, $2::uuid, clock_timestamp()
        )`,
        [
          deliveryFenceIds.reenabledSmsMessage,
          reenabledById.get(deliveryFenceIds.reenabledSmsMessage)?.claimToken,
        ],
      ),
    "P0002",
    "revoked pre-provider reservation message claim",
  );

  await db.exec("reset role");
  const channelRemovalFence = (
    await db.query(
      `select message.id, message.status, message.claim_token,
        message.provider_attempted_at,
        message.message_delivery_configuration_version,
        settings.message_delivery_configuration_version
          current_configuration_version
      from public.reservation_message_outbox message
      join public.reservation_settings settings
        on settings.organization_id = message.organization_id
       and settings.location_id = message.location_id
      where message.id = any($1::uuid[]) order by message.id`,
      [
        [
          deliveryFenceIds.reenabledEmailMessage,
          deliveryFenceIds.reenabledSmsMessage,
        ],
      ],
    )
  ).rows;
  const channelRemovalById = new Map(
    channelRemovalFence.map((message) => [message.id, message]),
  );
  const inFlightEmail = channelRemovalById.get(
    deliveryFenceIds.reenabledEmailMessage,
  );
  const revokedSms = channelRemovalById.get(
    deliveryFenceIds.reenabledSmsMessage,
  );
  if (
    inFlightEmail?.status !== "sending" ||
    inFlightEmail.claim_token !==
      reenabledById.get(deliveryFenceIds.reenabledEmailMessage)?.claimToken ||
    inFlightEmail.provider_attempted_at === null ||
    revokedSms?.status !== "cancelled" ||
    revokedSms.claim_token !== null ||
    revokedSms.provider_attempted_at !== null ||
    Number(inFlightEmail.message_delivery_configuration_version) >=
      Number(inFlightEmail.current_configuration_version) ||
    Number(revokedSms.message_delivery_configuration_version) >=
      Number(revokedSms.current_configuration_version)
  ) {
    throw new Error(
      `Channel removal did not preserve only the begun dispatch: ${JSON.stringify(channelRemovalFence)}`,
    );
  }

  await db.exec("reset role");
  await db.query(
    `update public.reservation_settings
    set approved_at = null, approved_by = null, updated_at = clock_timestamp()
    where organization_id = $1::uuid and location_id = $2::uuid`,
    [ids.organization, ids.location],
  );
  await db.exec("set role service_role");
  await db.query("select set_config('request.jwt.claims', $1, false)", [
    JSON.stringify({ role: "service_role" }),
  ]);
  const completedBegunEmail = (
    await db.query(
      `select public.service_complete_reservation_message_outbox(
        $1::uuid, $2::uuid, 'sent', null, null, 'provider-fence-email'
      ) completed`,
      [
        deliveryFenceIds.reenabledEmailMessage,
        reenabledById.get(deliveryFenceIds.reenabledEmailMessage)?.claimToken,
      ],
    )
  ).rows[0].completed;
  if (completedBegunEmail?.status !== "sent")
    throw new Error(
      `A dispatch begun before settings revocation could not complete: ${JSON.stringify(completedBegunEmail)}`,
    );

  await db.exec("reset role");
  const finalDeliveryFenceEvidence = (
    await db.query(
      `select id, status, attempts, claim_token, claimed_by, claimed_at,
        lease_expires_at, provider_attempted_at, provider_message_id,
        last_error_code
      from public.reservation_message_outbox
      where id = any($1::uuid[]) order by id`,
      [
        [
          deliveryFenceIds.queuedMessage,
          deliveryFenceIds.failedMessage,
          deliveryFenceIds.staleLeaseMessage,
          deliveryFenceIds.disabledLateMessage,
          deliveryFenceIds.crossLocationMessage,
          deliveryFenceIds.reenabledEmailMessage,
          deliveryFenceIds.reenabledSmsMessage,
        ],
      ],
    )
  ).rows;
  const finalDeliveryById = new Map(
    finalDeliveryFenceEvidence.map((message) => [message.id, message]),
  );
  const oldRows = [
    deliveryFenceIds.queuedMessage,
    deliveryFenceIds.failedMessage,
    deliveryFenceIds.staleLeaseMessage,
    deliveryFenceIds.disabledLateMessage,
  ].map((id) => finalDeliveryById.get(id));
  const emailRow = finalDeliveryById.get(
    deliveryFenceIds.reenabledEmailMessage,
  );
  const smsRow = finalDeliveryById.get(deliveryFenceIds.reenabledSmsMessage);
  const crossRow = finalDeliveryById.get(deliveryFenceIds.crossLocationMessage);
  if (
    oldRows.some(
      (message) =>
        message?.status !== "cancelled" ||
        message.last_error_code !== "messaging_configuration_revoked",
    ) ||
    emailRow?.status !== "sent" ||
    smsRow?.status !== "cancelled" ||
    emailRow.claim_token !== null ||
    smsRow.claim_token !== null ||
    emailRow.provider_attempted_at === null ||
    emailRow.provider_message_id !== "provider-fence-email" ||
    emailRow.last_error_code !== null ||
    smsRow.last_error_code !== "messaging_configuration_revoked" ||
    crossRow?.status !== "cancelled" ||
    Number(crossRow.attempts) !== 0 ||
    crossRow.last_error_code !== "messaging_configuration_revoked"
  ) {
    throw new Error(
      `Final delivery configuration evidence is incomplete: ${JSON.stringify(finalDeliveryFenceEvidence)}`,
    );
  }

  process.stdout.write(
    "PASS reservation configuration, atomic staff lifecycle revisions, table states, rate limits, reminders, public verification/modification/cancellation, exact cross-boundary expiry, waitlist seating, recipient/version evidence, and linearized begin-delivery authorization fences\n",
  );
} finally {
  await db.close();
}
