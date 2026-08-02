-- Le Yard OS: server-owned operational lifecycles.

alter table public.tasks
add column last_transition_note text;

alter table public.tasks
add constraint tasks_completion_evidence_check
check (
  (status = 'completed' and completed_at is not null and completed_by is not null)
  or (status <> 'completed' and completed_at is null and completed_by is null)
);

alter table public.checklist_runs
add column completed_by uuid references auth.users(id) on delete set null,
add column completion_note text;

alter table public.checklist_runs
add constraint checklist_run_completion_evidence_check
check (
  (status = 'completed' and completed_at is not null and completed_by is not null)
  or (status <> 'completed' and completed_at is null and completed_by is null)
);

alter table public.maintenance_requests
add column resolved_by uuid references auth.users(id) on delete set null,
add column status_note text;

alter table public.maintenance_requests
add constraint maintenance_resolution_evidence_check
check (
  (status = 'completed' and resolved_at is not null and resolved_by is not null)
  or (status <> 'completed' and resolved_at is null and resolved_by is null)
);

alter table public.incidents
add constraint incident_resolution_evidence_check
check (
  (status in ('resolved', 'closed') and resolved_at is not null and resolved_by is not null)
  or (status in ('open', 'investigating') and resolved_at is null and resolved_by is null)
);

create table private.operation_requests (
  request_id uuid primary key,
  operation_kind text not null,
  organization_id uuid not null,
  location_id uuid,
  record_id uuid not null,
  actor_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.operation_requests from public, anon, authenticated;

create function private.claim_operation_request(
  p_request_id uuid,
  p_operation_kind text,
  p_organization_id uuid,
  p_location_id uuid,
  p_record_id uuid,
  p_payload jsonb
)
returns boolean
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  payload_hash text := encode(
    extensions.digest(coalesce(p_payload, 'null'::jsonb)::text, 'sha256'),
    'hex'
  );
  prior private.operation_requests%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'operation-request:' || p_request_id::text,
    0
  ));
  select * into prior
  from private.operation_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null then
    if prior.operation_kind = p_operation_kind
      and prior.organization_id = p_organization_id
      and prior.location_id is not distinct from p_location_id
      and prior.record_id = p_record_id
      and prior.actor_id = actor_id
      and prior.payload_hash = payload_hash
      and prior.completed_at is not null then
      return false;
    end if;
    raise exception 'Operation request id was reused' using errcode = '23505';
  end if;
  insert into private.operation_requests (
    request_id, operation_kind, organization_id, location_id,
    record_id, actor_id, payload_hash
  ) values (
    p_request_id, p_operation_kind, p_organization_id, p_location_id,
    p_record_id, actor_id, payload_hash
  );
  return true;
end
$$;

create function private.complete_operation_request(p_request_id uuid)
returns void
language sql security definer
set search_path = ''
set row_security = off
as $$
  update private.operation_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id
    and request.actor_id = auth.uid()
    and request.completed_at is null
$$;

