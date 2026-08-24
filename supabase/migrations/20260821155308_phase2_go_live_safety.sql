-- Le Yard OS Phase 2 go-live safety foundation.
--
-- 1. Report kinds are authorized by exact operational/financial capability at
--    RPC, RLS, and direct table-read boundaries.
-- 2. Integration workers atomically claim queued retries and recover expired
--    worker leases instead of deadlocking behind the queued record.

create or replace function public.required_report_capability(p_report_type text)
returns text
language sql
immutable
set search_path = ''
as $$
  select case p_report_type
    when 'tips' then 'reports.financial.view'
    when 'payroll' then 'reports.financial.view'
    when 'sales_labor' then 'reports.financial.view'
    when 'receipts' then 'reports.financial.view'
    when 'expenses' then 'reports.financial.view'
    when 'cogs' then 'reports.financial.view'
    when 'labor' then 'reports.operational.view'
    when 'attendance' then 'reports.operational.view'
    when 'overtime' then 'reports.operational.view'
    when 'inventory_variance' then 'reports.operational.view'
    when 'waste' then 'reports.operational.view'
    when 'vendor_pricing' then 'reports.operational.view'
    when 'shift_performance' then 'reports.operational.view'
    when 'guest_activity' then 'reports.operational.view'
    else null
  end
$$;

create or replace function public.can_access_report_kind(
  p_organization_id uuid,
  p_location_id uuid,
  p_report_type text
)
returns boolean
language plpgsql
stable
security definer
set search_path = ''
set row_security = off
as $$
declare
  capability_key text := public.required_report_capability(p_report_type);
begin
  if auth.uid() is null or capability_key is null then return false; end if;

  if p_location_id is null then
    return public.has_org_role(
      p_organization_id,
      array['owner'::public.app_role, 'admin'::public.app_role]
    ) and public.has_any_location_capability(
      p_organization_id,
      array[capability_key],
      current_date
    );
  end if;

  return public.has_capability(
    p_organization_id,
    p_location_id,
    capability_key,
    current_date
  );
end
$$;

revoke all on function public.required_report_capability(text) from public, anon, authenticated;
revoke all on function public.can_access_report_kind(uuid, uuid, text) from public, anon;
grant execute on function public.can_access_report_kind(uuid, uuid, text) to authenticated;

drop policy if exists saved_report_scoped_read on public.saved_reports;
drop policy if exists saved_report_scoped_insert on public.saved_reports;
drop policy if exists saved_report_scoped_update on public.saved_reports;
drop policy if exists saved_report_scoped_delete on public.saved_reports;
drop policy if exists report_run_scoped_read on public.report_runs;
drop policy if exists export_job_scoped_read on public.export_jobs;

create policy saved_report_kind_scoped_read
on public.saved_reports for select to authenticated
using (public.can_access_report_kind(organization_id, location_id, report_type));

create policy saved_report_kind_scoped_insert
on public.saved_reports for insert to authenticated
with check (
  created_by = (select auth.uid())
  and public.can_access_report_kind(organization_id, location_id, report_type)
  and public.report_filters_are_scope_safe(filters)
);

create policy saved_report_kind_scoped_update
on public.saved_reports for update to authenticated
using (public.can_access_report_kind(organization_id, location_id, report_type))
with check (
  public.can_access_report_kind(organization_id, location_id, report_type)
  and public.report_filters_are_scope_safe(filters)
);

create policy saved_report_kind_scoped_delete
on public.saved_reports for delete to authenticated
using (public.can_access_report_kind(organization_id, location_id, report_type));

create policy report_run_kind_scoped_read
on public.report_runs for select to authenticated
using (public.can_access_report_kind(organization_id, location_id, report_type));

create policy export_job_kind_scoped_read
on public.export_jobs for select to authenticated
using (
  exists (
    select 1
    from public.report_runs run
    where run.id = export_jobs.report_run_id
      and run.organization_id = export_jobs.organization_id
      and run.location_id is not distinct from export_jobs.location_id
      and public.can_access_report_kind(
        run.organization_id,
        run.location_id,
        run.report_type
      )
  )
);

create or replace function public.guard_report_kind_authorization()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := new.requested_by;
  capability_key text := public.required_report_capability(new.report_type);
  authorized boolean := false;
