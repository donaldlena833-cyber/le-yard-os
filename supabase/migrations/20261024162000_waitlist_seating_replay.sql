-- Preserve exact waitlist seating retries after the entry is consumed.
begin;
create or replace function public.seat_waitlist_entry(
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
  if not private.claim_operation_request(
    p_request_id, 'waitlist.seat', waitlist_row.organization_id,
    waitlist_row.location_id, p_request_id,
    jsonb_build_object('waitlistEntryId', waitlist_row.id, 'tableIds', p_table_ids, 'durationMinutes', p_duration_minutes)
  ) then
    select * into reservation_row from public.reservations reservation where reservation.id = p_request_id;
    if reservation_row.id is null then raise exception 'Waitlist seating request has no result' using errcode='40001'; end if;
    return jsonb_build_object('id', reservation_row.id, 'status', reservation_row.status, 'replayed', true);
  end if;
  -- A payload/actor-bound exact replay returns before consumed-state or inventory checks.
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


revoke all on function public.seat_waitlist_entry(uuid,uuid,uuid[],integer) from public,anon,authenticated,service_role;
grant execute on function public.seat_waitlist_entry(uuid,uuid,uuid[],integer) to authenticated;
update private.runtime_schema_contract_expected expected
set migration_head='20261024162000',table_fingerprint=snapshot.value->>'tableFingerprint',
 function_fingerprint=snapshot.value->>'functionFingerprint',access_fingerprint=snapshot.value->>'accessFingerprint',captured_at=clock_timestamp()
from(select private.compute_runtime_schema_fingerprints() as value)snapshot
where expected.contract_version='runtime-schema-v2';
commit;
