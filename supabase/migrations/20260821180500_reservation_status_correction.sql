-- Make the staff reservation status actions genuinely correctable. A correction
-- is a new audited event, never a deletion or rewrite of the original event.

create function private.capture_completed_reservation_allocations()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  allocation_ids jsonb;
  table_ids jsonb;
begin
  if new.event_type <> 'status_changed' or new.to_status <> 'completed' then
    return new;
  end if;

  select
    coalesce(jsonb_agg(allocation.id order by allocation.id), '[]'::jsonb),
    coalesce(jsonb_agg(allocation.table_id order by allocation.id), '[]'::jsonb)
  into allocation_ids, table_ids
  from public.reservation_table_allocations allocation
  where allocation.organization_id = new.organization_id
    and allocation.location_id = new.location_id
    and allocation.reservation_id = new.reservation_id
    and allocation.allocation_kind = 'assignment'
    and not allocation.is_active
    and allocation.released_by is not distinct from new.actor_id
    and allocation.released_at >= statement_timestamp();

  new.metadata := new.metadata || jsonb_build_object(
    'releasedAllocationIds', allocation_ids,
    'releasedTableIds', table_ids
  );
  return new;
end
$$;

revoke all on function private.capture_completed_reservation_allocations()
from public, anon, authenticated, service_role;

create trigger reservation_completion_allocation_evidence
before insert on public.reservation_events
for each row execute function private.capture_completed_reservation_allocations();

