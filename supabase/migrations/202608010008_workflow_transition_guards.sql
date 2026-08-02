-- Le Yard OS: database-enforced workflow transitions and atomic command RPCs.
-- Application actions are convenience boundaries; these guards remain authoritative
-- for every authenticated PostgREST/Supabase client.

-- Scheduling -----------------------------------------------------------------

create function public.guard_schedule_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and (
      new.status <> 'draft'
      or new.created_by is distinct from auth.uid()
      or new.published_by is not null
      or new.published_at is not null
    ) then
      raise exception 'New schedules must begin as actor-owned drafts' using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if old.status <> 'draft' then
      raise exception 'Published or archived schedules are immutable' using errcode = '42501';
    end if;
    return old;
  end if;

  if old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.location_id is distinct from new.location_id
    or old.created_by is distinct from new.created_by then
    raise exception 'Schedule identity and scope are immutable' using errcode = '42501';
  end if;
  if old.status in ('published', 'archived') then
    raise exception 'Published or archived schedules are immutable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status then
    if new.status <> 'published'
      or new.published_by is distinct from auth.uid()
      or new.published_at is null
      or not exists (
        select 1 from public.shifts shift_row
        where shift_row.schedule_id = old.id and shift_row.status <> 'cancelled'
      ) then
      raise exception 'Invalid schedule publication transition' using errcode = '23514';
    end if;
  elsif new.published_by is distinct from old.published_by
    or new.published_at is distinct from old.published_at then
    raise exception 'Publication stamps may only be set during publication' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger schedule_transition_guard
before insert or update or delete on public.schedules
for each row execute function public.guard_schedule_mutation();

revoke update on public.schedules from authenticated;
grant update (week_start, version, template_id) on public.schedules to authenticated;

create or replace function public.publish_schedule(p_schedule_id uuid, p_note text default null)
returns public.schedules
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare result public.schedules;
begin
  select * into result from public.schedules where id = p_schedule_id for update;
  if result.id is null then raise exception 'Schedule not found' using errcode = 'P0002'; end if;
  if not public.can_manage_location(result.organization_id, result.location_id) then
    raise exception 'Not authorized to publish this schedule' using errcode = '42501';
  end if;
  if result.status = 'published' then return result; end if;
  if result.status <> 'draft' then raise exception 'Only draft schedules can be published' using errcode = '23514'; end if;
  if not exists (
    select 1 from public.shifts shift_row
    where shift_row.schedule_id = result.id and shift_row.status <> 'cancelled'
  ) then
    raise exception 'A schedule must contain at least one active shift' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.shifts shift_row
    where shift_row.schedule_id = result.id
      and (
        shift_row.organization_id <> result.organization_id
        or shift_row.location_id <> result.location_id
      )
  ) then
    raise exception 'Every shift must match the schedule tenant and location' using errcode = '23514';
  end if;
  update public.schedules set
    status = 'published', published_by = auth.uid(), published_at = now(), publish_note = p_note
  where id = result.id returning * into result;
  return result;
end
$$;

create function public.guard_published_shift_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare old_parent_status public.schedule_status;
declare new_parent_status public.schedule_status;
begin
  -- Trusted migration/maintenance contexts have no end-user JWT. Authenticated
  -- clients and RPC callers always carry auth.uid() and remain guarded below.
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op in ('UPDATE', 'DELETE') then
    select schedule.status into old_parent_status
    from public.schedules schedule where schedule.id = old.schedule_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select schedule.status into new_parent_status
    from public.schedules schedule where schedule.id = new.schedule_id;
  end if;
  if coalesce(old_parent_status = 'published', false) = false
    and coalesce(new_parent_status = 'published', false) = false then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'Published schedule shifts cannot be added or removed' using errcode = '42501';
  end if;
  if old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.location_id is distinct from new.location_id
    or old.schedule_id is distinct from new.schedule_id
    or old.employee_id is distinct from new.employee_id
    or old.job_role_id is distinct from new.job_role_id
    or old.starts_at is distinct from new.starts_at
    or old.ends_at is distinct from new.ends_at
    or old.break_minutes is distinct from new.break_minutes
    or old.is_open is distinct from new.is_open then
    raise exception 'Published shift structure is immutable' using errcode = '42501';
  end if;
  if old.status in ('completed', 'cancelled') and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'Completed or cancelled shifts are immutable' using errcode = '42501';
  end if;
  if new.status is distinct from old.status and not (
    (old.status = 'scheduled' and new.status in ('in_progress', 'cancelled'))
    or (old.status = 'open' and new.status in ('claimed', 'cancelled'))
    or (old.status = 'claimed' and new.status in ('open', 'in_progress', 'cancelled'))
    or (old.status = 'in_progress' and new.status in ('completed', 'cancelled'))
  ) then
    raise exception 'Invalid published shift status transition' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger published_shift_guard
before insert or update or delete on public.shifts
for each row execute function public.guard_published_shift_mutation();

create function public.guard_shift_acknowledgement()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare shift_row public.shifts%rowtype;
declare schedule_state public.schedule_status;
begin
  if tg_op <> 'INSERT' then
    raise exception 'Shift acknowledgements are immutable' using errcode = '42501';
  end if;
  select * into shift_row from public.shifts where id = new.shift_id;
  select status into schedule_state from public.schedules where id = shift_row.schedule_id;
  if shift_row.id is null
    or new.organization_id is distinct from shift_row.organization_id
    or new.employee_id is distinct from shift_row.employee_id
    or schedule_state <> 'published' then
    raise exception 'Acknowledgement must match an assigned published shift' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger shift_acknowledgement_guard
before insert or update or delete on public.shift_acknowledgements
for each row execute function public.guard_shift_acknowledgement();

-- Chat referential and monotonic-read integrity ------------------------------

create function public.guard_chat_message_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare channel_org uuid;
declare channel_archived boolean;
declare reply_channel uuid;
declare reply_deleted_at timestamptz;
begin
  select organization_id, is_archived into channel_org, channel_archived
  from public.chat_channels where id = new.channel_id;
  if channel_org is null or new.organization_id is distinct from channel_org or channel_archived then
    raise exception 'Message tenant must match its channel' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (
    new.organization_id is distinct from old.organization_id
    or new.channel_id is distinct from old.channel_id
    or new.author_id is distinct from old.author_id
    or new.reply_to_id is distinct from old.reply_to_id
    or new.created_at is distinct from old.created_at
  ) then
    raise exception 'Message identity, scope, reply, and author are immutable' using errcode = '42501';
  end if;
  if new.reply_to_id is not null then
    select channel_id, deleted_at into reply_channel, reply_deleted_at
    from public.chat_messages where id = new.reply_to_id;
    if reply_channel is distinct from new.channel_id or reply_deleted_at is not null then
      raise exception 'Reply target must be in the same channel' using errcode = '23514';
    end if;
  end if;
  return new;
