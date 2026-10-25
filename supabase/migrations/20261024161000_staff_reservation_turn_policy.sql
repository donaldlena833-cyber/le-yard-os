-- Unify staff creation with the existing strict edit policy. No override route.
begin;
create or replace function private.assert_staff_reservation_policy(
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
  -- Turn-rule writers lock their parent period. Hold it through validation.
  perform period.id from public.reservation_service_periods period
  where period.id = service_shift.service_period_id for share;

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


create function private.staff_reservation_turn_quote(
 p_organization_id uuid, p_location_id uuid, p_starts_at timestamptz,
 p_party_size integer, p_exclude_reservation_id uuid
) returns jsonb language plpgsql volatile security definer
set search_path='' set row_security=off as $$
declare
 local_date date; shift_row public.service_shifts%rowtype;
 duration integer; matches integer; evidence jsonb;
begin
 if p_starts_at is null or p_party_size is null or p_party_size not between 1 and 100 then
  raise exception 'A valid reservation time and party size are required' using errcode='22023';
 end if;
 perform private.lock_reservation_inventory_many(p_location_id,array[p_starts_at]);
 select (p_starts_at at time zone location.timezone)::date into local_date
 from public.locations location where location.id=p_location_id
 and location.organization_id=p_organization_id and location.is_active;
 if local_date is null then raise exception 'Reservation location not found' using errcode='42501'; end if;
 perform private.ensure_service_shifts(p_organization_id,p_location_id,array[local_date-1,local_date]);
 select count(*) into matches from public.service_shifts shift
 where shift.organization_id=p_organization_id and shift.location_id=p_location_id
 and shift.status='scheduled' and p_starts_at>=shift.starts_at and p_starts_at<shift.ends_at;
 if matches<>1 then raise exception 'One scheduled service must cover the requested time' using errcode='23514'; end if;
 select * into shift_row from public.service_shifts shift
 where shift.organization_id=p_organization_id and shift.location_id=p_location_id
 and shift.status='scheduled' and p_starts_at>=shift.starts_at and p_starts_at<shift.ends_at for update;
 perform period.id from public.reservation_service_periods period
 where period.id=shift_row.service_period_id for share;
 select coalesce(rule.duration_minutes,shift_row.default_duration_minutes) into duration
 from (select true) seed left join lateral(
  select turn.duration_minutes from public.reservation_turn_rules turn
  where turn.organization_id=p_organization_id and turn.service_period_id=shift_row.service_period_id
  and p_party_size between turn.min_party_size and turn.max_party_size
  order by turn.min_party_size,turn.max_party_size,turn.id limit 1
 ) rule on true;
 evidence:=private.assert_staff_reservation_policy(p_organization_id,p_location_id,p_starts_at,duration,p_party_size,p_exclude_reservation_id);
 return evidence || jsonb_build_object('durationMinutes',duration,'startsAt',p_starts_at,'partySize',p_party_size);
end $$;
revoke all on function private.staff_reservation_turn_quote(uuid,uuid,timestamptz,integer,uuid)
from public,anon,authenticated,service_role;

create function public.quote_staff_reservation_turn(
 p_location_id uuid, p_starts_at timestamptz, p_party_size integer,
 p_reservation_id uuid default null
) returns jsonb language plpgsql volatile security definer
set search_path='' set row_security=off as $$
declare org uuid; observed_date date;
begin
 select location.organization_id,(clock_timestamp() at time zone location.timezone)::date
 into org,observed_date from public.locations location where location.id=p_location_id and location.is_active;
 if auth.uid() is null or org is null or not public.has_capability(org,p_location_id,'reservations.operate',observed_date) then
  raise exception 'Reservation operating access is required' using errcode='42501';
 end if;
 if p_reservation_id is not null and not exists(select 1 from public.reservations r
 where r.id=p_reservation_id and r.organization_id=org and r.location_id=p_location_id) then
  raise exception 'Reservation not found in this location' using errcode='42501';
 end if;
 return private.staff_reservation_turn_quote(org,p_location_id,p_starts_at,p_party_size,p_reservation_id);
end $$;
revoke all on function public.quote_staff_reservation_turn(uuid,timestamptz,integer,uuid)
from public,anon,authenticated,service_role;
grant execute on function public.quote_staff_reservation_turn(uuid,timestamptz,integer,uuid) to authenticated;

create table private.reservation_creation_policy_evidence(
 reservation_id uuid primary key references public.reservations(id),
 organization_id uuid not null,location_id uuid not null,
 actor_id uuid not null,policy_contract jsonb not null,
 created_at timestamptz not null default clock_timestamp()
);
revoke all on private.reservation_creation_policy_evidence from public,anon,authenticated,service_role;

create function private.enforce_staff_reservation_creation_policy()
returns trigger language plpgsql security definer set search_path='' set row_security=off as $$
declare contract jsonb;
begin
 if new.source not in ('manual','phone','walk_in') or new.booking_channel in ('public','import','partner') then return new; end if;
 contract:=private.staff_reservation_turn_quote(new.organization_id,new.location_id,new.reserved_at,new.party_size,new.id);
 if new.duration_minutes is distinct from (contract->>'durationMinutes')::integer then
  raise exception 'The duration no longer matches the active turn policy' using errcode='23514';
 end if;
 insert into private.reservation_creation_policy_evidence(reservation_id,organization_id,location_id,actor_id,policy_contract)
 values(new.id,new.organization_id,new.location_id,coalesce(auth.uid(),new.created_by),contract);
 return new;
end $$;
revoke all on function private.enforce_staff_reservation_creation_policy() from public,anon,authenticated,service_role;
create trigger reservations_staff_creation_policy after insert on public.reservations
for each row execute function private.enforce_staff_reservation_creation_policy();

update private.runtime_schema_contract_expected expected
set migration_head='20261024161000',
 table_fingerprint=snapshot.value->>'tableFingerprint',
 function_fingerprint=snapshot.value->>'functionFingerprint',
 access_fingerprint=snapshot.value->>'accessFingerprint',captured_at=clock_timestamp()
from(select private.compute_runtime_schema_fingerprints() as value)snapshot
where expected.contract_version='runtime-schema-v2';
commit;
