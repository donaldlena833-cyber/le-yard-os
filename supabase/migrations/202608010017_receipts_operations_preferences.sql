-- Le Yard OS: receipt reconciliation, authored operations content, and
-- self-owned notification delivery preferences.

create table private.receipt_reference_link_requests (
  request_id uuid primary key,
  organization_id uuid not null,
  target_table text not null check (target_table in ('expenses', 'deliveries')),
  target_record_id uuid not null,
  old_receipt_id uuid,
  new_receipt_id uuid,
  actor_id uuid not null,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.receipt_reference_link_requests
from public, anon, authenticated;

create table private.receipt_duplicate_resolution_requests (
  request_id uuid primary key,
  match_id uuid not null,
  resolution text not null check (resolution in ('duplicate', 'not_duplicate')),
  actor_id uuid not null,
  decided_at timestamptz not null,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.receipt_duplicate_resolution_requests
from public, anon, authenticated;

create function public.guard_receipt_reference_link()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  prior_receipt_id uuid := case when tg_op = 'INSERT' then null else old.receipt_id end;
begin
  if new.receipt_id is not distinct from prior_receipt_id then
    return new;
  end if;
  if not exists (
    select 1
    from private.receipt_reference_link_requests request
    where request.organization_id = new.organization_id
      and request.target_table = tg_table_name
      and request.target_record_id = new.id
      and request.old_receipt_id is not distinct from prior_receipt_id
      and request.new_receipt_id is not distinct from new.receipt_id
      and request.actor_id = auth.uid()
      and request.completed_at is null
  ) then
    raise exception 'Receipt references require an actor-bound link command'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger expense_receipt_reference_guard
before insert or update on public.expenses
for each row execute function public.guard_receipt_reference_link();

create trigger delivery_receipt_reference_guard
before insert or update on public.deliveries
for each row execute function public.guard_receipt_reference_link();

create function public.guard_receipt_duplicate_resolution()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if tg_op = 'INSERT' then
    if new.resolution is not null or new.resolved_by is not null or new.resolved_at is not null then
      raise exception 'Duplicate evidence must begin unresolved' using errcode = '42501';
    end if;
    return new;
  end if;
  if old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.receipt_id is distinct from new.receipt_id
    or old.possible_duplicate_id is distinct from new.possible_duplicate_id
    or old.score is distinct from new.score
    or old.reasons is distinct from new.reasons
    or old.created_at is distinct from new.created_at then
    raise exception 'Duplicate source evidence is immutable' using errcode = '42501';
  end if;
  if old.resolution is not null and (
    old.resolution is distinct from new.resolution
    or old.resolved_by is distinct from new.resolved_by
    or old.resolved_at is distinct from new.resolved_at
  ) then
    raise exception 'Resolved duplicate evidence is immutable' using errcode = '42501';
  end if;
  if new.resolution is null then
    if new.resolved_by is not null or new.resolved_at is not null then
      raise exception 'Unresolved duplicate evidence cannot have decision metadata'
        using errcode = '42501';
    end if;
  elsif new.resolved_by is null or new.resolved_at is null
    or not exists (
      select 1
      from private.receipt_duplicate_resolution_requests request
      where request.match_id = new.id
        and request.resolution = new.resolution
        and request.actor_id = new.resolved_by
        and request.actor_id = auth.uid()
        and request.decided_at = new.resolved_at
        and request.completed_at is null
    ) then
    raise exception 'Duplicate decisions require the authenticated actor and server time'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger receipt_duplicate_resolution_guard
before insert or update on public.receipt_duplicate_matches
for each row execute function public.guard_receipt_duplicate_resolution();

create function public.guard_receipt_terminal_duplicate_resolution()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if new.review_status in ('approved', 'rejected')
    and old.review_status not in ('approved', 'rejected')
    and exists (
      select 1
      from public.receipt_duplicate_matches candidate
      where candidate.receipt_id = new.id and candidate.resolution is null
    ) then
    raise exception 'Resolve possible duplicates before terminal receipt review'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create trigger receipt_terminal_duplicate_resolution_guard
before update of review_status on public.receipts
for each row execute function public.guard_receipt_terminal_duplicate_resolution();

create function public.resolve_receipt_duplicate(
  p_request_id uuid,
  p_match_id uuid,
  p_resolution text
)
returns public.receipt_duplicate_matches
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  decision_actor_id uuid := auth.uid();
  match_row public.receipt_duplicate_matches%rowtype;
  receipt_row public.receipts%rowtype;
  possible_row public.receipts%rowtype;
  decision_time timestamptz;
begin
  if decision_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_resolution is null or p_resolution not in ('duplicate', 'not_duplicate') then
    raise exception 'Invalid duplicate resolution' using errcode = '22023';
  end if;
  select * into match_row
  from public.receipt_duplicate_matches candidate
  where candidate.id = p_match_id
  for update;
  if match_row.id is null then
    raise exception 'Receipt duplicate match not found' using errcode = 'P0002';
  end if;
  select * into receipt_row from public.receipts receipt where receipt.id = match_row.receipt_id;
  select * into possible_row from public.receipts receipt where receipt.id = match_row.possible_duplicate_id;
  if receipt_row.id is null or possible_row.id is null
    or receipt_row.organization_id <> match_row.organization_id
    or possible_row.organization_id <> match_row.organization_id then
    raise exception 'Receipt duplicate scope is invalid' using errcode = '23514';
  end if;
  if not public.can_manage_location(receipt_row.organization_id, receipt_row.location_id)
    or not public.can_manage_location(possible_row.organization_id, possible_row.location_id) then
    raise exception 'Duplicate resolution requires management access to both receipts'
      using errcode = '42501';
  end if;
  if receipt_row.review_status in ('approved', 'rejected') then
    raise exception 'Terminal receipt duplicate evidence is immutable' using errcode = '42501';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'receipt.duplicate.resolve',
    match_row.organization_id,
    receipt_row.location_id,
    match_row.id,
    jsonb_build_object('resolution', p_resolution)
  ) then
    select * into match_row
    from public.receipt_duplicate_matches candidate
    where candidate.id = p_match_id;
    if match_row.resolution = p_resolution then return match_row; end if;
    raise exception 'Duplicate resolution replay no longer matches its result'
      using errcode = '23505';
  end if;
  if match_row.resolution is not null then
    raise exception 'Receipt duplicate match is already resolved' using errcode = '23514';
  end if;
  decision_time := clock_timestamp();
  insert into private.receipt_duplicate_resolution_requests (
    request_id, match_id, resolution, actor_id, decided_at
  ) values (
    p_request_id, match_row.id, p_resolution, decision_actor_id, decision_time
  );
  update public.receipt_duplicate_matches match_update
  set resolution = p_resolution,
      resolved_by = decision_actor_id,
      resolved_at = decision_time
  where match_update.id = match_row.id
  returning * into match_row;
  update private.receipt_duplicate_resolution_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id
    and request.actor_id = decision_actor_id;
  perform private.complete_operation_request(p_request_id);
  return match_row;
end
$$;

create function public.set_expense_receipt_link(
  p_request_id uuid,
  p_expense_id uuid,
  p_receipt_id uuid default null
)
returns public.expenses
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  link_actor_id uuid := auth.uid();
  expense_row public.expenses%rowtype;
  receipt_row public.receipts%rowtype;
begin
  if link_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into expense_row
  from public.expenses expense
  where expense.id = p_expense_id
  for update;
  if expense_row.id is null then
    raise exception 'Expense not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(expense_row.organization_id, expense_row.location_id) then
    raise exception 'Expense receipt linking requires location management'
      using errcode = '42501';
  end if;
  if p_receipt_id is not null then
    select * into receipt_row from public.receipts receipt where receipt.id = p_receipt_id;
    if receipt_row.id is null
      or receipt_row.organization_id <> expense_row.organization_id
      or receipt_row.location_id <> expense_row.location_id
      or receipt_row.review_status <> 'approved' then
      raise exception 'Choose an approved receipt from the expense location'
        using errcode = '23514';
    end if;
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'receipt.expense.link',
    expense_row.organization_id,
    expense_row.location_id,
    expense_row.id,
    jsonb_build_object('receipt_id', p_receipt_id)
  ) then
    select * into expense_row from public.expenses expense where expense.id = p_expense_id;
    if expense_row.receipt_id is not distinct from p_receipt_id then return expense_row; end if;
    raise exception 'Expense receipt link replay no longer matches its result'
      using errcode = '23505';
  end if;
  insert into private.receipt_reference_link_requests (
    request_id, organization_id, target_table, target_record_id,
    old_receipt_id, new_receipt_id, actor_id
  ) values (
    p_request_id, expense_row.organization_id, 'expenses', expense_row.id,
    expense_row.receipt_id, p_receipt_id, link_actor_id
  );
  update public.expenses expense_update
  set receipt_id = p_receipt_id,
      updated_at = clock_timestamp()
  where expense_update.id = expense_row.id
  returning * into expense_row;
  update private.receipt_reference_link_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id
    and request.actor_id = link_actor_id;
  perform private.complete_operation_request(p_request_id);
  return expense_row;
