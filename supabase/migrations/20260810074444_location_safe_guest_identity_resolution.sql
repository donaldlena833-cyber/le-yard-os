-- Guest contact matching is a location-scoped identity decision. Serialize
-- every participating normalized contact before the fresh local lookup so
-- reservation, waitlist, public-confirmation, and CRM guest creation cannot
-- create two active profiles for the same contact at one location.
--
-- This helper is intentionally private and has no browser/service-role grant.
-- Public holds invoke it only after channel verification; unverified hold PII
-- therefore remains outside the CRM boundary.
create function private.resolve_location_guest_identity(
  p_organization_id uuid,
  p_location_id uuid,
  p_existing_guest_id uuid,
  p_new_guest_id uuid,
  p_replay_kind text,
  p_display_name text,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_source text,
  p_external_references jsonb
)
returns uuid
language plpgsql volatile security definer
set search_path = ''
set row_security = off
as $$
declare
  clean_display_name text := btrim(p_display_name);
  clean_first_name text := nullif(btrim(p_first_name), '');
  clean_last_name text := nullif(btrim(p_last_name), '');
  clean_email text := lower(nullif(btrim(p_email), ''));
  clean_phone text := nullif(
    regexp_replace(coalesce(p_phone, ''), '[^0-9]', '', 'g'),
    ''
  );
  stored_phone text := nullif(btrim(p_phone), '');
  lock_key text;
  candidate_ids uuid[] := '{}'::uuid[];
  fresh_candidate_ids uuid[] := '{}'::uuid[];
  resolved_guest_id uuid;
