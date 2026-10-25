-- Staffing retries, assignment serialization and current published-plan overlap guards.
DO $reviewed$
BEGIN
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.claim_open_shift(uuid,uuid)'::regprocedure) IS DISTINCT FROM '5d1ca8b0c4a6a8cbe7c76c39339733a8' THEN RAISE EXCEPTION 'Reviewed staffing function body drifted: public.claim_open_shift'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.decide_shift_swap(uuid,uuid,uuid,boolean)'::regprocedure) IS DISTINCT FROM '4117700c653ee3ab31f5a0ba10dc1c1d' THEN RAISE EXCEPTION 'Reviewed staffing function body drifted: public.decide_shift_swap'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.offer_shift_swap(uuid,uuid,text)'::regprocedure) IS DISTINCT FROM '65ad1d35adc38ab96aae948bf5d365ae' THEN RAISE EXCEPTION 'Reviewed staffing function body drifted: public.offer_shift_swap'; END IF;
  -- The hosted catalog retained the exact migration0008 implementation.
  -- Both reviewed predecessors are upgraded to the same guarded publication
  -- below; unknown bodies still stop this migration before any changes.
  IF coalesce((SELECT md5(prosrc) FROM pg_proc WHERE oid='public.publish_schedule(uuid,text)'::regprocedure),'') NOT IN ('cd0fea5db4a3786eb099ba5a9c94f225','db3c23cd12c8623ec753da7b945ef7b9') THEN RAISE EXCEPTION 'Reviewed staffing function body drifted: public.publish_schedule'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.reopen_shift(uuid,uuid)'::regprocedure) IS DISTINCT FROM '80fa76c04ee44abc173c3369bc524ad3' THEN RAISE EXCEPTION 'Reviewed staffing function body drifted: public.reopen_shift'; END IF;
  IF (SELECT md5(prosrc) FROM pg_proc WHERE oid='public.request_shift_swap(uuid,uuid,uuid,text)'::regprocedure) IS DISTINCT FROM '9a5f7a937cffe1fde8e2c620ccc4a523' THEN RAISE EXCEPTION 'Reviewed staffing function body drifted: public.request_shift_swap'; END IF;
END
$reviewed$;

-- A real row write serializes assignment commands and forces a genuine
-- serialization failure under repeatable-read rather than accepting a stale
-- snapshot after an advisory-lock wait. Publication takes this before its
-- existing shifts-table/parent/child lock order.
CREATE TABLE private.schedule_assignment_scopes (
  organization_id uuid PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  revision bigint NOT NULL CHECK (revision > 0)
);
ALTER TABLE private.schedule_assignment_scopes ENABLE ROW LEVEL SECURITY;
ALTER TABLE private.schedule_assignment_scopes FORCE ROW LEVEL SECURITY;
REVOKE ALL ON private.schedule_assignment_scopes FROM PUBLIC, anon, authenticated, service_role;

CREATE FUNCTION private.lock_schedule_assignment_scope(p_organization_id uuid)
RETURNS void LANGUAGE sql VOLATILE SECURITY DEFINER SET search_path='' SET row_security=off
AS $scope$
  INSERT INTO private.schedule_assignment_scopes AS scope(organization_id,revision)
  VALUES(p_organization_id,1)
  ON CONFLICT(organization_id) DO UPDATE SET revision=scope.revision+1;
$scope$;
REVOKE ALL ON FUNCTION private.lock_schedule_assignment_scope(uuid) FROM PUBLIC, anon, authenticated, service_role;

