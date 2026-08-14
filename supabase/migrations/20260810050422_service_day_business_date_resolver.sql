-- One database-authoritative service-day boundary for Today, service control,
-- reservation pacing, and reservation inventory serialization. A service that
-- starts before midnight and ends after midnight retains its opening date.

create function private.resolve_service_day_context(
  p_organization_id uuid,
  p_location_id uuid,
  p_observed_at timestamptz,
  p_require_online boolean default false
)
returns table (
  business_date date,
  calendar_date date,
  time_zone text,
  source text,
  service_period_id uuid,
  service_name text,
  starts_at timestamptz,
  ends_at timestamptz,
  pacing_interval_minutes integer,
  pacing_cover_limit integer,
  configuration_state text
)
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  location_timezone text;
  observed_calendar_date date;
begin
  select location.timezone
  into location_timezone
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id
    and location.is_active;

  if location_timezone is null or p_observed_at is null then
    raise exception 'A valid service-day scope is required'
      using errcode = '22023';
  end if;

  observed_calendar_date := (p_observed_at at time zone location_timezone)::date;

  return query
  with candidate_dates as (
    select observed_calendar_date as candidate_date
    union all
    select observed_calendar_date - 1
  ),
  service_candidates as (
    select
      candidate.candidate_date as candidate_business_date,
      period.id,
      period.name,
      boundary.starts_at,
      boundary.ends_at,
      period.pacing_interval_minutes,
      period.pacing_cover_limit,
      case
        when period.approved_at is not null then 'approved'
        else 'internal'
      end as configuration_state
    from public.reservation_service_periods period
    cross join candidate_dates candidate
    cross join lateral (
      select
        (candidate.candidate_date + period.starts_local)
          at time zone location_timezone as starts_at,
        (
          candidate.candidate_date
          + case when period.ends_local <= period.starts_local then 1 else 0 end
          + period.ends_local
        ) at time zone location_timezone as ends_at
    ) boundary
    where period.organization_id = p_organization_id
      and period.location_id = p_location_id
      and period.is_active
      and (not p_require_online or (
        period.online_enabled
        and period.approved_at is not null
      ))
      and extract(dow from candidate.candidate_date)::integer
        = any(period.days_of_week)
      and candidate.candidate_date >= period.effective_from
      and (
        period.effective_to is null
        or candidate.candidate_date <= period.effective_to
      )
      and p_observed_at >= boundary.starts_at
      and p_observed_at < boundary.ends_at
  ),
  latest_published_schedules as (
    select distinct on (schedule.week_start)
      schedule.id,
      schedule.week_start
    from public.schedules schedule
    where schedule.organization_id = p_organization_id
      and schedule.location_id = p_location_id
      and schedule.status = 'published'
    order by schedule.week_start, schedule.version desc, schedule.id
  ),
  schedule_candidates as (
    select
      (shift.starts_at at time zone location_timezone)::date
        as candidate_business_date,
      shift.starts_at,
      shift.ends_at
    from public.shifts shift
    join latest_published_schedules schedule
      on schedule.id = shift.schedule_id
    where shift.organization_id = p_organization_id
      and shift.location_id = p_location_id
      and shift.status <> 'cancelled'
      and shift.starts_at <= p_observed_at
      and shift.ends_at > p_observed_at
  ),
  candidates as (
    select
      0 as priority,
      service.candidate_business_date,
      'reservation_service_period'::text as source,
      service.id as service_period_id,
      service.name as service_name,
      service.starts_at,
      service.ends_at,
      service.pacing_interval_minutes,
      service.pacing_cover_limit,
      service.configuration_state
    from service_candidates service

    union all

    select
      1,
      schedule.candidate_business_date,
      'published_shift'::text,
      null::uuid,
      null::text,
      schedule.starts_at,
      schedule.ends_at,
      null::integer,
      null::integer,
      'schedule_only'::text
    from schedule_candidates schedule
    where not p_require_online

    union all

    select
      2,
      observed_calendar_date,
      'calendar'::text,
      null::uuid,
      null::text,
      null::timestamptz,
      null::timestamptz,
      null::integer,
      null::integer,
      'unconfigured'::text
    where not p_require_online
  )
  select
    candidate.candidate_business_date,
    observed_calendar_date,
    location_timezone,
    candidate.source,
    candidate.service_period_id,
    candidate.service_name,
    candidate.starts_at,
    candidate.ends_at,
    candidate.pacing_interval_minutes,
    candidate.pacing_cover_limit,
    candidate.configuration_state
  from candidates candidate
  order by
    candidate.priority,
    case when candidate.priority = 0 then candidate.starts_at end desc nulls last,
    case when candidate.priority = 1 then candidate.starts_at end asc nulls last,
    candidate.service_period_id
  limit 1;
