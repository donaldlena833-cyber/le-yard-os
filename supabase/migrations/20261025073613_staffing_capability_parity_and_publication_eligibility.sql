-- Scheduling authority follows the same effective capability used by the UI
-- and draft commands. Publication rechecks current role/employee/assignment
-- eligibility; no existing plan, acknowledgement, decision or financial row is
-- rewritten. Only these three reviewed function bodies may change.
DO $reviewed$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='decide_shift_swap(uuid,uuid,uuid,boolean)'::regprocedure) IS DISTINCT FROM '5bc9cd4776b1f0c52dac3185971d5853' THEN RAISE EXCEPTION 'Reviewed function body drifted: public.decide_shift_swap'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='publish_schedule(uuid,text)'::regprocedure) IS DISTINCT FROM 'bf131916234cc5e48ee8e20b19608102' THEN RAISE EXCEPTION 'Reviewed function body drifted: public.publish_schedule'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='reopen_shift(uuid,uuid)'::regprocedure) IS DISTINCT FROM '0a8e07e098369511bcd5402ed6cada6f' THEN RAISE EXCEPTION 'Reviewed function body drifted: public.reopen_shift'; END IF;
END
$reviewed$;

CREATE OR REPLACE FUNCTION public.decide_shift_swap(p_request_id uuid, p_swap_request_id uuid, p_offer_id uuid, p_approve boolean)
 RETURNS shift_swap_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  actor_id uuid := auth.uid();
  swap_row public.shift_swap_requests%rowtype;
  offer_row public.shift_swap_offers%rowtype;
  shift_row public.shifts%rowtype;
  replacement_employee_id uuid;
  shift_business_date date;
  prior private.shift_transition_requests%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Shift swap decision is required' using errcode = '22023';
  end if;
  select * into swap_row from public.shift_swap_requests where id=p_swap_request_id;
  if swap_row.id is null or not public.has_current_location_capability(swap_row.organization_id, swap_row.location_id, 'schedule.manage') then
    raise exception 'Current swap management access is required' using errcode='42501';
  end if;
  perform private.lock_schedule_assignment_scope(swap_row.organization_id);
  if not public.has_current_location_capability(swap_row.organization_id, swap_row.location_id, 'schedule.manage') then
    raise exception 'Current swap management access is required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('shift-command:' || p_request_id::text, 0));
  select * into prior
  from private.shift_transition_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null then
    if prior.action is distinct from (
      case when p_approve then 'swap' else 'swap-deny' end
    )
      or prior.actor_id is distinct from actor_id
      or prior.related_request_id is distinct from p_swap_request_id then
      raise exception 'Shift command request id was reused' using errcode = '23505';
    end if;
    select * into swap_row from public.shift_swap_requests where id = p_swap_request_id;
    -- Decided offers and request evidence are immutable. Bind the retry to
    -- the original approved offer, or the original preferred-person path.
    if p_approve and (
      (p_offer_id is not null and not exists(select 1 from public.shift_swap_offers offer
        where offer.id=p_offer_id and offer.swap_request_id=swap_row.id
          and offer.offered_by_employee_id=prior.target_employee_id and offer.status='approved'))
      or (p_offer_id is null and (swap_row.preferred_employee_id is distinct from prior.target_employee_id
        or exists(select 1 from public.shift_swap_offers offer where offer.swap_request_id=swap_row.id and offer.status='approved')))
    ) then raise exception 'Shift command request id was reused with a different replacement offer' using errcode='23505'; end if;
    return swap_row;
  end if;

  select * into swap_row
  from public.shift_swap_requests request
  where request.id = p_swap_request_id
  for update;
  if swap_row.id is null then
    raise exception 'Shift swap request not found' using errcode = 'P0002';
  end if;
  if not public.has_current_location_capability(swap_row.organization_id, swap_row.location_id, 'schedule.manage') then
    raise exception 'Not authorized to decide this shift swap' using errcode = '42501';
  end if;
  if swap_row.status <> 'pending' then
    raise exception 'Only a pending shift swap may be decided' using errcode = '23514';
  end if;

  select * into shift_row from public.shifts where id = swap_row.shift_id for update;
  if shift_row.id is null
    or shift_row.organization_id is distinct from swap_row.organization_id
    or shift_row.location_id is distinct from swap_row.location_id
    or shift_row.employee_id is distinct from swap_row.requested_by_employee_id
    or shift_row.status not in ('scheduled', 'claimed') then
    raise exception 'The requested shift assignment is no longer eligible for a swap'
      using errcode = '23514';
  end if;

  if p_approve then
    if p_offer_id is not null then
      select * into offer_row
      from public.shift_swap_offers offer
      where offer.id = p_offer_id
        and offer.swap_request_id = swap_row.id
        and offer.status = 'pending'
      for update;
      if offer_row.id is null then
        raise exception 'Shift swap offer not found' using errcode = 'P0002';
      end if;
      replacement_employee_id := offer_row.offered_by_employee_id;
    else
      replacement_employee_id := swap_row.preferred_employee_id;
    end if;
    if replacement_employee_id is null
      or replacement_employee_id = swap_row.requested_by_employee_id then
      raise exception 'An approved swap requires a different replacement employee'
        using errcode = '23514';
    end if;

    select (shift_row.starts_at at time zone location.timezone)::date
    into shift_business_date
    from public.locations location
    where location.organization_id = shift_row.organization_id
      and location.id = shift_row.location_id
      and location.is_active;
    if not exists (
      select 1
      from public.employees employee
      join public.employee_job_roles assignment
        on assignment.organization_id = employee.organization_id
       and assignment.employee_id = employee.id
      where employee.id = replacement_employee_id
        and employee.organization_id = shift_row.organization_id
        and employee.employment_status = 'active'
        and assignment.location_id = shift_row.location_id
        and assignment.job_role_id = shift_row.job_role_id
        and assignment.effective_from <= shift_business_date
        and (assignment.effective_to is null or assignment.effective_to >= shift_business_date)
    ) then
      raise exception 'Replacement employee is not assigned to the shift role and location'
        using errcode = '23514';
    end if;
  end if;

  if p_approve then
    perform private.assert_shift_assignment_available(shift_row.schedule_id,shift_row.id,replacement_employee_id,shift_row.starts_at,shift_row.ends_at);
  end if;

  insert into private.shift_transition_requests (
    request_id,
    organization_id,
    location_id,
    shift_id,
    actor_id,
    action,
    target_employee_id,
    related_request_id
  ) values (
    p_request_id,
    swap_row.organization_id,
    swap_row.location_id,
    swap_row.shift_id,
    actor_id,
    case when p_approve then 'swap' else 'swap-deny' end,
    replacement_employee_id,
    swap_row.id
  );

  update public.shift_swap_requests request
  set status = case when p_approve then 'approved'::public.request_status else 'denied'::public.request_status end,
      decided_by = actor_id,
      decided_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where request.id = swap_row.id
  returning * into swap_row;

  if p_approve then
    update public.shifts shift_update
    set employee_id = replacement_employee_id,
        updated_at = clock_timestamp()
    where shift_update.id = shift_row.id;
  end if;

  if p_approve and p_offer_id is not null then
    update public.shift_swap_offers offer
    set status = case when offer.id = p_offer_id then 'approved'::public.request_status else 'denied'::public.request_status end,
        updated_at = clock_timestamp()
    where offer.swap_request_id = swap_row.id
      and offer.status = 'pending';
  end if;

  update private.shift_transition_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return swap_row;