revoke all on function private.claim_operation_request(uuid, text, uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
revoke all on function private.complete_operation_request(uuid)
from public, anon, authenticated;

create function public.employee_is_effectively_assigned(
  p_employee_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_business_date date
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.employees employee
    join public.employee_job_roles assignment
      on assignment.organization_id = employee.organization_id
     and assignment.employee_id = employee.id
    where employee.id = p_employee_id
      and employee.organization_id = p_organization_id
      and employee.employment_status = 'active'
      and assignment.location_id = p_location_id
      and assignment.effective_from <= p_business_date
      and (assignment.effective_to is null or assignment.effective_to >= p_business_date)
  )
$$;

revoke all on function public.employee_is_effectively_assigned(uuid, uuid, uuid, date)
from public, anon, authenticated;

create function public.create_task(
  p_request_id uuid,
  p_location_id uuid,
  p_title text,
  p_description text,
  p_priority text,
  p_assigned_employee_id uuid default null,
  p_due_at timestamptz default null
)
returns public.tasks
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  task_row public.tasks%rowtype;
  clean_title text := btrim(p_title);
  clean_description text := nullif(btrim(p_description), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if length(clean_title) not between 1 and 240
    or p_priority not in ('low', 'normal', 'high', 'urgent')
    or (clean_description is not null and length(clean_description) > 10000)
    or (p_due_at is not null and p_due_at < clock_timestamp() - interval '370 days') then
    raise exception 'Invalid task payload' using errcode = '22023';
  end if;
  select * into location_row
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if location_row.id is null
    or not public.can_manage_location(location_row.organization_id, location_row.id) then
    raise exception 'Not authorized to create tasks at this location'
      using errcode = '42501';
  end if;
  if p_assigned_employee_id is not null and not public.employee_is_effectively_assigned(
    p_assigned_employee_id,
    location_row.organization_id,
    location_row.id,
    (coalesce(p_due_at, clock_timestamp()) at time zone location_row.timezone)::date
  ) then
    raise exception 'Task assignee has no effective assignment at this location/date'
      using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'task.create',
    location_row.organization_id,
    location_row.id,
    p_request_id,
    jsonb_build_object(
      'title', clean_title,
      'description', clean_description,
      'priority', p_priority,
      'assigned_employee_id', p_assigned_employee_id,
      'due_at', p_due_at
    )
  ) then
    select * into task_row from public.tasks task where task.id = p_request_id;
    if task_row.id is not null then return task_row; end if;
    raise exception 'Task request has no result row' using errcode = '40001';
  end if;
  insert into public.tasks (
    id, organization_id, location_id, title, description,
    status, priority, assigned_employee_id, created_by, due_at,
    source_type, source_id
  ) values (
    p_request_id, location_row.organization_id, location_row.id,
    clean_title, clean_description, 'open', p_priority,
    p_assigned_employee_id, actor_id, p_due_at, 'manual', p_request_id
  ) returning * into task_row;
  perform private.complete_operation_request(p_request_id);
  return task_row;
end
$$;

create function public.transition_task(
  p_request_id uuid,
  p_task_id uuid,
  p_status public.task_status,
  p_note text default null
)
returns public.tasks
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  task_row public.tasks%rowtype;
  clean_note text := nullif(btrim(p_note), '');
  is_manager boolean;
  is_assignee boolean;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_status is null or (clean_note is not null and length(clean_note) > 2000) then
    raise exception 'Invalid task transition' using errcode = '22023';
  end if;
  select * into task_row
  from public.tasks task
  where task.id = p_task_id
  for update;
  if task_row.id is null then
    raise exception 'Task not found' using errcode = 'P0002';
  end if;
  is_manager := case
    when task_row.location_id is null then public.can_operate_org(task_row.organization_id)
    else public.can_manage_location(task_row.organization_id, task_row.location_id)
  end;
  is_assignee := task_row.assigned_employee_id is not null
    and public.is_self_employee(task_row.assigned_employee_id);
  if not is_manager and not is_assignee then
    raise exception 'Not authorized to transition this task' using errcode = '42501';
  end if;
  if not is_manager and p_status not in ('in_progress', 'blocked', 'completed') then
    raise exception 'Assignees may only start, block, or complete their tasks'
      using errcode = '42501';
  end if;
  if task_row.status in ('completed', 'cancelled') and task_row.status <> p_status then
    raise exception 'Terminal tasks are immutable' using errcode = '42501';
  end if;
  if task_row.status not in ('completed', 'cancelled')
    and not (
      (task_row.status = 'open' and p_status in ('open', 'in_progress', 'blocked', 'completed', 'cancelled'))
      or (task_row.status = 'in_progress' and p_status in ('open', 'in_progress', 'blocked', 'completed', 'cancelled'))
      or (task_row.status = 'blocked' and p_status in ('open', 'in_progress', 'blocked', 'cancelled'))
    ) then
    raise exception 'Task status transition is not allowed' using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'task.transition',
    task_row.organization_id,
    task_row.location_id,
    task_row.id,
    jsonb_build_object('status', p_status, 'note', clean_note)
  ) then
    return task_row;
  end if;
  if task_row.status = p_status then
    perform private.complete_operation_request(p_request_id);
    return task_row;
  end if;
  update public.tasks task_update
  set status = p_status,
      completed_at = case when p_status = 'completed' then clock_timestamp() else null end,
      completed_by = case when p_status = 'completed' then actor_id else null end,
      last_transition_note = clean_note,
      updated_at = clock_timestamp()
  where task_update.id = task_row.id
  returning * into task_row;
  perform private.complete_operation_request(p_request_id);
  return task_row;
end
$$;

create function public.start_checklist_run(
  p_request_id uuid,
  p_location_id uuid,
  p_template_id uuid,
  p_business_date date,
  p_assigned_employee_id uuid default null
)
returns public.checklist_runs
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  template_row public.checklist_templates%rowtype;
  run_row public.checklist_runs%rowtype;
  actor_employee_id uuid;
  effective_assignee uuid := p_assigned_employee_id;
  is_manager boolean;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into location_row
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if location_row.id is null
    or not public.can_access_location(location_row.organization_id, location_row.id) then
    raise exception 'Checklist location is unavailable' using errcode = '42501';
  end if;
  if p_business_date is null
    or p_business_date < (clock_timestamp() at time zone location_row.timezone)::date - 370
    or p_business_date > (clock_timestamp() at time zone location_row.timezone)::date + 7 then
    raise exception 'Checklist business date is outside safe bounds'
      using errcode = '22023';
  end if;
  select * into template_row
  from public.checklist_templates template
  where template.id = p_template_id;
  if template_row.id is null
    or template_row.organization_id <> location_row.organization_id
    or template_row.location_id is not null and template_row.location_id <> location_row.id
    or not template_row.is_active then
    raise exception 'Checklist template is unavailable for this location'
      using errcode = '23514';
  end if;
  is_manager := public.can_manage_location(location_row.organization_id, location_row.id);
  select employee.id into actor_employee_id
  from public.employees employee
  where employee.organization_id = location_row.organization_id
    and employee.user_id = actor_id
    and employee.employment_status = 'active';
  if not is_manager then
    if actor_employee_id is null then
      raise exception 'An active employee profile is required' using errcode = '42501';
    end if;
    if effective_assignee is not null and effective_assignee <> actor_employee_id then
      raise exception 'Staff may only start their own checklist run'
        using errcode = '42501';
    end if;
    effective_assignee := actor_employee_id;
  end if;
  if effective_assignee is not null and not public.employee_is_effectively_assigned(
    effective_assignee,
    location_row.organization_id,
    location_row.id,
    p_business_date
  ) then
    raise exception 'Checklist assignee has no effective assignment at this location/date'
      using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'checklist.start',
    location_row.organization_id,
    location_row.id,
    p_request_id,
    jsonb_build_object(
      'template_id', template_row.id,
      'business_date', p_business_date,
      'assigned_employee_id', effective_assignee
    )
  ) then
    select * into run_row from public.checklist_runs run where run.id = p_request_id;
    if run_row.id is not null then return run_row; end if;
    raise exception 'Checklist start request has no result row' using errcode = '40001';
  end if;
  insert into public.checklist_runs (
    id, organization_id, location_id, template_id, business_date,
    status, assigned_employee_id, started_at, created_by
  ) values (
    p_request_id, location_row.organization_id, location_row.id,
    template_row.id, p_business_date, 'in_progress',
    effective_assignee, clock_timestamp(), actor_id
  ) returning * into run_row;
  perform private.complete_operation_request(p_request_id);
  return run_row;
