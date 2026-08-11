-- Dated operating-service evidence. Recurring reservation_service_periods are
-- authoring configuration; public availability and writes consume these rows.

create table public.service_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  business_date date not null,
  service_period_id uuid not null,
  name text not null check (length(btrim(name)) between 1 and 80),
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  default_duration_minutes integer not null check (default_duration_minutes between 15 and 720),
  pacing_interval_minutes integer not null check (pacing_interval_minutes in (5,10,15,20,30,60)),
  pacing_cover_limit integer not null check (pacing_cover_limit > 0),
  min_party_size integer not null check (min_party_size > 0),
  max_party_size integer not null check (max_party_size >= min_party_size),
  online_enabled boolean not null default false,
  status text not null default 'scheduled' check (status in ('scheduled','cancelled')),
  configuration_state text not null check (configuration_state in ('approved','internal')),
  source_updated_at timestamptz not null,
  materialized_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, service_period_id)
    references public.reservation_service_periods(organization_id, id) on delete cascade,
  unique (organization_id, location_id, business_date, service_period_id),
  unique (organization_id, location_id, id),
  check (ends_at > starts_at)
);

create table public.service_shift_exceptions (
  id uuid primary key,
  organization_id uuid not null,
  location_id uuid not null,
  service_shift_id uuid not null,
  exception_kind text not null check (exception_kind in ('closure','pacing_override','buffer_override')),
  status text not null default 'active' check (status in ('active','revoked')),
  effective_starts_at timestamptz not null,
  effective_ends_at timestamptz not null,
  effective_range tstzrange generated always as
    (tstzrange(effective_starts_at, effective_ends_at, '[)')) stored,
  pacing_interval_minutes integer check (pacing_interval_minutes in (5,10,15,20,30,60)),
  pacing_cover_limit integer check (pacing_cover_limit > 0),
  opening_buffer_minutes integer check (opening_buffer_minutes between 0 and 360),
  closing_buffer_minutes integer check (closing_buffer_minutes between 0 and 360),
  reason text not null check (length(btrim(reason)) between 4 and 1000),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default clock_timestamp(),
  revoked_by uuid references auth.users(id) on delete restrict,
  revoked_at timestamptz,
  updated_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id, service_shift_id)
    references public.service_shifts(organization_id, location_id, id) on delete cascade,
  unique (organization_id, location_id, id),
  check (effective_ends_at > effective_starts_at),
  check (
    (status = 'active' and revoked_at is null and revoked_by is null)
    or (status = 'revoked' and revoked_at is not null and revoked_by is not null)
  ),
  check (
    (exception_kind = 'closure' and pacing_interval_minutes is null
      and pacing_cover_limit is null and opening_buffer_minutes is null
      and closing_buffer_minutes is null)
    or (exception_kind = 'pacing_override' and pacing_interval_minutes is not null
      and pacing_cover_limit is not null and opening_buffer_minutes is null
      and closing_buffer_minutes is null)
    or (exception_kind = 'buffer_override' and pacing_interval_minutes is null
      and pacing_cover_limit is null and opening_buffer_minutes is not null
      and closing_buffer_minutes is not null)
  )
);

create index service_shifts_location_date_idx
on public.service_shifts (organization_id, location_id, business_date, starts_at);
create index service_shifts_active_interval_idx
on public.service_shifts (organization_id, location_id, starts_at, ends_at)
where status = 'scheduled';
create index service_shift_exceptions_shift_status_idx
on public.service_shift_exceptions
  (organization_id, location_id, service_shift_id, exception_kind, effective_starts_at)
where status = 'active';

alter table public.service_shift_exceptions
add constraint service_shift_pacing_override_no_overlap
exclude using gist (service_shift_id with =, effective_range with &&)
where (status = 'active' and exception_kind = 'pacing_override');
create unique index service_shift_one_active_buffer_override_idx
on public.service_shift_exceptions (service_shift_id)
where status = 'active' and exception_kind = 'buffer_override';

