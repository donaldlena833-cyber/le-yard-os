-- Reservation availability and database pacing must interpret local wall
-- times identically. PostgreSQL normally coerces nonexistent spring-forward
-- times and chooses one side of an autumn fold; neither behavior is safe for
-- an advertised or signed booking slot.

-- Earlier connected previews recorded the atomic-schedule migration before
-- this shared helper was added to that draft. Reassert it here so this
-- forward migration is self-contained on both histories.
create or replace function private.local_timestamp_is_unique(
  p_local timestamp,
  p_timezone text
)
returns boolean
language sql stable
set search_path = ''
as $$
  with chosen as (
    select p_local at time zone p_timezone as instant
  ), nearby_offsets as (
    select distinct
      ((chosen.instant + probe.delta) at time zone p_timezone)
        - ((chosen.instant + probe.delta) at time zone 'UTC') as utc_offset
    from chosen
    cross join unnest(array[
      interval '-2 days', interval '-1 day', interval '0 days',
      interval '1 day', interval '2 days'
    ]) probe(delta)
  ), possible_instants as (
    select distinct (p_local - nearby_offsets.utc_offset) at time zone 'UTC' as instant
    from nearby_offsets
  )
  select p_local is not null
    and p_timezone is not null
    and (select instant at time zone p_timezone from chosen) = p_local
    and (
      select count(*)
      from possible_instants possible
      where possible.instant at time zone p_timezone = p_local
    ) = 1
$$;

revoke all on function private.local_timestamp_is_unique(timestamp, text)
from public, anon, authenticated;

create function private.local_wall_timestamp_is_unambiguous(
  p_local timestamp without time zone,
  p_timezone text
)
returns boolean
language sql stable strict
set search_path = ''
as $$
  select private.local_timestamp_is_unique(p_local, p_timezone)
$$;

-- Recurring weekday spans use occurrence indexes rather than broad date
-- ranges. This avoids false conflicts when two short effective-date ranges
-- intersect but contain no common occurrence of the configured weekday.
create function private.weekday_occurrence_range(
  p_from date,
  p_to_exclusive date,
  p_weekday integer
)
returns int8range
language plpgsql immutable
set search_path = ''
as $$
declare
  anchor_date date;
  first_date date;
  first_excluded_date date;
  lower_occurrence bigint;
  upper_occurrence bigint;
begin
  if p_from is null or p_weekday not between 0 and 6
    or (p_to_exclusive is not null and p_to_exclusive < p_from) then
    raise exception 'A valid weekday occurrence range is required'
      using errcode = '22023';
  end if;

  anchor_date := date '1970-01-04' + p_weekday;
  first_date := p_from + (
    (p_weekday - extract(dow from p_from)::integer + 7) % 7
  );
  lower_occurrence := ((first_date - anchor_date) / 7)::bigint;

  if p_to_exclusive is null then
    return int8range(lower_occurrence, null, '[)');
  end if;

  first_excluded_date := p_to_exclusive + (
    (p_weekday - extract(dow from p_to_exclusive)::integer + 7) % 7
  );
  upper_occurrence := ((first_excluded_date - anchor_date) / 7)::bigint;
  return int8range(lower_occurrence, upper_occurrence, '[)');
end
$$;

create table private.reservation_service_period_spans (
  service_period_id uuid not null
    references public.reservation_service_periods(id) on delete cascade,
  organization_id uuid not null,
  location_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  segment text not null check (segment in ('service', 'opening', 'carryover')),
  service_occurrences int8range not null check (not isempty(service_occurrences)),
  wall_clock_microseconds int8range not null
    check (not isempty(wall_clock_microseconds)),
  primary key (service_period_id, weekday, segment),
  constraint reservation_period_spans_no_overlap
    exclude using gist (
      organization_id with =,
      location_id with =,
      weekday with =,
      service_occurrences with &&,
      wall_clock_microseconds with &&
    )
);

-- A party size must resolve to at most one duration rule. This also turns a
-- concurrent pair of overlapping configuration writes into one safe failure.
alter table public.reservation_turn_rules
add constraint reservation_turn_rules_party_ranges_no_overlap
exclude using gist (
  service_period_id with =,
  int8range(min_party_size::bigint, max_party_size::bigint + 1, '[)') with &&
);

revoke all on private.reservation_service_period_spans
from public, anon, authenticated, service_role;

