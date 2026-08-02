-- Le Yard OS: trusted integration queues, report completion evidence, and
-- server-derived notification delivery.

alter table public.import_jobs
add column content_sha256 text,
add column declared_total_rows integer,
add column declared_headers text[],
add column validation_version text,
add column started_at timestamptz,
add column error_message text;

alter table public.import_jobs
add constraint import_jobs_content_sha256_check
check (content_sha256 is null or content_sha256 ~ '^[0-9a-f]{64}$'),
add constraint import_jobs_declared_total_rows_check
check (declared_total_rows is null or declared_total_rows between 1 and 10000),
add constraint import_jobs_validation_version_check
check (validation_version is null or validation_version = 'manual-csv-v1'),
add constraint import_jobs_mapping_size_check
check (pg_column_size(mapping) <= 32768);

alter table public.integration_sync_jobs
add column retry_of_id uuid references public.integration_sync_jobs(id) on delete restrict,
add column requested_by uuid references auth.users(id) on delete restrict;

alter table public.export_jobs
add column started_at timestamptz;

alter table public.notifications
add column evidence_key text;

alter table public.notifications
add constraint notifications_evidence_key_check
check (evidence_key is null or length(evidence_key) between 1 and 500);

create unique index notifications_evidence_key_unique
on public.notifications (organization_id, evidence_key)
where evidence_key is not null;

create function public.manual_import_headers_are_valid(p_headers text[])
returns boolean
language sql immutable security definer
set search_path = ''
set row_security = off
as $$
  select p_headers is not null
    and cardinality(p_headers) between 1 and 100
    and not exists (
      select 1
      from unnest(p_headers) header(value)
      where header.value is null
        or length(header.value) not between 1 and 120
        or header.value !~ '^[a-z0-9]+(?:_[a-z0-9]+)*$'
    )
    and cardinality(p_headers) = (
      select count(distinct header.value)::integer
      from unnest(p_headers) header(value)
    )
$$;

create function public.guard_notification_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if (to_jsonb(new) - 'read_at') is distinct from (to_jsonb(old) - 'read_at') then
    raise exception 'Notification recipient, content, action, entity, and creation evidence are immutable'
      using errcode = '42501';
  end if;
  if old.read_at is not null then
    if new.read_at is distinct from old.read_at then
      raise exception 'Read notifications cannot be changed or marked unread'
        using errcode = '42501';
    end if;
    return new;
  end if;
  if new.read_at is null then
    raise exception 'Notification updates may only mark an unread notification as read'
      using errcode = '42501';
  end if;
  new.read_at := clock_timestamp();
  return new;
end
$$;

create trigger notification_evidence_guard
before update on public.notifications
for each row execute function public.guard_notification_evidence();

create function private.emit_derived_notification(
  p_organization_id uuid,
  p_user_id uuid,
  p_evidence_key text,
  p_notification_type text,
  p_title text,
  p_body text,
  p_action_url text,
  p_entity_type text,
  p_entity_id uuid
)
returns void
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if p_user_id is null then return; end if;
  insert into public.notifications (
    organization_id, user_id, notification_type, title, body,
    action_url, entity_type, entity_id, evidence_key, created_at
  )
  select p_organization_id, p_user_id, p_notification_type,
    p_title, p_body, p_action_url, p_entity_type, p_entity_id,
    p_evidence_key, clock_timestamp()
  where exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_user_id
      and membership.status = 'active'
  )
  on conflict (organization_id, evidence_key) where evidence_key is not null
  do nothing;
end
$$;

