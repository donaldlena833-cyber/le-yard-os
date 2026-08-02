-- Le Yard OS: scoped People reads, command-only role configuration, and
-- service-bound employee document finalization.

-- Employee-level management visibility must not make every availability or
-- leave row visible. Managers receive only rows explicitly scoped to one of
-- their locations; the employee and organization-wide Owner/Admin reads stay
-- intact.
drop policy availability_read on public.availability_rules;
create policy availability_read
on public.availability_rules for select to authenticated
using (
  public.is_self_employee(employee_id)
  or public.has_org_role(
    organization_id,
    array['owner'::public.app_role, 'admin'::public.app_role]
  )
  or (
    location_id is not null
    and public.can_read_management_location(organization_id, location_id)
  )
);

drop policy time_off_read on public.time_off_requests;
create policy time_off_read
on public.time_off_requests for select to authenticated
using (
  public.is_self_employee(employee_id)
  or public.has_org_role(
    organization_id,
    array['owner'::public.app_role, 'admin'::public.app_role]
  )
  or (
    location_id is not null
    and public.can_read_management_location(organization_id, location_id)
  )
);

-- The app intentionally supports only these four employee-document formats.
-- Storage rejects anything broader before the server performs its independent
-- byte-signature check.
update storage.buckets
set public = false,
    file_size_limit = 26214400,
    allowed_mime_types = array[
      'application/pdf',
      'image/jpeg',
      'image/png',
      'image/webp'
    ]::text[]
where id = 'employee-documents';

-- Browser callers can no longer bind an employee document by claiming MIME
-- and size metadata. The user-scoped server workflow downloads and verifies
-- the bytes, then this service-only wrapper re-establishes the exact actor JWT
-- for the existing fully-authorized/idempotent binder and immutable audit.
revoke execute on function public.finalize_employee_document(
  uuid, uuid, uuid, text, text, text, text, bigint, boolean
) from public, anon, authenticated;

create function public.service_finalize_employee_document(
  p_request_id uuid,
  p_actor_id uuid,
  p_actor_aal text,
  p_employee_id uuid,
  p_location_id uuid,
  p_storage_path text,
  p_document_type text,
  p_title text,
  p_mime_type text,
  p_size_bytes bigint,
  p_is_employee_visible boolean default true
)
returns public.employee_documents
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  prior_claims text := current_setting('request.jwt.claims', true);
  object_row storage.objects%rowtype;
  document_row public.employee_documents%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role is required for employee document binding'
      using errcode = '42501';
  end if;
  if p_actor_id is null
    or p_actor_aal not in ('aal1', 'aal2')
    or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    or p_size_bytes is null
    or p_size_bytes not between 1 and 26214400 then
    raise exception 'Invalid verified employee document evidence'
      using errcode = '22023';
  end if;

  select * into object_row
  from storage.objects object
  where object.bucket_id = 'employee-documents'
    and object.name = p_storage_path
    and object.owner_id = p_actor_id::text;
  if object_row.id is null then
    raise exception 'Verified employee document object was not found'
      using errcode = '23514';
  end if;
  if object_row.metadata ->> 'mimetype' is distinct from p_mime_type
    or coalesce(object_row.metadata ->> 'size', '') !~ '^[0-9]+$'
    or (object_row.metadata ->> 'size')::bigint is distinct from p_size_bytes then
    raise exception 'Verified employee document metadata does not match storage'
      using errcode = '23514';
  end if;

  perform set_config(
    'request.jwt.claims',
    jsonb_build_object(
      'sub', p_actor_id,
      'role', 'authenticated',
      'aal', p_actor_aal
    )::text,
    true
  );

  select * into document_row
  from public.finalize_employee_document(
    p_request_id,
    p_employee_id,
    p_location_id,
    p_storage_path,
    p_document_type,
    p_title,
    p_mime_type,
    p_size_bytes,
    p_is_employee_visible
  );

  perform set_config(
    'request.jwt.claims',
    coalesce(nullif(prior_claims, ''), '{}'),
    true
  );
  return document_row;
end
$$;

