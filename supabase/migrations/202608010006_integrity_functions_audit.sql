-- Le Yard OS: workflow invariants, deterministic calculations, audit capture, and report views.

alter table public.inventory_categories drop constraint inventory_categories_parent_id_fkey;
alter table public.inventory_categories add constraint inventory_categories_parent_org_fk
  foreign key (organization_id, parent_id) references public.inventory_categories(organization_id, id) on delete set null;
alter table public.notifications add constraint notifications_active_member_fk
  foreign key (organization_id, user_id) references public.organization_memberships(organization_id, user_id) on delete cascade;
alter table public.notification_preferences add constraint notification_preferences_member_fk
  foreign key (organization_id, user_id) references public.organization_memberships(organization_id, user_id) on delete cascade;
alter table public.push_subscriptions add constraint push_subscriptions_member_fk
  foreign key (organization_id, user_id) references public.organization_memberships(organization_id, user_id) on delete cascade;

create unique index integration_connections_scope_unique
on public.integration_connections(organization_id, provider, location_id) nulls not distinct;

create function public.redact_audit_record(p_table text, p_record jsonb)
returns jsonb
language sql immutable
set search_path = ''
as $$
  select case
    when p_record is null then null
    when p_table = 'user_invitations' then p_record - 'token_hash'
    when p_table = 'push_subscriptions' then p_record - 'encrypted_subscription'
    else p_record
  end
$$;

create function public.capture_audit_event()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  old_json jsonb;
  new_json jsonb;
  event_org uuid;
  event_location uuid;
  event_record_id text;
  claims jsonb;
begin
  old_json := case when tg_op in ('UPDATE', 'DELETE') then to_jsonb(old) else null end;
  new_json := case when tg_op in ('INSERT', 'UPDATE') then to_jsonb(new) else null end;

  if tg_table_name = 'organizations' then
    event_org := coalesce((new_json ->> 'id')::uuid, (old_json ->> 'id')::uuid);
  elsif coalesce(new_json, old_json) ? 'organization_id' then
    event_org := nullif(coalesce(new_json, old_json) ->> 'organization_id', '')::uuid;
  end if;

  if coalesce(new_json, old_json) ? 'location_id' then
    event_location := nullif(coalesce(new_json, old_json) ->> 'location_id', '')::uuid;
  end if;

  event_record_id := coalesce(new_json ->> 'id', old_json ->> 'id');
  claims := auth.jwt();

  insert into public.audit_events (
    organization_id, location_id, actor_id, actor_role, action, table_name,
    record_id, old_record, new_record, request_id, metadata
  ) values (
    event_org,
    event_location,
    auth.uid(),
    case when event_org is null then null else public.org_role(event_org) end,
    lower(tg_op),
    tg_table_name,
    event_record_id,
    public.redact_audit_record(tg_table_name, old_json),
    public.redact_audit_record(tg_table_name, new_json),
    nullif(claims ->> 'request_id', ''),
    jsonb_build_object('schema', tg_table_schema, 'db_role', current_user)
  );

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create function public.prevent_last_active_owner()
returns trigger
language plpgsql
set search_path = ''
as $$
declare remaining_owners integer;
begin
  if old.role = 'owner' and old.status = 'active'
    and (tg_op = 'DELETE' or new.role <> 'owner' or new.status <> 'active') then
    select count(*) into remaining_owners
    from public.organization_memberships m
    where m.organization_id = old.organization_id
      and m.role = 'owner' and m.status = 'active' and m.id <> old.id;
    if remaining_owners = 0 then
      raise exception 'An organization must retain at least one active owner' using errcode = '23514';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger organization_memberships_keep_owner
before update or delete on public.organization_memberships
for each row execute function public.prevent_last_active_owner();

create function public.prevent_approved_record_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if to_jsonb(old) ->> 'approved_at' is not null then
    raise exception '% is approved and immutable', tg_table_name using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger tip_policy_version_immutable
before update or delete on public.tip_pool_policy_versions
for each row when (old.approved_at is not null)
execute function public.prevent_approved_record_mutation();

