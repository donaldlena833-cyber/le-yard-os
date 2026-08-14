-- Immutable staff reservation lifecycle evidence and authoritative edit/cancel
-- commands. Public booking remains independently gated.

alter table public.reservations
add constraint reservations_organization_location_id_key
unique (organization_id, location_id, id);

alter table private.operation_requests
add constraint operation_requests_lifecycle_evidence_key
unique (
  request_id,
  organization_id,
  location_id,
  record_id,
  actor_id,
  payload_hash
);

create table public.reservation_revisions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  reservation_id uuid not null,
  request_id uuid not null unique,
  actor_id uuid not null references auth.users(id) on delete restrict,
  version integer not null check (version > 0),
  mutation_kind text not null
    check (mutation_kind in ('staff_modified', 'staff_cancelled')),
  reason text not null check (length(btrim(reason)) between 4 and 1000),
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  before_state jsonb not null check (jsonb_typeof(before_state) = 'object'),
  after_state jsonb not null check (jsonb_typeof(after_state) = 'object'),
  service_shift_id uuid,
  service_shift_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(service_shift_evidence) = 'object'),
  policy_hash text check (policy_hash is null or policy_hash ~ '^[0-9a-f]{64}$'),
  policy_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(policy_evidence) = 'object'),
  allocation_evidence jsonb not null default '{}'::jsonb
    check (jsonb_typeof(allocation_evidence) = 'object'),
  result_evidence jsonb not null check (jsonb_typeof(result_evidence) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, location_id, reservation_id)
    references public.reservations(organization_id, location_id, id)
    on delete cascade,
  foreign key (organization_id, location_id, service_shift_id)
    references public.service_shifts(organization_id, location_id, id)
    on delete restrict,
  foreign key (
    request_id,
    organization_id,
    location_id,
    reservation_id,
    actor_id,
    payload_hash
  ) references private.operation_requests (
    request_id,
    organization_id,
    location_id,
    record_id,
    actor_id,
    payload_hash
  ) on delete restrict,
  unique (organization_id, reservation_id, version),
  unique (organization_id, location_id, id)
);

create index reservation_revisions_reservation_time_idx
on public.reservation_revisions (reservation_id, created_at desc, id desc);

alter table public.reservation_revisions enable row level security;
alter table public.reservation_revisions force row level security;
revoke all on table public.reservation_revisions
from public, anon, authenticated, service_role;
grant select on table public.reservation_revisions to service_role;

create function private.guard_reservation_revision_immutability()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  raise exception 'Reservation revisions are immutable' using errcode = '55000';
end
$$;

create trigger reservation_revisions_immutable
before update or delete on public.reservation_revisions
for each row execute function private.guard_reservation_revision_immutability();

revoke all on function private.guard_reservation_revision_immutability()
from public, anon, authenticated, service_role;

-- Channel type alone is not destination proof. Bind every new public
-- verification to the exact normalized address/number using the random
-- confirmation fingerprint as a per-verification salt. The raw destination
-- remains in the provisional hold only until the existing lifecycle redacts it.
alter table private.public_booking_verifications
add column verified_destination_hash text;

alter table private.public_booking_verifications
add constraint public_booking_verifications_destination_hash_check
check (
  verified_destination_hash is null
  or verified_destination_hash ~ '^[0-9a-f]{64}$'
);

create function private.capture_public_booking_verified_destination()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  normalized_destination text;
begin
  select case new.verified_channel
    when 'email' then lower(btrim(hold.email))
    when 'sms' then regexp_replace(coalesce(hold.phone, ''), '[^0-9]', '', 'g')
    else null
  end
  into normalized_destination
  from private.public_booking_holds hold
  where hold.organization_id = new.organization_id
    and hold.location_id = new.location_id
    and hold.id = new.booking_hold_id;
  if normalized_destination is null or normalized_destination = '' then
    raise exception 'Verified booking destination evidence is unavailable'
      using errcode = '23514';
  end if;
  new.verified_destination_hash := encode(
    extensions.digest(
      'reservation-verified-destination:v1' || chr(31)
        || new.confirmation_fingerprint || chr(31)
        || normalized_destination,
      'sha256'
    ),
    'hex'
  );
  return new;
end
$$;

create trigger public_booking_verification_destination_capture
before insert or update of booking_hold_id, verified_channel,
  confirmation_fingerprint
on private.public_booking_verifications
for each row execute function private.capture_public_booking_verified_destination();

update private.public_booking_verifications verification
set verified_destination_hash = encode(
  extensions.digest(
    'reservation-verified-destination:v1' || chr(31)
      || verification.confirmation_fingerprint || chr(31)
      || case verification.verified_channel
        when 'email' then lower(btrim(hold.email))
        else regexp_replace(coalesce(hold.phone, ''), '[^0-9]', '', 'g')
      end,
    'sha256'
  ),
  'hex'
)
from private.public_booking_holds hold
where hold.organization_id = verification.organization_id
  and hold.location_id = verification.location_id
  and hold.id = verification.booking_hold_id
  and case verification.verified_channel
    when 'email' then nullif(lower(btrim(hold.email)), '')
    else nullif(regexp_replace(coalesce(hold.phone, ''), '[^0-9]', '', 'g'), '')
  end is not null
  and verification.verified_destination_hash is null;

revoke all on function private.capture_public_booking_verified_destination()
from public, anon, authenticated, service_role;

-- Staff operations consume scheduled materialized service shifts even while
-- public inventory is disabled. The returned object is stored only in the
-- service-role audit row; browser DTOs receive a boolean that evidence exists.
create function private.assert_staff_reservation_policy(
  p_organization_id uuid,
  p_location_id uuid,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_party_size integer,
  p_exclude_reservation_id uuid
)
returns jsonb
language plpgsql volatile security definer
set search_path = ''
set row_security = off
as $$
declare
  calendar_date date;
  location_timezone text;
  service_shift public.service_shifts%rowtype;
  policy record;
  authoritative_duration integer;
  existing_covers integer;
  exception_ids uuid[] := '{}'::uuid[];
  shift_evidence jsonb;
  policy_evidence jsonb;
  policy_hash text;