end
$$;

create trigger chat_message_scope_guard
before insert or update on public.chat_messages
for each row execute function public.guard_chat_message_scope();

create function public.guard_chat_read_position()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare channel_org uuid;
declare target_channel uuid;
declare target_created_at timestamptz;
declare previous_created_at timestamptz;
begin
  select organization_id into channel_org from public.chat_channels where id = new.channel_id;
  if channel_org is null or new.organization_id is distinct from channel_org then
    raise exception 'Read receipt tenant must match its channel' using errcode = '23514';
  end if;
  if tg_op = 'UPDATE' and (
    new.channel_id is distinct from old.channel_id
    or new.organization_id is distinct from old.organization_id
    or new.user_id is distinct from old.user_id
  ) then
    raise exception 'Read receipt identity and scope are immutable' using errcode = '42501';
  end if;
  if new.last_read_message_id is not null then
    select channel_id, created_at into target_channel, target_created_at
    from public.chat_messages where id = new.last_read_message_id;
    if target_channel is distinct from new.channel_id then
      raise exception 'Read position must be in the same channel' using errcode = '23514';
    end if;
  end if;
  if tg_op = 'UPDATE' and old.last_read_message_id is not null
    and new.last_read_message_id is distinct from old.last_read_message_id then
    if new.last_read_message_id is null then
      raise exception 'Read position cannot move backwards' using errcode = '23514';
    end if;
    select created_at into previous_created_at
    from public.chat_messages where id = old.last_read_message_id;
    if target_created_at < previous_created_at
      or (target_created_at = previous_created_at and new.last_read_message_id::text < old.last_read_message_id::text) then
      raise exception 'Read position cannot move backwards' using errcode = '23514';
    end if;
  end if;
  if auth.uid() is not null then new.last_read_at := now(); end if;
  return new;
end
$$;

create trigger chat_read_position_guard
before insert or update on public.chat_read_receipts
for each row execute function public.guard_chat_read_position();

create function public.mark_channel_read(
  p_channel_id uuid,
  p_last_read_message_id uuid default null
)
returns public.chat_read_receipts
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare channel_row public.chat_channels%rowtype;
declare target_message public.chat_messages%rowtype;
declare previous_message public.chat_messages%rowtype;
declare receipt public.chat_read_receipts%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  select * into channel_row from public.chat_channels where id = p_channel_id;
  if channel_row.id is null or channel_row.is_archived or not public.can_access_channel(channel_row.id) then
    raise exception 'Channel is unavailable' using errcode = '42501';
  end if;
  if p_last_read_message_id is not null then
    select * into target_message from public.chat_messages where id = p_last_read_message_id;
    if target_message.id is null or target_message.channel_id <> channel_row.id then
      raise exception 'Read position must be in the same channel' using errcode = '23514';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('channel-read:' || channel_row.id::text || ':' || auth.uid()::text, 0));
  select * into receipt from public.chat_read_receipts
  where channel_id = channel_row.id and user_id = auth.uid() for update;
  if receipt.id is not null then
    if p_last_read_message_id is null or receipt.last_read_message_id = p_last_read_message_id then
      return receipt;
    end if;
    if receipt.last_read_message_id is not null then
      select * into previous_message from public.chat_messages where id = receipt.last_read_message_id;
      if (target_message.created_at, target_message.id) <= (previous_message.created_at, previous_message.id) then
        return receipt;
      end if;
    end if;
    update public.chat_read_receipts set
      last_read_message_id = target_message.id,
      last_read_at = now()
    where id = receipt.id returning * into receipt;
    return receipt;
  end if;

  insert into public.chat_read_receipts (
    organization_id, channel_id, user_id, last_read_message_id, last_read_at
  ) values (
    channel_row.organization_id, channel_row.id, auth.uid(), p_last_read_message_id, now()
  ) returning * into receipt;
  return receipt;
end
$$;

revoke insert, update, delete on public.chat_read_receipts from authenticated;
revoke all on function public.mark_channel_read(uuid, uuid) from public;
grant execute on function public.mark_channel_read(uuid, uuid) to authenticated;

-- Time clock -----------------------------------------------------------------

create unique index one_open_break_per_time_entry
on public.time_breaks(time_entry_id) where ended_at is null;

create function public.record_clock_in(
  p_request_id uuid,
  p_location_id uuid,
  p_job_role_id uuid,
  p_scheduled_shift_id uuid default null
)
returns public.time_entries
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare location_row public.locations%rowtype;
declare employee_row public.employees%rowtype;
declare shift_row public.shifts%rowtype;
declare existing public.time_entries%rowtype;
begin
  if auth.uid() is null then raise exception 'Authentication is required' using errcode = '42501'; end if;
  select * into location_row from public.locations where id = p_location_id and is_active;
  if location_row.id is null or not public.can_access_location(location_row.organization_id, location_row.id) then
    raise exception 'Location is unavailable' using errcode = '42501';
  end if;
  select * into employee_row from public.employees
  where organization_id = location_row.organization_id and user_id = auth.uid() and employment_status = 'active';
  if employee_row.id is null then raise exception 'Active employee profile is required' using errcode = '42501'; end if;

  select * into existing from public.time_entries where id = p_request_id;
  if existing.id is not null then
    if existing.organization_id = location_row.organization_id
      and existing.location_id = location_row.id
      and existing.employee_id = employee_row.id
      and existing.job_role_id = p_job_role_id
      and existing.scheduled_shift_id is not distinct from p_scheduled_shift_id then
      return existing;
    end if;
    raise exception 'Clock-in request id was reused' using errcode = '23505';
  end if;
  if exists (select 1 from public.time_entries where employee_id = employee_row.id and clocked_out_at is null) then
    raise exception 'Employee already has an open time entry' using errcode = '23505';
  end if;
  if p_scheduled_shift_id is not null then
    select * into shift_row from public.shifts where id = p_scheduled_shift_id;
    if shift_row.id is null
      or shift_row.organization_id <> location_row.organization_id
      or shift_row.location_id <> location_row.id
      or shift_row.employee_id <> employee_row.id
      or shift_row.job_role_id <> p_job_role_id
      or not exists (select 1 from public.schedules where id = shift_row.schedule_id and status = 'published') then
      raise exception 'Scheduled shift does not match this clock-in' using errcode = '23514';
    end if;
  end if;

  insert into public.time_entries (
    id, organization_id, location_id, employee_id, job_role_id, scheduled_shift_id,
    clocked_in_at, status, source, clock_in_metadata
  ) values (
    p_request_id, location_row.organization_id, location_row.id, employee_row.id,
    p_job_role_id, p_scheduled_shift_id, clock_timestamp(), 'open', 'employee',
    jsonb_build_object('recorded_by', 'server_rpc')
  ) returning * into existing;
  return existing;
