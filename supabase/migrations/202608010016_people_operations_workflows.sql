-- Le Yard OS: actor-derived People Operations commands and private document binding.

create function private.employee_has_location_relationship(
  p_employee_id uuid,
  p_location_id uuid
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.employees employee
    join public.locations location
      on location.organization_id = employee.organization_id
     and location.id = p_location_id
     and location.is_active
    where employee.id = p_employee_id
      and employee.employment_status <> 'terminated'
      and (
        employee.home_location_id = location.id
        or exists (
          select 1
          from public.employee_job_roles assignment
          where assignment.organization_id = employee.organization_id
            and assignment.employee_id = employee.id
            and assignment.location_id = location.id
        )
        or (
          employee.user_id is not null
          and exists (
            select 1
            from public.location_memberships membership
            where membership.organization_id = employee.organization_id
              and membership.location_id = location.id
              and membership.user_id = employee.user_id
          )
        )
      )
  )
$$;

revoke all on function private.employee_has_location_relationship(uuid, uuid)
from public, anon, authenticated;

create function public.save_availability_rule(
  p_request_id uuid,
  p_employee_id uuid,
  p_rule_id uuid,
  p_location_id uuid,
  p_weekday smallint,
  p_available_from time,
  p_available_until time,
  p_is_available boolean,
  p_effective_from date,
  p_effective_to date,
  p_notes text default null
)
returns public.availability_rules
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  employee_row public.employees%rowtype;
  rule_row public.availability_rules%rowtype;
  result_id uuid := coalesce(p_rule_id, p_request_id);
  operation_kind text := case
    when p_rule_id is null then 'people.availability.create'
    else 'people.availability.update'
  end;
  actor_is_self boolean;
  actor_can_manage boolean;
  clean_notes text := nullif(btrim(p_notes), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_weekday is null
    or p_weekday not between 0 and 6
    or p_is_available is null
    or p_effective_from is null
    or (p_effective_to is not null and p_effective_to < p_effective_from)
    or (p_is_available and (p_available_from is null or p_available_until is null))
    or (not p_is_available and (p_available_from is not null or p_available_until is not null))
    or length(coalesce(clean_notes, '')) > 2000 then
    raise exception 'Invalid availability payload' using errcode = '22023';
  end if;

  select * into employee_row
  from public.employees employee
  where employee.id = p_employee_id
    and employee.employment_status <> 'terminated';
  if employee_row.id is null then
    raise exception 'Active employee not found' using errcode = 'P0002';
  end if;
  actor_is_self := employee_row.user_id is not distinct from actor_id;
  actor_can_manage := public.can_operate_employee(employee_row.id);
  if not actor_is_self and not actor_can_manage then
    raise exception 'Not authorized to manage this availability' using errcode = '42501';
  end if;

  if p_location_id is null then
    if not actor_is_self and not public.can_manage_org(employee_row.organization_id) then
      raise exception 'Organization-wide availability requires organization management'
        using errcode = '42501';
    end if;
  elsif not private.employee_has_location_relationship(employee_row.id, p_location_id)
    or (
      actor_is_self
      and not public.can_access_location(employee_row.organization_id, p_location_id)
    )
    or (
      not actor_is_self
      and not public.can_manage_location(employee_row.organization_id, p_location_id)
    ) then
    raise exception 'Availability location is unavailable' using errcode = '42501';
  end if;

  if p_rule_id is not null then
    select * into rule_row
    from public.availability_rules rule
    where rule.organization_id = employee_row.organization_id
      and rule.employee_id = employee_row.id
      and rule.id = p_rule_id
    for update;
    if rule_row.id is null then
      raise exception 'Availability rule not found' using errcode = 'P0002';
    end if;
  end if;

  if not private.claim_operation_request(
    p_request_id,
    operation_kind,
    employee_row.organization_id,
    p_location_id,
    result_id,
    jsonb_build_object(
      'employee_id', employee_row.id,
      'rule_id', p_rule_id,
      'weekday', p_weekday,
      'available_from', p_available_from,
      'available_until', p_available_until,
      'is_available', p_is_available,
      'effective_from', p_effective_from,
      'effective_to', p_effective_to,
      'notes', clean_notes
    )
  ) then
    select * into rule_row
    from public.availability_rules rule
    where rule.organization_id = employee_row.organization_id
      and rule.employee_id = employee_row.id
      and rule.id = result_id;
    if rule_row.id is not null then return rule_row; end if;
    raise exception 'Availability request has no result row' using errcode = '40001';
  end if;

  if p_rule_id is null then
    insert into public.availability_rules (
      id, organization_id, employee_id, location_id, weekday,
      available_from, available_until, is_available,
      effective_from, effective_to, notes, created_at, updated_at
    ) values (
      p_request_id, employee_row.organization_id, employee_row.id, p_location_id,
      p_weekday, p_available_from, p_available_until, p_is_available,
      p_effective_from, p_effective_to, clean_notes,
      clock_timestamp(), clock_timestamp()
    ) returning * into rule_row;
  else
    update public.availability_rules rule
    set location_id = p_location_id,
        weekday = p_weekday,
        available_from = p_available_from,
        available_until = p_available_until,
        is_available = p_is_available,
        effective_from = p_effective_from,
        effective_to = p_effective_to,
        notes = clean_notes,
        updated_at = clock_timestamp()
    where rule.id = rule_row.id
    returning * into rule_row;
  end if;
  perform private.complete_operation_request(p_request_id);
  return rule_row;
end
$$;

create function public.delete_availability_rule(
  p_request_id uuid,
  p_rule_id uuid
)
returns uuid
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  rule_row public.availability_rules%rowtype;
  employee_row public.employees%rowtype;
  actor_is_self boolean;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into rule_row
  from public.availability_rules rule
  where rule.id = p_rule_id
  for update;
  if rule_row.id is null then
    select record_id into p_rule_id
    from private.operation_requests request
    where request.request_id = p_request_id
      and request.operation_kind = 'people.availability.delete'
      and request.actor_id = actor_id
      and request.completed_at is not null;
    if p_rule_id is not null then return p_rule_id; end if;
    raise exception 'Availability rule not found' using errcode = 'P0002';
  end if;
  select * into employee_row
  from public.employees employee
  where employee.organization_id = rule_row.organization_id
    and employee.id = rule_row.employee_id;
  actor_is_self := employee_row.user_id is not distinct from actor_id;
  if not actor_is_self and not public.can_operate_employee(employee_row.id) then
    raise exception 'Not authorized to delete this availability' using errcode = '42501';
  end if;
  if rule_row.location_id is null then
    if not actor_is_self and not public.can_manage_org(employee_row.organization_id) then
      raise exception 'Organization-wide availability requires organization management'
        using errcode = '42501';
    end if;
  elsif (
    actor_is_self
    and not public.can_access_location(employee_row.organization_id, rule_row.location_id)
  ) or (
    not actor_is_self
    and not public.can_manage_location(employee_row.organization_id, rule_row.location_id)
  ) then
    raise exception 'Availability location is unavailable' using errcode = '42501';
  end if;
  if private.claim_operation_request(
    p_request_id,
    'people.availability.delete',
    rule_row.organization_id,
    rule_row.location_id,
    rule_row.id,
    jsonb_build_object('rule_id', rule_row.id)
  ) then
    delete from public.availability_rules rule where rule.id = rule_row.id;
    perform private.complete_operation_request(p_request_id);
  end if;
  return rule_row.id;
end
$$;

create function public.save_time_off_request(
  p_request_id uuid,
  p_employee_id uuid,
  p_time_off_id uuid,
  p_location_id uuid,
  p_starts_at timestamptz,
  p_ends_at timestamptz,
  p_reason text default null
)
returns public.time_off_requests
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  employee_row public.employees%rowtype;
  request_row public.time_off_requests%rowtype;
  result_id uuid := coalesce(p_time_off_id, p_request_id);
  operation_kind text := case
    when p_time_off_id is null then 'people.time_off.submit'
    else 'people.time_off.edit'
  end;
  clean_reason text := nullif(btrim(p_reason), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_location_id is null
    or p_starts_at is null
    or p_ends_at is null
    or p_ends_at <= p_starts_at
    or p_ends_at - p_starts_at > interval '366 days'
    or length(coalesce(clean_reason, '')) > 2000 then
    raise exception 'Invalid time-off payload' using errcode = '22023';
  end if;
  select * into employee_row
  from public.employees employee
  where employee.id = p_employee_id
    and employee.user_id = actor_id
    and employee.employment_status = 'active';
  if employee_row.id is null then
    raise exception 'Only the active employee may submit this request'
      using errcode = '42501';
  end if;
  if not private.employee_has_location_relationship(employee_row.id, p_location_id)
    or not public.can_access_location(employee_row.organization_id, p_location_id) then
    raise exception 'Time-off location is unavailable' using errcode = '42501';
  end if;

  if p_time_off_id is not null then
    select * into request_row
    from public.time_off_requests request
    where request.organization_id = employee_row.organization_id
      and request.employee_id = employee_row.id
      and request.id = p_time_off_id
    for update;
    if request_row.id is null then
      raise exception 'Time-off request not found' using errcode = 'P0002';
    end if;
    if request_row.status <> 'pending'
      or request_row.decided_by is not null
      or request_row.decided_at is not null then
      raise exception 'Only an undecided pending request can be edited'
        using errcode = '42501';
    end if;
  end if;
  if exists (
    select 1
    from public.time_off_requests other_request
    where other_request.organization_id = employee_row.organization_id
      and other_request.employee_id = employee_row.id
      and other_request.id <> result_id
      and other_request.status in ('pending', 'approved')
      and tstzrange(other_request.starts_at, other_request.ends_at, '[)')
        && tstzrange(p_starts_at, p_ends_at, '[)')
  ) then
    raise exception 'This request overlaps existing pending or approved time off'
      using errcode = '23P01';
  end if;

  if not private.claim_operation_request(
    p_request_id,
    operation_kind,
    employee_row.organization_id,
    p_location_id,
    result_id,
    jsonb_build_object(
      'employee_id', employee_row.id,
      'time_off_id', p_time_off_id,
      'starts_at', p_starts_at,
      'ends_at', p_ends_at,
      'reason', clean_reason
    )
  ) then
    select * into request_row
    from public.time_off_requests request
    where request.organization_id = employee_row.organization_id
      and request.employee_id = employee_row.id
      and request.id = result_id;
    if request_row.id is not null then return request_row; end if;
    raise exception 'Time-off request has no result row' using errcode = '40001';
  end if;

  if p_time_off_id is null then
    insert into public.time_off_requests (
      id, organization_id, employee_id, location_id,
      starts_at, ends_at, reason, status,
      decided_by, decided_at, decision_note, created_at, updated_at
    ) values (
      p_request_id, employee_row.organization_id, employee_row.id, p_location_id,
      p_starts_at, p_ends_at, clean_reason, 'pending',
      null, null, null, clock_timestamp(), clock_timestamp()
    ) returning * into request_row;
  else
    update public.time_off_requests request
    set location_id = p_location_id,
        starts_at = p_starts_at,
        ends_at = p_ends_at,
        reason = clean_reason,
        updated_at = clock_timestamp()
    where request.id = request_row.id
    returning * into request_row;
  end if;
  perform private.complete_operation_request(p_request_id);
  return request_row;
end
$$;

create function public.cancel_time_off_request(
  p_request_id uuid,
  p_time_off_id uuid
)
returns public.time_off_requests
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  request_row public.time_off_requests%rowtype;
  employee_row public.employees%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into request_row
  from public.time_off_requests request
  where request.id = p_time_off_id
  for update;
  if request_row.id is null then
    raise exception 'Time-off request not found' using errcode = 'P0002';
  end if;
  select * into employee_row
  from public.employees employee
  where employee.organization_id = request_row.organization_id
    and employee.id = request_row.employee_id
    and employee.user_id = actor_id;
  if employee_row.id is null then
    raise exception 'Only the employee may cancel this request' using errcode = '42501';
  end if;
  if request_row.status = 'cancelled' then
    if not private.claim_operation_request(
      p_request_id,
      'people.time_off.cancel',
      request_row.organization_id,
      request_row.location_id,
      request_row.id,
      jsonb_build_object('time_off_id', request_row.id)
    ) then
      return request_row;
    end if;
    perform private.complete_operation_request(p_request_id);
    return request_row;
  end if;
  if request_row.status <> 'pending'
    or request_row.decided_by is not null
    or request_row.decided_at is not null then
    raise exception 'Only an undecided pending request can be cancelled'
      using errcode = '42501';
  end if;
  if private.claim_operation_request(
    p_request_id,
    'people.time_off.cancel',
    request_row.organization_id,
    request_row.location_id,
    request_row.id,
    jsonb_build_object('time_off_id', request_row.id)
  ) then
    update public.time_off_requests request
    set status = 'cancelled',
        decided_by = null,
        decided_at = null,
        decision_note = null,
        updated_at = clock_timestamp()
    where request.id = request_row.id
    returning * into request_row;
    perform private.complete_operation_request(p_request_id);
  end if;
  return request_row;
end
$$;

create function public.decide_time_off_request(
  p_request_id uuid,
  p_time_off_id uuid,
  p_approve boolean,
  p_decision_note text default null
)
returns public.time_off_requests
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  request_row public.time_off_requests%rowtype;
  employee_row public.employees%rowtype;
  next_status public.request_status := case when p_approve then 'approved' else 'denied' end;
  clean_note text := nullif(btrim(p_decision_note), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_approve is null
    or length(coalesce(clean_note, '')) > 2000
    or (not p_approve and clean_note is null) then
    raise exception 'Invalid time-off decision payload' using errcode = '22023';
  end if;
  select * into request_row
  from public.time_off_requests request
  where request.id = p_time_off_id
  for update;
  if request_row.id is null then
    raise exception 'Time-off request not found' using errcode = 'P0002';
  end if;
  select * into employee_row
  from public.employees employee
  where employee.organization_id = request_row.organization_id
    and employee.id = request_row.employee_id;
  if employee_row.id is null
    or employee_row.user_id = actor_id
    or not public.can_operate_employee(employee_row.id)
    or request_row.location_id is null
    or not public.can_manage_location(request_row.organization_id, request_row.location_id) then
    raise exception 'Independent location management is required for this decision'
      using errcode = '42501';
  end if;
  if request_row.status in ('approved', 'denied') then
    if request_row.status <> next_status
      or request_row.decided_by <> actor_id
      or request_row.decision_note is distinct from clean_note then
      raise exception 'This time-off request already has a different decision'
        using errcode = '42501';
    end if;
  elsif request_row.status <> 'pending' then
    raise exception 'Only a pending request can be decided' using errcode = '42501';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'people.time_off.decide',
    request_row.organization_id,
    request_row.location_id,
    request_row.id,
    jsonb_build_object(
      'time_off_id', request_row.id,
      'status', next_status,
      'decision_note', clean_note
    )
  ) then
    return request_row;
  end if;
  if request_row.status = 'pending' then
    update public.time_off_requests request
    set status = next_status,
        decided_by = actor_id,
        decided_at = clock_timestamp(),
        decision_note = clean_note,
        updated_at = clock_timestamp()
    where request.id = request_row.id
    returning * into request_row;
  end if;
  perform private.complete_operation_request(p_request_id);
  return request_row;
end
$$;

create function public.save_employee_certification(
  p_request_id uuid,
  p_employee_id uuid,
  p_certification_id uuid,
  p_certification_type text,
  p_issuer text,
  p_credential_number text,
  p_issued_on date,
  p_expires_on date,
  p_verified boolean default false
)
returns public.employee_certifications
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  employee_row public.employees%rowtype;
  certification_row public.employee_certifications%rowtype;
  result_id uuid := coalesce(p_certification_id, p_request_id);
  operation_kind text := case
    when p_certification_id is null then 'people.certification.create'
    else 'people.certification.update'
  end;
  clean_type text := btrim(p_certification_type);
  clean_issuer text := nullif(btrim(p_issuer), '');
  clean_credential text := nullif(btrim(p_credential_number), '');
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if clean_type is null
    or length(clean_type) not between 1 and 240
    or length(coalesce(clean_issuer, '')) > 240
    or length(coalesce(clean_credential, '')) > 240
    or (p_expires_on is not null and p_issued_on is not null and p_expires_on < p_issued_on)
    or p_verified is null then
    raise exception 'Invalid certification payload' using errcode = '22023';
  end if;
  select * into employee_row
  from public.employees employee
  where employee.id = p_employee_id
    and employee.employment_status <> 'terminated';
  if employee_row.id is null or not public.can_operate_employee(employee_row.id) then
    raise exception 'Not authorized to manage this certification' using errcode = '42501';
  end if;
  if p_certification_id is not null then
    select * into certification_row
    from public.employee_certifications certification
    where certification.organization_id = employee_row.organization_id
      and certification.employee_id = employee_row.id
      and certification.id = p_certification_id
    for update;
    if certification_row.id is null then
      raise exception 'Certification not found' using errcode = 'P0002';
    end if;
  end if;
  if not private.claim_operation_request(
    p_request_id,
    operation_kind,
    employee_row.organization_id,
    null,
    result_id,
    jsonb_build_object(
      'employee_id', employee_row.id,
      'certification_id', p_certification_id,
      'certification_type', clean_type,
      'issuer', clean_issuer,
      'credential_number', clean_credential,
      'issued_on', p_issued_on,
      'expires_on', p_expires_on,
      'verified', p_verified
    )
  ) then
    select * into certification_row
    from public.employee_certifications certification
    where certification.organization_id = employee_row.organization_id
      and certification.employee_id = employee_row.id
      and certification.id = result_id;
    if certification_row.id is not null then return certification_row; end if;
    raise exception 'Certification request has no result row' using errcode = '40001';
  end if;
  if p_certification_id is null then
    insert into public.employee_certifications (
      id, organization_id, employee_id, certification_type,
      issuer, credential_number, issued_on, expires_on, document_path,
      verified_by, verified_at, created_at, updated_at
    ) values (
      p_request_id, employee_row.organization_id, employee_row.id, clean_type,
      clean_issuer, clean_credential, p_issued_on, p_expires_on, null,
      case when p_verified then actor_id else null end,
      case when p_verified then clock_timestamp() else null end,
      clock_timestamp(), clock_timestamp()
    ) returning * into certification_row;
  else
    update public.employee_certifications certification
    set certification_type = clean_type,
        issuer = clean_issuer,
        credential_number = clean_credential,
        issued_on = p_issued_on,
        expires_on = p_expires_on,
        verified_by = case when p_verified then actor_id else null end,
        verified_at = case
          when p_verified and certification.verified_at is not null
            then certification.verified_at
          when p_verified then clock_timestamp()
          else null
        end,
        updated_at = clock_timestamp()
    where certification.id = certification_row.id
    returning * into certification_row;
  end if;
  perform private.complete_operation_request(p_request_id);
  return certification_row;
end
$$;

create function public.save_employee_emergency_contact(
  p_request_id uuid,
  p_employee_id uuid,
  p_contact_id uuid,
  p_name text,
  p_relationship text,
  p_phone text,
  p_email text,
  p_is_primary boolean default false
)
returns public.employee_emergency_contacts
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  employee_row public.employees%rowtype;
  contact_row public.employee_emergency_contacts%rowtype;
  result_id uuid := coalesce(p_contact_id, p_request_id);
  operation_kind text := case
    when p_contact_id is null then 'people.emergency_contact.create'
    else 'people.emergency_contact.update'
  end;
  clean_name text := btrim(p_name);
  clean_relationship text := nullif(btrim(p_relationship), '');
  clean_phone text := btrim(p_phone);
  clean_email text := lower(nullif(btrim(p_email), ''));
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if clean_name is null
    or length(clean_name) not between 1 and 240
    or length(coalesce(clean_relationship, '')) > 120
    or clean_phone is null
    or length(clean_phone) not between 7 and 80
    or length(regexp_replace(clean_phone, '[^0-9]', '', 'g')) not between 7 and 20
    or length(coalesce(clean_email, '')) > 320
    or (clean_email is not null and clean_email !~ '^[^@[:space:]]+@[^@[:space:]]+$')
    or p_is_primary is null then
    raise exception 'Invalid emergency contact payload' using errcode = '22023';
  end if;
  select * into employee_row
  from public.employees employee
  where employee.id = p_employee_id
    and employee.employment_status <> 'terminated';
  if employee_row.id is null
    or (
      employee_row.user_id is distinct from actor_id
      and not public.can_operate_employee(employee_row.id)
    ) then
    raise exception 'Not authorized to manage this emergency contact'
      using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(
    'employee-emergency-contact:' || employee_row.id::text,
    0
  ));
  if p_contact_id is not null then
    select * into contact_row
    from public.employee_emergency_contacts contact
    where contact.organization_id = employee_row.organization_id
      and contact.employee_id = employee_row.id
      and contact.id = p_contact_id
    for update;
    if contact_row.id is null then
      raise exception 'Emergency contact not found' using errcode = 'P0002';
    end if;
  end if;
  if not private.claim_operation_request(
    p_request_id,
    operation_kind,
    employee_row.organization_id,
    null,
    result_id,
    jsonb_build_object(
      'employee_id', employee_row.id,
      'contact_id', p_contact_id,
      'name', clean_name,
      'relationship', clean_relationship,
      'phone', clean_phone,
      'email', clean_email,
      'is_primary', p_is_primary
    )
  ) then
    select * into contact_row
    from public.employee_emergency_contacts contact
    where contact.organization_id = employee_row.organization_id
      and contact.employee_id = employee_row.id
      and contact.id = result_id;
    if contact_row.id is not null then return contact_row; end if;
    raise exception 'Emergency contact request has no result row' using errcode = '40001';
  end if;
  if p_is_primary then
    update public.employee_emergency_contacts other_contact
    set is_primary = false,
        updated_at = clock_timestamp()
    where other_contact.organization_id = employee_row.organization_id
      and other_contact.employee_id = employee_row.id
      and other_contact.id <> result_id
      and other_contact.is_primary;
  end if;
  if p_contact_id is null then
    insert into public.employee_emergency_contacts (
      id, organization_id, employee_id, name, relationship,
      phone, email, is_primary, created_at, updated_at
    ) values (
      p_request_id, employee_row.organization_id, employee_row.id,
      clean_name, clean_relationship, clean_phone, clean_email,
      p_is_primary, clock_timestamp(), clock_timestamp()
    ) returning * into contact_row;
  else
    update public.employee_emergency_contacts contact
    set name = clean_name,
        relationship = clean_relationship,
        phone = clean_phone,
        email = clean_email,
        is_primary = p_is_primary,
        updated_at = clock_timestamp()
    where contact.id = contact_row.id
    returning * into contact_row;
  end if;
  perform private.complete_operation_request(p_request_id);
  return contact_row;
end
$$;

create function public.finalize_employee_document(
  p_request_id uuid,
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
  actor_id uuid := auth.uid();
  employee_row public.employees%rowtype;
  document_row public.employee_documents%rowtype;
  object_row storage.objects%rowtype;
  clean_type text := btrim(p_document_type);
  clean_title text := btrim(p_title);
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_location_id is null
    or clean_type is null
    or length(clean_type) not between 1 and 120
    or clean_title is null
    or length(clean_title) not between 1 and 240
    or p_mime_type not in ('application/pdf', 'image/jpeg', 'image/png', 'image/webp')
    or p_size_bytes is null
    or p_size_bytes not between 1 and 26214400
    or p_is_employee_visible is null
    or not public.storage_path_scope_is_valid(p_storage_path)
    or cardinality(string_to_array(p_storage_path, '/')) <> 5
    or public.storage_location_id(p_storage_path) is distinct from p_location_id
    or split_part(p_storage_path, '/', 3) <> 'employee-documents'
    or split_part(p_storage_path, '/', 4) <> p_employee_id::text
    or split_part(p_storage_path, '/', 5) not like p_request_id::text || '-%' then
    raise exception 'Invalid employee document payload' using errcode = '22023';
  end if;
  select * into employee_row
  from public.employees employee
  where employee.id = p_employee_id
    and employee.employment_status <> 'terminated';
  if employee_row.id is null
    or public.storage_organization_id(p_storage_path) is distinct from employee_row.organization_id
    or not public.can_operate_employee(employee_row.id)
    or not public.can_manage_location(employee_row.organization_id, p_location_id)
    or not private.employee_has_location_relationship(employee_row.id, p_location_id) then
    raise exception 'Not authorized to attach this employee document'
      using errcode = '42501';
  end if;
  select * into object_row
  from storage.objects object
  where object.bucket_id = 'employee-documents'
    and object.name = p_storage_path
    and object.owner_id = actor_id::text;
  if object_row.id is null then
    raise exception 'The private employee document object is missing or not owned by this actor'
      using errcode = '23514';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'people.employee_document.finalize',
    employee_row.organization_id,
    p_location_id,
    p_request_id,
    jsonb_build_object(
      'employee_id', employee_row.id,
      'storage_path', p_storage_path,
      'document_type', clean_type,
      'title', clean_title,
      'mime_type', p_mime_type,
      'size_bytes', p_size_bytes,
      'is_employee_visible', p_is_employee_visible
    )
  ) then
    select * into document_row
    from public.employee_documents document
    where document.organization_id = employee_row.organization_id
      and document.employee_id = employee_row.id
      and document.id = p_request_id;
    if document_row.id is not null then return document_row; end if;
    raise exception 'Employee document request has no result row' using errcode = '40001';
  end if;
  insert into public.employee_documents (
    id, organization_id, employee_id, document_type, title,
    storage_path, mime_type, size_bytes, is_employee_visible,
    uploaded_by, created_at
  ) values (
    p_request_id, employee_row.organization_id, employee_row.id,
    clean_type, clean_title, p_storage_path, p_mime_type, p_size_bytes,
    p_is_employee_visible, actor_id, clock_timestamp()
  ) returning * into document_row;
  perform private.complete_operation_request(p_request_id);
  return document_row;
end
$$;

create function public.update_employee_document_metadata(
  p_request_id uuid,
  p_document_id uuid,
  p_document_type text,
  p_title text,
  p_is_employee_visible boolean
)
returns public.employee_documents
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  document_row public.employee_documents%rowtype;
  clean_type text := btrim(p_document_type);
  clean_title text := btrim(p_title);
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if clean_type is null
    or length(clean_type) not between 1 and 120
    or clean_title is null
    or length(clean_title) not between 1 and 240
    or p_is_employee_visible is null then
    raise exception 'Invalid employee document metadata' using errcode = '22023';
  end if;
  select * into document_row
  from public.employee_documents document
  where document.id = p_document_id
  for update;
  if document_row.id is null then
    raise exception 'Employee document not found' using errcode = 'P0002';
  end if;
  if not public.can_operate_employee(document_row.employee_id)
    or not public.can_manage_storage_scope(document_row.storage_path) then
    raise exception 'Not authorized to update this employee document'
      using errcode = '42501';
  end if;
  if not private.claim_operation_request(
    p_request_id,
    'people.employee_document.metadata',
    document_row.organization_id,
    public.storage_location_id(document_row.storage_path),
    document_row.id,
    jsonb_build_object(
      'document_id', document_row.id,
      'document_type', clean_type,
      'title', clean_title,
      'is_employee_visible', p_is_employee_visible
    )
  ) then
    return document_row;
  end if;
  update public.employee_documents document
  set document_type = clean_type,
      title = clean_title,
      is_employee_visible = p_is_employee_visible
  where document.id = document_row.id
  returning * into document_row;
  perform private.complete_operation_request(p_request_id);
  return document_row;
end
$$;

create function private.notify_time_off_decision()
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
      and employee.id = new.employee_id;
    perform private.emit_derived_notification(
      new.organization_id,
      recipient_user_id,
      'time-off.decided:' || new.id::text || ':' || new.status::text,
      'time_off_decided',
      case when new.status = 'approved' then 'Time off approved' else 'Time off declined' end,
      case
        when new.status = 'approved' then 'Your time-off request was approved.'
        else 'Your time-off request was declined.'
      end,
      '/team',
      'time_off_request',
      new.id
    );
  end if;
  return new;
end
$$;

create trigger time_off_decision_notification
after update on public.time_off_requests
for each row execute function private.notify_time_off_decision();

-- The uploader may verify a not-yet-bound object. Once employee_documents is
-- inserted, the existing employee/management read policy becomes authoritative.
create policy storage_employee_document_staged_read
on storage.objects for select to authenticated
using (
  bucket_id = 'employee-documents'
  and owner_id = auth.uid()::text
  and public.storage_path_scope_is_valid(name)
  and public.can_manage_storage_scope(name)
  and not exists (
    select 1
    from public.employee_documents document
    where document.organization_id = public.storage_organization_id(name)
      and document.storage_path = name
  )
);

-- Every authenticated mutation now flows through the commands above. This
-- makes actor stamps, idempotency, self/manager separation, and private-file
-- binding unavoidable for browser clients.
revoke insert, update, delete on public.availability_rules from authenticated;
revoke insert, update, delete on public.time_off_requests from authenticated;
revoke insert, update, delete on public.employee_certifications from authenticated;
revoke insert, update, delete on public.employee_emergency_contacts from authenticated;
revoke insert, update, delete on public.employee_documents from authenticated;

revoke all on function public.save_availability_rule(uuid, uuid, uuid, uuid, smallint, time, time, boolean, date, date, text) from public;
revoke all on function public.delete_availability_rule(uuid, uuid) from public;
revoke all on function public.save_time_off_request(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) from public;
revoke all on function public.cancel_time_off_request(uuid, uuid) from public;
revoke all on function public.decide_time_off_request(uuid, uuid, boolean, text) from public;
revoke all on function public.save_employee_certification(uuid, uuid, uuid, text, text, text, date, date, boolean) from public;
revoke all on function public.save_employee_emergency_contact(uuid, uuid, uuid, text, text, text, text, boolean) from public;
revoke all on function public.finalize_employee_document(uuid, uuid, uuid, text, text, text, text, bigint, boolean) from public;
revoke all on function public.update_employee_document_metadata(uuid, uuid, text, text, boolean) from public;
revoke all on function private.notify_time_off_decision() from public, anon, authenticated;

grant execute on function public.save_availability_rule(uuid, uuid, uuid, uuid, smallint, time, time, boolean, date, date, text) to authenticated;
grant execute on function public.delete_availability_rule(uuid, uuid) to authenticated;
grant execute on function public.save_time_off_request(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) to authenticated;
grant execute on function public.cancel_time_off_request(uuid, uuid) to authenticated;
grant execute on function public.decide_time_off_request(uuid, uuid, boolean, text) to authenticated;
grant execute on function public.save_employee_certification(uuid, uuid, uuid, text, text, text, date, date, boolean) to authenticated;
grant execute on function public.save_employee_emergency_contact(uuid, uuid, uuid, text, text, text, text, boolean) to authenticated;
grant execute on function public.finalize_employee_document(uuid, uuid, uuid, text, text, text, text, bigint, boolean) to authenticated;
grant execute on function public.update_employee_document_metadata(uuid, uuid, text, text, boolean) to authenticated;

comment on function public.save_availability_rule(uuid, uuid, uuid, uuid, smallint, time, time, boolean, date, date, text)
is 'Idempotently creates or updates self/management availability within employee and location scope.';
comment on function public.save_time_off_request(uuid, uuid, uuid, uuid, timestamptz, timestamptz, text)
is 'Idempotently submits or edits an undecided time-off request for the authenticated employee.';
comment on function public.decide_time_off_request(uuid, uuid, boolean, text)
is 'Records an actor-stamped independent management decision on pending location time off.';
comment on function public.finalize_employee_document(uuid, uuid, uuid, text, text, text, text, bigint, boolean)
is 'Binds a manager-owned private storage object to an employee with validated tenant/location metadata.';
