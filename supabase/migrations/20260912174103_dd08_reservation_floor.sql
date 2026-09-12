-- DD08 window arrangement, copied from the published design source on 2026-09-12.
-- Bar stools and drinks perch are drawn, but are not reservable dining inventory.
create or replace function public.install_le_yard_reservation_draft_legacy_unsafe(
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
  update public.reservation_tables set is_active = false, is_bookable = false,
    approved_at = null, approved_by = null, updated_at = clock_timestamp()
  where organization_id = organization_uuid and location_id = p_location_id;
  update public.reservation_table_combinations set is_active = false, updated_at = clock_timestamp()
  where organization_id = organization_uuid and location_id = p_location_id;
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
  for table_definition in select value from jsonb_array_elements('[{"label": "R1", "capacity": 2, "x": 0.228571, "y": 0.141978, "w": 0.05718, "h": 0.099839}, {"label": "R2", "capacity": 2, "x": 0.3, "y": 0.141978, "w": 0.05718, "h": 0.099839}, {"label": "R3", "capacity": 2, "x": 0.371429, "y": 0.141978, "w": 0.05718, "h": 0.099839}, {"label": "R4", "capacity": 2, "x": 0.442857, "y": 0.141978, "w": 0.05718, "h": 0.099839}, {"label": "R5", "capacity": 2, "x": 0.514286, "y": 0.141978, "w": 0.05718, "h": 0.099839}, {"label": "L1", "capacity": 2, "x": 0.340476, "y": 0.864598, "w": 0.05718, "h": 0.099839}, {"label": "L2", "capacity": 2, "x": 0.411905, "y": 0.864598, "w": 0.05718, "h": 0.099839}, {"label": "L3", "capacity": 2, "x": 0.483333, "y": 0.864598, "w": 0.05718, "h": 0.099839}, {"label": "L4", "capacity": 2, "x": 0.554762, "y": 0.864598, "w": 0.05718, "h": 0.099839}, {"label": "L5", "capacity": 2, "x": 0.683333, "y": 0.768157, "w": 0.05718, "h": 0.099839}, {"label": "L6", "capacity": 2, "x": 0.759524, "y": 0.768157, "w": 0.05718, "h": 0.099839}, {"label": "L7", "capacity": 2, "x": 0.835714, "y": 0.768157, "w": 0.05718, "h": 0.099839}, {"label": "F1", "capacity": 2, "x": 0.104762, "y": 0.452854, "w": 0.071241, "h": 0.080134}, {"label": "F2", "capacity": 2, "x": 0.104762, "y": 0.372719, "w": 0.071241, "h": 0.080134}, {"label": "F3", "capacity": 2, "x": 0.104762, "y": 0.292585, "w": 0.071241, "h": 0.080134}, {"label": "F4", "capacity": 2, "x": 0.104762, "y": 0.212451, "w": 0.071241, "h": 0.080134}, {"label": "C1", "capacity": 2, "x": 0.3, "y": 0.582908, "w": 0.071241, "h": 0.080134}, {"label": "C2", "capacity": 2, "x": 0.3, "y": 0.442765, "w": 0.071241, "h": 0.080134}, {"label": "C3", "capacity": 2, "x": 0.497619, "y": 0.582908, "w": 0.071241, "h": 0.080134}, {"label": "C4", "capacity": 2, "x": 0.497619, "y": 0.442765, "w": 0.071241, "h": 0.080134}]'::jsonb) loop
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
  for combination_definition in select value from jsonb_array_elements('[{"label": "Window eight", "members": ["F1", "F2", "F3", "F4"], "min": 5, "max": 8}, {"label": "Window four A", "members": ["F1", "F2"], "min": 3, "max": 4}, {"label": "Window four B", "members": ["F3", "F4"], "min": 3, "max": 4}]'::jsonb) loop
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
      array_position(array(select jsonb_array_elements_text(combination_definition -> 'members')), table_row.label) - 1
    from public.reservation_tables table_row
    where table_row.organization_id = organization_uuid
      and table_row.location_id = p_location_id
      and table_row.label in (select jsonb_array_elements_text(combination_definition -> 'members'))
    on conflict (combination_id, table_id) do update
    set sort_order = excluded.sort_order;
  end loop;
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object(
    'installed', true, 'replayed', false, 'tableCount', 20,
    'seatCount', 40, 'onlineBookingEnabled', false
  );
end
$$;

create or replace function public.approve_le_yard_reservation_draft(
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
  if table_count <> 20 or seat_count <> 40 then
    raise exception 'The Le Yard floor draft must contain 20 tables and 40 dining seats before approval'
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


revoke all on function public.install_le_yard_reservation_draft_legacy_unsafe(uuid, uuid) from public, anon, authenticated, service_role;

update private.runtime_schema_contract_expected expected
set migration_head = '20260912174103',
 table_fingerprint = snapshot.value ->> 'tableFingerprint',
 function_fingerprint = snapshot.value ->> 'functionFingerprint',
 access_fingerprint = snapshot.value ->> 'accessFingerprint',
 captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