create function public.prevent_locked_tip_mutation()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare run_locked_at timestamptz;
begin
  if tg_table_name = 'tip_runs' then
    run_locked_at := old.locked_at;
  else
    select r.locked_at into run_locked_at
    from public.tip_runs r where r.id = old.tip_run_id;
  end if;
  if run_locked_at is not null then
    raise exception 'Approved tip runs and their inputs are immutable' using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger tip_run_immutable_after_approval
before update or delete on public.tip_runs
for each row when (old.locked_at is not null)
execute function public.prevent_locked_tip_mutation();

do $tip_lock_children$
declare t text;
begin
  foreach t in array array['tip_sources', 'tip_run_participants', 'tip_adjustments', 'tip_allocations']
  loop
    execute format('create trigger lock_approved_tip_run before update or delete on public.%I for each row execute function public.prevent_locked_tip_mutation()', t);
  end loop;
end
$tip_lock_children$;

create function public.prevent_ledger_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception '% is append-only; create a compensating record', tg_table_name using errcode = '42501';
end
$$;

create trigger inventory_transactions_append_only
before update or delete on public.inventory_transactions
for each row execute function public.prevent_ledger_mutation();
create trigger guest_consents_append_only
before update or delete on public.guest_consents
for each row execute function public.prevent_ledger_mutation();
create trigger integration_events_append_only
before update or delete on public.integration_events
for each row execute function public.prevent_ledger_mutation();

create function public.validate_employee_job_assignment()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  work_at timestamptz;
  work_date date;
begin
  if new.employee_id is null then return new; end if;
  work_at := coalesce(
    nullif(to_jsonb(new) ->> 'starts_at', '')::timestamptz,
    nullif(to_jsonb(new) ->> 'clocked_in_at', '')::timestamptz
  );
  select (work_at at time zone l.timezone)::date into work_date
  from public.locations l where l.id = new.location_id and l.organization_id = new.organization_id;
  if not exists (
    select 1 from public.employee_job_roles ej
    where ej.organization_id = new.organization_id
      and ej.employee_id = new.employee_id
      and ej.job_role_id = new.job_role_id
      and ej.location_id = new.location_id
      and ej.effective_from <= work_date
      and (ej.effective_to is null or ej.effective_to >= work_date)
  ) then
    raise exception 'Employee is not assigned to this job role and location on %', work_date using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger shift_employee_job_assignment
before insert or update of employee_id, job_role_id, location_id, starts_at on public.shifts
for each row execute function public.validate_employee_job_assignment();
create trigger time_entry_employee_job_assignment
before insert or update of employee_id, job_role_id, location_id, clocked_in_at on public.time_entries
for each row execute function public.validate_employee_job_assignment();

create function public.validate_human_ai_decision()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.status in ('approved', 'denied') and old.status = 'pending' then
    if auth.uid() is null or new.decided_by is distinct from auth.uid() or new.decided_at is null then
      raise exception 'AI proposals require an authenticated human decision' using errcode = '42501';
    end if;
  end if;
  if new.applied_at is not null and old.applied_at is null then
    if auth.uid() is null or new.applied_by is distinct from auth.uid() or new.status <> 'approved' then
      raise exception 'Only an authenticated human may apply an approved AI proposal' using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger ai_proposal_human_gate
before update on public.ai_action_proposals
for each row execute function public.validate_human_ai_decision();

create function public.publish_schedule(p_schedule_id uuid, p_note text default null)
returns public.schedules
language plpgsql security definer
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
  if result.status <> 'draft' then raise exception 'Only draft schedules can be published' using errcode = '23514'; end if;
  if not exists (select 1 from public.shifts s where s.schedule_id = result.id and s.status <> 'cancelled') then
    raise exception 'A schedule must contain at least one active shift' using errcode = '23514';
  end if;
  update public.schedules
  set status = 'published', published_by = auth.uid(), published_at = now(), publish_note = p_note
  where id = result.id returning * into result;
  return result;
end
$$;