-- Only the newest published version for each location/week is an operating
-- plan. A new publication replaces that location/week; drafts remain proposals.
CREATE FUNCTION private.assert_shift_assignment_available(
  p_schedule_id uuid,p_shift_id uuid,p_employee_id uuid,
  p_starts_at timestamptz,p_ends_at timestamptz,p_replacing_week boolean DEFAULT false
) RETURNS void LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' SET row_security=off
AS $availability$
DECLARE candidate public.schedules%rowtype;
BEGIN
  SELECT * INTO candidate FROM public.schedules WHERE id=p_schedule_id;
  IF candidate.id IS NULL THEN RAISE EXCEPTION 'Schedule is unavailable' USING ERRCODE='PT409'; END IF;
  IF NOT p_replacing_week AND (
    candidate.status<>'published' OR EXISTS(
      SELECT 1 FROM public.schedules newer WHERE newer.organization_id=candidate.organization_id
        AND newer.location_id=candidate.location_id AND newer.week_start=candidate.week_start
        AND newer.status='published' AND newer.version>candidate.version
    )
  ) THEN RAISE EXCEPTION 'This published schedule has been superseded' USING ERRCODE='PT409'; END IF;
  IF p_employee_id IS NULL THEN RETURN; END IF;
  IF EXISTS(
    SELECT 1 FROM public.shifts assigned JOIN public.schedules plan ON plan.id=assigned.schedule_id
    WHERE assigned.organization_id=candidate.organization_id AND assigned.employee_id=p_employee_id
      AND assigned.id IS DISTINCT FROM p_shift_id AND NOT assigned.is_open
      AND assigned.status IN('scheduled','claimed','in_progress') AND plan.status='published'
      AND NOT EXISTS(SELECT 1 FROM public.schedules newer
        WHERE newer.organization_id=plan.organization_id AND newer.location_id=plan.location_id
          AND newer.week_start=plan.week_start AND newer.status='published' AND newer.version>plan.version)
      AND NOT(p_replacing_week AND plan.location_id=candidate.location_id AND plan.week_start=candidate.week_start)
      AND tstzrange(assigned.starts_at,assigned.ends_at,'[)')&&tstzrange(p_starts_at,p_ends_at,'[)')
  ) THEN RAISE EXCEPTION 'This employee already has overlapping published work' USING ERRCODE='PT409'; END IF;
END
$availability$;
REVOKE ALL ON FUNCTION private.assert_shift_assignment_available(uuid,uuid,uuid,timestamptz,timestamptz,boolean)
FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.claim_open_shift(p_request_id uuid, p_shift_id uuid)
 RETURNS shifts
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  actor_id uuid := auth.uid();
  shift_row public.shifts%rowtype;
  employee_row public.employees%rowtype;
  prior private.shift_transition_requests%rowtype;
  shift_business_date date;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  -- Replayed results still require current scope, using the same retained JWT.
  select * into shift_row from public.shifts where id=p_shift_id;
  if shift_row.id is null or not public.can_access_location(shift_row.organization_id,shift_row.location_id) then
    raise exception 'Current shift access is required' using errcode='42501';
  end if;
  perform private.lock_schedule_assignment_scope(shift_row.organization_id);
  if not public.can_access_location(shift_row.organization_id,shift_row.location_id) then
    raise exception 'Current shift access is required' using errcode='42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('shift-command:' || p_request_id::text, 0));

  select * into prior
  from private.shift_transition_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null then
    if prior.action <> 'claim'
      or prior.actor_id is distinct from actor_id
      or prior.shift_id is distinct from p_shift_id then
      raise exception 'Shift command request id was reused' using errcode = '23505';
    end if;
    select * into shift_row from public.shifts where id = prior.shift_id;
    if shift_row.employee_id is distinct from prior.target_employee_id then
      raise exception 'The claimed shift has since been reassigned' using errcode = 'PT409';
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
  if not public.can_access_location(shift_row.organization_id, shift_row.location_id) then
    raise exception 'Not authorized to claim this shift' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.schedules schedule
    where schedule.id = shift_row.schedule_id
      and schedule.organization_id = shift_row.organization_id
      and schedule.location_id = shift_row.location_id
      and schedule.status = 'published'
  ) or shift_row.status <> 'open'
    or not shift_row.is_open
    or shift_row.employee_id is not null then
    raise exception 'Only an unassigned open shift on a published schedule may be claimed'
      using errcode = '23514';
  end if;

  select employee.* into employee_row
  from public.employees employee
  where employee.organization_id = shift_row.organization_id
    and employee.user_id = actor_id
    and employee.employment_status = 'active';
  if employee_row.id is null then
    raise exception 'No active employee record matches the caller' using errcode = '42501';
  end if;

  select (shift_row.starts_at at time zone location.timezone)::date
  into shift_business_date
  from public.locations location
  where location.organization_id = shift_row.organization_id
    and location.id = shift_row.location_id
    and location.is_active;
  if shift_business_date is null or not exists (
    select 1
    from public.employee_job_roles assignment
    where assignment.organization_id = shift_row.organization_id
      and assignment.employee_id = employee_row.id
      and assignment.job_role_id = shift_row.job_role_id
      and assignment.location_id = shift_row.location_id
      and assignment.effective_from <= shift_business_date
      and (assignment.effective_to is null or assignment.effective_to >= shift_business_date)
  ) then
    raise exception 'The caller is not assigned to this shift role and location'
      using errcode = '23514';
  end if;

  perform private.assert_shift_assignment_available(shift_row.schedule_id,shift_row.id,employee_row.id,shift_row.starts_at,shift_row.ends_at);

  insert into private.shift_transition_requests (
    request_id,
    organization_id,
    location_id,
    shift_id,
    actor_id,
    action,
    target_employee_id
  ) values (
    p_request_id,
    shift_row.organization_id,
    shift_row.location_id,
    shift_row.id,
    actor_id,
    'claim',
    employee_row.id
  );

  update public.shifts shift_update
  set employee_id = employee_row.id,
      status = 'claimed',
      is_open = false,
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
  if swap_row.id is null or not public.can_manage_location(swap_row.organization_id,swap_row.location_id) then
    raise exception 'Current swap management access is required' using errcode='42501';
  end if;
  perform private.lock_schedule_assignment_scope(swap_row.organization_id);
  if not public.can_manage_location(swap_row.organization_id,swap_row.location_id) then
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
  if not public.can_manage_location(swap_row.organization_id, swap_row.location_id) then
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