end
$$;

create function private.resolve_service_business_date(
  p_organization_id uuid,
  p_location_id uuid,
  p_observed_at timestamptz
)
returns date
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select context.business_date
  from private.resolve_service_day_context(
    p_organization_id,
    p_location_id,
    p_observed_at,
    false
  ) context
$$;

create function public.service_day_business_date(
  p_organization_id uuid,
  p_location_id uuid,
  p_observed_at timestamptz default statement_timestamp()
)
returns table (
  "businessDate" date,
  "calendarDate" date,
  "timeZone" text,
  source text,
  "servicePeriodId" uuid,
  "serviceName" text,
  "startsAt" timestamptz,
  "endsAt" timestamptz,
  "pacingIntervalMinutes" integer,
  "pacingCoverLimit" integer,
  "configurationState" text
)
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
begin
  if auth.uid() is null
    or p_organization_id is null
    or p_location_id is null
    or p_observed_at is null
    or not exists (
      select 1
      from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
        and location.is_active
    )
    or not public.can_access_location(p_organization_id, p_location_id) then
    raise exception 'Service-day access is required' using errcode = '42501';
  end if;

  return query
  select
    context.business_date,
    context.calendar_date,
    context.time_zone,
    context.source,
    context.service_period_id,
    context.service_name,
    context.starts_at,
    context.ends_at,
    context.pacing_interval_minutes,
    context.pacing_cover_limit,
    context.configuration_state
  from private.resolve_service_day_context(
    p_organization_id,
    p_location_id,
    p_observed_at,
    false
  ) context;
end
$$;

-- Canonical reservation inventory keys use the operating date, not merely the
-- local calendar date. This keeps adjacent pacing buckets on opposite sides of
-- midnight under the same transaction lock.
create or replace function private.lock_reservation_inventory_many(
  p_location_id uuid,
  p_starts_at timestamptz[]
)
returns void
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  business_date date;
  organization_uuid uuid;
begin
  if p_location_id is null or p_starts_at is null
    or cardinality(p_starts_at) not between 1 and 32
    or exists (
      select 1 from unnest(p_starts_at) starts_at where starts_at is null
    ) then
    raise exception 'Valid reservation inventory lock keys are required'
      using errcode = '22023';
  end if;

  select location.organization_id
  into organization_uuid
  from public.locations location
  where location.id = p_location_id
    and location.is_active;
  if organization_uuid is null then
    raise exception 'Reservation location not found' using errcode = 'P0002';
  end if;

  for business_date in
    select distinct private.resolve_service_business_date(
      organization_uuid,
      p_location_id,
      starts_at
    )
    from unnest(p_starts_at) starts_at
    order by 1
  loop
    perform pg_advisory_xact_lock(hashtextextended(
      'reservation-inventory:' || p_location_id::text || ':' || business_date::text,
      0
    ));
    insert into private.reservation_inventory_days (location_id, business_date)
    values (p_location_id, business_date)
    on conflict do nothing;
  end loop;
end
$$;

create or replace function private.expire_public_booking_holds(
  p_organization_id uuid,
  p_location_id uuid,
  p_now timestamptz,
  p_limit integer,
  p_inventory_starts_at timestamptz default null
)
returns integer
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  hold_row private.public_booking_holds%rowtype;
  expired_count integer := 0;
  inventory_business_date date;