revoke all on function public.service_finalize_employee_document(
  uuid, uuid, text, uuid, uuid, text, text, text, text, bigint, boolean
) from public, anon, authenticated;
grant execute on function public.service_finalize_employee_document(
  uuid, uuid, text, uuid, uuid, text, text, text, text, bigint, boolean
) to service_role;

comment on function public.service_finalize_employee_document(
  uuid, uuid, text, uuid, uuid, text, text, text, text, bigint, boolean
) is 'Service-only employee document binding after user-scoped byte verification; restores the explicit actor for full authorization, idempotency, and audit evidence.';

-- Job-role definitions are organization configuration, not a location-manager
-- operation. Every command derives its actor from Auth and uses the shared
-- immutable operation-request ledger plus table audit triggers.
create function public.create_job_role_definition(
  p_request_id uuid,
  p_organization_id uuid,
  p_name text,
  p_code text,
  p_department text,
  p_color text,
  p_default_tip_points numeric,
  p_is_tipped boolean
)
returns public.job_roles
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  organization_row public.organizations%rowtype;
  role_row public.job_roles%rowtype;
  clean_name text := btrim(p_name);
  clean_code text := upper(btrim(p_code));
  clean_department text := nullif(btrim(p_department), '');
  clean_color text := upper(nullif(btrim(p_color), ''));
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if clean_name is null
    or length(clean_name) not between 1 and 120
    or clean_code is null
    or clean_code !~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'
    or length(coalesce(clean_department, '')) > 120
    or (clean_color is not null and clean_color !~ '^#[0-9A-F]{6}$')
    or p_default_tip_points is null
    or p_default_tip_points < 0
    or p_default_tip_points > 99999.999
    or round(p_default_tip_points, 3) <> p_default_tip_points
    or p_is_tipped is null then
    raise exception 'Invalid job role definition' using errcode = '22023';
  end if;
  select * into organization_row
  from public.organizations organization
  where organization.id = p_organization_id
    and organization.status = 'active';
  if organization_row.id is null or not public.can_manage_org(organization_row.id) then
    raise exception 'Owner or Admin organization access is required'
      using errcode = '42501';
  end if;

  if not private.claim_operation_request(
    p_request_id,
    'people.job_role.create',
    organization_row.id,
    null,
    p_request_id,
    jsonb_build_object(
      'name', clean_name,
      'code', clean_code,
      'department', clean_department,
      'color', clean_color,
      'default_tip_points', p_default_tip_points,
      'is_tipped', p_is_tipped
    )
  ) then
    select * into role_row
    from public.job_roles role
    where role.organization_id = organization_row.id
      and role.id = p_request_id;
    if role_row.id is not null then return role_row; end if;
    raise exception 'Job role request has no result row' using errcode = '40001';
  end if;

  insert into public.job_roles (
    id, organization_id, name, code, department, color,
    default_tip_points, is_tipped, is_active, created_at, updated_at
  ) values (
    p_request_id, organization_row.id, clean_name, clean_code,
    clean_department, clean_color, p_default_tip_points, p_is_tipped,
    true, clock_timestamp(), clock_timestamp()
  ) returning * into role_row;
  perform private.complete_operation_request(p_request_id);
  return role_row;
end
$$;