end
$$;

create function public.record_checklist_response(
  p_request_id uuid,
  p_run_id uuid,
  p_template_item_id uuid,
  p_response jsonb,
  p_storage_path text default null,
  p_notes text default null
)
returns public.checklist_responses
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  run_row public.checklist_runs%rowtype;
  item_row public.checklist_template_items%rowtype;
  response_row public.checklist_responses%rowtype;
  clean_path text := nullif(btrim(p_storage_path), '');
  clean_notes text := nullif(btrim(p_notes), '');
  authorized boolean;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_response is null
    or octet_length(p_response::text) > 20000
    or (clean_notes is not null and length(clean_notes) > 2000)
    or (clean_path is not null and length(clean_path) > 1000) then
    raise exception 'Invalid checklist response payload' using errcode = '22023';
  end if;
  select * into run_row
  from public.checklist_runs run
  where run.id = p_run_id
  for update;
  if run_row.id is null then
    raise exception 'Checklist run not found' using errcode = 'P0002';
  end if;
  authorized := public.can_manage_location(run_row.organization_id, run_row.location_id)
    or (run_row.assigned_employee_id is not null
      and public.is_self_employee(run_row.assigned_employee_id));
  if not authorized then
    raise exception 'Not authorized to record this checklist response'
      using errcode = '42501';
  end if;
  if run_row.status <> 'in_progress' or run_row.completed_at is not null then
    raise exception 'Completed or inactive checklist runs are immutable'
      using errcode = '42501';
  end if;
  select * into item_row
  from public.checklist_template_items item
  where item.id = p_template_item_id;
  if item_row.id is null
    or item_row.organization_id <> run_row.organization_id
    or item_row.template_id <> run_row.template_id then
    raise exception 'Checklist item does not belong to this run'
      using errcode = '23514';
  end if;
  if (item_row.response_type = 'checkbox' and jsonb_typeof(p_response) <> 'boolean')
    or (item_row.response_type = 'text' and jsonb_typeof(p_response) <> 'string')
    or (item_row.response_type in ('number', 'temperature') and jsonb_typeof(p_response) <> 'number')
    or (item_row.response_type = 'photo' and (
      clean_path is null or jsonb_typeof(p_response) not in ('string', 'object')
    )) then
    raise exception 'Checklist response does not match the item response type'
      using errcode = '22023';
  end if;
  if clean_path is not null and (
    not public.storage_path_scope_is_valid(clean_path)
    or public.storage_organization_id(clean_path) is distinct from run_row.organization_id
    or public.storage_location_id(clean_path) is distinct from run_row.location_id
    or not exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'checklists'
        and object.name = clean_path
        and object.owner_id = actor_id::text
    )
  ) then
    raise exception 'Checklist attachment object is missing or does not match the run scope'
      using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'checklist.respond',
    run_row.organization_id,
    run_row.location_id,
    run_row.id,
    jsonb_build_object(
      'template_item_id', item_row.id,
      'response', p_response,
      'storage_path', clean_path,
      'notes', clean_notes
    )
  ) then
    select * into response_row
    from public.checklist_responses response
    where response.checklist_run_id = run_row.id
      and response.template_item_id = item_row.id;
    if response_row.id is not null then return response_row; end if;
    raise exception 'Checklist response request has no result row' using errcode = '40001';
  end if;
  select * into response_row
  from public.checklist_responses response
  where response.checklist_run_id = run_row.id
    and response.template_item_id = item_row.id
  for update;
  if response_row.id is null then
    insert into public.checklist_responses (
      id, organization_id, checklist_run_id, template_item_id,
      response, storage_path, responded_by, responded_at, notes
    ) values (
      p_request_id, run_row.organization_id, run_row.id, item_row.id,
      p_response, clean_path, actor_id, clock_timestamp(), clean_notes
    ) returning * into response_row;
  else
    update public.checklist_responses response_update
    set response = p_response,
        storage_path = clean_path,
        responded_by = actor_id,
        responded_at = clock_timestamp(),
        notes = clean_notes
    where response_update.id = response_row.id
    returning * into response_row;
  end if;
  perform private.complete_operation_request(p_request_id);
  return response_row;
end
$$;

