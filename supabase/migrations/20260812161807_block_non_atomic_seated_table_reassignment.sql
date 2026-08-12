-- Ordinary assignment changes interval inventory only. A seated party also has
-- physical occupancy evidence in table_status_events, so moving it through this
-- command would leave the floor and reservation allocation contradictory.
-- Keep seated moves fail-closed until an atomic physical-move command exists.

create or replace function public.assign_reservation_tables(
  p_request_id uuid,
  p_reservation_id uuid,
  p_table_ids uuid[],
  p_override_note text
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
  resolved_reserved_at timestamptz;
  end_at timestamptz;
  table_id uuid;
begin
  if actor_id is null or p_request_id is null or p_reservation_id is null
    or length(coalesce(p_override_note, '')) > 2000 then
    raise exception 'A valid table assignment is required' using errcode = '22023';
  end if;
  select * into reservation_row from public.reservations reservation
  where reservation.id = p_reservation_id;
  if reservation_row.id is null then
    raise exception 'Reservation not found' using errcode = 'P0002';
  end if;
  if reservation_row.status in ('seated', 'completed', 'cancelled', 'no_show') then
    raise exception 'Seated or terminal reservations cannot use ordinary table assignment'
      using errcode = '23514';
  end if;
  if not public.has_capability(
    reservation_row.organization_id,
    reservation_row.location_id,
    'reservations.operate'
  ) then
    raise exception 'Reservation operating access is required' using errcode = '42501';
  end if;
  if p_override_note is not null and not public.has_capability(
    reservation_row.organization_id,
    reservation_row.location_id,
    'reservations.override'
  ) then
    raise exception 'Reservation override access is required' using errcode = '42501';
  end if;
  resolved_reserved_at := reservation_row.reserved_at;
  end_at := reservation_row.reserved_at
    + make_interval(mins => reservation_row.duration_minutes);
  perform private.lock_reservation_inventory(
    reservation_row.location_id, resolved_reserved_at
  );
  perform private.expire_public_booking_holds(
    reservation_row.organization_id, reservation_row.location_id,
    clock_timestamp(), 1000, resolved_reserved_at
  );
  select * into reservation_row from public.reservations reservation
  where reservation.id = p_reservation_id for update;
  if reservation_row.id is null
    or reservation_row.reserved_at <> resolved_reserved_at then
    raise exception 'Reservation changed concurrently; retry the request'
      using errcode = '40001';
  end if;
  end_at := reservation_row.reserved_at
    + make_interval(mins => reservation_row.duration_minutes);
  perform private.assert_reservation_tables_available(
    reservation_row.organization_id, reservation_row.location_id,
    reservation_row.id, p_table_ids, reservation_row.reserved_at,
    end_at, reservation_row.party_size
  );
  if not private.claim_operation_request(
    p_request_id, 'reservation.assign_tables', reservation_row.organization_id,
    reservation_row.location_id, reservation_row.id,
    jsonb_build_object('tableIds', p_table_ids, 'overrideNote', nullif(btrim(p_override_note), ''))
  ) then
    return jsonb_build_object(
      'id', reservation_row.id,
      'version', reservation_row.version,
      'replayed', true
    );
  end if;
  update public.reservation_table_allocations allocation
  set is_active = false,
      released_at = clock_timestamp(),
      released_by = actor_id,
      updated_at = clock_timestamp()
  where allocation.reservation_id = reservation_row.id
    and allocation.is_active;
  foreach table_id in array p_table_ids loop
    insert into public.reservation_table_allocations (
      organization_id, location_id, reservation_id, table_id,
      allocation_kind, starts_at, ends_at, created_by
    ) values (
      reservation_row.organization_id, reservation_row.location_id,
      reservation_row.id, table_id, 'assignment',
      reservation_row.reserved_at, end_at, actor_id
    );
  end loop;
  update public.reservations reservation
  set version = reservation.version + 1,
      updated_at = clock_timestamp()
  where reservation.id = reservation_row.id
  returning * into reservation_row;
  insert into public.reservation_events (
    organization_id, location_id, reservation_id, event_type,
    from_status, to_status, note, actor_id, actor_kind, metadata
  ) values (
    reservation_row.organization_id, reservation_row.location_id,
    reservation_row.id, 'tables_assigned', reservation_row.status,
    reservation_row.status, nullif(btrim(p_override_note), ''), actor_id,
    'staff', jsonb_build_object('tableIds', p_table_ids)
  );
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object(
    'id', reservation_row.id,
    'version', reservation_row.version,
    'replayed', false
  );
end
$$;

comment on function public.assign_reservation_tables(uuid, uuid, uuid[], text)
is 'Assigns interval inventory for non-seated reservations; physical seated-party moves require a separate atomic workflow.';
