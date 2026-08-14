-- Make reservation lifecycle delivery self-describing and fail closed.
-- Public booking and guest messaging remain controlled by the existing,
-- independently approved reservation_settings gates.

alter table public.reservation_message_outbox
add column reservation_version integer;

alter table public.reservation_message_outbox
add column recipient_destination_hmac text;

alter table public.reservation_settings
add column message_delivery_configuration_version bigint not null default 1;

alter table public.reservation_message_outbox
add column message_delivery_configuration_version bigint;

alter table public.reservation_message_outbox
add column provider_attempted_at timestamptz;

alter table public.reservation_settings
add constraint reservation_settings_message_delivery_configuration_version_check
check (message_delivery_configuration_version > 0);

alter table public.reservation_message_outbox
drop constraint reservation_message_outbox_status_check;

alter table public.reservation_message_outbox
add constraint reservation_message_outbox_status_check check (
  status in (
    'queued', 'sending', 'sent', 'delivered', 'failed', 'cancelled',
    'uncertain'
  )
);

alter table public.reservation_message_outbox
add constraint reservation_message_outbox_provider_attempt_check check (
  status <> 'uncertain' or provider_attempted_at is not null
);

-- The configuration generation is database-owned. Settings scope is immutable,
-- and an insert takes the location row lock so a simultaneous first outbox row
-- cannot observe a missing settings row while settings are being created.
create function private.version_reservation_message_delivery_settings()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if tg_op = 'INSERT' then
    perform 1
    from public.locations location
    where location.organization_id = new.organization_id
      and location.id = new.location_id
    for update;
    if not found then
      raise exception 'Reservation settings location is unavailable'
        using errcode = '23503';
    end if;
    new.message_delivery_configuration_version := 1;
    return new;
  end if;

  if (new.organization_id, new.location_id)
      is distinct from (old.organization_id, old.location_id) then
    raise exception 'Reservation settings scope is immutable'
      using errcode = '23514';
  end if;
  if (
    new.approved_at,
    new.guest_messaging_enabled,
    new.verification_channels
  ) is distinct from (
    old.approved_at,
    old.guest_messaging_enabled,
    old.verification_channels
  ) then
    if old.message_delivery_configuration_version = 9223372036854775807 then
      raise exception 'Reservation message configuration version is exhausted'
        using errcode = '22003';
    end if;
    new.message_delivery_configuration_version :=
      old.message_delivery_configuration_version + 1;
  else
    new.message_delivery_configuration_version :=
      old.message_delivery_configuration_version;
  end if;
  return new;
end
$$;

create trigger reservation_settings_message_delivery_insert_version
before insert on public.reservation_settings
for each row execute function
  private.version_reservation_message_delivery_settings();

create trigger reservation_settings_message_delivery_update_version
before update of organization_id, location_id, approved_at,
  guest_messaging_enabled, verification_channels,
  message_delivery_configuration_version
on public.reservation_settings
for each row execute function
  private.version_reservation_message_delivery_settings();

revoke all on function
  private.version_reservation_message_delivery_settings()
from public, anon, authenticated, service_role;

update public.reservation_message_outbox message
set message_delivery_configuration_version =
      settings.message_delivery_configuration_version
from public.reservation_settings settings
where settings.organization_id = message.organization_id
  and settings.location_id = message.location_id;

-- Historical rows without a settings record are terminally fenced below. They
-- still receive a non-null sentinel generation so the evidence is total.
update public.reservation_message_outbox
set message_delivery_configuration_version = 1
where message_delivery_configuration_version is null;

alter table public.reservation_message_outbox
alter column message_delivery_configuration_version set not null;

alter table public.reservation_message_outbox
add constraint reservation_message_outbox_configuration_version_check
check (message_delivery_configuration_version > 0);

alter table public.reservation_message_outbox
add constraint reservation_message_outbox_version_check
check (reservation_version is null or reservation_version > 0);

alter table public.reservation_message_outbox
add constraint reservation_message_outbox_destination_hmac_check
check (
  recipient_destination_hmac is null
  or recipient_destination_hmac ~ '^[0-9a-f]{64}$'
);

-- A public booking verification is bound to the exact normalized contact that
-- consumed the confirmation secret. The legacy digest remains the durable
-- verification evidence; this helper derives a purpose-specific HMAC only
-- when the reservation's current CRM destination still matches that evidence.
create function private.reservation_verified_recipient_hmac(
  p_organization_id uuid,
  p_location_id uuid,
  p_reservation_id uuid,
  p_channel text
)
returns text
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select encode(
    extensions.hmac(
      case verification.verified_channel
        when 'email' then lower(btrim(guest.email))
        else regexp_replace(coalesce(guest.phone, ''), '[^0-9]', '', 'g')
      end,
      verification.confirmation_fingerprint,
      'sha256'
    ),
    'hex'
  )
  from public.reservations reservation
  join public.guests guest
    on guest.organization_id = reservation.organization_id
   and guest.id = reservation.guest_id
  join private.public_booking_holds hold
    on hold.organization_id = reservation.organization_id
   and hold.location_id = reservation.location_id
   and hold.reservation_id = reservation.id
  join private.public_booking_verifications verification
    on verification.organization_id = hold.organization_id
   and verification.location_id = hold.location_id
   and verification.booking_hold_id = hold.id
  where reservation.organization_id = p_organization_id
    and reservation.location_id = p_location_id
    and reservation.id = p_reservation_id
    and reservation.booking_channel = 'web'
    and verification.verified_channel = p_channel
    and case verification.verified_channel
      when 'email' then nullif(lower(btrim(guest.email)), '')
      else nullif(
        regexp_replace(coalesce(guest.phone, ''), '[^0-9]', '', 'g'),
        ''
      )
    end is not null
    and verification.verified_destination_hash = encode(
      extensions.digest(
        'reservation-verified-destination:v1' || chr(31)
          || verification.confirmation_fingerprint || chr(31)
          || case verification.verified_channel
            when 'email' then lower(btrim(guest.email))
            else regexp_replace(
              coalesce(guest.phone, ''),
              '[^0-9]',
              '',
              'g'
            )
          end,
        'sha256'
      ),
      'hex'
    )
  order by verification.consumed_at desc, verification.id
  limit 1