create function public.update_job_role_definition(
  p_request_id uuid,
  p_job_role_id uuid,
  p_name text,
  p_code text,
  p_department text,
  p_color text,
  p_default_tip_points numeric,
  p_is_tipped boolean
)
returns public.job_roles
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  role_row public.job_roles%rowtype;
  clean_name text := btrim(p_name);
  clean_code text := upper(btrim(p_code));
  clean_department text := nullif(btrim(p_department), '');
  clean_color text := upper(nullif(btrim(p_color), ''));
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if clean_name is null
    or length(clean_name) not between 1 and 120
    or clean_code is null
    or clean_code !~ '^[A-Z0-9][A-Z0-9_-]{0,31}$'
    or length(coalesce(clean_department, '')) > 120
    or (clean_color is not null and clean_color !~ '^#[0-9A-F]{6}$')
    or p_default_tip_points is null
    or p_default_tip_points < 0
    or p_default_tip_points > 99999.999
    or round(p_default_tip_points, 3) <> p_default_tip_points
    or p_is_tipped is null then
    raise exception 'Invalid job role definition' using errcode = '22023';
  end if;
  select * into role_row
  from public.job_roles role
  where role.id = p_job_role_id
  for update;
  if role_row.id is null then
    raise exception 'Job role not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_org(role_row.organization_id) then
    raise exception 'Owner or Admin organization access is required'
      using errcode = '42501';
  end if;

  if not private.claim_operation_request(
    p_request_id,
    'people.job_role.update',
    role_row.organization_id,
    null,
    role_row.id,
    jsonb_build_object(
      'job_role_id', role_row.id,
      'name', clean_name,
      'code', clean_code,
      'department', clean_department,
      'color', clean_color,
      'default_tip_points', p_default_tip_points,
      'is_tipped', p_is_tipped
    )
  ) then
    return role_row;
  end if;

  update public.job_roles role
  set name = clean_name,
      code = clean_code,
      department = clean_department,
      color = clean_color,
      default_tip_points = p_default_tip_points,
      is_tipped = p_is_tipped,
      updated_at = clock_timestamp()
  where role.id = role_row.id
  returning * into role_row;
  perform private.complete_operation_request(p_request_id);
  return role_row;
end
$$;

create function public.deactivate_job_role_definition(
  p_request_id uuid,
  p_job_role_id uuid
)
returns public.job_roles
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  role_row public.job_roles%rowtype;
  organization_timezone text;
  business_date date;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into role_row
  from public.job_roles role
  where role.id = p_job_role_id
  for update;
  if role_row.id is null then
    raise exception 'Job role not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_org(role_row.organization_id) then
    raise exception 'Owner or Admin organization access is required'
      using errcode = '42501';
  end if;
  select organization.timezone into organization_timezone
  from public.organizations organization
  where organization.id = role_row.organization_id;
  business_date := (clock_timestamp() at time zone organization_timezone)::date;
  if exists (
    select 1
    from public.employee_job_roles assignment
    where assignment.organization_id = role_row.organization_id
      and assignment.job_role_id = role_row.id
      and (assignment.effective_to is null or assignment.effective_to >= business_date)
  ) then
    raise exception 'End active and future employee assignments before deactivating this role'
      using errcode = '23514';
  end if;

  if not private.claim_operation_request(
    p_request_id,
    'people.job_role.deactivate',
    role_row.organization_id,
    null,
    role_row.id,
    jsonb_build_object('job_role_id', role_row.id, 'is_active', false)
  ) then
    return role_row;
  end if;
  update public.job_roles role
  set is_active = false,
      updated_at = clock_timestamp()
  where role.id = role_row.id
  returning * into role_row;
  perform private.complete_operation_request(p_request_id);
  return role_row;
end
$$;