end
$$;

create function public.set_delivery_receipt_link(
  p_request_id uuid,
  p_delivery_id uuid,
  p_receipt_id uuid default null
)
returns public.deliveries
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  link_actor_id uuid := auth.uid();
  delivery_row public.deliveries%rowtype;
  receipt_row public.receipts%rowtype;
begin
  if link_actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into delivery_row
  from public.deliveries delivery
  where delivery.id = p_delivery_id
  for update;
  if delivery_row.id is null then
    raise exception 'Inventory delivery not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(delivery_row.organization_id, delivery_row.location_id) then
    raise exception 'Delivery receipt linking requires location management'
      using errcode = '42501';
  end if;
  if p_receipt_id is not null then
    select * into receipt_row from public.receipts receipt where receipt.id = p_receipt_id;
    if receipt_row.id is null
      or receipt_row.organization_id <> delivery_row.organization_id
      or receipt_row.location_id <> delivery_row.location_id
      or receipt_row.review_status <> 'approved' then
      raise exception 'Choose an approved receipt from the delivery location'
        using errcode = '23514';
    end if;
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'receipt.delivery.link',
    delivery_row.organization_id,
    delivery_row.location_id,
    delivery_row.id,
    jsonb_build_object('receipt_id', p_receipt_id)
  ) then
    select * into delivery_row from public.deliveries delivery where delivery.id = p_delivery_id;
    if delivery_row.receipt_id is not distinct from p_receipt_id then return delivery_row; end if;
    raise exception 'Delivery receipt link replay no longer matches its result'
      using errcode = '23505';
  end if;
  insert into private.receipt_reference_link_requests (
    request_id, organization_id, target_table, target_record_id,
    old_receipt_id, new_receipt_id, actor_id
  ) values (
    p_request_id, delivery_row.organization_id, 'deliveries', delivery_row.id,
    delivery_row.receipt_id, p_receipt_id, link_actor_id
  );
  update public.deliveries delivery_update
  set receipt_id = p_receipt_id,
      updated_at = clock_timestamp()
  where delivery_update.id = delivery_row.id
  returning * into delivery_row;
  update private.receipt_reference_link_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id
    and request.actor_id = link_actor_id;
  perform private.complete_operation_request(p_request_id);
  return delivery_row;
