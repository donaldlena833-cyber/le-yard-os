-- Toast Labor is the authoritative punch system. These columns make imports
-- replay-safe while preserving the existing tenant and audit boundaries.

alter table public.time_entries
  add column integration_connection_id uuid,
  add column source_provider public.integration_provider,
  add column external_id text,
  add column external_modified_at timestamptz,
  add column source_payload_hash text,
  add column source_deleted_at timestamptz,
  add constraint time_entries_integration_connection_fkey
    foreign key (organization_id, integration_connection_id)
    references public.integration_connections(organization_id, id)
    on delete restrict,
  add constraint time_entries_provider_identity_check check (
    (integration_connection_id is null and source_provider is null and external_id is null)
    or
    (integration_connection_id is not null and source = 'import' and source_provider is not null and length(btrim(external_id)) > 0)
  ),
  add constraint time_entries_payload_hash_check check (
    source_payload_hash is null or source_payload_hash ~ '^[0-9a-f]{64}$'
  );

create unique index time_entries_provider_external_identity_idx
on public.time_entries(integration_connection_id, external_id)
where integration_connection_id is not null;

create index time_entries_provider_modified_idx
on public.time_entries(integration_connection_id, external_modified_at desc)
where integration_connection_id is not null;

alter table public.time_breaks
  add column integration_connection_id uuid,
  add column external_id text,
  add column source_deleted_at timestamptz,
  add constraint time_breaks_integration_connection_fkey
    foreign key (organization_id, integration_connection_id)
    references public.integration_connections(organization_id, id)
    on delete restrict,
  add constraint time_breaks_provider_identity_check check (
    (integration_connection_id is null and external_id is null)
    or
    (integration_connection_id is not null and source = 'import' and length(btrim(external_id)) > 0)
  );

create unique index time_breaks_provider_external_identity_idx
on public.time_breaks(integration_connection_id, external_id)
where integration_connection_id is not null;

create function public.get_pos_labor_sync_status(p_location_id uuid)
returns table (
  provider public.integration_provider,
  connection_status text,
  last_synced_at timestamptz,
  last_job_status public.job_status,
  last_job_completed_at timestamptz
)
language sql
stable
security definer
set search_path = ''
set row_security = off
as $$
  select
    connection.provider,
    connection.status,
    connection.last_synced_at,
    latest_job.status,
    latest_job.completed_at
  from public.locations location
  left join public.integration_connections connection
    on connection.organization_id = location.organization_id
   and connection.location_id = location.id
   and connection.provider = 'toast'
  left join lateral (
    select sync_job.status, sync_job.completed_at
    from public.integration_sync_jobs sync_job
    where sync_job.organization_id = connection.organization_id
      and sync_job.connection_id = connection.id
      and sync_job.resource_type = 'time_entries'
    order by sync_job.created_at desc
    limit 1
  ) latest_job on true
  where location.id = p_location_id
    and public.can_access_location(location.organization_id, location.id)
$$;

