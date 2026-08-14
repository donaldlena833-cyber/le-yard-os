-- Reservation staff-push delivery is a service-only leased outbox.
--
-- A claim lease is recoverable until the worker durably records that it is
-- about to contact the Web Push provider. Once a provider attempt begins, an
-- expired lease becomes `uncertain` instead of being replayed automatically:
-- the Web Push protocol has no generally available idempotency key that can
-- prove whether an accepted request reached a device.

alter table public.push_subscriptions
  add constraint push_subscriptions_organization_id_id_key
  unique (organization_id, id);

alter table public.reservation_push_deliveries
  drop constraint reservation_push_deliveries_status_check;

alter table public.reservation_push_deliveries
  add column claim_token uuid,
  add column claimed_by uuid,
  add column claimed_at timestamptz,
  add column lease_expires_at timestamptz,
  add column next_attempt_at timestamptz,
  add column provider_attempted_at timestamptz,
  add column last_provider_status_code integer,
  add constraint reservation_push_deliveries_status_check
    check (status in (
      'queued', 'claimed', 'dispatching', 'sent', 'failed', 'cancelled',
      'uncertain'
    )),
  add constraint reservation_push_deliveries_claim_state_check check (
    (
      status in ('claimed', 'dispatching')
      and claim_token is not null
      and claimed_by is not null
      and claimed_at is not null
      and lease_expires_at is not null
      and lease_expires_at > claimed_at
    )
    or (
      status not in ('claimed', 'dispatching')
      and claim_token is null
      and claimed_by is null
      and claimed_at is null
      and lease_expires_at is null
    )
  ),
  add constraint reservation_push_deliveries_provider_attempt_check check (
    status <> 'dispatching' or provider_attempted_at is not null
  ),
  add constraint reservation_push_deliveries_provider_status_check check (
    last_provider_status_code is null
    or last_provider_status_code between 100 and 599
  ),
  add constraint reservation_push_deliveries_notification_org_fk
    foreign key (organization_id, notification_id)
    references public.notifications(organization_id, id) on delete cascade,
  add constraint reservation_push_deliveries_subscription_org_fk
    foreign key (organization_id, subscription_id)
    references public.push_subscriptions(organization_id, id) on delete cascade;

update public.reservation_push_deliveries
set next_attempt_at = coalesce(next_attempt_at, updated_at, created_at)
where status in ('queued', 'failed') and next_attempt_at is null;

create index reservation_push_deliveries_claimable_idx
on public.reservation_push_deliveries (
  status, next_attempt_at, lease_expires_at, created_at, id
)
where status in ('queued', 'claimed', 'failed', 'dispatching');