create function private.assert_reservation_service_period_wall_contract(
  p_timezone text,
  p_days_of_week integer[],
  p_starts_local time,
  p_ends_local time,
  p_effective_from date,
  p_effective_to date,
  p_is_active boolean
)
returns void
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  start_microseconds bigint;
  end_microseconds bigint;
  distinct_weekdays integer;
  local_today date;
  invalid_business_date date;
begin
  if p_timezone is null or btrim(p_timezone) = ''
    or p_days_of_week is null
    or cardinality(p_days_of_week) not between 1 and 7
    or p_starts_local is null or p_ends_local is null
    or p_effective_from is null or not isfinite(p_effective_from)
    or (p_effective_to is not null and not isfinite(p_effective_to))
    or (p_effective_to is not null and p_effective_to < p_effective_from)
    or p_is_active is null then
    raise exception 'A valid reservation service-period wall-time contract is required'
      using errcode = '22023';
  end if;

  select count(distinct weekday)::integer
  into distinct_weekdays
  from unnest(p_days_of_week) weekday;
  if distinct_weekdays <> cardinality(p_days_of_week)
    or exists (
      select 1 from unnest(p_days_of_week) weekday
      where weekday not between 0 and 6
    ) then
    raise exception 'Service-period weekdays must be unique values from zero through six'
      using errcode = '23514';
  end if;

  start_microseconds :=
    (extract(epoch from p_starts_local) * 1000000)::bigint;
  end_microseconds :=
    (extract(epoch from p_ends_local) * 1000000)::bigint;
  if start_microseconds < 0 or start_microseconds >= 86400000000
    or end_microseconds < 0 or end_microseconds >= 86400000000
    or start_microseconds % 60000000 <> 0
    or end_microseconds % 60000000 <> 0 then
    raise exception 'Service-period boundaries must be whole minutes from 00:00 through 23:59'
      using errcode = '23514';
  end if;

  if not p_is_active then
    return;
  end if;

  -- The first eight years catch a date-specific future configuration; the
  -- rolling eight-year window catches legacy open-ended rows. Runtime checks
  -- below remain authoritative if timezone rules change beyond that horizon.
  local_today := (statement_timestamp() at time zone p_timezone)::date;
  with validation_windows as (
    select
      p_effective_from as starts_on,
      least(
        coalesce(
          p_effective_to,
          (p_effective_from + interval '8 years')::date
        ),
        (p_effective_from + interval '8 years')::date
      ) as ends_on
    union
    select
      greatest(p_effective_from, local_today),
      least(
        coalesce(
          p_effective_to,
          (local_today + interval '8 years')::date
        ),
        (local_today + interval '8 years')::date
      )
  ),
  candidate_dates as (
    select distinct day.value::date as business_date
    from validation_windows validation_window
    cross join lateral generate_series(
      validation_window.starts_on::timestamp,
      validation_window.ends_on::timestamp,
      interval '1 day'
    ) day(value)
    where validation_window.starts_on <= validation_window.ends_on
      and extract(dow from day.value)::integer = any(p_days_of_week)
  )
  select candidate.business_date
  into invalid_business_date
  from candidate_dates candidate
  where not private.local_wall_timestamp_is_unambiguous(
      candidate.business_date + p_starts_local,
      p_timezone
    )
    or not private.local_wall_timestamp_is_unambiguous(
      candidate.business_date
        + case when p_ends_local <= p_starts_local then 1 else 0 end
        + p_ends_local,
      p_timezone
    )
  order by candidate.business_date
  limit 1;

  if invalid_business_date is not null then
    raise exception
      'Service-period boundary is ambiguous or nonexistent in % on %',
      p_timezone,
      invalid_business_date
      using errcode = '23514';
  end if;
end
$$;

create function private.rebuild_reservation_service_period_spans(
  p_service_period_id uuid
)
returns void
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  period_row public.reservation_service_periods%rowtype;
  service_weekday integer;
  carry_weekday integer;
  start_microseconds bigint;
  end_microseconds bigint;
  effective_upper date;
  opening_occurrences int8range;
  carry_occurrences int8range;
