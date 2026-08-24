-- Durable scheduler truth and actor-authorized waitlist recovery. Cron/provider
-- activation remains an explicit environment action outside this migration.

create table private.reservation_delivery_worker_runs (
  id uuid primary key,
  trigger_source text not null check (trigger_source in ('cron','opportunistic','manual','canary')),
  status text not null default 'running' check (status in ('running','succeeded','partially_succeeded','failed')),
  started_at timestamptz not null default clock_timestamp(),
  completed_at timestamptz,
  queue_due_at_start integer not null default 0 check (queue_due_at_start >= 0),
  oldest_due_at_start timestamptz,
  sent integer not null default 0 check (sent >= 0),
  failed integer not null default 0 check (failed >= 0),
  skipped integer not null default 0 check (skipped >= 0),
  completion_errors integer not null default 0 check (completion_errors >= 0),
  error_code text,
  created_at timestamptz not null default clock_timestamp(),
  check ((status = 'running' and completed_at is null) or (status <> 'running' and completed_at is not null))
);
revoke all on table private.reservation_delivery_worker_runs from public, anon, authenticated;
grant select, insert, update on table private.reservation_delivery_worker_runs to service_role;

create index reservation_delivery_worker_runs_recent_idx
on private.reservation_delivery_worker_runs (started_at desc);