alter table public.service_shifts enable row level security;
alter table public.service_shifts force row level security;
alter table public.service_shift_exceptions enable row level security;
alter table public.service_shift_exceptions force row level security;
revoke all on public.service_shifts, public.service_shift_exceptions
from public, anon, authenticated;
create policy service_shifts_capability_read
on public.service_shifts for select to authenticated
using ((select public.has_any_capability(organization_id, location_id,
  array['reservations.view','reservations.operate','reservations.override','reservations.configure']::text[])));
create policy service_shift_exceptions_capability_read
on public.service_shift_exceptions for select to authenticated
using ((select public.has_any_capability(organization_id, location_id,
  array['reservations.view','reservations.operate','reservations.override','reservations.configure']::text[])));
grant select on public.service_shifts, public.service_shift_exceptions to authenticated;

create function private.ensure_service_shifts(
  p_organization_id uuid,
  p_location_id uuid,
  p_business_dates date[]
)
returns void
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  location_timezone text;
  target_date date;
begin
  if p_organization_id is null or p_location_id is null
    or p_business_dates is null or cardinality(p_business_dates) not between 1 and 8
    or exists (select 1 from unnest(p_business_dates) value where value is null) then
    raise exception 'A valid service-shift materialization scope is required'
      using errcode = '22023';
  end if;
  perform private.lock_reservation_service_period_configuration(p_organization_id, p_location_id);
  select location.timezone into location_timezone
  from public.locations location
  where location.organization_id = p_organization_id and location.id = p_location_id
    and location.is_active
  for share;
  if location_timezone is null then
    raise exception 'Reservation location not found' using errcode = 'P0002';
  end if;

  for target_date in
    select distinct value from unnest(p_business_dates) value order by value
  loop
    update public.service_shifts service_shift
    set status = 'cancelled', updated_at = clock_timestamp()
    where service_shift.organization_id = p_organization_id
      and service_shift.location_id = p_location_id
      and service_shift.business_date = target_date
      and service_shift.status = 'scheduled'
      and not exists (
        select 1 from public.reservation_service_periods period
        where period.organization_id = p_organization_id
          and period.location_id = p_location_id
          and period.id = service_shift.service_period_id and period.is_active
          and extract(dow from target_date)::integer = any(period.days_of_week)
          and target_date >= period.effective_from
          and (period.effective_to is null or target_date <= period.effective_to)
      );

    insert into public.service_shifts (
      organization_id, location_id, business_date, service_period_id, name,
      starts_at, ends_at, default_duration_minutes, pacing_interval_minutes,
      pacing_cover_limit, min_party_size, max_party_size, online_enabled,
      status, configuration_state, source_updated_at, materialized_at, updated_at
    )
    select period.organization_id, period.location_id, target_date, period.id,
      period.name, boundary.starts_at, boundary.ends_at,
      period.default_duration_minutes, period.pacing_interval_minutes,
      period.pacing_cover_limit, period.min_party_size, period.max_party_size,
      period.online_enabled and period.approved_at is not null, 'scheduled',
      case when period.approved_at is not null then 'approved' else 'internal' end,
      period.updated_at, clock_timestamp(), clock_timestamp()
    from public.reservation_service_periods period
    cross join lateral (
      select (target_date + period.starts_local) at time zone location_timezone starts_at,
        (target_date + case when period.ends_local <= period.starts_local then 1 else 0 end
          + period.ends_local) at time zone location_timezone ends_at
    ) boundary
    where period.organization_id = p_organization_id
      and period.location_id = p_location_id and period.is_active
      and extract(dow from target_date)::integer = any(period.days_of_week)
      and target_date >= period.effective_from
      and (period.effective_to is null or target_date <= period.effective_to)
      and private.local_wall_timestamp_is_unambiguous(
        target_date + period.starts_local, location_timezone)
      and private.local_wall_timestamp_is_unambiguous(
        target_date + case when period.ends_local <= period.starts_local then 1 else 0 end
          + period.ends_local, location_timezone)
    on conflict (organization_id, location_id, business_date, service_period_id)
    do update set name = excluded.name, starts_at = excluded.starts_at,
      ends_at = excluded.ends_at,
      default_duration_minutes = excluded.default_duration_minutes,
      pacing_interval_minutes = excluded.pacing_interval_minutes,
      pacing_cover_limit = excluded.pacing_cover_limit,
      min_party_size = excluded.min_party_size, max_party_size = excluded.max_party_size,
      online_enabled = excluded.online_enabled, status = 'scheduled',
      configuration_state = excluded.configuration_state,
      source_updated_at = excluded.source_updated_at,
      materialized_at = excluded.materialized_at, updated_at = excluded.updated_at;
  end loop;