$$;

revoke all on function private.reservation_verified_recipient_hmac(
  uuid, uuid, uuid, text
) from public, anon, authenticated, service_role;

-- Backfill only rows whose embedded version and current destination can still
-- be proven. Active rows without that proof are cancelled below rather than
-- being guessed into a deliverable state.
update public.reservation_message_outbox message
set reservation_version =
      (message.template_data ->> 'reservationVersion')::integer,
    recipient_destination_hmac = case
      when reservation.booking_channel = 'web' then
        private.reservation_verified_recipient_hmac(
          message.organization_id,
          message.location_id,
          message.reservation_id,
          message.channel
        )
      else null
    end,
    updated_at = clock_timestamp()
from public.reservations reservation
where reservation.organization_id = message.organization_id
  and reservation.location_id = message.location_id
  and reservation.id = message.reservation_id
  and message.template_key in (
    'reservation_confirmed',
    'reservation_modified',
    'reservation_cancelled',
    'reservation_reminder_24h',
    'reservation_reminder_2h'
  )
  and coalesce(message.template_data ->> 'reservationVersion', '')
    ~ '^[1-9][0-9]*$';

update public.reservation_message_outbox message
set status = 'cancelled',
    claim_token = null,
    claimed_by = null,
    claimed_at = null,
    lease_expires_at = null,
    last_error_code = 'unbound_reservation_lifecycle',
    updated_at = clock_timestamp()
from public.reservations reservation
where reservation.organization_id = message.organization_id
  and reservation.location_id = message.location_id
  and reservation.id = message.reservation_id
  and message.template_key in (
    'reservation_confirmed',
    'reservation_modified',
    'reservation_cancelled',
    'reservation_reminder_24h',
    'reservation_reminder_2h'
  )
  and message.status in ('queued', 'failed', 'sending')
  and (
    message.reservation_version is null
    or message.reservation_version <> reservation.version
    or reservation.booking_channel <> 'web'
    or message.recipient_destination_hmac is null
  );

update public.reservation_message_outbox message
set status = 'cancelled',
    claim_token = null,
    claimed_by = null,
    claimed_at = null,
    lease_expires_at = null,
    last_error_code = 'messaging_configuration_revoked',
    updated_at = clock_timestamp()
where message.status in ('queued', 'failed', 'sending')
  and message.provider_attempted_at is null
  and not exists (
    select 1
    from public.reservation_settings settings
    where settings.organization_id = message.organization_id
      and settings.location_id = message.location_id
      and settings.approved_at is not null
      and settings.guest_messaging_enabled
      and message.channel = any(settings.verification_channels)
      and message.message_delivery_configuration_version =
        settings.message_delivery_configuration_version
  );

-- Configuration revocation is a delivery boundary, not merely a UI state.
-- This partial index keeps the uncommon configuration-change cleanup scoped
-- to live work for one tenant/location/channel.
create index reservation_outbox_active_delivery_scope_idx
on public.reservation_message_outbox (
  organization_id, location_id, channel, id
)
where status in ('queued', 'failed', 'sending');

create function private.cancel_ineligible_reservation_messages(
  p_organization_id uuid,
  p_location_id uuid,
  p_observed_at timestamptz
)
returns integer
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  cancelled_count integer;
begin
  update public.reservation_message_outbox message
  set status = 'cancelled',
      claim_token = null,
      claimed_by = null,
      claimed_at = null,
      lease_expires_at = null,
      last_error_code = 'messaging_configuration_revoked',
      updated_at = p_observed_at
  where message.organization_id = p_organization_id
    and message.location_id = p_location_id
    and message.status in ('queued', 'failed', 'sending')
    and message.provider_attempted_at is null
    and not exists (
      select 1
      from public.reservation_settings settings
      where settings.organization_id = message.organization_id
        and settings.location_id = message.location_id
        and settings.approved_at is not null
        and settings.guest_messaging_enabled
        and message.channel = any(settings.verification_channels)
        and message.message_delivery_configuration_version =
          settings.message_delivery_configuration_version
    );
  get diagnostics cancelled_count = row_count;
  return cancelled_count;
end
$$;

