-- Le Yard OS: close remaining receipt/operations write gaps and add the
-- configuration commands required by a fresh connected tenant.

-- Receipt fingerprint custody ------------------------------------------------

create table private.receipt_fingerprint_requests (
  request_id uuid primary key,
  organization_id uuid not null,
  location_id uuid not null,
  receipt_id uuid not null,
  content_hash text not null check (content_hash ~ '^[0-9a-f]{64}$'),
  duplicate_receipt_id uuid,
  duplicate_match_id uuid,
  actor_id uuid not null,
  completed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  check (
    (duplicate_receipt_id is null and duplicate_match_id is null)
    or (duplicate_receipt_id is not null and duplicate_match_id is not null)
  )
);

revoke all on table private.receipt_fingerprint_requests
from public, anon, authenticated, service_role;

-- Hash uniqueness is location scoped because duplicate evidence may never join
-- otherwise unrelated restaurant locations.
create unique index receipts_location_content_hash_unique
on public.receipts(organization_id, location_id, content_hash)
where content_hash is not null;

drop index public.receipts_content_hash_unique;

create function public.record_receipt_fingerprint(
  p_request_id uuid,
  p_receipt_id uuid,
  p_content_hash text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  receipt_row public.receipts%rowtype;
  duplicate_row public.receipts%rowtype;
  match_row public.receipt_duplicate_matches%rowtype;
  prior private.receipt_fingerprint_requests%rowtype;
  result_payload jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_receipt_id is null
    or p_content_hash is null or p_content_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Receipt fingerprint input is invalid' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'receipt-fingerprint-request:' || p_request_id::text,
    0
  ));
  select * into receipt_row
  from public.receipts receipt
  where receipt.id = p_receipt_id
  for update;
  if receipt_row.id is null then
    raise exception 'Receipt not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(receipt_row.organization_id, receipt_row.location_id) then
    raise exception 'Receipt fingerprinting requires location management'
      using errcode = '42501';
  end if;

  select * into prior
  from private.receipt_fingerprint_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null then
    if prior.organization_id = receipt_row.organization_id
      and prior.location_id = receipt_row.location_id
      and prior.receipt_id = receipt_row.id
      and prior.content_hash = p_content_hash
      and prior.actor_id = actor_id then
      return jsonb_build_object(
        'receipt_id', prior.receipt_id,
        'content_hash', prior.content_hash,
        'duplicate_receipt_id', prior.duplicate_receipt_id,
        'duplicate_match_id', prior.duplicate_match_id
      );
    end if;
    raise exception 'Receipt fingerprint request id was reused' using errcode = '23505';
  end if;

  if receipt_row.review_status in ('approved', 'rejected') then
    raise exception 'Reviewed receipt evidence is immutable' using errcode = '42501';
  end if;
  if receipt_row.content_hash is not null
    and receipt_row.content_hash <> p_content_hash then
    raise exception 'This receipt is already bound to different private evidence'
      using errcode = '23505';
  end if;

  perform pg_advisory_xact_lock(hashtextextended(
    'receipt-fingerprint:' || receipt_row.organization_id::text || ':'
      || receipt_row.location_id::text || ':' || p_content_hash,
    0
  ));
  select * into duplicate_row
  from public.receipts duplicate_candidate
  where duplicate_candidate.organization_id = receipt_row.organization_id
    and duplicate_candidate.location_id = receipt_row.location_id
    and duplicate_candidate.content_hash = p_content_hash
    and duplicate_candidate.id <> receipt_row.id
  order by duplicate_candidate.created_at, duplicate_candidate.id
  limit 1
  for update;

  if duplicate_row.id is not null then
    if duplicate_row.organization_id <> receipt_row.organization_id
      or duplicate_row.location_id <> receipt_row.location_id
      or not public.can_manage_location(
        duplicate_row.organization_id,
        duplicate_row.location_id
      ) then
      raise exception 'Duplicate receipt scope is invalid' using errcode = '42501';
    end if;
    select * into match_row
    from public.receipt_duplicate_matches candidate
    where candidate.receipt_id = receipt_row.id
      and candidate.possible_duplicate_id = duplicate_row.id;
    if match_row.id is null then
      insert into public.receipt_duplicate_matches (
        id, organization_id, receipt_id, possible_duplicate_id, score, reasons
      ) values (
        p_request_id, receipt_row.organization_id, receipt_row.id,
        duplicate_row.id, 1, '["sha256_exact_content_match"]'::jsonb
      ) returning * into match_row;
    elsif match_row.score <> 1
      or not match_row.reasons @> '["sha256_exact_content_match"]'::jsonb then
      raise exception 'Existing duplicate evidence conflicts with the exact fingerprint'
        using errcode = '23505';
    end if;
  elsif receipt_row.content_hash is null then
    update public.receipts receipt_update
    set content_hash = p_content_hash,
        updated_at = clock_timestamp()
    where receipt_update.id = receipt_row.id
    returning * into receipt_row;
  end if;

  insert into private.receipt_fingerprint_requests (
    request_id, organization_id, location_id, receipt_id, content_hash,
    duplicate_receipt_id, duplicate_match_id, actor_id, completed_at
  ) values (
    p_request_id, receipt_row.organization_id, receipt_row.location_id,
    receipt_row.id, p_content_hash, duplicate_row.id, match_row.id,
    actor_id, clock_timestamp()
  );
  result_payload := jsonb_build_object(
    'receipt_id', receipt_row.id,
    'content_hash', p_content_hash,
    'duplicate_receipt_id', duplicate_row.id,
    'duplicate_match_id', match_row.id
  );
  return result_payload;