end
$$;

create function private.service_shift_effective_policy(
  p_service_shift_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz default null
)
returns table (
  is_closed boolean,
  pacing_interval_minutes integer,
  pacing_cover_limit integer,
  opening_buffer_minutes integer,
  closing_buffer_minutes integer
)
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
      select 1 from public.service_shift_exceptions exception
      where exception.service_shift_id = service_shift.id
        and exception.status = 'active' and exception.exception_kind = 'closure'
        and exception.effective_range && tstzrange(
          p_starts_at, coalesce(p_ends_at, p_starts_at + interval '1 microsecond'), '[)')
    ),
    coalesce(pacing.pacing_interval_minutes, service_shift.pacing_interval_minutes),
    coalesce(pacing.pacing_cover_limit, service_shift.pacing_cover_limit),
    coalesce(buffer.opening_buffer_minutes, 0),
    coalesce(buffer.closing_buffer_minutes, 0)
  from public.service_shifts service_shift
  left join lateral (
    select exception.pacing_interval_minutes, exception.pacing_cover_limit
    from public.service_shift_exceptions exception
    where exception.service_shift_id = service_shift.id
      and exception.status = 'active' and exception.exception_kind = 'pacing_override'
      and p_starts_at <@ exception.effective_range
    order by exception.effective_starts_at desc, exception.id limit 1
  ) pacing on true
  left join lateral (
    select exception.opening_buffer_minutes, exception.closing_buffer_minutes
    from public.service_shift_exceptions exception
    where exception.service_shift_id = service_shift.id
      and exception.status = 'active' and exception.exception_kind = 'buffer_override'
    order by exception.created_at desc, exception.id limit 1
  ) buffer on true
  where service_shift.id = p_service_shift_id
$$;

create function private.guard_service_shift_exception_bounds()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if exists (
    select 1 from public.service_shift_exceptions exception
    where exception.service_shift_id = new.id and exception.status = 'active'
      and (exception.effective_starts_at < new.starts_at
        or exception.effective_ends_at > new.ends_at)
  ) then
    raise exception 'Revoke or replace service exceptions before changing this service boundary'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger service_shift_exception_bounds
before update of starts_at, ends_at on public.service_shifts
for each row execute function private.guard_service_shift_exception_bounds();