CREATE OR REPLACE FUNCTION public.offer_shift_swap(p_request_id uuid, p_swap_request_id uuid, p_message text DEFAULT NULL::text)
 RETURNS shift_swap_offers
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  actor_id uuid := auth.uid();
  swap_row public.shift_swap_requests%rowtype;
  shift_row public.shifts%rowtype;
  employee_row public.employees%rowtype;
  offer_row public.shift_swap_offers%rowtype;
  shift_business_date date;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('swap-offer:' || p_request_id::text, 0));
  select * into offer_row from public.shift_swap_offers where id = p_request_id;
  if offer_row.id is not null then
    select * into swap_row from public.shift_swap_requests where id=offer_row.swap_request_id;
    if swap_row.id is null or not public.can_access_location(swap_row.organization_id,swap_row.location_id) then
      raise exception 'Current swap access is required' using errcode='42501';
    end if;
    if offer_row.swap_request_id is distinct from p_swap_request_id
      or offer_row.message is distinct from nullif(btrim(p_message), '') then
      raise exception 'Shift swap offer request id was reused' using errcode = '23505';
    end if;
    select * into employee_row
    from public.employees employee
    where employee.id = offer_row.offered_by_employee_id;
    if employee_row.user_id is distinct from actor_id then
      raise exception 'Shift swap offer belongs to another employee' using errcode = '42501';
    end if;
    return offer_row;
  end if;

  select * into swap_row
  from public.shift_swap_requests request
  where request.id = p_swap_request_id
  for update;
  if swap_row.id is null then
    raise exception 'Shift swap request not found' using errcode = 'P0002';
  end if;
  if swap_row.status <> 'pending'
    or not public.can_access_location(swap_row.organization_id, swap_row.location_id) then
    raise exception 'Shift swap request is not available' using errcode = '42501';
  end if;
  select * into shift_row from public.shifts where id = swap_row.shift_id;
  if shift_row.id is null
    or shift_row.employee_id is distinct from swap_row.requested_by_employee_id
    or shift_row.status not in ('scheduled', 'claimed') then
    raise exception 'The requested shift is no longer available for swapping'
      using errcode = '23514';
  end if;
  select * into employee_row
  from public.employees employee
  where employee.organization_id = swap_row.organization_id
    and employee.user_id = actor_id
    and employee.employment_status = 'active';
  if employee_row.id is null or employee_row.id = swap_row.requested_by_employee_id then
    raise exception 'A different active employee must make the offer'
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
    from public.employee_job_roles assignment
    where assignment.organization_id = shift_row.organization_id
      and assignment.employee_id = employee_row.id
      and assignment.job_role_id = shift_row.job_role_id
      and assignment.location_id = shift_row.location_id
      and assignment.effective_from <= shift_business_date
      and (assignment.effective_to is null or assignment.effective_to >= shift_business_date)
  ) then
    raise exception 'Offering employee is not assigned to the shift role and location'
      using errcode = '23514';
  end if;

  perform private.assert_shift_assignment_available(shift_row.schedule_id,shift_row.id,employee_row.id,shift_row.starts_at,shift_row.ends_at);

  insert into public.shift_swap_offers (
    id,
    organization_id,
    swap_request_id,
    offered_by_employee_id,
    message,
    status
  ) values (
    p_request_id,
    swap_row.organization_id,
    swap_row.id,
    employee_row.id,
    nullif(btrim(p_message), ''),
    'pending'
  ) returning * into offer_row;
  return offer_row;
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
  if shift_row.id is null or not public.can_manage_location(shift_row.organization_id,shift_row.location_id) then
    raise exception 'Current shift access is required' using errcode='42501';
  end if;
  perform private.lock_schedule_assignment_scope(shift_row.organization_id);
  if not public.can_manage_location(shift_row.organization_id,shift_row.location_id) then
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
  if not public.can_manage_location(shift_row.organization_id, shift_row.location_id) then
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

