-- Le Yard OS: touch floor editing and one-step public reservations.

alter table private.public_booking_verifications
add column verification_method text not null default 'link'
check (verification_method in ('link', 'booking_submission'));

create function public.move_reservation_table(
  p_request_id uuid,
  p_table_id uuid,
  p_position_x numeric,
  p_position_y numeric
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  table_row public.reservation_tables%rowtype;
  payload jsonb;
  replayed boolean := false;
  previous_position_x numeric;
  previous_position_y numeric;
begin
  if actor_id is null or p_request_id is null or p_table_id is null
    or p_position_x is null or p_position_x not between 0 and 1
    or p_position_y is null or p_position_y not between 0 and 1 then
    raise exception 'A valid table move is required' using errcode = '22023';
  end if;

  select * into table_row
  from public.reservation_tables reservation_table
  where reservation_table.id = p_table_id
    and reservation_table.is_active
  for update;
  if table_row.id is null then
    raise exception 'Reservation table not found' using errcode = 'P0002';
  end if;
  if not public.has_capability(
    table_row.organization_id,
    table_row.location_id,
    'reservations.configure'
  ) then
    raise exception 'Reservation configuration access is required'
      using errcode = '42501';
  end if;
  previous_position_x := table_row.position_x;
  previous_position_y := table_row.position_y;

  payload := jsonb_build_object(
    'tableId', p_table_id,
    'positionX', p_position_x,
    'positionY', p_position_y
  );
  if not private.claim_operation_request(
    p_request_id,
    'reservation.table_move',
    table_row.organization_id,
    table_row.location_id,
    table_row.id,
    payload
  ) then
    replayed := true;
  else
    update public.reservation_tables reservation_table
    set position_x = p_position_x,
        position_y = p_position_y,
        updated_at = clock_timestamp()
    where reservation_table.organization_id = table_row.organization_id
      and reservation_table.id = table_row.id
    returning * into table_row;

    insert into public.audit_events (
      organization_id, location_id, actor_id, action, table_name,
      record_id, old_record, new_record, request_id, metadata
    ) values (
      table_row.organization_id, table_row.location_id, actor_id,
      'reservation_table_moved', 'reservation_tables', table_row.id::text,
      jsonb_build_object(
        'positionX', previous_position_x,
        'positionY', previous_position_y
      ),
      jsonb_build_object('positionX', p_position_x, 'positionY', p_position_y),
      p_request_id::text,
      jsonb_build_object('actorKind', 'staff', 'interaction', 'drag_drop')
    );
    perform private.complete_operation_request(p_request_id);
  end if;

  return jsonb_build_object(
    'id', table_row.id,
    'positionX', table_row.position_x,
    'positionY', table_row.position_y,
    'replayed', replayed
  );
end
$$;

revoke all on function public.move_reservation_table(uuid, uuid, numeric, numeric)
from public, anon, authenticated, service_role;
grant execute on function public.move_reservation_table(uuid, uuid, numeric, numeric)
to authenticated;

comment on function public.move_reservation_table(uuid, uuid, numeric, numeric) is
'Moves one active floor table using normalized coordinates. Exact replay is idempotent and reservations.configure is required.';

create function public.service_book_public_reservation(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_reserved_at timestamptz,
  p_duration_minutes integer,
  p_party_size integer,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_special_requests text,
  p_table_ids uuid[],
  p_available_channels text[]
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  settings_row public.reservation_settings%rowtype;
  reservation_row public.reservations%rowtype;
  guest_row public.guests%rowtype;
  hold_row private.public_booking_holds%rowtype;
  prior_request private.public_booking_requests%rowtype;
  payload_hash text;
  confirmation_fingerprint text;
  clean_first_name text := nullif(btrim(p_first_name), '');
  clean_last_name text := nullif(btrim(p_last_name), '');
  clean_email text := lower(nullif(btrim(p_email), ''));
  clean_phone text := nullif(regexp_replace(coalesce(p_phone, ''), '[^0-9+]', '', 'g'), '');
  end_at timestamptz;
  table_id uuid;
  delivery_state jsonb := '{}'::jsonb;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_organization_id is null or p_location_id is null
    or p_reserved_at is null or p_duration_minutes not between 15 and 720
    or p_party_size not between 1 and 100
    or clean_first_name is null or clean_last_name is null
    or clean_email is null
    or clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$'
    or clean_phone is null or length(clean_phone) not between 7 and 24
    or length(coalesce(p_special_requests, '')) > 5000
    or p_table_ids is null or cardinality(p_table_ids) not between 1 and 8
    or p_available_channels is null
    or not ('email' = any(p_available_channels))
    or not (p_available_channels <@ array['email', 'sms']::text[]) then
    raise exception 'A valid public reservation is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.locations location
    where location.organization_id = p_organization_id
      and location.id = p_location_id
      and location.is_active
  ) then
    raise exception 'Reservation location not found' using errcode = 'P0002';
  end if;

  perform private.lock_reservation_inventory(p_location_id, p_reserved_at);
  perform private.expire_public_booking_holds(
    p_organization_id, p_location_id, clock_timestamp(), 1000, p_reserved_at
  );

  select * into settings_row
  from public.reservation_settings setting
  where setting.organization_id = p_organization_id
    and setting.location_id = p_location_id
  for update;
  if settings_row.id is null or not settings_row.online_booking_enabled
    or settings_row.approved_at is null
    or not settings_row.guest_messaging_enabled
    or not ('email' = any(settings_row.verification_channels)) then
    raise exception 'Confirmation email delivery is unavailable'
      using errcode = '55000';
  end if;
  if p_party_size > settings_row.max_online_party_size
    or p_reserved_at < clock_timestamp()
      + make_interval(mins => settings_row.minimum_lead_minutes)
    or p_reserved_at > clock_timestamp()
      + make_interval(days => settings_row.booking_horizon_days) then
    raise exception 'The requested time is outside online booking rules'
      using errcode = '23514';
  end if;

  payload_hash := encode(extensions.digest(jsonb_build_object(
    'organizationId', p_organization_id,
    'locationId', p_location_id,
    'reservedAt', p_reserved_at,
    'durationMinutes', p_duration_minutes,
    'partySize', p_party_size,
    'firstName', clean_first_name,
    'lastName', clean_last_name,
    'email', clean_email,
    'phone', clean_phone,
    'specialRequests', nullif(btrim(p_special_requests), ''),
    'tableIds', p_table_ids,
    'availableChannels', p_available_channels
  )::text, 'sha256'), 'hex');

  select * into prior_request
  from private.public_booking_requests request
  where request.request_id = p_request_id
  for update;
  if prior_request.request_id is not null then
    if prior_request.organization_id = p_organization_id
      and prior_request.location_id = p_location_id
      and prior_request.operation_kind = 'public.reservation.book'
      and prior_request.payload_hash = payload_hash
      and prior_request.completed_at is not null then
      select * into reservation_row
      from public.reservations reservation
      where reservation.organization_id = p_organization_id
        and reservation.location_id = p_location_id
        and reservation.id = prior_request.reservation_id;
      select coalesce(jsonb_object_agg(message.channel, 'queued'), '{}'::jsonb)
      into delivery_state
      from public.reservation_message_outbox message
      where message.organization_id = p_organization_id
        and message.location_id = p_location_id
        and message.reservation_id = reservation_row.id
        and message.template_key = 'reservation_confirmed';
      return jsonb_build_object(
        'reservationId', reservation_row.id,
        'status', reservation_row.status,
        'deliveryState', delivery_state,
        'replayed', true
      );
    end if;
    raise exception 'Idempotency key was reused' using errcode = '23505';
  end if;

  reservation_row.id := gen_random_uuid();
  insert into private.public_booking_requests (
    request_id, organization_id, location_id, reservation_id,
    operation_kind, payload_hash
  ) values (
    p_request_id, p_organization_id, p_location_id, reservation_row.id,
    'public.reservation.book', payload_hash
  );

  end_at := p_reserved_at + make_interval(mins => p_duration_minutes);
  perform private.assert_reservation_pacing(
    p_organization_id, p_location_id, p_reserved_at, p_party_size, null, null
  );
  perform private.assert_reservation_tables_available(
    p_organization_id, p_location_id, null, p_table_ids,
    p_reserved_at, end_at, p_party_size
  );

  hold_row.id := gen_random_uuid();
  insert into private.public_booking_holds (
    id, organization_id, location_id, reserved_at, duration_minutes,
    party_size, special_requests, public_code, first_name, last_name,
    email, phone, expires_at
  ) values (
    hold_row.id, p_organization_id, p_location_id, p_reserved_at,
    p_duration_minutes, p_party_size, nullif(btrim(p_special_requests), ''),
    upper(substr(replace(hold_row.id::text, '-', ''), 1, 8)),
    clean_first_name, clean_last_name, clean_email, clean_phone,
    clock_timestamp() + interval '5 minutes'
  ) returning * into hold_row;

  confirmation_fingerprint := encode(extensions.digest(
    'reservation-booking-submission:v1' || chr(31)
      || p_request_id::text || chr(31) || clean_email,
    'sha256'
  ), 'hex');
  insert into private.public_booking_verifications (
    organization_id, location_id, booking_hold_id,
    confirmation_fingerprint, verified_channel, verification_method
  ) values (
    p_organization_id, p_location_id, hold_row.id,
    confirmation_fingerprint, 'email', 'booking_submission'
  );

  perform pg_advisory_xact_lock(hashtextextended(
    'guest-email:' || p_organization_id::text || ':' || clean_email,
    0
  ));
  select * into guest_row
  from public.guests guest
  where guest.organization_id = p_organization_id
    and guest.merged_into_id is null
    and lower(guest.email) = clean_email
  limit 1;
  if guest_row.id is null then
    insert into public.guests (
      organization_id, first_name, last_name, display_name,
      email, phone, source, external_references
    ) values (
      p_organization_id, clean_first_name, clean_last_name,
      clean_first_name || ' ' || clean_last_name,
      clean_email, clean_phone, 'other',
      jsonb_build_object(
        'le_yard_web', true,
        'contact_basis', 'booking_submission'
      )
    ) returning * into guest_row;
  end if;

  insert into public.reservations (
    id, organization_id, location_id, guest_id, reserved_at,
    duration_minutes, party_size, status, special_requests,
    source, booking_channel, public_code, confirmed_at
  ) values (
    reservation_row.id, p_organization_id, p_location_id, guest_row.id,
    p_reserved_at, p_duration_minutes, p_party_size, 'confirmed',
    nullif(btrim(p_special_requests), ''), 'le_yard_web', 'web',
    hold_row.public_code, clock_timestamp()
  ) returning * into reservation_row;

  foreach table_id in array p_table_ids loop
    insert into public.reservation_table_allocations (
      organization_id, location_id, reservation_id, table_id,
      allocation_kind, starts_at, ends_at
    ) values (
      p_organization_id, p_location_id, reservation_row.id, table_id,
      'assignment', p_reserved_at, end_at
    );
  end loop;

  update private.public_booking_holds hold
  set reservation_id = reservation_row.id,
      status = 'verified',
      verified_at = clock_timestamp(),
      redacted_at = clock_timestamp(),
      first_name = null,
      last_name = null,
      email = null,
      phone = null,
      special_requests = null,
      updated_at = clock_timestamp()
  where hold.id = hold_row.id;

  insert into public.reservation_events (
    organization_id, location_id, reservation_id, event_type,
    from_status, to_status, actor_kind, metadata
  ) values (
    p_organization_id, p_location_id, reservation_row.id,
    'public_booking_created', null, 'confirmed', 'guest',
    jsonb_build_object(
      'contactBasis', 'booking_submission',
      'confirmationRequired', false
    )
  );

  insert into public.reservation_message_outbox (
    organization_id, location_id, reservation_id, guest_id, channel,
    template_key, template_data, dedupe_key
  ) values (
    p_organization_id, p_location_id, reservation_row.id, guest_row.id,
    'email', 'reservation_confirmed',
    jsonb_build_object(
      'purpose', 'reservation_manage_exchange',
      'channel', 'email',
      'reservationVersion', reservation_row.version
    ),
    'reservation:' || reservation_row.id::text || ':confirmed:email'
  ) on conflict (organization_id, dedupe_key) do nothing;
  delivery_state := jsonb_build_object('email', 'queued');

  insert into public.audit_events (
    organization_id, location_id, action, table_name, record_id,
    new_record, request_id, metadata
  ) values (
    p_organization_id, p_location_id, 'public_reservation_booked',
    'reservations', reservation_row.id::text,
    jsonb_build_object(
      'status', reservation_row.status,
      'reservedAt', reservation_row.reserved_at,
      'partySize', reservation_row.party_size
    ),
    p_request_id::text,
    jsonb_build_object(
      'actorKind', 'guest',
      'confirmationRequired', false
    )
  );

  update private.public_booking_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;

  return jsonb_build_object(
    'reservationId', reservation_row.id,
    'status', reservation_row.status,
    'deliveryState', delivery_state,
    'replayed', false
  );
end
$$;

revoke all on function public.service_book_public_reservation(
  uuid, uuid, uuid, timestamptz, integer, integer, text, text,
  text, text, text, uuid[], text[]
) from public, anon, authenticated, service_role;
grant execute on function public.service_book_public_reservation(
  uuid, uuid, uuid, timestamptz, integer, integer, text, text,
  text, text, text, uuid[], text[]
) to service_role;

comment on function public.service_book_public_reservation(
  uuid, uuid, uuid, timestamptz, integer, integer, text, text,
  text, text, text, uuid[], text[]
) is
'Atomically creates a confirmed public reservation and queues its email without a guest confirmation step.';