end
$$;

revoke insert, update, delete on public.receipt_duplicate_matches from authenticated;
revoke update (content_hash) on public.receipts from authenticated;
revoke all on function public.record_receipt_fingerprint(uuid, uuid, text) from public;
grant execute on function public.record_receipt_fingerprint(uuid, uuid, text) to authenticated;

comment on function public.record_receipt_fingerprint(uuid, uuid, text)
is 'Actor-bound exact-hash receipt command. It derives duplicate score/reasons and never links evidence across locations.';

-- Verified checklist photo custody ------------------------------------------

create table private.verified_checklist_photo_requests (
  request_id uuid primary key,
  organization_id uuid not null,
  location_id uuid not null,
  run_id uuid not null,
  template_item_id uuid not null,
  response_id uuid not null,
  actor_id uuid not null,
  payload_hash text not null check (payload_hash ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.verified_checklist_photo_requests
from public, anon, authenticated, service_role;

create or replace function public.record_checklist_response(
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
  if authorized is not true then
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
  if item_row.response_type = 'photo' or clean_path is not null then
    raise exception 'Photo evidence requires the verified server workflow'
      using errcode = '42501';
  end if;
  if (item_row.response_type = 'checkbox' and jsonb_typeof(p_response) <> 'boolean')
    or (item_row.response_type = 'text' and jsonb_typeof(p_response) <> 'string')
    or (item_row.response_type in ('number', 'temperature')
      and jsonb_typeof(p_response) <> 'number') then
    raise exception 'Checklist response does not match the item response type'
      using errcode = '22023';
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
      'storage_path', null,
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
      p_response, null, actor_id, clock_timestamp(), clean_notes
    ) returning * into response_row;
  else
    update public.checklist_responses response_update
    set response = p_response,
        storage_path = null,
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

create function public.bind_verified_checklist_photo_response(
  p_request_id uuid,
  p_actor_id uuid,
  p_actor_aal text,
  p_run_id uuid,
  p_template_item_id uuid,
  p_response jsonb,
  p_storage_path text,
  p_notes text,
  p_mime_type text,
  p_size_bytes bigint
)
returns public.checklist_responses
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  run_row public.checklist_runs%rowtype;
  item_row public.checklist_template_items%rowtype;
  response_row public.checklist_responses%rowtype;
  prior private.verified_checklist_photo_requests%rowtype;
  actor_role public.app_role;
  clean_path text := nullif(btrim(p_storage_path), '');
  clean_notes text := nullif(btrim(p_notes), '');
  payload_hash text;
  authorized boolean := false;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Verified checklist photo binding is service-only'
      using errcode = '42501';
  end if;
  if p_request_id is null or p_actor_id is null or p_run_id is null
    or p_template_item_id is null or p_response is null
    or jsonb_typeof(p_response) <> 'object'
    or clean_path is null or length(clean_path) > 1000
    or clean_notes is not null and length(clean_notes) > 2000
    or p_mime_type not in ('image/jpeg', 'image/png', 'image/webp')
    or p_size_bytes is null or p_size_bytes < 1 or p_size_bytes > 26214400
    or p_response ->> 'mime_type' is distinct from p_mime_type
    or coalesce((p_response ->> 'size_bytes')::bigint, -1) <> p_size_bytes then
    raise exception 'Verified checklist photo payload is invalid' using errcode = '22023';
  end if;
  select * into run_row
  from public.checklist_runs run
  where run.id = p_run_id
  for update;
  if run_row.id is null then
    raise exception 'Checklist run not found' using errcode = 'P0002';
  end if;
  select membership.role into actor_role
  from public.organization_memberships membership
  where membership.organization_id = run_row.organization_id
    and membership.user_id = p_actor_id
    and membership.status = 'active';
  authorized := actor_role = 'admin'
    or (actor_role = 'owner' and p_actor_aal = 'aal2')
    or (actor_role = 'manager' and exists (
      select 1 from public.location_memberships location_membership
      where location_membership.organization_id = run_row.organization_id
        and location_membership.location_id = run_row.location_id
        and location_membership.user_id = p_actor_id
    ))
    or (run_row.assigned_employee_id is not null and exists (
      select 1 from public.employees employee
      where employee.id = run_row.assigned_employee_id
        and employee.organization_id = run_row.organization_id
        and employee.user_id = p_actor_id
        and employee.employment_status = 'active'
    ));
  if authorized is not true then
    raise exception 'Actor is not authorized for this checklist run'
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
    or item_row.template_id <> run_row.template_id
    or item_row.response_type <> 'photo' then
    raise exception 'Photo item does not belong to this checklist run'
      using errcode = '23514';
  end if;
  if not public.storage_path_scope_is_valid(clean_path)
    or public.storage_organization_id(clean_path) is distinct from run_row.organization_id
    or public.storage_location_id(clean_path) is distinct from run_row.location_id
    or split_part(clean_path, '/', 3) <> 'checklists'
    or split_part(clean_path, '/', 4) <> run_row.id::text
    or not exists (
      select 1 from storage.objects object
      where object.bucket_id = 'checklists'
        and object.name = clean_path
        and object.owner_id = p_actor_id::text
    ) then
    raise exception 'Verified checklist photo is outside the actor and run scope'
      using errcode = '23514';
  end if;

  payload_hash := encode(extensions.digest(
    jsonb_build_object(
      'run_id', run_row.id,
      'template_item_id', item_row.id,
      'response', p_response,
      'storage_path', clean_path,
      'notes', clean_notes,
      'mime_type', p_mime_type,
      'size_bytes', p_size_bytes
    )::text,
    'sha256'
  ), 'hex');
  perform pg_advisory_xact_lock(hashtextextended(
    'verified-checklist-photo:' || p_request_id::text,
    0
  ));
  select * into prior
  from private.verified_checklist_photo_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null then
    if prior.organization_id = run_row.organization_id
      and prior.location_id = run_row.location_id
      and prior.run_id = run_row.id
      and prior.template_item_id = item_row.id
      and prior.actor_id = p_actor_id
      and prior.payload_hash = payload_hash then
      select * into response_row
      from public.checklist_responses response
      where response.id = prior.response_id;
      if response_row.id is not null then return response_row; end if;
      raise exception 'Verified checklist photo replay has no result row'
        using errcode = '40001';
    end if;
    raise exception 'Verified checklist photo request id was reused'
      using errcode = '23505';
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
      p_response, clean_path, p_actor_id, clock_timestamp(), clean_notes
    ) returning * into response_row;
  else
    update public.checklist_responses response_update
    set response = p_response,
        storage_path = clean_path,
        responded_by = p_actor_id,
        responded_at = clock_timestamp(),
        notes = clean_notes
    where response_update.id = response_row.id
    returning * into response_row;
  end if;
  insert into private.verified_checklist_photo_requests (
    request_id, organization_id, location_id, run_id, template_item_id,
    response_id, actor_id, payload_hash, completed_at
  ) values (
    p_request_id, run_row.organization_id, run_row.location_id, run_row.id,
    item_row.id, response_row.id, p_actor_id, payload_hash, clock_timestamp()
  );
  return response_row;
end
$$;

revoke all on function public.bind_verified_checklist_photo_response(
  uuid, uuid, text, uuid, uuid, jsonb, text, text, text, bigint
) from public, anon, authenticated;
grant execute on function public.bind_verified_checklist_photo_response(
  uuid, uuid, text, uuid, uuid, jsonb, text, text, text, bigint
) to service_role;

comment on function public.bind_verified_checklist_photo_response(
  uuid, uuid, text, uuid, uuid, jsonb, text, text, text, bigint
)
is 'Service-only binding after the authenticated server workflow verifies image bytes, size, signature, actor, item, run, and private object path.';

-- Storage rejects unsupported checklist evidence before upload. Other bucket
-- settings remain untouched.
update storage.buckets
set file_size_limit = 26214400,
    allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp']::text[]
where id = 'checklists';

-- Replay-first checklist and SOP commands -----------------------------------

create or replace function public.start_checklist_run(
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
  operation_row private.operation_requests%rowtype;
  actor_employee_id uuid;
  effective_assignee uuid := p_assigned_employee_id;
  is_manager boolean;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select * into run_row
  from public.checklist_runs run
  where run.id = p_request_id;
  if run_row.id is not null then
    if run_row.location_id <> p_location_id
      or not public.can_access_location(run_row.organization_id, run_row.location_id) then
      raise exception 'Checklist run is unavailable to this actor' using errcode = '42501';
    end if;
    effective_assignee := coalesce(p_assigned_employee_id, run_row.assigned_employee_id);
    select * into operation_row
    from private.operation_requests request
    where request.request_id = p_request_id;
    if operation_row.request_id is not null then
      if not private.claim_operation_request(
        p_request_id,
        'checklist.start',
        run_row.organization_id,
        run_row.location_id,
        run_row.id,
        jsonb_build_object(
          'template_id', p_template_id,
          'business_date', p_business_date,
          'assigned_employee_id', effective_assignee
        )
      ) then
        return run_row;
      end if;
      raise exception 'Checklist start replay unexpectedly claimed a completed result'
        using errcode = '40001';
    end if;
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
  effective_assignee := p_assigned_employee_id;
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

create or replace function public.acknowledge_sop(
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
  operation_row private.operation_requests%rowtype;
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
  if version_row.id is null or document_row.id is null
    or version_row.organization_id <> document_row.organization_id then
    raise exception 'SOP version is unavailable' using errcode = '23514';
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

  select * into operation_row
  from private.operation_requests request
  where request.request_id = p_request_id;
  if operation_row.request_id is not null then
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
      raise exception 'SOP acknowledgement replay has no result row'
        using errcode = '40001';
    end if;
    raise exception 'SOP acknowledgement replay unexpectedly claimed a completed result'
      using errcode = '40001';
  end if;

  if not document_row.is_published
    or document_row.current_version <> version_row.version
    or version_row.published_at is null then
    raise exception 'Only the current published SOP version may be acknowledged'
      using errcode = '23514';
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

-- Connected chat channel configuration --------------------------------------

create function public.create_chat_channel(
  p_request_id uuid,
  p_organization_id uuid,
  p_kind public.channel_kind,
  p_location_id uuid,
  p_name text,
  p_description text default null,
  p_member_ids uuid[] default '{}'::uuid[]
)
returns public.chat_channels
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  channel_row public.chat_channels%rowtype;
  canonical_row public.chat_channels%rowtype;
  clean_name text := btrim(coalesce(p_name, ''));
  clean_description text := nullif(btrim(p_description), '');
  member_ids uuid[];
  member_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_organization_id is null
    or p_kind is null or length(clean_name) not between 1 and 120
    or length(coalesce(clean_description, '')) > 1000
    or array_position(coalesce(p_member_ids, '{}'::uuid[]), null) is not null then
    raise exception 'Channel input is invalid' using errcode = '22023';
  end if;
  if not public.can_operate_org(p_organization_id) then
    raise exception 'Channel management requires organization operations access'
      using errcode = '42501';
  end if;
  if p_kind = 'location' then
    if p_location_id is null or not exists (
      select 1 from public.locations location
      where location.id = p_location_id
        and location.organization_id = p_organization_id
        and location.is_active
    ) or not public.can_manage_location(p_organization_id, p_location_id) then
      raise exception 'Location channel scope is unavailable' using errcode = '42501';
    end if;
  elsif p_location_id is not null then
    raise exception 'Only location channels may carry a location'
      using errcode = '22023';
  end if;

  select coalesce(array_agg(member order by member), '{}'::uuid[]) into member_ids
  from (
    select distinct unnest(coalesce(p_member_ids, '{}'::uuid[])) as member
  ) normalized;
  if p_kind = 'private' then
    if not actor_id = any(member_ids) then
      member_ids := array_append(member_ids, actor_id);
      select array_agg(member order by member) into member_ids
      from unnest(member_ids) member;
    end if;
    if cardinality(member_ids) not between 2 and 100
      or (select count(*) from public.organization_memberships membership
          where membership.organization_id = p_organization_id
            and membership.status = 'active'
            and membership.user_id = any(member_ids)) <> cardinality(member_ids) then
      raise exception 'Private channel members must be active tenant users'
        using errcode = '23514';
    end if;
  elsif cardinality(member_ids) <> 0 then
    raise exception 'Canonical channels derive membership from tenant scope'
      using errcode = '22023';
  end if;

  select * into channel_row
  from public.chat_channels channel
  where channel.id = p_request_id;
  if channel_row.id is not null then
    if not private.claim_operation_request(
      p_request_id,
      'chat.channel.create',
      p_organization_id,
      p_location_id,
      channel_row.id,
      jsonb_build_object(
        'kind', p_kind,
        'name', clean_name,
        'description', clean_description,
        'member_ids', to_jsonb(member_ids)
      )
    ) then return channel_row; end if;
    raise exception 'Channel create request collides with an existing channel'
      using errcode = '23505';
  end if;

  if p_kind in ('all_staff', 'management', 'location') then
    perform pg_advisory_xact_lock(hashtextextended(
      'canonical-chat-channel:' || p_organization_id::text || ':' || p_kind::text
        || ':' || coalesce(p_location_id::text, 'global'),
      0
    ));
    select * into canonical_row
    from public.chat_channels channel
    where channel.organization_id = p_organization_id
      and channel.kind = p_kind
      and channel.location_id is not distinct from p_location_id
    order by channel.created_at, channel.id
    limit 1;
    if canonical_row.id is not null then
      raise exception 'A canonical channel already exists for this scope'
        using errcode = '23505';
    end if;
  end if;

  if not private.claim_operation_request(
    p_request_id,
    'chat.channel.create',
    p_organization_id,
    p_location_id,
    p_request_id,
    jsonb_build_object(
      'kind', p_kind,
      'name', clean_name,
      'description', clean_description,
      'member_ids', to_jsonb(member_ids)
    )
  ) then
    select * into channel_row from public.chat_channels channel
    where channel.id = p_request_id;
    if channel_row.id is not null then return channel_row; end if;
    raise exception 'Channel create request has no result row' using errcode = '40001';
  end if;
  insert into public.chat_channels (
    id, organization_id, location_id, kind, name, description, created_by
  ) values (
    p_request_id, p_organization_id, p_location_id, p_kind,
    clean_name, clean_description, actor_id
  ) returning * into channel_row;
  if p_kind = 'private' then
    foreach member_id in array member_ids loop
      insert into public.chat_channel_members (
        organization_id, channel_id, user_id
      ) values (
        p_organization_id, channel_row.id, member_id
      );
    end loop;
  end if;
  perform private.complete_operation_request(p_request_id);
  return channel_row;
end
$$;

create function public.set_chat_channel_archived(
  p_request_id uuid,
  p_channel_id uuid,
  p_archived boolean
)
returns public.chat_channels
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  channel_row public.chat_channels%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_archived is null then
    raise exception 'Archive state is required' using errcode = '22023';
  end if;
  select * into channel_row
  from public.chat_channels channel
  where channel.id = p_channel_id
  for update;
  if channel_row.id is null then
    raise exception 'Channel not found' using errcode = 'P0002';
  end if;
  if not public.can_operate_org(channel_row.organization_id)
    or (channel_row.location_id is not null and not public.can_manage_location(
      channel_row.organization_id, channel_row.location_id
    )) then
    raise exception 'Channel archive requires management access'
      using errcode = '42501';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'chat.channel.archive',
    channel_row.organization_id,
    channel_row.location_id,
    channel_row.id,
    jsonb_build_object('archived', p_archived)
  ) then return channel_row; end if;
  update public.chat_channels channel_update
  set is_archived = p_archived,
      updated_at = clock_timestamp()
  where channel_update.id = channel_row.id
  returning * into channel_row;
  perform private.complete_operation_request(p_request_id);
  return channel_row;
end
$$;

create function public.set_private_chat_channel_members(
  p_request_id uuid,
  p_channel_id uuid,
  p_member_ids uuid[]
)
returns public.chat_channels
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  channel_row public.chat_channels%rowtype;
  member_ids uuid[];
  member_id uuid;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if array_position(coalesce(p_member_ids, '{}'::uuid[]), null) is not null then
    raise exception 'Private channel members are invalid' using errcode = '22023';
  end if;
  select * into channel_row
  from public.chat_channels channel
  where channel.id = p_channel_id
  for update;
  if channel_row.id is null then
    raise exception 'Channel not found' using errcode = 'P0002';
  end if;
  if channel_row.kind <> 'private' or channel_row.is_archived
    or not public.can_operate_org(channel_row.organization_id) then
    raise exception 'Private channel membership is unavailable'
      using errcode = '42501';
  end if;
  select coalesce(array_agg(member order by member), '{}'::uuid[]) into member_ids
  from (
    select distinct unnest(coalesce(p_member_ids, '{}'::uuid[])) as member
  ) normalized;
  if not actor_id = any(member_ids) then
    member_ids := array_append(member_ids, actor_id);
    select array_agg(member order by member) into member_ids
    from unnest(member_ids) member;
  end if;
  if cardinality(member_ids) not between 2 and 100
    or (select count(*) from public.organization_memberships membership
        where membership.organization_id = channel_row.organization_id
          and membership.status = 'active'
          and membership.user_id = any(member_ids)) <> cardinality(member_ids) then
    raise exception 'Private channel members must be active tenant users'
      using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'chat.channel.members.set',
    channel_row.organization_id,
    null,
    channel_row.id,
    jsonb_build_object('member_ids', to_jsonb(member_ids))
  ) then return channel_row; end if;
  delete from public.chat_channel_members membership
  where membership.channel_id = channel_row.id;
  foreach member_id in array member_ids loop
    insert into public.chat_channel_members (
      organization_id, channel_id, user_id
    ) values (
      channel_row.organization_id, channel_row.id, member_id
    );
  end loop;
  update public.chat_channels channel_update
  set updated_at = clock_timestamp()
  where channel_update.id = channel_row.id
  returning * into channel_row;
  perform private.complete_operation_request(p_request_id);
  return channel_row;
end
$$;

revoke insert, update, delete on public.chat_channels from authenticated;
revoke insert, update, delete on public.chat_channel_members from authenticated;
revoke all on function public.create_chat_channel(
  uuid, uuid, public.channel_kind, uuid, text, text, uuid[]
) from public;
revoke all on function public.set_chat_channel_archived(uuid, uuid, boolean) from public;
revoke all on function public.set_private_chat_channel_members(uuid, uuid, uuid[]) from public;
grant execute on function public.create_chat_channel(
  uuid, uuid, public.channel_kind, uuid, text, text, uuid[]
) to authenticated;
grant execute on function public.set_chat_channel_archived(uuid, uuid, boolean) to authenticated;
grant execute on function public.set_private_chat_channel_members(uuid, uuid, uuid[]) to authenticated;

comment on function public.create_chat_channel(
  uuid, uuid, public.channel_kind, uuid, text, text, uuid[]
)
is 'Creates one actor-stamped tenant channel, validates private membership, and serializes canonical channel scope.';

-- Owner/Admin expense category configuration --------------------------------

create function public.save_expense_category(
  p_request_id uuid,
  p_organization_id uuid,
  p_category_id uuid,
  p_name text,
  p_accounting_code text default null
)
returns public.expense_categories
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  target_id uuid := coalesce(p_category_id, p_request_id);
  category_row public.expense_categories%rowtype;
  clean_name text := btrim(coalesce(p_name, ''));
  clean_code text := nullif(btrim(p_accounting_code), '');
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_organization_id is null
    or length(clean_name) not between 1 and 120
    or length(coalesce(clean_code, '')) > 64 then
    raise exception 'Expense category input is invalid' using errcode = '22023';
  end if;
  if not public.can_manage_org(p_organization_id) then
    raise exception 'Expense categories require Owner or Admin access'
      using errcode = '42501';
  end if;
  select * into category_row
  from public.expense_categories category
  where category.id = target_id
  for update;
  if category_row.id is not null and category_row.organization_id <> p_organization_id then
    raise exception 'Expense category is outside this tenant' using errcode = '42501';
  end if;
  if exists (
    select 1 from public.expense_categories category
    where category.organization_id = p_organization_id
      and lower(category.name) = lower(clean_name)
      and category.id <> target_id
  ) then
    raise exception 'An expense category with this name already exists'
      using errcode = '23505';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'expense-category.save',
    p_organization_id,
    null,
    target_id,
    jsonb_build_object(
      'category_id', p_category_id,
      'name', clean_name,
      'accounting_code', clean_code
    )
  ) then
    select * into category_row from public.expense_categories category
    where category.id = target_id;
    if category_row.id is not null then return category_row; end if;
    raise exception 'Expense category request has no result row' using errcode = '40001';
  end if;
  if category_row.id is null then
    insert into public.expense_categories (
      id, organization_id, name, accounting_code, is_active
    ) values (
      target_id, p_organization_id, clean_name, clean_code, true
    ) returning * into category_row;
  else
    update public.expense_categories category_update
    set name = clean_name,
        accounting_code = clean_code
    where category_update.id = target_id
    returning * into category_row;
  end if;
  perform private.complete_operation_request(p_request_id);
  return category_row;