begin
  select (p_starts_at at time zone location.timezone)::date, location.timezone
  into calendar_date, location_timezone
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id
    and location.is_active;

  if calendar_date is null
    or p_duration_minutes not between 15 and 720
    or p_party_size not between 1 and 100 then
    raise exception 'A valid staff reservation policy request is required'
      using errcode = '22023';
  end if;
  if not private.local_wall_timestamp_is_unambiguous(
    p_starts_at at time zone location_timezone,
    location_timezone
  ) then
    raise exception 'Ambiguous reservation wall times are unavailable'
      using errcode = '23514';
  end if;

  perform private.ensure_service_shifts(
    p_organization_id,
    p_location_id,
    array[calendar_date - 1, calendar_date]
  );
  select shift.*
  into service_shift
  from public.service_shifts shift
  where shift.organization_id = p_organization_id
    and shift.location_id = p_location_id
    and shift.status = 'scheduled'
    and p_starts_at >= shift.starts_at
    and p_starts_at < shift.ends_at
  order by shift.starts_at desc, shift.id
  limit 1
  for update;

  if service_shift.id is null then
    raise exception 'No scheduled service is configured for the requested time'
      using errcode = '23514';
  end if;
  if p_party_size not between service_shift.min_party_size
      and service_shift.max_party_size then
    raise exception 'That party size is unavailable for this service'
      using errcode = '23514';
  end if;

  select *
  into policy
  from private.service_shift_effective_policy(
    service_shift.id,
    p_starts_at,
    p_starts_at + make_interval(mins => p_duration_minutes)
  );
  select coalesce(rule.duration_minutes, service_shift.default_duration_minutes)
  into authoritative_duration
  from (select true) seed
  left join lateral (
    select turn.duration_minutes
    from public.reservation_turn_rules turn
    where turn.organization_id = p_organization_id
      and turn.service_period_id = service_shift.service_period_id
      and p_party_size between turn.min_party_size and turn.max_party_size
    order by turn.min_party_size, turn.max_party_size, turn.id
    limit 1
  ) rule on true;

  if policy.is_closed then
    raise exception 'The requested service interval is closed'
      using errcode = '23514';
  end if;
  if p_duration_minutes <> authoritative_duration then
    raise exception 'The duration no longer matches the active turn policy'
      using errcode = '23514';
  end if;
  if p_starts_at < service_shift.starts_at
      + make_interval(mins => policy.opening_buffer_minutes)
    or p_starts_at + make_interval(mins => p_duration_minutes)
      > service_shift.ends_at
        - make_interval(mins => policy.closing_buffer_minutes) then
    raise exception 'The reservation falls outside the active service buffers'
      using errcode = '23514';
  end if;

  select coalesce(sum(covers.party_size), 0)::integer
  into existing_covers
  from (
    select reservation.party_size
    from public.reservations reservation
    where reservation.organization_id = p_organization_id
      and reservation.location_id = p_location_id
      and reservation.id is distinct from p_exclude_reservation_id
      and reservation.status not in ('cancelled', 'no_show', 'completed')
      and reservation.reserved_at >= p_starts_at
        - make_interval(mins => policy.pacing_interval_minutes)
      and reservation.reserved_at < p_starts_at
        + make_interval(mins => policy.pacing_interval_minutes)
    union all
    select hold.party_size
    from private.public_booking_holds hold
    where hold.organization_id = p_organization_id
      and hold.location_id = p_location_id
      and hold.status = 'pending'
      and hold.expires_at > clock_timestamp()
      and hold.reserved_at >= p_starts_at
        - make_interval(mins => policy.pacing_interval_minutes)
      and hold.reserved_at < p_starts_at
        + make_interval(mins => policy.pacing_interval_minutes)
  ) covers;
  if existing_covers + p_party_size > policy.pacing_cover_limit then
    raise exception 'The requested time has reached its pacing limit'
      using errcode = '23P01';
  end if;

  select coalesce(array_agg(exception.id order by exception.id), '{}'::uuid[])
  into exception_ids
  from public.service_shift_exceptions exception
  where exception.organization_id = p_organization_id
    and exception.location_id = p_location_id
    and exception.service_shift_id = service_shift.id
    and exception.status = 'active'
    and (
      exception.exception_kind = 'buffer_override'
      or exception.effective_range && tstzrange(
        p_starts_at,
        p_starts_at + make_interval(mins => p_duration_minutes),
        '[)'
      )
    );

  shift_evidence := jsonb_build_object(
    'id', service_shift.id,
    'businessDate', service_shift.business_date,
    'servicePeriodId', service_shift.service_period_id,
    'name', service_shift.name,
    'startsAt', service_shift.starts_at,
    'endsAt', service_shift.ends_at,
    'configurationState', service_shift.configuration_state,
    'sourceUpdatedAt', service_shift.source_updated_at
  );
  policy_evidence := jsonb_build_object(
    'durationMinutes', authoritative_duration,
    'minPartySize', service_shift.min_party_size,
    'maxPartySize', service_shift.max_party_size,
    'pacingIntervalMinutes', policy.pacing_interval_minutes,
    'pacingCoverLimit', policy.pacing_cover_limit,
    'openingBufferMinutes', policy.opening_buffer_minutes,
    'closingBufferMinutes', policy.closing_buffer_minutes,
    'exceptionIds', exception_ids
  );
  policy_hash := encode(
    extensions.digest(
      jsonb_build_object(
        'serviceShift', shift_evidence,
        'policy', policy_evidence
      )::text,
      'sha256'
    ),
    'hex'
  );
  return jsonb_build_object(
    'serviceShiftId', service_shift.id,
    'serviceShiftEvidence', shift_evidence,
    'policyEvidence', policy_evidence,
    'policyHash', policy_hash
  );
end
$$;

revoke all on function private.assert_staff_reservation_policy(
  uuid, uuid, timestamptz, integer, integer, uuid
) from public, anon, authenticated, service_role;

-- The Host projection remains fixed and provider-free. Revision reason, actor,
-- hashes, and raw policy evidence stay behind the service-role audit boundary.
drop function public.service_reservation_host_snapshot(
  uuid, uuid, timestamptz, timestamptz
);

create function public.service_reservation_host_snapshot(
  p_organization_id uuid,
  p_location_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  id uuid,
  guest_id uuid,
  version integer,
  reserved_at timestamptz,
  duration_minutes integer,
  party_size integer,
  status text,
  table_label text,
  special_requests text,
  source text,
  booking_channel text,
  policy_evidence_captured boolean,
  last_revision jsonb
)
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
begin
  if auth.uid() is null then
    raise exception 'Reservation access is required' using errcode = '42501';
  end if;
  if p_organization_id is null
    or p_location_id is null
    or p_from is null
    or p_to is null
    or p_to <= p_from
    or p_to > p_from + interval '30 hours'
    or not exists (
      select 1
      from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
        and location.is_active
    ) then
    raise exception 'A valid reservation snapshot scope is required'
      using errcode = '22023';
  end if;
  if not public.has_any_capability(
    p_organization_id,
    p_location_id,
    array[
      'reservations.view',
      'reservations.operate',
      'reservations.override',
      'reservations.configure'
    ]::text[],
    null
  ) then
    raise exception 'Reservation access is required' using errcode = '42501';
  end if;

  return query
  select
    reservation.id,
    reservation.guest_id,
    reservation.version,
    reservation.reserved_at,
    reservation.duration_minutes,
    reservation.party_size,
    reservation.status,
    reservation.table_label,
    reservation.special_requests,
    reservation.source,
    reservation.booking_channel,
    revision.policy_hash is not null,
    case when revision.id is null then null else jsonb_build_object(
      'id', revision.id,
      'kind', revision.mutation_kind,
      'version', revision.version,
      'changedAt', revision.created_at,
      'previousReservedAt', revision.before_state ->> 'reservedAt',
      'previousPartySize', (revision.before_state ->> 'partySize')::integer
    ) end
  from public.reservations reservation
  left join lateral (
    select candidate.*
    from public.reservation_revisions candidate
    where candidate.organization_id = reservation.organization_id
      and candidate.location_id = reservation.location_id
      and candidate.reservation_id = reservation.id
    order by candidate.version desc, candidate.created_at desc, candidate.id
    limit 1
  ) revision on true
  where reservation.organization_id = p_organization_id
    and reservation.location_id = p_location_id
    and reservation.reserved_at >= p_from
    and reservation.reserved_at < p_to
  order by reservation.reserved_at, reservation.id;