create function private.notify_schedule_publication()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  recipient record;
begin
  if new.status = 'published' and old.status is distinct from new.status then
    for recipient in
      select distinct employee.user_id
      from public.shifts shift_row
      join public.employees employee
        on employee.organization_id = shift_row.organization_id
       and employee.id = shift_row.employee_id
      where shift_row.schedule_id = new.id
        and shift_row.status <> 'cancelled'
        and employee.user_id is not null
        and employee.employment_status = 'active'
    loop
      perform private.emit_derived_notification(
        new.organization_id,
        recipient.user_id,
        'schedule.published:' || new.id::text || ':' || recipient.user_id::text,
        'schedule_published',
        'Schedule published',
        'Your schedule for the week of ' || new.week_start::text || ' is ready.',
        '/schedule',
        'schedule',
        new.id
      );
    end loop;
  end if;
  return new;
end
$$;

create trigger schedule_publication_notification
after update on public.schedules
for each row execute function private.notify_schedule_publication();

create function private.notify_shift_assignment()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  recipient_user_id uuid;
  schedule_status public.schedule_status;
begin
  if new.employee_id is null
    or (tg_op = 'UPDATE' and old.employee_id is not distinct from new.employee_id) then
    return new;
  end if;
  select schedule.status into schedule_status
  from public.schedules schedule
  where schedule.id = new.schedule_id;
  if schedule_status <> 'published' then return new; end if;
  select employee.user_id into recipient_user_id
  from public.employees employee
  where employee.organization_id = new.organization_id
    and employee.id = new.employee_id
    and employee.employment_status = 'active';
  perform private.emit_derived_notification(
    new.organization_id,
    recipient_user_id,
    'shift.assigned:' || new.id::text || ':' || new.employee_id::text || ':'
      || extract(epoch from new.updated_at)::bigint::text,
    'shift_assigned',
    'Shift assigned',
    'A shift beginning ' || to_char(new.starts_at, 'YYYY-MM-DD HH24:MI TZ')
      || ' was assigned to you.',
    '/schedule',
    'shift',
    new.id
  );
  return new;
end
$$;

create trigger shift_assignment_notification
after insert or update on public.shifts
for each row execute function private.notify_shift_assignment();

create function private.notify_shift_swap_decision()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  recipient_user_id uuid;
begin
  if old.status = 'pending' and new.status in ('approved', 'denied') then
    select employee.user_id into recipient_user_id
    from public.employees employee
    where employee.organization_id = new.organization_id
      and employee.id = new.requested_by_employee_id;
    perform private.emit_derived_notification(
      new.organization_id,
      recipient_user_id,
      'shift-swap.decided:' || new.id::text || ':' || new.status::text,
      'shift_swap_decided',
      case when new.status = 'approved' then 'Shift swap approved' else 'Shift swap declined' end,
      case
        when new.status = 'approved' then 'Your shift swap request was approved.'
        else 'Your shift swap request was declined.'
      end,
      '/schedule',
      'shift_swap_request',
      new.id
    );
  end if;
  return new;
end
$$;

create trigger shift_swap_decision_notification
after update on public.shift_swap_requests
for each row execute function private.notify_shift_swap_decision();

create function private.notify_time_correction_decision()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if old.status = 'pending' and new.status in ('approved', 'denied') then
    perform private.emit_derived_notification(
      new.organization_id,
      new.requested_by,
      'time-correction.decided:' || new.id::text || ':' || new.status::text,
      'time_correction_decided',
      case when new.status = 'approved' then 'Time correction approved' else 'Time correction declined' end,
      case
        when new.status = 'approved' then 'Your time correction request was approved.'
        else 'Your time correction request was declined.'
      end,
      '/time-clock',
      'time_entry_correction',
      new.id
    );
  end if;
  return new;
end
$$;

create trigger time_correction_decision_notification
after update on public.time_entry_corrections
for each row execute function private.notify_time_correction_decision();

create function private.notify_task_assignment()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  recipient_user_id uuid;
begin
  if new.assigned_employee_id is null
    or (tg_op = 'UPDATE' and old.assigned_employee_id is not distinct from new.assigned_employee_id) then
    return new;
  end if;
  select employee.user_id into recipient_user_id
  from public.employees employee
  where employee.organization_id = new.organization_id
    and employee.id = new.assigned_employee_id
    and employee.employment_status = 'active';
  perform private.emit_derived_notification(
    new.organization_id,
    recipient_user_id,
    'task.assigned:' || new.id::text || ':' || new.assigned_employee_id::text,
    'task_assigned',
    'Task assigned',
    new.title,
    '/tasks',
    'task',
    new.id
  );
  return new;