end
$$;

create function public.record_clock_out(p_time_entry_id uuid)
returns public.time_entries
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare entry public.time_entries%rowtype;
declare completed_at timestamptz;
begin
  select * into entry from public.time_entries where id = p_time_entry_id for update;
  if entry.id is null then raise exception 'Time entry not found' using errcode = 'P0002'; end if;
  if not public.is_self_employee(entry.employee_id) then
    raise exception 'Only the employee may clock out' using errcode = '42501';
  end if;
  if entry.clocked_out_at is not null then return entry; end if;
  if entry.status <> 'open' then raise exception 'Time entry is not open' using errcode = '23514'; end if;
  if exists (select 1 from public.time_breaks where time_entry_id = entry.id and ended_at is null) then
    raise exception 'End the active break before clocking out' using errcode = '23514';
  end if;
  completed_at := greatest(clock_timestamp(), entry.clocked_in_at + interval '1 microsecond');
  update public.time_entries set
    clocked_out_at = completed_at, status = 'submitted', submitted_at = completed_at,
    clock_out_metadata = jsonb_build_object('recorded_by', 'server_rpc')
  where id = entry.id returning * into entry;
  return entry;
end
$$;

create function public.start_time_break(
  p_request_id uuid,
  p_time_entry_id uuid,
  p_is_paid boolean
)
returns public.time_breaks
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare entry public.time_entries%rowtype;
declare break_row public.time_breaks%rowtype;
begin
  select * into entry from public.time_entries where id = p_time_entry_id for update;
  if entry.id is null then raise exception 'Time entry not found' using errcode = 'P0002'; end if;
  if not public.is_self_employee(entry.employee_id) then
    raise exception 'Only the employee may start a break' using errcode = '42501';
  end if;
  if entry.status <> 'open' then raise exception 'Time entry is not open' using errcode = '23514'; end if;
  select * into break_row from public.time_breaks where id = p_request_id;
  if break_row.id is not null then
    if break_row.time_entry_id = entry.id and break_row.is_paid = p_is_paid then return break_row; end if;
    raise exception 'Break request id was reused' using errcode = '23505';
  end if;
  if exists (select 1 from public.time_breaks where time_entry_id = entry.id and ended_at is null) then
    raise exception 'A break is already active' using errcode = '23505';
  end if;
  insert into public.time_breaks (
    id, organization_id, time_entry_id, started_at, is_paid, source
  ) values (
    p_request_id, entry.organization_id, entry.id, clock_timestamp(), p_is_paid, 'employee'
  ) returning * into break_row;
  return break_row;
end
$$;

create function public.end_time_break(p_break_id uuid)
returns public.time_breaks
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare break_row public.time_breaks%rowtype;
declare entry public.time_entries%rowtype;
begin
  select * into break_row from public.time_breaks where id = p_break_id for update;
  if break_row.id is null then raise exception 'Break not found' using errcode = 'P0002'; end if;
  select * into entry from public.time_entries where id = break_row.time_entry_id for update;
  if not public.is_self_employee(entry.employee_id) then
    raise exception 'Only the employee may end a break' using errcode = '42501';
  end if;
  if break_row.ended_at is not null then return break_row; end if;
  if entry.status <> 'open' then raise exception 'Time entry is not open' using errcode = '23514'; end if;
  update public.time_breaks set
    ended_at = greatest(clock_timestamp(), break_row.started_at + interval '1 microsecond')
  where id = break_row.id returning * into break_row;
  return break_row;
end
$$;

revoke insert, update, delete on public.time_entries, public.time_breaks from authenticated;
revoke all on function public.record_clock_in(uuid, uuid, uuid, uuid) from public;
revoke all on function public.record_clock_out(uuid) from public;
revoke all on function public.start_time_break(uuid, uuid, boolean) from public;
revoke all on function public.end_time_break(uuid) from public;
grant execute on function public.record_clock_in(uuid, uuid, uuid, uuid) to authenticated;
grant execute on function public.record_clock_out(uuid) to authenticated;
grant execute on function public.start_time_break(uuid, uuid, boolean) to authenticated;
grant execute on function public.end_time_break(uuid) to authenticated;

create function public.guard_time_correction_scope()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare entry public.time_entries%rowtype;
begin
  if tg_op = 'DELETE' then
    if old.status in ('approved', 'denied', 'cancelled') then
      raise exception 'Decided corrections are immutable' using errcode = '42501';
    end if;
    return old;
  end if;
  select * into entry from public.time_entries where id = new.time_entry_id;
  if entry.id is null
    or new.organization_id is distinct from entry.organization_id
    or new.location_id is distinct from entry.location_id then
    raise exception 'Correction scope must match its time entry' using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null and (
    new.requested_by is distinct from auth.uid() or new.status <> 'pending'
  ) then
    raise exception 'Corrections must begin as actor-owned pending requests' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.id is distinct from new.id
      or old.organization_id is distinct from new.organization_id
      or old.location_id is distinct from new.location_id
      or old.time_entry_id is distinct from new.time_entry_id
      or old.requested_by is distinct from new.requested_by then
      raise exception 'Correction identity and scope are immutable' using errcode = '42501';
    end if;
    if old.status in ('approved', 'denied', 'cancelled') then
      raise exception 'Decided corrections are immutable' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger time_correction_scope_guard
before insert or update or delete on public.time_entry_corrections
for each row execute function public.guard_time_correction_scope();

revoke update on public.time_entry_corrections from authenticated;
grant update (
  proposed_clocked_in_at, proposed_clocked_out_at, proposed_job_role_id,
  proposed_breaks, reason
) on public.time_entry_corrections to authenticated;