create function public.complete_checklist_run(
  p_request_id uuid,
  p_run_id uuid,
  p_note text default null
)
returns public.checklist_runs
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  run_row public.checklist_runs%rowtype;
  clean_note text := nullif(btrim(p_note), '');
  authorized boolean;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if clean_note is not null and length(clean_note) > 2000 then
    raise exception 'Checklist completion note exceeds 2000 characters'
      using errcode = '22023';
  end if;
  select * into run_row
  from public.checklist_runs run
  where run.id = p_run_id
  for update;
  if run_row.id is null then
    raise exception 'Checklist run not found' using errcode = 'P0002';
  end if;
  authorized := public.can_manage_location(run_row.organization_id, run_row.location_id)
    or (run_row.assigned_employee_id is not null
      and public.is_self_employee(run_row.assigned_employee_id));
  if not authorized then
    raise exception 'Not authorized to complete this checklist run'
      using errcode = '42501';
  end if;
  if run_row.status = 'completed' then
    if not private.claim_operation_request(
      p_request_id,
      'checklist.complete',
      run_row.organization_id,
      run_row.location_id,
      run_row.id,
      jsonb_build_object('note', clean_note)
    ) then return run_row; end if;
    raise exception 'Completed checklist has no matching completion request'
      using errcode = '42501';
  end if;
  if run_row.status <> 'in_progress' then
    raise exception 'Only active checklist runs may be completed'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.checklist_template_items item
    where item.organization_id = run_row.organization_id
      and item.template_id = run_row.template_id
      and item.required
      and not exists (
        select 1
        from public.checklist_responses response
        where response.organization_id = run_row.organization_id
          and response.checklist_run_id = run_row.id
          and response.template_item_id = item.id
      )
  ) then
    raise exception 'Every required checklist item needs a response'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from public.checklist_responses response
    where response.organization_id = run_row.organization_id
      and response.checklist_run_id = run_row.id
      and response.storage_path is not null
      and not exists (
        select 1
        from storage.objects object
        where object.bucket_id = 'checklists'
          and object.name = response.storage_path
      )
  ) then
    raise exception 'Checklist response evidence is missing from storage'
      using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'checklist.complete',
    run_row.organization_id,
    run_row.location_id,
    run_row.id,
    jsonb_build_object('note', clean_note)
  ) then return run_row; end if;
  update public.checklist_runs run_update
  set status = 'completed',
      completed_at = clock_timestamp(),
      completed_by = actor_id,
      completion_note = clean_note,
      updated_at = clock_timestamp()
  where run_update.id = run_row.id
  returning * into run_row;
  perform private.complete_operation_request(p_request_id);
  return run_row;
end
$$;

create function public.acknowledge_sop(
  p_request_id uuid,
  p_sop_version_id uuid
)
returns public.sop_acknowledgements
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  version_row public.sop_versions%rowtype;
  document_row public.sop_documents%rowtype;
  employee_row public.employees%rowtype;
  acknowledgement_row public.sop_acknowledgements%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into version_row
  from public.sop_versions version
  where version.id = p_sop_version_id;
  select * into document_row
  from public.sop_documents document
  where document.id = version_row.sop_document_id;
  if version_row.id is null
    or document_row.id is null
    or version_row.organization_id <> document_row.organization_id
    or not document_row.is_published
    or document_row.current_version <> version_row.version
    or version_row.published_at is null then
    raise exception 'Only the current published SOP version may be acknowledged'
      using errcode = '23514';
  end if;
  if not (
    (document_row.location_id is null
      and public.can_access_org(document_row.organization_id))
    or (document_row.location_id is not null
      and public.can_access_location(document_row.organization_id, document_row.location_id))
  ) then
    raise exception 'SOP is unavailable to this actor' using errcode = '42501';
  end if;
  select * into employee_row
  from public.employees employee
  where employee.organization_id = document_row.organization_id
    and employee.user_id = actor_id
    and employee.employment_status = 'active';
  if employee_row.id is null then
    raise exception 'An active employee profile is required' using errcode = '42501';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'sop.acknowledge',
    document_row.organization_id,
    document_row.location_id,
    version_row.id,
    jsonb_build_object('employee_id', employee_row.id)
  ) then
    select * into acknowledgement_row
    from public.sop_acknowledgements acknowledgement
    where acknowledgement.sop_version_id = version_row.id
      and acknowledgement.employee_id = employee_row.id;
    if acknowledgement_row.id is not null then return acknowledgement_row; end if;
    raise exception 'SOP acknowledgement request has no result row'
      using errcode = '40001';
  end if;
  select * into acknowledgement_row
  from public.sop_acknowledgements acknowledgement
  where acknowledgement.sop_version_id = version_row.id
    and acknowledgement.employee_id = employee_row.id;
  if acknowledgement_row.id is null then
    insert into public.sop_acknowledgements (
      id, organization_id, sop_version_id, employee_id, acknowledged_at
    ) values (
      p_request_id, document_row.organization_id, version_row.id,
      employee_row.id, clock_timestamp()
    ) returning * into acknowledgement_row;
  end if;
  perform private.complete_operation_request(p_request_id);
  return acknowledgement_row;
end
$$;