create function public.service_ingest_pos_time_entry(
  p_organization_id uuid,
  p_location_id uuid,
  p_connection_id uuid,
  p_external_id text,
  p_external_modified_at timestamptz,
  p_payload_hash text,
  p_employee_id uuid,
  p_job_role_id uuid,
  p_scheduled_shift_id uuid,
  p_clocked_in_at timestamptz,
  p_clocked_out_at timestamptz,
  p_auto_clocked_out boolean,
  p_source_deleted_at timestamptz,
  p_breaks jsonb default '[]'::jsonb
)
returns jsonb
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  existing_entry public.time_entries%rowtype;
  saved_entry public.time_entries%rowtype;
  break_item jsonb;
  break_external_id text;
  seen_break_ids text[] := array[]::text[];
  result_status text;
  effective_clock_out timestamptz;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception using errcode = '42501', message = 'service role required';
  end if;

  if nullif(btrim(p_external_id), '') is null
    or p_external_modified_at is null
    or p_clocked_in_at is null
    or p_payload_hash !~ '^[0-9a-f]{64}$'
    or jsonb_typeof(p_breaks) <> 'array'
  then
    raise exception using errcode = '22023', message = 'invalid POS time entry payload';
  end if;

  if not exists (
    select 1
    from public.integration_connections connection
    where connection.id = p_connection_id
      and connection.organization_id = p_organization_id
      and connection.location_id = p_location_id
      and connection.provider = 'toast'
      and connection.status <> 'disabled'
  ) then
    raise exception using errcode = '23503', message = 'Toast connection is unavailable';
  end if;

  if not exists (
    select 1
    from public.employees employee
    where employee.id = p_employee_id
      and employee.organization_id = p_organization_id
  ) or not exists (
    select 1
    from public.job_roles role
    where role.id = p_job_role_id
      and role.organization_id = p_organization_id
  ) or (
    p_scheduled_shift_id is not null
    and not exists (
      select 1
      from public.shifts shift_row
      where shift_row.id = p_scheduled_shift_id
        and shift_row.organization_id = p_organization_id
        and shift_row.location_id = p_location_id
    )
  ) then
    raise exception using errcode = '23503', message = 'local labor mapping is unavailable';
  end if;

  select entry.*
  into existing_entry
  from public.time_entries entry
  where entry.integration_connection_id = p_connection_id
    and entry.external_id = btrim(p_external_id)
  for update;

  if found and existing_entry.external_modified_at > p_external_modified_at then
    return jsonb_build_object(
      'status', 'unchanged',
      'id', existing_entry.id,
      'reason', 'stale_source_version'
    );
  end if;

  if found and existing_entry.external_modified_at = p_external_modified_at then
    if existing_entry.source_payload_hash = p_payload_hash then
      return jsonb_build_object(
        'status', 'unchanged',
        'id', existing_entry.id,
        'reason', 'replayed_source_version'
      );
    end if;
    raise exception using
      errcode = '40001',
      message = 'same POS version contains different facts';
  end if;

  if not found and p_source_deleted_at is not null then
    return jsonb_build_object(
      'status', 'unchanged',
      'id', null,
      'reason', 'deleted_source_record_not_materialized'
    );
  end if;

  effective_clock_out := p_clocked_out_at;
  if p_source_deleted_at is not null and effective_clock_out is null then
    effective_clock_out := greatest(
      p_clocked_in_at + interval '1 second',
      p_external_modified_at
    );
  end if;

  if effective_clock_out is not null and effective_clock_out <= p_clocked_in_at then
    raise exception using errcode = '22023', message = 'POS clock-out must follow clock-in';
  end if;

  if found then
    update public.time_entries entry
    set employee_id = p_employee_id,
        job_role_id = p_job_role_id,
        scheduled_shift_id = p_scheduled_shift_id,
        clocked_in_at = p_clocked_in_at,
        clocked_out_at = effective_clock_out,
        status = case
          when p_source_deleted_at is not null then 'rejected'::public.time_entry_status
          when effective_clock_out is null then 'open'::public.time_entry_status
          else 'submitted'::public.time_entry_status
        end,
        clock_in_metadata = jsonb_build_object('provider', 'toast'),
        clock_out_metadata = case
          when effective_clock_out is null then '{}'::jsonb
          else jsonb_build_object(
            'provider', 'toast',
            'autoClockedOut', coalesce(p_auto_clocked_out, false)
          )
        end,
        submitted_at = case when effective_clock_out is null then null else p_external_modified_at end,
        approved_by = null,
        approved_at = null,
        source_deleted_at = p_source_deleted_at,
        external_modified_at = p_external_modified_at,
        source_payload_hash = p_payload_hash,
        updated_at = now()
    where entry.id = existing_entry.id
    returning entry.* into saved_entry;
    result_status := 'updated';
  else
    insert into public.time_entries (
      organization_id,
      location_id,
      employee_id,
      job_role_id,
      scheduled_shift_id,
      clocked_in_at,
      clocked_out_at,
      status,
      source,
      clock_in_metadata,
      clock_out_metadata,
      submitted_at,
      integration_connection_id,
      source_provider,
      external_id,
      external_modified_at,
      source_payload_hash,
      source_deleted_at
    ) values (
      p_organization_id,
      p_location_id,
      p_employee_id,
      p_job_role_id,
      p_scheduled_shift_id,
      p_clocked_in_at,
      effective_clock_out,
      case
        when effective_clock_out is null then 'open'::public.time_entry_status
        else 'submitted'::public.time_entry_status
      end,
      'import',
      jsonb_build_object('provider', 'toast'),
      case
        when effective_clock_out is null then '{}'::jsonb
        else jsonb_build_object(
          'provider', 'toast',
          'autoClockedOut', coalesce(p_auto_clocked_out, false)
        )
      end,
      case when effective_clock_out is null then null else p_external_modified_at end,
      p_connection_id,
      'toast',
      btrim(p_external_id),
      p_external_modified_at,
      p_payload_hash,
      null
    )
    returning * into saved_entry;
    result_status := 'created';
  end if;

  for break_item in select value from jsonb_array_elements(p_breaks)
  loop
    break_external_id := nullif(btrim(break_item ->> 'externalId'), '');
    if break_external_id is null
      or nullif(break_item ->> 'startedAt', '') is null
      or (break_item ? 'endedAt' and nullif(break_item ->> 'endedAt', '') is not null
        and (break_item ->> 'endedAt')::timestamptz <= (break_item ->> 'startedAt')::timestamptz)
    then
      raise exception using errcode = '22023', message = 'invalid POS break payload';
    end if;

    seen_break_ids := array_append(seen_break_ids, break_external_id);
    insert into public.time_breaks (
      organization_id,
      time_entry_id,
      started_at,
      ended_at,
      is_paid,
      source,
      integration_connection_id,
      external_id,
      source_deleted_at
    ) values (
      p_organization_id,
      saved_entry.id,
      (break_item ->> 'startedAt')::timestamptz,
      nullif(break_item ->> 'endedAt', '')::timestamptz,
      coalesce((break_item ->> 'isPaid')::boolean, false),
      'import',
      p_connection_id,
      break_external_id,
      null
    )
    on conflict (integration_connection_id, external_id)
      where integration_connection_id is not null
    do update set
      time_entry_id = excluded.time_entry_id,
      started_at = excluded.started_at,
      ended_at = excluded.ended_at,
      is_paid = excluded.is_paid,
      source_deleted_at = null,
      updated_at = now();
  end loop;

  update public.time_breaks time_break
  set source_deleted_at = p_external_modified_at,
      updated_at = now()
  where time_break.integration_connection_id = p_connection_id
    and time_break.time_entry_id = saved_entry.id
    and not (time_break.external_id = any(seen_break_ids));

  return jsonb_build_object('status', result_status, 'id', saved_entry.id);
