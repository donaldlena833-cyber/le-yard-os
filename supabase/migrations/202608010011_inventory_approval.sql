-- Le Yard OS: authoritative inventory counts, independent review, and payroll
-- export/employee evidence hardening.

alter table public.inventory_count_lines
  alter column expected_quantity type numeric(18,6),
  alter column counted_quantity type numeric(18,6);

alter table public.inventory_counts
add column review_note text;

alter table public.inventory_counts
add constraint inventory_count_review_evidence_check
check (
  (
    status in ('pending', 'in_review')
    and approved_by is null
    and approved_at is null
  )
  or (
    status in ('approved', 'rejected')
    and approved_by is not null
    and approved_at is not null
  )
);

create table private.inventory_count_approval_requests (
  request_id uuid primary key,
  organization_id uuid not null,
  location_id uuid not null,
  inventory_count_id uuid not null,
  actor_id uuid not null,
  approve boolean not null,
  review_note text,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.inventory_count_approval_requests
from public, anon, authenticated;

create unique index inventory_count_adjustment_once_per_item
on public.inventory_transactions (
  organization_id,
  reference_id,
  inventory_item_id,
  unit_id,
  transaction_kind
)
where reference_type = 'inventory_count'
  and transaction_kind = 'count_adjustment';

-- A count payload supplies only observations. Expected on-hand, base unit, and
-- cost evidence are always captured from canonical database records.
create or replace function public.submit_inventory_count(
  p_submission_id uuid,
  p_location_id uuid,
  p_count_type text,
  p_notes text,
  p_lines jsonb
)
returns public.inventory_counts
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  result public.inventory_counts%rowtype;
  existing_lines jsonb;
  requested_lines jsonb;
  clean_notes text := nullif(btrim(p_notes), '');
  requested_count integer;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_count_type not in ('full', 'cycle', 'spot')
    or jsonb_typeof(p_lines) <> 'array'
    or jsonb_array_length(p_lines) not between 1 and 1000
    or (clean_notes is not null and length(clean_notes) > 4000) then
    raise exception 'Invalid inventory count payload' using errcode = '22023';
  end if;
  if exists (
    select 1
    from jsonb_array_elements(p_lines) line
    where jsonb_typeof(line) <> 'object'
      or not (line ?& array['inventory_item_id', 'unit_id', 'counted_quantity'])
      or (line ->> 'inventory_item_id') is null
      or (line ->> 'unit_id') is null
      or (line ->> 'counted_quantity') is null
      or (line ->> 'counted_quantity')::numeric < 0
      or length(coalesce(line ->> 'notes', '')) > 2000
  ) or (
    select count(*) <> count(distinct line ->> 'inventory_item_id')
    from jsonb_array_elements(p_lines) line
  ) then
    raise exception 'Invalid or duplicate inventory count lines' using errcode = '22023';
  end if;

  select * into location_row
  from public.locations location
  where location.id = p_location_id and location.is_active
  for update;
  if location_row.id is null
    or not public.can_manage_location(location_row.organization_id, location_row.id) then
    raise exception 'Not authorized to submit this inventory count'
      using errcode = '42501';
  end if;

  select count(*)::integer into requested_count
  from jsonb_array_elements(p_lines) line
  join public.inventory_items item
    on item.organization_id = location_row.organization_id
   and item.id = (line ->> 'inventory_item_id')::uuid
   and item.base_unit_id = (line ->> 'unit_id')::uuid
   and item.is_active
   and item.track_inventory;
  if requested_count <> jsonb_array_length(p_lines) then
    raise exception 'Every count line must use an active item base unit'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-count-submit:' || p_submission_id::text,
    0
  ));
  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-ledger:' || location_row.organization_id::text || ':'
      || location_row.id::text || ':' || item.id::text,
    0
  ))
  from public.inventory_items item
  where item.organization_id = location_row.organization_id
    and item.id in (
      select (line ->> 'inventory_item_id')::uuid
      from jsonb_array_elements(p_lines) line
    )
  order by item.id;
  perform 1
  from public.inventory_items item
  where item.organization_id = location_row.organization_id
    and item.id in (
      select (line ->> 'inventory_item_id')::uuid
      from jsonb_array_elements(p_lines) line
    )
  order by item.id
  for update;

  select jsonb_agg(
    jsonb_build_object(
      'inventory_item_id', item.id::text,
      'unit_id', item.base_unit_id::text,
      'counted_quantity', (line ->> 'counted_quantity')::numeric,
      'notes', nullif(btrim(line ->> 'notes'), '')
    ) order by item.id
  ) into requested_lines
  from jsonb_array_elements(p_lines) line
  join public.inventory_items item
    on item.organization_id = location_row.organization_id
   and item.id = (line ->> 'inventory_item_id')::uuid;

  select * into result
  from public.inventory_counts count_row
  where count_row.id = p_submission_id
  for update;
  if result.id is not null then
    select jsonb_agg(
      jsonb_build_object(
        'inventory_item_id', count_line.inventory_item_id::text,
        'unit_id', count_line.unit_id::text,
        'counted_quantity', count_line.counted_quantity,
        'notes', count_line.notes
      ) order by count_line.inventory_item_id
    ) into existing_lines
    from public.inventory_count_lines count_line
    where count_line.inventory_count_id = result.id;
    if result.organization_id = location_row.organization_id
      and result.location_id = location_row.id
      and result.count_type = p_count_type
      and result.counted_by = actor_id
      and result.notes is not distinct from clean_notes
      and existing_lines = requested_lines then
      return result;
    end if;
    raise exception 'Inventory submission id was reused' using errcode = '23505';
  end if;

  insert into public.inventory_counts (
    id, organization_id, location_id, counted_at,
    status, count_type, counted_by, notes
  ) values (
    p_submission_id, location_row.organization_id, location_row.id,
    clock_timestamp(), 'pending', p_count_type, actor_id, clean_notes
  ) returning * into result;

  insert into public.inventory_count_lines (
    organization_id,
    inventory_count_id,
    inventory_item_id,
    unit_id,
    expected_quantity,
    counted_quantity,
    unit_cost_cents,
    notes
  )
  select location_row.organization_id,
    result.id,
    item.id,
    item.base_unit_id,
    coalesce((
      select sum(transaction.quantity_delta)
      from public.inventory_transactions transaction
      where transaction.organization_id = location_row.organization_id
        and transaction.location_id = location_row.id
        and transaction.inventory_item_id = item.id
    ), 0)::numeric(18,6),
    (line ->> 'counted_quantity')::numeric(18,6),
    coalesce(
      (
        select transaction.unit_cost_cents
        from public.inventory_transactions transaction
        where transaction.organization_id = location_row.organization_id
          and transaction.location_id = location_row.id
          and transaction.inventory_item_id = item.id
          and transaction.unit_id = item.base_unit_id
          and transaction.unit_cost_cents is not null
        order by transaction.occurred_at desc, transaction.id desc
        limit 1
      ),
      (
        select price.unit_price_cents
        from public.item_price_history price
        where price.organization_id = location_row.organization_id
          and price.inventory_item_id = item.id
          and price.unit_id = item.base_unit_id
          and price.effective_at <= clock_timestamp()
        order by price.effective_at desc, price.id desc
        limit 1
      )
    ),
    nullif(btrim(line ->> 'notes'), '')
  from jsonb_array_elements(p_lines) line
  join public.inventory_items item
    on item.organization_id = location_row.organization_id
   and item.id = (line ->> 'inventory_item_id')::uuid;
  return result;