create function public.create_employee_job_assignment(
  p_request_id uuid,
  p_employee_id uuid,
  p_job_role_id uuid,
  p_location_id uuid,
  p_hourly_rate_cents integer,
  p_effective_from date,
  p_effective_to date,
  p_is_primary boolean
)
returns public.employee_job_roles
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  employee_row public.employees%rowtype;
  role_row public.job_roles%rowtype;
  location_row public.locations%rowtype;
  assignment_row public.employee_job_roles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_effective_from is null
    or (p_effective_to is not null and p_effective_to < p_effective_from)
    or (p_hourly_rate_cents is not null and p_hourly_rate_cents < 0)
    or p_is_primary is null then
    raise exception 'Invalid employee job assignment' using errcode = '22023';
  end if;
  select * into employee_row
  from public.employees employee
  where employee.id = p_employee_id
    and employee.employment_status <> 'terminated';
  if employee_row.id is null or not public.can_manage_org(employee_row.organization_id) then
    raise exception 'Owner or Admin employee access is required'
      using errcode = '42501';
  end if;
  select * into role_row
  from public.job_roles role
  where role.organization_id = employee_row.organization_id
    and role.id = p_job_role_id
    and role.is_active;
  select * into location_row
  from public.locations location
  where location.organization_id = employee_row.organization_id
    and location.id = p_location_id
    and location.is_active;
  if role_row.id is null or location_row.id is null then
    raise exception 'Active role and location must belong to the employee organization'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.employee_job_roles assignment
    where assignment.organization_id = employee_row.organization_id
      and assignment.employee_id = employee_row.id
      and assignment.job_role_id = role_row.id
      and assignment.location_id = location_row.id
      and assignment.id <> p_request_id
      and daterange(
        assignment.effective_from,
        coalesce(assignment.effective_to, 'infinity'::date),
        '[]'
      ) && daterange(
        p_effective_from,
        coalesce(p_effective_to, 'infinity'::date),
        '[]'
      )
  ) then
    raise exception 'This role assignment overlaps an existing assignment'
      using errcode = '23P01';
  end if;
  if p_is_primary and exists (
    select 1 from public.employee_job_roles assignment
    where assignment.organization_id = employee_row.organization_id
      and assignment.employee_id = employee_row.id
      and assignment.location_id = location_row.id
      and assignment.id <> p_request_id
      and assignment.is_primary
      and daterange(
        assignment.effective_from,
        coalesce(assignment.effective_to, 'infinity'::date),
        '[]'
      ) && daterange(
        p_effective_from,
        coalesce(p_effective_to, 'infinity'::date),
        '[]'
      )
  ) then
    raise exception 'A primary role already covers this employee, location, and date range'
      using errcode = '23P01';
  end if;

  if not private.claim_operation_request(
    p_request_id,
    'people.job_assignment.create',
    employee_row.organization_id,
    location_row.id,
    p_request_id,
    jsonb_build_object(
      'employee_id', employee_row.id,
      'job_role_id', role_row.id,
      'location_id', location_row.id,
      'hourly_rate_cents', p_hourly_rate_cents,
      'effective_from', p_effective_from,
      'effective_to', p_effective_to,
      'is_primary', p_is_primary
    )
  ) then
    select * into assignment_row
    from public.employee_job_roles assignment
    where assignment.organization_id = employee_row.organization_id
      and assignment.id = p_request_id;
    if assignment_row.id is not null then return assignment_row; end if;
    raise exception 'Job assignment request has no result row' using errcode = '40001';
  end if;

  insert into public.employee_job_roles (
    id, organization_id, employee_id, job_role_id, location_id,
    hourly_rate_cents, effective_from, effective_to, is_primary, created_at
  ) values (
    p_request_id, employee_row.organization_id, employee_row.id, role_row.id,
    location_row.id, p_hourly_rate_cents, p_effective_from, p_effective_to,
    p_is_primary, clock_timestamp()
  ) returning * into assignment_row;
  perform private.complete_operation_request(p_request_id);
  return assignment_row;
end
$$;