end
$$;

create trigger task_assignment_notification
after insert or update on public.tasks
for each row execute function private.notify_task_assignment();

create function public.guard_integration_job_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if tg_op = 'DELETE' then
    raise exception '% is durable queue evidence and cannot be deleted', tg_table_name
      using errcode = '42501';
  end if;
  if tg_table_name = 'integration_sync_jobs' then
    if old.id is distinct from new.id
      or old.organization_id is distinct from new.organization_id
      or old.connection_id is distinct from new.connection_id
      or old.direction is distinct from new.direction
      or old.resource_type is distinct from new.resource_type
      or old.attempts is distinct from new.attempts
      or old.max_attempts is distinct from new.max_attempts
      or old.retry_of_id is distinct from new.retry_of_id
      or old.requested_by is distinct from new.requested_by
      or old.created_at is distinct from new.created_at then
      raise exception 'Integration sync identity, scope, resource, and attempt evidence are immutable'
        using errcode = '42501';
    end if;
  elsif tg_table_name = 'import_jobs' then
    if old.id is distinct from new.id
      or old.organization_id is distinct from new.organization_id
      or old.location_id is distinct from new.location_id
      or old.import_type is distinct from new.import_type
      or old.file_name is distinct from new.file_name
      or old.storage_path is distinct from new.storage_path
      or old.mapping is distinct from new.mapping
      or old.content_sha256 is distinct from new.content_sha256
      or old.declared_total_rows is distinct from new.declared_total_rows
      or old.declared_headers is distinct from new.declared_headers
      or old.validation_version is distinct from new.validation_version
      or old.requested_by is distinct from new.requested_by
      or old.created_at is distinct from new.created_at then
      raise exception 'Import identity, scope, file, and declaration evidence are immutable'
        using errcode = '42501';
    end if;
  end if;

  if old.status in ('succeeded', 'partially_succeeded', 'failed', 'cancelled') then
    raise exception 'Terminal integration jobs are immutable' using errcode = '42501';
  end if;
  if not (
    (old.status = 'queued' and new.status in ('queued', 'running', 'failed', 'cancelled'))
    or (old.status = 'running' and new.status in (
      'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled'
    ))
  ) then
    raise exception 'Integration job status transition is not allowed'
      using errcode = '23514';
  end if;
  if new.status = 'running' and (new.started_at is null or new.completed_at is not null) then
    raise exception 'Running integration jobs require a start stamp and no completion stamp'
      using errcode = '23514';
  end if;
  if new.status in ('succeeded', 'partially_succeeded', 'failed', 'cancelled')
    and new.completed_at is null then
    raise exception 'Terminal integration jobs require a completion stamp'
      using errcode = '23514';
  end if;
  if tg_table_name = 'import_jobs'
    and new.status in ('succeeded', 'partially_succeeded')
    and (
      new.total_rows is null
      or new.successful_rows + new.failed_rows <> new.total_rows
    ) then
    raise exception 'Completed imports require reconciled authoritative row counts'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger integration_sync_job_evidence_guard
before update or delete on public.integration_sync_jobs
for each row execute function public.guard_integration_job_evidence();

create trigger import_job_evidence_guard
before update or delete on public.import_jobs
for each row execute function public.guard_integration_job_evidence();