create or replace function public.apply_time_entry_correction(
  p_correction_id uuid,
  p_approve boolean,
  p_decision_note text default null
)
returns public.time_entry_corrections
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare correction public.time_entry_corrections;
declare entry public.time_entries%rowtype;
declare effective_clock_in timestamptz;
declare effective_clock_out timestamptz;
declare requested_status public.request_status := case when p_approve then 'approved'::public.request_status else 'denied'::public.request_status end;
begin
  select * into correction from public.time_entry_corrections where id = p_correction_id for update;
  if correction.id is null then raise exception 'Correction not found' using errcode = 'P0002'; end if;
  if not public.can_manage_location(correction.organization_id, correction.location_id) then
    raise exception 'Not authorized to decide this correction' using errcode = '42501';
  end if;
  if correction.status = requested_status then return correction; end if;
  if correction.status <> 'pending' then
    raise exception 'Decided corrections are immutable' using errcode = '42501';
  end if;
  select * into entry from public.time_entries where id = correction.time_entry_id for update;
  if entry.id is null
    or entry.organization_id <> correction.organization_id
    or entry.location_id <> correction.location_id then
    raise exception 'Correction scope does not match its time entry' using errcode = '23514';
  end if;

  if p_approve then
    effective_clock_in := coalesce(correction.proposed_clocked_in_at, entry.clocked_in_at);
    effective_clock_out := coalesce(correction.proposed_clocked_out_at, entry.clocked_out_at);
    if effective_clock_out is not null and effective_clock_out <= effective_clock_in then
      raise exception 'Corrected clock-out must follow clock-in' using errcode = '23514';
    end if;
    update public.time_entries set
      clocked_in_at = effective_clock_in,
      clocked_out_at = effective_clock_out,
      job_role_id = coalesce(correction.proposed_job_role_id, job_role_id),
      status = case when effective_clock_out is null then 'open'::public.time_entry_status else 'corrected'::public.time_entry_status end,
      approved_by = auth.uid(), approved_at = now()
    where id = entry.id;

    if correction.proposed_breaks is not null then
      if jsonb_typeof(correction.proposed_breaks) <> 'array'
        or exists (
          select 1 from jsonb_array_elements(correction.proposed_breaks) break_value
          where (break_value ->> 'started_at') is null
            or (break_value ->> 'is_paid') is null
            or (break_value ->> 'started_at')::timestamptz < effective_clock_in
            or ((break_value ->> 'ended_at') is not null and (break_value ->> 'ended_at')::timestamptz <= (break_value ->> 'started_at')::timestamptz)
            or (effective_clock_out is not null and (
              (break_value ->> 'ended_at') is null
              or (break_value ->> 'ended_at')::timestamptz > effective_clock_out
            ))
        )
        or exists (
          select 1
          from jsonb_array_elements(correction.proposed_breaks) with ordinality left_break(value, position)
          join jsonb_array_elements(correction.proposed_breaks) with ordinality right_break(value, position)
            on left_break.position < right_break.position
          where (left_break.value ->> 'started_at')::timestamptz
              < coalesce((right_break.value ->> 'ended_at')::timestamptz, 'infinity'::timestamptz)
            and (right_break.value ->> 'started_at')::timestamptz
              < coalesce((left_break.value ->> 'ended_at')::timestamptz, 'infinity'::timestamptz)
        ) then
        raise exception 'Proposed breaks are invalid, overlapping, or outside the time entry' using errcode = '23514';
      end if;
      delete from public.time_breaks where time_entry_id = entry.id;
      insert into public.time_breaks (
        organization_id, time_entry_id, started_at, ended_at, is_paid, source, notes
      )
      select correction.organization_id, entry.id,
        (break_value ->> 'started_at')::timestamptz,
        nullif(break_value ->> 'ended_at', '')::timestamptz,
        (break_value ->> 'is_paid')::boolean,
        'manager', nullif(break_value ->> 'notes', '')
      from jsonb_array_elements(correction.proposed_breaks) break_value;
    end if;
  end if;

  update public.time_entry_corrections set
    status = requested_status,
    decided_by = auth.uid(), decided_at = now(), decision_note = p_decision_note,
    applied_at = case when p_approve then now() else null end
  where id = correction.id returning * into correction;
  return correction;
end
$$;

-- Closeouts ------------------------------------------------------------------

create function public.guard_closeout_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and (
      new.status <> 'pending'
      or new.submitted_by is distinct from auth.uid()
      or new.approved_by is not null
      or new.approved_at is not null
    ) then
      raise exception 'Closeouts must begin as actor-owned pending submissions' using errcode = '42501';
    end if;
    if auth.uid() is not null then new.submitted_at := now(); end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status in ('approved', 'rejected') then
      raise exception 'Reviewed closeouts are immutable' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.location_id is distinct from new.location_id
    or old.business_date is distinct from new.business_date
    or old.shift_label is distinct from new.shift_label
    or old.submitted_by is distinct from new.submitted_by
    or old.submitted_at is distinct from new.submitted_at then
    raise exception 'Closeout identity, scope, and submission stamps are immutable' using errcode = '42501';
  end if;
  if old.status in ('approved', 'rejected') then
    raise exception 'Reviewed closeouts are immutable' using errcode = '42501';
  end if;
  if new.status = 'approved' and (
    new.approved_by is distinct from auth.uid() or new.approved_at is null
  ) then
    raise exception 'Approved closeout requires actor approval stamps' using errcode = '42501';
  end if;
  if new.status = 'rejected' and (new.approved_by is not null or new.approved_at is not null) then
    raise exception 'Rejected closeout cannot carry approval stamps' using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger closeout_mutation_guard
before insert or update or delete on public.shift_closeouts
for each row execute function public.guard_closeout_mutation();

revoke update on public.shift_closeouts from authenticated;
grant update (
  gross_sales_cents, net_sales_cents, cash_sales_cents, card_sales_cents,
  expected_cash_cents, actual_cash_cents, covers, comps_cents, voids_cents,
  service_charges_cents, card_tips_cents, cash_tips_cents, notes
) on public.shift_closeouts to authenticated;

create or replace function public.approve_closeout(
  p_closeout_id uuid,
  p_approved boolean,
  p_note text default null
)
returns public.shift_closeouts
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare result public.shift_closeouts;
declare requested_status public.review_status := case when p_approved then 'approved'::public.review_status else 'rejected'::public.review_status end;
begin
  select * into result from public.shift_closeouts where id = p_closeout_id for update;
  if result.id is null then raise exception 'Closeout not found' using errcode = 'P0002'; end if;
  if not public.can_manage_location(result.organization_id, result.location_id) then
    raise exception 'Not authorized to review this closeout' using errcode = '42501';
  end if;
  if result.status = requested_status then return result; end if;
  if result.status not in ('pending', 'in_review') then
    raise exception 'Reviewed closeouts are immutable' using errcode = '42501';
  end if;
  update public.shift_closeouts set
    status = requested_status,
    approved_by = case when p_approved then auth.uid() else null end,
    approved_at = case when p_approved then now() else null end,
    notes = concat_ws(E'\n', notes, nullif(btrim(p_note), ''))
  where id = result.id returning * into result;
  return result;