begin
  if p_organization_id is null
    or p_location_id is null
    or p_new_guest_id is null
    or p_replay_kind is null
    or p_replay_kind not in ('none', 'reservation', 'waitlist')
    or clean_display_name is null
    or length(clean_display_name) not between 1 and 240
    or length(coalesce(clean_first_name, '')) > 120
    or length(coalesce(clean_last_name, '')) > 120
    or length(coalesce(clean_email, '')) > 320
    or (
      clean_email is not null
      and clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+$'
    )
    or length(coalesce(stored_phone, '')) > 80
    or (clean_phone is not null and length(clean_phone) not between 7 and 24)
    or p_source not in ('manual', 'resy', 'toast', 'import', 'other')
    or p_external_references is null
    or jsonb_typeof(p_external_references) <> 'object'
    or not exists (
      select 1
      from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
        and location.is_active
    ) then
    raise exception 'A valid location-scoped guest identity is required'
      using errcode = '22023';
  end if;

  -- All callers use the existing organization/email key owned by
  -- service_save_guest. Phone and deterministic-create keys complete the same
  -- protocol. Sorting every key gives multi-contact calls one lock order.
  for lock_key in
    select distinct identity_lock.key
    from unnest(array[
      case when clean_email is not null then
        'guest-email:' || p_organization_id::text || ':' || clean_email
      end,
      case when clean_phone is not null then
        'guest-phone:' || p_organization_id::text || ':' || clean_phone
      end,
      'guest-new:' || p_organization_id::text || ':' || p_new_guest_id::text
    ]::text[]) identity_lock(key)
    where identity_lock.key is not null
    order by identity_lock.key
  loop
    perform pg_advisory_xact_lock(hashtextextended(lock_key, 0));
  end loop;

  -- Callers that already own an immutable request claim return exact replays
  -- before invoking this helper, so every fresh path passes `none`. Keep the
  -- explicit same-kind modes fail-closed for future private callers; a UUID
  -- can never be accepted merely because some other operation used it.
  select guest.id
  into resolved_guest_id
  from public.guests guest
  join public.guest_locations guest_location
    on guest_location.organization_id = guest.organization_id
   and guest_location.guest_id = guest.id
   and guest_location.location_id = p_location_id
  where guest.organization_id = p_organization_id
    and guest.id = p_new_guest_id
    and guest.merged_into_id is null
  for update of guest;

  if resolved_guest_id is not null then
    if p_replay_kind = 'reservation' and exists (
      select 1
      from public.reservations reservation
      where reservation.organization_id = p_organization_id
        and reservation.location_id = p_location_id
        and reservation.id = p_new_guest_id
        and reservation.guest_id = resolved_guest_id
    ) then
      return resolved_guest_id;
    end if;
    if p_replay_kind = 'waitlist' and exists (
      select 1
      from public.waitlist_entries entry
      where entry.organization_id = p_organization_id
        and entry.location_id = p_location_id
        and entry.id = p_new_guest_id
        and entry.guest_id = resolved_guest_id
    ) then
      return resolved_guest_id;
    end if;
    raise exception 'Guest identity request id was reused'
      using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.guests guest
    where guest.id = p_new_guest_id
  ) then
    raise exception 'Guest identity request id was reused'
      using errcode = '23505';
  end if;

  select coalesce(array_agg(candidate.id order by candidate.id), '{}'::uuid[])
  into candidate_ids
  from (
    select distinct guest.id
    from public.guests guest
    join public.guest_locations guest_location
      on guest_location.organization_id = guest.organization_id
     and guest_location.guest_id = guest.id
     and guest_location.location_id = p_location_id
    where guest.organization_id = p_organization_id
      and guest.merged_into_id is null
      and (
        (clean_email is not null and lower(guest.email) = clean_email)
        or (
          clean_phone is not null
          and regexp_replace(coalesce(guest.phone, ''), '[^0-9]', '', 'g')
            = clean_phone
        )
      )
  ) candidate;

  if p_existing_guest_id is not null then
    if not exists (
      select 1
      from public.guests guest
      join public.guest_locations guest_location
        on guest_location.organization_id = guest.organization_id
       and guest_location.guest_id = guest.id
       and guest_location.location_id = p_location_id
      where guest.organization_id = p_organization_id
        and guest.id = p_existing_guest_id
        and guest.merged_into_id is null
    ) then
      -- The same response covers nonexistent and other-location identifiers.
      raise exception 'Active guest not found at this location'
        using errcode = 'P0002';
    end if;

    if exists (
      select 1
      from unnest(candidate_ids) candidate_id
      where candidate_id <> p_existing_guest_id
    ) then
      raise exception 'Guest contact matches another local profile'
        using errcode = '23505';
    end if;
    resolved_guest_id := p_existing_guest_id;
  else
    if cardinality(candidate_ids) > 1 then
      raise exception 'Guest contact matches multiple local profiles'
        using errcode = '23505';
    end if;
    if cardinality(candidate_ids) = 1 then
      resolved_guest_id := candidate_ids[1];
    end if;
  end if;

  if resolved_guest_id is not null then
    select guest.id
    into resolved_guest_id
    from public.guests guest
    join public.guest_locations guest_location
      on guest_location.organization_id = guest.organization_id
     and guest_location.guest_id = guest.id
     and guest_location.location_id = p_location_id
    where guest.organization_id = p_organization_id
      and guest.id = resolved_guest_id
      and guest.merged_into_id is null
    for update of guest;
    if resolved_guest_id is null then
      raise exception 'Guest identity changed concurrently; retry the request'
        using errcode = '40001';
    end if;

    -- The row lock may have waited behind a contact update. Re-run the exact
    -- local predicate after the wait; a stale snapshot must never attach a
    -- reservation to a profile that no longer owns the supplied contact.
    select coalesce(
      array_agg(candidate.id order by candidate.id),
      '{}'::uuid[]
    )
    into fresh_candidate_ids
    from (
      select distinct guest.id
      from public.guests guest
      join public.guest_locations guest_location
        on guest_location.organization_id = guest.organization_id
       and guest_location.guest_id = guest.id
       and guest_location.location_id = p_location_id
      where guest.organization_id = p_organization_id
        and guest.merged_into_id is null
        and (
          (clean_email is not null and lower(guest.email) = clean_email)
          or (
            clean_phone is not null
            and regexp_replace(coalesce(guest.phone, ''), '[^0-9]', '', 'g')
              = clean_phone
          )
        )
    ) candidate;

    if p_existing_guest_id is not null then
      if exists (
        select 1
        from unnest(fresh_candidate_ids) candidate_id
        where candidate_id <> p_existing_guest_id
      ) then
        raise exception 'Guest contact matches another local profile'
          using errcode = '23505';
      end if;
    elsif cardinality(fresh_candidate_ids) > 1 then
      raise exception 'Guest contact matches multiple local profiles'
        using errcode = '23505';
    elsif cardinality(fresh_candidate_ids) <> 1
      or fresh_candidate_ids[1] <> resolved_guest_id then
      raise exception 'Guest identity changed concurrently; retry the request'
        using errcode = '40001';
    end if;
    return resolved_guest_id;
  end if;

  insert into public.guests (
    id, organization_id, first_name, last_name, display_name,
    email, phone, source, external_references
  ) values (
    p_new_guest_id, p_organization_id, clean_first_name, clean_last_name,
    clean_display_name, clean_email, stored_phone, p_source,
    p_external_references
  ) returning id into resolved_guest_id;

  insert into public.guest_locations (
    organization_id, guest_id, location_id, is_home_location
  ) values (
    p_organization_id, resolved_guest_id, p_location_id, true
  );

  return resolved_guest_id;