create function public.create_manual_csv_import(
  p_request_id uuid,
  p_location_id uuid,
  p_import_type text,
  p_file_name text,
  p_storage_path text,
  p_content_sha256 text,
  p_total_rows integer,
  p_headers text[],
  p_mapping jsonb
)
returns public.import_jobs
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  object_row storage.objects%rowtype;
  import_row public.import_jobs%rowtype;
  clean_file_name text := btrim(p_file_name);
  path_file_segment text;
  file_size_text text;
  file_mime_type text;
  mapping_key_count integer;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into location_row
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if location_row.id is null or not public.can_manage_org(location_row.organization_id) then
    raise exception 'Manual imports require Admin or Owner access with the required assurance level'
      using errcode = '42501';
  end if;
  if p_import_type not in (
      'toast_sales', 'resy_reservations', 'guest_profiles', 'inventory_items'
    )
    or length(clean_file_name) not between 5 and 180
    or clean_file_name !~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    or lower(clean_file_name) not like '%.csv'
    or p_content_sha256 !~ '^[0-9a-f]{64}$'
    or p_total_rows not between 1 and 10000
    or not public.manual_import_headers_are_valid(p_headers)
    or jsonb_typeof(p_mapping) <> 'object'
    or pg_column_size(p_mapping) > 32768
    or p_mapping ->> 'validation_version' is distinct from 'manual-csv-v1'
    or jsonb_typeof(p_mapping -> 'columns') <> 'object' then
    raise exception 'Invalid manual CSV import declaration' using errcode = '22023';
  end if;
  if (p_import_type = 'toast_sales'
        and not array['business_date', 'net_sales']::text[] <@ p_headers)
    or (p_import_type = 'resy_reservations'
        and not array[
          'reservation_id', 'reserved_at', 'guest_name', 'party_size', 'status'
        ]::text[] <@ p_headers)
    or (p_import_type = 'guest_profiles'
        and (
          not array['display_name']::text[] <@ p_headers
          or not (array['email']::text[] <@ p_headers or array['phone']::text[] <@ p_headers)
        ))
    or (p_import_type = 'inventory_items'
        and not array['name', 'base_unit']::text[] <@ p_headers) then
    raise exception 'Manual CSV declaration is missing required headers'
      using errcode = '22023';
  end if;
  select count(*)::integer into mapping_key_count
  from jsonb_object_keys(p_mapping -> 'columns');
  if mapping_key_count <> cardinality(p_headers)
    or exists (
      select 1
      from unnest(p_headers) header(value)
      where jsonb_typeof((p_mapping -> 'columns') -> header.value) <> 'string'
        or (p_mapping -> 'columns') ->> header.value is distinct from header.value
    ) then
    raise exception 'Manual CSV mapping must exactly declare each normalized header'
      using errcode = '22023';
  end if;

  path_file_segment := split_part(p_storage_path, '/', 5);
  if length(p_storage_path) > 1000
    or not public.storage_path_scope_is_valid(p_storage_path)
    or cardinality(string_to_array(p_storage_path, '/')) <> 5
    or public.storage_organization_id(p_storage_path) is distinct from location_row.organization_id
    or public.storage_location_id(p_storage_path) is distinct from location_row.id
    or split_part(p_storage_path, '/', 3) <> 'imports'
    or split_part(p_storage_path, '/', 4) <> p_request_id::text
    or substring(path_file_segment from 1 for 36)
      !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    or substring(path_file_segment from 37 for 1) <> '-'
    or substring(path_file_segment from 38) <> clean_file_name then
    raise exception 'Manual CSV object path does not match the request scope'
      using errcode = '23514';
  end if;

  select * into object_row
  from storage.objects object
  where object.bucket_id = 'imports'
    and object.name = p_storage_path
    and object.owner_id = actor_id::text
  for update;
  file_mime_type := lower(coalesce(
    object_row.metadata ->> 'mimetype',
    object_row.metadata ->> 'contentType',
    ''
  ));
  file_size_text := coalesce(object_row.metadata ->> 'size', '');
  if object_row.id is null
    or file_mime_type !~ '^text/csv(?:;|$)'
    or file_size_text !~ '^[0-9]{1,10}$'
    or file_size_text::bigint not between 1 and 5242880 then
    raise exception 'Manual CSV storage object is missing or violates the 5 MB text/csv contract'
      using errcode = '23514';
  end if;

  if not private.claim_operation_request(
    p_request_id,
    'integration.import.manual_csv',
    location_row.organization_id,
    location_row.id,
    p_request_id,
    jsonb_build_object(
      'import_type', p_import_type,
      'file_name', clean_file_name,
      'storage_path', p_storage_path,
      'content_sha256', p_content_sha256,
      'declared_total_rows', p_total_rows,
      'declared_headers', p_headers,
      'mapping', p_mapping
    )
  ) then
    select * into import_row
    from public.import_jobs import_candidate
    where import_candidate.id = p_request_id;
    if import_row.id is not null then return import_row; end if;
    raise exception 'Manual import request has no result row' using errcode = '40001';
  end if;

  insert into public.import_jobs (
    id, organization_id, location_id, import_type, file_name,
    storage_path, status, mapping, total_rows, successful_rows,
    failed_rows, requested_by, content_sha256, declared_total_rows,
    declared_headers, validation_version, created_at
  ) values (
    p_request_id, location_row.organization_id, location_row.id,
    p_import_type, clean_file_name, p_storage_path, 'queued', p_mapping,
    null, 0, 0, actor_id, p_content_sha256, p_total_rows,
    p_headers, 'manual-csv-v1', clock_timestamp()
  ) returning * into import_row;

  insert into public.integration_events (
    organization_id, connection_id, event_type, severity, message, metadata
  ) values (
    location_row.organization_id,
    null,
    'manual_csv_import_queued',
    'info',
    'A validated manual CSV import was queued.',
    jsonb_build_object(
      'import_job_id', import_row.id,
      'location_id', import_row.location_id,
      'import_type', import_row.import_type,
      'declared_total_rows', import_row.declared_total_rows,
      'content_sha256', import_row.content_sha256,
      'validation_version', import_row.validation_version
    )
  );
  perform private.complete_operation_request(p_request_id);
  return import_row;