begin
  if actor_id is not null and capability_key is not null then
    if new.location_id is null then
      select exists (
        select 1
        from public.organization_memberships membership
        where membership.organization_id = new.organization_id
          and membership.user_id = actor_id
          and membership.status = 'active'
          and membership.role in ('owner', 'admin')
      ) and exists (
        select 1
        from public.locations location
        where location.organization_id = new.organization_id
          and location.is_active
          and private.user_has_capability(
            actor_id,
            new.organization_id,
            location.id,
            capability_key,
            current_date
          )
      ) into authorized;
    else
      authorized := private.user_has_capability(
        actor_id,
        new.organization_id,
        new.location_id,
        capability_key,
        current_date
      );
    end if;
  end if;

  if actor_id is null or not authorized then
    raise exception 'The requested report kind is not authorized'
      using errcode = '42501',
            detail = 'report_kind_forbidden';
  end if;
  return new;
end
$$;

drop trigger if exists report_run_kind_authorization on public.report_runs;
create trigger report_run_kind_authorization
before insert on public.report_runs
for each row execute function public.guard_report_kind_authorization();

revoke all on function public.guard_report_kind_authorization() from public, anon, authenticated;

alter table public.integration_sync_jobs
add column if not exists lease_expires_at timestamptz;

create index if not exists integration_sync_jobs_claimable_idx
on public.integration_sync_jobs (
  organization_id,
  connection_id,
  resource_type,
  status,
  next_attempt_at,
  created_at
)
where status in ('queued', 'running');

create or replace function public.service_claim_integration_sync_job(
  p_organization_id uuid,
  p_connection_id uuid,
  p_resource_type text,
  p_requested_by uuid,
  p_direction text default 'import',
  p_cursor text default null,
  p_lease_seconds integer default 900
)
returns public.integration_sync_jobs
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  claimed public.integration_sync_jobs%rowtype;
  expired public.integration_sync_jobs%rowtype;
  lease_seconds integer := greatest(60, least(coalesce(p_lease_seconds, 900), 3600));
begin
  if p_organization_id is null
    or p_connection_id is null
    or p_requested_by is null
    or nullif(btrim(p_resource_type), '') is null
    or p_direction not in ('import', 'export') then
    raise exception 'Invalid integration worker claim scope' using errcode = '22023';
  end if;

  if not exists (
    select 1
    from public.integration_connections connection
    where connection.id = p_connection_id
      and connection.organization_id = p_organization_id
      and connection.status <> 'disabled'
  ) then
    raise exception 'Integration connection is unavailable' using errcode = 'P0002';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(
      'integration-worker:' || p_connection_id::text || ':' || p_resource_type,
      0
    )
  );

  select * into expired
  from public.integration_sync_jobs job
  where job.organization_id = p_organization_id
    and job.connection_id = p_connection_id
    and job.resource_type = p_resource_type
    and job.status = 'running'
    and job.lease_expires_at is not null
    and job.lease_expires_at <= clock_timestamp()
  order by job.started_at nulls first, job.created_at
  limit 1
  for update;

  if expired.id is not null then
    update public.integration_sync_jobs job
    set status = 'failed',
        error_message = 'Worker lease expired before completion.',
        completed_at = clock_timestamp(),
        lease_expires_at = null,
        updated_at = clock_timestamp()
    where job.id = expired.id;
    if expired.attempts >= expired.max_attempts then return null; end if;
  end if;

  if exists (
    select 1
    from public.integration_sync_jobs job
    where job.organization_id = p_organization_id
      and job.connection_id = p_connection_id
      and job.resource_type = p_resource_type
      and job.status = 'running'
  ) then
    return null;
  end if;

  select * into claimed
  from public.integration_sync_jobs job
  where job.organization_id = p_organization_id
    and job.connection_id = p_connection_id
    and job.resource_type = p_resource_type
    and job.status = 'queued'
    and coalesce(job.next_attempt_at, '-infinity'::timestamptz) <= clock_timestamp()
  order by job.next_attempt_at nulls first, job.created_at
  limit 1
  for update skip locked;

  if claimed.id is not null then
    update public.integration_sync_jobs job
    set status = 'running',
        started_at = clock_timestamp(),
        completed_at = null,
        lease_expires_at = clock_timestamp() + make_interval(secs => lease_seconds),
        updated_at = clock_timestamp()
    where job.id = claimed.id
    returning * into claimed;
    return claimed;
  end if;

  insert into public.integration_sync_jobs (
    organization_id,
    connection_id,
    direction,
    resource_type,
    status,
    cursor,
    attempts,
    max_attempts,
    requested_by,
    retry_of_id,
    started_at,
    lease_expires_at
  ) values (
    p_organization_id,
    p_connection_id,
    p_direction,
    p_resource_type,
    'running',
    p_cursor,
    coalesce(expired.attempts, 0) + 1,
    coalesce(expired.max_attempts, 5),
    p_requested_by,
    expired.id,
    clock_timestamp(),
    clock_timestamp() + make_interval(secs => lease_seconds)
  )
  returning * into claimed;

  return claimed;