end
$$;

create function private.checklist_authoring_items_are_valid(p_items jsonb)
returns boolean
language plpgsql immutable security definer
set search_path = ''
set row_security = off
as $$
begin
  if p_items is null
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 100
    or octet_length(p_items::text) > 100000 then
    return false;
  end if;
  return not exists (
    select 1
    from jsonb_array_elements(p_items) item(value)
    where jsonb_typeof(item.value) <> 'object'
      or jsonb_typeof(item.value -> 'label') <> 'string'
      or length(btrim(item.value ->> 'label')) not between 1 and 500
      or length(coalesce(nullif(btrim(item.value ->> 'instructions'), ''), '')) > 5000
      or coalesce(item.value ->> 'response_type', 'checkbox') not in (
        'checkbox', 'text', 'number', 'photo', 'temperature'
      )
      or (item.value ? 'required' and jsonb_typeof(item.value -> 'required') <> 'boolean')
      or (item.value ? 'validation' and jsonb_typeof(item.value -> 'validation') <> 'object')
      or pg_column_size(coalesce(item.value -> 'validation', '{}'::jsonb)) > 8192
      or exists (
        select 1
        from jsonb_object_keys(item.value) item_key(value)
        where item_key.value not in (
          'label', 'instructions', 'response_type', 'required', 'validation'
        )
      )
  );
end
$$;

revoke all on function private.checklist_authoring_items_are_valid(jsonb)
from public, anon, authenticated;