end
$$;

revoke all on function public.service_reservation_host_snapshot(
  uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.service_reservation_host_snapshot(
  uuid, uuid, timestamptz, timestamptz
) to authenticated;

-- A stale dialog may outlive the date-window snapshot when another writer
-- moves the reservation. This exact, capability-scoped head lets the client
-- review the current commitment without exposing guest or provider payloads.
create function public.service_reservation_lifecycle_head(
  p_location_id uuid,
  p_reservation_id uuid
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  organization_uuid uuid;
  location_date date;
  result jsonb;
begin
  if actor_id is null or p_location_id is null or p_reservation_id is null then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  select reservation.organization_id,
    (clock_timestamp() at time zone location.timezone)::date
  into organization_uuid, location_date
  from public.reservations reservation
  join public.locations location
    on location.organization_id = reservation.organization_id
   and location.id = reservation.location_id
   and location.is_active
  where reservation.id = p_reservation_id
    and reservation.location_id = p_location_id;
  if organization_uuid is null or not public.has_capability(
    organization_uuid,
    p_location_id,
    'reservations.operate',
    location_date
  ) then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;

  select jsonb_build_object(
    'id', reservation.id,
    'version', reservation.version,
    'reservedAt', reservation.reserved_at,
    'durationMinutes', reservation.duration_minutes,
    'partySize', reservation.party_size,
    'status', reservation.status,
    'tableIds', coalesce(allocation.table_ids, '{}'::uuid[]),
    'specialRequests', reservation.special_requests,
    'source', reservation.source,
    'bookingChannel', reservation.booking_channel,
    'policyEvidenceCaptured', revision.policy_hash is not null,
    'lastRevision', case when revision.id is null then null
      else jsonb_build_object(
        'id', revision.id,
        'kind', revision.mutation_kind,
        'version', revision.version,
        'changedAt', revision.created_at,
        'previousReservedAt', revision.before_state ->> 'reservedAt',
        'previousPartySize',
          (revision.before_state ->> 'partySize')::integer
      )
    end
  )
  into result
  from public.reservations reservation
  left join lateral (
    select coalesce(
      array_agg(candidate.table_id order by candidate.table_id),
      '{}'::uuid[]
    ) table_ids
    from public.reservation_table_allocations candidate
    where candidate.organization_id = reservation.organization_id
      and candidate.location_id = reservation.location_id
      and candidate.reservation_id = reservation.id
      and candidate.is_active
      and candidate.allocation_kind = 'assignment'
  ) allocation on true
  left join lateral (
    select candidate.*
    from public.reservation_revisions candidate
    where candidate.organization_id = reservation.organization_id
      and candidate.location_id = reservation.location_id
      and candidate.reservation_id = reservation.id
    order by candidate.version desc, candidate.created_at desc, candidate.id
    limit 1
  ) revision on true
  where reservation.organization_id = organization_uuid
    and reservation.location_id = p_location_id
    and reservation.id = p_reservation_id;
  if result is null then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  return result;
end
$$;

revoke all on function public.service_reservation_lifecycle_head(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.service_reservation_lifecycle_head(uuid, uuid)
to authenticated;

-- Managed reads carry the authoritative token deadline so the same-origin BFF
-- can refresh an already-established HttpOnly session after a staff move.
create or replace function public.service_get_managed_reservation(
  p_organization_id uuid,
  p_location_id uuid,
  p_manage_token_hash text
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  token_row private.public_booking_tokens%rowtype;
  reservation_row public.reservations%rowtype;
  guest_row public.guests%rowtype;
  location_name text;
  location_timezone text;
  table_labels text[];
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_organization_id is null or p_location_id is null
    or p_manage_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'A valid scoped manage token is required'
      using errcode = '22023';
  end if;
  select token.*
  into token_row
  from private.public_booking_tokens token
  where token.organization_id = p_organization_id
    and token.location_id = p_location_id
    and token.token_hash = p_manage_token_hash
    and token.token_kind = 'manage'
    and token.revoked_at is null
    and token.expires_at > clock_timestamp();
  if token_row.id is null then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  select reservation.*
  into reservation_row
  from public.reservations reservation
  where reservation.organization_id = p_organization_id
    and reservation.location_id = p_location_id
    and reservation.id = token_row.reservation_id;
  if reservation_row.id is null then
    raise exception 'The manage link is unavailable' using errcode = 'P0002';
  end if;
  select guest.*
  into guest_row
  from public.guests guest
  where guest.organization_id = p_organization_id
    and guest.id = reservation_row.guest_id;
  select location.name, location.timezone
  into location_name, location_timezone
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id;
  select array_agg(table_row.label order by table_row.label)
  into table_labels
  from public.reservation_table_allocations allocation
  join public.reservation_tables table_row
    on table_row.organization_id = allocation.organization_id
   and table_row.id = allocation.table_id
  where allocation.organization_id = p_organization_id
    and allocation.location_id = p_location_id
    and allocation.reservation_id = reservation_row.id
    and allocation.is_active;
  return jsonb_build_object(
    'reservationId', reservation_row.id,
    'publicCode', reservation_row.public_code,
    'status', reservation_row.status,
    'reservedAt', reservation_row.reserved_at,
    'durationMinutes', reservation_row.duration_minutes,
    'partySize', reservation_row.party_size,
    'specialRequests', reservation_row.special_requests,
    'guestName', guest_row.display_name,
    'locationName', location_name,
    'timeZone', location_timezone,
    'tableLabels', coalesce(table_labels, '{}'::text[]),
    'manageExpiresAt', token_row.expires_at
  );
end
$$;

-- Reminder identity follows the reservation version. A scheduler racing a
-- staff move may still insert the old version, but it cannot block the new
-- reminder and pre-send validation rejects the stale row.
create or replace function public.service_enqueue_reservation_reminders(
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
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_now is null then
    raise exception 'A reminder clock is required' using errcode = '22023';
  end if;
  insert into public.reservation_message_outbox (
    organization_id,
    location_id,
    reservation_id,
    guest_id,
    channel,
    template_key,
    template_data,
    dedupe_key
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
      'reservationVersion', reservation.version,
      'reminder', reminder.value,
      'channel', case when reservation.booking_channel = 'web'
        then channel.value end
    ),
    'reservation:' || reservation.id::text || ':reminder:'
      || reminder.value || ':v' || reservation.version::text
      || ':' || channel.value
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
          and verification.verified_destination_hash = encode(
            extensions.digest(
              'reservation-verified-destination:v1' || chr(31)
                || verification.confirmation_fingerprint || chr(31)
                || case verification.verified_channel
                  when 'email' then lower(btrim(guest.email))
                  else regexp_replace(
                    coalesce(guest.phone, ''),
                    '[^0-9]',
                    '',
                    'g'
                  )
                end,
              'sha256'
            ),
            'hex'
          )
      )]::text[]
      else array['email', 'sms']::text[]
    end) candidate(value)
    where candidate.value is not null
      and candidate.value = any(settings.verification_channels)
  ) channel
  where reservation.status in ('booked', 'confirmed')
    and reminder.due
    and (
      (reminder.value = '24h'
        and 1440 = any(settings.reminder_schedule_minutes))
      or (reminder.value = '2h'
        and 120 = any(settings.reminder_schedule_minutes))
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

create function public.modify_reservation(
  p_request_id uuid,
  p_location_id uuid,
  p_reservation_id uuid,
  p_expected_version integer,
  p_reserved_at timestamptz,
  p_duration_minutes integer,
  p_party_size integer,
  p_special_requests text,
  p_table_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  observed_at timestamptz := clock_timestamp();
  location_date date;
  organization_uuid uuid;
  initial_row public.reservations%rowtype;
  reservation_row public.reservations%rowtype;
  normalized_table_ids uuid[];
  table_id uuid;
  allocation_id uuid;
  before_table_ids uuid[] := '{}'::uuid[];
  before_allocation_ids uuid[] := '{}'::uuid[];
  after_allocation_ids uuid[] := '{}'::uuid[];
  policy_contract jsonb;
  settings_row public.reservation_settings%rowtype;
  verified_message_channel text;
  refreshed_manage_expires_at timestamptz;
  guest_notification_queued boolean := false;
  request_payload jsonb;
  request_payload_hash text;
  before_state jsonb;
  after_state jsonb;
  allocation_evidence jsonb;
  revision_id uuid := gen_random_uuid();
  result_evidence jsonb;
  request_created boolean;
begin
  select coalesce(array_agg(value order by value), '{}'::uuid[])
  into normalized_table_ids
  from (
    select distinct value
    from unnest(coalesce(p_table_ids, '{}'::uuid[])) value
    where value is not null
  ) normalized;

  if actor_id is null
    or p_request_id is null
    or p_location_id is null
    or p_reservation_id is null
    or p_expected_version is null or p_expected_version < 1
    or p_reserved_at is null
    or p_duration_minutes not between 15 and 720
    or p_party_size not between 1 and 100
    or cardinality(normalized_table_ids) > 8
    or cardinality(normalized_table_ids) <> cardinality(coalesce(p_table_ids, '{}'::uuid[]))
    or length(coalesce(p_special_requests, '')) > 2000
    or length(btrim(coalesce(p_reason, ''))) not between 4 and 1000 then
    raise exception 'A valid reservation modification is required'
      using errcode = '22023';
  end if;

  select location.organization_id,
    (observed_at at time zone location.timezone)::date
  into organization_uuid, location_date
  from public.locations location
  where location.id = p_location_id
    and location.is_active;
  if organization_uuid is null or not public.has_capability(
    organization_uuid,
    p_location_id,
    'reservations.operate',
    location_date
  ) then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  select reservation.*
  into initial_row
  from public.reservations reservation
  where reservation.organization_id = organization_uuid
    and reservation.location_id = p_location_id
    and reservation.id = p_reservation_id;
  if initial_row.id is null then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;

  request_payload := jsonb_build_object(
    'expectedVersion', p_expected_version,
    'reservedAt', p_reserved_at,
    'durationMinutes', p_duration_minutes,
    'partySize', p_party_size,
    'specialRequests', nullif(btrim(p_special_requests), ''),
    'tableIds', normalized_table_ids,
    'reason', btrim(p_reason)
  );
  request_payload_hash := encode(
    extensions.digest(request_payload::text, 'sha256'),
    'hex'
  );
  perform private.lock_reservation_inventory_many(
    p_location_id,
    array[initial_row.reserved_at, p_reserved_at]::timestamptz[]
  );
  request_created := private.claim_operation_request(
    p_request_id,
    'reservation.modify',
    organization_uuid,
    p_location_id,
    p_reservation_id,
    request_payload
  );
  if not request_created then
    select revision.result_evidence
      || jsonb_build_object('replayed', true)
    into result_evidence
    from public.reservation_revisions revision
    where revision.request_id = p_request_id
      and revision.organization_id = organization_uuid
      and revision.location_id = p_location_id
      and revision.reservation_id = p_reservation_id
      and revision.actor_id = actor_id
      and revision.mutation_kind = 'staff_modified';
    if result_evidence is null then
      raise exception 'Reservation replay evidence is unavailable'
        using errcode = '40001';
    end if;
    return result_evidence;
  end if;

  select *
  into reservation_row
  from public.reservations reservation
  where reservation.organization_id = organization_uuid
    and reservation.location_id = p_location_id
    and reservation.id = p_reservation_id
  for update;
  if reservation_row.id is null
    or reservation_row.version <> p_expected_version then
    raise exception 'Reservation changed concurrently; review the latest details'
      using errcode = '40001';
  end if;
  if reservation_row.status not in ('booked', 'confirmed') then
    raise exception 'Only booked or confirmed reservations can be changed'
      using errcode = '23514';
  end if;
  if reservation_row.source in ('resy', 'import', 'other')
    or reservation_row.booking_channel in ('import', 'partner') then
    raise exception 'External reservation records are read-only until source ownership is approved'
      using errcode = '23514';
  end if;

  select setting.*
  into settings_row
  from public.reservation_settings setting
  where setting.organization_id = organization_uuid
    and setting.location_id = p_location_id;
  if reservation_row.booking_channel = 'web'
    and settings_row.guest_messaging_enabled
    and settings_row.approved_at is not null then
    select verification.verified_channel
    into verified_message_channel
    from private.public_booking_holds hold
    join private.public_booking_verifications verification
      on verification.organization_id = hold.organization_id
     and verification.location_id = hold.location_id
     and verification.booking_hold_id = hold.id
    join public.guests guest
      on guest.organization_id = reservation_row.organization_id
     and guest.id = reservation_row.guest_id
    where hold.organization_id = organization_uuid
      and hold.location_id = p_location_id
      and hold.reservation_id = reservation_row.id
      and verification.verified_channel = any(settings_row.verification_channels)
      and verification.verified_destination_hash = encode(
        extensions.digest(
          'reservation-verified-destination:v1' || chr(31)
            || verification.confirmation_fingerprint || chr(31)
            || case verification.verified_channel
              when 'email' then lower(btrim(guest.email))
              else regexp_replace(coalesce(guest.phone, ''), '[^0-9]', '', 'g')
            end,
          'sha256'
        ),
        'hex'
      )
      and (
        (verification.verified_channel = 'email' and guest.email is not null)
        or (verification.verified_channel = 'sms' and guest.phone is not null)
      )
    order by verification.consumed_at desc, verification.id
    limit 1;
  end if;

  policy_contract := private.assert_staff_reservation_policy(
    organization_uuid,
    p_location_id,
    p_reserved_at,
    p_duration_minutes,
    p_party_size,
    reservation_row.id
  );
  if cardinality(normalized_table_ids) > 0 then
    perform private.assert_reservation_tables_available(
      organization_uuid,
      p_location_id,
      reservation_row.id,
      normalized_table_ids,
      p_reserved_at,
      p_reserved_at + make_interval(mins => p_duration_minutes),
      p_party_size
    );
  end if;

  select
    coalesce(array_agg(allocation.table_id order by allocation.table_id), '{}'::uuid[]),
    coalesce(array_agg(allocation.id order by allocation.id), '{}'::uuid[])
  into before_table_ids, before_allocation_ids
  from public.reservation_table_allocations allocation
  where allocation.organization_id = organization_uuid
    and allocation.location_id = p_location_id
    and allocation.reservation_id = reservation_row.id
    and allocation.is_active;

  before_state := jsonb_build_object(
    'reservedAt', reservation_row.reserved_at,
    'durationMinutes', reservation_row.duration_minutes,
    'partySize', reservation_row.party_size,
    'status', reservation_row.status,
    'specialRequests', reservation_row.special_requests,
    'tableIds', before_table_ids,
    'version', reservation_row.version
  );

  update public.reservation_table_allocations allocation
  set is_active = false,
      released_at = observed_at,
      released_by = actor_id,
      updated_at = observed_at
  where allocation.organization_id = organization_uuid
    and allocation.location_id = p_location_id
    and allocation.reservation_id = reservation_row.id
    and allocation.is_active;

  foreach table_id in array normalized_table_ids loop
    insert into public.reservation_table_allocations (
      organization_id,
      location_id,
      reservation_id,
      table_id,
      allocation_kind,
      starts_at,
      ends_at,
      created_by
    ) values (
      organization_uuid,
      p_location_id,
      reservation_row.id,
      table_id,
      'assignment',
      p_reserved_at,
      p_reserved_at + make_interval(mins => p_duration_minutes),
      actor_id
    )
    returning id into allocation_id;
    after_allocation_ids := array_append(after_allocation_ids, allocation_id);
  end loop;

  update public.reservations reservation
  set reserved_at = p_reserved_at,
      duration_minutes = p_duration_minutes,
      party_size = p_party_size,
      special_requests = nullif(btrim(p_special_requests), ''),
      version = reservation.version + 1,
      updated_at = observed_at
  where reservation.organization_id = organization_uuid
    and reservation.location_id = p_location_id
    and reservation.id = p_reservation_id
  returning * into reservation_row;

  refreshed_manage_expires_at := reservation_row.reserved_at
    + make_interval(mins => reservation_row.duration_minutes)
    + interval '24 hours';
  update private.public_booking_tokens token
  set expires_at = refreshed_manage_expires_at
  where token.organization_id = organization_uuid
    and token.location_id = p_location_id
    and token.reservation_id = reservation_row.id
    and token.token_kind = 'manage'
    and token.revoked_at is null;
  update private.public_booking_management_exchanges exchange
  set manage_expires_at = refreshed_manage_expires_at
  where exchange.organization_id = organization_uuid
    and exchange.location_id = p_location_id
    and exchange.reservation_id = reservation_row.id
    and exists (
      select 1
      from private.public_booking_tokens token
      where token.organization_id = organization_uuid
        and token.location_id = p_location_id
        and token.reservation_id = reservation_row.id
        and token.token_kind = 'manage'
        and token.revoked_at is null
        and token.token_hash = exchange.manage_token_hash
        and token.expires_at = refreshed_manage_expires_at
    );

  -- The existing reminder scheduler uses one stable key per reminder/channel.
  -- Archive the prior commitment's key so a newly due reminder can be
  -- scheduled for this version without deleting delivery evidence.
  update public.reservation_message_outbox message
  set dedupe_key = message.dedupe_key || ':v'
        || (before_state ->> 'version'),
      updated_at = observed_at
  where message.organization_id = organization_uuid
    and message.location_id = p_location_id
    and message.reservation_id = reservation_row.id
    and message.template_key in (
      'reservation_reminder_24h', 'reservation_reminder_2h'
    )
    and message.dedupe_key =
      'reservation:' || reservation_row.id::text || ':reminder:'
      || case message.template_key
        when 'reservation_reminder_24h' then '24h'
        else '2h'
      end || ':' || message.channel;
  update public.reservation_message_outbox message
  set status = 'cancelled',
      claim_token = null,
      claimed_by = null,
      claimed_at = null,
      lease_expires_at = null,
      updated_at = observed_at
  where message.organization_id = organization_uuid
    and message.location_id = p_location_id
    and message.reservation_id = reservation_row.id
    and message.template_key in (
      'reservation_modified',
      'reservation_reminder_24h',
      'reservation_reminder_2h'
    )
    and message.status in ('queued', 'failed', 'sending');

  if verified_message_channel is not null then
    insert into public.reservation_message_outbox (
      organization_id,
      location_id,
      reservation_id,
      guest_id,
      channel,
      template_key,
      template_data,
      dedupe_key
    ) values (
      organization_uuid,
      p_location_id,
      reservation_row.id,
      reservation_row.guest_id,
      verified_message_channel,
      'reservation_modified',
      jsonb_build_object(
        'publicCode', reservation_row.public_code,
        'channel', verified_message_channel,
        'reservedAt', reservation_row.reserved_at,
        'reservationVersion', reservation_row.version
      ),
      'reservation:' || reservation_row.id::text || ':modified:'
        || reservation_row.version::text || ':' || verified_message_channel
    ) on conflict (organization_id, dedupe_key) do nothing;
    guest_notification_queued := true;
  end if;

  after_state := jsonb_build_object(
    'reservedAt', reservation_row.reserved_at,
    'durationMinutes', reservation_row.duration_minutes,
    'partySize', reservation_row.party_size,
    'status', reservation_row.status,
    'specialRequests', reservation_row.special_requests,
    'tableIds', normalized_table_ids,
    'version', reservation_row.version
  );
  allocation_evidence := jsonb_build_object(
    'releasedAllocationIds', before_allocation_ids,
    'releasedTableIds', before_table_ids,
    'createdAllocationIds', after_allocation_ids,
    'createdTableIds', normalized_table_ids
  );
  result_evidence := jsonb_build_object(
    'id', reservation_row.id,
    'status', reservation_row.status,
    'version', reservation_row.version,
    'reservedAt', reservation_row.reserved_at,
    'durationMinutes', reservation_row.duration_minutes,
    'partySize', reservation_row.party_size,
    'revisionId', revision_id,
    'revisionKind', 'staff_modified',
    'policyEvidenceCaptured', true,
    'guestNotificationQueued', guest_notification_queued,
    'replayed', false
  );

  insert into public.reservation_revisions (
    id,
    organization_id,
    location_id,
    reservation_id,
    request_id,
    actor_id,
    version,
    mutation_kind,
    reason,
    payload_hash,
    before_state,
    after_state,
    service_shift_id,
    service_shift_evidence,
    policy_hash,
    policy_evidence,
    allocation_evidence,
    result_evidence,
    created_at
  ) values (
    revision_id,
    organization_uuid,
    p_location_id,
    reservation_row.id,
    p_request_id,
    actor_id,
    reservation_row.version,
    'staff_modified',
    btrim(p_reason),
    request_payload_hash,
    before_state,
    after_state,
    (policy_contract ->> 'serviceShiftId')::uuid,
    policy_contract -> 'serviceShiftEvidence',
    policy_contract ->> 'policyHash',
    policy_contract -> 'policyEvidence',
    allocation_evidence,
    result_evidence,
    observed_at
  );
  insert into public.reservation_events (
    organization_id,
    location_id,
    reservation_id,
    event_type,
    from_status,
    to_status,
    actor_id,
    actor_kind,
    metadata,
    occurred_at
  ) values (
    organization_uuid,
    p_location_id,
    reservation_row.id,
    'staff_modified',
    reservation_row.status,
    reservation_row.status,
    actor_id,
    'staff',
    jsonb_build_object(
      'requestId', p_request_id,
      'revisionId', revision_id,
      'previousReservedAt', before_state -> 'reservedAt',
      'previousPartySize', before_state -> 'partySize'
    ),
    observed_at
  );
  perform private.complete_operation_request(p_request_id);
  return result_evidence;
end
$$;

create function public.cancel_reservation(
  p_request_id uuid,
  p_location_id uuid,
  p_reservation_id uuid,
  p_expected_version integer,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  observed_at timestamptz := clock_timestamp();
  location_date date;
  organization_uuid uuid;
  initial_row public.reservations%rowtype;
  reservation_row public.reservations%rowtype;
  service_shift public.service_shifts%rowtype;
  settings_row public.reservation_settings%rowtype;
  policy record;
  verified_message_channel text;
  guest_notification_queued boolean := false;
  request_payload jsonb;
  request_payload_hash text;
  request_created boolean;
  before_table_ids uuid[] := '{}'::uuid[];
  before_allocation_ids uuid[] := '{}'::uuid[];
  before_state jsonb;
  after_state jsonb;
  shift_evidence jsonb := '{}'::jsonb;
  policy_evidence jsonb := '{}'::jsonb;
  policy_hash text;
  allocation_evidence jsonb;
  revision_id uuid := gen_random_uuid();
  result_evidence jsonb;
begin
  if actor_id is null
    or p_request_id is null
    or p_location_id is null
    or p_reservation_id is null
    or p_expected_version is null or p_expected_version < 1
    or length(btrim(coalesce(p_reason, ''))) not between 4 and 1000 then
    raise exception 'A valid reservation cancellation is required'
      using errcode = '22023';
  end if;

  select location.organization_id,
    (observed_at at time zone location.timezone)::date
  into organization_uuid, location_date
  from public.locations location
  where location.id = p_location_id
    and location.is_active;
  if organization_uuid is null or not public.has_capability(
    organization_uuid,
    p_location_id,
    'reservations.operate',
    location_date
  ) then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  select reservation.*
  into initial_row
  from public.reservations reservation
  where reservation.organization_id = organization_uuid
    and reservation.location_id = p_location_id
    and reservation.id = p_reservation_id;
  if initial_row.id is null then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;

  request_payload := jsonb_build_object(
    'expectedVersion', p_expected_version,
    'reason', btrim(p_reason)
  );
  request_payload_hash := encode(
    extensions.digest(request_payload::text, 'sha256'),
    'hex'
  );
  perform private.lock_reservation_inventory_many(
    p_location_id,
    array[initial_row.reserved_at]::timestamptz[]
  );
  request_created := private.claim_operation_request(
    p_request_id,
    'reservation.cancel',
    organization_uuid,
    p_location_id,
    p_reservation_id,
    request_payload
  );
  if not request_created then
    select revision.result_evidence
      || jsonb_build_object('replayed', true)
    into result_evidence
    from public.reservation_revisions revision
    where revision.request_id = p_request_id
      and revision.organization_id = organization_uuid
      and revision.location_id = p_location_id
      and revision.reservation_id = p_reservation_id
      and revision.actor_id = actor_id
      and revision.mutation_kind = 'staff_cancelled';
    if result_evidence is null then
      raise exception 'Reservation replay evidence is unavailable'
        using errcode = '40001';
    end if;
    return result_evidence;
  end if;

  select *
  into reservation_row
  from public.reservations reservation
  where reservation.organization_id = organization_uuid
    and reservation.location_id = p_location_id
    and reservation.id = p_reservation_id
  for update;
  if reservation_row.id is null
    or reservation_row.version <> p_expected_version then
    raise exception 'Reservation changed concurrently; review the latest details'
      using errcode = '40001';
  end if;
  if reservation_row.status not in ('booked', 'confirmed', 'arrived') then
    raise exception 'This reservation can no longer be cancelled'
      using errcode = '23514';
  end if;
  if reservation_row.source in ('resy', 'import', 'other')
    or reservation_row.booking_channel in ('import', 'partner') then
    raise exception 'External reservation records are read-only until source ownership is approved'
      using errcode = '23514';
  end if;

  select setting.*
  into settings_row
  from public.reservation_settings setting
  where setting.organization_id = organization_uuid
    and setting.location_id = p_location_id;
  if reservation_row.booking_channel = 'web'
    and settings_row.guest_messaging_enabled
    and settings_row.approved_at is not null then
    select verification.verified_channel
    into verified_message_channel
    from private.public_booking_holds hold
    join private.public_booking_verifications verification
      on verification.organization_id = hold.organization_id
     and verification.location_id = hold.location_id
     and verification.booking_hold_id = hold.id
    join public.guests guest
      on guest.organization_id = reservation_row.organization_id
     and guest.id = reservation_row.guest_id
    where hold.organization_id = organization_uuid
      and hold.location_id = p_location_id
      and hold.reservation_id = reservation_row.id
      and verification.verified_channel = any(settings_row.verification_channels)
      and verification.verified_destination_hash = encode(
        extensions.digest(
          'reservation-verified-destination:v1' || chr(31)
            || verification.confirmation_fingerprint || chr(31)
            || case verification.verified_channel
              when 'email' then lower(btrim(guest.email))
              else regexp_replace(coalesce(guest.phone, ''), '[^0-9]', '', 'g')
            end,
          'sha256'
        ),
        'hex'
      )
      and (
        (verification.verified_channel = 'email' and guest.email is not null)
        or (verification.verified_channel = 'sms' and guest.phone is not null)
      )
    order by verification.consumed_at desc, verification.id
    limit 1;
  end if;

  select
    coalesce(array_agg(allocation.table_id order by allocation.table_id), '{}'::uuid[]),
    coalesce(array_agg(allocation.id order by allocation.id), '{}'::uuid[])
  into before_table_ids, before_allocation_ids
  from public.reservation_table_allocations allocation
  where allocation.organization_id = organization_uuid
    and allocation.location_id = p_location_id
    and allocation.reservation_id = reservation_row.id
    and allocation.is_active;
  before_state := jsonb_build_object(
    'reservedAt', reservation_row.reserved_at,
    'durationMinutes', reservation_row.duration_minutes,
    'partySize', reservation_row.party_size,
    'status', reservation_row.status,
    'specialRequests', reservation_row.special_requests,
    'tableIds', before_table_ids,
    'version', reservation_row.version
  );

  select shift.*
  into service_shift
  from public.service_shifts shift
  where shift.organization_id = organization_uuid
    and shift.location_id = p_location_id
    and reservation_row.reserved_at >= shift.starts_at
    and reservation_row.reserved_at < shift.ends_at
  order by (shift.status = 'scheduled') desc, shift.starts_at desc, shift.id
  limit 1;
  if service_shift.id is not null then
    select *
    into policy
    from private.service_shift_effective_policy(
      service_shift.id,
      reservation_row.reserved_at,
      reservation_row.reserved_at
        + make_interval(mins => reservation_row.duration_minutes)
    );
    shift_evidence := jsonb_build_object(
      'id', service_shift.id,
      'businessDate', service_shift.business_date,
      'servicePeriodId', service_shift.service_period_id,
      'name', service_shift.name,
      'startsAt', service_shift.starts_at,
      'endsAt', service_shift.ends_at,
      'status', service_shift.status,
      'configurationState', service_shift.configuration_state,
      'sourceUpdatedAt', service_shift.source_updated_at
    );
    policy_evidence := jsonb_build_object(
      'isClosed', policy.is_closed,
      'pacingIntervalMinutes', policy.pacing_interval_minutes,
      'pacingCoverLimit', policy.pacing_cover_limit,
      'openingBufferMinutes', policy.opening_buffer_minutes,
      'closingBufferMinutes', policy.closing_buffer_minutes
    );
    policy_hash := encode(
      extensions.digest(
        jsonb_build_object(
          'serviceShift', shift_evidence,
          'policy', policy_evidence
        )::text,
        'sha256'
      ),
      'hex'
    );
  end if;

  update public.reservation_table_allocations allocation
  set is_active = false,
      released_at = observed_at,
      released_by = actor_id,
      updated_at = observed_at
  where allocation.organization_id = organization_uuid
    and allocation.location_id = p_location_id
    and allocation.reservation_id = reservation_row.id
    and allocation.is_active;
  update private.public_booking_tokens token
  set revoked_at = observed_at
  where token.organization_id = organization_uuid
    and token.location_id = p_location_id
    and token.reservation_id = reservation_row.id
    and token.token_kind = 'manage'
    and token.revoked_at is null;
  update public.reservation_message_outbox message
  set status = 'cancelled',
      claim_token = null,
      claimed_by = null,
      claimed_at = null,
      lease_expires_at = null,
      updated_at = observed_at
  where message.organization_id = organization_uuid
    and message.location_id = p_location_id
    and message.reservation_id = reservation_row.id
    and message.status in ('queued', 'failed', 'sending')
    and message.template_key <> 'reservation_cancelled';

  update public.reservations reservation
  set status = 'cancelled',
      cancellation_reason = btrim(p_reason),
      cancelled_at = observed_at,
      version = reservation.version + 1,
      updated_at = observed_at
  where reservation.organization_id = organization_uuid
    and reservation.location_id = p_location_id
    and reservation.id = p_reservation_id
  returning * into reservation_row;

  if verified_message_channel is not null then
    insert into public.reservation_message_outbox (
      organization_id,
      location_id,
      reservation_id,
      guest_id,
      channel,
      template_key,
      template_data,
      dedupe_key
    ) values (
      organization_uuid,
      p_location_id,
      reservation_row.id,
      reservation_row.guest_id,
      verified_message_channel,
      'reservation_cancelled',
      jsonb_build_object(
        'publicCode', reservation_row.public_code,
        'channel', verified_message_channel,
        'reservedAt', reservation_row.reserved_at,
        'reservationVersion', reservation_row.version
      ),
      'reservation:' || reservation_row.id::text || ':cancelled:'
        || reservation_row.version::text || ':' || verified_message_channel
    ) on conflict (organization_id, dedupe_key) do nothing;
    guest_notification_queued := true;
  end if;

  after_state := jsonb_build_object(
    'reservedAt', reservation_row.reserved_at,
    'durationMinutes', reservation_row.duration_minutes,
    'partySize', reservation_row.party_size,
    'status', reservation_row.status,
    'specialRequests', reservation_row.special_requests,
    'tableIds', '{}'::uuid[],
    'version', reservation_row.version
  );
  allocation_evidence := jsonb_build_object(
    'releasedAllocationIds', before_allocation_ids,
    'releasedTableIds', before_table_ids,
    'createdAllocationIds', '[]'::jsonb,
    'createdTableIds', '[]'::jsonb
  );
  result_evidence := jsonb_build_object(
    'id', reservation_row.id,
    'status', reservation_row.status,
    'version', reservation_row.version,
    'reservedAt', reservation_row.reserved_at,
    'durationMinutes', reservation_row.duration_minutes,
    'partySize', reservation_row.party_size,
    'revisionId', revision_id,
    'revisionKind', 'staff_cancelled',
    'policyEvidenceCaptured', policy_hash is not null,
    'guestNotificationQueued', guest_notification_queued,
    'replayed', false
  );

  insert into public.reservation_revisions (
    id,
    organization_id,
    location_id,
    reservation_id,
    request_id,
    actor_id,
    version,
    mutation_kind,
    reason,
    payload_hash,
    before_state,
    after_state,
    service_shift_id,
    service_shift_evidence,
    policy_hash,
    policy_evidence,
    allocation_evidence,
    result_evidence,
    created_at
  ) values (
    revision_id,
    organization_uuid,
    p_location_id,
    reservation_row.id,
    p_request_id,
    actor_id,
    reservation_row.version,
    'staff_cancelled',
    btrim(p_reason),
    request_payload_hash,
    before_state,
    after_state,
    service_shift.id,
    shift_evidence,
    policy_hash,
    policy_evidence,
    allocation_evidence,
    result_evidence,
    observed_at
  );
  insert into public.reservation_events (
    organization_id,
    location_id,
    reservation_id,
    event_type,
    from_status,
    to_status,
    actor_id,
    actor_kind,
    metadata,
    occurred_at
  ) values (
    organization_uuid,
    p_location_id,
    reservation_row.id,
    'staff_cancelled',
    before_state ->> 'status',
    reservation_row.status,
    actor_id,
    'staff',
    jsonb_build_object('requestId', p_request_id, 'revisionId', revision_id),
    observed_at
  );
  perform private.complete_operation_request(p_request_id);
  return result_evidence;
end
$$;

revoke all on function public.modify_reservation(
  uuid, uuid, uuid, integer, timestamptz, integer, integer, text, uuid[], text
) from public, anon, authenticated, service_role;
grant execute on function public.modify_reservation(
  uuid, uuid, uuid, integer, timestamptz, integer, integer, text, uuid[], text
) to authenticated;
revoke all on function public.cancel_reservation(
  uuid, uuid, uuid, integer, text
) from public, anon, authenticated, service_role;
grant execute on function public.cancel_reservation(
  uuid, uuid, uuid, integer, text
) to authenticated;

-- Delivery happens after the claim transaction. Revalidate the exact lease
-- and linked lifecycle immediately before the provider call so a staff
-- reschedule/cancellation can invalidate stale work. A provider request that
-- is already in flight remains an external release gate and cannot be recalled.
create function public.service_validate_reservation_message_claim(
  p_id uuid,
  p_claim_token uuid,
  p_now timestamptz
)
returns boolean
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  message public.reservation_message_outbox%rowtype;
  reservation public.reservations%rowtype;
  expected_version integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_id is null or p_claim_token is null or p_now is null then
    raise exception 'A valid reservation message claim is required'
      using errcode = '22023';
  end if;
  select candidate.*
  into message
  from public.reservation_message_outbox candidate
  where candidate.id = p_id
    and candidate.status = 'sending'
    and candidate.claim_token = p_claim_token
    and candidate.lease_expires_at > p_now;
  if message.id is null then
    return false;
  end if;

  if message.template_key = 'reservation_verify' then
    return exists (
      select 1
      from private.public_booking_holds hold
      where hold.organization_id = message.organization_id
        and hold.location_id = message.location_id
        and hold.id = message.booking_hold_id
        and hold.status = 'pending'
        and hold.expires_at > p_now
    );
  end if;
  if message.template_key = 'waitlist_table_ready' then
    return exists (
      select 1
      from public.waitlist_entries entry
      where entry.organization_id = message.organization_id
        and entry.location_id = message.location_id
        and entry.id = message.waitlist_entry_id
        and entry.status = 'notified'
        and entry.offer_expires_at > p_now
    );
  end if;
  if message.reservation_id is null then
    return false;
  end if;
  select candidate.*
  into reservation
  from public.reservations candidate
  where candidate.organization_id = message.organization_id
    and candidate.location_id = message.location_id
    and candidate.id = message.reservation_id;
  if reservation.id is null then
    return false;
  end if;
  if message.template_data ? 'reservationVersion' then
    if coalesce(message.template_data ->> 'reservationVersion', '')
        !~ '^[1-9][0-9]*$' then
      return false;
    end if;
    expected_version := (message.template_data ->> 'reservationVersion')::integer;
    if expected_version <> reservation.version then
      return false;
    end if;
  end if;
  if reservation.booking_channel = 'web'
    and message.template_key in (
      'reservation_confirmed',
      'reservation_modified',
      'reservation_cancelled',
      'reservation_reminder_24h',
      'reservation_reminder_2h'
    )
    and not exists (
      select 1
      from private.public_booking_holds hold
      join private.public_booking_verifications verification
        on verification.organization_id = hold.organization_id
       and verification.location_id = hold.location_id
       and verification.booking_hold_id = hold.id
      join public.guests guest
        on guest.organization_id = reservation.organization_id
       and guest.id = reservation.guest_id
      where hold.organization_id = reservation.organization_id
        and hold.location_id = reservation.location_id
        and hold.reservation_id = reservation.id
        and verification.verified_channel = message.channel
        and message.template_data ->> 'channel' = message.channel
        and verification.verified_destination_hash = encode(
          extensions.digest(
            'reservation-verified-destination:v1' || chr(31)
              || verification.confirmation_fingerprint || chr(31)
              || case verification.verified_channel
                when 'email' then lower(btrim(guest.email))
                else regexp_replace(
                  coalesce(guest.phone, ''),
                  '[^0-9]',
                  '',
                  'g'
                )
              end,
            'sha256'
          ),
          'hex'
        )
    ) then
    return false;
  end if;

  if message.template_key = 'reservation_cancelled' then
    return reservation.status = 'cancelled';
  end if;
  if message.template_key = 'reservation_confirmed' then
    return reservation.status in ('booked', 'confirmed')
      and reservation.duration_minutes is not null
      and reservation.reserved_at
        + make_interval(mins => reservation.duration_minutes)
        + interval '24 hours' > p_now;
  end if;
  if message.template_key = 'reservation_modified' then
    return reservation.status in ('booked', 'confirmed');
  end if;
  if message.template_key = 'reservation_reminder_24h' then
    return reservation.status in ('booked', 'confirmed')
      and reservation.reserved_at > p_now + interval '2 hours'
      and reservation.reserved_at <= p_now + interval '24 hours';
  end if;
  if message.template_key = 'reservation_reminder_2h' then
    return reservation.status in ('booked', 'confirmed')
      and reservation.reserved_at > p_now
      and reservation.reserved_at <= p_now + interval '2 hours';
  end if;
  return false;
end
$$;

revoke all on function public.service_validate_reservation_message_claim(
  uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.service_validate_reservation_message_claim(
  uuid, uuid, timestamptz
) to service_role;

-- Retain the mature create/transition kernels while removing their unsafe
-- authenticated update/cancel surfaces. Their public wrappers enforce the new
-- lifecycle boundary before delegating to the original, now-private bodies.
alter function public.save_reservation(
  uuid, uuid, uuid, uuid, timestamptz, integer, integer, text, text, uuid[]
) set schema private;
alter function private.save_reservation(
  uuid, uuid, uuid, uuid, timestamptz, integer, integer, text, text, uuid[]
) rename to save_reservation_create_kernel;
revoke all on function private.save_reservation_create_kernel(
  uuid, uuid, uuid, uuid, timestamptz, integer, integer, text, text, uuid[]
) from public, anon, authenticated, service_role;

create function public.save_reservation(
  p_request_id uuid,
  p_location_id uuid,
  p_reservation_id uuid,
  p_guest_id uuid,
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
  target_reservation_id uuid := coalesce(p_reservation_id, p_request_id);
begin
  if exists (
    select 1 from public.reservations reservation
    where reservation.id = target_reservation_id
  ) and not exists (
    select 1 from private.operation_requests request
    where request.request_id = p_request_id
      and request.operation_kind = 'reservation.save'
      and request.record_id = target_reservation_id
      and request.actor_id = auth.uid()
      and request.completed_at is not null
  ) then
    raise exception 'Use the versioned reservation modification command'
      using errcode = '23514';
  end if;
  return private.save_reservation_create_kernel(
    p_request_id,
    p_location_id,
    p_reservation_id,
    p_guest_id,
    p_reserved_at,
    p_duration_minutes,
    p_party_size,
    p_special_requests,
    p_source,
    p_table_ids
  );
end
$$;

revoke all on function public.save_reservation(
  uuid, uuid, uuid, uuid, timestamptz, integer, integer, text, text, uuid[]
) from public, anon, authenticated, service_role;
grant execute on function public.save_reservation(
  uuid, uuid, uuid, uuid, timestamptz, integer, integer, text, text, uuid[]
) to authenticated;

alter function public.transition_reservation(uuid, uuid, text, text)
set schema private;
alter function private.transition_reservation(uuid, uuid, text, text)
rename to transition_reservation_kernel;
revoke all on function private.transition_reservation_kernel(uuid, uuid, text, text)
from public, anon, authenticated, service_role;

create function public.transition_reservation(
  p_request_id uuid,
  p_reservation_id uuid,
  p_target_status text,
  p_note text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if p_target_status = 'cancelled' then
    raise exception 'Use the versioned reservation cancellation command'
      using errcode = '23514';
  end if;
  return private.transition_reservation_kernel(
    p_request_id,
    p_reservation_id,
    p_target_status,
    p_note
  );
end
$$;

revoke all on function public.transition_reservation(uuid, uuid, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.transition_reservation(uuid, uuid, text, text)
to authenticated;