create function public.create_maintenance_request(
  p_request_id uuid,
  p_location_id uuid,
  p_title text,
  p_description text,
  p_category text,
  p_priority text,
  p_assigned_to text default null,
  p_vendor_id uuid default null,
  p_due_at timestamptz default null
)
returns public.maintenance_requests
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  request_row public.maintenance_requests%rowtype;
  clean_title text := btrim(p_title);
  clean_description text := btrim(p_description);
  clean_category text := nullif(btrim(p_category), '');
  clean_assigned_to text := nullif(btrim(p_assigned_to), '');
  is_manager boolean;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if length(clean_title) not between 1 and 240
    or length(clean_description) not between 1 and 10000
    or p_priority not in ('low', 'normal', 'high', 'emergency')
    or (clean_category is not null and length(clean_category) > 120)
    or (clean_assigned_to is not null and length(clean_assigned_to) > 240)
    or (p_due_at is not null and p_due_at < clock_timestamp() - interval '370 days') then
    raise exception 'Invalid maintenance request payload' using errcode = '22023';
  end if;
  select * into location_row
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if location_row.id is null
    or not public.can_access_location(location_row.organization_id, location_row.id) then
    raise exception 'Maintenance location is unavailable' using errcode = '42501';
  end if;
  is_manager := public.can_manage_location(location_row.organization_id, location_row.id);
  if not is_manager and (
    clean_assigned_to is not null or p_vendor_id is not null or p_due_at is not null
  ) then
    raise exception 'Only management may assign, schedule, or select a vendor'
      using errcode = '42501';
  end if;
  if p_vendor_id is not null and not exists (
    select 1 from public.vendors vendor
    where vendor.organization_id = location_row.organization_id
      and vendor.id = p_vendor_id
      and vendor.is_active
  ) then
    raise exception 'Maintenance vendor is unavailable' using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'maintenance.create',
    location_row.organization_id,
    location_row.id,
    p_request_id,
    jsonb_build_object(
      'title', clean_title,
      'description', clean_description,
      'category', clean_category,
      'priority', p_priority,
      'assigned_to', clean_assigned_to,
      'vendor_id', p_vendor_id,
      'due_at', p_due_at
    )
  ) then
    select * into request_row
    from public.maintenance_requests request
    where request.id = p_request_id;
    if request_row.id is not null then return request_row; end if;
    raise exception 'Maintenance request has no result row' using errcode = '40001';
  end if;
  insert into public.maintenance_requests (
    id, organization_id, location_id, title, description, category,
    priority, status, reported_by, assigned_to, vendor_id, due_at
  ) values (
    p_request_id, location_row.organization_id, location_row.id,
    clean_title, clean_description, clean_category, p_priority, 'open',
    actor_id, clean_assigned_to, p_vendor_id, p_due_at
  ) returning * into request_row;
  perform private.complete_operation_request(p_request_id);
  return request_row;
end
$$;

create function public.set_maintenance_status(
  p_request_id uuid,
  p_maintenance_id uuid,
  p_status public.task_status,
  p_assigned_to text default null,
  p_vendor_id uuid default null,
  p_estimated_cost_cents bigint default null,
  p_actual_cost_cents bigint default null,
  p_due_at timestamptz default null,
  p_note text default null
)
returns public.maintenance_requests
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  request_row public.maintenance_requests%rowtype;
  clean_assigned_to text := nullif(btrim(p_assigned_to), '');
  clean_note text := nullif(btrim(p_note), '');
  effective_assigned_to text;
  effective_vendor_id uuid;
  effective_estimated_cost_cents bigint;
  effective_actual_cost_cents bigint;
  effective_due_at timestamptz;
  effective_note text;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_status is null
    or p_estimated_cost_cents < 0
    or p_actual_cost_cents < 0
    or (clean_assigned_to is not null and length(clean_assigned_to) > 240)
    or (clean_note is not null and length(clean_note) > 2000) then
    raise exception 'Invalid maintenance transition payload' using errcode = '22023';
  end if;
  select * into request_row
  from public.maintenance_requests request
  where request.id = p_maintenance_id
  for update;
  if request_row.id is null then
    raise exception 'Maintenance request not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(request_row.organization_id, request_row.location_id) then
    raise exception 'Not authorized to manage this maintenance request'
      using errcode = '42501';
  end if;
  effective_assigned_to := coalesce(clean_assigned_to, request_row.assigned_to);
  effective_vendor_id := coalesce(p_vendor_id, request_row.vendor_id);
  effective_estimated_cost_cents := coalesce(
    p_estimated_cost_cents,
    request_row.estimated_cost_cents
  );
  effective_actual_cost_cents := coalesce(p_actual_cost_cents, request_row.actual_cost_cents);
  effective_due_at := coalesce(p_due_at, request_row.due_at);
  effective_note := coalesce(clean_note, request_row.status_note);
  if effective_vendor_id is not null and not exists (
    select 1 from public.vendors vendor
    where vendor.organization_id = request_row.organization_id
      and vendor.id = effective_vendor_id
      and vendor.is_active
  ) then
    raise exception 'Maintenance vendor is unavailable' using errcode = '23514';
  end if;
  if request_row.status in ('completed', 'cancelled') and request_row.status <> p_status then
    raise exception 'Terminal maintenance requests are immutable'
      using errcode = '42501';
  end if;
  if request_row.status not in ('completed', 'cancelled')
    and not (
      (request_row.status = 'open' and p_status in ('open', 'in_progress', 'blocked', 'completed', 'cancelled'))
      or (request_row.status = 'in_progress' and p_status in ('open', 'in_progress', 'blocked', 'completed', 'cancelled'))
      or (request_row.status = 'blocked' and p_status in ('open', 'in_progress', 'blocked', 'cancelled'))
    ) then
    raise exception 'Maintenance status transition is not allowed'
      using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'maintenance.transition',
    request_row.organization_id,
    request_row.location_id,
    request_row.id,
    jsonb_build_object(
      'status', p_status,
      'assigned_to', effective_assigned_to,
      'vendor_id', effective_vendor_id,
      'estimated_cost_cents', effective_estimated_cost_cents,
      'actual_cost_cents', effective_actual_cost_cents,
      'due_at', effective_due_at,
      'note', effective_note
    )
  ) then return request_row; end if;
  update public.maintenance_requests request_update
  set status = p_status,
      assigned_to = effective_assigned_to,
      vendor_id = effective_vendor_id,
      estimated_cost_cents = effective_estimated_cost_cents,
      actual_cost_cents = effective_actual_cost_cents,
      due_at = effective_due_at,
      resolved_at = case when p_status = 'completed' then clock_timestamp() else null end,
      resolved_by = case when p_status = 'completed' then actor_id else null end,
      status_note = effective_note,
      updated_at = clock_timestamp()
  where request_update.id = request_row.id
  returning * into request_row;
  perform private.complete_operation_request(p_request_id);
  return request_row;