create table private.reservation_push_subscription_blocks (
  subscription_id uuid primary key
    references public.push_subscriptions(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  error_code text not null check (length(btrim(error_code)) between 1 and 120),
  blocked_at timestamptz not null,
  foreign key (organization_id, subscription_id)
    references public.push_subscriptions(organization_id, id) on delete cascade
);

revoke all on table private.reservation_push_subscription_blocks
from public, anon, authenticated, service_role;

create function private.clear_reservation_push_subscription_block()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  delete from private.reservation_push_subscription_blocks block
  where block.organization_id = new.organization_id
    and block.subscription_id = new.id;
  return new;
end
$$;

revoke all on function private.clear_reservation_push_subscription_block()
from public, anon, authenticated, service_role;

create trigger push_subscriptions_clear_delivery_block
after update of encrypted_subscription on public.push_subscriptions
for each row execute function private.clear_reservation_push_subscription_block();

create function public.service_claim_reservation_push_deliveries(
  p_worker_id uuid,
  p_limit integer,
  p_lease_seconds integer,
  p_now timestamptz
)
returns table (
  id uuid,
  "claimToken" uuid,
  "organizationId" uuid,
  "notificationId" uuid,
  "subscriptionId" uuid,
  attempts integer,
  "deliveryTopic" text
)
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_worker_id is null or p_limit not between 1 and 100
    or p_lease_seconds not between 15 and 900 or p_now is null then
    raise exception 'A valid reservation push claim is required'
      using errcode = '22023';
  end if;

  -- A provider call may already have succeeded. Resolve expired dispatch
  -- leases to a terminal/manual-review state and never replay them.
  with stale as (
    select delivery.id
    from public.reservation_push_deliveries delivery
    where delivery.status = 'dispatching'
      and delivery.lease_expires_at <= p_now
    order by delivery.lease_expires_at, delivery.id
    limit p_limit
    for update skip locked
  )
  update public.reservation_push_deliveries delivery
  set status = 'uncertain',
      last_error_code = 'provider_outcome_unknown_after_lease',
      claim_token = null,
      claimed_by = null,
      claimed_at = null,
      lease_expires_at = null,
      updated_at = p_now
  from stale
  where delivery.id = stale.id;

  -- Materialize only currently eligible notification/subscription pairs.
  -- The same eligibility is checked again when the provider attempt begins.
  with eligible as (
    select
      notification.organization_id,
      notification.id as notification_id,
      subscription.id as subscription_id
    from public.notifications notification
    join public.notification_preferences preference
      on preference.organization_id = notification.organization_id
     and preference.user_id = notification.user_id
     and preference.notification_type = notification.notification_type
     and preference.push
    join public.reservations reservation
      on reservation.organization_id = notification.organization_id
     and reservation.id = notification.entity_id
    join public.reservation_settings settings
      on settings.organization_id = reservation.organization_id
     and settings.location_id = reservation.location_id
     and settings.approved_at is not null
     and settings.staff_push_enabled
    join public.push_subscriptions subscription
      on subscription.organization_id = notification.organization_id
     and subscription.user_id = notification.user_id
    where notification.notification_type = 'reservation_changed'
      and notification.read_at is null
      and notification.created_at >= p_now - interval '48 hours'
      and not exists (
        select 1
        from private.reservation_push_subscription_blocks block
        where block.organization_id = subscription.organization_id
          and block.subscription_id = subscription.id
      )
      and not exists (
        select 1
        from public.reservation_push_deliveries delivery
        where delivery.notification_id = notification.id
          and delivery.subscription_id = subscription.id
      )
    order by notification.created_at, notification.id, subscription.id
    limit p_limit * 4
  )
  insert into public.reservation_push_deliveries (
    organization_id, notification_id, subscription_id, status,
    attempts, next_attempt_at, created_at, updated_at
  )
  select
    eligible.organization_id, eligible.notification_id,
    eligible.subscription_id, 'queued', 0, p_now, p_now, p_now
  from eligible
  on conflict (notification_id, subscription_id) do nothing;

  return query
  with candidates as (
    select delivery.id
    from public.reservation_push_deliveries delivery
    join public.notifications notification
      on notification.organization_id = delivery.organization_id
     and notification.id = delivery.notification_id
    join public.notification_preferences preference
      on preference.organization_id = notification.organization_id
     and preference.user_id = notification.user_id
     and preference.notification_type = notification.notification_type
     and preference.push
    join public.reservations reservation
      on reservation.organization_id = notification.organization_id
     and reservation.id = notification.entity_id
    join public.reservation_settings settings
      on settings.organization_id = reservation.organization_id
     and settings.location_id = reservation.location_id
     and settings.approved_at is not null
     and settings.staff_push_enabled
    join public.push_subscriptions subscription
      on subscription.organization_id = delivery.organization_id
     and subscription.id = delivery.subscription_id
     and subscription.user_id = notification.user_id
    where notification.notification_type = 'reservation_changed'
      and notification.read_at is null
      and notification.created_at >= p_now - interval '48 hours'
      and delivery.attempts < 5
      and (
        (delivery.status = 'queued'
          and coalesce(delivery.next_attempt_at, delivery.created_at) <= p_now)
        or (delivery.status = 'failed'
          and delivery.next_attempt_at is not null
          and delivery.next_attempt_at <= p_now)
        or (delivery.status = 'claimed'
          and delivery.lease_expires_at <= p_now)
      )
      and not exists (
        select 1
        from private.reservation_push_subscription_blocks block
        where block.organization_id = delivery.organization_id
          and block.subscription_id = delivery.subscription_id
      )
    order by
      case when delivery.status = 'claimed' then 0 else 1 end,
      coalesce(delivery.lease_expires_at, delivery.next_attempt_at),
      delivery.created_at,
      delivery.id
    limit p_limit
    for update of delivery skip locked
  ), claimed as (
    update public.reservation_push_deliveries delivery
    set status = 'claimed',
        claim_token = gen_random_uuid(),
        claimed_by = p_worker_id,
        claimed_at = p_now,
        lease_expires_at = p_now + make_interval(secs => p_lease_seconds),
        last_error_code = null,
        updated_at = p_now
    from candidates
    where delivery.id = candidates.id
    returning delivery.*
  )
  select
    claimed.id,
    claimed.claim_token,
    claimed.organization_id,
    claimed.notification_id,
    claimed.subscription_id,
    claimed.attempts,
    substring(replace(claimed.id::text, '-', '') from 1 for 32)
  from claimed
  order by claimed.created_at, claimed.id;
end
$$;

create function public.service_begin_reservation_push_delivery(
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
  delivery public.reservation_push_deliveries%rowtype;
  current_encrypted_subscription bytea;
  current_title text;
  current_body text;
  current_action_url text;
  current_entity_id uuid;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_id is null or p_claim_token is null or p_now is null then
    raise exception 'A valid reservation push dispatch is required'
      using errcode = '22023';
  end if;

  select * into delivery
  from public.reservation_push_deliveries candidate
  where candidate.id = p_id
  for update;

  if delivery.id is null or delivery.status <> 'claimed'
    or delivery.claim_token <> p_claim_token
    or delivery.lease_expires_at <= p_now then
    raise exception 'The reservation push claim is unavailable'
      using errcode = 'P0002';
  end if;

  -- Re-read and lock every provider-facing input at the durable dispatch
  -- boundary. Claim output is intentionally opaque so a subscription rotation,
  -- opt-out, settings disable, notification read, or content update that commits
  -- before this point can never be sent from stale worker memory.
  select
    subscription.encrypted_subscription,
    notification.title,
    notification.body,
    notification.action_url,
    notification.entity_id
  into
    current_encrypted_subscription,
    current_title,
    current_body,
    current_action_url,
    current_entity_id
  from public.notifications notification
  join public.notification_preferences preference
    on preference.organization_id = notification.organization_id
   and preference.user_id = notification.user_id
   and preference.notification_type = notification.notification_type
   and preference.push
  join public.reservations reservation
    on reservation.organization_id = notification.organization_id
   and reservation.id = notification.entity_id
  join public.reservation_settings settings
    on settings.organization_id = reservation.organization_id
   and settings.location_id = reservation.location_id
   and settings.approved_at is not null
   and settings.staff_push_enabled
  join public.push_subscriptions subscription
    on subscription.organization_id = delivery.organization_id
   and subscription.id = delivery.subscription_id
   and subscription.user_id = notification.user_id
  where notification.organization_id = delivery.organization_id
    and notification.id = delivery.notification_id
    and notification.notification_type = 'reservation_changed'
    and notification.read_at is null
    and notification.created_at >= p_now - interval '48 hours'
    and not exists (
      select 1
      from private.reservation_push_subscription_blocks block
      where block.organization_id = delivery.organization_id
        and block.subscription_id = delivery.subscription_id
    )
  for share of notification, preference, reservation, settings, subscription;

  if not found then
    update public.reservation_push_deliveries candidate
    set status = 'cancelled',
        last_error_code = 'delivery_no_longer_eligible',
        next_attempt_at = null,
        claim_token = null,
        claimed_by = null,
        claimed_at = null,
        lease_expires_at = null,
        updated_at = p_now
    where candidate.id = delivery.id;
    return jsonb_build_object(
      'id', delivery.id,
      'status', 'cancelled',
      'attempts', delivery.attempts
    );
  end if;

  if delivery.attempts >= 5 then
    raise exception 'The reservation push attempt limit was reached'
      using errcode = '22023';
  end if;

  update public.reservation_push_deliveries candidate
  set status = 'dispatching',
      attempts = candidate.attempts + 1,
      next_attempt_at = null,
      provider_attempted_at = p_now,
      updated_at = p_now
  where candidate.id = delivery.id
  returning * into delivery;

  return jsonb_build_object(
    'id', delivery.id,
    'status', delivery.status,
    'attempts', delivery.attempts,
    'encryptedSubscription', current_encrypted_subscription,
    'title', current_title,
    'body', current_body,
    'actionUrl', current_action_url,
    'entityId', current_entity_id,
    'deliveryTopic', substring(replace(delivery.id::text, '-', '') from 1 for 32)
  );
end
$$;

create function public.service_complete_reservation_push_delivery(
  p_id uuid,
  p_claim_token uuid,
  p_status text,
  p_error_code text,
  p_next_attempt_at timestamptz,
  p_provider_status_code integer,
  p_block_subscription boolean,
  p_now timestamptz
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  delivery public.reservation_push_deliveries%rowtype;
begin
  if (select auth.role()) <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_id is null or p_claim_token is null or p_now is null
    or p_status not in ('sent', 'failed', 'cancelled', 'uncertain')
    or length(coalesce(p_error_code, '')) > 120
    or (p_provider_status_code is not null
      and p_provider_status_code not between 100 and 599)
    or (p_status = 'sent' and (
      p_error_code is not null or p_next_attempt_at is not null
      or p_block_subscription
    ))
    or (p_status = 'uncertain' and (
      nullif(btrim(coalesce(p_error_code, '')), '') is null
      or p_next_attempt_at is not null or p_block_subscription
    ))
    or (p_status = 'cancelled' and p_next_attempt_at is not null)
    or (p_status = 'failed' and (
      p_block_subscription
      or nullif(btrim(coalesce(p_error_code, '')), '') is null
      or (p_next_attempt_at is not null and p_next_attempt_at <= p_now)
    ))
    or (p_block_subscription and p_status <> 'cancelled') then
    raise exception 'A valid reservation push completion is required'
      using errcode = '22023';
  end if;

  select * into delivery
  from public.reservation_push_deliveries candidate
  where candidate.id = p_id
  for update;

  if delivery.id is null
    or delivery.claim_token <> p_claim_token
    or delivery.status not in ('claimed', 'dispatching')
    or (delivery.status = 'claimed' and delivery.lease_expires_at <= p_now)
    or (delivery.status = 'claimed' and p_status <> 'cancelled')
    or (delivery.status = 'claimed' and p_provider_status_code is not null)
    or (delivery.status = 'dispatching' and p_status = 'failed'
      and p_next_attempt_at is not null and delivery.attempts >= 5) then
    raise exception 'The reservation push claim is unavailable'
      using errcode = 'P0002';
  end if;

  if p_block_subscription then
    insert into private.reservation_push_subscription_blocks (
      subscription_id, organization_id, error_code, blocked_at
    ) values (
      delivery.subscription_id, delivery.organization_id,
      coalesce(nullif(btrim(p_error_code), ''), 'subscription_invalid'), p_now
    )
    on conflict (subscription_id) do update
    set organization_id = excluded.organization_id,
        error_code = excluded.error_code,
        blocked_at = excluded.blocked_at;
  end if;

  update public.reservation_push_deliveries candidate
  set status = p_status,
      last_error_code = case
        when p_status = 'sent' then null else nullif(btrim(p_error_code), '')
      end,
      last_provider_status_code = p_provider_status_code,
      next_attempt_at = case
        when p_status = 'failed' then p_next_attempt_at else null
      end,
      sent_at = case when p_status = 'sent' then p_now else candidate.sent_at end,
      claim_token = null,
      claimed_by = null,
      claimed_at = null,
      lease_expires_at = null,
      updated_at = p_now
  where candidate.id = delivery.id
  returning * into delivery;

  return jsonb_build_object(
    'id', delivery.id,
    'status', delivery.status,
    'attempts', delivery.attempts,
    'nextAttemptAt', delivery.next_attempt_at
  );
end
$$;

revoke all on table public.reservation_push_deliveries from service_role;

revoke all on function public.service_claim_reservation_push_deliveries(
  uuid, integer, integer, timestamptz
) from public;
revoke all on function public.service_begin_reservation_push_delivery(
  uuid, uuid, timestamptz
) from public;
revoke all on function public.service_complete_reservation_push_delivery(
  uuid, uuid, text, text, timestamptz, integer, boolean, timestamptz
) from public;

grant execute on function public.service_claim_reservation_push_deliveries(
  uuid, integer, integer, timestamptz
) to service_role;
grant execute on function public.service_begin_reservation_push_delivery(
  uuid, uuid, timestamptz
) to service_role;
grant execute on function public.service_complete_reservation_push_delivery(
  uuid, uuid, text, text, timestamptz, integer, boolean, timestamptz
) to service_role;

comment on function public.service_claim_reservation_push_deliveries(
  uuid, integer, integer, timestamptz
) is 'Atomically materializes and leases opaque eligible reservation push identities; stale pre-provider claims recover while stale provider attempts become uncertain.';
comment on function public.service_begin_reservation_push_delivery(
  uuid, uuid, timestamptz
) is 'Locks and revalidates current reservation push inputs, durably begins the attempt, and returns the exact provider dispatch payload.';
comment on function public.service_complete_reservation_push_delivery(
  uuid, uuid, text, text, timestamptz, integer, boolean, timestamptz
) is 'Completes only the exact reservation push claim token and optionally blocks an invalid subscription without deleting delivery evidence.';