end
$$;

create function public.guard_closeout_attachment_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare old_parent_status public.review_status;
declare new_parent_status public.review_status;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select status into old_parent_status from public.shift_closeouts where id = old.closeout_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select status into new_parent_status from public.shift_closeouts where id = new.closeout_id;
  end if;
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.closeout_id is distinct from old.closeout_id
    or new.storage_path is distinct from old.storage_path
    or new.uploaded_by is distinct from old.uploaded_by
  ) then
    raise exception 'Closeout attachment identity and parent are immutable' using errcode = '42501';
  end if;
  if old_parent_status in ('approved', 'rejected')
    or new_parent_status in ('approved', 'rejected') then
    raise exception 'Reviewed closeout attachments are immutable' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger closeout_attachment_mutation_guard
before insert or update or delete on public.closeout_attachments
for each row execute function public.guard_closeout_attachment_mutation();

-- Receipt review -------------------------------------------------------------

create function public.guard_receipt_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
begin
  if tg_op = 'INSERT' then
    if auth.uid() is not null and (
      new.review_status <> 'pending'
      or new.uploaded_by is distinct from auth.uid()
      or new.reviewed_by is not null
      or new.reviewed_at is not null
    ) then
      raise exception 'Receipts must begin as actor-owned pending records' using errcode = '42501';
    end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.review_status in ('approved', 'rejected') then
      raise exception 'Reviewed receipts are immutable' using errcode = '42501';
    end if;
    return old;
  end if;
  if old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.location_id is distinct from new.location_id
    or old.uploaded_by is distinct from new.uploaded_by then
    raise exception 'Receipt identity, scope, and uploader are immutable' using errcode = '42501';
  end if;
  if old.review_status in ('approved', 'rejected') then
    raise exception 'Reviewed receipts are immutable' using errcode = '42501';
  end if;
  if new.review_status is distinct from old.review_status and (
    new.review_status not in ('in_review', 'approved', 'rejected')
    or new.reviewed_by is distinct from auth.uid()
    or new.reviewed_at is null
  ) then
    raise exception 'Receipt review transition requires actor review stamps' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger receipt_mutation_guard
before insert or update or delete on public.receipts
for each row execute function public.guard_receipt_mutation();

revoke update on public.receipts from authenticated;
grant update (
  vendor_id, expense_category_id, document_kind, document_number, document_date,
  total_cents, tax_cents, currency_code, payment_method, ocr_text, content_hash, notes
) on public.receipts to authenticated;

create function public.review_receipt(
  p_receipt_id uuid,
  p_review_status public.review_status,
  p_patch jsonb default '{}'::jsonb
)
returns public.receipts
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare result public.receipts;
begin
  if p_review_status not in ('in_review', 'approved', 'rejected')
    or jsonb_typeof(p_patch) <> 'object'
    or exists (
      select 1 from jsonb_object_keys(p_patch) key_name
      where key_name not in (
        'vendor_id', 'expense_category_id', 'document_number', 'document_date',
        'total_cents', 'tax_cents', 'payment_method', 'notes'
      )
    ) then
    raise exception 'Invalid receipt review payload' using errcode = '22023';
  end if;
  select * into result from public.receipts where id = p_receipt_id for update;
  if result.id is null then raise exception 'Receipt not found' using errcode = 'P0002'; end if;
  if not public.can_manage_location(result.organization_id, result.location_id) then
    raise exception 'Not authorized to review this receipt' using errcode = '42501';
  end if;
  if result.review_status in ('approved', 'rejected') then
    if result.review_status = p_review_status and to_jsonb(result) @> p_patch then return result; end if;
    raise exception 'Reviewed receipts are immutable' using errcode = '42501';
  end if;
  if p_patch ? 'vendor_id' and (p_patch ->> 'vendor_id') is not null and not exists (
    select 1 from public.vendors
    where id = (p_patch ->> 'vendor_id')::uuid and organization_id = result.organization_id
  ) then
    raise exception 'Vendor is outside the receipt tenant' using errcode = '23514';
  end if;
  if p_patch ? 'expense_category_id' and (p_patch ->> 'expense_category_id') is not null and not exists (
    select 1 from public.expense_categories
    where id = (p_patch ->> 'expense_category_id')::uuid and organization_id = result.organization_id
  ) then
    raise exception 'Expense category is outside the receipt tenant' using errcode = '23514';
  end if;
  update public.receipts set
    vendor_id = case when p_patch ? 'vendor_id' then (p_patch ->> 'vendor_id')::uuid else vendor_id end,
    expense_category_id = case when p_patch ? 'expense_category_id' then (p_patch ->> 'expense_category_id')::uuid else expense_category_id end,
    document_number = case when p_patch ? 'document_number' then p_patch ->> 'document_number' else document_number end,
    document_date = case when p_patch ? 'document_date' then (p_patch ->> 'document_date')::date else document_date end,
    total_cents = case when p_patch ? 'total_cents' then (p_patch ->> 'total_cents')::bigint else total_cents end,
    tax_cents = case when p_patch ? 'tax_cents' then (p_patch ->> 'tax_cents')::bigint else tax_cents end,
    payment_method = case when p_patch ? 'payment_method' then p_patch ->> 'payment_method' else payment_method end,
    notes = case when p_patch ? 'notes' then p_patch ->> 'notes' else notes end,
    review_status = p_review_status,
    reviewed_by = auth.uid(),
    reviewed_at = now()
  where id = result.id returning * into result;
  return result;
end
$$;

revoke all on function public.review_receipt(uuid, public.review_status, jsonb) from public;
grant execute on function public.review_receipt(uuid, public.review_status, jsonb) to authenticated;

create function public.guard_receipt_child_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare old_parent_status public.review_status;
declare new_parent_status public.review_status;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select review_status into old_parent_status from public.receipts where id = old.receipt_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select review_status into new_parent_status from public.receipts where id = new.receipt_id;
  end if;
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.receipt_id is distinct from old.receipt_id
  ) then
    raise exception 'Receipt evidence identity and parent are immutable' using errcode = '42501';
  end if;
  if old_parent_status in ('approved', 'rejected')
    or new_parent_status in ('approved', 'rejected') then
    raise exception 'Reviewed receipt evidence is immutable' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