create function public.create_checklist_template_version(
  p_request_id uuid,
  p_location_id uuid,
  p_name text,
  p_checklist_type text,
  p_items jsonb
)
returns public.checklist_templates
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  template_row public.checklist_templates%rowtype;
  next_version integer;
  item_record record;
  clean_name text := btrim(p_name);
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into location_row
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if location_row.id is null
    or not public.can_manage_location(location_row.organization_id, location_row.id) then
    raise exception 'Checklist authoring requires active location management'
      using errcode = '42501';
  end if;
  if length(clean_name) not between 1 and 240
    or p_checklist_type not in ('opening', 'closing', 'safety', 'cleaning', 'custom')
    or not private.checklist_authoring_items_are_valid(p_items) then
    raise exception 'Invalid checklist template draft' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'checklist-family:' || location_row.organization_id::text || ':' || clean_name,
    0
  ));
  if exists (
    select 1 from public.checklist_templates template
    where template.organization_id = location_row.organization_id
      and template.name = clean_name
      and template.location_id is distinct from location_row.id
  ) then
    raise exception 'Checklist version family belongs to a different location'
      using errcode = '23514';
  end if;
  select * into template_row
  from public.checklist_templates template
  where template.id = p_request_id;
  if template_row.id is not null then
    if not private.claim_operation_request(
      p_request_id,
      'checklist.template.version.create',
      location_row.organization_id,
      location_row.id,
      p_request_id,
      jsonb_build_object(
        'name', clean_name,
        'checklist_type', p_checklist_type,
        'version', template_row.version,
        'items', p_items
      )
    ) then
      return template_row;
    end if;
    raise exception 'Checklist authoring request has inconsistent replay evidence'
      using errcode = '40001';
  end if;
  select max(template.version) + 1
  into next_version
  from public.checklist_templates template
  where template.organization_id = location_row.organization_id
    and template.name = clean_name;
  next_version := coalesce(next_version, 1);
  if not private.claim_operation_request(
    p_request_id,
    'checklist.template.version.create',
    location_row.organization_id,
    location_row.id,
    p_request_id,
    jsonb_build_object(
      'name', clean_name,
      'checklist_type', p_checklist_type,
      'version', next_version,
      'items', p_items
    )
  ) then
    select * into template_row
    from public.checklist_templates template
    where template.id = p_request_id;
    if template_row.id is not null then return template_row; end if;
    raise exception 'Checklist authoring replay has no result row' using errcode = '40001';
  end if;
  insert into public.checklist_templates (
    id, organization_id, location_id, name, checklist_type,
    version, is_active, created_by, created_at, updated_at
  ) values (
    p_request_id, location_row.organization_id, location_row.id,
    clean_name, p_checklist_type, next_version, false,
    actor_id, clock_timestamp(), clock_timestamp()
  ) returning * into template_row;
  for item_record in
    select item.value, item.ordinality
    from jsonb_array_elements(p_items) with ordinality item(value, ordinality)
  loop
    insert into public.checklist_template_items (
      organization_id, template_id, position, label, instructions,
      response_type, required, validation
    ) values (
      template_row.organization_id,
      template_row.id,
      item_record.ordinality - 1,
      btrim(item_record.value ->> 'label'),
      nullif(btrim(item_record.value ->> 'instructions'), ''),
      coalesce(item_record.value ->> 'response_type', 'checkbox'),
      coalesce((item_record.value ->> 'required')::boolean, true),
      coalesce(item_record.value -> 'validation', '{}'::jsonb)
    );
  end loop;
  perform private.complete_operation_request(p_request_id);
  return template_row;
end
$$;

create function public.publish_checklist_template(
  p_request_id uuid,
  p_template_id uuid
)
returns public.checklist_templates
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  template_row public.checklist_templates%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into template_row
  from public.checklist_templates template
  where template.id = p_template_id
  for update;
  if template_row.id is null then
    raise exception 'Checklist template not found' using errcode = 'P0002';
  end if;
  if template_row.location_id is null
    or not public.can_manage_location(template_row.organization_id, template_row.location_id) then
    raise exception 'Checklist publishing requires location management'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.checklist_template_items item
    where item.template_id = template_row.id
  ) then
    raise exception 'A checklist needs at least one item before publishing'
      using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'checklist.template.publish',
    template_row.organization_id,
    template_row.location_id,
    template_row.id,
    jsonb_build_object('template_id', template_row.id, 'version', template_row.version)
  ) then
    select * into template_row
    from public.checklist_templates template
    where template.id = p_template_id;
    return template_row;
  end if;
  update public.checklist_templates other_version
  set is_active = false,
      updated_at = clock_timestamp()
  where other_version.organization_id = template_row.organization_id
    and other_version.name = template_row.name
    and other_version.id <> template_row.id
    and other_version.is_active;
  update public.checklist_templates template_update
  set is_active = true,
      updated_at = clock_timestamp()
  where template_update.id = template_row.id
  returning * into template_row;
  perform private.complete_operation_request(p_request_id);
  return template_row;
end
$$;

create function public.create_sop_draft(
  p_request_id uuid,
  p_location_id uuid,
  p_title text,
  p_category text,
  p_requires_acknowledgement boolean,
  p_body text,
  p_change_summary text default null
)
returns public.sop_versions
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  document_row public.sop_documents%rowtype;
  version_row public.sop_versions%rowtype;
  clean_title text := btrim(p_title);
  clean_category text := nullif(btrim(p_category), '');
  clean_body text := btrim(p_body);
  clean_summary text := nullif(btrim(p_change_summary), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into location_row
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if location_row.id is null
    or not public.can_manage_location(location_row.organization_id, location_row.id) then
    raise exception 'SOP authoring requires active location management'
      using errcode = '42501';
  end if;
  if length(clean_title) not between 1 and 240
    or length(coalesce(clean_category, '')) > 120
    or p_requires_acknowledgement is null
    or length(clean_body) not between 1 and 100000
    or length(coalesce(clean_summary, '')) > 2000 then
    raise exception 'Invalid SOP draft' using errcode = '22023';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'sop.draft.create',
    location_row.organization_id,
    location_row.id,
    p_request_id,
    jsonb_build_object(
      'title', clean_title,
      'category', clean_category,
      'requires_acknowledgement', p_requires_acknowledgement,
      'body', clean_body,
      'change_summary', clean_summary
    )
  ) then
    select * into version_row from public.sop_versions version where version.id = p_request_id;
    if version_row.id is not null then return version_row; end if;
    raise exception 'SOP authoring replay has no result row' using errcode = '40001';
  end if;
  insert into public.sop_documents (
    organization_id, location_id, title, category, current_version,
    is_published, requires_acknowledgement, created_by,
    created_at, updated_at
  ) values (
    location_row.organization_id, location_row.id, clean_title, clean_category,
    1, false, p_requires_acknowledgement, actor_id,
    clock_timestamp(), clock_timestamp()
  ) returning * into document_row;
  insert into public.sop_versions (
    id, organization_id, sop_document_id, version, body,
    storage_path, change_summary, published_by, published_at,
    created_by, created_at
  ) values (
    p_request_id, document_row.organization_id, document_row.id, 1,
    clean_body, null, clean_summary, null, null,
    actor_id, clock_timestamp()
  ) returning * into version_row;
  perform private.complete_operation_request(p_request_id);
  return version_row;
