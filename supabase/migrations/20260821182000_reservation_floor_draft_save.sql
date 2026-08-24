-- Save reviewed floor-position drafts atomically. Every table is fenced by its
-- expected coordinates so concurrent edits fail without a partial layout.

create function public.save_reservation_floor_positions(
  p_request_id uuid,
  p_location_id uuid,
  p_moves jsonb
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
  request_created boolean;
  move_count integer;
  result_moves jsonb;
begin
  if actor_id is null or p_request_id is null or p_location_id is null
    or p_moves is null or jsonb_typeof(p_moves) <> 'array'
    or jsonb_array_length(p_moves) not between 1 and 50 then
    raise exception 'A valid floor-position draft is required'
      using errcode = '22023';
  end if;

  select location.organization_id into organization_uuid
  from public.locations location
  where location.id = p_location_id and location.is_active
  for update;
  if organization_uuid is null then
    raise exception 'Reservation location not found' using errcode = 'P0002';
  end if;
  if not public.has_capability(
    organization_uuid,
    p_location_id,
    'reservations.configure'
  ) then
    raise exception 'Reservation configuration access is required'
      using errcode = '42501';
  end if;

  with requested as (
    select *
    from jsonb_to_recordset(p_moves) as move(
      "tableId" uuid,
      "fromX" numeric,
      "fromY" numeric,
      "toX" numeric,
      "toY" numeric
    )
  )
  select count(*) into move_count from requested;
  if move_count <> jsonb_array_length(p_moves)
    or exists (
      select 1
      from jsonb_to_recordset(p_moves) as move(
        "tableId" uuid,
        "fromX" numeric,
        "fromY" numeric,
        "toX" numeric,
        "toY" numeric
      )
      where move."tableId" is null
        or move."fromX" is null or move."fromY" is null
        or move."toX" is null or move."toY" is null
        or move."fromX" not between 0 and 1
        or move."fromY" not between 0 and 1
        or move."toX" not between 0 and 1
        or move."toY" not between 0 and 1
    )
    or exists (
      select move."tableId"
      from jsonb_to_recordset(p_moves) as move(
        "tableId" uuid,
        "fromX" numeric,
        "fromY" numeric,
        "toX" numeric,
        "toY" numeric
      )
      group by move."tableId"
      having count(*) > 1
    ) then
    raise exception 'The floor-position draft contains invalid or duplicate moves'
      using errcode = '22023';
  end if;

  perform 1
  from public.reservation_tables reservation_table
  join jsonb_to_recordset(p_moves) as move(
    "tableId" uuid,
    "fromX" numeric,
    "fromY" numeric,
    "toX" numeric,
    "toY" numeric
  ) on move."tableId" = reservation_table.id
  where reservation_table.organization_id = organization_uuid
    and reservation_table.location_id = p_location_id
    and reservation_table.is_active
  order by reservation_table.id
  for update of reservation_table;

  if (
    select count(*)
    from public.reservation_tables reservation_table
    join jsonb_to_recordset(p_moves) as move(
      "tableId" uuid,
      "fromX" numeric,
      "fromY" numeric,
      "toX" numeric,
      "toY" numeric
    ) on move."tableId" = reservation_table.id
    where reservation_table.organization_id = organization_uuid
      and reservation_table.location_id = p_location_id
      and reservation_table.is_active
  ) <> move_count then
    raise exception 'One or more floor tables are unavailable'
      using errcode = 'P0002';
  end if;

  request_created := private.claim_operation_request(
    p_request_id,
    'reservation.floor_positions.save',
    organization_uuid,
    p_location_id,
    p_location_id,
    jsonb_build_object('moves', p_moves)
  );
  if not request_created then
    select coalesce(jsonb_agg(jsonb_build_object(
      'tableId', reservation_table.id,
      'positionX', reservation_table.position_x,
      'positionY', reservation_table.position_y
    ) order by reservation_table.id), '[]'::jsonb)
    into result_moves
    from public.reservation_tables reservation_table
    join jsonb_to_recordset(p_moves) as move(
      "tableId" uuid,
      "fromX" numeric,
      "fromY" numeric,
      "toX" numeric,
      "toY" numeric
    ) on move."tableId" = reservation_table.id;
    return jsonb_build_object('moves', result_moves, 'replayed', true);
  end if;

  if exists (
    select 1
    from public.reservation_tables reservation_table
    join jsonb_to_recordset(p_moves) as move(
      "tableId" uuid,
      "fromX" numeric,
      "fromY" numeric,
      "toX" numeric,
      "toY" numeric
    ) on move."tableId" = reservation_table.id
    where reservation_table.position_x <> move."fromX"
      or reservation_table.position_y <> move."fromY"
  ) then
    raise exception 'The floor changed concurrently; review the latest layout'
      using errcode = '40001';
  end if;

  insert into public.audit_events (
    organization_id, location_id, actor_id, action, table_name,
    record_id, old_record, new_record, request_id, metadata
  )
  select
    organization_uuid,
    p_location_id,
    actor_id,
    'reservation_floor_position_saved',
    'reservation_tables',
    reservation_table.id::text,
    jsonb_build_object(
      'positionX', reservation_table.position_x,
      'positionY', reservation_table.position_y
    ),
    jsonb_build_object('positionX', move."toX", 'positionY', move."toY"),
    p_request_id::text,
    jsonb_build_object(
      'actorKind', 'staff',
      'interaction', 'review_confirm',
      'moveCount', move_count
    )
  from public.reservation_tables reservation_table
  join jsonb_to_recordset(p_moves) as move(
    "tableId" uuid,
    "fromX" numeric,
    "fromY" numeric,
    "toX" numeric,
    "toY" numeric
  ) on move."tableId" = reservation_table.id;

  update public.reservation_tables reservation_table
  set position_x = move."toX",
      position_y = move."toY",
      updated_at = clock_timestamp()
  from jsonb_to_recordset(p_moves) as move(
    "tableId" uuid,
    "fromX" numeric,
    "fromY" numeric,
    "toX" numeric,
    "toY" numeric
  )
  where reservation_table.id = move."tableId"
    and reservation_table.organization_id = organization_uuid
    and reservation_table.location_id = p_location_id;

  select coalesce(jsonb_agg(jsonb_build_object(
    'tableId', reservation_table.id,
    'positionX', reservation_table.position_x,
    'positionY', reservation_table.position_y
  ) order by reservation_table.id), '[]'::jsonb)
  into result_moves
  from public.reservation_tables reservation_table
  join jsonb_to_recordset(p_moves) as move(
    "tableId" uuid,
    "fromX" numeric,
    "fromY" numeric,
    "toX" numeric,
    "toY" numeric
  ) on move."tableId" = reservation_table.id;

  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object('moves', result_moves, 'replayed', false);
end
$$;

revoke all on function public.save_reservation_floor_positions(uuid, uuid, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_reservation_floor_positions(uuid, uuid, jsonb)
to authenticated;

comment on function public.save_reservation_floor_positions(uuid, uuid, jsonb) is
'Atomically applies a reviewed floor-position diff with exact expected-coordinate fences and per-table audit evidence.';
