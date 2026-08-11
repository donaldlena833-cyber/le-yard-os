-- Le Yard OS: atomic schedule draft and reusable-template commands.
-- Publishing intentionally remains a separate approval boundary.

create table private.schedule_command_results (
  request_id uuid primary key
    references private.operation_requests(request_id) on delete cascade,
  operation_kind text not null
    check (operation_kind in ('schedule.create', 'schedule.template.save')),
  organization_id uuid not null,
  location_id uuid not null,
  record_id uuid not null,
  result_payload jsonb not null check (jsonb_typeof(result_payload) = 'object'),
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.schedule_command_results
from public, anon, authenticated;

create function private.local_timestamp_is_unique(
  p_local timestamp,
  p_timezone text
)
returns boolean
language sql stable
set search_path = ''
as $$
  with chosen as (
    select p_local at time zone p_timezone as instant
  ), nearby_offsets as (
    select distinct
      ((chosen.instant + probe.delta) at time zone p_timezone)
        - ((chosen.instant + probe.delta) at time zone 'UTC') as utc_offset
    from chosen
    cross join unnest(array[
      interval '-2 days', interval '-1 day', interval '0 days',
      interval '1 day', interval '2 days'
    ]) probe(delta)
  ), possible_instants as (
    select distinct (p_local - nearby_offsets.utc_offset) at time zone 'UTC' as instant
    from nearby_offsets
  )
  select p_local is not null
    and p_timezone is not null
    and (select instant at time zone p_timezone from chosen) = p_local
    and (
      select count(*)
      from possible_instants possible
      where possible.instant at time zone p_timezone = p_local
    ) = 1
$$;

revoke all on function private.local_timestamp_is_unique(timestamp, text)
from public, anon, authenticated;

-- A row-level BEFORE trigger runs before PostgreSQL waits on the target child
-- tuple. Lock schedule parents first so the published-shift guard cannot read
-- a committed draft, approve a structural edit, then resume that edit after a
-- concurrent publication commits. The trigger name sorts before the existing
-- published_shift_guard; both parent ids are locked in stable order for moves.
create function private.lock_shift_schedule_parents()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  parent_week_start date;
  parent_organization_id uuid;
  parent_location_id uuid;
  parent_timezone text;
  local_start_date date;
  local_end_date date;
begin
  if tg_op = 'INSERT' then
    perform schedule.id
    from public.schedules schedule
    where schedule.id = new.schedule_id
    for key share;
  elsif tg_op = 'DELETE' then
    perform schedule.id
    from public.schedules schedule
    where schedule.id = old.schedule_id
    for key share;
  else
    perform schedule.id
    from public.schedules schedule
    where schedule.id = old.schedule_id
       or schedule.id = new.schedule_id
    order by schedule.id
    for key share;
  end if;

  if tg_op in ('INSERT', 'UPDATE') then
    select
      schedule.week_start,
      schedule.organization_id,
      schedule.location_id,
      location.timezone
    into
      parent_week_start,
      parent_organization_id,
      parent_location_id,
      parent_timezone
    from public.schedules schedule
    join public.locations location
      on location.organization_id = schedule.organization_id
     and location.id = schedule.location_id
    where schedule.id = new.schedule_id;

    if parent_week_start is not null then
      local_start_date := (new.starts_at at time zone parent_timezone)::date;
      local_end_date := (new.ends_at at time zone parent_timezone)::date;
      if new.organization_id <> parent_organization_id
        or new.location_id <> parent_location_id
        or local_start_date not between parent_week_start and parent_week_start + 6
        or local_end_date < local_start_date
        or local_end_date > local_start_date + 1 then
        raise exception 'A shift must stay within its schedule week with at most an overnight end'
          using errcode = '23514';
      end if;
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

revoke all on function private.lock_shift_schedule_parents()
from public, anon, authenticated;

drop trigger if exists a_shift_schedule_parent_lock on public.shifts;
create trigger a_shift_schedule_parent_lock
before insert or update or delete on public.shifts
for each row execute function private.lock_shift_schedule_parents();

create function public.has_current_location_capability(
  p_organization_id uuid,
  p_location_id uuid,
  p_capability_key text
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select coalesce((
    select private.user_has_capability(
      auth.uid(),
      location.organization_id,
      location.id,
      p_capability_key,
      (statement_timestamp() at time zone location.timezone)::date
    )
    from public.locations location
    where location.organization_id = p_organization_id
      and location.id = p_location_id
      and location.is_active
  ), false)
$$;

revoke all on function public.has_current_location_capability(uuid, uuid, text)
from public, anon, authenticated;
grant execute on function public.has_current_location_capability(uuid, uuid, text)
to authenticated;

create function public.create_schedule_draft(
  p_request_id uuid,
  p_location_id uuid,
  p_week_start date,
  p_template_id uuid default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  template_row public.schedule_templates%rowtype;
  schedule_row public.schedules%rowtype;
  configured_weekday smallint;
  effective_on date;
  canonical_payload jsonb;
  result_payload jsonb;
  original_claims jsonb := auth.jwt();
  claimed boolean;
  next_version integer;
  has_invalid_local_time boolean;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_location_id is null or p_week_start is null then
    raise exception 'A request id, location, and week start are required'
      using errcode = '22023';
  end if;

  select location.* into location_row
  from public.locations location
  where location.id = p_location_id
  for share;
  if location_row.id is null or not location_row.is_active then
    raise exception 'The schedule location is not available'
      using errcode = '42501';
  end if;

  effective_on := (statement_timestamp() at time zone location_row.timezone)::date;
  if not private.user_has_capability(
    actor_id,
    location_row.organization_id,
    location_row.id,
    'schedule.manage',
    effective_on
  ) then
    raise exception 'The schedule location is not available'
      using errcode = '42501';
  end if;

  -- Claim before consulting mutable week/template state. A completed exact
  -- retry must survive later configuration changes or source deactivation.
  canonical_payload := jsonb_build_object(
    'locationId', location_row.id,
    'weekStart', p_week_start,
    'templateId', p_template_id
  );
  claimed := private.claim_operation_request(
    p_request_id,
    'schedule.create',
    location_row.organization_id,
    location_row.id,
    p_request_id,
    canonical_payload
  );
  if not claimed then
    select command_result.result_payload into result_payload
    from private.schedule_command_results command_result
    where command_result.request_id = p_request_id
      and command_result.operation_kind = 'schedule.create'
      and command_result.organization_id = location_row.organization_id
      and command_result.location_id = location_row.id
      and command_result.record_id = p_request_id;
    if result_payload is null then
      raise exception 'The completed schedule request has no immutable result'
        using errcode = 'P0002';
    end if;
    return result_payload || jsonb_build_object('replayed', true);
  end if;

  select coalesce(settings.week_starts_on, 1) into configured_weekday
  from public.organization_settings settings
  where settings.organization_id = location_row.organization_id;
  configured_weekday := coalesce(configured_weekday, 1);
  if extract(dow from p_week_start)::smallint <> configured_weekday then
    raise exception 'The schedule date must match the organization week start'
      using errcode = '22023';
  end if;

  if p_template_id is not null then
    select template.* into template_row
    from public.schedule_templates template
    where template.id = p_template_id
      and template.organization_id = location_row.organization_id
      and template.location_id = location_row.id
      and template.is_active
    for update;
    if template_row.id is null then
      raise exception 'The template is not available for this location'
        using errcode = '42501';
    end if;
    perform template_shift.id
    from public.schedule_template_shifts template_shift
    where template_shift.organization_id = location_row.organization_id
      and template_shift.template_id = template_row.id
    order by template_shift.id
    for share;

    -- Lock and validate every referenced workforce record. The historical
    -- shift trigger validates assignment dates but does not reject inactive
    -- roles or terminated employees, so template application must do both.
    perform job_role.id
    from public.job_roles job_role
    join public.schedule_template_shifts template_shift
      on template_shift.organization_id = job_role.organization_id
     and template_shift.job_role_id = job_role.id
    where template_shift.organization_id = location_row.organization_id
      and template_shift.template_id = template_row.id
    order by job_role.id
    for share of job_role;
    perform employee.id
    from public.employees employee
    join public.schedule_template_shifts template_shift
      on template_shift.organization_id = employee.organization_id
     and template_shift.employee_id = employee.id
    where template_shift.organization_id = location_row.organization_id
      and template_shift.template_id = template_row.id
    order by employee.id
    for share of employee;
    perform assignment.id
    from public.employee_job_roles assignment
    join public.schedule_template_shifts template_shift
      on template_shift.organization_id = assignment.organization_id
     and template_shift.employee_id = assignment.employee_id
     and template_shift.job_role_id = assignment.job_role_id
    where template_shift.organization_id = location_row.organization_id
      and template_shift.template_id = template_row.id
      and assignment.location_id = location_row.id
    order by assignment.id
    for share of assignment;

    if exists (
      select 1
      from public.schedule_template_shifts template_shift
      where template_shift.organization_id = location_row.organization_id
        and template_shift.template_id = template_row.id
        and (
          not exists (
            select 1 from public.job_roles job_role
            where job_role.organization_id = location_row.organization_id
              and job_role.id = template_shift.job_role_id
              and job_role.is_active
          )
          or (
            template_shift.employee_id is not null
            and (
              not exists (
                select 1 from public.employees employee
                where employee.organization_id = location_row.organization_id
                  and employee.id = template_shift.employee_id
                  and employee.employment_status = 'active'
                  and (
                    employee.hire_date is null
                    or employee.hire_date <= (
                      p_week_start
                        + ((template_shift.weekday
                            - extract(dow from p_week_start)::integer + 7) % 7)
                    )
                  )
                  and (
                    employee.termination_date is null
                    or employee.termination_date >= (
                      p_week_start
                        + ((template_shift.weekday
                            - extract(dow from p_week_start)::integer + 7) % 7)
                    )
                  )
              )
              or not exists (
                select 1 from public.employee_job_roles assignment
                where assignment.organization_id = location_row.organization_id
                  and assignment.employee_id = template_shift.employee_id
                  and assignment.job_role_id = template_shift.job_role_id
                  and assignment.location_id = location_row.id
                  and assignment.effective_from <= (
                    p_week_start
                      + ((template_shift.weekday
                          - extract(dow from p_week_start)::integer + 7) % 7)
                  )
                  and (
                    assignment.effective_to is null
                    or assignment.effective_to >= (
                      p_week_start
                        + ((template_shift.weekday
                            - extract(dow from p_week_start)::integer + 7) % 7)
                    )
                  )
              )
            )
          )
        )
    ) then
      raise exception 'A template shift references an inactive role, employee, or assignment'
        using errcode = '23514';
    end if;
  end if;

  -- A transaction-scoped namespace lock makes max(version) + 1 safe even when
  -- the week has no existing schedule row available for a row lock.
  perform pg_advisory_xact_lock(hashtextextended(
    'schedule-version:' || location_row.organization_id::text || ':' ||
      location_row.id::text || ':' || p_week_start::text,
    0
  ));
  select coalesce(max(schedule.version), 0) + 1 into next_version
  from public.schedules schedule
  where schedule.organization_id = location_row.organization_id
    and schedule.location_id = location_row.id
    and schedule.week_start = p_week_start;

  perform set_config(
    'request.jwt.claims',
    (coalesce(original_claims, '{}'::jsonb)
      || jsonb_build_object('request_id', p_request_id::text))::text,
    true
  );

  insert into public.schedules (
    id, organization_id, location_id, week_start, status, version,
    template_id, created_by
  ) values (
    p_request_id, location_row.organization_id, location_row.id, p_week_start,
    'draft', next_version, p_template_id, actor_id
  )
  returning * into schedule_row;

  if p_template_id is not null then
    with concrete as (
      select
        p_week_start
          + ((template_shift.weekday - extract(dow from p_week_start)::integer + 7) % 7)
          + template_shift.starts_at as local_start,
        p_week_start
          + ((template_shift.weekday - extract(dow from p_week_start)::integer + 7) % 7)
          + case when template_shift.ends_at <= template_shift.starts_at then 1 else 0 end
          + template_shift.ends_at as local_end
      from public.schedule_template_shifts template_shift
      where template_shift.organization_id = location_row.organization_id
        and template_shift.template_id = p_template_id
    )
    select exists (
      select 1
      from concrete
      where not private.local_timestamp_is_unique(local_start, location_row.timezone)
        or not private.local_timestamp_is_unique(local_end, location_row.timezone)
        or (local_end at time zone location_row.timezone)
            <= (local_start at time zone location_row.timezone)
    ) into has_invalid_local_time;
    if has_invalid_local_time then
      raise exception 'A template shift is invalid in the location timezone'
        using errcode = '22023';
    end if;

    insert into public.shifts (
      organization_id, location_id, schedule_id, employee_id, job_role_id,
      starts_at, ends_at, break_minutes, status, is_open, notes
    )
    select
      location_row.organization_id,
      location_row.id,
      schedule_row.id,
      template_shift.employee_id,
      template_shift.job_role_id,
      (
        p_week_start
          + ((template_shift.weekday - extract(dow from p_week_start)::integer + 7) % 7)
          + template_shift.starts_at
      ) at time zone location_row.timezone,
      (
        p_week_start
          + ((template_shift.weekday - extract(dow from p_week_start)::integer + 7) % 7)
          + case when template_shift.ends_at <= template_shift.starts_at then 1 else 0 end
          + template_shift.ends_at
      ) at time zone location_row.timezone,
      template_shift.break_minutes,
      case
        when template_shift.employee_id is null then 'open'::public.shift_status
        else 'scheduled'::public.shift_status
      end,
      template_shift.employee_id is null,
      template_shift.notes
    from public.schedule_template_shifts template_shift
    where template_shift.organization_id = location_row.organization_id
      and template_shift.template_id = p_template_id
    order by template_shift.id;
  end if;

  result_payload := jsonb_build_object(
    'id', schedule_row.id,
    'status', 'draft',
    'version', schedule_row.version
  );
  insert into private.schedule_command_results (
    request_id, operation_kind, organization_id, location_id, record_id,
    result_payload
  ) values (
    p_request_id, 'schedule.create', location_row.organization_id,
    location_row.id, schedule_row.id, result_payload
  );
  perform private.complete_operation_request(p_request_id);
  perform set_config(
    'request.jwt.claims',
    coalesce(original_claims, '{}'::jsonb)::text,
    true
  );
  return result_payload || jsonb_build_object('replayed', false);
end
$$;

create function public.save_schedule_template(
  p_request_id uuid,
  p_schedule_id uuid,
  p_name text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  schedule_row public.schedules%rowtype;
  location_row public.locations%rowtype;
  template_row public.schedule_templates%rowtype;
  clean_name text := btrim(p_name);
  effective_on date;
  canonical_payload jsonb;
  result_payload jsonb;
  original_claims jsonb := auth.jwt();
  claimed boolean;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_schedule_id is null
    or clean_name is null or char_length(clean_name) not between 2 and 120 then
    raise exception 'A request id, schedule, and template name are required'
      using errcode = '22023';
  end if;

  select schedule.* into schedule_row
  from public.schedules schedule
  where schedule.id = p_schedule_id;
  if schedule_row.id is null then
    raise exception 'The schedule is not available' using errcode = '42501';
  end if;
  select location.* into location_row
  from public.locations location
  where location.organization_id = schedule_row.organization_id
    and location.id = schedule_row.location_id
  for share;
  if location_row.id is null or not location_row.is_active then
    raise exception 'The schedule is not available' using errcode = '42501';
  end if;

  effective_on := (statement_timestamp() at time zone location_row.timezone)::date;
  if not private.user_has_capability(
    actor_id,
    schedule_row.organization_id,
    schedule_row.location_id,
    'schedule.manage',
    effective_on
  ) then
    raise exception 'The schedule is not available'
      using errcode = '42501';
  end if;

  canonical_payload := jsonb_build_object(
    'scheduleId', p_schedule_id,
    'name', clean_name
  );
  claimed := private.claim_operation_request(
    p_request_id,
    'schedule.template.save',
    schedule_row.organization_id,
    schedule_row.location_id,
    p_request_id,
    canonical_payload
  );
  if not claimed then
    select command_result.result_payload into result_payload
    from private.schedule_command_results command_result
    where command_result.request_id = p_request_id
      and command_result.operation_kind = 'schedule.template.save'
      and command_result.organization_id = schedule_row.organization_id
      and command_result.location_id = schedule_row.location_id
      and command_result.record_id = p_request_id;
    if result_payload is null then
      raise exception 'The completed template request has no immutable result'
        using errcode = 'P0002';
    end if;
    return result_payload || jsonb_build_object('replayed', true);
  end if;

  -- The normalized location/name namespace is locked before checking the
  -- unique key, so concurrent callers receive one deterministic winner.
  perform pg_advisory_xact_lock(hashtextextended(
    'schedule-template-name:' || schedule_row.organization_id::text || ':' ||
      schedule_row.location_id::text || ':' || clean_name,
    0
  ));

  -- Authenticated draft-shift DML takes ROW EXCLUSIVE on public.shifts before
  -- its row trigger can lock the schedule parent. Take this compatible SHARE
  -- barrier before the parent row lock so a template snapshot can never hold
  -- parent -> wait for child while an editor holds child -> waits for parent.
  -- Concurrent snapshot/publish readers remain compatible with one another.
  lock table public.shifts in share mode;

  -- FOR UPDATE blocks publication and new child FK acquisition. Locking the
  -- active children in stable id order blocks edits/cancellation/deletion, so
  -- the later insert-select copies exactly this short-lived snapshot.
  select schedule.* into schedule_row
  from public.schedules schedule
  where schedule.id = p_schedule_id
    and schedule.organization_id = location_row.organization_id
    and schedule.location_id = location_row.id
  for update;
  if schedule_row.id is null then
    raise exception 'The schedule is not available' using errcode = '42501';
  end if;
  if schedule_row.status <> 'draft' then
    raise exception 'Only draft schedules can be saved as templates'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.schedule_templates template
    where template.location_id = schedule_row.location_id
      and template.name = clean_name
  ) then
    raise exception 'A schedule template already uses this name'
      using errcode = '23505',
        constraint = 'schedule_templates_location_id_name_key';
  end if;
  perform shift.id
  from public.shifts shift
    where shift.organization_id = schedule_row.organization_id
      and shift.schedule_id = schedule_row.id
      and shift.status <> 'cancelled'
  order by shift.id
  for share;
  if not found then
    raise exception 'Add at least one shift before saving a template'
      using errcode = '23514';
  end if;

  if exists (
    select 1
    from public.shifts shift
    where shift.organization_id = schedule_row.organization_id
      and shift.schedule_id = schedule_row.id
      and shift.status <> 'cancelled'
      and (
        -- Template rows retain one weekday plus two wall-clock values. Preserve
        -- the represented same-day/overnight relationship exactly; elapsed
        -- duration alone is lossy across DST boundaries and multi-day shifts.
        (
          (shift.ends_at at time zone location_row.timezone)::date
            - (shift.starts_at at time zone location_row.timezone)::date
        ) <> case
          when (shift.ends_at at time zone location_row.timezone)::time
              <= (shift.starts_at at time zone location_row.timezone)::time
            then 1
          else 0
        end
        or not private.local_timestamp_is_unique(
          shift.starts_at at time zone location_row.timezone,
          location_row.timezone
        )
        or not private.local_timestamp_is_unique(
          shift.ends_at at time zone location_row.timezone,
          location_row.timezone
        )
      )
  ) then
    raise exception 'A schedule shift cannot be represented safely by a reusable template'
      using errcode = '23514';
  end if;

  perform job_role.id
  from public.job_roles job_role
  join public.shifts shift
    on shift.organization_id = job_role.organization_id
   and shift.job_role_id = job_role.id
  where shift.organization_id = schedule_row.organization_id
    and shift.schedule_id = schedule_row.id
    and shift.status <> 'cancelled'
  order by job_role.id
  for share of job_role;
  perform employee.id
  from public.employees employee
  join public.shifts shift
    on shift.organization_id = employee.organization_id
   and shift.employee_id = employee.id
  where shift.organization_id = schedule_row.organization_id
    and shift.schedule_id = schedule_row.id
    and shift.status <> 'cancelled'
  order by employee.id
  for share of employee;
  perform assignment.id
  from public.employee_job_roles assignment
  join public.shifts shift
    on shift.organization_id = assignment.organization_id
   and shift.employee_id = assignment.employee_id
   and shift.job_role_id = assignment.job_role_id
  where shift.organization_id = schedule_row.organization_id
    and shift.schedule_id = schedule_row.id
    and shift.status <> 'cancelled'
    and assignment.location_id = schedule_row.location_id
  order by assignment.id
  for share of assignment;

  if exists (
    select 1
    from public.shifts shift
    where shift.organization_id = schedule_row.organization_id
      and shift.schedule_id = schedule_row.id
      and shift.status <> 'cancelled'
      and (
        not exists (
          select 1 from public.job_roles job_role
          where job_role.organization_id = schedule_row.organization_id
            and job_role.id = shift.job_role_id
            and job_role.is_active
        )
        or (
          shift.employee_id is not null
          and (
            not exists (
              select 1 from public.employees employee
              where employee.organization_id = schedule_row.organization_id
                and employee.id = shift.employee_id
                and employee.employment_status = 'active'
                and (
                  employee.hire_date is null
                  or employee.hire_date
                      <= (shift.starts_at at time zone location_row.timezone)::date
                )
                and (
                  employee.termination_date is null
                  or employee.termination_date
                      >= (shift.starts_at at time zone location_row.timezone)::date
                )
            )
            or not exists (
              select 1 from public.employee_job_roles assignment
              where assignment.organization_id = schedule_row.organization_id
                and assignment.employee_id = shift.employee_id
                and assignment.job_role_id = shift.job_role_id
                and assignment.location_id = schedule_row.location_id
                and assignment.effective_from
                    <= (shift.starts_at at time zone location_row.timezone)::date
                and (
                  assignment.effective_to is null
                  or assignment.effective_to
                      >= (shift.starts_at at time zone location_row.timezone)::date
                )
            )
          )
        )
      )
  ) then
    raise exception 'A schedule shift references an inactive role, employee, or assignment'
      using errcode = '23514';
  end if;

  perform set_config(
    'request.jwt.claims',
    (coalesce(original_claims, '{}'::jsonb)
      || jsonb_build_object('request_id', p_request_id::text))::text,
    true
  );

  insert into public.schedule_templates (
    id, organization_id, location_id, name, description, created_by, is_active
  ) values (
    p_request_id,
    schedule_row.organization_id,
    schedule_row.location_id,
    clean_name,
    'Saved from schedule week ' || schedule_row.week_start::text,
    actor_id,
    true
  )
  returning * into template_row;

  insert into public.schedule_template_shifts (
    organization_id, template_id, weekday, starts_at, ends_at,
    job_role_id, employee_id, break_minutes, notes
  )
  select
    schedule_row.organization_id,
    template_row.id,
    extract(dow from (shift.starts_at at time zone location_row.timezone))::smallint,
    (shift.starts_at at time zone location_row.timezone)::time,
    (shift.ends_at at time zone location_row.timezone)::time,
    shift.job_role_id,
    shift.employee_id,
    shift.break_minutes,
    shift.notes
  from public.shifts shift
  where shift.organization_id = schedule_row.organization_id
    and shift.schedule_id = schedule_row.id
    and shift.status <> 'cancelled'
  order by shift.starts_at, shift.id;

  result_payload := jsonb_build_object('id', template_row.id);
  insert into private.schedule_command_results (
    request_id, operation_kind, organization_id, location_id, record_id,
    result_payload
  ) values (
    p_request_id, 'schedule.template.save', schedule_row.organization_id,
    schedule_row.location_id, template_row.id, result_payload
  );
  perform private.complete_operation_request(p_request_id);
  perform set_config(
    'request.jwt.claims',
    coalesce(original_claims, '{}'::jsonb)::text,
    true
  );
  return result_payload || jsonb_build_object('replayed', false);
end
$$;

-- Scheduling drafts and templates are capability-authoritative. Published
-- schedules remain visible to active location members, but a Manager role
-- cannot bypass an explicit manage/publish denial or expired grant.
drop policy schedule_template_read on public.schedule_templates;
drop policy schedule_template_write on public.schedule_templates;
drop policy schedule_read on public.schedules;
drop policy schedule_write on public.schedules;
drop policy shift_read on public.shifts;
drop policy shift_write on public.shifts;
drop policy template_shift_read on public.schedule_template_shifts;
drop policy template_shift_manager_write on public.schedule_template_shifts;

create policy schedule_template_read
on public.schedule_templates for select to authenticated
using (
  public.has_current_location_capability(
    organization_id, location_id, 'schedule.manage'
  )
  or public.has_current_location_capability(
    organization_id, location_id, 'schedule.publish'
  )
);

create policy schedule_template_write
on public.schedule_templates for all to authenticated
using (
  public.has_current_location_capability(
    organization_id, location_id, 'schedule.manage'
  )
)
with check (
  public.has_current_location_capability(
    organization_id, location_id, 'schedule.manage'
  )
);

create policy schedule_read
on public.schedules for select to authenticated
using (
  (
    status = 'published'
    and public.can_access_location(organization_id, location_id)
  )
  or public.has_current_location_capability(
    organization_id, location_id, 'schedule.manage'
  )
  or public.has_current_location_capability(
    organization_id, location_id, 'schedule.publish'
  )
);

create policy schedule_write
on public.schedules for all to authenticated
using (
  public.has_current_location_capability(
    organization_id, location_id, 'schedule.manage'
  )
)
with check (
  public.has_current_location_capability(
    organization_id, location_id, 'schedule.manage'
  )
);

create policy shift_read
on public.shifts for select to authenticated
using (
  (
    public.can_access_location(organization_id, location_id)
    and exists (
      select 1
      from public.schedules schedule
      where schedule.id = shifts.schedule_id
        and schedule.organization_id = shifts.organization_id
        and schedule.location_id = shifts.location_id
        and schedule.status = 'published'
    )
  )
  or public.has_current_location_capability(
    organization_id, location_id, 'schedule.manage'
  )
  or public.has_current_location_capability(
    organization_id, location_id, 'schedule.publish'
  )
);

create policy shift_write
on public.shifts for all to authenticated
using (
  public.has_current_location_capability(
    organization_id, location_id, 'schedule.manage'
  )
)
with check (
  public.has_current_location_capability(
    organization_id, location_id, 'schedule.manage'
  )
);

create policy template_shift_read
on public.schedule_template_shifts for select to authenticated
using (exists (
  select 1
  from public.schedule_templates template
  where template.id = schedule_template_shifts.template_id
    and template.organization_id = schedule_template_shifts.organization_id
    and (
      public.has_current_location_capability(
        template.organization_id, template.location_id, 'schedule.manage'
      )
      or public.has_current_location_capability(
        template.organization_id, template.location_id, 'schedule.publish'
      )
    )
));

create policy template_shift_manager_write
on public.schedule_template_shifts for all to authenticated
using (exists (
  select 1
  from public.schedule_templates template
  where template.id = schedule_template_shifts.template_id
    and template.organization_id = schedule_template_shifts.organization_id
    and public.has_current_location_capability(
      template.organization_id, template.location_id, 'schedule.manage'
    )
))
with check (exists (
  select 1
  from public.schedule_templates template
  where template.id = schedule_template_shifts.template_id
    and template.organization_id = schedule_template_shifts.organization_id
    and public.has_current_location_capability(
      template.organization_id, template.location_id, 'schedule.manage'
    )
));

-- Publication stays a separate command and requires schedule.publish, not a
-- manager role or schedule.manage. Filtering the locked lookup by capability
-- gives missing and unauthorized schedules the same externally visible error.
create or replace function public.publish_schedule(
  p_schedule_id uuid,
  p_note text default null
)
returns public.schedules
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
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
$$;

-- Parent/child creation now has one database-authoritative command path.
revoke insert, update, delete on table public.schedules from authenticated;
revoke update (week_start, version, template_id)
on table public.schedules from authenticated;
revoke insert, update, delete on table public.schedule_templates from authenticated;
revoke insert, update, delete on table public.schedule_template_shifts from authenticated;

revoke all on function public.create_schedule_draft(uuid, uuid, date, uuid)
from public, anon, authenticated;
revoke all on function public.save_schedule_template(uuid, uuid, text)
from public, anon, authenticated;
revoke all on function public.publish_schedule(uuid, text)
from public, anon, authenticated;
grant execute on function public.create_schedule_draft(uuid, uuid, date, uuid)
to authenticated;
grant execute on function public.save_schedule_template(uuid, uuid, text)
to authenticated;
grant execute on function public.publish_schedule(uuid, text)
to authenticated;

comment on function public.create_schedule_draft(uuid, uuid, date, uuid) is
  'Atomically creates one actor-bound, replay-safe draft and optional template shifts. Publishing is separate.';
comment on function public.save_schedule_template(uuid, uuid, text) is
  'Atomically snapshots one managed draft into an actor-bound, replay-safe reusable template.';