end
$$;

revoke all on function public.service_claim_integration_sync_job(
  uuid, uuid, text, uuid, text, text, integer
) from public, anon, authenticated;
grant execute on function public.service_claim_integration_sync_job(
  uuid, uuid, text, uuid, text, text, integer
) to service_role;

comment on function public.service_claim_integration_sync_job(
  uuid, uuid, text, uuid, text, text, integer
) is 'Atomically claims the earliest due queued integration retry, rejects concurrent live workers, and forward-recovers an expired worker lease.';

-- Consequential floor resets preserve evidence and cannot silently disable a
-- location that still has a guest or table commitment.
create table private.reservation_configuration_snapshots (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  actor_id uuid not null references auth.users(id) on delete restrict,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  created_at timestamptz not null default clock_timestamp(),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade
);

revoke all on table private.reservation_configuration_snapshots
from public, anon, authenticated, service_role;

alter function public.install_le_yard_reservation_draft(uuid, uuid)
rename to install_le_yard_reservation_draft_legacy_unsafe;

revoke all on function public.install_le_yard_reservation_draft_legacy_unsafe(uuid, uuid)
from public, anon, authenticated, service_role;

create function public.install_le_yard_reservation_draft(
  p_request_id uuid,
  p_location_id uuid
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  organization_uuid uuid;
  replayed boolean := false;
  snapshot_document jsonb;
  result jsonb;
begin
  select location.organization_id into organization_uuid
  from public.locations location
  where location.id = p_location_id and location.is_active;

  if actor_id is null or p_request_id is null or organization_uuid is null then
    raise exception 'A valid reservation draft request is required'
      using errcode = '22023';
  end if;
  if not public.has_capability(
    organization_uuid, p_location_id, 'reservations.configure'
  ) then
    raise exception 'Reservation configuration access is required'
      using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('reservation-draft-reset:' || p_location_id::text, 0)
  );

  select exists (
    select 1
    from private.operation_requests request
    where request.request_id = p_request_id
      and request.operation_kind = 'reservation.install_le_yard_draft'
      and request.organization_id = organization_uuid
      and request.location_id = p_location_id
      and request.actor_id = actor_id
      and request.completed_at is not null
  ) into replayed;

  if not replayed and (
    exists (
      select 1 from public.reservations reservation
      where reservation.organization_id = organization_uuid
        and reservation.location_id = p_location_id
        and reservation.reserved_at >= clock_timestamp()
        and reservation.status not in ('cancelled', 'no_show', 'completed')
    )
    or exists (
      select 1 from private.public_booking_holds hold
      where hold.organization_id = organization_uuid
        and hold.location_id = p_location_id
        and hold.status = 'pending'
        and hold.reserved_at >= clock_timestamp()
        and hold.expires_at > clock_timestamp()
    )
    or exists (
      select 1 from public.reservation_table_allocations allocation
      where allocation.organization_id = organization_uuid
        and allocation.location_id = p_location_id
        and allocation.is_active
        and allocation.ends_at > clock_timestamp()
    )
  ) then
    raise exception 'The reservation draft cannot be reset while future guest commitments or table allocations exist'
      using errcode = '23514', detail = 'reservation_future_commitments';
  end if;

  if not replayed then
    select jsonb_build_object(
      'version', 1,
      'capturedAt', clock_timestamp(),
      'settings', (
        select to_jsonb(setting) from public.reservation_settings setting
        where setting.organization_id = organization_uuid
          and setting.location_id = p_location_id
      ),
      'areas', coalesce((
        select jsonb_agg(to_jsonb(area) order by area.sort_order, area.id)
        from public.dining_areas area
        where area.organization_id = organization_uuid
          and area.location_id = p_location_id
      ), '[]'::jsonb),
      'servicePeriods', coalesce((
        select jsonb_agg(to_jsonb(period) order by period.name, period.id)
        from public.reservation_service_periods period
        where period.organization_id = organization_uuid
          and period.location_id = p_location_id
      ), '[]'::jsonb),
      'turnRules', coalesce((
        select jsonb_agg(to_jsonb(rule) order by rule.service_period_id, rule.min_party_size, rule.id)
        from public.reservation_turn_rules rule
        join public.reservation_service_periods period on period.id = rule.service_period_id
        where period.organization_id = organization_uuid
          and period.location_id = p_location_id
      ), '[]'::jsonb),
      'tables', coalesce((
        select jsonb_agg(to_jsonb(table_row) order by table_row.label, table_row.id)
        from public.reservation_tables table_row
        where table_row.organization_id = organization_uuid
          and table_row.location_id = p_location_id
      ), '[]'::jsonb),
      'combinations', coalesce((
        select jsonb_agg(to_jsonb(combination) order by combination.label, combination.id)
        from public.reservation_table_combinations combination
        where combination.organization_id = organization_uuid
          and combination.location_id = p_location_id
      ), '[]'::jsonb),
      'combinationMembers', coalesce((
        select jsonb_agg(to_jsonb(member) order by member.combination_id, member.sort_order, member.table_id)
        from public.reservation_table_combination_members member
        join public.reservation_table_combinations combination
          on combination.id = member.combination_id
        where combination.organization_id = organization_uuid
          and combination.location_id = p_location_id
      ), '[]'::jsonb)
    ) into snapshot_document;

    insert into private.reservation_configuration_snapshots (
      id, organization_id, location_id, actor_id, snapshot
    ) values (
      p_request_id, organization_uuid, p_location_id, actor_id, snapshot_document
    );
  end if;

  result := public.install_le_yard_reservation_draft_legacy_unsafe(
    p_request_id, p_location_id
  );

  if not replayed then
    insert into public.audit_events (
      organization_id, location_id, actor_id, action, table_name,
      record_id, new_record, request_id
    ) values (
      organization_uuid, p_location_id, actor_id,
      'reservation_configuration_reset',
      'reservation_configuration_snapshots', p_request_id::text,
      jsonb_build_object(
        'snapshotId', p_request_id,
        'publicBookingEnabled', false,
        'guestMessagingEnabled', false,
        'staffPushEnabled', false
      ),
      p_request_id::text
    );
  end if;

  return result || jsonb_build_object('snapshotId', p_request_id);