create function public.approve_closeout(p_closeout_id uuid, p_approved boolean, p_note text default null)
returns public.shift_closeouts
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare result public.shift_closeouts;
begin
  select * into result from public.shift_closeouts where id = p_closeout_id for update;
  if result.id is null then raise exception 'Closeout not found' using errcode = 'P0002'; end if;
  if not public.can_manage_location(result.organization_id, result.location_id) then
    raise exception 'Not authorized to review this closeout' using errcode = '42501';
  end if;
  update public.shift_closeouts
  set status = case when p_approved then 'approved'::public.review_status else 'rejected'::public.review_status end,
      approved_by = case when p_approved then auth.uid() else null end,
      approved_at = case when p_approved then now() else null end,
      notes = concat_ws(E'\n', notes, nullif(p_note, ''))
  where id = result.id returning * into result;
  return result;
end
$$;

create function public.apply_time_entry_correction(p_correction_id uuid, p_approve boolean, p_decision_note text default null)
returns public.time_entry_corrections
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  correction public.time_entry_corrections;
  effective_clock_in timestamptz;
  effective_clock_out timestamptz;
begin
  select * into correction from public.time_entry_corrections where id = p_correction_id for update;
  if correction.id is null then raise exception 'Correction not found' using errcode = 'P0002'; end if;
  if correction.status <> 'pending' then raise exception 'Correction has already been decided' using errcode = '23514'; end if;
  if not public.can_manage_location(correction.organization_id, correction.location_id) then
    raise exception 'Not authorized to decide this correction' using errcode = '42501';
  end if;
  if p_approve then
    select coalesce(correction.proposed_clocked_in_at, e.clocked_in_at),
           coalesce(correction.proposed_clocked_out_at, e.clocked_out_at)
      into effective_clock_in, effective_clock_out
    from public.time_entries e where e.id = correction.time_entry_id;
    update public.time_entries
    set clocked_in_at = effective_clock_in,
        clocked_out_at = effective_clock_out,
        job_role_id = coalesce(correction.proposed_job_role_id, job_role_id),
        status = case when effective_clock_out is null then 'open'::public.time_entry_status else 'corrected'::public.time_entry_status end,
        approved_by = auth.uid(), approved_at = now()
    where id = correction.time_entry_id;
    if correction.proposed_breaks is not null then
      if jsonb_typeof(correction.proposed_breaks) <> 'array' then
        raise exception 'proposed_breaks must be a JSON array' using errcode = '22023';
      end if;
      if exists (
        select 1
        from jsonb_array_elements(correction.proposed_breaks) b
        where (b ->> 'started_at') is null
          or (b ->> 'is_paid') is null
          or ((b ->> 'started_at')::timestamptz < effective_clock_in)
          or ((b ->> 'ended_at') is not null and (b ->> 'ended_at')::timestamptz <= (b ->> 'started_at')::timestamptz)
          or (effective_clock_out is not null and ((b ->> 'ended_at') is null or (b ->> 'ended_at')::timestamptz > effective_clock_out))
      ) then
        raise exception 'A proposed break falls outside the corrected time entry' using errcode = '23514';
      end if;
      delete from public.time_breaks where time_entry_id = correction.time_entry_id;
      insert into public.time_breaks (
        organization_id, time_entry_id, started_at, ended_at, is_paid, source, notes
      )
      select correction.organization_id, correction.time_entry_id,
        (b ->> 'started_at')::timestamptz,
        nullif(b ->> 'ended_at', '')::timestamptz,
        (b ->> 'is_paid')::boolean,
        'manager', nullif(b ->> 'notes', '')
      from jsonb_array_elements(correction.proposed_breaks) b;
    end if;
  end if;
  update public.time_entry_corrections
  set status = case when p_approve then 'approved'::public.request_status else 'denied'::public.request_status end,
      decided_by = auth.uid(), decided_at = now(), decision_note = p_decision_note,
      applied_at = case when p_approve then now() else null end
  where id = correction.id returning * into correction;
  return correction;
end
$$;

create function public.calculate_tip_run(p_tip_run_id uuid)
returns public.tip_runs
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  run_record public.tip_runs;
  method public.tip_distribution_method;
  source_total bigint;
  adjustment_total bigint;
  base_pool bigint;
  total_weight numeric(30,6);
  allocation_total bigint;