end
$$;

create function public.create_sop_version(
  p_request_id uuid,
  p_sop_document_id uuid,
  p_body text,
  p_change_summary text default null
)
returns public.sop_versions
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  document_row public.sop_documents%rowtype;
  version_row public.sop_versions%rowtype;
  next_version integer;
  clean_body text := btrim(p_body);
  clean_summary text := nullif(btrim(p_change_summary), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into document_row
  from public.sop_documents document
  where document.id = p_sop_document_id
  for update;
  if document_row.id is null then
    raise exception 'SOP document not found' using errcode = 'P0002';
  end if;
  if document_row.location_id is null then
    if not public.can_operate_org(document_row.organization_id) then
      raise exception 'SOP versioning requires organization management'
        using errcode = '42501';
    end if;
  elsif not public.can_manage_location(document_row.organization_id, document_row.location_id) then
    raise exception 'SOP versioning requires location management'
      using errcode = '42501';
  end if;
  if not document_row.is_published then
    raise exception 'Publish the initial SOP draft before creating another version'
      using errcode = '23514';
  end if;
  if length(clean_body) not between 1 and 100000
    or length(coalesce(clean_summary, '')) > 2000 then
    raise exception 'Invalid SOP version draft' using errcode = '22023';
  end if;
  select * into version_row
  from public.sop_versions version
  where version.id = p_request_id;
  if version_row.id is not null then
    if not private.claim_operation_request(
      p_request_id,
      'sop.version.create',
      document_row.organization_id,
      document_row.location_id,
      p_request_id,
      jsonb_build_object(
        'sop_document_id', document_row.id,
        'version', version_row.version,
        'body', clean_body,
        'change_summary', clean_summary
      )
    ) then
      return version_row;
    end if;
    raise exception 'SOP version request has inconsistent replay evidence'
      using errcode = '40001';
  end if;
  if exists (
    select 1 from public.sop_versions version
    where version.sop_document_id = document_row.id and version.published_at is null
  ) then
    raise exception 'This SOP already has an unpublished draft' using errcode = '23505';
  end if;
  select coalesce(max(version.version), 0) + 1 into next_version
  from public.sop_versions version
  where version.sop_document_id = document_row.id;
  if not private.claim_operation_request(
    p_request_id,
    'sop.version.create',
    document_row.organization_id,
    document_row.location_id,
    p_request_id,
    jsonb_build_object(
      'sop_document_id', document_row.id,
      'version', next_version,
      'body', clean_body,
      'change_summary', clean_summary
    )
  ) then
    select * into version_row from public.sop_versions version where version.id = p_request_id;
    if version_row.id is not null then return version_row; end if;
    raise exception 'SOP version replay has no result row' using errcode = '40001';
  end if;
  insert into public.sop_versions (
    id, organization_id, sop_document_id, version, body,
    storage_path, change_summary, published_by, published_at,
    created_by, created_at
  ) values (
    p_request_id, document_row.organization_id, document_row.id,
    next_version, clean_body, null, clean_summary, null, null,
    actor_id, clock_timestamp()
  ) returning * into version_row;
  perform private.complete_operation_request(p_request_id);
  return version_row;
end
$$;

create function public.update_sop_draft(
  p_request_id uuid,
  p_sop_version_id uuid,
  p_body text,
  p_change_summary text default null
)
returns public.sop_versions
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  version_row public.sop_versions%rowtype;
  document_row public.sop_documents%rowtype;
  clean_body text := btrim(p_body);
  clean_summary text := nullif(btrim(p_change_summary), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into version_row
  from public.sop_versions version
  where version.id = p_sop_version_id
  for update;
  if version_row.id is null then
    raise exception 'SOP version not found' using errcode = 'P0002';
  end if;
  select * into document_row
  from public.sop_documents document
  where document.id = version_row.sop_document_id;
  if document_row.location_id is null then
    if not public.can_operate_org(document_row.organization_id) then
      raise exception 'SOP draft editing requires organization management'
        using errcode = '42501';
    end if;
  elsif not public.can_manage_location(document_row.organization_id, document_row.location_id) then
    raise exception 'SOP draft editing requires location management'
      using errcode = '42501';
  end if;
  if version_row.published_at is not null then
    raise exception 'Published SOP versions are immutable' using errcode = '42501';
  end if;
  if length(clean_body) not between 1 and 100000
    or length(coalesce(clean_summary, '')) > 2000 then
    raise exception 'Invalid SOP version draft' using errcode = '22023';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'sop.draft.update',
    version_row.organization_id,
    document_row.location_id,
    version_row.id,
    jsonb_build_object('body', clean_body, 'change_summary', clean_summary)
  ) then
    select * into version_row from public.sop_versions version where version.id = p_sop_version_id;
    if version_row.body = clean_body
      and version_row.change_summary is not distinct from clean_summary then
      return version_row;
    end if;
    raise exception 'SOP draft replay no longer matches its result' using errcode = '23505';
  end if;
  update public.sop_versions version_update
  set body = clean_body,
      change_summary = clean_summary
  where version_update.id = version_row.id
  returning * into version_row;
  perform private.complete_operation_request(p_request_id);
  return version_row;
end
$$;

create function public.publish_sop_version(
  p_request_id uuid,
  p_sop_version_id uuid
)
returns public.sop_versions
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  version_row public.sop_versions%rowtype;
  document_row public.sop_documents%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into version_row
  from public.sop_versions version
  where version.id = p_sop_version_id
  for update;
  if version_row.id is null then
    raise exception 'SOP version not found' using errcode = 'P0002';
  end if;
  select * into document_row
  from public.sop_documents document
  where document.id = version_row.sop_document_id
  for update;
  if document_row.location_id is null then
    if not public.can_operate_org(document_row.organization_id) then
      raise exception 'SOP publishing requires organization management'
        using errcode = '42501';
    end if;
  elsif not public.can_manage_location(document_row.organization_id, document_row.location_id) then
    raise exception 'SOP publishing requires location management'
      using errcode = '42501';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'sop.version.publish',
    version_row.organization_id,
    document_row.location_id,
    version_row.id,
    jsonb_build_object('version', version_row.version)
  ) then
    select * into version_row from public.sop_versions version where version.id = p_sop_version_id;
    return version_row;
  end if;
  if version_row.published_at is not null then
    raise exception 'SOP version is already published' using errcode = '23514';
  end if;
  if exists (
    select 1 from public.sop_versions later_version
    where later_version.sop_document_id = version_row.sop_document_id
      and later_version.version > version_row.version
  ) then
    raise exception 'Publish the latest SOP version draft' using errcode = '23514';
  end if;
  update public.sop_versions version_update
  set published_by = actor_id,
      published_at = clock_timestamp()
  where version_update.id = version_row.id
  returning * into version_row;
  update public.sop_documents document_update
  set current_version = version_row.version,
      is_published = true,
      updated_at = clock_timestamp()
  where document_update.id = document_row.id;
  perform private.complete_operation_request(p_request_id);
  return version_row;
