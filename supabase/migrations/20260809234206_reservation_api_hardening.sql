create table private.booking_api_rate_limits (
  bucket_hash text not null check (bucket_hash ~ '^[0-9a-f]{64}$'),
  window_started_at timestamptz not null,
  request_count integer not null check (request_count > 0),
  primary key (bucket_hash, window_started_at)
);

revoke all on table private.booking_api_rate_limits from public, anon, authenticated;

create table public.reservation_push_deliveries (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  notification_id uuid not null references public.notifications(id) on delete cascade,
  subscription_id uuid not null references public.push_subscriptions(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'cancelled')),
  attempts integer not null default 0 check (attempts between 0 and 10),
  last_error_code text,
  sent_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (notification_id, subscription_id)
);

alter table public.reservation_push_deliveries enable row level security;
alter table public.reservation_push_deliveries force row level security;
revoke all on table public.reservation_push_deliveries from public, anon, authenticated;
grant select, insert, update on table public.reservation_push_deliveries to service_role;

create function private.notify_reservation_staff()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  recipient record;
  title text;
  body text;
  effective_on date;
begin
  if new.event_type not in ('guest_verified', 'guest_modified', 'guest_cancelled') then
    return new;
  end if;
  title := case new.event_type
    when 'guest_verified' then 'New reservation confirmed'
    when 'guest_modified' then 'Reservation modified'
    else 'Reservation cancelled'
  end;
  body := case new.event_type
    when 'guest_verified' then 'A guest confirmed a new online reservation.'
    when 'guest_modified' then 'A guest changed an online reservation.'
    else 'A guest cancelled an online reservation.'
  end;
  select (statement_timestamp() at time zone location.timezone)::date
  into effective_on
  from public.locations location
  where location.organization_id = new.organization_id
    and location.id = new.location_id
    and location.is_active;
  for recipient in
    select membership.user_id
    from public.organization_memberships membership
    where membership.organization_id = new.organization_id
      and membership.status = 'active'
      and (
        private.user_has_capability(
          membership.user_id, new.organization_id, new.location_id,
          'reservations.operate', effective_on
        )
        or private.user_has_capability(
          membership.user_id, new.organization_id, new.location_id,
          'reservations.view', effective_on
        )
      )
  loop
    perform private.emit_derived_notification(
      new.organization_id, recipient.user_id,
      'reservation.event:' || new.id::text || ':' || recipient.user_id::text,
      'reservation_changed', title, body, '/reservations',
      'reservation', new.reservation_id
    );
  end loop;
  return new;
end
$$;

create trigger reservation_events_notify_staff
after insert on public.reservation_events
for each row execute function private.notify_reservation_staff();

revoke all on function private.notify_reservation_staff()
from public, anon, authenticated;

create function private.enforce_public_reservation_pacing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.booking_channel <> 'web'
    or new.status in ('cancelled', 'no_show', 'completed') then
    return new;
  end if;
  perform private.assert_reservation_pacing(
    new.organization_id, new.location_id, new.reserved_at, new.party_size,
    new.id, null
  );
  return new;
end
$$;

create trigger reservations_public_pacing_guard
before insert or update of reserved_at, party_size, status on public.reservations
for each row execute function private.enforce_public_reservation_pacing();

revoke all on function private.enforce_public_reservation_pacing()
from public, anon, authenticated;

