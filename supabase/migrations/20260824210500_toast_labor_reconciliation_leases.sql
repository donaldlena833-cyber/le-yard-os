-- Fence Toast Labor workers and retain an unresolved-row cursor. A partially
-- successful run must replay from the earliest failed source version.

alter table public.integration_sync_jobs
  add column if not exists lease_token uuid,
  add column if not exists cursor_high_water timestamptz,
  add column if not exists unresolved_records integer not null default 0
    check (unresolved_records >= 0);

alter table public.integration_sync_records
  add column if not exists source_modified_at timestamptz;

create function public.service_fence_integration_sync_job(
  p_job_id uuid,
  p_lease_seconds integer default 900
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare job public.integration_sync_jobs%rowtype; token uuid := gen_random_uuid();
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update public.integration_sync_jobs candidate
  set lease_token = token,
      lease_expires_at = clock_timestamp() + make_interval(
        secs => greatest(60, least(coalesce(p_lease_seconds, 900), 3600))
      ),
      updated_at = clock_timestamp()
  where candidate.id = p_job_id
    and candidate.status = 'running'
    and candidate.lease_expires_at > clock_timestamp()
  returning * into job;
  if not found then
    raise exception 'Integration worker lease is unavailable' using errcode = 'P0002';
  end if;
  return jsonb_build_object('jobId', job.id, 'leaseToken', token,
    'leaseExpiresAt', job.lease_expires_at, 'cursor', job.cursor);
end
$$;

create function public.service_renew_integration_sync_job_lease(
  p_job_id uuid,
  p_lease_token uuid,
  p_lease_seconds integer default 900
)
returns timestamptz
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare renewed_at timestamptz;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  update public.integration_sync_jobs candidate
  set lease_expires_at = clock_timestamp() + make_interval(
        secs => greatest(60, least(coalesce(p_lease_seconds, 900), 3600))
      ),
      updated_at = clock_timestamp()
  where candidate.id = p_job_id
    and candidate.status = 'running'
    and candidate.lease_token = p_lease_token
    and candidate.lease_expires_at > clock_timestamp()
  returning candidate.lease_expires_at into renewed_at;
  if not found then
    raise exception 'Integration worker lease was lost' using errcode = 'P0002';
  end if;
  return renewed_at;
end
$$;

create function public.service_complete_integration_sync_job(
  p_job_id uuid,
  p_lease_token uuid,
  p_status text,
  p_proposed_cursor timestamptz,
  p_records_processed integer,
  p_error_message text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  job public.integration_sync_jobs%rowtype;
  unresolved integer;
  earliest_unresolved timestamptz;
  safe_cursor timestamptz;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  if p_status not in ('succeeded','partially_succeeded','failed')
    or coalesce(p_records_processed, -1) < 0 then
    raise exception 'Invalid integration completion' using errcode = '22023';
  end if;
  select * into job from public.integration_sync_jobs candidate
  where candidate.id = p_job_id
    and candidate.status = 'running'
    and candidate.lease_token = p_lease_token
    and candidate.lease_expires_at > clock_timestamp()
  for update;
  if not found then
    raise exception 'Integration worker lease was lost' using errcode = 'P0002';
  end if;
  select count(*)::integer, min(record.source_modified_at)
  into unresolved, earliest_unresolved
  from public.integration_sync_records record
  where record.sync_job_id = job.id and record.status = 'failed';
  safe_cursor := case
    when earliest_unresolved is not null then earliest_unresolved - interval '5 minutes'
    when p_status = 'failed' then nullif(job.cursor, '')::timestamptz
    else p_proposed_cursor
  end;
  update public.integration_sync_jobs candidate
  set status = p_status::public.job_status,
      cursor = safe_cursor::text,
      cursor_high_water = p_proposed_cursor,
      unresolved_records = unresolved,
      records_processed = p_records_processed,
      error_message = left(nullif(btrim(p_error_message), ''), 1000),
      completed_at = clock_timestamp(),
      lease_expires_at = null,
      lease_token = null,
      updated_at = clock_timestamp()
  where candidate.id = job.id;
  return jsonb_build_object('jobId', job.id, 'status', p_status,
    'cursor', safe_cursor, 'cursorHighWater', p_proposed_cursor,
    'unresolvedRecords', unresolved);
end
$$;

revoke all on function public.service_fence_integration_sync_job(uuid, integer)
from public, anon, authenticated;
revoke all on function public.service_renew_integration_sync_job_lease(uuid, uuid, integer)
from public, anon, authenticated;
revoke all on function public.service_complete_integration_sync_job(
  uuid, uuid, text, timestamptz, integer, text
) from public, anon, authenticated;
grant execute on function public.service_fence_integration_sync_job(uuid, integer)
to service_role;
grant execute on function public.service_renew_integration_sync_job_lease(uuid, uuid, integer)
to service_role;
grant execute on function public.service_complete_integration_sync_job(
  uuid, uuid, text, timestamptz, integer, text
) to service_role;