create function public.service_begin_reservation_delivery_run(
  p_run_id uuid,
  p_trigger_source text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare due_count integer; oldest_due timestamptz;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_run_id is null or p_trigger_source not in ('cron','opportunistic','manual','canary') then
    raise exception 'Invalid reservation delivery run' using errcode = '22023';
  end if;
  select count(*)::integer, min(next_attempt_at)
  into due_count, oldest_due
  from public.reservation_message_outbox message
  where message.status in ('queued','failed')
    and message.next_attempt_at <= clock_timestamp();
  insert into private.reservation_delivery_worker_runs (
    id, trigger_source, queue_due_at_start, oldest_due_at_start
  ) values (p_run_id, p_trigger_source, due_count, oldest_due)
  on conflict (id) do nothing;
  return jsonb_build_object('runId', p_run_id, 'queueDue', due_count,
    'oldestDueAt', oldest_due);
end
$$;

create function public.service_complete_reservation_delivery_run(
  p_run_id uuid,
  p_status text,
  p_sent integer,
  p_failed integer,
  p_skipped integer,
  p_completion_errors integer,
  p_error_code text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare run private.reservation_delivery_worker_runs%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_status not in ('succeeded','partially_succeeded','failed')
    or least(p_sent,p_failed,p_skipped,p_completion_errors) < 0 then
    raise exception 'Invalid reservation delivery completion' using errcode = '22023';
  end if;
  update private.reservation_delivery_worker_runs candidate
  set status = p_status, completed_at = clock_timestamp(), sent = p_sent,
      failed = p_failed, skipped = p_skipped,
      completion_errors = p_completion_errors,
      error_code = left(nullif(btrim(p_error_code), ''), 120)
  where candidate.id = p_run_id and candidate.status = 'running'
  returning * into run;
  if not found then
    raise exception 'Reservation delivery run is unavailable' using errcode = 'P0002';
  end if;
  return jsonb_build_object('runId', run.id, 'status', run.status);
end
$$;

create function public.service_reservation_delivery_health()
returns jsonb
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select jsonb_build_object(
    'latestStartedAt', latest.started_at,
    'latestCompletedAt', latest.completed_at,
    'latestStatus', latest.status,
    'latestTriggerSource', latest.trigger_source,
    'queueDue', (
      select count(*)::integer from public.reservation_message_outbox message
      where message.status in ('queued','failed')
        and message.next_attempt_at <= clock_timestamp()
    ),
    'oldestDueAt', (
      select min(message.next_attempt_at) from public.reservation_message_outbox message
      where message.status in ('queued','failed')
        and message.next_attempt_at <= clock_timestamp()
    ),
    'fresh', coalesce(latest.completed_at >= clock_timestamp() - interval '10 minutes', false)
  )
  from (select 1) seed
  left join lateral (
    select run.* from private.reservation_delivery_worker_runs run
    order by run.started_at desc limit 1
  ) latest on true
$$;

alter table public.waitlist_entries
  add column if not exists fallback_channel text,
  add column if not exists escalation_state text not null default 'none',
  add column if not exists previous_status text,
  add column if not exists removed_at timestamptz,
  add column if not exists removed_by uuid references auth.users(id) on delete set null,
  add column if not exists removal_reason text,
  add column if not exists reinstated_at timestamptz,
  add constraint waitlist_fallback_channel_check
    check (fallback_channel is null or fallback_channel in ('email','sms')),
  add constraint waitlist_escalation_state_check
    check (escalation_state in ('none','manager_attention','guest_contact_required','resolved')),
  add constraint waitlist_previous_status_check
    check (previous_status is null or previous_status in ('waiting','notified','accepted'));

create function private.capture_waitlist_removal_evidence()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status = 'cancelled' and old.status <> 'cancelled' then
    new.previous_status := old.status;
    new.removed_at := clock_timestamp();
    new.removed_by := auth.uid();
    new.removal_reason := coalesce(nullif(btrim(new.notes), ''), 'Removed from waitlist');
    new.reinstated_at := null;
  end if;
  return new;
end
$$;
create trigger capture_waitlist_removal_evidence
before update of status on public.waitlist_entries
for each row execute function private.capture_waitlist_removal_evidence();

create function private.project_waitlist_delivery_escalation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.template_key <> 'waitlist_table_ready'
    or new.waitlist_entry_id is null then
    return new;
  end if;
  if new.status = 'failed' and old.status <> 'failed' then
    update public.waitlist_entries entry
    set escalation_state = case
          when new.attempts >= new.max_attempts then 'guest_contact_required'
          when new.attempts >= 3 and entry.escalation_state = 'none'
            then 'manager_attention'
          else entry.escalation_state
        end,
        updated_at = clock_timestamp()
    where entry.id = new.waitlist_entry_id
      and entry.status = 'notified';
  elsif new.status = 'sent' and old.status <> 'sent' then
    update public.waitlist_entries entry
    set escalation_state = case
          when entry.escalation_state = 'none' then 'none'
          else 'resolved'
        end,
        updated_at = clock_timestamp()
    where entry.id = new.waitlist_entry_id;
  end if;
  return new;
end
$$;
create trigger project_waitlist_delivery_escalation
after update of status on public.reservation_message_outbox
for each row execute function private.project_waitlist_delivery_escalation();

create function public.retry_waitlist_delivery(
  p_request_id uuid,
  p_waitlist_entry_id uuid,
  p_channel text,
  p_escalation_state text,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  entry public.waitlist_entries%rowtype;
  message public.reservation_message_outbox%rowtype;
begin
  if auth.uid() is null or p_request_id is null or p_channel not in ('email','sms')
    or p_escalation_state not in ('none','manager_attention','guest_contact_required')
    or length(btrim(coalesce(p_reason, ''))) not between 4 and 1000 then
    raise exception 'Valid waitlist recovery evidence is required' using errcode = '22023';
  end if;
  select * into entry from public.waitlist_entries candidate
  where candidate.id = p_waitlist_entry_id for update;
  if not found or not public.has_capability(
    entry.organization_id, entry.location_id, 'reservations.operate'
  ) then
    raise exception 'Waitlist operating access is required' using errcode = '42501';
  end if;
  if entry.status <> 'notified' then
    raise exception 'Only an active notified offer can be retried' using errcode = '23514';
  end if;
  if (entry.escalation_state = 'manager_attention' and p_escalation_state = 'none')
    or (entry.escalation_state = 'guest_contact_required'
      and p_escalation_state <> 'guest_contact_required') then
    raise exception 'Delivery escalation cannot be silently lowered' using errcode = '23514';
  end if;
  select * into message from public.reservation_message_outbox candidate
  where candidate.waitlist_entry_id = entry.id
    and candidate.template_key = 'waitlist_table_ready'
    and candidate.channel = p_channel
  order by candidate.created_at desc limit 1 for update;
  if not found or message.status not in ('failed','cancelled') or message.attempts >= 20 then
    raise exception 'This delivery is not safely retryable' using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id, 'waitlist.delivery_retry', entry.organization_id,
    entry.location_id, entry.id,
    jsonb_build_object('channel', p_channel, 'escalationState', p_escalation_state,
      'reason', btrim(p_reason))
  ) then
    return jsonb_build_object('id', entry.id, 'status', message.status,
      'replayed', true);
  end if;
  update public.reservation_message_outbox candidate
  set status = 'queued', next_attempt_at = clock_timestamp(),
      last_error_code = null, provider_message_id = null,
      claim_token = null, claimed_by = null, claimed_at = null,
      lease_expires_at = null, updated_at = clock_timestamp()
  where candidate.id = message.id;
  update public.waitlist_entries candidate
  set fallback_channel = p_channel, escalation_state = p_escalation_state,
      notes = btrim(p_reason), updated_at = clock_timestamp()
  where candidate.id = entry.id;
  insert into public.audit_events (
    organization_id, location_id, actor_id, action, table_name, record_id,
    request_id, note, metadata
  ) values (
    entry.organization_id, entry.location_id, auth.uid(),
    'waitlist_delivery_requeued', 'waitlist_entries', entry.id::text,
    p_request_id::text, btrim(p_reason),
    jsonb_build_object('channel', p_channel, 'messageId', message.id,
      'escalationState', p_escalation_state)
  );
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object('id', entry.id, 'status', 'queued',
    'channel', p_channel, 'replayed', false);
end
$$;

create function public.undo_waitlist_removal(
  p_request_id uuid,
  p_waitlist_entry_id uuid,
  p_reason text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare entry public.waitlist_entries%rowtype; restored text;
begin
  if auth.uid() is null or p_request_id is null
    or length(btrim(coalesce(p_reason, ''))) not between 4 and 1000 then
    raise exception 'Valid waitlist reinstatement evidence is required' using errcode = '22023';
  end if;
  select * into entry from public.waitlist_entries candidate
  where candidate.id = p_waitlist_entry_id for update;
  if not found or not public.has_capability(
    entry.organization_id, entry.location_id, 'reservations.operate'
  ) then
    raise exception 'Waitlist operating access is required' using errcode = '42501';
  end if;
  if entry.status <> 'cancelled' or entry.removed_at is null
    or entry.removed_at < clock_timestamp() - interval '10 minutes'
    or entry.resulting_reservation_id is not null then
    raise exception 'This waitlist removal can no longer be undone' using errcode = '23514';
  end if;
  restored := case
    when entry.previous_status = 'notified'
      and entry.offer_expires_at > clock_timestamp() then 'notified'
    else 'waiting'
  end;
  if not private.claim_operation_request(
    p_request_id, 'waitlist.removal_undo', entry.organization_id,
    entry.location_id, entry.id, jsonb_build_object('reason', btrim(p_reason))
  ) then
    return jsonb_build_object('id', entry.id, 'status', entry.status,
      'replayed', true);
  end if;
  update public.waitlist_entries candidate
  set status = restored, reinstated_at = clock_timestamp(),
      escalation_state = 'resolved', notes = btrim(p_reason),
      updated_at = clock_timestamp()
  where candidate.id = entry.id;
  insert into public.audit_events (
    organization_id, location_id, actor_id, action, table_name, record_id,
    request_id, note, metadata
  ) values (
    entry.organization_id, entry.location_id, auth.uid(),
    'waitlist_removal_undone', 'waitlist_entries', entry.id::text,
    p_request_id::text, btrim(p_reason),
    jsonb_build_object('restoredStatus', restored, 'removedAt', entry.removed_at)
  );
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object('id', entry.id, 'status', restored,
    'replayed', false);
end
$$;

revoke all on function public.service_begin_reservation_delivery_run(uuid, text)
from public, anon, authenticated;
revoke all on function public.service_complete_reservation_delivery_run(
  uuid, text, integer, integer, integer, integer, text
) from public, anon, authenticated;
revoke all on function public.service_reservation_delivery_health()
from public, anon, authenticated;
grant execute on function public.service_begin_reservation_delivery_run(uuid, text)
to service_role;
grant execute on function public.service_complete_reservation_delivery_run(
  uuid, text, integer, integer, integer, integer, text
) to service_role;
grant execute on function public.service_reservation_delivery_health() to service_role;
revoke all on function public.retry_waitlist_delivery(uuid, uuid, text, text, text)
from public, anon;
revoke all on function public.undo_waitlist_removal(uuid, uuid, text)
from public, anon;
grant execute on function public.retry_waitlist_delivery(uuid, uuid, text, text, text)
to authenticated;
grant execute on function public.undo_waitlist_removal(uuid, uuid, text)
to authenticated;
revoke all on function private.project_waitlist_delivery_escalation()
from public, anon, authenticated, service_role;