end
$$;

create function public.guard_inventory_transaction_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  trusted_actor boolean := auth.uid() is null
    or coalesce(auth.role(), '') = 'service_role';
  count_row public.inventory_counts%rowtype;
  item_row public.inventory_items%rowtype;
begin
  select * into item_row
  from public.inventory_items item
  where item.id = new.inventory_item_id;
  if item_row.id is null
    or item_row.organization_id <> new.organization_id
    or item_row.base_unit_id <> new.unit_id then
    raise exception 'Inventory ledger quantities must use the item base unit'
      using errcode = '23514';
  end if;
  if trusted_actor then return new; end if;
  if new.transaction_kind <> 'count_adjustment'
    or new.reference_type <> 'inventory_count'
    or new.reference_id is null then
    raise exception 'Inventory ledger rows must be created by an authorized workflow'
      using errcode = '42501';
  end if;
  select * into count_row
  from public.inventory_counts count_candidate
  where count_candidate.id = new.reference_id;
  if count_row.id is null
    or count_row.organization_id <> new.organization_id
    or count_row.location_id <> new.location_id
    or count_row.status <> 'pending'
    or count_row.counted_by <> new.created_by
    or new.approved_by is distinct from auth.uid()
    or new.approved_at is null
    or not exists (
      select 1
      from private.inventory_count_approval_requests request
      where request.inventory_count_id = count_row.id
        and request.actor_id = auth.uid()
        and request.approve
        and request.completed_at is null
    ) then
    raise exception 'Inventory count adjustment evidence is invalid'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger inventory_transaction_evidence_guard
before insert on public.inventory_transactions
for each row execute function public.guard_inventory_transaction_evidence();