do $receipt_child_guards$
declare child_table text;
begin
  foreach child_table in array array[
    'receipt_files', 'receipt_ocr_runs', 'receipt_extractions', 'receipt_duplicate_matches'
  ]
  loop
    execute format(
      'create trigger receipt_parent_terminal_guard before insert or update or delete on public.%I for each row execute function public.guard_receipt_child_mutation()',
      child_table
    );
  end loop;
end
$receipt_child_guards$;

-- Storage scope is fail-closed. The earlier location parser intentionally
-- returned NULL for both `global` and malformed path segments, which made a
-- malformed path indistinguishable from organization-wide storage. These
-- helpers validate the tenant/location pair before applying role checks.
create function public.storage_path_scope_is_valid(p_name text)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.organizations organization_row
    where organization_row.id = public.storage_organization_id(p_name)
      and (
        split_part(p_name, '/', 2) = 'global'
        or (
          public.storage_location_id(p_name) is not null
          and exists (
            select 1 from public.locations location_row
            where location_row.organization_id = organization_row.id
              and location_row.id = public.storage_location_id(p_name)
          )
        )
      )
  )
$$;

create function public.can_access_storage_scope(p_name text)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select public.storage_path_scope_is_valid(p_name)
    and case
      when split_part(p_name, '/', 2) = 'global'
        then public.can_access_org(public.storage_organization_id(p_name))
      else public.can_access_location(
        public.storage_organization_id(p_name),
        public.storage_location_id(p_name)
      )
    end
$$;

create function public.can_read_management_storage_scope(p_name text)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select public.storage_path_scope_is_valid(p_name)
    and case
      when split_part(p_name, '/', 2) = 'global'
        then public.can_read_management_org(public.storage_organization_id(p_name))
      else public.can_read_management_location(
        public.storage_organization_id(p_name),
        public.storage_location_id(p_name)
      )
    end
$$;

create function public.can_manage_storage_scope(p_name text)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select public.storage_path_scope_is_valid(p_name)
    and case
      when split_part(p_name, '/', 2) = 'global'
        then public.can_manage_org(public.storage_organization_id(p_name))
      else public.can_manage_location(
        public.storage_organization_id(p_name),
        public.storage_location_id(p_name)
      )
    end
$$;

create function public.storage_object_is_terminal_evidence(
  p_bucket_id text,
  p_name text
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select public.can_read_management_storage_scope(p_name)
    and (
      (
        p_bucket_id = 'receipts'
        and exists (
          select 1 from public.receipt_files file_row
          join public.receipts receipt on receipt.id = file_row.receipt_id
          where file_row.storage_path = p_name
            and file_row.organization_id = public.storage_organization_id(p_name)
            and receipt.review_status in ('approved', 'rejected')
        )
      )
      or (
        p_bucket_id = 'closeouts'
        and exists (
          select 1 from public.closeout_attachments attachment
          join public.shift_closeouts closeout_row on closeout_row.id = attachment.closeout_id
          where attachment.storage_path = p_name
            and attachment.organization_id = public.storage_organization_id(p_name)
            and closeout_row.status in ('approved', 'rejected')
        )
      )
    )
$$;

revoke all on function public.storage_path_scope_is_valid(text) from public;
revoke all on function public.can_access_storage_scope(text) from public;
revoke all on function public.can_read_management_storage_scope(text) from public;
revoke all on function public.can_manage_storage_scope(text) from public;
revoke all on function public.storage_object_is_terminal_evidence(text, text) from public;
grant execute on function public.storage_path_scope_is_valid(text) to authenticated;
grant execute on function public.can_access_storage_scope(text) to authenticated;
grant execute on function public.can_read_management_storage_scope(text) to authenticated;
grant execute on function public.can_manage_storage_scope(text) to authenticated;
grant execute on function public.storage_object_is_terminal_evidence(text, text) to authenticated;

drop policy storage_avatar_read on storage.objects;
drop policy storage_avatar_write on storage.objects;
drop policy storage_avatar_update on storage.objects;
drop policy storage_avatar_delete on storage.objects;
create policy storage_avatar_read on storage.objects for select to authenticated
using (
  bucket_id = 'profile-avatars'
  and split_part(name, '/', 2) = 'global'
  and public.can_access_storage_scope(name)
);
create policy storage_avatar_write on storage.objects for insert to authenticated
with check (
  bucket_id = 'profile-avatars'
  and split_part(name, '/', 2) = 'global'
  and public.can_access_storage_scope(name)
  and split_part(name, '/', 3) like auth.uid()::text || '.%'
);
create policy storage_avatar_update on storage.objects for update to authenticated
using (
  bucket_id = 'profile-avatars'
  and split_part(name, '/', 2) = 'global'
  and public.can_access_storage_scope(name)
  and split_part(name, '/', 3) like auth.uid()::text || '.%'
)
with check (
  bucket_id = 'profile-avatars'
  and split_part(name, '/', 2) = 'global'
  and public.can_access_storage_scope(name)
  and split_part(name, '/', 3) like auth.uid()::text || '.%'
);
create policy storage_avatar_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'profile-avatars'
  and split_part(name, '/', 2) = 'global'
  and public.can_access_storage_scope(name)
  and split_part(name, '/', 3) like auth.uid()::text || '.%'
);

drop policy storage_chat_read on storage.objects;
drop policy storage_chat_insert on storage.objects;
drop policy storage_chat_delete on storage.objects;
create policy storage_chat_read on storage.objects for select to authenticated
using (
  bucket_id = 'chat-attachments'
  and public.can_access_storage_scope(name)
  and exists (
    select 1
    from public.chat_attachments attachment
    join public.chat_messages message_row on message_row.id = attachment.message_id
    where attachment.storage_path = name
      and attachment.organization_id = public.storage_organization_id(name)
      and public.can_access_channel(message_row.channel_id)
  )
);
create policy storage_chat_insert on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-attachments'
  and public.can_access_storage_scope(name)
);
create policy storage_chat_delete on storage.objects for delete to authenticated
using (
  bucket_id = 'chat-attachments'
  and owner_id = auth.uid()::text
  and public.can_access_storage_scope(name)
);

drop policy storage_employee_document_read on storage.objects;
create policy storage_employee_document_read on storage.objects for select to authenticated
using (
  bucket_id = 'employee-documents'
  and public.storage_path_scope_is_valid(name)
  and exists (
    select 1 from public.employee_documents document_row
    where document_row.storage_path = name
      and document_row.organization_id = public.storage_organization_id(name)
      and (
        (
          document_row.is_employee_visible
          and public.is_self_employee(document_row.employee_id)
          and public.can_access_storage_scope(name)
        )
        or (
          public.can_read_employee_management(document_row.employee_id)
          and public.can_read_management_storage_scope(name)
        )
      )
  )
);