create function public.configure_service_shift_exception(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_service_shift_id uuid,
  p_exception_kind text,
  p_effective_starts_at timestamptz,
  p_effective_ends_at timestamptz,
  p_pacing_interval_minutes integer,
  p_pacing_cover_limit integer,
  p_opening_buffer_minutes integer,
  p_closing_buffer_minutes integer,
  p_reason text,
  p_active boolean default true
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  service_shift public.service_shifts%rowtype;
  exception_row public.service_shift_exceptions%rowtype;
  claimed boolean;
begin
  if actor_id is null or p_request_id is null or p_organization_id is null
    or p_location_id is null or p_service_shift_id is null
    or p_exception_kind not in ('closure','pacing_override','buffer_override')
    or p_effective_starts_at is null or p_effective_ends_at is null
    or p_effective_ends_at <= p_effective_starts_at
    or length(btrim(coalesce(p_reason, ''))) not between 4 and 1000
    or p_active is null then
    raise exception 'A valid service-shift exception is required' using errcode = '22023';
  end if;
  select shift.* into service_shift
  from public.service_shifts shift
  where shift.organization_id = p_organization_id
    and shift.location_id = p_location_id and shift.id = p_service_shift_id
  for update;
  if service_shift.id is null then
    raise exception 'Service shift not found' using errcode = 'P0002';
  end if;
  if not private.user_has_capability(
    actor_id, p_organization_id, p_location_id,
    'reservations.override', service_shift.business_date
  ) then
    raise exception 'Reservation override access is required' using errcode = '42501';
  end if;
  if p_effective_starts_at < service_shift.starts_at
    or p_effective_ends_at > service_shift.ends_at then
    raise exception 'The exception must stay inside its service shift' using errcode = '23514';
  end if;
  if p_exception_kind = 'closure' and (
      p_pacing_interval_minutes is not null or p_pacing_cover_limit is not null
      or p_opening_buffer_minutes is not null or p_closing_buffer_minutes is not null
    ) then
    raise exception 'Closure fields are invalid' using errcode = '22023';
  elsif p_exception_kind = 'pacing_override' and (
      p_pacing_interval_minutes not in (5,10,15,20,30,60)
      or p_pacing_cover_limit is null or p_pacing_cover_limit <= 0
      or p_opening_buffer_minutes is not null or p_closing_buffer_minutes is not null
    ) then
    raise exception 'Pacing override fields are invalid' using errcode = '22023';
  elsif p_exception_kind = 'buffer_override' and (
      p_pacing_interval_minutes is not null or p_pacing_cover_limit is not null
      or p_opening_buffer_minutes not between 0 and 360
      or p_closing_buffer_minutes not between 0 and 360
      or p_effective_starts_at <> service_shift.starts_at
      or p_effective_ends_at <> service_shift.ends_at
    ) then
    raise exception 'Buffer override fields are invalid' using errcode = '22023';
  end if;
  claimed := private.claim_operation_request(
    p_request_id, 'service-shift.exception.configure', p_organization_id,
    p_location_id, p_service_shift_id,
    jsonb_build_object(
      'kind', p_exception_kind, 'startsAt', p_effective_starts_at,
      'endsAt', p_effective_ends_at,
      'pacingIntervalMinutes', p_pacing_interval_minutes,
      'pacingCoverLimit', p_pacing_cover_limit,
      'openingBufferMinutes', p_opening_buffer_minutes,
      'closingBufferMinutes', p_closing_buffer_minutes,
      'reason', btrim(p_reason), 'active', p_active
    )
  );
  if not claimed then
    select exception.* into exception_row
    from public.service_shift_exceptions exception
    where exception.id = p_request_id
      and exception.organization_id = p_organization_id
      and exception.location_id = p_location_id
      and exception.service_shift_id = p_service_shift_id;
    if exception_row.id is null then
      raise exception 'Completed service-shift request has no result' using errcode = '40001';
    end if;
    return to_jsonb(exception_row) || jsonb_build_object('replayed', true);
  end if;
  insert into public.service_shift_exceptions (
    id, organization_id, location_id, service_shift_id, exception_kind, status,
    effective_starts_at, effective_ends_at, pacing_interval_minutes,
    pacing_cover_limit, opening_buffer_minutes, closing_buffer_minutes,
    reason, created_by, revoked_by, revoked_at
  ) values (
    p_request_id, p_organization_id, p_location_id, p_service_shift_id,
    p_exception_kind, case when p_active then 'active' else 'revoked' end,
    p_effective_starts_at, p_effective_ends_at, p_pacing_interval_minutes,
    p_pacing_cover_limit, p_opening_buffer_minutes, p_closing_buffer_minutes,
    btrim(p_reason), actor_id, case when p_active then null else actor_id end,
    case when p_active then null else clock_timestamp() end
  ) returning * into exception_row;
  insert into public.audit_events (
    organization_id, location_id, action, table_name, record_id,
    old_record, new_record, metadata
  ) values (
    p_organization_id, p_location_id, 'service_shift_exception_created',
    'service_shift_exceptions', exception_row.id::text, null,
    jsonb_build_object('kind', exception_row.exception_kind, 'status', exception_row.status),
    jsonb_build_object('serviceShiftId', p_service_shift_id, 'reason', btrim(p_reason))
  );
  perform private.complete_operation_request(p_request_id);
  return to_jsonb(exception_row) || jsonb_build_object('replayed', false);
end
$$;

create function public.revoke_service_shift_exception(
  p_request_id uuid,
  p_exception_id uuid,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  exception_row public.service_shift_exceptions%rowtype;
  service_shift public.service_shifts%rowtype;
  claimed boolean;
begin
  if actor_id is null or p_request_id is null or p_exception_id is null
    or length(btrim(coalesce(p_reason, ''))) not between 4 and 1000 then
    raise exception 'A valid service-shift revocation is required' using errcode = '22023';
  end if;
  select exception.* into exception_row
  from public.service_shift_exceptions exception
  where exception.id = p_exception_id;
  if exception_row.id is null then
    raise exception 'Service-shift exception not found' using errcode = 'P0002';
  end if;
  select shift.* into service_shift from public.service_shifts shift
  where shift.id = exception_row.service_shift_id for update;
  if service_shift.id is null or not private.user_has_capability(
    actor_id, exception_row.organization_id, exception_row.location_id,
    'reservations.override', service_shift.business_date
  ) then
    raise exception 'Reservation override access is required' using errcode = '42501';
  end if;
  select exception.* into exception_row
  from public.service_shift_exceptions exception
  where exception.id = p_exception_id
    and exception.organization_id = service_shift.organization_id
    and exception.location_id = service_shift.location_id
    and exception.service_shift_id = service_shift.id
  for update;
  if exception_row.id is null then
    raise exception 'Service-shift exception changed during revocation'
      using errcode = '40001';
  end if;
  claimed := private.claim_operation_request(
    p_request_id, 'service-shift.exception.revoke', exception_row.organization_id,
    exception_row.location_id, exception_row.id,
    jsonb_build_object('exceptionId', p_exception_id, 'reason', btrim(p_reason))
  );
  if not claimed then
    return to_jsonb(exception_row) || jsonb_build_object('replayed', true);
  end if;
  if exception_row.status <> 'revoked' then
    update public.service_shift_exceptions exception
    set status = 'revoked', revoked_by = actor_id, revoked_at = clock_timestamp(),
      updated_at = clock_timestamp()
    where exception.id = exception_row.id
    returning * into exception_row;
    insert into public.audit_events (
      organization_id, location_id, action, table_name, record_id,
      old_record, new_record, metadata
    ) values (
      exception_row.organization_id, exception_row.location_id,
      'service_shift_exception_revoked', 'service_shift_exceptions',
      exception_row.id::text, jsonb_build_object('status', 'active'),
      jsonb_build_object('status', 'revoked'),
      jsonb_build_object('serviceShiftId', exception_row.service_shift_id, 'reason', btrim(p_reason))
    );
  end if;
  perform private.complete_operation_request(p_request_id);
  return to_jsonb(exception_row) || jsonb_build_object('replayed', false);
end
$$;

create function public.service_reservation_shift_snapshot(
  p_organization_id uuid,
  p_location_id uuid,
  p_business_date date
)
returns table (
  "shiftId" uuid,
  "servicePeriodId" uuid,
  name text,
  "businessDate" date,
  "startsAt" timestamptz,
  "endsAt" timestamptz,
  "defaultDurationMinutes" integer,
  "pacingIntervalMinutes" integer,
  "pacingCoverLimit" integer,
  "minPartySize" integer,
  "maxPartySize" integer,
  "onlineEnabled" boolean,
  status text,
  "configurationState" text,
  exceptions jsonb
)
language plpgsql volatile security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  service_actor boolean := coalesce(auth.jwt() ->> 'role', '') = 'service_role';
  effective_on date;
begin
  select (statement_timestamp() at time zone location.timezone)::date
  into effective_on
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id and location.is_active;
  if effective_on is null or p_business_date is null
    or p_business_date < effective_on - 1 or p_business_date > effective_on + 400
    or (not service_actor and (
      actor_id is null or not (
        private.user_has_capability(actor_id, p_organization_id, p_location_id, 'reservations.view', effective_on)
        or private.user_has_capability(actor_id, p_organization_id, p_location_id, 'reservations.operate', effective_on)
        or private.user_has_capability(actor_id, p_organization_id, p_location_id, 'reservations.override', effective_on)
        or private.user_has_capability(actor_id, p_organization_id, p_location_id, 'reservations.configure', effective_on)
      )
    )) then
    raise exception 'Service-shift access is required' using errcode = '42501';
  end if;
  perform private.ensure_service_shifts(p_organization_id, p_location_id, array[p_business_date]);
  return query
  select shift.id, shift.service_period_id, shift.name, shift.business_date,
    shift.starts_at, shift.ends_at, shift.default_duration_minutes,
    shift.pacing_interval_minutes, shift.pacing_cover_limit,
    shift.min_party_size, shift.max_party_size, shift.online_enabled,
    shift.status, shift.configuration_state,
    coalesce((
      select jsonb_agg(jsonb_build_object(
        'id', exception.id, 'kind', exception.exception_kind,
        'status', exception.status, 'startsAt', exception.effective_starts_at,
        'endsAt', exception.effective_ends_at,
        'pacingIntervalMinutes', exception.pacing_interval_minutes,
        'pacingCoverLimit', exception.pacing_cover_limit,
        'openingBufferMinutes', exception.opening_buffer_minutes,
        'closingBufferMinutes', exception.closing_buffer_minutes,
        'reason', exception.reason
      ) order by exception.effective_starts_at, exception.id)
      from public.service_shift_exceptions exception
      where exception.service_shift_id = shift.id and exception.status = 'active'
    ), '[]'::jsonb)
  from public.service_shifts shift
  where shift.organization_id = p_organization_id and shift.location_id = p_location_id
    and shift.business_date = p_business_date
  order by shift.starts_at, shift.id;
end
$$;

create or replace function public.service_day_business_date(
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
language plpgsql volatile security definer
set search_path = ''
set row_security = off
as $$
declare
  calendar_date date;
  location_timezone text;
begin
  select (p_observed_at at time zone location.timezone)::date, location.timezone
  into calendar_date, location_timezone
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id and location.is_active;
  if auth.uid() is null or calendar_date is null
    or not public.can_access_location(p_organization_id, p_location_id) then
    raise exception 'Service-day access is required' using errcode = '42501';
  end if;
  perform private.ensure_service_shifts(
    p_organization_id, p_location_id, array[calendar_date - 1, calendar_date]
  );
  return query
  with materialized as (
    select shift.business_date, shift.service_period_id, shift.name,
      shift.starts_at, shift.ends_at, policy.pacing_interval_minutes,
      policy.pacing_cover_limit,
      case when policy.is_closed then 'closed' else shift.configuration_state end configuration_state
    from public.service_shifts shift
    cross join lateral private.service_shift_effective_policy(
      shift.id, p_observed_at, p_observed_at + interval '1 microsecond'
    ) policy
    where shift.organization_id = p_organization_id
      and shift.location_id = p_location_id and shift.status = 'scheduled'
      and p_observed_at >= shift.starts_at and p_observed_at < shift.ends_at
      and private.local_wall_timestamp_is_unambiguous(
        p_observed_at at time zone location_timezone,
        location_timezone
      )
    order by shift.starts_at desc, shift.id
    limit 1
  ), fallback as (
    select context.*
    from private.resolve_service_day_context(
      p_organization_id, p_location_id, p_observed_at, false
    ) context
    where not exists (select 1 from materialized)
  )
  select materialized.business_date, calendar_date, location_timezone,
    'materialized_service_shift'::text, materialized.service_period_id,
    materialized.name, materialized.starts_at, materialized.ends_at,
    materialized.pacing_interval_minutes, materialized.pacing_cover_limit,
    materialized.configuration_state
  from materialized
  union all
  select fallback.business_date, fallback.calendar_date, fallback.time_zone,
    fallback.source, fallback.service_period_id, fallback.service_name,
    fallback.starts_at, fallback.ends_at, fallback.pacing_interval_minutes,
    fallback.pacing_cover_limit, fallback.configuration_state
  from fallback;
end
$$;

create or replace function private.assert_public_reservation_slot_contract(
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
  calendar_date date;
  location_timezone text;
  service_shift public.service_shifts%rowtype;
  policy record;
  authoritative_duration integer;
begin
  select (p_starts_at at time zone location.timezone)::date, location.timezone
  into calendar_date, location_timezone
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id and location.is_active;
  if calendar_date is null or p_duration_minutes not between 15 and 720
    or p_party_size not between 1 and 100 then
    raise exception 'A valid public reservation slot is required' using errcode = '22023';
  end if;
  if not private.local_wall_timestamp_is_unambiguous(
    p_starts_at at time zone location_timezone, location_timezone
  ) then
    raise exception 'The reservation wall time is unavailable' using errcode = '23514';
  end if;
  perform private.ensure_service_shifts(
    p_organization_id, p_location_id, array[calendar_date - 1, calendar_date]
  );
  select shift.* into service_shift
  from public.service_shifts shift
  where shift.organization_id = p_organization_id and shift.location_id = p_location_id
    and shift.status = 'scheduled' and shift.online_enabled
    and p_starts_at >= shift.starts_at and p_starts_at < shift.ends_at
  order by shift.starts_at desc, shift.id limit 1 for update;
  if service_shift.id is null
    or p_party_size not between service_shift.min_party_size and service_shift.max_party_size then
    raise exception 'No online service is configured for the requested time' using errcode = '23514';
  end if;
  select * into policy from private.service_shift_effective_policy(
    service_shift.id, p_starts_at, p_starts_at + make_interval(mins => p_duration_minutes)
  );
  select coalesce(rule.duration_minutes, service_shift.default_duration_minutes)
  into authoritative_duration
  from (select true) seed
  left join lateral (
    select turn.duration_minutes from public.reservation_turn_rules turn
    where turn.organization_id = p_organization_id
      and turn.service_period_id = service_shift.service_period_id
      and p_party_size between turn.min_party_size and turn.max_party_size
    order by turn.min_party_size, turn.max_party_size, turn.id limit 1
  ) rule on true;
  if policy.is_closed or p_duration_minutes <> authoritative_duration
    or p_starts_at < service_shift.starts_at
      + make_interval(mins => policy.opening_buffer_minutes)
    or p_starts_at + make_interval(mins => p_duration_minutes)
      > service_shift.ends_at - make_interval(mins => policy.closing_buffer_minutes) then
    raise exception 'The signed slot is unavailable under the active service policy'
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
  calendar_date date;
  location_timezone text;
  service_shift public.service_shifts%rowtype;
  policy record;
  existing_covers integer;
begin
  select (p_starts_at at time zone location.timezone)::date, location.timezone
  into calendar_date, location_timezone
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id and location.is_active;
  if calendar_date is null or p_party_size not between 1 and 100 then
    raise exception 'A valid pacing request is required' using errcode = '22023';
  end if;
  if not private.local_wall_timestamp_is_unambiguous(
    p_starts_at at time zone location_timezone, location_timezone
  ) then
    raise exception 'Ambiguous reservation wall times are unavailable'
      using errcode = '23514';
  end if;
  perform private.ensure_service_shifts(
    p_organization_id, p_location_id, array[calendar_date - 1, calendar_date]
  );
  select shift.* into service_shift
  from public.service_shifts shift
  where shift.organization_id = p_organization_id and shift.location_id = p_location_id
    and shift.status = 'scheduled' and shift.online_enabled
    and p_starts_at >= shift.starts_at and p_starts_at < shift.ends_at
  order by shift.starts_at desc, shift.id limit 1 for update;
  if service_shift.id is null then
    raise exception 'No online service is configured for the requested time' using errcode = '23514';
  end if;
  if p_party_size not between service_shift.min_party_size and service_shift.max_party_size then
    raise exception 'That party size is unavailable for this service period'
      using errcode = '23514';
  end if;
  select * into policy from private.service_shift_effective_policy(
    service_shift.id, p_starts_at, p_starts_at + interval '1 microsecond'
  );
  if policy.is_closed then
    raise exception 'The requested time is closed' using errcode = '23514';
  end if;
  select coalesce(sum(covers.party_size), 0)::integer into existing_covers
  from (
    select reservation.party_size from public.reservations reservation
    where reservation.organization_id = p_organization_id
      and reservation.location_id = p_location_id
      and reservation.id is distinct from p_exclude_reservation_id
      and reservation.status not in ('cancelled','no_show','completed')
      and reservation.reserved_at >= p_starts_at - make_interval(mins => policy.pacing_interval_minutes)
      and reservation.reserved_at < p_starts_at + make_interval(mins => policy.pacing_interval_minutes)
    union all
    select hold.party_size from private.public_booking_holds hold
    where hold.organization_id = p_organization_id and hold.location_id = p_location_id
      and hold.id is distinct from p_exclude_booking_hold_id
      and hold.status = 'pending' and hold.expires_at > clock_timestamp()
      and hold.reserved_at >= p_starts_at - make_interval(mins => policy.pacing_interval_minutes)
      and hold.reserved_at < p_starts_at + make_interval(mins => policy.pacing_interval_minutes)
  ) covers;
  if existing_covers + p_party_size > policy.pacing_cover_limit then
    raise exception 'The requested time has reached its pacing limit' using errcode = '23P01';
  end if;
end
$$;

revoke all on function private.ensure_service_shifts(uuid, uuid, date[])
from public, anon, authenticated, service_role;
revoke all on function private.service_shift_effective_policy(uuid, timestamptz, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function private.guard_service_shift_exception_bounds()
from public, anon, authenticated, service_role;
revoke all on function public.configure_service_shift_exception(
  uuid, uuid, uuid, uuid, text, timestamptz, timestamptz,
  integer, integer, integer, integer, text, boolean
) from public, anon, authenticated, service_role;
revoke all on function public.service_reservation_shift_snapshot(uuid, uuid, date)
from public, anon, authenticated, service_role;
revoke all on function public.revoke_service_shift_exception(uuid, uuid, text)
from public, anon, authenticated, service_role;
grant execute on function public.configure_service_shift_exception(
  uuid, uuid, uuid, uuid, text, timestamptz, timestamptz,
  integer, integer, integer, integer, text, boolean
) to authenticated;
grant execute on function public.revoke_service_shift_exception(uuid, uuid, text)
to authenticated;
grant execute on function public.service_reservation_shift_snapshot(uuid, uuid, date)
to authenticated, service_role;

comment on table public.service_shifts is
  'Materialized dated reservation service instances; recurring periods are authoring configuration.';
comment on table public.service_shift_exceptions is
  'Explicit closure, pacing, and buffer lifecycle evidence for one materialized service shift.';