create function public.approve_inventory_count(
  p_request_id uuid,
  p_count_id uuid,
  p_approve boolean,
  p_note text default null
)
returns public.inventory_counts
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  count_row public.inventory_counts%rowtype;
  prior private.inventory_count_approval_requests%rowtype;
  clean_note text := nullif(btrim(p_note), '');
  requested_status public.review_status := case
    when p_approve then 'approved'::public.review_status
    else 'rejected'::public.review_status
  end;
  decision_at timestamptz := clock_timestamp();
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_approve is null or (clean_note is not null and length(clean_note) > 2000) then
    raise exception 'A valid inventory count decision is required'
      using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-count-approval:' || p_request_id::text,
    0
  ));

  select * into prior
  from private.inventory_count_approval_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null and (
    prior.actor_id is distinct from actor_id
    or prior.inventory_count_id is distinct from p_count_id
    or prior.approve is distinct from p_approve
    or prior.review_note is distinct from clean_note
  ) then
    raise exception 'Inventory approval request id was reused' using errcode = '23505';
  end if;

  select * into count_row
  from public.inventory_counts count_candidate
  where count_candidate.id = p_count_id
  for update;
  if count_row.id is null then
    raise exception 'Inventory count not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(count_row.organization_id, count_row.location_id) then
    raise exception 'Not authorized to review this inventory count'
      using errcode = '42501';
  end if;
  if count_row.counted_by = actor_id then
    raise exception 'Inventory counts require a different authorized reviewer'
      using errcode = '42501';
  end if;

  if prior.request_id is not null then
    if count_row.status = requested_status
      and count_row.approved_by = actor_id
      and count_row.review_note is not distinct from clean_note then
      return count_row;
    end if;
    raise exception 'Inventory approval ledger has no matching result'
      using errcode = '40001';
  end if;
  if count_row.status <> 'pending' then
    raise exception 'Reviewed inventory counts are immutable' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.inventory_count_lines line
    where line.inventory_count_id = count_row.id
  ) or exists (
    select 1
    from public.inventory_count_lines line
    join public.inventory_items item
      on item.organization_id = line.organization_id
     and item.id = line.inventory_item_id
    where line.inventory_count_id = count_row.id
      and (
        line.organization_id <> count_row.organization_id
        or line.unit_id <> item.base_unit_id
        or line.expected_quantity is null
        or line.counted_quantity < 0
      )
  ) then
    raise exception 'Inventory count lines are incomplete or noncanonical'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'inventory-ledger:' || count_row.organization_id::text || ':'
      || count_row.location_id::text || ':' || line.inventory_item_id::text,
    0
  ))
  from public.inventory_count_lines line
  where line.inventory_count_id = count_row.id
  order by line.inventory_item_id;
  perform 1
  from public.inventory_count_lines line
  where line.inventory_count_id = count_row.id
  order by line.inventory_item_id
  for update;
  perform 1
  from public.inventory_items item
  where item.organization_id = count_row.organization_id
    and item.id in (
      select line.inventory_item_id
      from public.inventory_count_lines line
      where line.inventory_count_id = count_row.id
    )
  order by item.id
  for update;

  if exists (
    select 1
    from public.inventory_transactions transaction
    where transaction.organization_id = count_row.organization_id
      and transaction.reference_type = 'inventory_count'
      and transaction.reference_id = count_row.id
  ) then
    raise exception 'Inventory count already has ledger postings without matching approval evidence'
      using errcode = '40001';
  end if;

  insert into private.inventory_count_approval_requests (
    request_id, organization_id, location_id, inventory_count_id,
    actor_id, approve, review_note
  ) values (
    p_request_id, count_row.organization_id, count_row.location_id,
    count_row.id, actor_id, p_approve, clean_note
  );

  if p_approve then
    insert into public.inventory_transactions (
      organization_id,
      location_id,
      inventory_item_id,
      unit_id,
      transaction_kind,
      quantity_delta,
      unit_cost_cents,
      occurred_at,
      reference_type,
      reference_id,
      reason,
      created_by,
      approved_by,
      approved_at
    )
    select count_row.organization_id,
      count_row.location_id,
      line.inventory_item_id,
      line.unit_id,
      'count_adjustment',
      line.counted_quantity - line.expected_quantity,
      line.unit_cost_cents,
      decision_at,
      'inventory_count',
      count_row.id,
      'Approved inventory count adjustment',
      count_row.counted_by,
      actor_id,
      decision_at
    from public.inventory_count_lines line
    where line.inventory_count_id = count_row.id
      and line.counted_quantity <> line.expected_quantity;
  end if;

  update public.inventory_counts count_update
  set status = requested_status,
      approved_by = actor_id,
      approved_at = decision_at,
      review_note = clean_note,
      updated_at = decision_at
  where count_update.id = count_row.id
  returning * into count_row;
  update private.inventory_count_approval_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return count_row;