end
$$;

create function public.notification_type_is_supported(p_notification_type text)
returns boolean
language sql immutable security definer
set search_path = ''
set row_security = off
as $$
  select p_notification_type in (
    'schedule_published',
    'shift_assigned',
    'shift_swap_decided',
    'time_correction_decided',
    'time_off_decided',
    'task_assigned'
  )
$$;

create function public.set_notification_preference(
  p_request_id uuid,
  p_organization_id uuid,
  p_notification_type text,
  p_in_app boolean,
  p_email boolean,
  p_push boolean,
  p_quiet_hours jsonb default '{}'::jsonb
)
returns public.notification_preferences
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  preference_row public.notification_preferences%rowtype;
  result_id uuid;
  clean_quiet_hours jsonb := coalesce(p_quiet_hours, '{}'::jsonb);
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = actor_id
      and membership.status = 'active'
  ) then
    raise exception 'Active organization membership is required' using errcode = '42501';
  end if;
  if not public.notification_type_is_supported(p_notification_type)
    or p_in_app is null or p_email is null or p_push is null
    or jsonb_typeof(clean_quiet_hours) <> 'object'
    or pg_column_size(clean_quiet_hours) > 8192 then
    raise exception 'Invalid notification preference' using errcode = '22023';
  end if;
  select * into preference_row
  from public.notification_preferences preference
  where preference.organization_id = p_organization_id
    and preference.user_id = actor_id
    and preference.notification_type = p_notification_type
  for update;
  result_id := coalesce(preference_row.id, p_request_id);
  if not private.claim_operation_request(
    p_request_id,
    'notification.preference.set',
    p_organization_id,
    null,
    result_id,
    jsonb_build_object(
      'notification_type', p_notification_type,
      'in_app', p_in_app,
      'email', p_email,
      'push', p_push,
      'quiet_hours', clean_quiet_hours
    )
  ) then
    select * into preference_row
    from public.notification_preferences preference
    where preference.organization_id = p_organization_id
      and preference.user_id = actor_id
      and preference.notification_type = p_notification_type;
    if preference_row.id is not null then return preference_row; end if;
    raise exception 'Notification preference replay has no result row' using errcode = '40001';
  end if;
  insert into public.notification_preferences (
    id, organization_id, user_id, notification_type,
    in_app, email, push, quiet_hours, updated_at
  ) values (
    result_id, p_organization_id, actor_id, p_notification_type,
    p_in_app, p_email, p_push, clean_quiet_hours, clock_timestamp()
  )
  on conflict (organization_id, user_id, notification_type) do update
  set in_app = excluded.in_app,
      email = excluded.email,
      push = excluded.push,
      quiet_hours = excluded.quiet_hours,
      updated_at = clock_timestamp()
  returning * into preference_row;
  perform private.complete_operation_request(p_request_id);
  return preference_row;