begin
  select r.* into run_record from public.tip_runs r where r.id = p_tip_run_id for update;
  if run_record.id is null then raise exception 'Tip run not found' using errcode = 'P0002'; end if;
  if not public.can_manage_location(run_record.organization_id, run_record.location_id) then
    raise exception 'Not authorized to calculate this tip run' using errcode = '42501';
  end if;
  if run_record.locked_at is not null then raise exception 'Approved tip runs are immutable' using errcode = '42501'; end if;
  if exists (select 1 from public.tip_adjustments a where a.tip_run_id = run_record.id and a.approved_at is null) then
    raise exception 'Every adjustment must be approved before calculation' using errcode = '23514';
  end if;

  select v.distribution_method into method
  from public.tip_pool_policy_versions v
  where v.id = run_record.policy_version_id and v.approved_at is not null;
  if method is null then
    raise exception 'Tip calculations require an approved policy version' using errcode = '23514';
  end if;
  select coalesce(sum(s.amount_cents) filter (where s.is_distributable), 0)
    into source_total from public.tip_sources s where s.tip_run_id = run_record.id;
  select coalesce(sum(a.amount_cents), 0)
    into adjustment_total from public.tip_adjustments a where a.tip_run_id = run_record.id;
  base_pool := source_total - adjustment_total;
  if base_pool < 0 then raise exception 'Positive direct adjustments exceed the distributable pool' using errcode = '23514'; end if;

  select coalesce(sum(case method
      when 'hours' then p.worked_minutes::numeric
      when 'points' then p.points
      when 'weighted_hours' then p.worked_minutes::numeric * p.points
    end), 0)
  into total_weight
  from public.tip_run_participants p
  where p.tip_run_id = run_record.id and p.eligible;
  if base_pool > 0 and total_weight <= 0 then
    raise exception 'A positive pool requires at least one eligible participant with non-zero weight' using errcode = '23514';
  end if;

  delete from public.tip_allocations a where a.tip_run_id = run_record.id;
  with participants as (
    select p.employee_id,
      case method
        when 'hours' then case when p.eligible then p.worked_minutes::numeric else 0 end
        when 'points' then case when p.eligible then p.points else 0 end
        when 'weighted_hours' then case when p.eligible then p.worked_minutes::numeric * p.points else 0 end
      end as weight,
      coalesce((select sum(a.amount_cents) from public.tip_adjustments a
                where a.tip_run_id = p.tip_run_id and a.employee_id = p.employee_id), 0) as adjustment_cents,
      p.worked_minutes, p.points, p.eligible, p.exclusion_reason
    from public.tip_run_participants p where p.tip_run_id = run_record.id
  ), exact as (
    select p.*,
      case when total_weight > 0 then base_pool::numeric * p.weight / total_weight else 0 end as exact_share
    from participants p
  ), floored as (
    select e.*, floor(e.exact_share)::bigint as floor_share,
      e.exact_share - floor(e.exact_share) as fraction
    from exact e
  ), ranked as (
    select f.*,
      row_number() over (order by f.fraction desc, f.employee_id) as remainder_rank,
      base_pool - sum(f.floor_share) over () as cents_remaining
    from floored f
  )
  insert into public.tip_allocations (
    organization_id, tip_run_id, employee_id, base_amount_cents, adjustment_cents,
    final_amount_cents, weight, exact_share, remainder_rank, explanation
  )
  select run_record.organization_id, run_record.id, r.employee_id,
    r.floor_share + case when r.remainder_rank <= r.cents_remaining then 1 else 0 end,
    r.adjustment_cents,
    r.floor_share + case when r.remainder_rank <= r.cents_remaining then 1 else 0 end + r.adjustment_cents,
    r.weight, r.exact_share, r.remainder_rank::integer,
    jsonb_build_object(
      'method', method, 'worked_minutes', r.worked_minutes, 'points', r.points,
      'eligible', r.eligible, 'exclusion_reason', r.exclusion_reason,
      'total_weight', total_weight, 'distributable_cents', source_total,
      'base_pool_cents', base_pool, 'rounding', 'largest_remainder',
      'calculation_version', 'largest-remainder-v1'
    )
  from ranked r;

  if exists (select 1 from public.tip_allocations a where a.tip_run_id = run_record.id and a.final_amount_cents < 0) then
    raise exception 'An adjustment would produce a negative employee allocation' using errcode = '23514';
  end if;
  select coalesce(sum(a.final_amount_cents), 0) into allocation_total
  from public.tip_allocations a where a.tip_run_id = run_record.id;
  if allocation_total <> source_total then
    raise exception 'Allocation invariant failed: % allocated from %', allocation_total, source_total using errcode = '23514';
  end if;

  update public.tip_runs
  set status = 'calculated', distributable_cents = source_total,
      allocated_cents = allocation_total, calculated_at = now()
  where id = run_record.id returning * into run_record;
  return run_record;