end
$$;

revoke insert, update, delete on public.inventory_counts from authenticated;
revoke insert, update, delete on public.inventory_count_lines from authenticated;
revoke insert, update, delete on public.inventory_transactions from authenticated;
revoke all on function public.submit_inventory_count(uuid, uuid, text, text, jsonb) from public;
revoke all on function public.approve_inventory_count(uuid, uuid, boolean, text) from public;
grant execute on function public.submit_inventory_count(uuid, uuid, text, text, jsonb) to authenticated;
grant execute on function public.approve_inventory_count(uuid, uuid, boolean, text) to authenticated;

comment on function public.submit_inventory_count(uuid, uuid, text, text, jsonb)
is 'Atomically snapshots canonical base-unit on-hand and cost evidence while accepting only observed quantities from the caller.';
comment on function public.approve_inventory_count(uuid, uuid, boolean, text)
is 'Independently approves or rejects a count and posts each non-zero count adjustment exactly once.';

-- Employee identity may be displayed/maintained by a location manager, but
-- payroll mapping and HR lifecycle evidence require organization Admin/Owner.
drop policy employee_manager_insert on public.employees;
create policy employee_admin_insert
on public.employees for insert to authenticated
with check (public.can_manage_org(organization_id));

create function public.guard_employee_hr_fields()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if tg_op = 'UPDATE' and (
    old.employee_number is distinct from new.employee_number
    or old.legal_name is distinct from new.legal_name
    or old.hire_date is distinct from new.hire_date
    or old.termination_date is distinct from new.termination_date
    or old.employment_status is distinct from new.employment_status
    or old.employment_type is distinct from new.employment_type
    or old.payroll_reference is distinct from new.payroll_reference
    or old.notes is distinct from new.notes
  ) and not public.can_manage_org(old.organization_id) then
    raise exception 'Payroll and HR lifecycle fields require Admin or Owner access'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger employee_hr_field_guard
before update on public.employees
for each row execute function public.guard_employee_hr_fields();

revoke all on function public.guard_inventory_transaction_evidence()
from public, anon, authenticated;
revoke all on function public.guard_employee_hr_fields()
from public, anon, authenticated;

-- Payroll export audit rows are derived from approved runs and immutable.
alter table public.payroll_exports
add column tip_run_id uuid,
add column allocation_snapshot jsonb not null default '[]'::jsonb,
add column allocation_snapshot_hash text;

alter table public.payroll_exports
add constraint payroll_export_snapshot_evidence_check
check (
  jsonb_typeof(allocation_snapshot) = 'array'
  and (
    (allocation_snapshot_hash is null and allocation_snapshot = '[]'::jsonb)
    or allocation_snapshot_hash ~ '^[0-9a-f]{64}$'
  )
);

alter table public.payroll_exports
add constraint payroll_exports_tip_run_fk
foreign key (organization_id, tip_run_id)
references public.tip_runs(organization_id, id) on delete restrict;