begin
  if p_organization_id is null or p_location_id is null or p_now is null
    or p_limit not between 1 and 10000 then
    raise exception 'Valid booking-hold expiry scope is required'
      using errcode = '22023';
  end if;
  if p_inventory_starts_at is not null then
    inventory_business_date := private.resolve_service_business_date(
      p_organization_id,
      p_location_id,
      p_inventory_starts_at
    );
  end if;

  for hold_row in
    select hold.*
    from private.public_booking_holds hold
    where hold.organization_id = p_organization_id
      and hold.location_id = p_location_id
      and hold.status = 'pending'
      and hold.expires_at <= p_now
      and (
        inventory_business_date is null
        or private.resolve_service_business_date(
          p_organization_id,
          p_location_id,
          hold.reserved_at
        ) = inventory_business_date
      )
    order by hold.expires_at, hold.id
    limit p_limit
    for update skip locked
  loop
    update private.public_booking_holds hold
    set status = 'expired', expired_at = p_now, redacted_at = p_now,
        first_name = null, last_name = null, email = null, phone = null,
        special_requests = null, updated_at = p_now
    where hold.id = hold_row.id and hold.status = 'pending';
    if not found then
      continue;
    end if;

    update public.reservation_table_allocations allocation
    set is_active = false, released_at = p_now, updated_at = p_now
    where allocation.organization_id = hold_row.organization_id
      and allocation.location_id = hold_row.location_id
      and allocation.booking_hold_id = hold_row.id
      and allocation.is_active;

    update public.reservation_message_outbox message
    set status = 'cancelled', claim_token = null, claimed_by = null,
        claimed_at = null, lease_expires_at = null, updated_at = p_now
    where message.organization_id = hold_row.organization_id
      and message.location_id = hold_row.location_id
      and message.booking_hold_id = hold_row.id
      and message.template_key = 'reservation_verify'
      and message.status in ('queued', 'failed', 'sending');

    insert into public.audit_events (
      organization_id, location_id, action, table_name, record_id,
      old_record, new_record, metadata, occurred_at
    ) values (
      hold_row.organization_id, hold_row.location_id,
      'public_booking_hold_expired', 'public_booking_holds', hold_row.id::text,
      jsonb_build_object('status', 'pending'),
      jsonb_build_object('status', 'expired'),
      jsonb_build_object('actorKind', 'system'), p_now
    );
    expired_count := expired_count + 1;
  end loop;
  return expired_count;
end
$$;

create or replace function private.assert_reservation_pacing(
  p_organization_id uuid,
  p_location_id uuid,
  p_starts_at timestamptz,
  p_party_size integer,
  p_exclude_reservation_id uuid default null,
  p_exclude_booking_hold_id uuid default null
)
returns void
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  service_period_uuid uuid;
  service_row public.reservation_service_periods%rowtype;
  existing_covers integer;
begin
  if p_organization_id is null or p_location_id is null
    or p_starts_at is null or p_party_size not between 1 and 100 then
    raise exception 'A valid pacing request is required' using errcode = '22023';
  end if;

  select context.service_period_id
  into service_period_uuid
  from private.resolve_service_day_context(
    p_organization_id,
    p_location_id,
    p_starts_at,
    true
  ) context;

  if service_period_uuid is null then
    raise exception 'No online service is configured for the requested time'
      using errcode = '23514';
  end if;

  select *
  into service_row
  from public.reservation_service_periods period
  where period.organization_id = p_organization_id
    and period.location_id = p_location_id
    and period.id = service_period_uuid
    and period.is_active
    and period.online_enabled
    and period.approved_at is not null
  for update;

  if service_row.id is null then
    raise exception 'No online service is configured for the requested time'
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
        - make_interval(mins => service_row.pacing_interval_minutes)
      and reservation.reserved_at < p_starts_at
        + make_interval(mins => service_row.pacing_interval_minutes)
    union all
    select hold.party_size
    from private.public_booking_holds hold
    where hold.organization_id = p_organization_id
      and hold.location_id = p_location_id
      and hold.id is distinct from p_exclude_booking_hold_id
      and hold.status = 'pending'
      and hold.expires_at > clock_timestamp()
      and hold.reserved_at >= p_starts_at
        - make_interval(mins => service_row.pacing_interval_minutes)
      and hold.reserved_at < p_starts_at
        + make_interval(mins => service_row.pacing_interval_minutes)
  ) covers;

  if existing_covers + p_party_size > service_row.pacing_cover_limit then
    raise exception 'The requested time has reached its pacing limit'
      using errcode = '23P01';
  end if;
end
$$;

create index reservation_service_periods_active_scope_idx
on public.reservation_service_periods (
  organization_id,
  location_id,
  effective_from,
  effective_to
)
where is_active;

revoke all on function private.resolve_service_day_context(uuid, uuid, timestamptz, boolean)
from public, anon, authenticated, service_role;
revoke all on function private.resolve_service_business_date(uuid, uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function public.service_day_business_date(uuid, uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function private.lock_reservation_inventory_many(uuid, timestamptz[])
from public, anon, authenticated, service_role;
revoke all on function private.expire_public_booking_holds(uuid, uuid, timestamptz, integer, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function private.assert_reservation_pacing(uuid, uuid, timestamptz, integer, uuid, uuid)
from public, anon, authenticated, service_role;

grant execute on function public.service_day_business_date(uuid, uuid, timestamptz)
to authenticated;

comment on function public.service_day_business_date(uuid, uuid, timestamptz) is
  'Resolves an authorized location service to its opening business date, including overnight reservation periods and published shifts.';