end
$$;

create function public.set_expense_category_active(
  p_request_id uuid,
  p_category_id uuid,
  p_active boolean
)
returns public.expense_categories
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  category_row public.expense_categories%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_active is null then
    raise exception 'Expense category state is required' using errcode = '22023';
  end if;
  select * into category_row
  from public.expense_categories category
  where category.id = p_category_id
  for update;
  if category_row.id is null then
    raise exception 'Expense category not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_org(category_row.organization_id) then
    raise exception 'Expense categories require Owner or Admin access'
      using errcode = '42501';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'expense-category.active.set',
    category_row.organization_id,
    null,
    category_row.id,
    jsonb_build_object('active', p_active)
  ) then return category_row; end if;
  update public.expense_categories category_update
  set is_active = p_active
  where category_update.id = category_row.id
  returning * into category_row;
  perform private.complete_operation_request(p_request_id);
  return category_row;
end
$$;

revoke insert, update, delete on public.expense_categories from authenticated;
revoke all on function public.save_expense_category(uuid, uuid, uuid, text, text) from public;
revoke all on function public.set_expense_category_active(uuid, uuid, boolean) from public;
grant execute on function public.save_expense_category(uuid, uuid, uuid, text, text) to authenticated;
grant execute on function public.set_expense_category_active(uuid, uuid, boolean) to authenticated;

comment on function public.save_expense_category(uuid, uuid, uuid, text, text)
is 'Owner/Admin idempotent category create/update command; actor and tenant are derived from the authenticated session.';
comment on function public.set_expense_category_active(uuid, uuid, boolean)
is 'Owner/Admin idempotent category activation command. Categories are deactivated rather than deleted.';

-- Freeze helper and trigger execution boundaries after replacements.
revoke all on function public.guard_receipt_duplicate_resolution()
from public, anon, authenticated;
revoke all on function private.claim_operation_request(uuid, text, uuid, uuid, uuid, jsonb)
from public, anon, authenticated;
revoke all on function private.complete_operation_request(uuid)
from public, anon, authenticated;