end
$$;

revoke all on function public.install_le_yard_reservation_draft(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.install_le_yard_reservation_draft(uuid, uuid)
to authenticated;

-- The base row contains management-only notes. Expose a deliberately projected
-- view so published staff briefs remain readable without leaking that field.
create view public.preshifts_safe
with (security_barrier = true)
as
select
  preshift.id,
  preshift.organization_id,
  preshift.location_id,
  preshift.business_date,
  preshift.service_period,
  preshift.version_number,
  preshift.status,
  preshift.booked_covers,
  preshift.projected_covers,
  preshift.vip_notes,
  preshift.allergy_notes,
  preshift.large_party_notes,
  preshift.specials,
  preshift.staffing_notes,
  preshift.station_assignments,
  preshift.previous_handoff,
  preshift.service_goal,
  preshift.training_point,
  case
    when public.has_capability(
      preshift.organization_id,
      preshift.location_id,
      'preshift.manage'
    ) then preshift.manager_notes
    else null
  end as manager_notes,
  preshift.created_by,
  preshift.published_by,
  preshift.published_at,
  preshift.created_at,
  preshift.updated_at
from public.preshifts preshift
where (
  preshift.status in ('published', 'archived')
  and public.can_access_location(
    preshift.organization_id,
    preshift.location_id
  )
) or public.has_capability(
  preshift.organization_id,
  preshift.location_id,
  'preshift.manage'
);

revoke all on table public.preshifts from authenticated;
revoke all on table public.preshifts_safe from public, anon, authenticated;
grant select on table public.preshifts_safe to authenticated;

-- Purchase orders are submitted for independent review, then become receivable.
-- Applying this to every PO is intentionally stricter than a dollar threshold.
alter table public.purchase_orders
drop constraint purchase_orders_status_check;

alter table public.purchase_orders
add constraint purchase_orders_status_check check (
  status in (
    'draft', 'submitted', 'approved', 'partially_received', 'received', 'cancelled'
  )
);

create function public.review_purchase_order(
  p_request_id uuid,
  p_purchase_order_id uuid,
  p_approve boolean,
  p_note text
)
returns public.purchase_orders
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  order_row public.purchase_orders%rowtype;
  claimed boolean;
  clean_note text := nullif(btrim(p_note), '');
begin
  if actor_id is null or p_request_id is null or p_purchase_order_id is null
    or p_approve is null or length(coalesce(clean_note, '')) > 2000 then
    raise exception 'A valid purchase-order review is required'
      using errcode = '22023';
  end if;

  select * into order_row
  from public.purchase_orders purchase_order
  where purchase_order.id = p_purchase_order_id
  for update;

  if order_row.id is null then
    raise exception 'Purchase order not found' using errcode = 'P0002';
  end if;
  if not public.has_capability(
    order_row.organization_id,
    order_row.location_id,
    'inventory.purchase.approve'
  ) then
    raise exception 'Purchase-order approval is not assigned at this location'
      using errcode = '42501';
  end if;
  if order_row.created_by = actor_id then
    raise exception 'A purchase-order creator cannot approve or reject their own order'
      using errcode = '23514', detail = 'independent_review_required';
  end if;

  claimed := private.claim_operation_request(
    p_request_id,
    'inventory.purchase_order_review',
    order_row.organization_id,
    order_row.location_id,
    order_row.id,
    jsonb_build_object(
      'purchaseOrderId', order_row.id,
      'approve', p_approve,
      'note', clean_note
    )
  );
  if not claimed then
    return order_row;
  end if;
  if order_row.status <> 'submitted' then
    raise exception 'Only a submitted purchase order can be reviewed'
      using errcode = '23514';
  end if;

  update public.purchase_orders purchase_order
  set status = case when p_approve then 'approved' else 'cancelled' end,
      approved_by = case when p_approve then actor_id else null end,
      approved_at = case when p_approve then clock_timestamp() else null end,
      updated_at = clock_timestamp()
  where purchase_order.id = order_row.id
  returning * into order_row;

  insert into public.audit_events (
    organization_id, location_id, actor_id, action, table_name,
    record_id, old_record, new_record, request_id
  ) values (
    order_row.organization_id,
    order_row.location_id,
    actor_id,
    case when p_approve then 'purchase_order_approved' else 'purchase_order_rejected' end,
    'purchase_orders',
    order_row.id::text,
    jsonb_build_object('status', 'submitted'),
    jsonb_build_object(
      'status', order_row.status,
      'reviewNote', clean_note,
      'reviewedBy', actor_id
    ),
    p_request_id::text
  );

  perform private.complete_operation_request(p_request_id);
  return order_row;
end
$$;

revoke all on function public.review_purchase_order(uuid, uuid, boolean, text)
from public, anon, authenticated, service_role;
grant execute on function public.review_purchase_order(uuid, uuid, boolean, text)
to authenticated;

create function private.assert_purchase_order_approved_for_delivery()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  order_status text;
begin
  if new.purchase_order_id is null then return new; end if;
  select purchase_order.status into order_status
  from public.purchase_orders purchase_order
  where purchase_order.organization_id = new.organization_id
    and purchase_order.id = new.purchase_order_id;
  if order_status not in ('approved', 'partially_received') then
    raise exception 'The selected purchase order requires independent approval before receiving'
      using errcode = '23514', detail = 'purchase_order_not_approved';
  end if;
  return new;
end
$$;

create trigger delivery_purchase_order_approval_guard
before insert on public.deliveries
for each row execute function private.assert_purchase_order_approved_for_delivery();

revoke all on function private.assert_purchase_order_approved_for_delivery()
from public, anon, authenticated, service_role;

-- PostgreSQL trigger records are table-shaped. Keep table-specific field access
-- in separate branches so sync-job updates never attempt to resolve import-only
-- row-count columns.
create or replace function public.guard_integration_job_evidence()
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
    if old.status in ('succeeded', 'partially_succeeded', 'failed', 'cancelled') then
      raise exception 'Terminal integration jobs are immutable'
        using errcode = '42501';
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
    if new.status = 'running'
      and (new.started_at is null or new.completed_at is not null) then
      raise exception 'Running integration jobs require a start stamp and no completion stamp'
        using errcode = '23514';
    end if;
    if new.status in ('succeeded', 'partially_succeeded', 'failed', 'cancelled')
      and new.completed_at is null then
      raise exception 'Terminal integration jobs require a completion stamp'
        using errcode = '23514';
    end if;
    return new;
  end if;

  if tg_table_name = 'import_jobs' then
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
    if old.status in ('succeeded', 'partially_succeeded', 'failed', 'cancelled') then
      raise exception 'Terminal integration jobs are immutable'
        using errcode = '42501';
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
    if new.status = 'running'
      and (new.started_at is null or new.completed_at is not null) then
      raise exception 'Running integration jobs require a start stamp and no completion stamp'
        using errcode = '23514';
    end if;
    if new.status in ('succeeded', 'partially_succeeded', 'failed', 'cancelled')
      and new.completed_at is null then
      raise exception 'Terminal integration jobs require a completion stamp'
        using errcode = '23514';
    end if;
    if new.status in ('succeeded', 'partially_succeeded') and (
      new.total_rows is null
      or new.successful_rows + new.failed_rows <> new.total_rows
    ) then
      raise exception 'Completed imports require reconciled authoritative row counts'
        using errcode = '23514';
    end if;
    return new;
  end if;

  raise exception 'Unsupported integration evidence table'
    using errcode = '0A000';
end
$$;