begin
  if p_service_period_id is null then
    raise exception 'A service period is required' using errcode = '22023';
  end if;

  delete from private.reservation_service_period_spans span
  where span.service_period_id = p_service_period_id;

  select *
  into period_row
  from public.reservation_service_periods period
  where period.id = p_service_period_id;
  if period_row.id is null or not period_row.is_active then
    return;
  end if;

  start_microseconds :=
    (extract(epoch from period_row.starts_local) * 1000000)::bigint;
  end_microseconds :=
    (extract(epoch from period_row.ends_local) * 1000000)::bigint;
  effective_upper := case
    when period_row.effective_to is null then null
    else period_row.effective_to + 1
  end;

  for service_weekday in
    select distinct weekday
    from unnest(period_row.days_of_week) weekday
    order by weekday
  loop
    if end_microseconds > start_microseconds then
      opening_occurrences := private.weekday_occurrence_range(
        period_row.effective_from,
        effective_upper,
        service_weekday
      );
      if not isempty(opening_occurrences) then
        insert into private.reservation_service_period_spans (
          service_period_id, organization_id, location_id, weekday,
          segment, service_occurrences, wall_clock_microseconds
        ) values (
          period_row.id, period_row.organization_id, period_row.location_id,
          service_weekday, 'service', opening_occurrences,
          int8range(start_microseconds, end_microseconds, '[)')
        );
      end if;
    else
      opening_occurrences := private.weekday_occurrence_range(
        period_row.effective_from,
        effective_upper,
        service_weekday
      );
      if start_microseconds < 86400000000
        and not isempty(opening_occurrences) then
        insert into private.reservation_service_period_spans (
          service_period_id, organization_id, location_id, weekday,
          segment, service_occurrences, wall_clock_microseconds
        ) values (
          period_row.id, period_row.organization_id, period_row.location_id,
          service_weekday, 'opening', opening_occurrences,
          int8range(start_microseconds, 86400000000, '[)')
        );
      end if;

      carry_weekday := (service_weekday + 1) % 7;
      carry_occurrences := private.weekday_occurrence_range(
        period_row.effective_from + 1,
        case when effective_upper is null then null else effective_upper + 1 end,
        carry_weekday
      );
      if end_microseconds > 0 and not isempty(carry_occurrences) then
        insert into private.reservation_service_period_spans (
          service_period_id, organization_id, location_id, weekday,
          segment, service_occurrences, wall_clock_microseconds
        ) values (
          period_row.id, period_row.organization_id, period_row.location_id,
          carry_weekday, 'carryover', carry_occurrences,
          int8range(0, end_microseconds, '[)')
        );
      end if;
    end if;
  end loop;
end
$$;

create function private.lock_reservation_service_period_configuration(
  p_organization_id uuid,
  p_location_id uuid
)
returns void
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if p_organization_id is null or p_location_id is null then
    raise exception 'Reservation service configuration lock key is required'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'reservation-service-configuration:'
      || p_organization_id::text || ':' || p_location_id::text,
    0
  ));
end
$$;

create function private.guard_reservation_service_period_time_contract()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  location_timezone text;
begin
  -- Period and timezone commands target different rows. Serialize them on one
  -- location key, then read after the lock so a waiter validates committed
  -- configuration rather than its pre-wait statement snapshot. Moves acquire
  -- both keys in canonical order.
  if tg_op = 'UPDATE'
    and (old.organization_id, old.location_id)
      is distinct from (new.organization_id, new.location_id) then
    if old.organization_id::text || ':' || old.location_id::text
      < new.organization_id::text || ':' || new.location_id::text then
      perform private.lock_reservation_service_period_configuration(
        old.organization_id, old.location_id
      );
      perform private.lock_reservation_service_period_configuration(
        new.organization_id, new.location_id
      );
    else
      perform private.lock_reservation_service_period_configuration(
        new.organization_id, new.location_id
      );
      perform private.lock_reservation_service_period_configuration(
        old.organization_id, old.location_id
      );
    end if;
  else
    perform private.lock_reservation_service_period_configuration(
      new.organization_id, new.location_id
    );
  end if;

  select location.timezone
  into location_timezone
  from public.locations location
  where location.organization_id = new.organization_id
    and location.id = new.location_id
  ;
  if location_timezone is null then
    raise exception 'Reservation location not found' using errcode = 'P0002';
  end if;

  perform private.assert_reservation_service_period_wall_contract(
    location_timezone,
    new.days_of_week,
    new.starts_local,
    new.ends_local,
    new.effective_from,
    new.effective_to,
    new.is_active
  );
  return new;
end
$$;

create function private.sync_reservation_service_period_spans()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if tg_op = 'DELETE' then
    delete from private.reservation_service_period_spans span
    where span.service_period_id = old.id;
    return old;
  end if;

  perform private.rebuild_reservation_service_period_spans(new.id);
  return new;
end
$$;