end
$$;

create function public.save_push_subscription(
  p_request_id uuid,
  p_organization_id uuid,
  p_endpoint_hash text,
  p_encrypted_subscription bytea,
  p_device_label text default null
)
returns public.push_subscriptions
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  subscription_row public.push_subscriptions%rowtype;
  result_id uuid;
  clean_label text := nullif(btrim(p_device_label), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = actor_id
      and membership.status = 'active'
  ) then
    raise exception 'Active organization membership is required' using errcode = '42501';
  end if;
  if p_endpoint_hash is null or p_endpoint_hash !~ '^[0-9a-f]{64}$'
    or p_encrypted_subscription is null
    or octet_length(p_encrypted_subscription) not between 1 and 16384
    or length(coalesce(clean_label, '')) > 120 then
    raise exception 'Invalid push subscription evidence' using errcode = '22023';
  end if;
  select * into subscription_row
  from public.push_subscriptions subscription
  where subscription.organization_id = p_organization_id
    and subscription.user_id = actor_id
    and subscription.endpoint_hash = p_endpoint_hash
  for update;
  result_id := coalesce(subscription_row.id, p_request_id);
  if not private.claim_operation_request(
    p_request_id,
    'notification.push.save',
    p_organization_id,
    null,
    result_id,
    jsonb_build_object(
      'endpoint_hash', p_endpoint_hash,
      'encrypted_subscription_sha256',
        encode(extensions.digest(p_encrypted_subscription, 'sha256'), 'hex'),
      'device_label', clean_label
    )
  ) then
    select * into subscription_row
    from public.push_subscriptions subscription
    where subscription.organization_id = p_organization_id
      and subscription.user_id = actor_id
      and subscription.endpoint_hash = p_endpoint_hash;
    if subscription_row.id is not null then return subscription_row; end if;
    raise exception 'Push subscription replay has no result row' using errcode = '40001';
  end if;
  insert into public.push_subscriptions (
    id, organization_id, user_id, endpoint_hash,
    encrypted_subscription, device_label, last_used_at, created_at
  ) values (
    result_id, p_organization_id, actor_id, p_endpoint_hash,
    p_encrypted_subscription, clean_label, clock_timestamp(), clock_timestamp()
  )
  on conflict (organization_id, user_id, endpoint_hash) do update
  set encrypted_subscription = excluded.encrypted_subscription,
      device_label = excluded.device_label,
      last_used_at = clock_timestamp()
  returning * into subscription_row;
  perform private.complete_operation_request(p_request_id);
  return subscription_row;
end
$$;

create function public.remove_push_subscription(
  p_request_id uuid,
  p_organization_id uuid,
  p_endpoint_hash text
)
returns boolean
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  subscription_row public.push_subscriptions%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_endpoint_hash is null or p_endpoint_hash !~ '^[0-9a-f]{64}$'
    or not exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = p_organization_id
        and membership.user_id = actor_id
        and membership.status = 'active'
    ) then
    raise exception 'Push subscription scope is invalid' using errcode = '42501';
  end if;
  select * into subscription_row
  from public.push_subscriptions subscription
  where subscription.organization_id = p_organization_id
    and subscription.user_id = actor_id
    and subscription.endpoint_hash = p_endpoint_hash
  for update;
  if not private.claim_operation_request(
    p_request_id,
    'notification.push.remove',
    p_organization_id,
    null,
    p_request_id,
    jsonb_build_object('endpoint_hash', p_endpoint_hash)
  ) then
    return true;
  end if;
  delete from public.push_subscriptions subscription
  where subscription.organization_id = p_organization_id
    and subscription.user_id = actor_id
    and subscription.endpoint_hash = p_endpoint_hash;
  perform private.complete_operation_request(p_request_id);
  return true;
end
$$;