end;
$$;

revoke all on function public.service_ingest_pos_time_entry(
  uuid, uuid, uuid, text, timestamptz, text, uuid, uuid, uuid,
  timestamptz, timestamptz, boolean, timestamptz, jsonb
) from public, anon, authenticated;

grant execute on function public.service_ingest_pos_time_entry(
  uuid, uuid, uuid, text, timestamptz, text, uuid, uuid, uuid,
  timestamptz, timestamptz, boolean, timestamptz, jsonb
) to service_role;

-- The worker reads only the local mapping surface and writes durable sync
-- evidence. Imported punch mutation remains confined to the RPC above.
grant select on table
  public.locations,
  public.organization_memberships,
  public.employees,
  public.job_roles
to service_role;
grant select, insert, update on table
  public.integration_connections,
  public.integration_sync_jobs
to service_role;
grant select, insert on table public.integration_sync_records to service_role;

revoke all on function public.get_pos_labor_sync_status(uuid) from public, anon;
grant execute on function public.get_pos_labor_sync_status(uuid) to authenticated;

comment on function public.service_ingest_pos_time_entry(
  uuid, uuid, uuid, text, timestamptz, text, uuid, uuid, uuid,
  timestamptz, timestamptz, boolean, timestamptz, jsonb
) is 'Service-only replay-safe ingestion boundary for Toast Labor time entries and breaks.';