CREATE OR REPLACE FUNCTION public.request_shift_swap(p_request_id uuid, p_shift_id uuid, p_preferred_employee_id uuid DEFAULT NULL::uuid, p_reason text DEFAULT NULL::text)
 RETURNS shift_swap_requests
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  actor_id uuid := auth.uid();
  shift_row public.shifts%rowtype;
  actor_employee public.employees%rowtype;
  result public.shift_swap_requests%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('swap-request:' || p_request_id::text, 0));
  select * into result from public.shift_swap_requests where id = p_request_id;
  if result.id is not null then
    if not public.can_access_location(result.organization_id,result.location_id) then
      raise exception 'Current swap access is required' using errcode='42501';
    end if;
    if result.shift_id is distinct from p_shift_id
      or result.preferred_employee_id is distinct from p_preferred_employee_id
      or result.reason is distinct from nullif(btrim(p_reason), '') then
      raise exception 'Shift swap request id was reused' using errcode = '23505';
    end if;
    select * into actor_employee
    from public.employees employee
    where employee.id = result.requested_by_employee_id;
    if actor_employee.user_id is distinct from actor_id then
      raise exception 'Shift swap request belongs to another employee' using errcode = '42501';
    end if;
    return result;
  end if;

  select * into shift_row from public.shifts where id = p_shift_id for update;
  if shift_row.id is null then
    raise exception 'Shift not found' using errcode = 'P0002';
  end if;
  select * into actor_employee
  from public.employees employee
  where employee.organization_id = shift_row.organization_id
    and employee.user_id = actor_id
    and employee.employment_status = 'active';
  if actor_employee.id is null
    or shift_row.employee_id is distinct from actor_employee.id
    or shift_row.status not in ('scheduled', 'claimed')
    or not public.can_access_location(shift_row.organization_id, shift_row.location_id)
    or not exists (
      select 1 from public.schedules schedule
      where schedule.id = shift_row.schedule_id and schedule.status = 'published'
    ) then
    raise exception 'Only the assigned employee may request a swap for an active published shift'
      using errcode = '42501';
  end if;
  if p_preferred_employee_id is not null and not exists (
    select 1 from public.employees employee
    where employee.id = p_preferred_employee_id
      and employee.organization_id = shift_row.organization_id
      and employee.employment_status = 'active'
  ) then
    raise exception 'Preferred employee is unavailable' using errcode = '23514';
  end if;

  perform private.assert_shift_assignment_available(shift_row.schedule_id,shift_row.id,null,shift_row.starts_at,shift_row.ends_at);

  insert into public.shift_swap_requests (
    id,
    organization_id,
    location_id,
    shift_id,
    requested_by_employee_id,
    preferred_employee_id,
    reason,
    status
  ) values (
    p_request_id,
    shift_row.organization_id,
    shift_row.location_id,
    shift_row.id,
    actor_employee.id,
    p_preferred_employee_id,
    nullif(btrim(p_reason), ''),
    'pending'
  )
  returning * into result;
  return result;
end
$function$
;

UPDATE private.runtime_schema_contract_expected expected
SET migration_head='20261025062929',table_fingerprint=s.value->>'tableFingerprint',function_fingerprint=s.value->>'functionFingerprint',access_fingerprint=s.value->>'accessFingerprint',captured_at=clock_timestamp()
FROM(SELECT private.compute_runtime_schema_fingerprints() value)s WHERE expected.contract_version='runtime-schema-v2';