create function public.record_tip_payroll_export(
  p_request_id uuid,
  p_tip_run_id uuid,
  p_format text default 'csv',
  p_storage_path text default null
)
returns public.payroll_exports
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  run_row public.tip_runs%rowtype;
  export_row public.payroll_exports%rowtype;
  clean_storage_path text := nullif(btrim(p_storage_path), '');
  derived_totals jsonb;
  allocation_snapshot jsonb;
  allocation_snapshot_hash text;
  allocation_count integer;
  allocation_check bigint;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_format not in ('csv', 'xlsx')
    or (clean_storage_path is not null and length(clean_storage_path) > 1000) then
    raise exception 'Invalid payroll export request' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'tip-payroll-export:' || p_request_id::text,
    0
  ));
  select * into run_row
  from public.tip_runs run
  where run.id = p_tip_run_id
  for update;
  if run_row.id is null then
    raise exception 'Tip run not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_org(run_row.organization_id) then
    raise exception 'Payroll exports require Admin or Owner access'
      using errcode = '42501';
  end if;
  if run_row.status <> 'approved'
    or run_row.locked_at is null
    or run_row.approved_at is null
    or run_row.prepared_at is null
    or run_row.preparation_version <> 'closeout-labor-v1'
    or run_row.derivation_hash is null
    or run_row.derivation_hash !~ '^[0-9a-f]{64}$'
    or run_row.allocated_cents <> run_row.distributable_cents then
    raise exception 'Payroll exports require a derived, locked, balanced approved tip run'
      using errcode = '23514';
  end if;
  if clean_storage_path is not null and (
    not public.storage_path_scope_is_valid(clean_storage_path)
    or public.storage_organization_id(clean_storage_path) is distinct from run_row.organization_id
    or public.storage_location_id(clean_storage_path) is distinct from run_row.location_id
    or not exists (
      select 1
      from storage.objects object
      where object.bucket_id = 'reports'
        and object.name = clean_storage_path
        and object.owner_id = actor_id::text
    )
  ) then
    raise exception 'Payroll export storage object is missing or out of scope'
      using errcode = '23514';
  end if;
  select coalesce(jsonb_agg(
      jsonb_build_object(
        'employee_id', allocation.employee_id,
        'payroll_reference', employee.payroll_reference,
        'display_name', employee.display_name,
        'worked_minutes', participant.worked_minutes,
        'eligible', participant.eligible,
        'base_amount_cents', allocation.base_amount_cents,
        'adjustment_cents', allocation.adjustment_cents,
        'final_amount_cents', allocation.final_amount_cents,
        'weight', allocation.weight,
        'explanation', allocation.explanation
      ) order by allocation.employee_id
    ), '[]'::jsonb),
    count(allocation.id)::integer,
    coalesce(sum(allocation.final_amount_cents), 0)::bigint
  into allocation_snapshot, allocation_count, allocation_check
  from public.tip_allocations allocation
  join public.employees employee
    on employee.organization_id = run_row.organization_id
   and employee.id = allocation.employee_id
  left join public.tip_run_participants participant
    on participant.tip_run_id = run_row.id
   and participant.employee_id = allocation.employee_id
  where allocation.tip_run_id = run_row.id;
  if allocation_count = 0
    or allocation_check <> run_row.allocated_cents
    or allocation_check <> run_row.distributable_cents then
    raise exception 'Payroll allocation evidence is incomplete or unbalanced'
      using errcode = '23514';
  end if;
  allocation_snapshot_hash := encode(
    extensions.digest(allocation_snapshot::text, 'sha256'),
    'hex'
  );
  select jsonb_build_object(
    'tipRunId', run_row.id,
    'calculationVersion', run_row.calculation_version,
    'preparationVersion', run_row.preparation_version,
    'derivationHash', run_row.derivation_hash,
    'distributableCents', run_row.distributable_cents,
    'allocatedCents', run_row.allocated_cents,
    'rowCount', allocation_count,
    'allocationCheckCents', allocation_check,
    'allocationSnapshotHash', allocation_snapshot_hash
  ) into derived_totals
  ;

  select * into export_row
  from public.payroll_exports export_candidate
  where export_candidate.id = p_request_id
  for update;
  if export_row.id is not null then
    if export_row.organization_id = run_row.organization_id
      and export_row.location_id is not distinct from run_row.location_id
      and export_row.tip_run_id = run_row.id
      and export_row.period_start = run_row.business_date
      and export_row.period_end = run_row.business_date
      and export_row.status = 'succeeded'
      and export_row.format = p_format
      and export_row.storage_path is not distinct from clean_storage_path
      and export_row.totals = derived_totals
      and export_row.allocation_snapshot = allocation_snapshot
      and export_row.allocation_snapshot_hash = allocation_snapshot_hash
      and export_row.generated_by = actor_id then
      return export_row;
    end if;
    raise exception 'Payroll export request id was reused' using errcode = '23505';
  end if;

  insert into public.payroll_exports (
    id, organization_id, location_id, tip_run_id,
    period_start, period_end, status, format, storage_path,
    totals, allocation_snapshot, allocation_snapshot_hash,
    generated_by, generated_at
  ) values (
    p_request_id, run_row.organization_id, run_row.location_id, run_row.id,
    run_row.business_date, run_row.business_date, 'succeeded', p_format,
    clean_storage_path, derived_totals, allocation_snapshot,
    allocation_snapshot_hash, actor_id, clock_timestamp()
  ) returning * into export_row;
  return export_row;
end
$$;

create trigger payroll_exports_append_only
before update or delete on public.payroll_exports
for each row execute function public.prevent_ledger_mutation();

revoke insert, update, delete on public.payroll_exports from authenticated;
revoke all on function public.record_tip_payroll_export(uuid, uuid, text, text) from public;
grant execute on function public.record_tip_payroll_export(uuid, uuid, text, text) to authenticated;

comment on function public.record_tip_payroll_export(uuid, uuid, text, text)
is 'Idempotently records an immutable Admin/Owner payroll export audit derived from a locked approved tip run.';
