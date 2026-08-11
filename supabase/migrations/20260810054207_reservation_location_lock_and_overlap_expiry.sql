-- Rolling pacing windows and table allocations can cross a service-day
-- boundary. Every reservation inventory writer therefore takes one
-- transaction-scoped lock for the whole location before it reads or mutates
-- pacing, holds, or allocations. The existing business-day sentinels remain
-- useful evidence, but they are no longer the serialization primitive.
create function private.lock_reservation_inventory_location(
  p_location_id uuid
)
returns uuid
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  organization_uuid uuid;
begin
  if p_location_id is null then
    raise exception 'A valid reservation inventory location is required'
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

  perform pg_advisory_xact_lock(hashtextextended(
    'reservation-inventory-location:' || p_location_id::text,
    0
  ));
  return organization_uuid;
end
$$;

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

  organization_uuid :=
    private.lock_reservation_inventory_location(p_location_id);

  for business_date in
    select distinct private.resolve_service_business_date(
      organization_uuid,
      p_location_id,
      starts_at
    )
    from unnest(p_starts_at) starts_at
    order by 1
  loop
    insert into private.reservation_inventory_days (location_id, business_date)
    values (p_location_id, business_date)
    on conflict do nothing;
  end loop;
end
$$;

-- One lifecycle implementation is shared by scheduled expiry and the exact
-- overlap cleanup below so PII redaction, outbox cancellation, allocation
-- release, and audit evidence cannot drift apart.
create function private.expire_public_booking_hold_if_due(
  p_organization_id uuid,
  p_location_id uuid,
  p_booking_hold_id uuid,
  p_now timestamptz
)
returns boolean
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  hold_row private.public_booking_holds%rowtype;
  locked_organization_id uuid;
begin
  if p_organization_id is null or p_location_id is null
    or p_booking_hold_id is null or p_now is null then
    raise exception 'Valid booking-hold expiry evidence is required'
      using errcode = '22023';
  end if;

  locked_organization_id :=
    private.lock_reservation_inventory_location(p_location_id);
  if locked_organization_id <> p_organization_id then
    raise exception 'Booking-hold expiry scope does not match the location'
      using errcode = '42501';
  end if;

  select hold.*
  into hold_row
  from private.public_booking_holds hold
  where hold.organization_id = p_organization_id
    and hold.location_id = p_location_id
    and hold.id = p_booking_hold_id
    and hold.status = 'pending'
    and hold.expires_at <= p_now
  for update skip locked;

  if hold_row.id is null then
    return false;
  end if;

  update private.public_booking_holds hold
  set status = 'expired', expired_at = p_now, redacted_at = p_now,
      first_name = null, last_name = null, email = null, phone = null,
      special_requests = null, updated_at = p_now
  where hold.organization_id = hold_row.organization_id
    and hold.location_id = hold_row.location_id
    and hold.id = hold_row.id
    and hold.status = 'pending'
    and hold.expires_at <= p_now;
  if not found then
    return false;
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

  return true;
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
  booking_hold_uuid uuid;
  expired_count integer := 0;
  inventory_business_date date;
  locked_organization_id uuid;
begin
  if p_organization_id is null or p_location_id is null or p_now is null
    or p_limit not between 1 and 10000 then
    raise exception 'Valid booking-hold expiry scope is required'
      using errcode = '22023';
  end if;
  locked_organization_id :=
    private.lock_reservation_inventory_location(p_location_id);
  if locked_organization_id <> p_organization_id then
    raise exception 'Booking-hold expiry scope does not match the location'
      using errcode = '42501';
  end if;
  if p_inventory_starts_at is not null then
    inventory_business_date := private.resolve_service_business_date(
      p_organization_id,
      p_location_id,
      p_inventory_starts_at
    );
  end if;

  for booking_hold_uuid in
    select hold.id
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
    if private.expire_public_booking_hold_if_due(
      p_organization_id,
      p_location_id,
      booking_hold_uuid,
      p_now
    ) then
      expired_count := expired_count + 1;
    end if;
  end loop;

  return expired_count;
end
$$;

create function private.expire_overlapping_public_booking_holds(
  p_organization_id uuid,
  p_location_id uuid,
  p_now timestamptz,
  p_limit integer,
  p_table_ids uuid[],
  p_starts_at timestamptz,
  p_ends_at timestamptz
)
returns integer
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  booking_hold_uuid uuid;
  expired_count integer := 0;
  locked_organization_id uuid;