end
$function$
;

CREATE OR REPLACE FUNCTION public.publish_schedule(p_schedule_id uuid, p_note text DEFAULT NULL::text)
 RETURNS schedules
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  result public.schedules;
  location_timezone text;
begin
  -- Authorize before taking the table-wide DML barrier. This first lookup is
  -- deliberately non-locking; the same predicate is evaluated again on the
  -- authoritative parent lock below.
  select schedule.* into result
  from public.schedules schedule
  where schedule.id = p_schedule_id
    and auth.uid() is not null
    and public.has_current_location_capability(
      schedule.organization_id,
      schedule.location_id,
      'schedule.publish'
    );
  if result.id is null then
    raise exception 'The schedule is not available for publication'
      using errcode = '42501';
  end if;

  -- Every INSERT/UPDATE/DELETE takes ROW EXCLUSIVE on public.shifts before a
  -- row trigger can wait on its schedule parent. SHARE conflicts with that
  -- mode but is compatible with concurrent SHARE publishers and ROW SHARE
  -- child snapshots. Taking this barrier before the parent row lock gives all
  -- publication/edit interleavings one canonical order: shifts table, parent,
  -- then child rows. Existing DML finishes first; new DML waits before it can
  -- touch a child, eliminating the parent<->child deadlock cycle.
  perform private.lock_schedule_assignment_scope(result.organization_id);
  lock table public.shifts in share mode;

  select schedule.* into result
  from public.schedules schedule
  where schedule.id = p_schedule_id
    and auth.uid() is not null
    and public.has_current_location_capability(
      schedule.organization_id,
      schedule.location_id,
      'schedule.publish'
    )
  for update;
  if result.id is null then
    raise exception 'The schedule is not available for publication'
      using errcode = '42501';
  end if;
  if result.status = 'published' then
    return result;
  end if;
  if result.status <> 'draft' then
    raise exception 'Only draft schedules can be published'
      using errcode = '23514';
  end if;

  -- Lock every existing child in stable order before inspecting or publishing
  -- the parent. A direct shift UPDATE/DELETE that began against the draft must
  -- either finish first and be included in the fresh validation snapshots, or
  -- wait until publication commits and then encounter the published guard.
  -- New child INSERTs are serialized by the parent FOR UPDATE lock through the
  -- schedule foreign key.
  perform shift_row.id
  from public.shifts shift_row
  where shift_row.schedule_id = result.id
  order by shift_row.id
  for update;

  select location.timezone
  into location_timezone
  from public.locations location
  where location.organization_id = result.organization_id
    and location.id = result.location_id;

  if exists (
    select 1
    from public.shifts shift_row
    where shift_row.schedule_id = result.id
      and (
        (shift_row.starts_at at time zone location_timezone)::date
          not between result.week_start and result.week_start + 6
        or (shift_row.ends_at at time zone location_timezone)::date
          < (shift_row.starts_at at time zone location_timezone)::date
        or (shift_row.ends_at at time zone location_timezone)::date
          > (shift_row.starts_at at time zone location_timezone)::date + 1
      )
  ) then
    raise exception 'Every shift must stay within its schedule week with at most an overnight end'
      using errcode = '23514';
  end if;

  if not exists (
    select 1
    from public.shifts shift_row
    where shift_row.schedule_id = result.id
      and shift_row.status <> 'cancelled'
  ) then
    raise exception 'A schedule must contain at least one active shift'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.shifts shift_row
    where shift_row.schedule_id = result.id
      and (
        shift_row.organization_id <> result.organization_id
        or shift_row.location_id <> result.location_id
      )
  ) then
    raise exception 'Every shift must match the schedule tenant and location'
      using errcode = '23514';
  end if;
  -- Draft qualification is provisional. Hold the referenced records through
  -- publication, then validate fresh location-local start-date eligibility.
  -- The existing shifts-table/parent/child order remains unchanged. SHARE row
  -- locks prevent withdrawal from committing between this validation and the
  -- publication; a writer already in flight finishes first (or produces a real
  -- serialization failure for an older repeatable-read snapshot).
  perform job_role.id
  from public.job_roles job_role
  join public.shifts shift_row
    on shift_row.organization_id = job_role.organization_id
   and shift_row.job_role_id = job_role.id
  where shift_row.schedule_id = result.id and shift_row.status <> 'cancelled'
  order by job_role.id
  for share of job_role;
  perform employee.id
  from public.employees employee
  join public.shifts shift_row
    on shift_row.organization_id = employee.organization_id
   and shift_row.employee_id = employee.id
  where shift_row.schedule_id = result.id and shift_row.status <> 'cancelled'
  order by employee.id
  for share of employee;
  perform assignment.id
  from public.employee_job_roles assignment
  join public.shifts shift_row
    on shift_row.organization_id = assignment.organization_id
   and shift_row.employee_id = assignment.employee_id
   and shift_row.job_role_id = assignment.job_role_id
   and shift_row.location_id = assignment.location_id
  where shift_row.schedule_id = result.id and shift_row.status <> 'cancelled'
  order by assignment.id
  for share of assignment;

  if exists (
    select 1 from public.shifts shift_row
    where shift_row.schedule_id = result.id and shift_row.status <> 'cancelled'
      and (
        not exists (
          select 1 from public.job_roles job_role
          where job_role.organization_id = result.organization_id
            and job_role.id = shift_row.job_role_id and job_role.is_active
        )
        or (shift_row.employee_id is not null and (
          not exists (
            select 1 from public.employees employee
            where employee.organization_id = result.organization_id
              and employee.id = shift_row.employee_id
              and employee.employment_status = 'active'
              and (employee.hire_date is null or employee.hire_date
                <= (shift_row.starts_at at time zone location_timezone)::date)
              and (employee.termination_date is null or employee.termination_date
                >= (shift_row.starts_at at time zone location_timezone)::date)
          )
          or not exists (
            select 1 from public.employee_job_roles assignment
            where assignment.organization_id = result.organization_id
              and assignment.employee_id = shift_row.employee_id
              and assignment.job_role_id = shift_row.job_role_id
              and assignment.location_id = result.location_id
              and assignment.effective_from <= (shift_row.starts_at at time zone location_timezone)::date
              and (assignment.effective_to is null or assignment.effective_to
                >= (shift_row.starts_at at time zone location_timezone)::date)
          )
        ))
      )
  ) then
    raise exception 'A schedule shift references an inactive role, employee, or assignment'
      using errcode = '23514';
  end if;

  if exists(select 1 from public.shifts a join public.shifts b
    on a.schedule_id=b.schedule_id and a.id<b.id and a.employee_id=b.employee_id
    where a.schedule_id=result.id and a.employee_id is not null and not a.is_open and not b.is_open
      and a.status in('scheduled','claimed','in_progress') and b.status in('scheduled','claimed','in_progress')
      and tstzrange(a.starts_at,a.ends_at,'[)')&&tstzrange(b.starts_at,b.ends_at,'[)')
  ) then raise exception 'An employee has overlapping shifts in this draft' using errcode='PT409'; end if;
  perform private.assert_shift_assignment_available(result.id,shift_row.id,shift_row.employee_id,shift_row.starts_at,shift_row.ends_at,true)
  from public.shifts shift_row where shift_row.schedule_id=result.id and shift_row.employee_id is not null
    and not shift_row.is_open and shift_row.status in('scheduled','claimed','in_progress');

  update public.schedules
  set
    status = 'published',
    published_by = auth.uid(),
    published_at = now(),
    publish_note = p_note
  where id = result.id
  returning * into result;
  return result;
