-- A queued table-ready message is not a delivered offer. Keep the offer expiry
-- at infinity while delivery is pending, then start the real 15-minute clock
-- only in the same transaction that records provider acceptance.

create or replace function public.transition_waitlist_entry(
  p_request_id uuid,
  p_waitlist_entry_id uuid,
  p_target_status text,
  p_note text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  waitlist_row public.waitlist_entries%rowtype;
  previous_status text;
  delivery_status text;
begin
  if actor_id is null or p_request_id is null or p_waitlist_entry_id is null
    or p_target_status not in ('notified', 'accepted', 'expired', 'cancelled')
    or length(coalesce(p_note, '')) > 1000 then
    raise exception 'A valid waitlist transition is required' using errcode = '22023';
  end if;
  select * into waitlist_row from public.waitlist_entries entry
  where entry.id = p_waitlist_entry_id for update;
  if waitlist_row.id is null then
    raise exception 'Waitlist entry not found' using errcode = 'P0002';
  end if;
  if not public.has_capability(
    waitlist_row.organization_id,
    waitlist_row.location_id,
    'reservations.operate'
  ) then
    raise exception 'Reservation operating access is required' using errcode = '42501';
  end if;
  if not (
    (waitlist_row.status = 'waiting' and p_target_status in ('notified', 'expired', 'cancelled'))
    or (waitlist_row.status = 'notified' and p_target_status in ('accepted', 'expired', 'cancelled'))
    or (waitlist_row.status = 'accepted' and p_target_status = 'cancelled')
  ) then
    raise exception 'Invalid waitlist transition' using errcode = '23514';
  end if;
  if p_target_status = 'accepted' and (
    waitlist_row.notified_at is null
    or waitlist_row.offer_expires_at is null
    or waitlist_row.offer_expires_at = 'infinity'::timestamptz
    or waitlist_row.offer_expires_at <= clock_timestamp()
  ) then
    raise exception 'The table-ready message has not been delivered or its offer expired'
      using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'waitlist.transition',
    waitlist_row.organization_id,
    waitlist_row.location_id,
    waitlist_row.id,
    jsonb_build_object('targetStatus', p_target_status, 'note', nullif(btrim(p_note), ''))
  ) then
    select case
      when bool_or(message.status in ('sent', 'delivered')) then 'sent'
      when bool_or(message.status = 'sending') then 'sending'
      when bool_or(message.status = 'queued') then 'queued'
      when bool_or(message.status = 'failed') then 'failed'
      else null
    end into delivery_status
    from public.reservation_message_outbox message
    where message.waitlist_entry_id = waitlist_row.id
      and message.template_key = 'waitlist_table_ready';
    return jsonb_build_object(
      'id', waitlist_row.id,
      'status', waitlist_row.status,
      'deliveryStatus', delivery_status,
      'replayed', true
    );
  end if;
  previous_status := waitlist_row.status;
  update public.waitlist_entries entry set
    status = p_target_status,
    notified_at = case when p_target_status = 'notified' then null else entry.notified_at end,
    offer_expires_at = case
      when p_target_status = 'notified' then 'infinity'::timestamptz
      else entry.offer_expires_at
    end,
    notes = coalesce(nullif(btrim(p_note), ''), entry.notes),
    updated_at = clock_timestamp()
  where entry.id = waitlist_row.id returning * into waitlist_row;
  if p_target_status = 'notified' then
    insert into public.reservation_message_outbox (
      organization_id, location_id, waitlist_entry_id, guest_id,
      channel, template_key, template_data, dedupe_key
    ) values
      (waitlist_row.organization_id, waitlist_row.location_id, waitlist_row.id,
       waitlist_row.guest_id, 'sms', 'waitlist_table_ready',
       jsonb_build_object('channel', 'sms'),
       'waitlist:' || waitlist_row.id::text || ':ready:sms'),
      (waitlist_row.organization_id, waitlist_row.location_id, waitlist_row.id,
       waitlist_row.guest_id, 'email', 'waitlist_table_ready',
       jsonb_build_object('channel', 'email'),
       'waitlist:' || waitlist_row.id::text || ':ready:email')
    on conflict (organization_id, dedupe_key) do nothing;
    delivery_status := 'queued';
  end if;
  insert into public.audit_events (
    organization_id, location_id, actor_id, action, table_name,
    record_id, new_record, request_id, metadata
  ) values (
    waitlist_row.organization_id,
    waitlist_row.location_id,
    actor_id,
    case when p_target_status = 'notified'
      then 'waitlist_offer_delivery_queued'
      else 'waitlist_status_changed'
    end,
    'waitlist_entries',
    waitlist_row.id::text,
    jsonb_build_object(
      'fromStatus', previous_status,
      'toStatus', waitlist_row.status,
      'offerClockStarted', waitlist_row.notified_at is not null
    ),
    p_request_id::text,
    jsonb_build_object('deliveryStatus', delivery_status)
  );
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object(
    'id', waitlist_row.id,
    'status', waitlist_row.status,
    'deliveryStatus', delivery_status,
    'replayed', false
  );
end
$$;

revoke all on function public.transition_waitlist_entry(uuid, uuid, text, text)
from public, anon, authenticated, service_role;
grant execute on function public.transition_waitlist_entry(uuid, uuid, text, text)
to authenticated;

create function private.start_waitlist_offer_after_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  started boolean := false;
begin
  if new.template_key <> 'waitlist_table_ready'
    or new.waitlist_entry_id is null
    or new.status not in ('sent', 'delivered')
    or old.status in ('sent', 'delivered') then
    return new;
  end if;

  update public.waitlist_entries entry
  set notified_at = clock_timestamp(),
      offer_expires_at = clock_timestamp() + interval '15 minutes',
      updated_at = clock_timestamp()
  where entry.organization_id = new.organization_id
    and entry.location_id = new.location_id
    and entry.id = new.waitlist_entry_id
    and entry.status = 'notified'
    and entry.notified_at is null
    and entry.offer_expires_at = 'infinity'::timestamptz;
  started := found;

  if started then
    insert into public.audit_events (
      organization_id, location_id, action, table_name, record_id,
      new_record, metadata
    ) values (
      new.organization_id,
      new.location_id,
      'waitlist_offer_delivery_confirmed',
      'waitlist_entries',
      new.waitlist_entry_id::text,
      jsonb_build_object(
        'status', 'notified',
        'notifiedAt', clock_timestamp(),
        'offerExpiresAt', clock_timestamp() + interval '15 minutes'
      ),
      jsonb_build_object(
        'actorKind', 'system',
        'outboxMessageId', new.id,
        'channel', new.channel,
        'providerMessageId', new.provider_message_id
      )
    );
  end if;
  return new;
end
$$;

revoke all on function private.start_waitlist_offer_after_delivery()
from public, anon, authenticated, service_role;

create trigger reservation_message_waitlist_offer_start
after update of status on public.reservation_message_outbox
for each row execute function private.start_waitlist_offer_after_delivery();

comment on function private.start_waitlist_offer_after_delivery() is
'Starts the waitlist offer clock only after an outbox message records provider-accepted delivery.';