end
$$;

create function public.retry_integration_sync_job(
  p_request_id uuid,
  p_sync_job_id uuid
)
returns public.integration_sync_jobs
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  source_row public.integration_sync_jobs%rowtype;
  retry_row public.integration_sync_jobs%rowtype;
  connection_row public.integration_connections%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_request_id = p_sync_job_id then
    raise exception 'Retry request id must differ from the source sync job id'
      using errcode = '22023';
  end if;
  select * into source_row
  from public.integration_sync_jobs sync_job
  where sync_job.id = p_sync_job_id
  for update;
  if source_row.id is null then
    raise exception 'Integration sync job not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_org(source_row.organization_id) then
    raise exception 'Integration retries require Admin or Owner access with the required assurance level'
      using errcode = '42501';
  end if;
  if source_row.status <> 'failed' then
    raise exception 'Only failed integration sync jobs may be retried'
      using errcode = '23514';
  end if;
  if source_row.attempts >= source_row.max_attempts then
    raise exception 'Integration sync retry limit has been reached'
      using errcode = '23514';
  end if;
  select * into connection_row
  from public.integration_connections connection
  where connection.organization_id = source_row.organization_id
    and connection.id = source_row.connection_id;
  if connection_row.id is null then
    raise exception 'Integration connection not found' using errcode = 'P0002';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'integration.sync.retry',
    source_row.organization_id,
    connection_row.location_id,
    p_request_id,
    jsonb_build_object('source_sync_job_id', source_row.id)
  ) then
    select * into retry_row
    from public.integration_sync_jobs sync_job
    where sync_job.id = p_request_id;
    if retry_row.id is not null then return retry_row; end if;
    raise exception 'Integration retry request has no result row' using errcode = '40001';
  end if;

  insert into public.integration_sync_jobs (
    id, organization_id, connection_id, direction, resource_type,
    status, cursor, attempts, max_attempts, next_attempt_at,
    records_processed, error_message, started_at, completed_at,
    retry_of_id, requested_by, created_at, updated_at
  ) values (
    p_request_id, source_row.organization_id, source_row.connection_id,
    source_row.direction, source_row.resource_type, 'queued', source_row.cursor,
    source_row.attempts + 1, source_row.max_attempts, clock_timestamp(),
    0, null, null, null, source_row.id, actor_id,
    clock_timestamp(), clock_timestamp()
  ) returning * into retry_row;

  insert into public.integration_events (
    organization_id, connection_id, event_type, severity, message, metadata
  ) values (
    source_row.organization_id,
    source_row.connection_id,
    'integration_sync_retry_queued',
    'info',
    'A failed integration sync was queued for retry.',
    jsonb_build_object(
      'source_sync_job_id', source_row.id,
      'retry_sync_job_id', retry_row.id,
      'provider', connection_row.provider,
      'direction', retry_row.direction,
      'resource_type', retry_row.resource_type,
      'attempt', retry_row.attempts,
      'max_attempts', retry_row.max_attempts
    )
  );
  perform private.complete_operation_request(p_request_id);
  return retry_row;