end
$$;

create function public.create_incident(
  p_request_id uuid,
  p_location_id uuid,
  p_incident_type text,
  p_severity text,
  p_description text,
  p_occurred_at timestamptz,
  p_involved_employee_ids uuid[] default '{}'::uuid[],
  p_guest_id uuid default null
)
returns public.incidents
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  incident_row public.incidents%rowtype;
  clean_type text := btrim(p_incident_type);
  clean_description text := btrim(p_description);
  clean_employee_ids uuid[];
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select coalesce(array_agg(distinct employee_id order by employee_id), '{}'::uuid[])
  into clean_employee_ids
  from unnest(coalesce(p_involved_employee_ids, '{}'::uuid[])) employee_id;
  if length(clean_type) not between 1 and 120
    or length(clean_description) not between 1 and 20000
    or p_severity not in ('low', 'medium', 'high', 'critical')
    or p_occurred_at is null
    or p_occurred_at < clock_timestamp() - interval '370 days'
    or p_occurred_at > clock_timestamp() + interval '5 minutes'
    or cardinality(clean_employee_ids) > 100 then
    raise exception 'Invalid incident payload' using errcode = '22023';
  end if;
  select * into location_row
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if location_row.id is null
    or not public.can_access_location(location_row.organization_id, location_row.id) then
    raise exception 'Incident location is unavailable' using errcode = '42501';
  end if;
  if exists (
    select 1 from unnest(clean_employee_ids) employee_id
    where not public.employee_is_effectively_assigned(
      employee_id,
      location_row.organization_id,
      location_row.id,
      (p_occurred_at at time zone location_row.timezone)::date
    )
  ) then
    raise exception 'Every involved employee needs an effective assignment at this location/date'
      using errcode = '23514';
  end if;
  if p_guest_id is not null and not exists (
    select 1 from public.guests guest
    where guest.organization_id = location_row.organization_id
      and guest.id = p_guest_id
      and guest.merged_into_id is null
  ) then
    raise exception 'Incident guest scope is invalid' using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'incident.create',
    location_row.organization_id,
    location_row.id,
    p_request_id,
    jsonb_build_object(
      'incident_type', clean_type,
      'severity', p_severity,
      'description', clean_description,
      'occurred_at', p_occurred_at,
      'involved_employee_ids', clean_employee_ids,
      'guest_id', p_guest_id
    )
  ) then
    select * into incident_row
    from public.incidents incident
    where incident.id = p_request_id;
    if incident_row.id is not null then return incident_row; end if;
    raise exception 'Incident request has no result row' using errcode = '40001';
  end if;
  insert into public.incidents (
    id, organization_id, location_id, incident_type, occurred_at,
    description, severity, status, reported_by,
    involved_employee_ids, guest_id
  ) values (
    p_request_id, location_row.organization_id, location_row.id,
    clean_type, p_occurred_at, clean_description, p_severity,
    'open', actor_id, clean_employee_ids, p_guest_id
  ) returning * into incident_row;
  perform private.complete_operation_request(p_request_id);
  return incident_row;
end
$$;