create function public.update_employee_job_assignment(
  p_request_id uuid,
  p_assignment_id uuid,
  p_job_role_id uuid,
  p_location_id uuid,
  p_set_hourly_rate boolean,
  p_hourly_rate_cents integer,
  p_effective_from date,
  p_effective_to date,
  p_is_primary boolean
)
returns public.employee_job_roles
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  assignment_row public.employee_job_roles%rowtype;
  employee_row public.employees%rowtype;
  role_row public.job_roles%rowtype;
  location_row public.locations%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_effective_from is null
    or (p_effective_to is not null and p_effective_to < p_effective_from)
    or p_set_hourly_rate is null
    or (not p_set_hourly_rate and p_hourly_rate_cents is not null)
    or (p_hourly_rate_cents is not null and p_hourly_rate_cents < 0)
    or p_is_primary is null then
    raise exception 'Invalid employee job assignment' using errcode = '22023';
  end if;
  select * into assignment_row
  from public.employee_job_roles assignment
  where assignment.id = p_assignment_id
  for update;
  if assignment_row.id is null then
    raise exception 'Employee job assignment not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_org(assignment_row.organization_id) then
    raise exception 'Owner or Admin organization access is required'
      using errcode = '42501';
  end if;
  select * into employee_row
  from public.employees employee
  where employee.organization_id = assignment_row.organization_id
    and employee.id = assignment_row.employee_id
    and employee.employment_status <> 'terminated';
  select * into role_row
  from public.job_roles role
  where role.organization_id = assignment_row.organization_id
    and role.id = p_job_role_id
    and role.is_active;
  select * into location_row
  from public.locations location
  where location.organization_id = assignment_row.organization_id
    and location.id = p_location_id
    and location.is_active;
  if employee_row.id is null or role_row.id is null or location_row.id is null then
    raise exception 'Active employee, role, and location must share one organization'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.employee_job_roles assignment
    where assignment.organization_id = assignment_row.organization_id
      and assignment.employee_id = assignment_row.employee_id
      and assignment.job_role_id = role_row.id
      and assignment.location_id = location_row.id
      and assignment.id <> assignment_row.id
      and daterange(
        assignment.effective_from,
        coalesce(assignment.effective_to, 'infinity'::date),
        '[]'
      ) && daterange(
        p_effective_from,
        coalesce(p_effective_to, 'infinity'::date),
        '[]'
      )
  ) then
    raise exception 'This role assignment overlaps an existing assignment'
      using errcode = '23P01';
  end if;
  if p_is_primary and exists (
    select 1 from public.employee_job_roles assignment
    where assignment.organization_id = assignment_row.organization_id
      and assignment.employee_id = assignment_row.employee_id
      and assignment.location_id = location_row.id
      and assignment.id <> assignment_row.id
      and assignment.is_primary
      and daterange(
        assignment.effective_from,
        coalesce(assignment.effective_to, 'infinity'::date),
        '[]'
      ) && daterange(
        p_effective_from,
        coalesce(p_effective_to, 'infinity'::date),
        '[]'
      )
  ) then
    raise exception 'A primary role already covers this employee, location, and date range'
      using errcode = '23P01';
  end if;

  if not private.claim_operation_request(
    p_request_id,
    'people.job_assignment.update',
    assignment_row.organization_id,
    location_row.id,
    assignment_row.id,
    jsonb_build_object(
      'assignment_id', assignment_row.id,
      'job_role_id', role_row.id,
      'location_id', location_row.id,
      'set_hourly_rate', p_set_hourly_rate,
      'hourly_rate_cents', p_hourly_rate_cents,
      'effective_from', p_effective_from,
      'effective_to', p_effective_to,
      'is_primary', p_is_primary
    )
  ) then
    return assignment_row;
  end if;

  update public.employee_job_roles assignment
  set job_role_id = role_row.id,
      location_id = location_row.id,
      hourly_rate_cents = case
        when p_set_hourly_rate then p_hourly_rate_cents
        else assignment.hourly_rate_cents
      end,
      effective_from = p_effective_from,
      effective_to = p_effective_to,
      is_primary = p_is_primary
  where assignment.id = assignment_row.id
  returning * into assignment_row;
  perform private.complete_operation_request(p_request_id);
  return assignment_row;
end
$$;