end
$$;

create function public.complete_report_export(
  p_export_id uuid,
  p_status public.job_status,
  p_row_count integer,
  p_result_summary jsonb,
  p_error_message text default null
)
returns public.export_jobs
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  export_row public.export_jobs%rowtype;
  run_row public.report_runs%rowtype;
  clean_summary jsonb := coalesce(p_result_summary, '{}'::jsonb);
  clean_error text := nullif(btrim(p_error_message), '');
  completed_stamp timestamptz;
begin
  if auth.role() <> 'service_role' then
    raise exception 'Report completion is restricted to the service worker'
      using errcode = '42501';
  end if;
  if p_status not in ('succeeded', 'failed')
    or p_row_count is null or p_row_count < 0
    or jsonb_typeof(clean_summary) <> 'object'
    or pg_column_size(clean_summary) > 65536
    or length(coalesce(clean_error, '')) > 10000
    or (p_status = 'succeeded' and clean_error is not null)
    or (p_status = 'failed' and clean_error is null) then
    raise exception 'Invalid report completion payload' using errcode = '22023';
  end if;
  select * into export_row
  from public.export_jobs export_candidate
  where export_candidate.id = p_export_id
  for update;
  if export_row.id is null then
    raise exception 'Report export job not found' using errcode = 'P0002';
  end if;
  select * into run_row
  from public.report_runs report_run
  where report_run.organization_id = export_row.organization_id
    and report_run.id = export_row.report_run_id
  for update;
  if run_row.id is null then
    raise exception 'Report run not found' using errcode = 'P0002';
  end if;

  if export_row.status in ('succeeded', 'partially_succeeded', 'failed', 'cancelled')
    or run_row.status in ('succeeded', 'partially_succeeded', 'failed', 'cancelled') then
    if export_row.status = p_status
      and run_row.status = p_status
      and run_row.row_count = p_row_count
      and run_row.result_summary = clean_summary
      and run_row.error_message is not distinct from clean_error
      and export_row.error_message is not distinct from clean_error
      and export_row.completed_at is not null
      and run_row.completed_at is not null then
      return export_row;
    end if;
    raise exception 'Terminal report completion evidence does not match this replay'
      using errcode = '23505';
  end if;
  if export_row.status not in ('queued', 'running')
    or run_row.status not in ('queued', 'running') then
    raise exception 'Report export is not in a completable state'
      using errcode = '23514';
  end if;
  if export_row.storage_path is not null and not exists (
    select 1
    from storage.objects object
    where object.bucket_id = 'reports'
      and object.name = export_row.storage_path
  ) then
    raise exception 'Report export storage evidence is missing'
      using errcode = '23514';
  end if;

  completed_stamp := clock_timestamp();
  update public.report_runs report_run
  set status = p_status,
      row_count = p_row_count,
      result_summary = clean_summary,
      error_message = clean_error,
      started_at = coalesce(report_run.started_at, completed_stamp),
      completed_at = completed_stamp
  where report_run.id = run_row.id
  returning * into run_row;
  update public.export_jobs export_update
  set status = p_status,
      error_message = clean_error,
      started_at = coalesce(export_update.started_at, completed_stamp),
      completed_at = completed_stamp
  where export_update.id = export_row.id
  returning * into export_row;
  return export_row;
