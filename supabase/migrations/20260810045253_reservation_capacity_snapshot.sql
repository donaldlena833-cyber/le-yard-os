-- A Host-safe capacity projection. Provisional public holds remain private,
-- but authorized reservation operators need their non-PII cover impact to
-- present the same pacing state that the database enforces on writes.
create function public.reservation_capacity_snapshot(
  p_organization_id uuid,
  p_location_id uuid,
  p_from timestamptz,
  p_to timestamptz
)
returns table (
  "startsAt" timestamptz,
  "partySize" integer,
  kind text
)
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
begin
  if auth.uid() is null then
    raise exception 'Reservation access is required' using errcode = '42501';
  end if;
  if p_organization_id is null or p_location_id is null
    or p_from is null or p_to is null or p_to <= p_from
    or p_to > p_from + interval '30 hours'
    or not exists (
      select 1
      from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
        and location.is_active
    ) then
    raise exception 'A valid reservation capacity scope is required'
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
  select snapshot.starts_at, snapshot.party_size, snapshot.kind
  from (
    select
      reservation.reserved_at as starts_at,
      reservation.party_size,
      'reservation'::text as kind,
      reservation.id as subject_id
    from public.reservations reservation
    where reservation.organization_id = p_organization_id
      and reservation.location_id = p_location_id
      and reservation.reserved_at >= p_from
      and reservation.reserved_at < p_to
      and reservation.status not in ('cancelled', 'no_show', 'completed')

    union all

    select
      hold.reserved_at,
      hold.party_size,
      'hold'::text,
      hold.id
    from private.public_booking_holds hold
    where hold.organization_id = p_organization_id
      and hold.location_id = p_location_id
      and hold.reserved_at >= p_from
      and hold.reserved_at < p_to
      and hold.status = 'pending'
      and hold.expires_at > statement_timestamp()
  ) snapshot
  order by snapshot.starts_at, snapshot.kind, snapshot.subject_id;
end
$$;

revoke all on function public.reservation_capacity_snapshot(
  uuid, uuid, timestamptz, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.reservation_capacity_snapshot(
  uuid, uuid, timestamptz, timestamptz
) to authenticated;

comment on function public.reservation_capacity_snapshot(
  uuid, uuid, timestamptz, timestamptz
) is
  'Returns no-PII reservation/active-hold cover rows for an exact authorized location and bounded service window.';