end
$$;

create function public.approve_tip_run(p_tip_run_id uuid)
returns public.tip_runs
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare run_record public.tip_runs;
begin
  select * into run_record from public.tip_runs where id = p_tip_run_id for update;
  if run_record.id is null then raise exception 'Tip run not found' using errcode = 'P0002'; end if;
  if not public.can_manage_location(run_record.organization_id, run_record.location_id) then
    raise exception 'Not authorized to approve this tip run' using errcode = '42501';
  end if;
  if run_record.status <> 'calculated' or run_record.allocated_cents <> run_record.distributable_cents then
    raise exception 'Only a balanced calculated tip run may be approved' using errcode = '23514';
  end if;
  update public.tip_runs set status = 'approved', approved_by = auth.uid(), approved_at = now(), locked_at = now()
  where id = run_record.id returning * into run_record;
  return run_record;
end
$$;

create function public.search_receipts(p_organization_id uuid, p_query text, p_location_id uuid default null, p_limit integer default 50)
returns setof public.receipts
language sql stable
set search_path = ''
as $$
  select r.* from public.receipts r
  where r.organization_id = p_organization_id
    and (p_location_id is null or r.location_id = p_location_id)
    and r.search_vector @@ websearch_to_tsquery('english'::regconfig, p_query)
  order by ts_rank_cd(r.search_vector, websearch_to_tsquery('english'::regconfig, p_query)) desc, r.document_date desc nulls last
  limit least(greatest(p_limit, 1), 200)
$$;

create function public.search_guests(p_organization_id uuid, p_query text, p_limit integer default 50)
returns setof public.guests
language sql stable
set search_path = ''
as $$
  select g.* from public.guests g
  where g.organization_id = p_organization_id and g.merged_into_id is null
    and g.search_vector @@ websearch_to_tsquery('simple'::regconfig, p_query)
  order by ts_rank_cd(g.search_vector, websearch_to_tsquery('simple'::regconfig, p_query)) desc, g.last_visit_at desc nulls last
  limit least(greatest(p_limit, 1), 200)
$$;

revoke all on function public.publish_schedule(uuid, text) from public;
revoke all on function public.approve_closeout(uuid, boolean, text) from public;
revoke all on function public.apply_time_entry_correction(uuid, boolean, text) from public;
revoke all on function public.calculate_tip_run(uuid) from public;
revoke all on function public.approve_tip_run(uuid) from public;
revoke all on function public.search_receipts(uuid, text, uuid, integer) from public;
revoke all on function public.search_guests(uuid, text, integer) from public;
grant execute on function public.publish_schedule(uuid, text) to authenticated;
grant execute on function public.approve_closeout(uuid, boolean, text) to authenticated;
grant execute on function public.apply_time_entry_correction(uuid, boolean, text) to authenticated;
grant execute on function public.calculate_tip_run(uuid) to authenticated;
grant execute on function public.approve_tip_run(uuid) to authenticated;
grant execute on function public.search_receipts(uuid, text, uuid, integer) to authenticated;
grant execute on function public.search_guests(uuid, text, integer) to authenticated;

create view public.inventory_on_hand
with (security_invoker = true)
as
select t.organization_id, t.location_id, t.inventory_item_id,
  sum(t.quantity_delta) as quantity_on_hand,
  max(t.occurred_at) as last_movement_at