create function private.guard_location_reservation_timezone()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  period_row public.reservation_service_periods%rowtype;
begin
  perform private.lock_reservation_service_period_configuration(
    new.organization_id, new.id
  );

  for period_row in
    select period.*
    from public.reservation_service_periods period
    where period.organization_id = new.organization_id
      and period.location_id = new.id
      and period.is_active
    order by period.id
  loop
    perform private.assert_reservation_service_period_wall_contract(
      new.timezone,
      period_row.days_of_week,
      period_row.starts_local,
      period_row.ends_local,
      period_row.effective_from,
      period_row.effective_to,
      period_row.is_active
    );
  end loop;
  return new;
end
$$;

create function private.lock_reservation_turn_rule_period()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if tg_op = 'INSERT' then
    perform period.id
    from public.reservation_service_periods period
    where period.id = new.service_period_id
    for update;
  elsif tg_op = 'DELETE' then
    perform period.id
    from public.reservation_service_periods period
    where period.id = old.service_period_id
    for update;
  else
    perform period.id
    from public.reservation_service_periods period
    where period.id = old.service_period_id
       or period.id = new.service_period_id
    order by period.id
    for update;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger reservation_service_period_time_contract
before insert or update of
  organization_id, location_id, days_of_week, starts_local, ends_local,
  effective_from, effective_to, is_active
on public.reservation_service_periods
for each row execute function
  private.guard_reservation_service_period_time_contract();

create trigger reservation_service_period_span_sync
after insert or update of
  organization_id, location_id, days_of_week, starts_local, ends_local,
  effective_from, effective_to, is_active
or delete on public.reservation_service_periods
for each row execute function private.sync_reservation_service_period_spans();

create trigger location_reservation_timezone_contract
before update of timezone on public.locations
for each row
when (old.timezone is distinct from new.timezone)
execute function private.guard_location_reservation_timezone();

create trigger reservation_turn_rule_parent_lock
before insert or update or delete on public.reservation_turn_rules
for each row execute function private.lock_reservation_turn_rule_period();

-- Refuse to install the invariant over unsafe or overlapping legacy rows.
-- These draft migrations are not expected on a shared database; if that
-- assumption changes, this failure is a truthful forward-migration gate.
do $$
declare
  period_row public.reservation_service_periods%rowtype;
  location_timezone text;
begin
  for period_row in
    select period.*
    from public.reservation_service_periods period
    order by period.organization_id, period.location_id, period.id
  loop
    select location.timezone
    into location_timezone
    from public.locations location
    where location.organization_id = period_row.organization_id
      and location.id = period_row.location_id;
    perform private.assert_reservation_service_period_wall_contract(
      location_timezone,
      period_row.days_of_week,
      period_row.starts_local,
      period_row.ends_local,
      period_row.effective_from,
      period_row.effective_to,
      period_row.is_active
    );
    perform private.rebuild_reservation_service_period_spans(period_row.id);
  end loop;
end
$$;