revoke all on function private.cancel_ineligible_reservation_messages(
  uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;

create function private.cancel_reservation_messages_on_settings_change()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  observed_at timestamptz := clock_timestamp();
  cancelled_count integer := 0;
  old_configuration jsonb;
  new_configuration jsonb;
begin
  if tg_op <> 'INSERT' then
    old_configuration := jsonb_build_object(
      'approved', old.approved_at is not null,
      'guestMessagingEnabled', old.guest_messaging_enabled,
      'verificationChannels', old.verification_channels
    );
  end if;
  if tg_op <> 'DELETE' then
    new_configuration := jsonb_build_object(
      'approved', new.approved_at is not null,
      'guestMessagingEnabled', new.guest_messaging_enabled,
      'verificationChannels', new.verification_channels
    );
  end if;

  if tg_op <> 'INSERT' then
    cancelled_count := private.cancel_ineligible_reservation_messages(
      old.organization_id,
      old.location_id,
      observed_at
    );
    if cancelled_count > 0 then
      insert into public.audit_events (
        organization_id,
        location_id,
        actor_id,
        action,
        table_name,
        record_id,
        old_record,
        new_record,
        metadata
      ) values (
        old.organization_id,
        old.location_id,
        auth.uid(),
        'reservation_messages_cancelled_by_configuration',
        'reservation_message_outbox',
        old.id::text,
        old_configuration,
        new_configuration,
        jsonb_build_object(
          'cancelledCount', cancelled_count,
          'reason', 'messaging_configuration_revoked'
        )
      );
    end if;
  end if;

  if tg_op = 'INSERT' or (
    tg_op = 'UPDATE'
    and (new.organization_id, new.location_id)
      is distinct from (old.organization_id, old.location_id)
  ) then
    cancelled_count := private.cancel_ineligible_reservation_messages(
      new.organization_id,
      new.location_id,
      observed_at
    );
    if cancelled_count > 0 then
      insert into public.audit_events (
        organization_id,
        location_id,
        actor_id,
        action,
        table_name,
        record_id,
        old_record,
        new_record,
        metadata
      ) values (
        new.organization_id,
        new.location_id,
        auth.uid(),
        'reservation_messages_cancelled_by_configuration',
        'reservation_message_outbox',
        new.id::text,
        old_configuration,
        new_configuration,
        jsonb_build_object(
          'cancelledCount', cancelled_count,
          'reason', 'messaging_configuration_revoked'
        )
      );
    end if;
  end if;

  if tg_op = 'DELETE' then
    return old;
  end if;
  return new;
end
$$;

create trigger reservation_settings_message_delivery_fence
after insert or update of organization_id, location_id, approved_at,
  guest_messaging_enabled, verification_channels or delete
on public.reservation_settings
for each row execute function
  private.cancel_reservation_messages_on_settings_change();

revoke all on function
  private.cancel_reservation_messages_on_settings_change()
from public, anon, authenticated, service_role;

-- Serialize new live outbox work behind the exact settings row. This closes
-- the enqueue/disable race: either the insert commits first and the settings
-- trigger cancels it, or the insert observes the revoked configuration and is
-- born cancelled. A later re-enable can therefore never resurrect that work.
create function private.fence_reservation_message_delivery_insert()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  settings_row public.reservation_settings%rowtype;
begin
  select settings.*
  into settings_row
  from public.reservation_settings settings
  where settings.organization_id = new.organization_id
    and settings.location_id = new.location_id
  for update;

  if settings_row.id is null then
    -- Serialize against creation of the first settings row, then re-read it.
    perform 1
    from public.locations location
    where location.organization_id = new.organization_id
      and location.id = new.location_id
    for update;
    select settings.*
    into settings_row
    from public.reservation_settings settings
    where settings.organization_id = new.organization_id
      and settings.location_id = new.location_id
    for update;
  end if;

  if settings_row.id is not null then
    if new.message_delivery_configuration_version is null then
      new.message_delivery_configuration_version :=
        settings_row.message_delivery_configuration_version;
    elsif new.message_delivery_configuration_version <>
        settings_row.message_delivery_configuration_version then
      raise exception 'Reservation message configuration evidence is stale'
        using errcode = '40001';
    end if;
  elsif new.message_delivery_configuration_version is null then
    new.message_delivery_configuration_version := 1;
  end if;

  if new.status in ('queued', 'failed', 'sending') and (
    settings_row.id is null
    or settings_row.approved_at is null
    or not settings_row.guest_messaging_enabled
    or not new.channel = any(settings_row.verification_channels)
    or new.message_delivery_configuration_version <>
      settings_row.message_delivery_configuration_version
  ) then
    new.status := 'cancelled';
    new.claim_token := null;
    new.claimed_by := null;
    new.claimed_at := null;
    new.lease_expires_at := null;
    new.last_error_code := 'messaging_configuration_revoked';
    new.updated_at := clock_timestamp();
  end if;
  return new;
end
$$;

create trigger reservation_message_configuration_insert_fence
before insert on public.reservation_message_outbox
for each row execute function
  private.fence_reservation_message_delivery_insert();

revoke all on function private.fence_reservation_message_delivery_insert()
from public, anon, authenticated, service_role;

create function private.bind_reservation_message_delivery_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  reservation_row public.reservations%rowtype;
  embedded_version integer;
  expected_hmac text;
begin
  if tg_op = 'UPDATE'
    and new.message_delivery_configuration_version is distinct from
      old.message_delivery_configuration_version then
    raise exception 'Reservation message configuration evidence is immutable'
      using errcode = '23514';
  end if;
  if new.reservation_id is null or new.template_key not in (
    'reservation_confirmed',
    'reservation_modified',
    'reservation_cancelled',
    'reservation_reminder_24h',
    'reservation_reminder_2h'
  ) then
    return new;
  end if;

  select reservation.*
  into reservation_row
  from public.reservations reservation
  where reservation.organization_id = new.organization_id
    and reservation.location_id = new.location_id
    and reservation.id = new.reservation_id;
  if reservation_row.id is null then
    raise exception 'Reservation delivery evidence is unavailable'
      using errcode = '23514';
  end if;
  if coalesce(new.template_data ->> 'reservationVersion', '')
      ~ '^[1-9][0-9]*$' then
    embedded_version :=
      (new.template_data ->> 'reservationVersion')::integer;
  elsif tg_op = 'INSERT' then
    embedded_version := reservation_row.version;
    new.template_data := new.template_data || jsonb_build_object(
      'reservationVersion', reservation_row.version
    );
  else
    raise exception 'Reservation delivery version evidence is required'
      using errcode = '23514';
  end if;
  if new.reservation_version is null then
    new.reservation_version := embedded_version;
  end if;
  if new.reservation_version <> embedded_version
    or new.reservation_version <> reservation_row.version then
    raise exception 'Reservation delivery version is stale'
      using errcode = '40001';
  end if;

  if reservation_row.booking_channel = 'web' then
    expected_hmac := private.reservation_verified_recipient_hmac(
      new.organization_id,
      new.location_id,
      new.reservation_id,
      new.channel
    );
    if expected_hmac is null then
      raise exception 'Verified reservation destination is unavailable'
        using errcode = '23514';
    end if;
    if new.recipient_destination_hmac is null then
      new.recipient_destination_hmac := expected_hmac;
    elsif new.recipient_destination_hmac <> expected_hmac then
      raise exception 'Reservation destination evidence does not match'
        using errcode = '23514';
    end if;
  else
    raise exception 'Verified reservation destination is unavailable'
      using errcode = '23514';
  end if;
  return new;
end
$$;

-- Claims contain no destination or presentation payload. The exact provider
-- snapshot is released only by the begin RPC below, after a final serialized
-- configuration and lifecycle check.
drop function public.service_claim_reservation_message_outbox(
  uuid, integer, integer, timestamptz
);

create function public.service_claim_reservation_message_outbox(
  p_worker_id uuid,
  p_limit integer,
  p_lease_seconds integer,
  p_now timestamptz
)
returns table (
  id uuid,
  "claimToken" uuid,
  attempts integer
)
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_worker_id is null or p_limit not between 1 and 500
    or p_lease_seconds not between 5 and 3600 or p_now is null then
    raise exception 'A valid message claim is required' using errcode = '22023';
  end if;

  -- Once a provider boundary was durably begun, an expired lease is never
  -- replayed automatically: a provider may have accepted the request before
  -- the worker lost its response or process.
  with stale as (
    select message.id
    from public.reservation_message_outbox message
    where message.status = 'sending'
      and message.provider_attempted_at is not null
      and message.lease_expires_at <= p_now
    order by message.lease_expires_at, message.id
    limit p_limit
    for update skip locked
  )
  update public.reservation_message_outbox message
  set status = 'uncertain',
      claim_token = null,
      claimed_by = null,
      claimed_at = null,
      lease_expires_at = null,
      last_error_code = 'provider_outcome_unknown_after_lease',
      updated_at = p_now
  from stale
  where message.id = stale.id;

  return query
  with candidates as (
    select message.id
    from public.reservation_message_outbox message
    where message.attempts < 20
      and exists (
        select 1
        from public.reservation_settings settings
        where settings.organization_id = message.organization_id
          and settings.location_id = message.location_id
          and settings.approved_at is not null
          and settings.guest_messaging_enabled
          and message.channel = any(settings.verification_channels)
          and message.message_delivery_configuration_version =
            settings.message_delivery_configuration_version
      )
      and (
        (message.status in ('queued', 'failed')
          and message.next_attempt_at <= p_now)
        or (message.status = 'sending'
          and message.provider_attempted_at is null
          and message.lease_expires_at <= p_now)
      )
      and (
        message.template_key <> 'reservation_verify'
        or exists (
          select 1
          from private.public_booking_holds hold
          where hold.organization_id = message.organization_id
            and hold.location_id = message.location_id
            and hold.id = message.booking_hold_id
            and hold.status = 'pending'
            and hold.expires_at
              > p_now + make_interval(secs => p_lease_seconds)
        )
      )
      and (
        message.template_key <> 'waitlist_table_ready'
        or exists (
          select 1
          from public.waitlist_entries waitlist
          where waitlist.organization_id = message.organization_id
            and waitlist.location_id = message.location_id
            and waitlist.id = message.waitlist_entry_id
            and waitlist.status = 'notified'
            and waitlist.offer_expires_at
              > p_now + make_interval(secs => p_lease_seconds)
        )
      )
      and (
        message.template_key not in (
          'reservation_confirmed',
          'reservation_modified',
          'reservation_cancelled',
          'reservation_reminder_24h',
          'reservation_reminder_2h'
        )
        or exists (
          select 1
          from public.reservations reservation
          where reservation.organization_id = message.organization_id
            and reservation.location_id = message.location_id
            and reservation.id = message.reservation_id
            and reservation.version = message.reservation_version
            and message.template_data ->> 'reservationVersion'
              = message.reservation_version::text
            and reservation.booking_channel = 'web'
            and message.recipient_destination_hmac =
              private.reservation_verified_recipient_hmac(
                message.organization_id,
                message.location_id,
                message.reservation_id,
                message.channel
              )
        )
      )
      and (
        message.template_key not in (
          'reservation_reminder_24h', 'reservation_reminder_2h'
        )
        or exists (
          select 1
          from public.reservations reservation
          where reservation.organization_id = message.organization_id
            and reservation.location_id = message.location_id
            and reservation.id = message.reservation_id
            and reservation.status in ('booked', 'confirmed')
            and reservation.reserved_at > p_now
        )
      )
      and (
        message.template_key <> 'reservation_confirmed'
        or exists (
          select 1
          from public.reservations reservation
          where reservation.organization_id = message.organization_id
            and reservation.location_id = message.location_id
            and reservation.id = message.reservation_id
            and reservation.status in ('booked', 'confirmed')
            and reservation.duration_minutes is not null
            and reservation.reserved_at
              + make_interval(mins => reservation.duration_minutes)
              + interval '24 hours'
              > p_now + make_interval(secs => p_lease_seconds)
        )
      )
    order by
      case when message.status = 'sending' then 0 else 1 end,
      coalesce(message.lease_expires_at, message.next_attempt_at),
      message.created_at,
      message.id
    limit p_limit
    for update skip locked
  ), claimed as (
    update public.reservation_message_outbox message
    set status = 'sending',
        claim_token = gen_random_uuid(),
        claimed_by = p_worker_id,
        claimed_at = p_now,
        lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        attempts = message.attempts + 1,
        provider_attempted_at = null,
        updated_at = p_now
    from candidates
    where message.id = candidates.id
    returning message.*
  )
  select
    claimed.id,
    claimed.claim_token,
    claimed.attempts
  from claimed
  order by claimed.created_at, claimed.id;
end
$$;

revoke all on function public.service_claim_reservation_message_outbox(
  uuid, integer, integer, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.service_claim_reservation_message_outbox(
  uuid, integer, integer, timestamptz
) to service_role;

drop function public.service_validate_reservation_message_claim(
  uuid, uuid, timestamptz
);

create function public.service_begin_reservation_message_delivery(
  p_id uuid,
  p_claim_token uuid,
  p_now timestamptz
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  scope_organization_id uuid;
  scope_location_id uuid;
  settings_row public.reservation_settings%rowtype;
  message public.reservation_message_outbox%rowtype;
  reservation public.reservations%rowtype;
  hold private.public_booking_holds%rowtype;
  waitlist public.waitlist_entries%rowtype;
  guest public.guests%rowtype;
  eligible boolean := false;
  guest_name text;
  recipient_email text;
  recipient_phone text;
  public_code text;
  reserved_at timestamptz;
  offer_expires_at timestamptz;
  hold_expires_at timestamptz;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_id is null or p_claim_token is null or p_now is null then
    raise exception 'A valid reservation message dispatch is required'
      using errcode = '22023';
  end if;

  -- Discover the scope without a row lock, then take locks in the canonical
  -- settings -> outbox order also used by settings-change cleanup. Re-read the
  -- message under lock before trusting any scope or claim evidence.
  select candidate.organization_id, candidate.location_id
  into scope_organization_id, scope_location_id
  from public.reservation_message_outbox candidate
  where candidate.id = p_id;
  if scope_organization_id is null or scope_location_id is null then
    raise exception 'The reservation message claim is unavailable'
      using errcode = 'P0002';
  end if;

  select settings.*
  into settings_row
  from public.reservation_settings settings
  where settings.organization_id = scope_organization_id
    and settings.location_id = scope_location_id
  for update;

  select candidate.*
  into message
  from public.reservation_message_outbox candidate
  where candidate.id = p_id
  for update;
  if message.id is null
    or (message.organization_id, message.location_id)
      is distinct from (scope_organization_id, scope_location_id)
    or message.status <> 'sending'
    or message.claim_token <> p_claim_token
    or message.lease_expires_at <= p_now
    or message.provider_attempted_at is not null then
    raise exception 'The reservation message claim is unavailable'
      using errcode = 'P0002';
  end if;

  if settings_row.id is not null
    and settings_row.approved_at is not null
    and settings_row.guest_messaging_enabled
    and message.channel = any(settings_row.verification_channels)
    and message.message_delivery_configuration_version =
      settings_row.message_delivery_configuration_version
    and message.channel in ('email', 'sms') then
    if message.template_key = 'reservation_verify' then
      select candidate.*
      into hold
      from private.public_booking_holds candidate
      where candidate.organization_id = message.organization_id
        and candidate.location_id = message.location_id
        and candidate.id = message.booking_hold_id;
      eligible := hold.id is not null
        and hold.status = 'pending'
        and hold.expires_at > p_now
        and message.template_data ->> 'purpose' = 'reservation_verify'
        and message.template_data ->> 'channel' = message.channel;
      guest_name := concat_ws(' ', hold.first_name, hold.last_name);
      recipient_email := hold.email;
      recipient_phone := hold.phone;
      public_code := hold.public_code;
      reserved_at := hold.reserved_at;
      hold_expires_at := hold.expires_at;
    elsif message.template_key = 'waitlist_table_ready' then
      select candidate.*
      into waitlist
      from public.waitlist_entries candidate
      where candidate.organization_id = message.organization_id
        and candidate.location_id = message.location_id
        and candidate.id = message.waitlist_entry_id;
      eligible := waitlist.id is not null
        and waitlist.status = 'notified'
        and waitlist.offer_expires_at > p_now
        and coalesce(message.template_data ->> 'channel', message.channel)
          = message.channel;
      guest_name := waitlist.display_name;
      recipient_email := waitlist.email;
      recipient_phone := waitlist.phone;
      offer_expires_at := waitlist.offer_expires_at;
    elsif message.template_key in (
      'reservation_confirmed',
      'reservation_modified',
      'reservation_cancelled',
      'reservation_reminder_24h',
      'reservation_reminder_2h'
    ) then
      select candidate.*
      into reservation
      from public.reservations candidate
      where candidate.organization_id = message.organization_id
        and candidate.location_id = message.location_id
        and candidate.id = message.reservation_id;
      if reservation.id is not null then
        select candidate.*
        into guest
        from public.guests candidate
        where candidate.organization_id = reservation.organization_id
          and candidate.id = reservation.guest_id;
      end if;
      eligible := reservation.id is not null
        and guest.id is not null
        and reservation.booking_channel = 'web'
        and message.reservation_version is not null
        and message.reservation_version = reservation.version
        and message.template_data ->> 'reservationVersion'
          = message.reservation_version::text
        and message.template_data ->> 'channel' = message.channel
        and message.recipient_destination_hmac is not null
        and message.recipient_destination_hmac is not distinct from
          private.reservation_verified_recipient_hmac(
            message.organization_id,
            message.location_id,
            message.reservation_id,
            message.channel
          )
        and case message.template_key
          when 'reservation_cancelled' then
            reservation.status = 'cancelled'
          when 'reservation_confirmed' then
            reservation.status in ('booked', 'confirmed')
            and reservation.duration_minutes is not null
            and reservation.reserved_at
              + make_interval(mins => reservation.duration_minutes)
              + interval '24 hours' > p_now
          when 'reservation_modified' then
            reservation.status in ('booked', 'confirmed')
          when 'reservation_reminder_24h' then
            reservation.status in ('booked', 'confirmed')
            and reservation.reserved_at > p_now + interval '2 hours'
            and reservation.reserved_at <= p_now + interval '24 hours'
          when 'reservation_reminder_2h' then
            reservation.status in ('booked', 'confirmed')
            and reservation.reserved_at > p_now
            and reservation.reserved_at <= p_now + interval '2 hours'
          else false
        end;
      guest_name := guest.display_name;
      recipient_email := guest.email;
      recipient_phone := guest.phone;
      public_code := reservation.public_code;
      reserved_at := reservation.reserved_at;
    end if;
  end if;

  eligible := coalesce(eligible, false) and case message.channel
    when 'email' then nullif(btrim(recipient_email), '') is not null
    when 'sms' then nullif(btrim(recipient_phone), '') is not null
    else false
  end;

  if not coalesce(eligible, false) then
    update public.reservation_message_outbox candidate
    set status = 'cancelled',
        claim_token = null,
        claimed_by = null,
        claimed_at = null,
        lease_expires_at = null,
        last_error_code = 'delivery_no_longer_eligible',
        updated_at = p_now
    where candidate.id = message.id;
    return jsonb_build_object(
      'id', message.id,
      'status', 'cancelled',
      'attempts', message.attempts,
      'errorCode', 'delivery_no_longer_eligible'
    );
  end if;

  update public.reservation_message_outbox candidate
  set provider_attempted_at = p_now,
      last_error_code = null,
      updated_at = p_now
  where candidate.id = message.id
  returning * into message;

  return jsonb_build_object(
    'id', message.id,
    'status', 'dispatching',
    'attempts', message.attempts,
    'organizationId', message.organization_id,
    'locationId', message.location_id,
    'reservationId', message.reservation_id,
    'bookingHoldId', message.booking_hold_id,
    'waitlistEntryId', message.waitlist_entry_id,
    'channel', message.channel,
    'templateKey', message.template_key,
    'templateData', message.template_data,
    'messageCreatedAt', message.created_at,
    'guestName', guest_name,
    'recipientEmail', recipient_email,
    'recipientPhone', recipient_phone,
    'publicCode', public_code,
    'reservedAt', reserved_at,
    'offerExpiresAt', offer_expires_at,
    'holdExpiresAt', hold_expires_at,
    'configurationVersion', message.message_delivery_configuration_version
  );
end
$$;

revoke all on function public.service_begin_reservation_message_delivery(
  uuid, uuid, timestamptz
) from public, anon, authenticated, service_role;
grant execute on function public.service_begin_reservation_message_delivery(
  uuid, uuid, timestamptz
) to service_role;

create or replace function public.service_complete_reservation_message_outbox(
  p_id uuid,
  p_claim_token uuid,
  p_status text,
  p_error_code text default null,
  p_next_attempt_at timestamptz default null,
  p_provider_message_id text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  message_row public.reservation_message_outbox%rowtype;
  completed_at timestamptz := clock_timestamp();
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_id is null or p_claim_token is null
    or p_status not in ('sent', 'failed', 'cancelled')
    or length(coalesce(p_error_code, '')) > 240
    or length(coalesce(p_provider_message_id, '')) > 500
    or (p_status = 'failed'
      and (p_next_attempt_at is null or p_next_attempt_at <= completed_at))
    or (p_status <> 'failed' and p_next_attempt_at is not null) then
    raise exception 'A valid message completion is required'
      using errcode = '22023';
  end if;
  select * into message_row
  from public.reservation_message_outbox message
  where message.id = p_id
  for update;
  if message_row.id is null or message_row.status <> 'sending'
    or message_row.claim_token <> p_claim_token
    or message_row.lease_expires_at <= completed_at
    or (p_status = 'sent' and message_row.provider_attempted_at is null) then
    raise exception 'The message claim is unavailable' using errcode = 'P0002';
  end if;
  update public.reservation_message_outbox message
  set status = p_status,
      provider_message_id = coalesce(
        p_provider_message_id,
        message.provider_message_id
      ),
      last_error_code = case
        when p_status in ('failed', 'cancelled') then p_error_code
        else null
      end,
      next_attempt_at = case
        when p_status = 'failed' then p_next_attempt_at
        else message.next_attempt_at
      end,
      sent_at = case
        when p_status = 'sent' then completed_at
        else message.sent_at
      end,
      claim_token = null,
      claimed_by = null,
      claimed_at = null,
      lease_expires_at = null,
      updated_at = completed_at
  where message.id = p_id
  returning * into message_row;
  return jsonb_build_object(
    'id', message_row.id,
    'status', message_row.status,
    'attempts', message_row.attempts,
    'nextAttemptAt', case
      when message_row.status = 'failed' then message_row.next_attempt_at
      else null
    end
  );
end
$$;

create trigger reservation_message_delivery_evidence_guard
before insert or update of organization_id, location_id, reservation_id,
  channel, template_key, template_data, reservation_version,
  recipient_destination_hmac, message_delivery_configuration_version
on public.reservation_message_outbox
for each row execute function private.bind_reservation_message_delivery_evidence();

revoke all on function private.bind_reservation_message_delivery_evidence()
from public, anon, authenticated, service_role;

-- Lock each due reservation while deciding and inserting its reminders. A
-- concurrent staff modification either runs first (the scheduler observes the
-- new version) or waits and then cancels the just-created old-version row.
create or replace function public.service_enqueue_reservation_reminders(
  p_now timestamptz
)
returns integer
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  inserted_count integer;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_now is null then
    raise exception 'A reminder clock is required' using errcode = '22023';
  end if;

  with due_reservation as materialized (
    select reservation.*
    from public.reservations reservation
    join public.reservation_settings settings
      on settings.organization_id = reservation.organization_id
     and settings.location_id = reservation.location_id
     and settings.guest_messaging_enabled
     and settings.approved_at is not null
    where reservation.status in ('booked', 'confirmed')
      and reservation.booking_channel = 'web'
      and reservation.reserved_at > p_now
      and reservation.reserved_at <= p_now + interval '24 hours'
    order by reservation.organization_id, reservation.location_id,
      reservation.id
    for update of reservation
  )
  insert into public.reservation_message_outbox (
    organization_id,
    location_id,
    reservation_id,
    guest_id,
    channel,
    template_key,
    template_data,
    dedupe_key,
    reservation_version,
    recipient_destination_hmac
  )
  select
    reservation.organization_id,
    reservation.location_id,
    reservation.id,
    reservation.guest_id,
    channel.value,
    case reminder.value
      when '24h' then 'reservation_reminder_24h'
      else 'reservation_reminder_2h'
    end,
    jsonb_build_object(
      'publicCode', reservation.public_code,
      'reservedAt', reservation.reserved_at,
      'reservationVersion', reservation.version,
      'reminder', reminder.value,
      'channel', case when reservation.booking_channel = 'web'
        then channel.value end
    ),
    'reservation:' || reservation.id::text || ':reminder:'
      || reminder.value || ':v' || reservation.version::text
      || ':' || channel.value,
    reservation.version,
    destination.recipient_hmac
  from due_reservation reservation
  join public.reservation_settings settings
    on settings.organization_id = reservation.organization_id
   and settings.location_id = reservation.location_id
  join public.guests guest
    on guest.organization_id = reservation.organization_id
   and guest.id = reservation.guest_id
  cross join lateral (
    values
      ('24h'::text, reservation.reserved_at <= p_now + interval '24 hours'
        and reservation.reserved_at > p_now + interval '2 hours'),
      ('2h'::text, reservation.reserved_at <= p_now + interval '2 hours'
        and reservation.reserved_at > p_now)
  ) reminder(value, due)
  cross join lateral (
    select candidate.value
    from unnest(array[(
        select verification.verified_channel
        from private.public_booking_holds hold
        join private.public_booking_verifications verification
          on verification.organization_id = hold.organization_id
         and verification.location_id = hold.location_id
         and verification.booking_hold_id = hold.id
        where hold.organization_id = reservation.organization_id
          and hold.location_id = reservation.location_id
          and hold.reservation_id = reservation.id
        order by verification.consumed_at desc, verification.id
        limit 1
      )]::text[]) candidate(value)
    where candidate.value is not null
      and candidate.value = any(settings.verification_channels)
  ) channel
  left join lateral (
    select private.reservation_verified_recipient_hmac(
      reservation.organization_id,
      reservation.location_id,
      reservation.id,
      channel.value
    ) recipient_hmac
  ) destination on true
  where reminder.due
    and (
      (reminder.value = '24h'
        and 1440 = any(settings.reminder_schedule_minutes))
      or (reminder.value = '2h'
        and 120 = any(settings.reminder_schedule_minutes))
    )
    and (
      (channel.value = 'email' and guest.email is not null)
      or (channel.value = 'sms' and guest.phone is not null)
    )
    and destination.recipient_hmac is not null
  on conflict (organization_id, dedupe_key) do nothing;
  get diagnostics inserted_count = row_count;
  return inserted_count;
end
$$;

-- Public lifecycle entry points authorize the supplied location before an
-- exact reservation lookup. Missing and out-of-scope reservation identifiers
-- therefore share the same externally visible authorization failure.
alter function public.modify_reservation(
  uuid, uuid, uuid, integer, timestamptz, integer, integer, text, uuid[], text
) set schema private;
alter function private.modify_reservation(
  uuid, uuid, uuid, integer, timestamptz, integer, integer, text, uuid[], text
) rename to modify_reservation_authoritative_kernel;
revoke all on function private.modify_reservation_authoritative_kernel(
  uuid, uuid, uuid, integer, timestamptz, integer, integer, text, uuid[], text
) from public, anon, authenticated, service_role;

create function public.modify_reservation(
  p_request_id uuid,
  p_location_id uuid,
  p_reservation_id uuid,
  p_expected_version integer,
  p_reserved_at timestamptz,
  p_duration_minutes integer,
  p_party_size integer,
  p_special_requests text,
  p_table_ids uuid[],
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  current_actor_id uuid := auth.uid();
  observed_at timestamptz := clock_timestamp();
  organization_uuid uuid;
  location_date date;
begin
  if current_actor_id is null then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  if p_location_id is null or p_reservation_id is null then
    return private.modify_reservation_authoritative_kernel(
      p_request_id,
      p_location_id,
      p_reservation_id,
      p_expected_version,
      p_reserved_at,
      p_duration_minutes,
      p_party_size,
      p_special_requests,
      p_table_ids,
      p_reason
    );
  end if;
  select location.organization_id,
    (observed_at at time zone location.timezone)::date
  into organization_uuid, location_date
  from public.locations location
  where location.id = p_location_id
    and location.is_active;
  if organization_uuid is null or not public.has_capability(
    organization_uuid,
    p_location_id,
    'reservations.operate',
    location_date
  ) or not exists (
    select 1
    from public.reservations reservation
    where reservation.organization_id = organization_uuid
      and reservation.location_id = p_location_id
      and reservation.id = p_reservation_id
  ) then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  return private.modify_reservation_authoritative_kernel(
    p_request_id,
    p_location_id,
    p_reservation_id,
    p_expected_version,
    p_reserved_at,
    p_duration_minutes,
    p_party_size,
    p_special_requests,
    p_table_ids,
    p_reason
  );
end
$$;

revoke all on function public.modify_reservation(
  uuid, uuid, uuid, integer, timestamptz, integer, integer, text, uuid[], text
) from public, anon, authenticated, service_role;
grant execute on function public.modify_reservation(
  uuid, uuid, uuid, integer, timestamptz, integer, integer, text, uuid[], text
) to authenticated;

alter function public.cancel_reservation(uuid, uuid, uuid, integer, text)
set schema private;
alter function private.cancel_reservation(uuid, uuid, uuid, integer, text)
rename to cancel_reservation_authoritative_kernel;
revoke all on function private.cancel_reservation_authoritative_kernel(
  uuid, uuid, uuid, integer, text
) from public, anon, authenticated, service_role;

create function public.cancel_reservation(
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
declare
  actor_id uuid := auth.uid();
  observed_at timestamptz := clock_timestamp();
  organization_uuid uuid;
  location_date date;
begin
  if actor_id is null then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  if p_location_id is null or p_reservation_id is null then
    return private.cancel_reservation_authoritative_kernel(
      p_request_id,
      p_location_id,
      p_reservation_id,
      p_expected_version,
      p_reason
    );
  end if;
  select location.organization_id,
    (observed_at at time zone location.timezone)::date
  into organization_uuid, location_date
  from public.locations location
  where location.id = p_location_id
    and location.is_active;
  if organization_uuid is null or not public.has_capability(
    organization_uuid,
    p_location_id,
    'reservations.operate',
    location_date
  ) or not exists (
    select 1
    from public.reservations reservation
    where reservation.organization_id = organization_uuid
      and reservation.location_id = p_location_id
      and reservation.id = p_reservation_id
  ) then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  return private.cancel_reservation_authoritative_kernel(
    p_request_id,
    p_location_id,
    p_reservation_id,
    p_expected_version,
    p_reason
  );
end
$$;

revoke all on function public.cancel_reservation(
  uuid, uuid, uuid, integer, text
) from public, anon, authenticated, service_role;
grant execute on function public.cancel_reservation(
  uuid, uuid, uuid, integer, text
) to authenticated;

alter function public.service_reservation_lifecycle_head(uuid, uuid)
set schema private;
alter function private.service_reservation_lifecycle_head(uuid, uuid)
rename to reservation_lifecycle_head_authoritative_kernel;
revoke all on function private.reservation_lifecycle_head_authoritative_kernel(
  uuid, uuid
) from public, anon, authenticated, service_role;

create function public.service_reservation_lifecycle_head(
  p_location_id uuid,
  p_reservation_id uuid
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  organization_uuid uuid;
  location_date date;
begin
  if actor_id is null or p_location_id is null or p_reservation_id is null then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  select location.organization_id,
    (clock_timestamp() at time zone location.timezone)::date
  into organization_uuid, location_date
  from public.locations location
  where location.id = p_location_id
    and location.is_active;
  if organization_uuid is null or not public.has_capability(
    organization_uuid,
    p_location_id,
    'reservations.operate',
    location_date
  ) or not exists (
    select 1
    from public.reservations reservation
    where reservation.organization_id = organization_uuid
      and reservation.location_id = p_location_id
      and reservation.id = p_reservation_id
  ) then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  return private.reservation_lifecycle_head_authoritative_kernel(
    p_location_id,
    p_reservation_id
  );
end
$$;

revoke all on function public.service_reservation_lifecycle_head(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.service_reservation_lifecycle_head(uuid, uuid)
to authenticated;

create or replace function public.save_reservation(
  p_request_id uuid,
  p_location_id uuid,
  p_reservation_id uuid,
  p_guest_id uuid,
  p_reserved_at timestamptz,
  p_duration_minutes integer,
  p_party_size integer,
  p_special_requests text,
  p_source text,
  p_table_ids uuid[]
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  current_actor_id uuid := auth.uid();
  observed_at timestamptz := clock_timestamp();
  organization_uuid uuid;
  location_date date;
  target_reservation_id uuid := coalesce(p_reservation_id, p_request_id);
begin
  if current_actor_id is null then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  if p_location_id is null or target_reservation_id is null then
    return private.save_reservation_create_kernel(
      p_request_id,
      p_location_id,
      p_reservation_id,
      p_guest_id,
      p_reserved_at,
      p_duration_minutes,
      p_party_size,
      p_special_requests,
      p_source,
      p_table_ids
    );
  end if;
  select location.organization_id,
    (observed_at at time zone location.timezone)::date
  into organization_uuid, location_date
  from public.locations location
  where location.id = p_location_id
    and location.is_active;
  if organization_uuid is null or not public.has_capability(
    organization_uuid,
    p_location_id,
    'reservations.operate',
    location_date
  ) then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  if exists (
    select 1
    from public.reservations reservation
    where reservation.organization_id = organization_uuid
      and reservation.location_id = p_location_id
      and reservation.id = target_reservation_id
  ) and not exists (
    select 1
    from private.operation_requests request
    where request.request_id = p_request_id
      and request.operation_kind = 'reservation.save'
      and request.organization_id = organization_uuid
      and request.location_id = p_location_id
      and request.record_id = target_reservation_id
      and request.actor_id = current_actor_id
      and request.completed_at is not null
  ) then
    raise exception 'Use the versioned reservation modification command'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.reservations reservation
    where reservation.id = target_reservation_id
      and (
        reservation.organization_id <> organization_uuid
        or reservation.location_id <> p_location_id
      )
  ) then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  return private.save_reservation_create_kernel(
    p_request_id,
    p_location_id,
    p_reservation_id,
    p_guest_id,
    p_reserved_at,
    p_duration_minutes,
    p_party_size,
    p_special_requests,
    p_source,
    p_table_ids
  );
end
$$;

revoke all on function public.save_reservation(
  uuid, uuid, uuid, uuid, timestamptz, integer, integer, text, text, uuid[]
) from public, anon, authenticated, service_role;
grant execute on function public.save_reservation(
  uuid, uuid, uuid, uuid, timestamptz, integer, integer, text, text, uuid[]
) to authenticated;

create or replace function public.transition_reservation(
  p_request_id uuid,
  p_reservation_id uuid,
  p_target_status text,
  p_note text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if p_target_status = 'cancelled' then
    raise exception 'Use the versioned reservation cancellation command'
      using errcode = '23514';
  end if;
  if auth.uid() is null or p_reservation_id is null then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.reservations reservation
    join public.locations location
      on location.organization_id = reservation.organization_id
     and location.id = reservation.location_id
     and location.is_active
    where reservation.id = p_reservation_id
      and public.has_capability(
        reservation.organization_id,
        reservation.location_id,
        'reservations.operate',
        (clock_timestamp() at time zone location.timezone)::date
      )
  ) then
    raise exception 'Reservation operating access is required'
      using errcode = '42501';
  end if;
  return private.transition_reservation_kernel(
    p_request_id,
    p_reservation_id,
    p_target_status,
    p_note
  );
end
$$;

-- Tie every revision to the exact operation kind as well as its request,
-- tenant, location, reservation, actor, and payload hash. Generated operation
-- kind prevents callers from supplying a contradictory value.
alter table private.operation_requests
add constraint operation_requests_lifecycle_kind_evidence_key
unique (
  request_id,
  operation_kind,
  organization_id,
  location_id,
  record_id,
  actor_id,
  payload_hash
);

alter table public.reservation_revisions
add column operation_kind text generated always as (
  case mutation_kind
    when 'staff_modified' then 'reservation.modify'
    when 'staff_cancelled' then 'reservation.cancel'
  end
) stored;

alter table public.reservation_revisions
add constraint reservation_revisions_operation_kind_check
check (operation_kind is not null) not valid;

alter table public.reservation_revisions
add constraint reservation_revisions_operation_evidence_fkey
foreign key (
  request_id,
  operation_kind,
  organization_id,
  location_id,
  reservation_id,
  actor_id,
  payload_hash
) references private.operation_requests (
  request_id,
  operation_kind,
  organization_id,
  location_id,
  record_id,
  actor_id,
  payload_hash
) on delete restrict not valid;

alter table public.reservation_revisions
add constraint reservation_revisions_version_chain_check
check (
  coalesce(before_state ->> 'version', '') ~ '^[1-9][0-9]*$'
  and coalesce(after_state ->> 'version', '') ~ '^[1-9][0-9]*$'
  and (before_state ->> 'version')::integer = version - 1
  and (after_state ->> 'version')::integer = version
) not valid;

alter table public.reservation_revisions
add constraint reservation_revisions_mutation_state_check
check (
  (
    mutation_kind = 'staff_modified'
    and before_state ->> 'status' = after_state ->> 'status'
    and after_state ->> 'status' in ('booked', 'confirmed')
  )
  or (
    mutation_kind = 'staff_cancelled'
    and before_state ->> 'status' in ('booked', 'confirmed', 'arrived')
    and after_state ->> 'status' = 'cancelled'
  )
) not valid;

alter table public.reservation_revisions
add constraint reservation_revisions_result_identity_check
check (
  result_evidence ->> 'id' = reservation_id::text
  and result_evidence ->> 'revisionId' = id::text
  and result_evidence ->> 'version' = version::text
  and result_evidence ->> 'revisionKind' = mutation_kind
  and result_evidence ->> 'status' = after_state ->> 'status'
) not valid;