create or replace function private.emit_derived_notification(
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
    and not exists (
      select 1
      from public.notification_preferences preference
      where preference.organization_id = p_organization_id
        and preference.user_id = p_user_id
        and preference.notification_type = p_notification_type
        and not preference.in_app
    )
  on conflict (organization_id, evidence_key) where evidence_key is not null
  do nothing;
end
$$;

revoke all on function private.emit_derived_notification(
  uuid, uuid, text, text, text, text, text, text, uuid
) from public, anon, authenticated;

revoke update, delete on public.receipt_duplicate_matches from authenticated;
revoke insert, update, delete on public.notification_preferences from authenticated;
revoke insert, update, delete on public.push_subscriptions from authenticated;

revoke all on function public.guard_receipt_reference_link()
from public, anon, authenticated;
revoke all on function public.guard_receipt_duplicate_resolution()
from public, anon, authenticated;
revoke all on function public.guard_receipt_terminal_duplicate_resolution()
from public, anon, authenticated;
revoke all on function public.notification_type_is_supported(text)
from public, anon, authenticated;

revoke all on function public.resolve_receipt_duplicate(uuid, uuid, text) from public;
revoke all on function public.set_expense_receipt_link(uuid, uuid, uuid) from public;
revoke all on function public.set_delivery_receipt_link(uuid, uuid, uuid) from public;
revoke all on function public.create_checklist_template_version(uuid, uuid, text, text, jsonb)
from public;
revoke all on function public.publish_checklist_template(uuid, uuid) from public;
revoke all on function public.create_sop_draft(uuid, uuid, text, text, boolean, text, text)
from public;
revoke all on function public.create_sop_version(uuid, uuid, text, text) from public;
revoke all on function public.update_sop_draft(uuid, uuid, text, text) from public;
revoke all on function public.publish_sop_version(uuid, uuid) from public;
revoke all on function public.set_notification_preference(
  uuid, uuid, text, boolean, boolean, boolean, jsonb
) from public;
revoke all on function public.save_push_subscription(uuid, uuid, text, bytea, text)
from public;
revoke all on function public.remove_push_subscription(uuid, uuid, text) from public;

grant execute on function public.resolve_receipt_duplicate(uuid, uuid, text)
to authenticated;
grant execute on function public.set_expense_receipt_link(uuid, uuid, uuid)
to authenticated;
grant execute on function public.set_delivery_receipt_link(uuid, uuid, uuid)
to authenticated;
grant execute on function public.create_checklist_template_version(
  uuid, uuid, text, text, jsonb
) to authenticated;
grant execute on function public.publish_checklist_template(uuid, uuid)
to authenticated;
grant execute on function public.create_sop_draft(
  uuid, uuid, text, text, boolean, text, text
) to authenticated;
grant execute on function public.create_sop_version(uuid, uuid, text, text)
to authenticated;
grant execute on function public.update_sop_draft(uuid, uuid, text, text)
to authenticated;
grant execute on function public.publish_sop_version(uuid, uuid)
to authenticated;
grant execute on function public.set_notification_preference(
  uuid, uuid, text, boolean, boolean, boolean, jsonb
) to authenticated;
grant execute on function public.save_push_subscription(uuid, uuid, text, bytea, text)
to authenticated;
grant execute on function public.remove_push_subscription(uuid, uuid, text)
to authenticated;

comment on function public.resolve_receipt_duplicate(uuid, uuid, text)
is 'Records an actor-derived, immutable human resolution for a pending receipt duplicate match.';
comment on function public.set_expense_receipt_link(uuid, uuid, uuid)
is 'Links or unlinks one approved, same-location receipt from an expense through actor-bound evidence.';
comment on function public.set_delivery_receipt_link(uuid, uuid, uuid)
is 'Links or unlinks one approved, same-location receipt from an inventory delivery through actor-bound evidence.';
comment on function public.create_checklist_template_version(uuid, uuid, text, text, jsonb)
is 'Creates a complete inactive checklist template version and actor-stamped item set.';
comment on function public.publish_checklist_template(uuid, uuid)
is 'Publishes one checklist version for its location and retires the prior active version.';
comment on function public.create_sop_draft(uuid, uuid, text, text, boolean, text, text)
is 'Creates a location-scoped SOP document and first unpublished body version.';
comment on function public.create_sop_version(uuid, uuid, text, text)
is 'Creates the next immutable-version candidate for a published SOP document.';
comment on function public.update_sop_draft(uuid, uuid, text, text)
is 'Updates only an unpublished SOP body version through an idempotent management command.';
comment on function public.publish_sop_version(uuid, uuid)
is 'Publishes the latest SOP version with server-derived actor and time evidence.';
comment on function public.set_notification_preference(
  uuid, uuid, text, boolean, boolean, boolean, jsonb
)
is 'Upserts one self-owned notification delivery preference for an active organization membership.';
comment on function public.save_push_subscription(uuid, uuid, text, bytea, text)
is 'Stores only a server-encrypted browser push subscription with an actor-derived user and bounded endpoint hash.';
comment on function public.remove_push_subscription(uuid, uuid, text)
is 'Idempotently removes one self-owned browser push subscription by endpoint hash.';