create function public.set_incident_status(
  p_request_id uuid,
  p_incident_id uuid,
  p_status text,
  p_follow_up text default null
)
returns public.incidents
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  incident_row public.incidents%rowtype;
  clean_follow_up text := nullif(btrim(p_follow_up), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_status not in ('open', 'investigating', 'resolved', 'closed')
    or (clean_follow_up is not null and length(clean_follow_up) > 10000) then
    raise exception 'Invalid incident transition payload' using errcode = '22023';
  end if;
  select * into incident_row
  from public.incidents incident
  where incident.id = p_incident_id
  for update;
  if incident_row.id is null then
    raise exception 'Incident not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(incident_row.organization_id, incident_row.location_id) then
    raise exception 'Not authorized to manage this incident'
      using errcode = '42501';
  end if;
  if incident_row.status = 'closed' and incident_row.status <> p_status then
    raise exception 'Closed incidents are immutable' using errcode = '42501';
  end if;
  if not (
    (incident_row.status = 'open' and p_status in ('open', 'investigating', 'resolved', 'closed'))
    or (incident_row.status = 'investigating' and p_status in ('open', 'investigating', 'resolved', 'closed'))
    or (incident_row.status = 'resolved' and p_status in ('resolved', 'closed'))
    or (incident_row.status = 'closed' and p_status = 'closed')
  ) then
    raise exception 'Incident status transition is not allowed'
      using errcode = '23514';
  end if;
  if p_status in ('resolved', 'closed') and exists (
    select 1
    from public.incident_attachments attachment
    where attachment.organization_id = incident_row.organization_id
      and attachment.incident_id = incident_row.id
      and not exists (
        select 1
        from storage.objects object
        where object.bucket_id = 'incidents'
          and object.name = attachment.storage_path
      )
  ) then
    raise exception 'Incident attachment evidence is missing from storage'
      using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'incident.transition',
    incident_row.organization_id,
    incident_row.location_id,
    incident_row.id,
    jsonb_build_object('status', p_status, 'follow_up', clean_follow_up)
  ) then return incident_row; end if;
  update public.incidents incident_update
  set status = p_status,
      follow_up = clean_follow_up,
      resolved_at = case
        when p_status in ('resolved', 'closed') then coalesce(incident_row.resolved_at, clock_timestamp())
        else null
      end,
      resolved_by = case
        when p_status in ('resolved', 'closed') then coalesce(incident_row.resolved_by, actor_id)
        else null
      end,
      updated_at = clock_timestamp()
  where incident_update.id = incident_row.id
  returning * into incident_row;
  perform private.complete_operation_request(p_request_id);
  return incident_row;
end
$$;

create function public.guard_terminal_operation_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  parent_status public.task_status;
  incident_status text;
begin
  if tg_table_name = 'tasks' then
    if tg_op in ('UPDATE', 'DELETE') and old.status in ('completed', 'cancelled') then
      raise exception 'Terminal tasks are immutable' using errcode = '42501';
    end if;
  elsif tg_table_name = 'checklist_runs' then
    if tg_op in ('UPDATE', 'DELETE') and old.status in ('completed', 'cancelled') then
      raise exception 'Terminal checklist runs are immutable' using errcode = '42501';
    end if;
  elsif tg_table_name = 'checklist_responses' then
    select run.status into parent_status
    from public.checklist_runs run
    where run.id = case when tg_op = 'INSERT' then new.checklist_run_id else old.checklist_run_id end;
    if parent_status in ('completed', 'cancelled') then
      raise exception 'Terminal checklist responses are immutable'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'maintenance_requests' then
    if tg_op in ('UPDATE', 'DELETE') and old.status in ('completed', 'cancelled') then
      raise exception 'Terminal maintenance requests are immutable'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'incidents' then
    if tg_op = 'DELETE' or (tg_op = 'UPDATE' and old.status = 'closed') then
      raise exception 'Closed incident evidence is immutable'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'incident_attachments' then
    select incident.status into incident_status
    from public.incidents incident
    where incident.id = case when tg_op = 'INSERT' then new.incident_id else old.incident_id end;
    if incident_status in ('resolved', 'closed') then
      raise exception 'Resolved incident attachments are immutable'
        using errcode = '42501';
    end if;
    if tg_op = 'INSERT' and auth.uid() is not null then
      new.uploaded_by := auth.uid();
      new.created_at := clock_timestamp();
      if not exists (
        select 1
        from public.incidents incident
        join storage.objects object
          on object.bucket_id = 'incidents'
         and object.name = new.storage_path
         and object.owner_id = auth.uid()::text
        where incident.id = new.incident_id
          and incident.organization_id = new.organization_id
          and public.storage_path_scope_is_valid(new.storage_path)
          and public.storage_organization_id(new.storage_path) = incident.organization_id
          and public.storage_location_id(new.storage_path) = incident.location_id
          and (
            incident.reported_by = auth.uid()
            or public.can_manage_location(incident.organization_id, incident.location_id)
          )
      ) then
        raise exception 'Incident attachment object is missing or out of scope'
          using errcode = '23514';
      end if;
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger task_terminal_evidence_guard
before update or delete on public.tasks
for each row execute function public.guard_terminal_operation_evidence();
create trigger checklist_run_terminal_evidence_guard
before update or delete on public.checklist_runs
for each row execute function public.guard_terminal_operation_evidence();
create trigger checklist_response_terminal_evidence_guard
before insert or update or delete on public.checklist_responses
for each row execute function public.guard_terminal_operation_evidence();
create trigger maintenance_terminal_evidence_guard
before update or delete on public.maintenance_requests
for each row execute function public.guard_terminal_operation_evidence();
create trigger incident_terminal_evidence_guard
before update or delete on public.incidents
for each row execute function public.guard_terminal_operation_evidence();
create trigger incident_attachment_evidence_guard
before insert or update or delete on public.incident_attachments
for each row execute function public.guard_terminal_operation_evidence();

create trigger sop_acknowledgements_append_only
before update or delete on public.sop_acknowledgements
for each row execute function public.prevent_ledger_mutation();