end
$$;

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
      or (
        p_bucket_id = 'imports'
        and exists (
          select 1
          from public.import_jobs import_job
          where import_job.storage_path = p_name
            and import_job.organization_id = public.storage_organization_id(p_name)
        )
      )
      or (
        p_bucket_id = 'reports'
        and (
          exists (
            select 1
            from public.export_jobs export_job
            where export_job.storage_path = p_name
              and export_job.organization_id = public.storage_organization_id(p_name)
              and export_job.status in (
                'succeeded', 'partially_succeeded', 'failed', 'cancelled'
              )
          )
          or exists (
            select 1
            from public.payroll_exports payroll_export
            where payroll_export.storage_path = p_name
              and payroll_export.organization_id = public.storage_organization_id(p_name)
          )
        )
      )
    )
$$;

-- Browser sessions can read their authorized integration records, but every
-- connection, queue, row, worker transition, and event mutation is trusted
-- server work.  Manual queueing and retrying use the bounded commands above.
revoke insert, update, delete on public.integration_connections from authenticated;
revoke insert, update, delete on public.integration_sync_jobs from authenticated;
revoke insert, update, delete on public.integration_sync_records from authenticated;
revoke insert, update, delete on public.import_jobs from authenticated;
revoke insert, update, delete on public.import_rows from authenticated;
revoke insert, update, delete on public.integration_events from authenticated;

revoke insert, delete on public.notifications from authenticated;
revoke update on public.notifications from authenticated;
grant update (read_at) on public.notifications to authenticated;

revoke all on function public.manual_import_headers_are_valid(text[]) from public;
revoke all on function public.guard_notification_evidence() from public, anon, authenticated;
revoke all on function private.emit_derived_notification(uuid, uuid, text, text, text, text, text, text, uuid)
from public, anon, authenticated;
revoke all on function private.notify_schedule_publication() from public, anon, authenticated;
revoke all on function private.notify_shift_assignment() from public, anon, authenticated;
revoke all on function private.notify_shift_swap_decision() from public, anon, authenticated;
revoke all on function private.notify_time_correction_decision() from public, anon, authenticated;
revoke all on function private.notify_task_assignment() from public, anon, authenticated;
revoke all on function public.guard_integration_job_evidence() from public, anon, authenticated;
revoke all on function public.create_manual_csv_import(uuid, uuid, text, text, text, text, integer, text[], jsonb)
from public;
revoke all on function public.retry_integration_sync_job(uuid, uuid) from public;
revoke all on function public.complete_report_export(uuid, public.job_status, integer, jsonb, text)
from public, anon, authenticated;

grant execute on function public.create_manual_csv_import(uuid, uuid, text, text, text, text, integer, text[], jsonb)
to authenticated;
grant execute on function public.retry_integration_sync_job(uuid, uuid) to authenticated;
grant execute on function public.complete_report_export(uuid, public.job_status, integer, jsonb, text)
to service_role;

comment on function public.create_manual_csv_import(uuid, uuid, text, text, text, text, integer, text[], jsonb)
is 'Idempotently queues an actor-owned 5 MB text/csv object after Admin/Owner assurance, exact tenant path, hash, header, and mapping declaration checks.';
comment on function public.retry_integration_sync_job(uuid, uuid)
is 'Idempotently creates the next bounded queued attempt from an authoritative failed integration sync job.';
comment on function public.complete_report_export(uuid, public.job_status, integer, jsonb, text)
is 'Service-only exact-idempotent completion of a report run and export job; inline exports may retain a null storage path.';