end
$function$
;

CREATE OR REPLACE FUNCTION public.reopen_shift(p_request_id uuid, p_shift_id uuid)
 RETURNS shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  actor_id uuid := auth.uid();
  shift_row public.shifts%rowtype;
  prior private.shift_transition_requests%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  -- Replayed results still require current scope, using the same retained JWT.
  select * into shift_row from public.shifts where id=p_shift_id;
  if shift_row.id is null or not public.has_current_location_capability(shift_row.organization_id, shift_row.location_id, 'schedule.manage') then
    raise exception 'Current shift access is required' using errcode='42501';
  end if;
  perform private.lock_schedule_assignment_scope(shift_row.organization_id);
  if not public.has_current_location_capability(shift_row.organization_id, shift_row.location_id, 'schedule.manage') then
    raise exception 'Current shift access is required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('shift-command:' || p_request_id::text, 0));
  select * into prior
  from private.shift_transition_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null then
    if prior.action <> 'reopen'
      or prior.actor_id is distinct from actor_id
      or prior.shift_id is distinct from p_shift_id then
      raise exception 'Shift command request id was reused' using errcode = '23505';
    end if;
    select * into shift_row from public.shifts where id = prior.shift_id;
    if shift_row.status <> 'open' or not shift_row.is_open or shift_row.employee_id is not null then
      raise exception 'The reopened shift has since changed' using errcode = 'PT409';
    end if;
    return shift_row;
  end if;

  select * into shift_row
  from public.shifts shift_candidate
  where shift_candidate.id = p_shift_id
  for update;
  if shift_row.id is null then
    raise exception 'Shift not found' using errcode = 'P0002';
  end if;
  if not public.has_current_location_capability(shift_row.organization_id, shift_row.location_id, 'schedule.manage') then
    raise exception 'Not authorized to reopen this shift' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.schedules schedule
    where schedule.id = shift_row.schedule_id and schedule.status = 'published'
  ) or shift_row.status not in ('scheduled', 'claimed', 'cancelled') then
    raise exception 'Only a published scheduled, claimed, or cancelled shift may be reopened'
      using errcode = '23514';
  end if;

  perform private.assert_shift_assignment_available(shift_row.schedule_id,shift_row.id,null,shift_row.starts_at,shift_row.ends_at);

  insert into private.shift_transition_requests (
    request_id,
    organization_id,
    location_id,
    shift_id,
    actor_id,
    action
  ) values (
    p_request_id,
    shift_row.organization_id,
    shift_row.location_id,
    shift_row.id,
    actor_id,
    'reopen'
  );

  update public.shifts shift_update
  set employee_id = null,
      status = 'open',
      is_open = true,
      updated_at = clock_timestamp()
  where shift_update.id = shift_row.id
  returning * into shift_row;

  update private.shift_transition_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return shift_row;
end
$function$
;

UPDATE private.runtime_schema_contract_expected expected
SET migration_head='20261025073613',table_fingerprint=s.value->>'tableFingerprint',function_fingerprint=s.value->>'functionFingerprint',access_fingerprint=s.value->>'accessFingerprint',captured_at=clock_timestamp()
FROM(SELECT private.compute_runtime_schema_fingerprints() value)s WHERE expected.contract_version='runtime-schema-v2';