end
$$;

revoke all on function private.resolve_location_guest_identity(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb
) from public, anon, authenticated, service_role;

comment on function private.resolve_location_guest_identity(
  uuid, uuid, uuid, uuid, text, text, text, text, text, text, text, jsonb
) is
  'Serializes normalized contacts, validates caller-specific replay intent, resolves only exact-location linked profiles, rejects ambiguity, and creates one linked CRM profile. Public callers may invoke it only after contact verification.';

create or replace function public.save_waitlist_entry_v2(
  p_request_id uuid,
  p_location_id uuid,
  p_guest_id uuid,
  p_display_name text,
  p_email text,
  p_phone text,
  p_party_size integer,
  p_desired_from timestamptz,
  p_desired_to timestamptz,
  p_quoted_wait_minutes integer,
  p_notes text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  organization_uuid uuid;
  waitlist_row public.waitlist_entries%rowtype;
  resolved_guest_id uuid;
  clean_email text := lower(nullif(btrim(p_email), ''));
  clean_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
begin
  if actor_id is null or p_request_id is null or p_location_id is null
    or length(btrim(coalesce(p_display_name, ''))) not between 1 and 160
    or p_party_size not between 1 and 100
    or p_quoted_wait_minutes not between 0 and 1440
    or length(coalesce(p_notes, '')) > 2000
    or (clean_email is not null and clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    or clean_phone is null or length(clean_phone) not between 7 and 24
    or (p_desired_to is not null and p_desired_from is not null and p_desired_to < p_desired_from) then
    raise exception 'A valid waitlist entry and mobile number are required' using errcode = '22023';
  end if;
  select location.organization_id into organization_uuid
  from public.locations location where location.id = p_location_id and location.is_active;
  if organization_uuid is null then
    raise exception 'Waitlist location not found' using errcode = 'P0002';
  end if;
  if not public.has_capability(organization_uuid, p_location_id, 'reservations.operate') then
    raise exception 'Reservation operating access is required' using errcode = '42501';
  end if;
  if not private.claim_operation_request(
    p_request_id, 'waitlist.save.v2', organization_uuid, p_location_id,
    p_request_id, jsonb_build_object(
      'guestId', p_guest_id, 'displayName', btrim(p_display_name),
      'email', clean_email, 'phone', clean_phone, 'partySize', p_party_size,
      'desiredFrom', p_desired_from, 'desiredTo', p_desired_to,
      'quotedWaitMinutes', p_quoted_wait_minutes,
      'notes', nullif(btrim(p_notes), '')
    )
  ) then
    select * into waitlist_row from public.waitlist_entries entry
    where entry.organization_id = organization_uuid and entry.id = p_request_id;
    return jsonb_build_object('id', waitlist_row.id, 'status', waitlist_row.status, 'replayed', true);
  end if;

  resolved_guest_id := private.resolve_location_guest_identity(
    organization_uuid,
    p_location_id,
    p_guest_id,
    p_request_id,
    'none',
    btrim(p_display_name),
    null,
    null,
    clean_email,
    clean_phone,
    'manual',
    '{}'::jsonb
  );

  insert into public.waitlist_entries (
    id, organization_id, location_id, guest_id, display_name, email, phone,
    party_size, desired_from, desired_to, quoted_wait_minutes, notes, created_by
  ) values (
    p_request_id, organization_uuid, p_location_id, resolved_guest_id,
    btrim(p_display_name), clean_email, clean_phone, p_party_size,
    p_desired_from, p_desired_to, p_quoted_wait_minutes,
    nullif(btrim(p_notes), ''), actor_id
  ) returning * into waitlist_row;
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object('id', waitlist_row.id, 'status', waitlist_row.status, 'replayed', false);
end
$$;

revoke all on function public.save_waitlist_entry_v2(
  uuid, uuid, uuid, text, text, text, integer,
  timestamptz, timestamptz, integer, text
) from public, anon, authenticated, service_role;
grant execute on function public.save_waitlist_entry_v2(
  uuid, uuid, uuid, text, text, text, integer,
  timestamptz, timestamptz, integer, text
) to authenticated;

create or replace function public.save_reservation_with_guest(
  p_request_id uuid,
  p_location_id uuid,
  p_display_name text,
  p_email text,
  p_phone text,
  p_reserved_at timestamptz,
  p_duration_minutes integer,
  p_party_size integer,
  p_special_requests text,
  p_source text,
  p_table_ids uuid[]
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  organization_uuid uuid;
  guest_uuid uuid;
  reservation_row public.reservations%rowtype;
  reservation_request_id uuid := (
    left(p_request_id::text, 35)
    || translate(
      right(p_request_id::text, 1),
      '0123456789abcdef',
      '89abcdef01234567'
    )
  )::uuid;
  clean_email text := lower(nullif(btrim(p_email), ''));
  clean_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  result jsonb;
begin
  if auth.uid() is null or p_request_id is null or p_location_id is null
    or length(btrim(coalesce(p_display_name, ''))) not between 1 and 160
    or (clean_email is not null and clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
    or (clean_phone is not null and length(clean_phone) not between 7 and 24) then
    raise exception 'Valid guest details are required' using errcode = '22023';
  end if;
  select location.organization_id into organization_uuid
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if organization_uuid is null then
    raise exception 'Reservation location not found' using errcode = 'P0002';
  end if;
  if not public.has_capability(
    organization_uuid, p_location_id, 'reservations.operate'
  ) then
    raise exception 'Reservation operating access is required' using errcode = '42501';
  end if;

  -- This wrapper owns the browser-visible idempotency key, including every
  -- guest-contact and reservation argument. Exact replays return before guest
  -- resolution, which remains correct even after CRM merges move the committed
  -- reservation to a different active guest profile.
  if not private.claim_operation_request(
    p_request_id,
    'reservation.save-with-guest',
    organization_uuid,
    p_location_id,
    p_request_id,
    jsonb_build_object(
      'displayName', btrim(p_display_name),
      'email', clean_email,
      'phone', clean_phone,
      'reservedAt', p_reserved_at,
      'durationMinutes', p_duration_minutes,
      'partySize', p_party_size,
      'specialRequests', nullif(btrim(p_special_requests), ''),
      'source', p_source,
      'tableIds', p_table_ids
    )
  ) then
    select *
    into reservation_row
    from public.reservations reservation
    where reservation.organization_id = organization_uuid
      and reservation.location_id = p_location_id
      and reservation.id = p_request_id;
    if reservation_row.id is null then
      raise exception 'Reservation request has no result row'
        using errcode = '40001';
    end if;
    select guest.id
    into guest_uuid
    from public.guests guest
    where guest.organization_id = organization_uuid
      and guest.id = reservation_row.guest_id
      and guest.merged_into_id is null;
    if guest_uuid is null then
      raise exception 'Reservation request has no active guest result'
        using errcode = '40001';
    end if;
    return jsonb_build_object(
      'id', reservation_row.id,
      'status', reservation_row.status,
      'version', reservation_row.version,
      'replayed', true,
      'guestId', guest_uuid
    );
  end if;

  if exists (
    select 1
    from public.reservations reservation
    where reservation.id = p_request_id
  ) or exists (
    select 1
    from public.waitlist_entries entry
    where entry.id = p_request_id
  ) or exists (
    select 1
    from private.public_booking_holds hold
    where hold.id = p_request_id
  ) then
    raise exception 'Reservation request id was reused'
      using errcode = '23505';
  end if;

  guest_uuid := private.resolve_location_guest_identity(
    organization_uuid,
    p_location_id,
    null,
    p_request_id,
    'none',
    btrim(p_display_name),
    null,
    null,
    clean_email,
    clean_phone,
    'manual',
    '{}'::jsonb
  );

  result := public.save_reservation(
    reservation_request_id, p_location_id, p_request_id, guest_uuid, p_reserved_at,
    p_duration_minutes, p_party_size, p_special_requests,
    p_source, p_table_ids
  );
  perform private.complete_operation_request(p_request_id);
  return result || jsonb_build_object('guestId', guest_uuid);
end
$$;

revoke all on function public.save_reservation_with_guest(
  uuid, uuid, text, text, text, timestamptz,
  integer, integer, text, text, uuid[]
) from public, anon, authenticated, service_role;
grant execute on function public.save_reservation_with_guest(
  uuid, uuid, text, text, text, timestamptz,
  integer, integer, text, text, uuid[]
) to authenticated;
create or replace function public.service_confirm_public_reservation(
  p_organization_id uuid,
  p_location_id uuid,
  p_booking_hold_id uuid,
  p_confirmation_fingerprint text,
  p_verified_channel text,
  p_available_channels text[]
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  hold_row private.public_booking_holds%rowtype;
  reservation_row public.reservations%rowtype;
  guest_row public.guests%rowtype;
  settings_row public.reservation_settings%rowtype;
  verification_row private.public_booking_verifications%rowtype;
  channel text;
  effective_channels text[];
  resolved_guest_id uuid;
  delivery_state jsonb := '{}'::jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_organization_id is null or p_location_id is null or p_booking_hold_id is null
    or p_confirmation_fingerprint !~ '^[0-9a-f]{64}$'
    or p_verified_channel not in ('email', 'sms')
    or p_available_channels is null
    or cardinality(p_available_channels) not between 1 and 2
    or not (p_available_channels <@ array['email', 'sms']::text[]) then
    raise exception 'A valid scoped confirmation is required' using errcode = '22023';
  end if;

  -- Serialize the entire confirmation lifecycle per scoped hold before the
  -- first replay lookup. An exact concurrent retry waits and then returns the
  -- committed verification; a competing fingerprint observes the final hold
  -- state without entering guest resolution.
  perform pg_advisory_xact_lock(hashtextextended(
    'public-reservation-confirm:' || p_organization_id::text || ':'
      || p_location_id::text || ':' || p_booking_hold_id::text,
    0
  ));
  select * into verification_row
  from private.public_booking_verifications verification
  where verification.confirmation_fingerprint = p_confirmation_fingerprint;
  if verification_row.id is not null then
    if verification_row.organization_id = p_organization_id
      and verification_row.location_id = p_location_id
      and verification_row.booking_hold_id = p_booking_hold_id
      and verification_row.verified_channel = p_verified_channel then
      select * into hold_row from private.public_booking_holds hold
      where hold.organization_id = p_organization_id
        and hold.location_id = p_location_id and hold.id = p_booking_hold_id;
      select * into reservation_row from public.reservations reservation
      where reservation.organization_id = p_organization_id
        and reservation.location_id = p_location_id
        and reservation.id = hold_row.reservation_id;
      return jsonb_build_object(
        'reservationId', reservation_row.id, 'status', reservation_row.status,
        'manageDeliveryState', '{}'::jsonb, 'replayed', true
      );
    end if;
    raise exception 'Confirmation fingerprint was reused' using errcode = '23505';
  end if;

  select * into hold_row from private.public_booking_holds hold
  where hold.organization_id = p_organization_id
    and hold.location_id = p_location_id
    and hold.id = p_booking_hold_id;
  if hold_row.id is null or hold_row.status <> 'pending'
    or hold_row.expires_at <= clock_timestamp() then
    raise exception 'The reservation hold has expired' using errcode = '23514';
  end if;

  -- Identity locks precede reservation-inventory locks in every writer. This
  -- prevents a public-confirmation/staff-booking deadlock while the resolver's
  -- exact-location fresh check prevents duplicate local profiles.
  resolved_guest_id := private.resolve_location_guest_identity(
    p_organization_id,
    p_location_id,
    null,
    gen_random_uuid(),
    'none',
    hold_row.first_name || ' ' || hold_row.last_name,
    hold_row.first_name,
    hold_row.last_name,
    case when p_verified_channel = 'email' then hold_row.email end,
    case when p_verified_channel = 'sms' then hold_row.phone end,
    'other',
    jsonb_build_object(
      'le_yard_web', true,
      'verified_channel', p_verified_channel
    )
  );
  select *
  into guest_row
  from public.guests guest
  where guest.organization_id = p_organization_id
    and guest.id = resolved_guest_id;

  perform private.lock_reservation_inventory(p_location_id, hold_row.reserved_at);
  perform private.expire_public_booking_holds(
    p_organization_id, p_location_id, clock_timestamp(), 1000,
    hold_row.reserved_at
  );

  -- A concurrent exact confirmation may have committed while this call was
  -- waiting for the inventory lock. Recheck before locking settings/hold rows.
  select * into verification_row
  from private.public_booking_verifications verification
  where verification.confirmation_fingerprint = p_confirmation_fingerprint;
  if verification_row.id is not null then
    if verification_row.organization_id = p_organization_id
      and verification_row.location_id = p_location_id
      and verification_row.booking_hold_id = p_booking_hold_id
      and verification_row.verified_channel = p_verified_channel then
      select * into hold_row from private.public_booking_holds hold
      where hold.organization_id = p_organization_id
        and hold.location_id = p_location_id and hold.id = p_booking_hold_id;
      select * into reservation_row from public.reservations reservation
      where reservation.organization_id = p_organization_id
        and reservation.location_id = p_location_id
        and reservation.id = hold_row.reservation_id;
      return jsonb_build_object(
        'reservationId', reservation_row.id, 'status', reservation_row.status,
        'manageDeliveryState', '{}'::jsonb, 'replayed', true
      );
    end if;
    raise exception 'Confirmation fingerprint was reused' using errcode = '23505';
  end if;

  select * into settings_row from public.reservation_settings setting
  where setting.organization_id = p_organization_id
    and setting.location_id = p_location_id
  for update;
  select array_agg(value order by value) into effective_channels
  from (
    select p_verified_channel value
    where p_verified_channel = any(p_available_channels)
      and p_verified_channel = any(settings_row.verification_channels)
  ) channels;
  if settings_row.id is null or not settings_row.online_booking_enabled
    or settings_row.approved_at is null
    or not settings_row.guest_messaging_enabled
    or coalesce(cardinality(effective_channels), 0) < 1 then
    raise exception 'Confirmed-reservation delivery is unavailable'
      using errcode = '55000';
  end if;

  select * into hold_row from private.public_booking_holds hold
  where hold.organization_id = p_organization_id
    and hold.location_id = p_location_id
    and hold.id = p_booking_hold_id
  for update;
  if hold_row.id is null or hold_row.status <> 'pending'
    or hold_row.expires_at <= clock_timestamp() then
    raise exception 'The reservation hold has expired' using errcode = '23514';
  end if;
  if not exists (
      select 1 from public.reservation_table_allocations allocation
      where allocation.organization_id = p_organization_id
        and allocation.location_id = p_location_id
        and allocation.booking_hold_id = p_booking_hold_id
        and allocation.is_active and allocation.allocation_kind = 'hold'
        and allocation.expires_at > clock_timestamp()
    ) then
    raise exception 'The reservation hold has expired' using errcode = '23514';
  end if;
  insert into private.public_booking_verifications (
    organization_id, location_id, booking_hold_id, confirmation_fingerprint,
    verified_channel
  ) values (
    p_organization_id, p_location_id, p_booking_hold_id,
    p_confirmation_fingerprint, p_verified_channel
  );

  -- A verified hold stops contributing provisional covers before the
  -- reservation INSERT trigger counts the confirmed commitment. The change
  -- is transaction-local and rolls back if any later step fails.
  update private.public_booking_holds hold
  set status = 'verified', verified_at = clock_timestamp(),
      redacted_at = clock_timestamp(), first_name = null, last_name = null,
      email = null, phone = null, special_requests = null,
      updated_at = clock_timestamp()
  where hold.id = hold_row.id;
  update public.reservation_message_outbox message
  set status = 'cancelled', claim_token = null, claimed_by = null,
      claimed_at = null, lease_expires_at = null,
      updated_at = clock_timestamp()
  where message.organization_id = p_organization_id
    and message.location_id = p_location_id
    and message.booking_hold_id = p_booking_hold_id
    and message.template_key = 'reservation_verify'
    and message.status in ('queued', 'failed', 'sending');

  reservation_row.id := gen_random_uuid();
  insert into public.reservations (
    id, organization_id, location_id, guest_id, reserved_at,
    duration_minutes, party_size, status, special_requests,
    source, booking_channel, public_code, confirmed_at
  ) values (
    reservation_row.id, p_organization_id, p_location_id, guest_row.id,
    hold_row.reserved_at, hold_row.duration_minutes, hold_row.party_size,
    'booked', hold_row.special_requests, 'le_yard_web', 'web',
    hold_row.public_code, clock_timestamp()
  ) returning * into reservation_row;
  update private.public_booking_holds hold
  set reservation_id = reservation_row.id, updated_at = clock_timestamp()
  where hold.id = hold_row.id;
  update public.reservation_table_allocations allocation
  set reservation_id = reservation_row.id, booking_hold_id = null,
      allocation_kind = 'assignment', expires_at = null,
      updated_at = clock_timestamp()
  where allocation.organization_id = p_organization_id
    and allocation.location_id = p_location_id
    and allocation.booking_hold_id = p_booking_hold_id
    and allocation.is_active;
  insert into public.reservation_events (
    organization_id, location_id, reservation_id, event_type,
    from_status, to_status, actor_kind, metadata
  ) values (
    p_organization_id, p_location_id, reservation_row.id,
    'guest_verified', 'pending_verification', 'booked', 'guest',
    jsonb_build_object('holdId', hold_row.id)
  );
  foreach channel in array effective_channels loop
    insert into public.reservation_message_outbox (
      organization_id, location_id, reservation_id, guest_id, channel,
      template_key, template_data, dedupe_key
    ) values (
      p_organization_id, p_location_id, reservation_row.id, guest_row.id, channel,
      'reservation_confirmed', jsonb_build_object(
        'purpose', 'reservation_manage_exchange',
        'channel', channel,
        'publicCode', reservation_row.public_code
      ),
      'reservation:' || reservation_row.id::text || ':confirmed:' || channel
    ) on conflict (organization_id, dedupe_key) do nothing;
    delivery_state := delivery_state || jsonb_build_object(channel, 'queued');
  end loop;
  return jsonb_build_object(
    'reservationId', reservation_row.id, 'status', reservation_row.status,
    'manageDeliveryState', delivery_state, 'replayed', false
  );
end
$$;


revoke all on function public.service_confirm_public_reservation(
  uuid, uuid, uuid, text, text, text[]
) from public, anon, authenticated, service_role;
grant execute on function public.service_confirm_public_reservation(
  uuid, uuid, uuid, text, text, text[]
) to service_role;

comment on function public.service_confirm_public_reservation(
  uuid, uuid, uuid, text, text, text[]
) is
  'Confirms one exact scoped hold, resolves only its verified contact inside the booking location, and queues management delivery without returning secrets.';