create function public.guard_published_sop_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if tg_op in ('UPDATE', 'DELETE') and old.published_at is not null then
    raise exception 'Published SOP version content is immutable; publish a new version'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger published_sop_version_evidence_guard
before update or delete on public.sop_versions
for each row execute function public.guard_published_sop_evidence();

create or replace function public.storage_object_is_terminal_evidence(
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
      or (
        p_bucket_id = 'sops'
        and exists (
          select 1
          from public.sop_versions version
          where version.storage_path = p_name
            and version.organization_id = public.storage_organization_id(p_name)
            and version.published_at is not null
        )
      )
      or (
        p_bucket_id = 'checklists'
        and exists (
          select 1
          from public.checklist_responses response
          join public.checklist_runs run on run.id = response.checklist_run_id
          where response.storage_path = p_name
            and response.organization_id = public.storage_organization_id(p_name)
            and run.organization_id = response.organization_id
        )
      )
      or (
        p_bucket_id = 'incidents'
        and exists (
          select 1
          from public.incident_attachments attachment
          join public.incidents incident on incident.id = attachment.incident_id
          where attachment.storage_path = p_name
            and attachment.organization_id = public.storage_organization_id(p_name)
            and incident.organization_id = attachment.organization_id
        )
      )
    )
$$;

create policy storage_staff_operations_evidence_insert
on storage.objects for insert to authenticated
with check (
  bucket_id in ('checklists', 'incidents')
  and owner_id = auth.uid()::text
  and public.storage_path_scope_is_valid(name)
  and public.storage_location_id(name) is not null
  and public.can_access_location(
    public.storage_organization_id(name),
    public.storage_location_id(name)
  )
);

-- All mutable lifecycle rows flow through the commands above. Template and SOP
-- authoring remain intentionally service/admin-tool controlled until a version
-- publishing workflow is added.
revoke insert, update, delete on public.tasks from authenticated;
revoke insert, update, delete on public.checklist_runs from authenticated;
revoke insert, update, delete on public.checklist_responses from authenticated;
revoke insert, update, delete on public.checklist_templates from authenticated;
revoke insert, update, delete on public.checklist_template_items from authenticated;
revoke insert, update, delete on public.sop_documents from authenticated;
revoke insert, update, delete on public.sop_versions from authenticated;
revoke insert, update, delete on public.sop_acknowledgements from authenticated;
revoke insert, update, delete on public.maintenance_requests from authenticated;
revoke insert, update, delete on public.incidents from authenticated;
revoke update, delete on public.incident_attachments from authenticated;

revoke all on function public.create_task(uuid, uuid, text, text, text, uuid, timestamptz) from public;
revoke all on function public.transition_task(uuid, uuid, public.task_status, text) from public;
revoke all on function public.start_checklist_run(uuid, uuid, uuid, date, uuid) from public;
revoke all on function public.record_checklist_response(uuid, uuid, uuid, jsonb, text, text) from public;
revoke all on function public.complete_checklist_run(uuid, uuid, text) from public;
revoke all on function public.acknowledge_sop(uuid, uuid) from public;
revoke all on function public.create_maintenance_request(uuid, uuid, text, text, text, text, text, uuid, timestamptz) from public;
revoke all on function public.set_maintenance_status(uuid, uuid, public.task_status, text, uuid, bigint, bigint, timestamptz, text) from public;
revoke all on function public.create_incident(uuid, uuid, text, text, text, timestamptz, uuid[], uuid) from public;
revoke all on function public.set_incident_status(uuid, uuid, text, text) from public;
revoke all on function public.guard_terminal_operation_evidence() from public, anon, authenticated;
revoke all on function public.guard_published_sop_evidence() from public, anon, authenticated;

grant execute on function public.create_task(uuid, uuid, text, text, text, uuid, timestamptz) to authenticated;
grant execute on function public.transition_task(uuid, uuid, public.task_status, text) to authenticated;
grant execute on function public.start_checklist_run(uuid, uuid, uuid, date, uuid) to authenticated;
grant execute on function public.record_checklist_response(uuid, uuid, uuid, jsonb, text, text) to authenticated;
grant execute on function public.complete_checklist_run(uuid, uuid, text) to authenticated;
grant execute on function public.acknowledge_sop(uuid, uuid) to authenticated;
grant execute on function public.create_maintenance_request(uuid, uuid, text, text, text, text, text, uuid, timestamptz) to authenticated;
grant execute on function public.set_maintenance_status(uuid, uuid, public.task_status, text, uuid, bigint, bigint, timestamptz, text) to authenticated;
grant execute on function public.create_incident(uuid, uuid, text, text, text, timestamptz, uuid[], uuid) to authenticated;
grant execute on function public.set_incident_status(uuid, uuid, text, text) to authenticated;

comment on function public.create_task(uuid, uuid, text, text, text, uuid, timestamptz)
is 'Creates an actor-stamped location task through an idempotent management command.';
comment on function public.start_checklist_run(uuid, uuid, uuid, date, uuid)
is 'Starts a server-timestamped checklist run from an active location-compatible template.';
comment on function public.record_checklist_response(uuid, uuid, uuid, jsonb, text, text)
is 'Validates checklist item membership/type and server-stamps the active assignee or manager response.';
comment on function public.acknowledge_sop(uuid, uuid)
is 'Idempotently acknowledges only the current published SOP version as the active employee actor.';