create function public.service_claim_booking_rate_limit(
  p_bucket_hash text,
  p_limit integer,
  p_window_seconds integer
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  window_start timestamptz;
  current_count integer;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_bucket_hash !~ '^[0-9a-f]{64}$'
    or p_limit not between 1 and 10000
    or p_window_seconds not between 1 and 86400 then
    raise exception 'A valid rate limit claim is required' using errcode = '22023';
  end if;
  window_start := to_timestamp(
    floor(extract(epoch from clock_timestamp()) / p_window_seconds) * p_window_seconds
  );
  insert into private.booking_api_rate_limits (
    bucket_hash, window_started_at, request_count
  ) values (p_bucket_hash, window_start, 1)
  on conflict (bucket_hash, window_started_at) do update
  set request_count = private.booking_api_rate_limits.request_count + 1
  returning request_count into current_count;
  if random() < 0.01 then
    delete from private.booking_api_rate_limits
    where window_started_at < clock_timestamp() - interval '2 days';
  end if;
  return jsonb_build_object(
    'allowed', current_count <= p_limit,
    'limit', p_limit,
    'remaining', greatest(p_limit - current_count, 0),
    'resetAt', window_start + make_interval(secs => p_window_seconds)
  );
end
$$;

create function public.service_modify_public_reservation(
  p_request_id uuid,
  p_manage_token_hash text,
  p_reserved_at timestamptz,
  p_duration_minutes integer,
  p_party_size integer,
  p_special_requests text,
  p_table_ids uuid[]
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  token_row private.public_booking_tokens%rowtype;
  reservation_row public.reservations%rowtype;
  settings_row public.reservation_settings%rowtype;
  prior_request private.public_booking_requests%rowtype;
  payload_hash text;
  old_reserved_at timestamptz;
  old_status text;
  table_id uuid;
  message_channel text;
  message_channels text[] := '{}'::text[];
  verified_message_channel text;
  manage_expires_at timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_manage_token_hash !~ '^[0-9a-f]{64}$'
    or p_reserved_at is null or p_duration_minutes not between 15 and 720
    or p_party_size not between 1 and 100 or cardinality(p_table_ids) < 1
    or length(coalesce(p_special_requests, '')) > 5000 then
    raise exception 'A valid modification request is required' using errcode = '22023';
  end if;
  select * into token_row from private.public_booking_tokens token
  where token.token_hash = p_manage_token_hash
    and token.token_kind = 'manage'
    and token.revoked_at is null
    and token.expires_at > clock_timestamp()
  for update;
  if token_row.id is null then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  select * into reservation_row from public.reservations reservation
  where reservation.id = token_row.reservation_id for update;
  if reservation_row.status not in ('booked', 'confirmed') then
    raise exception 'This reservation can no longer be modified' using errcode = '23514';
  end if;
  select * into settings_row from public.reservation_settings setting
  where setting.organization_id = reservation_row.organization_id
    and setting.location_id = reservation_row.location_id;
  if settings_row.modification_cutoff_minutes is null
    or reservation_row.reserved_at - make_interval(mins => settings_row.modification_cutoff_minutes) <= clock_timestamp()
    or p_party_size > settings_row.max_online_party_size then
    raise exception 'Online modification is closed for this reservation' using errcode = '23514';
  end if;
  payload_hash := encode(extensions.digest(jsonb_build_object(
    'reservationId', reservation_row.id, 'reservedAt', p_reserved_at,
    'durationMinutes', p_duration_minutes, 'partySize', p_party_size,
    'specialRequests', nullif(btrim(p_special_requests), ''),
    'tableIds', p_table_ids
  )::text, 'sha256'), 'hex');
  select * into prior_request from private.public_booking_requests request
  where request.request_id = p_request_id for update;
  if prior_request.request_id is not null then
    if prior_request.reservation_id = reservation_row.id
      and prior_request.operation_kind = 'public.reservation.modify'
      and prior_request.payload_hash = payload_hash
      and prior_request.completed_at is not null then
      return jsonb_build_object(
        'reservationId', reservation_row.id,
        'publicCode', reservation_row.public_code,
        'status', reservation_row.status,
        'replayed', true
      );
    end if;
    raise exception 'Idempotency key was reused' using errcode = '23505';
  end if;
  insert into private.public_booking_requests (
    request_id, organization_id, location_id, reservation_id,
    operation_kind, payload_hash
  ) values (
    p_request_id, reservation_row.organization_id, reservation_row.location_id,
    reservation_row.id, 'public.reservation.modify', payload_hash
  );
  old_reserved_at := reservation_row.reserved_at;
  old_status := reservation_row.status;
  perform private.lock_reservation_inventory(reservation_row.location_id, old_reserved_at);
  if old_reserved_at::date <> p_reserved_at::date then
    perform private.lock_reservation_inventory(reservation_row.location_id, p_reserved_at);
  end if;
  perform private.assert_reservation_tables_available(
    reservation_row.organization_id, reservation_row.location_id,
    reservation_row.id, p_table_ids, p_reserved_at,
    p_reserved_at + make_interval(mins => p_duration_minutes), p_party_size
  );
  update public.reservation_table_allocations allocation
  set is_active = false, released_at = clock_timestamp(), updated_at = clock_timestamp()
  where allocation.reservation_id = reservation_row.id and allocation.is_active;
  foreach table_id in array p_table_ids loop
    insert into public.reservation_table_allocations (
      organization_id, location_id, reservation_id, table_id,
      allocation_kind, starts_at, ends_at
    ) values (
      reservation_row.organization_id, reservation_row.location_id,
      reservation_row.id, table_id, 'assignment', p_reserved_at,
      p_reserved_at + make_interval(mins => p_duration_minutes)
    );
  end loop;
  update public.reservations reservation
  set reserved_at = p_reserved_at,
      duration_minutes = p_duration_minutes,
      party_size = p_party_size,
      special_requests = nullif(btrim(p_special_requests), ''),
      status = 'booked', version = reservation.version + 1,
      updated_at = clock_timestamp()
  where reservation.id = reservation_row.id returning * into reservation_row;
  update private.public_booking_tokens token
  set expires_at = reservation_row.reserved_at
    + make_interval(mins => reservation_row.duration_minutes) + interval '24 hours'
  where token.reservation_id = reservation_row.id
    and token.token_kind = 'manage' and token.revoked_at is null;
  insert into public.reservation_events (
    organization_id, location_id, reservation_id, event_type,
    from_status, to_status, actor_kind, metadata
  ) values (
    reservation_row.organization_id, reservation_row.location_id,
    reservation_row.id, 'guest_modified', old_status, reservation_row.status,
    'guest', jsonb_build_object('previousReservedAt', old_reserved_at)
  );
  if settings_row.guest_messaging_enabled then
    insert into public.reservation_message_outbox (
      organization_id, location_id, reservation_id, guest_id,
      channel, template_key, template_data, dedupe_key
    ) values (
      reservation_row.organization_id, reservation_row.location_id,
      reservation_row.id, reservation_row.guest_id, 'email',
      'reservation_modified', jsonb_build_object('publicCode', reservation_row.public_code),
      'reservation:' || reservation_row.id::text || ':modified:' || reservation_row.version::text || ':email'
    ) on conflict (organization_id, dedupe_key) do nothing;
  end if;
  update private.public_booking_requests request set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return jsonb_build_object(
    'reservationId', reservation_row.id,
    'publicCode', reservation_row.public_code,
    'status', reservation_row.status,
    'reservedAt', reservation_row.reserved_at,
    'replayed', false
  );
end
$$;

revoke all on function public.service_claim_booking_rate_limit(text, integer, integer)
from public, anon, authenticated;
revoke all on function public.service_modify_public_reservation(uuid, text, timestamptz, integer, integer, text, uuid[])
from public, anon, authenticated;
grant execute on function public.service_claim_booking_rate_limit(text, integer, integer) to service_role;
grant execute on function public.service_modify_public_reservation(uuid, text, timestamptz, integer, integer, text, uuid[]) to service_role;

comment on function public.service_claim_booking_rate_limit(text, integer, integer) is
'Service-only database-backed fixed-window rate limiter for public booking API routes.';
comment on function public.service_modify_public_reservation(uuid, text, timestamptz, integer, integer, text, uuid[]) is
'Service-only atomic guest modification command with manage-token, cutoff, idempotency, and inventory enforcement.';

create function public.install_le_yard_reservation_draft(
  p_request_id uuid,
  p_location_id uuid
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
  location_effective_date date;
  area_uuid uuid;
  period_uuid uuid;
  combination_uuid uuid;
  claimed boolean;
  table_definition jsonb;
  combination_definition jsonb;
begin
  select
    location.organization_id,
    (statement_timestamp() at time zone location.timezone)::date
  into organization_uuid, location_effective_date
  from public.locations location where location.id = p_location_id and location.is_active;
  if actor_id is null or p_request_id is null or organization_uuid is null then
    raise exception 'A valid reservation draft request is required' using errcode = '22023';
  end if;
  if not public.has_capability(organization_uuid, p_location_id, 'reservations.configure') then
    raise exception 'Reservation configuration access is required' using errcode = '42501';
  end if;
  claimed := private.claim_operation_request(
    p_request_id, 'reservation.install_le_yard_draft', organization_uuid,
    p_location_id, p_request_id, jsonb_build_object('locationId', p_location_id)
  );
  if not claimed then
    return jsonb_build_object('installed', true, 'replayed', true);
  end if;
  insert into public.reservation_settings (
    organization_id, location_id, online_booking_enabled,
    guest_messaging_enabled, staff_push_enabled, verification_hold_minutes,
    booking_horizon_days, minimum_lead_minutes, slot_interval_minutes,
    max_online_party_size, modification_cutoff_minutes,
    cancellation_cutoff_minutes, reminder_schedule_minutes
  ) values (
    organization_uuid, p_location_id, false, false, false, 10,
    60, 120, 15, 10, 240, 240, array[1440,120]
  ) on conflict (organization_id, location_id) do update set
    online_booking_enabled = false, guest_messaging_enabled = false,
    staff_push_enabled = false, approved_at = null, approved_by = null,
    updated_at = clock_timestamp()
  returning id into area_uuid;
  insert into public.dining_areas (
    organization_id, location_id, name, sort_order, is_active
  ) values (organization_uuid, p_location_id, 'Main dining room', 0, true)
  on conflict (organization_id, location_id, name) do update
  set is_active = true, updated_at = clock_timestamp()
  returning id into area_uuid;
  select period.id into period_uuid from public.reservation_service_periods period
  where period.organization_id = organization_uuid and period.location_id = p_location_id
    and period.name = 'Dinner' limit 1;
  if period_uuid is null then
    period_uuid := gen_random_uuid();
    insert into public.reservation_service_periods (
      id, organization_id, location_id, name, days_of_week,
      starts_local, ends_local, default_duration_minutes,
      pacing_interval_minutes, pacing_cover_limit, min_party_size,
      max_party_size, effective_from, online_enabled, is_active
    ) values (
      period_uuid, organization_uuid, p_location_id, 'Dinner',
      array[0,1,2,3,4,5,6], '17:00', '22:30', 90, 15, 14, 1, 10,
      location_effective_date, false, true
    );
  else
    update public.reservation_service_periods period set
      online_enabled = false, approved_at = null, approved_by = null,
      updated_at = clock_timestamp()
    where period.id = period_uuid;
  end if;
  insert into public.reservation_turn_rules (
    organization_id, service_period_id, min_party_size, max_party_size,
    duration_minutes
  ) values
    (organization_uuid, period_uuid, 1, 2, 75),
    (organization_uuid, period_uuid, 3, 4, 90),
    (organization_uuid, period_uuid, 5, 6, 120),
    (organization_uuid, period_uuid, 7, 10, 150)
  on conflict (service_period_id, min_party_size, max_party_size) do update
  set duration_minutes = excluded.duration_minutes,
      updated_at = clock_timestamp();
  for table_definition in select value from jsonb_array_elements('[
    {"label":"1","capacity":2,"x":0.40,"y":0.91,"w":0.11,"h":0.07,"shape":"round"},
    {"label":"2","capacity":2,"x":0.62,"y":0.91,"w":0.11,"h":0.07,"shape":"round"},
    {"label":"3","capacity":2,"x":0.84,"y":0.91,"w":0.11,"h":0.07,"shape":"round"},
    {"label":"4","capacity":4,"x":0.55,"y":0.76,"w":0.13,"h":0.08},
    {"label":"5","capacity":6,"x":0.81,"y":0.76,"w":0.17,"h":0.08},
    {"label":"6","capacity":4,"x":0.55,"y":0.61,"w":0.13,"h":0.08},
    {"label":"7","capacity":6,"x":0.81,"y":0.61,"w":0.17,"h":0.08},
    {"label":"8","capacity":4,"x":0.55,"y":0.46,"w":0.13,"h":0.08},
    {"label":"9","capacity":6,"x":0.81,"y":0.46,"w":0.17,"h":0.08},
    {"label":"10","capacity":4,"x":0.55,"y":0.31,"w":0.13,"h":0.08},
    {"label":"11","capacity":4,"x":0.81,"y":0.31,"w":0.13,"h":0.08},
    {"label":"12","capacity":4,"x":0.55,"y":0.19,"w":0.13,"h":0.08},
    {"label":"13","capacity":4,"x":0.81,"y":0.19,"w":0.13,"h":0.08},
    {"label":"14","capacity":4,"x":0.55,"y":0.07,"w":0.13,"h":0.08},
    {"label":"15","capacity":4,"x":0.81,"y":0.07,"w":0.13,"h":0.08},
    {"label":"16","capacity":4,"x":0.21,"y":0.19,"w":0.13,"h":0.08},
    {"label":"17","capacity":4,"x":0.21,"y":0.07,"w":0.13,"h":0.08}
  ]'::jsonb) loop
    insert into public.reservation_tables (
      organization_id, location_id, dining_area_id, label,
      min_capacity, max_capacity, position_x, position_y, width, height,
      shape, is_bookable, is_active
    ) values (
      organization_uuid, p_location_id, area_uuid,
      table_definition ->> 'label',
      case when (table_definition ->> 'capacity')::integer = 6 then 3 else 1 end,
      (table_definition ->> 'capacity')::integer,
      (table_definition ->> 'x')::numeric, (table_definition ->> 'y')::numeric,
      (table_definition ->> 'w')::numeric, (table_definition ->> 'h')::numeric,
      coalesce(table_definition ->> 'shape', 'rectangle'), false, true
    ) on conflict (organization_id, location_id, label) do update set
      dining_area_id = excluded.dining_area_id,
      min_capacity = excluded.min_capacity, max_capacity = excluded.max_capacity,
      position_x = excluded.position_x, position_y = excluded.position_y,
      width = excluded.width, height = excluded.height, shape = excluded.shape,
      is_bookable = false, approved_at = null, approved_by = null,
      is_active = true, updated_at = clock_timestamp();
  end loop;
  for combination_definition in select value from jsonb_array_elements('[
    {"label":"4 + 5","left":"4","right":"5","min":5,"max":10},
    {"label":"6 + 7","left":"6","right":"7","min":5,"max":10},
    {"label":"8 + 9","left":"8","right":"9","min":5,"max":10},
    {"label":"10 + 11","left":"10","right":"11","min":5,"max":8},
    {"label":"12 + 13","left":"12","right":"13","min":5,"max":8},
    {"label":"14 + 15","left":"14","right":"15","min":5,"max":8},
    {"label":"16 + 17","left":"16","right":"17","min":5,"max":8}
  ]'::jsonb) loop
    insert into public.reservation_table_combinations (
      organization_id, location_id, label, min_capacity, max_capacity,
      is_active
    ) values (
      organization_uuid, p_location_id, combination_definition ->> 'label',
      (combination_definition ->> 'min')::integer,
      (combination_definition ->> 'max')::integer, true
    ) on conflict (organization_id, location_id, label) do update set
      min_capacity = excluded.min_capacity,
      max_capacity = excluded.max_capacity,
      is_active = true, updated_at = clock_timestamp()
    returning id into combination_uuid;
    insert into public.reservation_table_combination_members (
      organization_id, combination_id, table_id, sort_order
    )
    select organization_uuid, combination_uuid, table_row.id,
      case when table_row.label = combination_definition ->> 'left' then 0 else 1 end
    from public.reservation_tables table_row
    where table_row.organization_id = organization_uuid
      and table_row.location_id = p_location_id
      and table_row.label in (
        combination_definition ->> 'left', combination_definition ->> 'right'
      )
    on conflict (combination_id, table_id) do update
    set sort_order = excluded.sort_order;
  end loop;
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object(
    'installed', true, 'replayed', false, 'tableCount', 17,
    'seatCount', 68, 'onlineBookingEnabled', false
  );
end
$$;

create function public.approve_le_yard_reservation_draft(
  p_request_id uuid,
  p_location_id uuid,
  p_enable_online boolean,
  p_enable_messaging boolean,
  p_enable_staff_push boolean,
  p_verification_note text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  organization_uuid uuid;
  table_count integer;
  seat_count integer;
  claimed boolean;
begin
  select location.organization_id into organization_uuid
  from public.locations location where location.id = p_location_id and location.is_active;
  if actor_id is null or p_request_id is null or organization_uuid is null
    or length(btrim(coalesce(p_verification_note, ''))) not between 12 and 1000 then
    raise exception 'On-site verification evidence is required' using errcode = '22023';
  end if;
  if not public.has_capability(organization_uuid, p_location_id, 'reservations.configure') then
    raise exception 'Reservation configuration access is required' using errcode = '42501';
  end if;
  select count(*), coalesce(sum(table_row.max_capacity), 0)::integer
  into table_count, seat_count from public.reservation_tables table_row
  where table_row.organization_id = organization_uuid
    and table_row.location_id = p_location_id and table_row.is_active;
  if table_count <> 17 or seat_count <> 68 then
    raise exception 'The Le Yard floor draft must contain 17 tables and 68 seats before approval'
      using errcode = '23514';
  end if;
  if not exists (
    select 1 from public.reservation_service_periods period
    where period.organization_id = organization_uuid
      and period.location_id = p_location_id and period.is_active
  ) then
    raise exception 'A service period is required before approval' using errcode = '23514';
  end if;
  if p_enable_online and (
    not p_enable_messaging
    or not exists (
      select 1 from public.reservation_settings setting
      where setting.organization_id = organization_uuid
        and setting.location_id = p_location_id
        and cardinality(setting.verification_channels) > 0
    )
  ) then
    raise exception 'Approved verification delivery is required before online booking'
      using errcode = '23514';
  end if;
  claimed := private.claim_operation_request(
    p_request_id, 'reservation.approve_le_yard_draft', organization_uuid,
    p_location_id, p_request_id, jsonb_build_object(
      'enableOnline', p_enable_online, 'enableMessaging', p_enable_messaging,
      'enableStaffPush', p_enable_staff_push,
      'verificationNote', btrim(p_verification_note)
    )
  );
  if not claimed then
    return jsonb_build_object('approved', true, 'replayed', true);
  end if;
  update public.reservation_tables table_row set
    is_bookable = true, approved_at = clock_timestamp(), approved_by = actor_id,
    updated_at = clock_timestamp()
  where table_row.organization_id = organization_uuid
    and table_row.location_id = p_location_id and table_row.is_active;
  update public.reservation_service_periods period set
    online_enabled = p_enable_online, approved_at = clock_timestamp(),
    approved_by = actor_id, updated_at = clock_timestamp()
  where period.organization_id = organization_uuid
    and period.location_id = p_location_id and period.is_active;
  update public.reservation_settings setting set
    online_booking_enabled = p_enable_online,
    guest_messaging_enabled = p_enable_messaging,
    staff_push_enabled = p_enable_staff_push,
    approved_at = clock_timestamp(), approved_by = actor_id,
    updated_at = clock_timestamp()
  where setting.organization_id = organization_uuid
    and setting.location_id = p_location_id;
  insert into public.audit_events (
    organization_id, location_id, actor_id, action, table_name,
    record_id, new_record, request_id
  ) values (
    organization_uuid, p_location_id, actor_id,
    'reservation_floor_approved', 'reservation_settings',
    p_location_id::text,
    jsonb_build_object(
      'tableCount', table_count, 'seatCount', seat_count,
      'enableOnline', p_enable_online, 'enableMessaging', p_enable_messaging,
      'enableStaffPush', p_enable_staff_push,
      'verificationNote', btrim(p_verification_note)
    ), p_request_id::text
  );
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object(
    'approved', true, 'replayed', false, 'tableCount', table_count,
    'seatCount', seat_count, 'onlineBookingEnabled', p_enable_online
  );
end
$$;

revoke all on function public.install_le_yard_reservation_draft(uuid, uuid)
from public, anon, authenticated;
revoke all on function public.approve_le_yard_reservation_draft(uuid, uuid, boolean, boolean, boolean, text)
from public, anon, authenticated;
grant execute on function public.install_le_yard_reservation_draft(uuid, uuid) to authenticated;
grant execute on function public.approve_le_yard_reservation_draft(uuid, uuid, boolean, boolean, boolean, text) to authenticated;

alter table public.waitlist_entries
add column email text,
add column phone text,
add constraint waitlist_entries_email_check check (
  email is null or (length(email) <= 320 and email ~ '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$')
),
add constraint waitlist_entries_phone_check check (
  phone is null or length(phone) between 7 and 24
);

create function public.save_waitlist_entry_v2(
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
  resolved_guest_id uuid := p_guest_id;
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
  if resolved_guest_id is null then
    select guest.id into resolved_guest_id from public.guests guest
    where guest.organization_id = organization_uuid and guest.merged_into_id is null
      and ((clean_email is not null and lower(guest.email) = clean_email) or guest.phone = clean_phone)
    order by guest.updated_at desc limit 1;
  end if;
  if resolved_guest_id is null then
    insert into public.guests (
      organization_id, display_name, email, phone, source, external_references
    ) values (
      organization_uuid, btrim(p_display_name), clean_email, clean_phone,
      'manual', '{}'::jsonb
    ) returning id into resolved_guest_id;
  end if;
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

create function public.transition_waitlist_entry(
  p_request_id uuid,
  p_waitlist_entry_id uuid,
  p_target_status text,
  p_note text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  waitlist_row public.waitlist_entries%rowtype;
  previous_status text;
begin
  if actor_id is null or p_request_id is null or p_waitlist_entry_id is null
    or p_target_status not in ('notified', 'accepted', 'expired', 'cancelled')
    or length(coalesce(p_note, '')) > 1000 then
    raise exception 'A valid waitlist transition is required' using errcode = '22023';
  end if;
  select * into waitlist_row from public.waitlist_entries entry
  where entry.id = p_waitlist_entry_id for update;
  if waitlist_row.id is null then raise exception 'Waitlist entry not found' using errcode = 'P0002'; end if;
  if not public.has_capability(waitlist_row.organization_id, waitlist_row.location_id, 'reservations.operate') then
    raise exception 'Reservation operating access is required' using errcode = '42501';
  end if;
  if not (
    (waitlist_row.status = 'waiting' and p_target_status in ('notified', 'expired', 'cancelled'))
    or (waitlist_row.status = 'notified' and p_target_status in ('accepted', 'expired', 'cancelled'))
    or (waitlist_row.status = 'accepted' and p_target_status = 'cancelled')
  ) then raise exception 'Invalid waitlist transition' using errcode = '23514'; end if;
  if not private.claim_operation_request(
    p_request_id, 'waitlist.transition', waitlist_row.organization_id,
    waitlist_row.location_id, waitlist_row.id,
    jsonb_build_object('targetStatus', p_target_status, 'note', nullif(btrim(p_note), ''))
  ) then
    return jsonb_build_object('id', waitlist_row.id, 'status', waitlist_row.status, 'replayed', true);
  end if;
  previous_status := waitlist_row.status;
  update public.waitlist_entries entry set
    status = p_target_status,
    notified_at = case when p_target_status = 'notified' then clock_timestamp() else entry.notified_at end,
    offer_expires_at = case when p_target_status = 'notified' then clock_timestamp() + interval '15 minutes' else entry.offer_expires_at end,
    notes = coalesce(nullif(btrim(p_note), ''), entry.notes),
    updated_at = clock_timestamp()
  where entry.id = waitlist_row.id returning * into waitlist_row;
  if p_target_status = 'notified' then
    insert into public.reservation_message_outbox (
      organization_id, location_id, waitlist_entry_id, guest_id,
      channel, template_key, template_data, dedupe_key
    ) values
      (waitlist_row.organization_id, waitlist_row.location_id, waitlist_row.id,
       waitlist_row.guest_id, 'sms', 'waitlist_table_ready',
       jsonb_build_object('offerExpiresAt', waitlist_row.offer_expires_at),
       'waitlist:' || waitlist_row.id::text || ':ready:sms'),
      (waitlist_row.organization_id, waitlist_row.location_id, waitlist_row.id,
       waitlist_row.guest_id, 'email', 'waitlist_table_ready',
       jsonb_build_object('offerExpiresAt', waitlist_row.offer_expires_at),
       'waitlist:' || waitlist_row.id::text || ':ready:email')
    on conflict (organization_id, dedupe_key) do nothing;
  end if;
  insert into public.audit_events (
    organization_id, location_id, actor_id, action, table_name,
    record_id, new_record, request_id
  ) values (
    waitlist_row.organization_id, waitlist_row.location_id, actor_id,
    'waitlist_status_changed', 'waitlist_entries', waitlist_row.id::text,
    jsonb_build_object('fromStatus', previous_status, 'toStatus', waitlist_row.status),
    p_request_id::text
  );
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object('id', waitlist_row.id, 'status', waitlist_row.status, 'replayed', false);
end
$$;

create function public.seat_waitlist_entry(
  p_request_id uuid,
  p_waitlist_entry_id uuid,
  p_table_ids uuid[],
  p_duration_minutes integer
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  waitlist_row public.waitlist_entries%rowtype;
  reservation_row public.reservations%rowtype;
  starts_at timestamptz := clock_timestamp();
  table_id uuid;
begin
  if actor_id is null or p_request_id is null or p_waitlist_entry_id is null
    or p_duration_minutes not between 15 and 720 then
    raise exception 'A valid waitlist seating request is required' using errcode = '22023';
  end if;
  select * into waitlist_row from public.waitlist_entries entry
  where entry.id = p_waitlist_entry_id;
  if waitlist_row.id is null then raise exception 'Waitlist entry not found' using errcode = 'P0002'; end if;
  if waitlist_row.status not in ('waiting', 'notified', 'accepted') then
    raise exception 'This waitlist entry can no longer be seated' using errcode = '23514';
  end if;
  if not public.has_capability(waitlist_row.organization_id, waitlist_row.location_id, 'reservations.operate') then
    raise exception 'Reservation operating access is required' using errcode = '42501';
  end if;
  perform private.lock_reservation_inventory(waitlist_row.location_id, starts_at);
  perform private.expire_public_booking_holds(
    waitlist_row.organization_id, waitlist_row.location_id,
    clock_timestamp(), 1000, starts_at
  );
  select * into waitlist_row from public.waitlist_entries entry
  where entry.id = p_waitlist_entry_id for update;
  if waitlist_row.id is null
    or waitlist_row.status not in ('waiting', 'notified', 'accepted') then
    raise exception 'This waitlist entry can no longer be seated'
      using errcode = '23514';
  end if;
  perform private.assert_reservation_tables_available(
    waitlist_row.organization_id, waitlist_row.location_id, p_request_id,
    p_table_ids, starts_at, starts_at + make_interval(mins => p_duration_minutes),
    waitlist_row.party_size
  );
  if not private.claim_operation_request(
    p_request_id, 'waitlist.seat', waitlist_row.organization_id,
    waitlist_row.location_id, p_request_id,
    jsonb_build_object('waitlistEntryId', waitlist_row.id, 'tableIds', p_table_ids, 'durationMinutes', p_duration_minutes)
  ) then
    select * into reservation_row from public.reservations reservation where reservation.id = p_request_id;
    return jsonb_build_object('id', reservation_row.id, 'status', reservation_row.status, 'replayed', true);
  end if;
  insert into public.reservations (
    id, organization_id, location_id, guest_id, reserved_at,
    duration_minutes, party_size, status, source, booking_channel,
    special_requests, seated_at, created_by
  ) values (
    p_request_id, waitlist_row.organization_id, waitlist_row.location_id,
    waitlist_row.guest_id, starts_at, p_duration_minutes,
    waitlist_row.party_size, 'seated', 'walk_in', 'walk_in',
    waitlist_row.notes, starts_at, actor_id
  ) returning * into reservation_row;
  foreach table_id in array p_table_ids loop
    insert into public.reservation_table_allocations (
      organization_id, location_id, reservation_id, table_id,
      allocation_kind, starts_at, ends_at, created_by
    ) values (
      waitlist_row.organization_id, waitlist_row.location_id,
      reservation_row.id, table_id, 'assignment', starts_at,
      starts_at + make_interval(mins => p_duration_minutes), actor_id
    );
    insert into public.table_status_events (
      organization_id, location_id, table_id, reservation_id,
      status, note, actor_id
    ) values (
      waitlist_row.organization_id, waitlist_row.location_id, table_id,
      reservation_row.id, 'occupied', 'Seated from waitlist', actor_id
    );
  end loop;
  update public.waitlist_entries entry set
    status = 'seated', resulting_reservation_id = reservation_row.id,
    seated_at = starts_at, updated_at = clock_timestamp()
  where entry.id = waitlist_row.id;
  insert into public.reservation_events (
    organization_id, location_id, reservation_id, event_type,
    to_status, actor_id, actor_kind, metadata
  ) values (
    reservation_row.organization_id, reservation_row.location_id,
    reservation_row.id, 'seated_from_waitlist', 'seated', actor_id,
    'staff', jsonb_build_object('waitlistEntryId', waitlist_row.id)
  );
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object('id', reservation_row.id, 'status', reservation_row.status, 'replayed', false);
end
$$;

revoke all on function public.save_waitlist_entry_v2(uuid, uuid, uuid, text, text, text, integer, timestamptz, timestamptz, integer, text)
from public, anon, authenticated;
revoke all on function public.transition_waitlist_entry(uuid, uuid, text, text)
from public, anon, authenticated;
revoke all on function public.seat_waitlist_entry(uuid, uuid, uuid[], integer)
from public, anon, authenticated;
grant execute on function public.save_waitlist_entry_v2(uuid, uuid, uuid, text, text, text, integer, timestamptz, timestamptz, integer, text) to authenticated;
grant execute on function public.transition_waitlist_entry(uuid, uuid, text, text) to authenticated;
grant execute on function public.seat_waitlist_entry(uuid, uuid, uuid[], integer) to authenticated;

create function public.set_reservation_table_status(
  p_request_id uuid,
  p_table_id uuid,
  p_status text,
  p_note text,
  p_reservation_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  table_row public.reservation_tables%rowtype;
  reservation_row public.reservations%rowtype;
begin
  if actor_id is null or p_request_id is null or p_table_id is null
    or p_status not in ('available', 'reserved_upcoming', 'occupied', 'needs_reset', 'blocked')
    or length(coalesce(p_note, '')) > 1000 then
    raise exception 'A valid table status is required' using errcode = '22023';
  end if;
  select * into table_row from public.reservation_tables table_item
  where table_item.id = p_table_id and table_item.is_active for update;
  if table_row.id is null then
    raise exception 'Reservation table not found' using errcode = 'P0002';
  end if;
  if not public.has_capability(
    table_row.organization_id, table_row.location_id, 'reservations.operate'
  ) then
    raise exception 'Reservation operating access is required' using errcode = '42501';
  end if;
  if p_reservation_id is not null then
    select * into reservation_row from public.reservations reservation
    where reservation.id = p_reservation_id
      and reservation.organization_id = table_row.organization_id
      and reservation.location_id = table_row.location_id;
    if reservation_row.id is null then
      raise exception 'Reservation not found for this table' using errcode = 'P0002';
    end if;
  end if;
  if not private.claim_operation_request(
    p_request_id, 'reservation.table_status', table_row.organization_id,
    table_row.location_id, table_row.id,
    jsonb_build_object(
      'status', p_status,
      'note', nullif(btrim(p_note), ''),
      'reservationId', p_reservation_id
    )
  ) then
    return jsonb_build_object(
      'id', table_row.id, 'status', p_status, 'replayed', true
    );
  end if;
  insert into public.table_status_events (
    organization_id, location_id, table_id, reservation_id,
    status, note, actor_id
  ) values (
    table_row.organization_id, table_row.location_id, table_row.id,
    p_reservation_id, p_status, nullif(btrim(p_note), ''), actor_id
  );
  insert into public.audit_events (
    organization_id, location_id, actor_id, action, table_name,
    record_id, new_record, request_id
  ) values (
    table_row.organization_id, table_row.location_id, actor_id,
    'reservation_table_status_changed', 'reservation_tables', table_row.id::text,
    jsonb_build_object(
      'status', p_status,
      'note', nullif(btrim(p_note), ''),
      'reservationId', p_reservation_id
    ),
    p_request_id::text
  );
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object(
    'id', table_row.id, 'status', p_status, 'replayed', false
  );
end
$$;

revoke all on function public.set_reservation_table_status(uuid, uuid, text, text, uuid)
from public, anon, authenticated;
grant execute on function public.set_reservation_table_status(uuid, uuid, text, text, uuid)
to authenticated;

create function public.save_reservation_with_guest(
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
  select guest.id into guest_uuid
  from public.guests guest
  where guest.organization_id = organization_uuid
    and guest.merged_into_id is null
    and (
      (clean_email is not null and lower(guest.email) = clean_email)
      or (
        clean_phone is not null
        and regexp_replace(coalesce(guest.phone, ''), '[^0-9+]', '', 'g') = clean_phone
      )
    )
  order by guest.updated_at desc
  limit 1;
  if guest_uuid is null then
    guest_uuid := p_request_id;
    insert into public.guests (
      id, organization_id, display_name, email, phone,
      source, external_references
    ) values (
      guest_uuid, organization_uuid, btrim(p_display_name), clean_email,
      clean_phone, 'manual', '{}'::jsonb
    )
    on conflict (id) do nothing;
  end if;
  result := public.save_reservation(
    p_request_id, p_location_id, null, guest_uuid, p_reserved_at,
    p_duration_minutes, p_party_size, p_special_requests,
    p_source, p_table_ids
  );
  return result || jsonb_build_object('guestId', guest_uuid);
end
$$;

revoke all on function public.save_reservation_with_guest(uuid, uuid, text, text, text, timestamptz, integer, integer, text, text, uuid[])
from public, anon, authenticated;
grant execute on function public.save_reservation_with_guest(uuid, uuid, text, text, text, timestamptz, integer, integer, text, text, uuid[])
to authenticated;

create function public.service_enqueue_reservation_reminders(
  p_now timestamptz
)
returns integer
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  inserted_count integer;
begin
  if p_now is null then
    raise exception 'A reminder clock is required' using errcode = '22023';
  end if;
  insert into public.reservation_message_outbox (
    organization_id, location_id, reservation_id, guest_id,
    channel, template_key, template_data, dedupe_key
  )
  select
    reservation.organization_id,
    reservation.location_id,
    reservation.id,
    reservation.guest_id,
    channel.value,
    case reminder.value
      when '24h' then 'reservation_reminder_24h'
      else 'reservation_reminder_2h'
    end,
    jsonb_build_object(
      'publicCode', reservation.public_code,
      'reservedAt', reservation.reserved_at,
      'reminder', reminder.value,
      'channel', case when reservation.booking_channel = 'web'
        then channel.value end
    ),
    'reservation:' || reservation.id::text || ':reminder:'
      || reminder.value || ':' || channel.value
  from public.reservations reservation
  join public.reservation_settings settings
    on settings.organization_id = reservation.organization_id
   and settings.location_id = reservation.location_id
   and settings.guest_messaging_enabled
   and settings.approved_at is not null
  join public.guests guest
    on guest.organization_id = reservation.organization_id
   and guest.id = reservation.guest_id
  cross join lateral (
    values
      ('24h'::text, reservation.reserved_at <= p_now + interval '24 hours'
        and reservation.reserved_at > p_now + interval '2 hours'),
      ('2h'::text, reservation.reserved_at <= p_now + interval '2 hours'
        and reservation.reserved_at > p_now)
  ) reminder(value, due)
  cross join lateral (
    select candidate.value
    from unnest(case
      when reservation.booking_channel = 'web' then array[(
        select verification.verified_channel
        from private.public_booking_holds hold
        join private.public_booking_verifications verification
          on verification.organization_id = hold.organization_id
         and verification.location_id = hold.location_id
         and verification.booking_hold_id = hold.id
        where hold.organization_id = reservation.organization_id
          and hold.location_id = reservation.location_id
          and hold.reservation_id = reservation.id
      )]::text[]
      else array['email', 'sms']::text[]
    end) candidate(value)
    where candidate.value is not null
      and candidate.value = any(settings.verification_channels)
  ) channel
  where reservation.status in ('booked', 'confirmed')
    and reminder.due
    and (
      (reminder.value = '24h' and 1440 = any(settings.reminder_schedule_minutes))
      or (reminder.value = '2h' and 120 = any(settings.reminder_schedule_minutes))
    )
    and (
      (channel.value = 'email' and guest.email is not null)
      or (channel.value = 'sms' and guest.phone is not null)
    )
  on conflict (organization_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end
$$;

revoke all on function public.service_enqueue_reservation_reminders(timestamptz)
from public, anon, authenticated;
grant execute on function public.service_enqueue_reservation_reminders(timestamptz)
to service_role;

-- Gate 0 queue leases, expiry workers, and tenant-scoped management commands.
drop function public.service_modify_public_reservation(uuid, text, timestamptz, integer, integer, text, uuid[]);

create function private.expire_waitlist_offers(
  p_organization_id uuid,
  p_location_id uuid,
  p_now timestamptz,
  p_limit integer
)
returns integer
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  waitlist_row public.waitlist_entries%rowtype;
  expired_count integer := 0;
begin
  if p_organization_id is null or p_location_id is null or p_now is null
    or p_limit not between 1 and 10000 then
    raise exception 'Valid waitlist expiry scope is required' using errcode = '22023';
  end if;
  for waitlist_row in
    select entry.*
    from public.waitlist_entries entry
    where entry.organization_id = p_organization_id
      and entry.location_id = p_location_id
      and entry.status = 'notified'
      and entry.offer_expires_at <= p_now
    order by entry.offer_expires_at, entry.id
    limit p_limit
    for update skip locked
  loop
    update public.waitlist_entries entry
    set status = 'expired', updated_at = p_now
    where entry.id = waitlist_row.id and entry.status = 'notified';
    if not found then
      continue;
    end if;
    update public.reservation_message_outbox message
    set status = 'cancelled', claim_token = null, claimed_by = null,
        claimed_at = null, lease_expires_at = null, updated_at = p_now
    where message.organization_id = p_organization_id
      and message.location_id = p_location_id
      and message.waitlist_entry_id = waitlist_row.id
      and message.template_key = 'waitlist_table_ready'
      and message.status in ('queued', 'failed', 'sending');
    insert into public.audit_events (
      organization_id, location_id, action, table_name, record_id,
      old_record, new_record, metadata
    ) values (
      p_organization_id, p_location_id, 'waitlist_offer_expired',
      'waitlist_entries', waitlist_row.id::text,
      jsonb_build_object('status', 'notified'),
      jsonb_build_object('status', 'expired'),
      jsonb_build_object('actorKind', 'system', 'expiredAt', p_now)
    );
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end
$$;

create function public.service_expire_reservation_deadlines(
  p_organization_id uuid,
  p_location_id uuid,
  p_now timestamptz,
  p_limit integer default 500
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  holds_expired integer;
  waitlist_expired integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_organization_id is null or p_location_id is null or p_now is null
    or p_limit not between 1 and 10000
    or not exists (
      select 1 from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
    ) then
    raise exception 'Valid reservation expiry scope is required' using errcode = '22023';
  end if;
  holds_expired := private.expire_public_booking_holds(
    p_organization_id, p_location_id, p_now, p_limit
  );
  waitlist_expired := private.expire_waitlist_offers(
    p_organization_id, p_location_id, p_now, p_limit
  );
  return jsonb_build_object(
    'holdsExpired', holds_expired,
    'waitlistExpired', waitlist_expired
  );
end
$$;

create function public.service_claim_reservation_message_outbox(
  p_worker_id uuid,
  p_limit integer,
  p_lease_seconds integer,
  p_now timestamptz
)
returns table (
  id uuid,
  "claimToken" uuid,
  "organizationId" uuid,
  "locationId" uuid,
  "reservationId" uuid,
  "bookingHoldId" uuid,
  "waitlistEntryId" uuid,
  "guestId" uuid,
  channel text,
  "templateKey" text,
  "templateData" jsonb,
  attempts integer,
  "createdAt" timestamptz,
  "guestName" text,
  "recipientEmail" text,
  "recipientPhone" text,
  "publicCode" text,
  "reservedAt" timestamptz,
  "offerExpiresAt" timestamptz,
  "holdExpiresAt" timestamptz
)
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_worker_id is null or p_limit not between 1 and 500
    or p_lease_seconds not between 5 and 3600 or p_now is null then
    raise exception 'A valid message claim is required' using errcode = '22023';
  end if;
  return query
  with candidates as (
    select message.id
    from public.reservation_message_outbox message
    where message.attempts < 20
      and (
        (message.status in ('queued', 'failed') and message.next_attempt_at <= p_now)
        or (message.status = 'sending' and message.lease_expires_at <= p_now)
      )
      and (
        message.template_key <> 'reservation_verify'
        or exists (
          select 1
          from private.public_booking_holds hold
          where hold.organization_id = message.organization_id
            and hold.location_id = message.location_id
            and hold.id = message.booking_hold_id
            and hold.status = 'pending'
            and hold.expires_at
              > p_now + make_interval(secs => p_lease_seconds)
        )
      )
      and (
        message.template_key <> 'waitlist_table_ready'
        or exists (
          select 1
          from public.waitlist_entries waitlist
          where waitlist.organization_id = message.organization_id
            and waitlist.location_id = message.location_id
            and waitlist.id = message.waitlist_entry_id
            and waitlist.status = 'notified'
            and waitlist.offer_expires_at
              > p_now + make_interval(secs => p_lease_seconds)
        )
      )
      and (
        message.template_key not in (
          'reservation_reminder_24h', 'reservation_reminder_2h'
        )
        or exists (
          select 1
          from public.reservations reservation
          where reservation.organization_id = message.organization_id
            and reservation.location_id = message.location_id
            and reservation.id = message.reservation_id
            and reservation.status in ('booked', 'confirmed')
            and reservation.reserved_at > p_now
        )
      )
      and (
        message.template_key <> 'reservation_confirmed'
        or exists (
          select 1
          from public.reservations reservation
          where reservation.organization_id = message.organization_id
            and reservation.location_id = message.location_id
            and reservation.id = message.reservation_id
            and reservation.status in ('booked', 'confirmed')
            and reservation.duration_minutes is not null
            and reservation.reserved_at
              + make_interval(mins => reservation.duration_minutes)
              + interval '24 hours'
              > p_now + make_interval(secs => p_lease_seconds)
        )
      )
    order by
      case when message.status = 'sending' then 0 else 1 end,
      coalesce(message.lease_expires_at, message.next_attempt_at),
      message.created_at, message.id
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.reservation_message_outbox message
    set status = 'sending', claim_token = gen_random_uuid(),
        claimed_by = p_worker_id, claimed_at = p_now,
        lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        attempts = message.attempts + 1, updated_at = p_now
    from candidates
    where message.id = candidates.id
    returning message.*
  )
  select claimed.id, claimed.claim_token, claimed.organization_id,
    claimed.location_id, claimed.reservation_id, claimed.booking_hold_id,
    claimed.waitlist_entry_id, claimed.guest_id, claimed.channel,
    claimed.template_key, claimed.template_data, claimed.attempts,
    claimed.created_at,
    case
      when claimed.booking_hold_id is not null
        then hold.first_name || ' ' || hold.last_name
      when claimed.waitlist_entry_id is not null then waitlist.display_name
      else guest.display_name
    end,
    case
      when claimed.template_key = 'reservation_verify' then hold.email
      when claimed.waitlist_entry_id is not null then waitlist.email
      else guest.email
    end,
    case
      when claimed.template_key = 'reservation_verify' then hold.phone
      when claimed.waitlist_entry_id is not null then waitlist.phone
      else guest.phone
    end,
    coalesce(reservation.public_code, hold.public_code),
    coalesce(reservation.reserved_at, hold.reserved_at),
    waitlist.offer_expires_at,
    hold.expires_at
  from claimed
  left join private.public_booking_holds hold
    on hold.organization_id = claimed.organization_id
   and hold.location_id = claimed.location_id
   and hold.id = claimed.booking_hold_id
  left join public.reservations reservation
    on reservation.organization_id = claimed.organization_id
   and reservation.location_id = claimed.location_id
   and reservation.id = claimed.reservation_id
  left join public.guests guest
    on guest.organization_id = claimed.organization_id
   and guest.id = claimed.guest_id
  left join public.waitlist_entries waitlist
    on waitlist.organization_id = claimed.organization_id
   and waitlist.location_id = claimed.location_id
   and waitlist.id = claimed.waitlist_entry_id
  order by claimed.created_at, claimed.id;
end
$$;

create function public.service_complete_reservation_message_outbox(
  p_id uuid,
  p_claim_token uuid,
  p_status text,
  p_error_code text default null,
  p_next_attempt_at timestamptz default null,
  p_provider_message_id text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  message_row public.reservation_message_outbox%rowtype;
  completed_at timestamptz := clock_timestamp();
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_id is null or p_claim_token is null
    or p_status not in ('sent', 'failed', 'cancelled')
    or length(coalesce(p_error_code, '')) > 240
    or length(coalesce(p_provider_message_id, '')) > 500
    or (p_status = 'failed' and (p_next_attempt_at is null or p_next_attempt_at <= completed_at))
    or (p_status <> 'failed' and p_next_attempt_at is not null) then
    raise exception 'A valid message completion is required' using errcode = '22023';
  end if;
  select * into message_row
  from public.reservation_message_outbox message
  where message.id = p_id for update;
  if message_row.id is null or message_row.status <> 'sending'
    or message_row.claim_token <> p_claim_token
    or message_row.lease_expires_at <= completed_at then
    raise exception 'The message claim is unavailable' using errcode = 'P0002';
  end if;
  update public.reservation_message_outbox message
  set status = p_status,
      provider_message_id = coalesce(p_provider_message_id, message.provider_message_id),
      last_error_code = case when p_status = 'failed' then p_error_code else null end,
      next_attempt_at = case when p_status = 'failed' then p_next_attempt_at else message.next_attempt_at end,
      sent_at = case when p_status = 'sent' then completed_at else message.sent_at end,
      claim_token = null, claimed_by = null, claimed_at = null,
      lease_expires_at = null, updated_at = completed_at
  where message.id = p_id
  returning * into message_row;
  return jsonb_build_object(
    'id', message_row.id, 'status', message_row.status,
    'attempts', message_row.attempts,
    'nextAttemptAt', case when message_row.status = 'failed'
      then message_row.next_attempt_at else null end
  );
end
$$;

create function public.service_modify_public_reservation(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_manage_token_hash text,
  p_reserved_at timestamptz,
  p_duration_minutes integer,
  p_party_size integer,
  p_special_requests text,
  p_table_ids uuid[]
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  token_row private.public_booking_tokens%rowtype;
  reservation_row public.reservations%rowtype;
  settings_row public.reservation_settings%rowtype;
  prior_request private.public_booking_requests%rowtype;
  payload_hash text;
  old_reserved_at timestamptz;
  old_status text;
  table_id uuid;
  message_channel text;
  message_channels text[] := '{}'::text[];
  verified_message_channel text;
  refreshed_manage_expires_at timestamptz;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_organization_id is null or p_location_id is null
    or p_manage_token_hash !~ '^[0-9a-f]{64}$' or p_reserved_at is null
    or p_duration_minutes not between 15 and 720
    or p_party_size not between 1 and 100
    or p_table_ids is null or cardinality(p_table_ids) not between 1 and 8
    or length(coalesce(p_special_requests, '')) > 5000 then
    raise exception 'A valid modification request is required' using errcode = '22023';
  end if;

  -- Resolve without locks, acquire all inventory locks in canonical local-date
  -- order, then lock and revalidate the token/reservation rows.
  select * into token_row from private.public_booking_tokens token
  where token.organization_id = p_organization_id
    and token.location_id = p_location_id
    and token.token_hash = p_manage_token_hash
    and token.token_kind = 'manage';
  if token_row.id is null then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  select * into reservation_row from public.reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.location_id = p_location_id
    and reservation.id = token_row.reservation_id;
  if reservation_row.id is null then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  old_reserved_at := reservation_row.reserved_at;
  perform private.lock_reservation_inventory_many(
    p_location_id, array[old_reserved_at, p_reserved_at]::timestamptz[]
  );
  perform private.expire_public_booking_holds(
    p_organization_id, p_location_id, clock_timestamp(), 1000,
    old_reserved_at
  );
  perform private.expire_public_booking_holds(
    p_organization_id, p_location_id, clock_timestamp(), 1000,
    p_reserved_at
  );
  select * into settings_row from public.reservation_settings setting
  where setting.organization_id = p_organization_id
    and setting.location_id = p_location_id
  for update;
  if settings_row.id is null or not settings_row.online_booking_enabled
    or settings_row.approved_at is null
    or settings_row.minimum_lead_minutes is null
    or settings_row.booking_horizon_days is null
    or settings_row.max_online_party_size is null
    or p_party_size > settings_row.max_online_party_size
    or p_reserved_at < clock_timestamp()
      + make_interval(mins => settings_row.minimum_lead_minutes)
    or p_reserved_at > clock_timestamp()
      + make_interval(days => settings_row.booking_horizon_days) then
    raise exception 'Online modification is closed for this reservation'
      using errcode = '23514';
  end if;
  select * into token_row from private.public_booking_tokens token
  where token.id = token_row.id for update;
  select * into reservation_row from public.reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.location_id = p_location_id
    and reservation.id = token_row.reservation_id for update;
  if token_row.revoked_at is not null or token_row.expires_at <= clock_timestamp()
    or reservation_row.id is null then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  if reservation_row.reserved_at <> old_reserved_at then
    raise exception 'Reservation changed concurrently; retry the request'
      using errcode = '40001';
  end if;
  if reservation_row.status not in ('booked', 'confirmed') then
    raise exception 'This reservation can no longer be modified' using errcode = '23514';
  end if;
  if settings_row.modification_cutoff_minutes is null
    or reservation_row.reserved_at
      - make_interval(mins => settings_row.modification_cutoff_minutes) <= clock_timestamp()
  then
    raise exception 'Online modification is closed for this reservation' using errcode = '23514';
  end if;
  if reservation_row.booking_channel = 'web' then
    select verification.verified_channel into verified_message_channel
    from private.public_booking_holds hold
    join private.public_booking_verifications verification
      on verification.organization_id = hold.organization_id
     and verification.location_id = hold.location_id
     and verification.booking_hold_id = hold.id
    where hold.organization_id = p_organization_id
      and hold.location_id = p_location_id
      and hold.reservation_id = reservation_row.id;
    if verified_message_channel is null then
      raise exception 'Verified public reservation evidence is unavailable'
        using errcode = 'P0002';
    end if;
  end if;
  if settings_row.guest_messaging_enabled then
    message_channels := case
      when reservation_row.booking_channel = 'web'
        and verified_message_channel = any(settings_row.verification_channels)
        then array[verified_message_channel]::text[]
      when reservation_row.booking_channel <> 'web'
        then settings_row.verification_channels
      else '{}'::text[]
    end;
  end if;
  payload_hash := encode(extensions.digest(jsonb_build_object(
    'organizationId', p_organization_id, 'locationId', p_location_id,
    'reservationId', reservation_row.id, 'reservedAt', p_reserved_at,
    'durationMinutes', p_duration_minutes, 'partySize', p_party_size,
    'specialRequests', nullif(btrim(p_special_requests), ''), 'tableIds', p_table_ids
  )::text, 'sha256'), 'hex');
  select * into prior_request from private.public_booking_requests request
  where request.request_id = p_request_id for update;
  if prior_request.request_id is not null then
    if prior_request.organization_id = p_organization_id
      and prior_request.location_id = p_location_id
      and prior_request.reservation_id = reservation_row.id
      and prior_request.operation_kind = 'public.reservation.modify'
      and prior_request.payload_hash = payload_hash
      and prior_request.completed_at is not null then
      return jsonb_build_object(
        'reservationId', reservation_row.id, 'publicCode', reservation_row.public_code,
        'status', reservation_row.status,
        'manageExpiresAt', token_row.expires_at, 'replayed', true
      );
    end if;
    raise exception 'Idempotency key was reused' using errcode = '23505';
  end if;
  insert into private.public_booking_requests (
    request_id, organization_id, location_id, reservation_id,
    operation_kind, payload_hash
  ) values (
    p_request_id, p_organization_id, p_location_id, reservation_row.id,
    'public.reservation.modify', payload_hash
  );
  perform private.assert_reservation_tables_available(
    p_organization_id, p_location_id, reservation_row.id, p_table_ids,
    p_reserved_at, p_reserved_at + make_interval(mins => p_duration_minutes),
    p_party_size
  );
  update public.reservation_table_allocations allocation
  set is_active = false, released_at = clock_timestamp(), updated_at = clock_timestamp()
  where allocation.organization_id = p_organization_id
    and allocation.location_id = p_location_id
    and allocation.reservation_id = reservation_row.id and allocation.is_active;
  foreach table_id in array p_table_ids loop
    insert into public.reservation_table_allocations (
      organization_id, location_id, reservation_id, table_id,
      allocation_kind, starts_at, ends_at
    ) values (
      p_organization_id, p_location_id, reservation_row.id, table_id,
      'assignment', p_reserved_at,
      p_reserved_at + make_interval(mins => p_duration_minutes)
    );
  end loop;
  old_status := reservation_row.status;
  update public.reservations reservation
  set reserved_at = p_reserved_at, duration_minutes = p_duration_minutes,
      party_size = p_party_size,
      special_requests = nullif(btrim(p_special_requests), ''),
      status = 'booked', version = reservation.version + 1,
      updated_at = clock_timestamp()
  where reservation.organization_id = p_organization_id
    and reservation.location_id = p_location_id
    and reservation.id = reservation_row.id returning * into reservation_row;
  refreshed_manage_expires_at := reservation_row.reserved_at
    + make_interval(mins => reservation_row.duration_minutes) + interval '24 hours';
  update private.public_booking_tokens token
  set expires_at = refreshed_manage_expires_at
  where token.organization_id = p_organization_id
    and token.location_id = p_location_id
    and token.reservation_id = reservation_row.id
    and token.token_kind = 'manage' and token.revoked_at is null;
  update private.public_booking_management_exchanges exchange
  set manage_expires_at = refreshed_manage_expires_at
  where exchange.organization_id = p_organization_id
    and exchange.location_id = p_location_id
    and exchange.reservation_id = reservation_row.id
    and exists (
      select 1
      from private.public_booking_tokens token
      where token.organization_id = p_organization_id
        and token.location_id = p_location_id
        and token.reservation_id = reservation_row.id
        and token.token_kind = 'manage'
        and token.revoked_at is null
        and token.token_hash = exchange.manage_token_hash
        and token.expires_at = refreshed_manage_expires_at
    );
  insert into public.reservation_events (
    organization_id, location_id, reservation_id, event_type,
    from_status, to_status, actor_kind, metadata
  ) values (
    p_organization_id, p_location_id, reservation_row.id,
    'guest_modified', old_status, reservation_row.status, 'guest',
    jsonb_build_object('previousReservedAt', old_reserved_at)
  );
  if cardinality(message_channels) > 0 then
    foreach message_channel in array message_channels loop
      insert into public.reservation_message_outbox (
        organization_id, location_id, reservation_id, guest_id, channel,
        template_key, template_data, dedupe_key
      ) values (
        p_organization_id, p_location_id, reservation_row.id,
        reservation_row.guest_id, message_channel, 'reservation_modified',
        jsonb_build_object(
          'publicCode', reservation_row.public_code,
          'channel', case when reservation_row.booking_channel = 'web'
            then verified_message_channel end
        ),
        'reservation:' || reservation_row.id::text || ':modified:'
          || reservation_row.version::text || ':' || message_channel
      ) on conflict (organization_id, dedupe_key) do nothing;
    end loop;
  end if;
  update private.public_booking_requests request
  set completed_at = clock_timestamp() where request.request_id = p_request_id;
  return jsonb_build_object(
    'reservationId', reservation_row.id, 'publicCode', reservation_row.public_code,
    'status', reservation_row.status, 'reservedAt', reservation_row.reserved_at,
    'manageExpiresAt', refreshed_manage_expires_at, 'replayed', false
  );
end
$$;

revoke all on function private.expire_waitlist_offers(uuid, uuid, timestamptz, integer)
from public, anon, authenticated, service_role;
revoke all on function public.service_expire_reservation_deadlines(uuid, uuid, timestamptz, integer)
from public, anon, authenticated;
revoke all on function public.service_claim_reservation_message_outbox(uuid, integer, integer, timestamptz)
from public, anon, authenticated;
revoke all on function public.service_complete_reservation_message_outbox(uuid, uuid, text, text, timestamptz, text)
from public, anon, authenticated;
revoke all on function public.service_modify_public_reservation(uuid, uuid, uuid, text, timestamptz, integer, integer, text, uuid[])
from public, anon, authenticated;
grant execute on function public.service_expire_reservation_deadlines(uuid, uuid, timestamptz, integer) to service_role;
grant execute on function public.service_claim_reservation_message_outbox(uuid, integer, integer, timestamptz) to service_role;
grant execute on function public.service_complete_reservation_message_outbox(uuid, uuid, text, text, timestamptz, text) to service_role;
grant execute on function public.service_modify_public_reservation(uuid, uuid, uuid, text, timestamptz, integer, integer, text, uuid[]) to service_role;

create function public.service_reservation_pacing_snapshot(
  p_organization_id uuid,
  p_location_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  "startsAt" timestamptz,
  "partySize" integer,
  kind text
)
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_organization_id is null or p_location_id is null
    or p_from is null or p_to is null or p_to <= p_from
    or p_to > p_from + interval '62 days'
    or not exists (
      select 1 from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id and location.is_active
    ) then
    raise exception 'A valid pacing snapshot scope is required' using errcode = '22023';
  end if;
  return query
  select snapshot.starts_at, snapshot.party_size, snapshot.kind
  from (
    select reservation.reserved_at starts_at, reservation.party_size,
      'reservation'::text kind, reservation.id subject_id
    from public.reservations reservation
    where reservation.organization_id = p_organization_id
      and reservation.location_id = p_location_id
      and reservation.reserved_at >= p_from and reservation.reserved_at < p_to
      and reservation.status not in ('cancelled', 'no_show', 'completed')
    union all
    select hold.reserved_at, hold.party_size, 'hold'::text, hold.id
    from private.public_booking_holds hold
    where hold.organization_id = p_organization_id
      and hold.location_id = p_location_id
      and hold.reserved_at >= p_from and hold.reserved_at < p_to
      and hold.status = 'pending' and hold.expires_at > clock_timestamp()
  ) snapshot
  order by snapshot.starts_at, snapshot.kind, snapshot.subject_id;
end
$$;

revoke all on function public.service_reservation_pacing_snapshot(uuid, uuid, timestamptz, timestamptz)
from public, anon, authenticated;
grant execute on function public.service_reservation_pacing_snapshot(uuid, uuid, timestamptz, timestamptz)
to service_role;