create function public.correct_reservation_status(
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
  reservation_row public.reservations%rowtype;
  transition_event public.reservation_events%rowtype;
  prior_status text;
  released_allocation_ids uuid[] := '{}'::uuid[];
  corrected_event_id bigint;
  request_created boolean;
  request_payload jsonb;
  observed_at timestamptz := clock_timestamp();
begin
  if actor_id is null or p_request_id is null or p_location_id is null
    or p_reservation_id is null or p_expected_version is null
    or p_expected_version < 1
    or length(btrim(coalesce(p_reason, ''))) not between 4 and 1000 then
    raise exception 'A valid reservation correction is required'
      using errcode = '22023';
  end if;

  select candidate.* into reservation_row
  from public.reservations candidate
  where candidate.id = p_reservation_id
    and candidate.location_id = p_location_id;
  if reservation_row.id is null then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;
  if not public.has_capability(
    reservation_row.organization_id,
    reservation_row.location_id,
    'reservations.operate'
  ) then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;

  perform private.lock_reservation_inventory(
    reservation_row.location_id,
    reservation_row.reserved_at
  );
  select candidate.* into reservation_row
  from public.reservations candidate
  where candidate.id = p_reservation_id
    and candidate.location_id = p_location_id
  for update;

  request_payload := jsonb_build_object(
    'expectedVersion', p_expected_version,
    'reason', btrim(p_reason)
  );
  request_created := private.claim_operation_request(
    p_request_id,
    'reservation.status.correct',
    reservation_row.organization_id,
    reservation_row.location_id,
    reservation_row.id,
    request_payload
  );
  if not request_created then
    select event.id into corrected_event_id
    from public.reservation_events event
    where event.organization_id = reservation_row.organization_id
      and event.location_id = reservation_row.location_id
      and event.reservation_id = reservation_row.id
      and event.event_type = 'status_corrected'
      and event.metadata ->> 'requestId' = p_request_id::text
    order by event.id desc
    limit 1;
    if corrected_event_id is null then
      raise exception 'Reservation correction replay evidence is unavailable'
        using errcode = '40001';
    end if;
    return jsonb_build_object(
      'id', reservation_row.id,
      'status', reservation_row.status,
      'version', reservation_row.version,
      'correctedEventId', corrected_event_id,
      'replayed', true
    );
  end if;

  if reservation_row.version <> p_expected_version then
    raise exception 'Reservation changed concurrently; review the latest details'
      using errcode = '40001';
  end if;
  if reservation_row.status not in ('arrived', 'seated', 'completed') then
    raise exception 'Only an arrival, seating, or completion can be corrected'
      using errcode = '23514';
  end if;

  select event.* into transition_event
  from public.reservation_events event
  where event.organization_id = reservation_row.organization_id
    and event.location_id = reservation_row.location_id
    and event.reservation_id = reservation_row.id
    and event.event_type = 'status_changed'
    and event.to_status = reservation_row.status
  order by event.id desc
  limit 1;
  if transition_event.id is null
    or transition_event.occurred_at < observed_at - interval '15 minutes' then
    raise exception 'The correction window has expired; use a manager recovery workflow'
      using errcode = '23514';
  end if;
  prior_status := transition_event.from_status;
  if prior_status is null
    or (reservation_row.status = 'arrived' and prior_status not in ('booked', 'confirmed'))
    or (reservation_row.status = 'seated' and prior_status not in ('booked', 'confirmed', 'arrived'))
    or (reservation_row.status = 'completed' and prior_status <> 'seated') then
    raise exception 'The prior reservation state cannot be restored safely'
      using errcode = '23514';
  end if;

  if reservation_row.status = 'completed' then
    if not (transition_event.metadata ? 'releasedAllocationIds') then
      raise exception 'Completion allocation evidence is unavailable; use manager recovery'
        using errcode = '23514';
    end if;
    select coalesce(array_agg(value::uuid), '{}'::uuid[])
    into released_allocation_ids
    from jsonb_array_elements_text(
      transition_event.metadata -> 'releasedAllocationIds'
    ) value;

    if exists (
      select 1
      from public.reservation_table_allocations released
      join public.reservation_table_allocations active
        on active.table_id = released.table_id
       and active.is_active
       and active.id <> released.id
       and active.allocation_range && released.allocation_range
      where released.id = any(released_allocation_ids)
        and released.reservation_id = reservation_row.id
    ) then
      raise exception 'A released table is now committed elsewhere; reopening was not applied'
        using errcode = '23P01';
    end if;

    update public.reservation_table_allocations allocation
    set is_active = true,
        released_at = null,
        released_by = null,
        updated_at = observed_at
    where allocation.id = any(released_allocation_ids)
      and allocation.organization_id = reservation_row.organization_id
      and allocation.location_id = reservation_row.location_id
      and allocation.reservation_id = reservation_row.id
      and allocation.allocation_kind = 'assignment'
      and not allocation.is_active;
  end if;

  update public.reservations reservation
  set status = prior_status,
      version = reservation.version + 1,
      confirmed_at = case when prior_status = 'booked' then null else reservation.confirmed_at end,
      arrived_at = case when prior_status in ('booked', 'confirmed') then null else reservation.arrived_at end,
      seated_at = case when prior_status in ('booked', 'confirmed', 'arrived') then null else reservation.seated_at end,
      completed_at = null,
      updated_at = observed_at
  where reservation.id = reservation_row.id
  returning * into reservation_row;

  if transition_event.to_status = 'seated' then
    insert into public.table_status_events (
      organization_id, location_id, table_id, reservation_id,
      status, note, actor_id, occurred_at
    )
    select
      reservation_row.organization_id,
      reservation_row.location_id,
      allocation.table_id,
      reservation_row.id,
      'available',
      'Seating corrected: ' || btrim(p_reason),
      actor_id,
      observed_at
    from public.reservation_table_allocations allocation
    where allocation.reservation_id = reservation_row.id
      and allocation.is_active;
  elsif transition_event.to_status = 'completed' then
    insert into public.table_status_events (
      organization_id, location_id, table_id, reservation_id,
      status, note, actor_id, occurred_at
    )
    select
      reservation_row.organization_id,
      reservation_row.location_id,
      allocation.table_id,
      reservation_row.id,
      'occupied',
      'Completion reopened: ' || btrim(p_reason),
      actor_id,
      observed_at
    from public.reservation_table_allocations allocation
    where allocation.id = any(released_allocation_ids)
      and allocation.is_active;
  end if;

  insert into public.reservation_events (
    organization_id, location_id, reservation_id, event_type,
    from_status, to_status, note, actor_id, actor_kind, metadata, occurred_at
  ) values (
    reservation_row.organization_id,
    reservation_row.location_id,
    reservation_row.id,
    'status_corrected',
    transition_event.to_status,
    prior_status,
    btrim(p_reason),
    actor_id,
    'staff',
    jsonb_build_object(
      'requestId', p_request_id,
      'correctedEventId', transition_event.id,
      'expectedVersion', p_expected_version,
      'resultingVersion', reservation_row.version,
      'restoredAllocationIds', to_jsonb(released_allocation_ids)
    ),
    observed_at
  ) returning id into corrected_event_id;

  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object(
    'id', reservation_row.id,
    'status', reservation_row.status,
    'version', reservation_row.version,
    'correctedEventId', corrected_event_id,
    'replayed', false
  );
end
$$;

revoke all on function public.correct_reservation_status(
  uuid, uuid, uuid, integer, text
) from public, anon, authenticated, service_role;
grant execute on function public.correct_reservation_status(
  uuid, uuid, uuid, integer, text
) to authenticated;

comment on function public.correct_reservation_status(
  uuid, uuid, uuid, integer, text
) is 'Version-checked 15-minute correction for arrival, seating, or completion; completion reopens only when exact released allocations remain conflict-free.';