begin
  if p_organization_id is null or p_location_id is null or p_now is null
    or p_limit not between 1 and 10000
    or p_table_ids is null or cardinality(p_table_ids) not between 1 and 8
    or cardinality(p_table_ids) <>
      cardinality(array(select distinct unnest(p_table_ids)))
    or exists (select 1 from unnest(p_table_ids) table_id where table_id is null)
    or p_starts_at is null or p_ends_at is null
    or p_ends_at <= p_starts_at then
    raise exception 'Valid overlapping booking-hold expiry scope is required'
      using errcode = '22023';
  end if;

  locked_organization_id :=
    private.lock_reservation_inventory_location(p_location_id);
  if locked_organization_id <> p_organization_id then
    raise exception 'Overlapping expiry scope does not match the location'
      using errcode = '42501';
  end if;

  -- This function is safe if a future caller omits the outer command lock.
  -- Re-acquiring the same transaction advisory lock is immediate.
  perform private.lock_reservation_inventory_many(
    p_location_id,
    array[p_starts_at]::timestamptz[]
  );

  for booking_hold_uuid in
    select hold.id
    from private.public_booking_holds hold
    where hold.organization_id = p_organization_id
      and hold.location_id = p_location_id
      and hold.status = 'pending'
      and hold.expires_at <= p_now
      and exists (
        select 1
        from public.reservation_table_allocations allocation
        where allocation.organization_id = hold.organization_id
          and allocation.location_id = hold.location_id
          and allocation.booking_hold_id = hold.id
          and allocation.table_id = any(p_table_ids)
          and allocation.is_active
          and allocation.starts_at < p_ends_at
          and allocation.ends_at > p_starts_at
      )
    order by hold.expires_at, hold.id
    limit p_limit
    for update skip locked
  loop
    if private.expire_public_booking_hold_if_due(
      p_organization_id,
      p_location_id,
      booking_hold_uuid,
      p_now
    ) then
      expired_count := expired_count + 1;
    end if;
  end loop;

  return expired_count;
end
$$;

create or replace function private.assert_reservation_tables_available(
  p_organization_id uuid,
  p_location_id uuid,
  p_reservation_id uuid,
  p_table_ids uuid[],
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_party_size integer
)
returns void
language plpgsql volatile security definer
set search_path = ''
set row_security = off
as $$
declare
  table_count integer;
  total_capacity integer;
  combination_matches boolean;
begin
  if p_table_ids is null or cardinality(p_table_ids) < 1
    or cardinality(p_table_ids) > 8
    or cardinality(p_table_ids) <>
      cardinality(array(select distinct unnest(p_table_ids))) then
    raise exception 'Choose one valid table set' using errcode = '22023';
  end if;

  perform private.expire_overlapping_public_booking_holds(
    p_organization_id,
    p_location_id,
    clock_timestamp(),
    1000,
    p_table_ids,
    p_starts_at,
    p_ends_at
  );

  select count(*), sum(table_row.max_capacity)
  into table_count, total_capacity
  from public.reservation_tables table_row
  where table_row.organization_id = p_organization_id
    and table_row.location_id = p_location_id
    and table_row.id = any(p_table_ids)
    and table_row.is_active
    and table_row.is_bookable
    and table_row.approved_at is not null
    and coalesce((
      select status_event.status
      from public.table_status_events status_event
      where status_event.organization_id = table_row.organization_id
        and status_event.table_id = table_row.id
      order by status_event.occurred_at desc, status_event.id desc
      limit 1
    ), 'available') <> 'blocked';
  if table_count <> cardinality(p_table_ids) or total_capacity < p_party_size then
    raise exception 'The selected table set cannot seat this party'
      using errcode = '23514';
  end if;

  if cardinality(p_table_ids) > 1 then
    select exists (
      select 1
      from public.reservation_table_combinations combination
      where combination.organization_id = p_organization_id
        and combination.location_id = p_location_id
        and combination.is_active
        and combination.max_capacity >= p_party_size
        and (
          select array_agg(member.table_id order by member.table_id)
          from public.reservation_table_combination_members member
          where member.organization_id = combination.organization_id
            and member.combination_id = combination.id
        ) = (
          select array_agg(value order by value)
          from unnest(p_table_ids) value
        )
    ) into combination_matches;
    if not combination_matches then
      raise exception 'The selected tables are not an approved combination'
        using errcode = '23514';
    end if;
  end if;

  if exists (
    select 1
    from public.reservation_table_allocations allocation
    where allocation.organization_id = p_organization_id
      and allocation.location_id = p_location_id
      and allocation.table_id = any(p_table_ids)
      and allocation.is_active
      and (allocation.expires_at is null
        or allocation.expires_at > clock_timestamp())
      and allocation.reservation_id is distinct from p_reservation_id
      and allocation.starts_at < p_ends_at
      and allocation.ends_at > p_starts_at
  ) then
    raise exception 'The selected table is no longer available'
      using errcode = '23P01';
  end if;
end
$$;

revoke all on function private.lock_reservation_inventory_many(uuid, timestamptz[])
from public, anon, authenticated, service_role;
revoke all on function private.lock_reservation_inventory_location(uuid)
from public, anon, authenticated, service_role;
revoke all on function private.expire_public_booking_hold_if_due(uuid, uuid, uuid, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function private.expire_public_booking_holds(uuid, uuid, timestamptz, integer, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function private.expire_overlapping_public_booking_holds(uuid, uuid, timestamptz, integer, uuid[], timestamptz, timestamptz)
from public, anon, authenticated, service_role;
revoke all on function private.assert_reservation_tables_available(uuid, uuid, uuid, uuid[], timestamptz, timestamptz, integer)
from public, anon, authenticated, service_role;

comment on function private.lock_reservation_inventory_many(uuid, timestamptz[]) is
  'Serializes all reservation inventory and rolling-pacing decisions for one location, while recording each affected operating date.';
comment on function private.lock_reservation_inventory_location(uuid) is
  'Takes the canonical transaction-scoped reservation inventory lock for one active location and returns its organization.';
comment on function private.expire_overlapping_public_booking_holds(uuid, uuid, timestamptz, integer, uuid[], timestamptz, timestamptz) is
  'Expires pending holds whose still-active table allocations overlap the exact requested half-open interval before the GiST invariant is evaluated.';