-- Ignore unsafe service boundaries at read time even if timezone rules change
-- after configuration. An ambiguous observed wall time is never classified as
-- an online reservation service.
create or replace function private.resolve_service_day_context(
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
        candidate.candidate_date + period.starts_local as local_starts_at,
        candidate.candidate_date
          + case when period.ends_local <= period.starts_local then 1 else 0 end
          + period.ends_local as local_ends_at
    ) local_boundary
    cross join lateral (
      select
        local_boundary.local_starts_at at time zone location_timezone
          as starts_at,
        local_boundary.local_ends_at at time zone location_timezone
          as ends_at
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
      and private.local_wall_timestamp_is_unambiguous(
        local_boundary.local_starts_at,
        location_timezone
      )
      and private.local_wall_timestamp_is_unambiguous(
        local_boundary.local_ends_at,
        location_timezone
      )
      and private.local_wall_timestamp_is_unambiguous(
        p_observed_at at time zone location_timezone,
        location_timezone
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

create function private.assert_public_reservation_slot_contract(
  p_organization_id uuid,
  p_location_id uuid,
  p_starts_at timestamptz,
  p_duration_minutes integer,
  p_party_size integer
)
returns void
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  location_timezone text;
  observed_calendar_date date;
  locked_business_date date;
  service_period_uuid uuid;
  service_ends_at timestamptz;
  service_row public.reservation_service_periods%rowtype;
  authoritative_duration integer;
begin
  if p_organization_id is null or p_location_id is null
    or p_starts_at is null or p_duration_minutes not between 15 and 720
    or p_party_size not between 1 and 100 then
    raise exception 'A valid public reservation slot is required'
      using errcode = '22023';
  end if;

  select location.timezone
  into location_timezone
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id
    and location.is_active
  for share;
  if location_timezone is null
    or not private.local_wall_timestamp_is_unambiguous(
      p_starts_at at time zone location_timezone,
      location_timezone
    ) then
    raise exception 'The reservation wall time is unavailable'
      using errcode = '23514';
  end if;

  select context.service_period_id, context.ends_at
  into service_period_uuid, service_ends_at
  from private.resolve_service_day_context(
    p_organization_id,
    p_location_id,
    p_starts_at,
    true
  ) context;
  if service_period_uuid is null or service_ends_at is null then
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
  if service_row.id is null
    or p_party_size < service_row.min_party_size
    or p_party_size > service_row.max_party_size then
    raise exception 'That party size is unavailable for this service period'
      using errcode = '23514';
  end if;

  -- The resolver read preceded the row lock. Re-derive the interval directly
  -- from the locked row so a concurrent configuration edit cannot make a
  -- stale signed token pass under the statement's earlier snapshot.
  observed_calendar_date :=
    (p_starts_at at time zone location_timezone)::date;
  select candidate.candidate_date, boundary.ends_at
  into locked_business_date, service_ends_at
  from (values
    (observed_calendar_date),
    (observed_calendar_date - 1)
  ) candidate(candidate_date)
  cross join lateral (
    select
      candidate.candidate_date + service_row.starts_local as local_starts_at,
      candidate.candidate_date
        + case when service_row.ends_local <= service_row.starts_local
            then 1 else 0 end
        + service_row.ends_local as local_ends_at
  ) local_boundary
  cross join lateral (
    select
      local_boundary.local_starts_at at time zone location_timezone
        as starts_at,
      local_boundary.local_ends_at at time zone location_timezone
        as ends_at
  ) boundary
  where extract(dow from candidate.candidate_date)::integer
      = any(service_row.days_of_week)
    and candidate.candidate_date >= service_row.effective_from
    and (
      service_row.effective_to is null
      or candidate.candidate_date <= service_row.effective_to
    )
    and private.local_wall_timestamp_is_unambiguous(
      local_boundary.local_starts_at,
      location_timezone
    )
    and private.local_wall_timestamp_is_unambiguous(
      local_boundary.local_ends_at,
      location_timezone
    )
    and p_starts_at >= boundary.starts_at
    and p_starts_at < boundary.ends_at
  order by boundary.starts_at desc
  limit 1;
  if locked_business_date is null or service_ends_at is null then
    raise exception 'The signed slot no longer matches the active service policy'
      using errcode = '23514';
  end if;

  select coalesce(rule.duration_minutes, service_row.default_duration_minutes)
  into authoritative_duration
  from (select true) seed
  left join lateral (
    select turn.duration_minutes
    from public.reservation_turn_rules turn
    where turn.organization_id = p_organization_id
      and turn.service_period_id = service_row.id
      and p_party_size between turn.min_party_size and turn.max_party_size
    order by turn.min_party_size, turn.max_party_size, turn.id
    limit 1
  ) rule on true;

  if p_duration_minutes <> authoritative_duration
    or p_starts_at + make_interval(mins => p_duration_minutes)
      > service_ends_at then
    raise exception 'The signed slot no longer matches the active service policy'
      using errcode = '23514';
  end if;
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
  location_timezone text;
  observed_calendar_date date;
  locked_business_date date;
  service_period_uuid uuid;
  service_row public.reservation_service_periods%rowtype;
  existing_covers integer;
begin
  if p_organization_id is null or p_location_id is null
    or p_starts_at is null or p_party_size not between 1 and 100 then
    raise exception 'A valid pacing request is required' using errcode = '22023';
  end if;

  select location.timezone
  into location_timezone
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id
    and location.is_active
  for share;
  if location_timezone is null then
    raise exception 'Reservation location not found' using errcode = 'P0002';
  end if;
  if not private.local_wall_timestamp_is_unambiguous(
    p_starts_at at time zone location_timezone,
    location_timezone
  ) then
    raise exception 'Ambiguous reservation wall times are unavailable'
      using errcode = '23514';
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
  observed_calendar_date :=
    (p_starts_at at time zone location_timezone)::date;
  select candidate.candidate_date
  into locked_business_date
  from (values
    (observed_calendar_date),
    (observed_calendar_date - 1)
  ) candidate(candidate_date)
  cross join lateral (
    select
      candidate.candidate_date + service_row.starts_local as local_starts_at,
      candidate.candidate_date
        + case when service_row.ends_local <= service_row.starts_local
            then 1 else 0 end
        + service_row.ends_local as local_ends_at
  ) local_boundary
  cross join lateral (
    select
      local_boundary.local_starts_at at time zone location_timezone
        as starts_at,
      local_boundary.local_ends_at at time zone location_timezone
        as ends_at
  ) boundary
  where extract(dow from candidate.candidate_date)::integer
      = any(service_row.days_of_week)
    and candidate.candidate_date >= service_row.effective_from
    and (
      service_row.effective_to is null
      or candidate.candidate_date <= service_row.effective_to
    )
    and private.local_wall_timestamp_is_unambiguous(
      local_boundary.local_starts_at,
      location_timezone
    )
    and private.local_wall_timestamp_is_unambiguous(
      local_boundary.local_ends_at,
      location_timezone
    )
    and p_starts_at >= boundary.starts_at
    and p_starts_at < boundary.ends_at
  order by boundary.starts_at desc
  limit 1;
  if locked_business_date is null then
    raise exception 'No online service is configured for the requested time'
      using errcode = '23514';
  end if;
  if p_party_size < service_row.min_party_size
    or p_party_size > service_row.max_party_size then
    raise exception 'That party size is unavailable for this service period'
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

create function private.enforce_public_booking_hold_service_contract()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status <> 'pending' then
    return new;
  end if;
  perform private.assert_public_reservation_slot_contract(
    new.organization_id,
    new.location_id,
    new.reserved_at,
    new.duration_minutes,
    new.party_size
  );
  return new;
end
$$;

create trigger public_booking_holds_service_contract
before insert or update of
  reserved_at, duration_minutes, party_size, status
on private.public_booking_holds
for each row execute function
  private.enforce_public_booking_hold_service_contract();

create or replace function private.enforce_public_reservation_pacing()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.booking_channel <> 'web'
    or new.status in ('cancelled', 'no_show', 'completed') then
    return new;
  end if;
  perform private.assert_public_reservation_slot_contract(
    new.organization_id,
    new.location_id,
    new.reserved_at,
    new.duration_minutes,
    new.party_size
  );
  perform private.assert_reservation_pacing(
    new.organization_id,
    new.location_id,
    new.reserved_at,
    new.party_size,
    new.id,
    null
  );
  return new;
end
$$;

drop trigger reservations_public_pacing_guard on public.reservations;
create trigger reservations_public_pacing_guard
before insert or update of reserved_at, duration_minutes, party_size, status
on public.reservations
for each row execute function private.enforce_public_reservation_pacing();

revoke all on function private.local_wall_timestamp_is_unambiguous(timestamp without time zone, text)
from public, anon, authenticated, service_role;
revoke all on function private.weekday_occurrence_range(date, date, integer)
from public, anon, authenticated, service_role;
revoke all on function private.assert_reservation_service_period_wall_contract(text, integer[], time, time, date, date, boolean)
from public, anon, authenticated, service_role;
revoke all on function private.lock_reservation_service_period_configuration(uuid, uuid)
from public, anon, authenticated, service_role;
revoke all on function private.rebuild_reservation_service_period_spans(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.guard_reservation_service_period_time_contract()
from public, anon, authenticated, service_role;
revoke all on function private.sync_reservation_service_period_spans()
from public, anon, authenticated, service_role;
revoke all on function private.guard_location_reservation_timezone()
from public, anon, authenticated, service_role;
revoke all on function private.lock_reservation_turn_rule_period()
from public, anon, authenticated, service_role;
revoke all on function private.assert_public_reservation_slot_contract(uuid, uuid, timestamptz, integer, integer)
from public, anon, authenticated, service_role;
revoke all on function private.enforce_public_booking_hold_service_contract()
from public, anon, authenticated, service_role;

comment on table private.reservation_service_period_spans is
  'Command-maintained recurring wall-clock spans. The exclusion constraint is the authoritative non-overlap invariant for active reservation service periods.';
comment on function private.local_wall_timestamp_is_unambiguous(timestamp without time zone, text) is
  'True only when exactly one UTC instant maps to the supplied location-local wall timestamp; DST gaps and folds return false.';
comment on function private.lock_reservation_service_period_configuration(uuid, uuid) is
  'Serializes service-period and location-timezone configuration for one tenant location so post-lock validation sees one committed contract.';