drop policy storage_staff_sop_read on storage.objects;
create policy storage_staff_sop_read on storage.objects for select to authenticated
using (
  bucket_id = 'sops'
  and public.can_access_storage_scope(name)
);

drop policy storage_manager_read on storage.objects;
drop policy storage_manager_insert on storage.objects;
drop policy storage_manager_update on storage.objects;
drop policy storage_manager_delete on storage.objects;
create policy storage_manager_read on storage.objects for select to authenticated
using (
  bucket_id in ('receipts', 'closeouts', 'inventory', 'incidents', 'reports', 'imports', 'checklists')
  and public.can_read_management_storage_scope(name)
);
create policy storage_manager_insert on storage.objects for insert to authenticated
with check (
  bucket_id in ('employee-documents', 'receipts', 'closeouts', 'inventory', 'sops', 'incidents', 'reports', 'imports', 'checklists')
  and public.can_manage_storage_scope(name)
);
create policy storage_manager_update on storage.objects for update to authenticated
using (
  bucket_id in ('employee-documents', 'receipts', 'closeouts', 'inventory', 'sops', 'incidents', 'reports', 'imports', 'checklists')
  and public.can_manage_storage_scope(name)
  and not public.storage_object_is_terminal_evidence(bucket_id, name)
)
with check (
  bucket_id in ('employee-documents', 'receipts', 'closeouts', 'inventory', 'sops', 'incidents', 'reports', 'imports', 'checklists')
  and public.can_manage_storage_scope(name)
  and not public.storage_object_is_terminal_evidence(bucket_id, name)
);
create policy storage_manager_delete on storage.objects for delete to authenticated
using (
  bucket_id in ('employee-documents', 'receipts', 'closeouts', 'inventory', 'sops', 'incidents', 'reports', 'imports', 'checklists')
  and public.can_manage_storage_scope(name)
  and not public.storage_object_is_terminal_evidence(bucket_id, name)
);

-- Atomic inventory count submission -----------------------------------------

create function public.guard_inventory_count_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.status in ('approved', 'rejected') then
    raise exception 'Reviewed inventory counts are immutable' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.id is distinct from new.id
      or old.organization_id is distinct from new.organization_id
      or old.location_id is distinct from new.location_id
      or old.counted_by is distinct from new.counted_by
      or old.counted_at is distinct from new.counted_at then
      raise exception 'Inventory count identity, scope, and submission stamps are immutable' using errcode = '42501';
    end if;
    if old.status in ('approved', 'rejected') then
      raise exception 'Reviewed inventory counts are immutable' using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger inventory_count_mutation_guard
before update or delete on public.inventory_counts
for each row execute function public.guard_inventory_count_mutation();

create function public.guard_inventory_count_line_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare old_count_status public.review_status;
declare new_count_status public.review_status;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    select status into old_count_status from public.inventory_counts where id = old.inventory_count_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select status into new_count_status from public.inventory_counts where id = new.inventory_count_id;
  end if;
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.inventory_count_id is distinct from old.inventory_count_id
  ) then
    raise exception 'Inventory count line identity and parent are immutable' using errcode = '42501';
  end if;
  if old_count_status in ('approved', 'rejected')
    or new_count_status in ('approved', 'rejected') then
    raise exception 'Reviewed inventory count lines are immutable' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger inventory_count_line_mutation_guard
before insert or update or delete on public.inventory_count_lines
for each row execute function public.guard_inventory_count_line_mutation();

create function public.submit_inventory_count(
  p_submission_id uuid,
  p_location_id uuid,
  p_count_type text,
  p_notes text,
  p_lines jsonb
)
returns public.inventory_counts
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare location_row public.locations%rowtype;
declare result public.inventory_counts%rowtype;
declare existing_lines jsonb;
declare requested_lines jsonb;
begin
  if p_count_type not in ('full', 'cycle', 'spot')
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) not between 1 and 1000 then
    raise exception 'Invalid inventory count payload' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(p_lines) line
    where not (line ?& array['inventory_item_id', 'unit_id', 'counted_quantity'])
      or (line ->> 'counted_quantity')::numeric < 0
      or ((line ->> 'expected_quantity') is not null and (line ->> 'expected_quantity')::numeric < 0)
      or ((line ->> 'unit_cost_cents') is not null and (line ->> 'unit_cost_cents')::bigint < 0)
  ) or (
    select count(*) <> count(distinct (line ->> 'inventory_item_id', line ->> 'unit_id'))
    from jsonb_array_elements(p_lines) line
  ) then
    raise exception 'Invalid or duplicate inventory count lines' using errcode = '22023';
  end if;

  select * into location_row from public.locations where id = p_location_id and is_active;
  if location_row.id is null or not public.can_manage_location(location_row.organization_id, location_row.id) then
    raise exception 'Not authorized to submit this inventory count' using errcode = '42501';
  end if;

  select jsonb_agg(jsonb_build_object(
    'inventory_item_id', line ->> 'inventory_item_id',
    'unit_id', line ->> 'unit_id',
    'expected_quantity', case when (line ->> 'expected_quantity') is null then null else (line ->> 'expected_quantity')::numeric end,
    'counted_quantity', (line ->> 'counted_quantity')::numeric,
    'unit_cost_cents', case when (line ->> 'unit_cost_cents') is null then null else (line ->> 'unit_cost_cents')::bigint end,
    'notes', line ->> 'notes'
  ) order by line ->> 'inventory_item_id', line ->> 'unit_id')
  into requested_lines from jsonb_array_elements(p_lines) line;

  select * into result from public.inventory_counts where id = p_submission_id for update;
  if result.id is not null then
    select jsonb_agg(jsonb_build_object(
      'inventory_item_id', inventory_item_id::text,
      'unit_id', unit_id::text,
      'expected_quantity', expected_quantity,
      'counted_quantity', counted_quantity,
      'unit_cost_cents', unit_cost_cents,
      'notes', notes
    ) order by inventory_item_id::text, unit_id::text)
    into existing_lines from public.inventory_count_lines where inventory_count_id = result.id;
    if result.organization_id = location_row.organization_id
      and result.location_id = location_row.id
      and result.count_type = p_count_type
      and result.counted_by = auth.uid()
      and result.notes is not distinct from p_notes
      and existing_lines = requested_lines then
      return result;
    end if;
    raise exception 'Inventory submission id was reused' using errcode = '23505';
  end if;

  insert into public.inventory_counts (
    id, organization_id, location_id, counted_at, status, count_type, counted_by, notes
  ) values (
    p_submission_id, location_row.organization_id, location_row.id, now(),
    'pending', p_count_type, auth.uid(), p_notes
  ) returning * into result;

  insert into public.inventory_count_lines (
    organization_id, inventory_count_id, inventory_item_id, unit_id,
    expected_quantity, counted_quantity, unit_cost_cents, notes
  )
  select location_row.organization_id, result.id,
    (line ->> 'inventory_item_id')::uuid,
    (line ->> 'unit_id')::uuid,
    nullif(line ->> 'expected_quantity', '')::numeric,
    (line ->> 'counted_quantity')::numeric,
    nullif(line ->> 'unit_cost_cents', '')::bigint,
    nullif(line ->> 'notes', '')
  from jsonb_array_elements(p_lines) line;
  return result;
