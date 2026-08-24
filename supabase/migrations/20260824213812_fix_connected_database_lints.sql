-- Connected PL/pgSQL lint found two invalid audit column references introduced
-- in Wave 2 and one older ambiguous variable reference. Keep the public RPC
-- contracts unchanged, preserve their authorization checks, and recapture the
-- runtime fingerprint only after all three function bodies are valid.

create or replace function public.retry_waitlist_delivery(
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
    request_id, metadata
  ) values (
    entry.organization_id, entry.location_id, auth.uid(),
    'waitlist_delivery_requeued', 'waitlist_entries', entry.id::text,
    p_request_id::text,
    jsonb_build_object('reason', btrim(p_reason), 'channel', p_channel,
      'messageId', message.id, 'escalationState', p_escalation_state)
  );
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object('id', entry.id, 'status', 'queued',
    'channel', p_channel, 'replayed', false);
end
$$;

create or replace function public.undo_waitlist_removal(
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
    request_id, metadata
  ) values (
    entry.organization_id, entry.location_id, auth.uid(),
    'waitlist_removal_undone', 'waitlist_entries', entry.id::text,
    p_request_id::text,
    jsonb_build_object('reason', btrim(p_reason), 'restoredStatus', restored,
      'removedAt', entry.removed_at)
  );
  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object('id', entry.id, 'status', restored,
    'replayed', false);
end
$$;

create or replace function public.delete_availability_rule(
  p_request_id uuid,
  p_rule_id uuid
)
returns uuid
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  current_actor_id uuid := auth.uid();
  replayed_rule_id uuid;
  rule_row public.availability_rules%rowtype;
  employee_row public.employees%rowtype;
  actor_is_self boolean;
begin
  if current_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into rule_row
  from public.availability_rules rule
  where rule.id = p_rule_id
  for update;
  if rule_row.id is null then
    select request.record_id::uuid into replayed_rule_id
    from private.operation_requests request
    where request.request_id = p_request_id
      and request.operation_kind = 'people.availability.delete'
      and request.actor_id = current_actor_id
      and request.completed_at is not null;
    if replayed_rule_id is not null then return replayed_rule_id; end if;
    raise exception 'Availability rule not found' using errcode = 'P0002';
  end if;
  select * into employee_row
  from public.employees employee
  where employee.organization_id = rule_row.organization_id
    and employee.id = rule_row.employee_id;
  actor_is_self := employee_row.user_id is not distinct from current_actor_id;
  if not actor_is_self and not public.can_operate_employee(employee_row.id) then
    raise exception 'Not authorized to delete this availability' using errcode = '42501';
  end if;
  if rule_row.location_id is null then
    if not actor_is_self and not public.can_manage_org(employee_row.organization_id) then
      raise exception 'Organization-wide availability requires organization management'
        using errcode = '42501';
    end if;
  elsif (
    actor_is_self
    and not public.can_access_location(employee_row.organization_id, rule_row.location_id)
  ) or (
    not actor_is_self
    and not public.can_manage_location(employee_row.organization_id, rule_row.location_id)
  ) then
    raise exception 'Availability location is unavailable' using errcode = '42501';
  end if;
  if private.claim_operation_request(
    p_request_id,
    'people.availability.delete',
    rule_row.organization_id,
    rule_row.location_id,
    rule_row.id,
    jsonb_build_object('rule_id', rule_row.id)
  ) then
    delete from public.availability_rules rule where rule.id = rule_row.id;
    perform private.complete_operation_request(p_request_id);
  end if;
  return rule_row.id;
end
$$;

update private.runtime_schema_contract_expected expected
set migration_head = '20260824213812',
    table_fingerprint = snapshot.value ->> 'tableFingerprint',
    function_fingerprint = snapshot.value ->> 'functionFingerprint',
    access_fingerprint = snapshot.value ->> 'accessFingerprint',
    captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