from public.inventory_transactions t
group by t.organization_id, t.location_id, t.inventory_item_id;

create view public.approved_labor_daily
with (security_invoker = true)
as
select e.organization_id, e.location_id, e.employee_id,
  (e.clocked_in_at at time zone l.timezone)::date as business_date,
  sum(extract(epoch from (e.clocked_out_at - e.clocked_in_at)) / 60
      - coalesce((select sum(extract(epoch from (b.ended_at - b.started_at)) / 60)
                  from public.time_breaks b where b.time_entry_id = e.id and not b.is_paid and b.ended_at is not null), 0))::bigint as paid_minutes
from public.time_entries e
join public.locations l on l.id = e.location_id
where e.status in ('approved', 'corrected') and e.clocked_out_at is not null
group by e.organization_id, e.location_id, e.employee_id, (e.clocked_in_at at time zone l.timezone)::date;

create view public.tip_run_totals
with (security_invoker = true)
as
select r.organization_id, r.location_id, r.id as tip_run_id, r.business_date, r.status,
  r.distributable_cents, r.allocated_cents,
  count(a.id) as allocation_count,
  coalesce(sum(a.final_amount_cents), 0)::bigint as allocation_check_cents
from public.tip_runs r
left join public.tip_allocations a on a.tip_run_id = r.id
group by r.organization_id, r.location_id, r.id, r.business_date, r.status, r.distributable_cents, r.allocated_cents;

grant select on public.inventory_on_hand, public.approved_labor_daily, public.tip_run_totals to authenticated;

-- Keep timestamps consistent without relying on application clients.
do $updated_at_triggers$
declare t text;
begin
  for t in
    select c.table_name
    from information_schema.columns c
    join information_schema.tables p on p.table_schema = c.table_schema and p.table_name = c.table_name and p.table_type = 'BASE TABLE'
    where c.table_schema = 'public' and c.column_name = 'updated_at'
  loop
    execute format('create trigger set_updated_at before update on public.%I for each row execute function public.touch_updated_at()', t);
  end loop;
end
$updated_at_triggers$;

create trigger integration_credentials_updated_at
before update on private.integration_credentials
for each row execute function public.touch_updated_at();

create function private.capture_credential_audit()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  connection_uuid uuid;
  event_org uuid;
begin
  connection_uuid := coalesce(new.connection_id, old.connection_id);
  select c.organization_id into event_org
  from public.integration_connections c where c.id = connection_uuid;
  insert into public.audit_events (
    organization_id, actor_id, actor_role, action, table_name, record_id, metadata
  ) values (
    event_org, auth.uid(), case when event_org is null then null else public.org_role(event_org) end,
    lower(tg_op), 'integration_credentials', connection_uuid::text,
    jsonb_build_object('credential_material_redacted', true)
  );
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger integration_credentials_audit
after insert or update or delete on private.integration_credentials
for each row execute function private.capture_credential_audit();

-- Capture every tenant-table mutation. audit_events itself is intentionally excluded.
do $audit_triggers$
declare t text;
begin
  for t in
    select tablename from pg_tables
    where schemaname = 'public' and tablename <> 'audit_events'
  loop
    execute format('create trigger capture_audit after insert or update or delete on public.%I for each row execute function public.capture_audit_event()', t);
  end loop;
end
$audit_triggers$;

-- Enable Supabase Realtime when its publication exists (local PGlite/vanilla
-- PostgreSQL verification environments may not create it).
do $realtime$
declare t text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    foreach t in array array[
      'chat_messages', 'chat_reactions', 'chat_read_receipts', 'notifications',
      'shifts', 'time_entries', 'tasks'
    ]
    loop
      if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t
      ) then
        execute format('alter publication supabase_realtime add table public.%I', t);
      end if;
      execute format('alter table public.%I replica identity full', t);
    end loop;
  end if;
end
$realtime$;

comment on function public.calculate_tip_run(uuid) is 'Deterministic largest-remainder cent allocation. Approved adjustments are direct allocations; the remaining pool is weighted.';
comment on view public.approved_labor_daily is 'Payroll-support minutes only. Labor-law overtime/break policy is intentionally not invented in the database.';