create function public.end_employee_job_assignment(
  p_request_id uuid,
  p_assignment_id uuid,
  p_effective_to date
)
returns public.employee_job_roles
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  assignment_row public.employee_job_roles%rowtype;
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into assignment_row
  from public.employee_job_roles assignment
  where assignment.id = p_assignment_id
  for update;
  if assignment_row.id is null then
    raise exception 'Employee job assignment not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_org(assignment_row.organization_id) then
    raise exception 'Owner or Admin organization access is required'
      using errcode = '42501';
  end if;
  if p_effective_to is null or p_effective_to < assignment_row.effective_from then
    raise exception 'The assignment end date cannot precede its start date'
      using errcode = '22023';
  end if;
  if exists (
    select 1 from public.employee_job_roles assignment
    where assignment.organization_id = assignment_row.organization_id
      and assignment.employee_id = assignment_row.employee_id
      and assignment.job_role_id = assignment_row.job_role_id
      and assignment.location_id = assignment_row.location_id
      and assignment.id <> assignment_row.id
      and daterange(
        assignment.effective_from,
        coalesce(assignment.effective_to, 'infinity'::date),
        '[]'
      ) && daterange(assignment_row.effective_from, p_effective_to, '[]')
  ) then
    raise exception 'The requested end date overlaps another role assignment'
      using errcode = '23P01';
  end if;
  if assignment_row.is_primary and exists (
    select 1 from public.employee_job_roles assignment
    where assignment.organization_id = assignment_row.organization_id
      and assignment.employee_id = assignment_row.employee_id
      and assignment.location_id = assignment_row.location_id
      and assignment.id <> assignment_row.id
      and assignment.is_primary
      and daterange(
        assignment.effective_from,
        coalesce(assignment.effective_to, 'infinity'::date),
        '[]'
      ) && daterange(assignment_row.effective_from, p_effective_to, '[]')
  ) then
    raise exception 'The requested end date overlaps another primary assignment'
      using errcode = '23P01';
  end if;

  if not private.claim_operation_request(
    p_request_id,
    'people.job_assignment.end',
    assignment_row.organization_id,
    assignment_row.location_id,
    assignment_row.id,
    jsonb_build_object(
      'assignment_id', assignment_row.id,
      'effective_to', p_effective_to
    )
  ) then
    return assignment_row;
  end if;
  update public.employee_job_roles assignment
  set effective_to = p_effective_to
  where assignment.id = assignment_row.id
  returning * into assignment_row;
  perform private.complete_operation_request(p_request_id);
  return assignment_row;
end
$$;

-- Configuration writes are command-only. Hourly rates are never selectable
-- through the exposed table; the commands can preserve, replace, or clear the
-- private value without returning it to the Team read model.
revoke insert, update, delete on public.job_roles from authenticated;
revoke insert, update, delete on public.employee_job_roles from authenticated;
revoke select on public.employee_job_roles from authenticated;
grant select (
  id, organization_id, employee_id, job_role_id, location_id,
  effective_from, effective_to, is_primary, created_at
) on public.employee_job_roles to authenticated;

revoke all on function public.create_job_role_definition(
  uuid, uuid, text, text, text, text, numeric, boolean
) from public, anon;
revoke all on function public.update_job_role_definition(
  uuid, uuid, text, text, text, text, numeric, boolean
) from public, anon;
revoke all on function public.deactivate_job_role_definition(uuid, uuid)
from public, anon;
revoke all on function public.create_employee_job_assignment(
  uuid, uuid, uuid, uuid, integer, date, date, boolean
) from public, anon;
revoke all on function public.update_employee_job_assignment(
  uuid, uuid, uuid, uuid, boolean, integer, date, date, boolean
) from public, anon;
revoke all on function public.end_employee_job_assignment(uuid, uuid, date)
from public, anon;

grant execute on function public.create_job_role_definition(
  uuid, uuid, text, text, text, text, numeric, boolean
) to authenticated;
grant execute on function public.update_job_role_definition(
  uuid, uuid, text, text, text, text, numeric, boolean
) to authenticated;
grant execute on function public.deactivate_job_role_definition(uuid, uuid)
to authenticated;
grant execute on function public.create_employee_job_assignment(
  uuid, uuid, uuid, uuid, integer, date, date, boolean
) to authenticated;
grant execute on function public.update_employee_job_assignment(
  uuid, uuid, uuid, uuid, boolean, integer, date, date, boolean
) to authenticated;
grant execute on function public.end_employee_job_assignment(uuid, uuid, date)
to authenticated;

comment on function public.create_job_role_definition(
  uuid, uuid, text, text, text, text, numeric, boolean
) is 'Idempotently creates an explicit Owner/Admin-configured job role without seeded operational assumptions.';
comment on function public.create_employee_job_assignment(
  uuid, uuid, uuid, uuid, integer, date, date, boolean
) is 'Idempotently binds a verified employee, active job role, and active location with private optional pay-rate evidence.';