end
$$;

revoke insert, update, delete on public.inventory_counts, public.inventory_count_lines from authenticated;
revoke all on function public.submit_inventory_count(uuid, uuid, text, text, jsonb) from public;
grant execute on function public.submit_inventory_count(uuid, uuid, text, text, jsonb) to authenticated;

-- Atomic report/export requests ---------------------------------------------

create function public.guard_report_job_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.status in ('succeeded', 'partially_succeeded', 'failed', 'cancelled') then
    raise exception 'Terminal report jobs are immutable' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.id is distinct from new.id
      or old.organization_id is distinct from new.organization_id
      or old.location_id is distinct from new.location_id
      or (tg_table_name = 'report_runs' and old.requested_by is distinct from new.requested_by)
      or (tg_table_name = 'export_jobs' and old.requested_by is distinct from new.requested_by) then
      raise exception 'Report job identity, scope, and requester are immutable' using errcode = '42501';
    end if;
    if old.status in ('succeeded', 'partially_succeeded', 'failed', 'cancelled') then
      raise exception 'Terminal report jobs are immutable' using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger report_run_mutation_guard
before update or delete on public.report_runs
for each row execute function public.guard_report_job_mutation();
create trigger export_job_mutation_guard
before update or delete on public.export_jobs
for each row execute function public.guard_report_job_mutation();

create function public.request_report_export(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_saved_report_id uuid,
  p_report_type text,
  p_period_start date,
  p_period_end date,
  p_filters jsonb,
  p_export_type text
)
returns public.export_jobs
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare actor_role public.app_role;
declare run_row public.report_runs%rowtype;
declare export_row public.export_jobs%rowtype;
begin
  actor_role := public.org_role(p_organization_id);
  if actor_role is null or not public.can_operate_org(p_organization_id) then
    raise exception 'Not authorized to request this report' using errcode = '42501';
  end if;
  if p_location_id is not null then
    if not exists (
      select 1 from public.locations where id = p_location_id
        and organization_id = p_organization_id and is_active
    ) or not public.can_manage_location(p_organization_id, p_location_id) then
      raise exception 'Report location is unavailable' using errcode = '42501';
    end if;
  elsif actor_role = 'manager' then
    raise exception 'Managers must select an assigned location' using errcode = '42501';
  end if;
  if p_report_type not in (
    'labor', 'attendance', 'overtime', 'tips', 'payroll', 'sales_labor',
    'receipts', 'expenses', 'inventory_variance', 'cogs', 'waste',
    'vendor_pricing', 'shift_performance', 'guest_activity'
  ) or p_export_type not in ('csv', 'pdf', 'xlsx', 'json')
    or (p_period_start is not null and p_period_end is not null and p_period_end < p_period_start)
    or jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) <> 'object'
    or pg_column_size(coalesce(p_filters, '{}'::jsonb)) > 32768 then
    raise exception 'Invalid report export payload' using errcode = '22023';
  end if;
  if p_saved_report_id is not null and not exists (
    select 1 from public.saved_reports
    where id = p_saved_report_id and organization_id = p_organization_id and report_type = p_report_type
  ) then
    raise exception 'Saved report does not match this request' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('report-export:' || p_request_id::text, 0));

  select * into export_row from public.export_jobs where id = p_request_id;
  if export_row.id is not null then
    select * into run_row from public.report_runs where id = export_row.report_run_id;
    if export_row.organization_id = p_organization_id
      and export_row.location_id is not distinct from p_location_id
      and export_row.export_type = p_export_type
      and run_row.organization_id = p_organization_id
      and run_row.location_id is not distinct from p_location_id
      and run_row.saved_report_id is not distinct from p_saved_report_id
      and run_row.report_type = p_report_type
      and run_row.period_start is not distinct from p_period_start
      and run_row.period_end is not distinct from p_period_end
      and run_row.filters = coalesce(p_filters, '{}'::jsonb)
      and run_row.requested_by = auth.uid()
      and export_row.requested_by = auth.uid() then
      return export_row;
    end if;
    raise exception 'Report export request id was reused' using errcode = '23505';
  end if;

  insert into public.report_runs (
    id, organization_id, location_id, saved_report_id, report_type,
    period_start, period_end, filters, status, requested_by
  ) values (
    p_request_id, p_organization_id, p_location_id, p_saved_report_id, p_report_type,
    p_period_start, p_period_end, coalesce(p_filters, '{}'::jsonb), 'queued', auth.uid()
  ) returning * into run_row;
  insert into public.export_jobs (
    id, organization_id, location_id, report_run_id, export_type, status, requested_by
  ) values (
    p_request_id, p_organization_id, p_location_id, run_row.id, p_export_type, 'queued', auth.uid()
  ) returning * into export_row;
  return export_row;
end
$$;

revoke insert, update, delete on public.report_runs, public.export_jobs from authenticated;
revoke all on function public.request_report_export(uuid, uuid, uuid, uuid, text, date, date, jsonb, text) from public;
grant execute on function public.request_report_export(uuid, uuid, uuid, uuid, text, date, date, jsonb, text) to authenticated;

comment on function public.record_clock_in(uuid, uuid, uuid, uuid) is 'Idempotent, server-timestamped self clock-in; tenant and employee identity are derived from auth.uid().';
comment on function public.submit_inventory_count(uuid, uuid, text, text, jsonb) is 'Atomic and idempotent inventory count header plus line submission.';
comment on function public.request_report_export(uuid, uuid, uuid, uuid, text, date, date, jsonb, text) is 'Atomic and idempotent report run plus export job request.';
