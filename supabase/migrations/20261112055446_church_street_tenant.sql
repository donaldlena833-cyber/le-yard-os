-- Church Street uses the existing organization boundary with a counter-service profile.
create function private.is_counter_service_org(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.organization_settings settings
    where settings.organization_id = p_organization_id
      and settings.feature_flags ->> 'service_model' = 'counter'
  )
$$;

create function private.counter_service_workspace_accessible(
  p_organization_id uuid,
  p_location_id uuid default null
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select not private.is_counter_service_org(p_organization_id) or exists (
    select 1
    from public.organizations organization
    where organization.id = p_organization_id and organization.status = 'active'
      and (
        p_location_id is null or exists (
          select 1 from public.locations location
          where location.organization_id = organization.id
            and location.id = p_location_id and location.is_active
        )
      )
  )
$$;

revoke all on function private.is_counter_service_org(uuid),
  private.counter_service_workspace_accessible(uuid, uuid)
  from public, anon, authenticated;
-- RLS policies execute this predicate by object ID. The private schema stays unexposed.
grant execute on function private.is_counter_service_org(uuid) to authenticated;

create function private.protect_service_model()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then
    if tg_op = 'DELETE' then return old; end if;
    return new;
  end if;

  if tg_op = 'INSERT' then
    if new.feature_flags ? 'service_model' then
      raise exception 'Only deployment administration can set the service model' using errcode = '42501';
    end if;
  elsif tg_op = 'DELETE' then
    if old.feature_flags ? 'service_model' then
      raise exception 'Only deployment administration can remove the service model' using errcode = '42501';
    end if;
    return old;
  elsif (old.feature_flags -> 'service_model') is distinct from (new.feature_flags -> 'service_model')
    or (old.feature_flags ->> 'service_model' = 'counter' and (
      old.organization_id is distinct from new.organization_id
      or old.default_location_id is distinct from new.default_location_id
    )) then
    raise exception 'Only deployment administration can change the service model' using errcode = '42501';
  end if;

  return new;
end
$$;

revoke all on function private.protect_service_model() from public, anon, authenticated;
create trigger protect_service_model
before insert or update or delete on public.organization_settings
for each row execute function private.protect_service_model();

create function private.protect_counter_service_tenant()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role')
    and (new.status is distinct from old.status or new.slug is distinct from old.slug)
    and exists (
      select 1 from public.organization_settings settings
      where settings.organization_id = old.id and settings.feature_flags ->> 'service_model' = 'counter'
    ) then
    raise exception 'Only deployment administration can change counter-service tenant identity or status' using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function private.protect_counter_service_tenant() from public, anon, authenticated;
create trigger protect_counter_service_tenant
before update of status, slug on public.organizations
for each row execute function private.protect_counter_service_tenant();

create function private.protect_counter_service_location()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if current_user not in ('postgres', 'supabase_admin', 'service_role') and exists (
    select 1 from public.organization_settings settings
    where settings.organization_id = old.organization_id and settings.default_location_id = old.id
      and settings.feature_flags ->> 'service_model' = 'counter'
  ) then
    if tg_op = 'DELETE' then
      raise exception 'Only deployment administration can remove the counter-service location' using errcode = '42501';
    end if;
    if new.organization_id is distinct from old.organization_id
      or new.code is distinct from old.code or new.is_active is distinct from old.is_active then
      raise exception 'Only deployment administration can change counter-service location identity or status' using errcode = '42501';
    end if;
  end if;

  if tg_op = 'DELETE' then return old; end if;
  return new;
end
$$;

revoke all on function private.protect_counter_service_location() from public, anon, authenticated;
create trigger protect_counter_service_location
before update of organization_id, code, is_active or delete on public.locations
for each row execute function private.protect_counter_service_location();

create or replace function public.can_access_org(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and private.counter_service_workspace_accessible(p_organization_id)
  )
$$;

create or replace function public.has_org_role(
  p_organization_id uuid,
  p_roles public.app_role[]
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = auth.uid()
      and membership.status = 'active'
      and private.counter_service_workspace_accessible(p_organization_id)
      and membership.role = any(p_roles)
  )
$$;

create or replace function public.can_access_location(
  p_organization_id uuid,
  p_location_id uuid
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.organization_memberships organization_membership
    where organization_membership.organization_id = p_organization_id
      and organization_membership.user_id = auth.uid()
      and organization_membership.status = 'active'
      and private.counter_service_workspace_accessible(p_organization_id, p_location_id)
      and (
        organization_membership.role in ('owner', 'admin')
        or (
          organization_membership.role in ('manager', 'employee')
          and exists (
            select 1
            from public.location_memberships location_membership
            where location_membership.organization_id = p_organization_id
              and location_membership.location_id = p_location_id
              and location_membership.user_id = auth.uid()
          )
        )
      )
  )
$$;

CREATE OR REPLACE FUNCTION public.can_manage_org(p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
  select exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = p_organization_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and private.counter_service_workspace_accessible(p_organization_id)
        and membership.role in ('owner', 'admin')
    )
$function$;

create or replace function public.org_role(p_organization_id uuid)
returns public.app_role
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select m.role from public.organization_memberships m
  where m.organization_id = p_organization_id
    and m.user_id = auth.uid()
    and m.status = 'active'
    and private.counter_service_workspace_accessible(p_organization_id)
$$;

create or replace function public.shares_active_org(p_other_user_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.organization_memberships mine
    join public.organization_memberships theirs
      on theirs.organization_id = mine.organization_id
    where mine.user_id = auth.uid()
      and mine.status = 'active'
      and theirs.user_id = p_other_user_id
      and theirs.status = 'active'
      and private.counter_service_workspace_accessible(mine.organization_id)
  )
$$;

create or replace function public.is_self_employee(p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.employees employee
    join public.organization_memberships membership
      on membership.organization_id = employee.organization_id
     and membership.user_id = employee.user_id
    where employee.id = p_employee_id
      and employee.user_id = auth.uid()
      and membership.status = 'active'
      and private.counter_service_workspace_accessible(employee.organization_id)
  )
$$;

create or replace function public.can_manage_location(p_organization_id uuid, p_location_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select private.counter_service_workspace_accessible(p_organization_id, p_location_id) and (
    public.can_manage_org(p_organization_id) or exists (
      select 1
      from public.organization_memberships om
      join public.location_memberships lm
        on lm.organization_id = om.organization_id and lm.user_id = om.user_id
      where om.organization_id = p_organization_id
        and lm.location_id = p_location_id
        and om.user_id = auth.uid()
        and om.status = 'active'
        and om.role = 'manager'
    )
  )
$$;

create or replace function private.user_has_capability(
  p_user_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_capability_key text,
  p_effective_on date default current_date
)
returns boolean
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  member_role public.app_role;
begin
  if p_user_id is null or p_organization_id is null or p_location_id is null
    or p_capability_key is null or p_effective_on is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.capability_definitions definition
    where definition.capability_key = p_capability_key
      and definition.is_active
  ) then
    return false;
  end if;

  select membership.role into member_role
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_user_id
    and membership.status = 'active';

  if member_role is null then return false; end if;

  if not exists (
    select 1
    from public.locations location
    where location.organization_id = p_organization_id
      and location.id = p_location_id
      and location.is_active
      and (
        member_role in ('owner', 'admin')
        or exists (
          select 1
          from public.location_memberships location_membership
          where location_membership.organization_id = p_organization_id
            and location_membership.location_id = p_location_id
            and location_membership.user_id = p_user_id
        )
      )
  ) then
    return false;
  end if;

  if not private.counter_service_workspace_accessible(p_organization_id, p_location_id) then
    return false;
  end if;
  if private.is_counter_service_org(p_organization_id) and (
    p_capability_key ~ '^(reservations|guest|guest_recovery|tip)\.'
    or p_capability_key = 'integrations.manage'
  ) then
    return false;
  end if;

  if member_role in ('owner', 'admin') then return true; end if;

  if exists (
    select 1
    from public.user_capability_overrides override
    where override.organization_id = p_organization_id
      and override.user_id = p_user_id
      and override.capability_key = p_capability_key
      and override.effect = 'deny'
      and override.is_active
      and (override.location_id is null or override.location_id = p_location_id)
      and override.effective_from <= p_effective_on
      and (override.effective_to is null or override.effective_to >= p_effective_on)
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.user_capability_overrides override
    where override.organization_id = p_organization_id
      and override.user_id = p_user_id
      and override.capability_key = p_capability_key
      and override.effect = 'grant'
      and override.is_active
      and (override.location_id is null or override.location_id = p_location_id)
      and override.effective_from <= p_effective_on
      and (override.effective_to is null or override.effective_to >= p_effective_on)
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.employees employee
    join public.employee_job_roles assignment
      on assignment.organization_id = employee.organization_id
     and assignment.employee_id = employee.id
     and assignment.location_id = p_location_id
     and assignment.effective_from <= p_effective_on
     and (assignment.effective_to is null or assignment.effective_to >= p_effective_on)
    join public.job_roles job_role
      on job_role.organization_id = assignment.organization_id
     and job_role.id = assignment.job_role_id
     and job_role.is_active
    join public.job_role_capabilities capability
      on capability.organization_id = assignment.organization_id
     and capability.job_role_id = assignment.job_role_id
     and capability.capability_key = p_capability_key
     and capability.is_active
     and (capability.location_id is null or capability.location_id = p_location_id)
     and capability.effective_from <= p_effective_on
     and (capability.effective_to is null or capability.effective_to >= p_effective_on)
    where employee.organization_id = p_organization_id
      and employee.user_id = p_user_id
      and employee.employment_status = 'active'
  );
end
$$;

CREATE OR REPLACE FUNCTION public.can_use_owner_intelligence(p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
  select not private.is_counter_service_org(p_organization_id) and exists (
    select 1
    from private.intelligence_operator_authorizations operator_auth
    join public.organization_memberships membership
      on membership.organization_id = operator_auth.organization_id
     and membership.user_id = operator_auth.user_id
    where operator_auth.organization_id = p_organization_id
      and operator_auth.user_id = auth.uid()
      and operator_auth.is_enabled
      and membership.role = 'owner'
      and membership.status = 'active'
  )
$function$;

-- Legacy policies and privileged writers do not all consult capabilities. Apply
-- the service model to the underlying records, including scheduler writes.
create function private.reject_counter_service_module_write()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if private.is_counter_service_org(new.organization_id) then
    raise exception 'This module is unavailable for counter service' using errcode = '42501';
  end if;
  return new;
end
$$;

revoke all on function private.reject_counter_service_module_write() from public, anon, authenticated;

do $guard_modules$
declare
  table_name text;
begin
  foreach table_name in array array[
    'booking_api_clients', 'dining_areas', 'location_release_controls', 'reservations',
    'reservation_settings', 'reservation_tables', 'reservation_table_combinations',
    'reservation_table_combination_members', 'reservation_service_periods',
    'reservation_turn_rules', 'reservation_table_allocations', 'reservation_events',
    'reservation_message_outbox', 'reservation_revisions', 'reservation_invalidation_signals',
    'reservation_push_deliveries', 'waitlist_entries', 'table_status_events',
    'guests', 'guest_locations', 'guest_contacts', 'guest_tags', 'guest_tag_assignments',
    'guest_visits', 'guest_notes', 'guest_consents', 'guest_merge_events',
    'communication_cases', 'communication_case_notes', 'communication_messages',
    'communication_threads', 'sms_ai_runs', 'owner_sms_alerts',
    'tip_pool_policies', 'tip_pool_policy_versions', 'tip_pool_eligibility_rules',
    'tip_runs', 'tip_sources', 'tip_run_participants', 'tip_adjustments',
    'tip_allocations', 'payroll_exports', 'integration_connections',
    'integration_sync_jobs', 'integration_sync_records', 'ai_runs'
  ] loop
    execute format(
      'create policy counter_service_module_access on public.%I as restrictive for all to authenticated using (not private.is_counter_service_org(organization_id)) with check (not private.is_counter_service_org(organization_id))',
      table_name
    );
    execute format(
      'create trigger reject_counter_service_module_write before insert or update on public.%I for each row execute function private.reject_counter_service_module_write()',
      table_name
    );
  end loop;

  foreach table_name in array array[
    'guest_merge_requests', 'public_booking_holds', 'public_booking_management_exchanges',
    'public_booking_requests', 'public_booking_tokens', 'public_booking_verifications',
    'public_guest_interest_requests', 'reservation_configuration_snapshots',
    'reservation_creation_policy_evidence', 'reservation_push_subscription_blocks',
    'reservation_service_period_spans', 'tip_preparation_requests'
  ] loop
    execute format(
      'create trigger reject_counter_service_module_write before insert or update on private.%I for each row execute function private.reject_counter_service_module_write()',
      table_name
    );
  end loop;
end
$guard_modules$;

create function public.service_provision_church_street(p_members jsonb)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  target_organization uuid;
  target_location uuid;
  first_owner uuid;
  roster_hash text;
  prior_hash text;
begin
  if jsonb_typeof(p_members) is distinct from 'array' then
    raise exception 'An approved roster of existing Auth accounts is required' using errcode = '22023';
  end if;
  if jsonb_array_length(p_members) not between 1 and 100 then
    raise exception 'Roster size must be between one and 100' using errcode = '22023';
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_members) as member(user_id uuid, role public.app_role, job_code text)
    where member.user_id is null or member.role is null
      or (member.job_code is not null and member.job_code not in ('COUNTER', 'BARISTA', 'PREP', 'SHIFT_LEAD'))
  ) or (
    select count(distinct member.user_id)
    from jsonb_to_recordset(p_members) as member(user_id uuid)
  ) <> jsonb_array_length(p_members) then
    raise exception 'Roster accounts and roles must be valid and unique' using errcode = '22023';
  end if;

  select member.user_id into first_owner
  from jsonb_to_recordset(p_members) as member(user_id uuid, role public.app_role)
  where member.role = 'owner'
  order by member.user_id
  limit 1;
  if first_owner is null then
    raise exception 'An approved owner is required' using errcode = '22023';
  end if;

  select encode(extensions.digest(
    jsonb_agg(
      jsonb_build_object('user_id', member.user_id, 'role', member.role, 'job_code', member.job_code)
      order by member.user_id
    )::text, 'sha256'
  ), 'hex') into roster_hash
  from jsonb_to_recordset(p_members) as member(user_id uuid, role public.app_role, job_code text);

  perform pg_advisory_xact_lock(hashtextextended('le-yard-church-street-provisioning', 0));

  select organization.id into target_organization
  from public.organizations organization where organization.slug = 'le-yard-church-street';
  if target_organization is not null then
    select event.metadata ->> 'roster_sha256' into prior_hash
    from public.audit_events event
    where event.organization_id = target_organization
      and event.action = 'church_street.provision'
    order by event.id limit 1;
    select settings.default_location_id into target_location
    from public.organization_settings settings
    join public.locations location
      on location.id = settings.default_location_id and location.organization_id = settings.organization_id
    where settings.organization_id = target_organization and location.code = 'CHURCH'
      and settings.feature_flags ->> 'service_model' = 'counter';
    if prior_hash is distinct from roster_hash or target_location is null then
      raise exception 'Church Street exists with a different provisioned plan. Use tenant administration for roster changes.' using errcode = '23505';
    end if;
    return jsonb_build_object('organization_id', target_organization, 'location_id', target_location, 'created', false);
  end if;

  if exists (
    select 1
    from jsonb_to_recordset(p_members) as member(user_id uuid)
    left join auth.users account on account.id = member.user_id
    left join public.profiles profile on profile.id = member.user_id
    where account.id is null or account.email_confirmed_at is null or account.email is null
      or profile.id is null
  ) then
    raise exception 'Every roster member must be an existing confirmed Auth account with a profile' using errcode = '22023';
  end if;

  insert into public.organizations (name, slug, status)
  values ('Le Yard Sandwicherie', 'le-yard-church-street', 'suspended')
  returning id into target_organization;

  insert into public.locations (organization_id, name, code, timezone, address, is_active)
  values (
    target_organization, '140 Church Street', 'CHURCH', 'America/New_York',
    '{"line1":"140 Church Street","city":"New York","region":"NY","country":"US"}'::jsonb,
    false
  )
  returning id into target_location;

  insert into public.organization_settings (organization_id, default_location_id, feature_flags)
  values (target_organization, target_location, '{"service_model":"counter"}'::jsonb);

  insert into public.organization_memberships (organization_id, user_id, role, status, joined_at)
  select target_organization, member.user_id, member.role, 'active', statement_timestamp()
  from jsonb_to_recordset(p_members) as member(user_id uuid, role public.app_role);

  insert into public.location_memberships (organization_id, location_id, user_id, is_primary)
  select target_organization, target_location, member.user_id, true
  from jsonb_to_recordset(p_members) as member(user_id uuid);

  insert into public.employees (organization_id, home_location_id, user_id, display_name, email)
  select target_organization, target_location, member.user_id, profile.display_name, account.email
  from jsonb_to_recordset(p_members) as member(user_id uuid)
  join auth.users account on account.id = member.user_id
  join public.profiles profile on profile.id = member.user_id;

  insert into public.job_roles (organization_id, name, code, department)
  values
    (target_organization, 'Counter', 'COUNTER', 'Counter service'),
    (target_organization, 'Barista', 'BARISTA', 'Counter service'),
    (target_organization, 'Prep', 'PREP', 'Kitchen'),
    (target_organization, 'Shift Lead', 'SHIFT_LEAD', 'Operations');

  insert into public.job_role_capabilities (
    organization_id, job_role_id, capability_key, location_id, effective_from, created_by, updated_by
  )
  select target_organization, job.id, template.capability_key, target_location,
    (statement_timestamp() at time zone 'America/New_York')::date, first_owner, first_owner
  from (values
    ('COUNTER', 'service.availability.manage'),
    ('BARISTA', 'service.availability.manage'),
    ('PREP', 'prep.complete'),
    ('PREP', 'inventory.waste.create'),
    ('SHIFT_LEAD', 'prep.complete'),
    ('SHIFT_LEAD', 'prep.manage'),
    ('SHIFT_LEAD', 'service.availability.manage'),
    ('SHIFT_LEAD', 'preshift.manage'),
    ('SHIFT_LEAD', 'manager_log.manage'),
    ('SHIFT_LEAD', 'food_safety.manage'),
    ('SHIFT_LEAD', 'inventory.count.create'),
    ('SHIFT_LEAD', 'inventory.waste.create'),
    ('SHIFT_LEAD', 'closeout.create'),
    ('SHIFT_LEAD', 'cash.manage')
  ) as template(job_code, capability_key)
  join public.job_roles job on job.organization_id = target_organization and job.code = template.job_code;

  insert into public.employee_job_roles (organization_id, employee_id, job_role_id, location_id, effective_from, is_primary)
  select target_organization, employee.id, job.id, target_location,
    (statement_timestamp() at time zone 'America/New_York')::date, true
  from jsonb_to_recordset(p_members) as member(user_id uuid, job_code text)
  join public.employees employee on employee.organization_id = target_organization and employee.user_id = member.user_id
  join public.job_roles job on job.organization_id = target_organization and job.code = member.job_code;

  insert into public.chat_channels (organization_id, kind, name, created_by)
  values
    (target_organization, 'all_staff', 'All Staff', first_owner),
    (target_organization, 'management', 'Management', first_owner);

  insert into public.audit_events (organization_id, location_id, action, table_name, record_id, metadata)
  values (target_organization, target_location, 'church_street.provision', 'organizations',
    target_organization::text, jsonb_build_object('roster_sha256', roster_hash));

  return jsonb_build_object('organization_id', target_organization, 'location_id', target_location, 'created', true);
end
$$;

create function public.service_set_church_street_active(p_organization_id uuid, p_active boolean)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  target_location uuid;
  prior_status text;
  prior_location_active boolean;
  next_status text;
begin
  if p_organization_id is null or p_active is null then
    raise exception 'Church Street organization and desired status are required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('le-yard-church-street-provisioning', 0));

  select organization.status, location.id, location.is_active
    into prior_status, target_location, prior_location_active
  from public.organizations organization
  join public.organization_settings settings on settings.organization_id = organization.id
  join public.locations location on location.id = settings.default_location_id and location.organization_id = organization.id
  where organization.id = p_organization_id and organization.slug = 'le-yard-church-street'
    and settings.feature_flags ->> 'service_model' = 'counter' and location.code = 'CHURCH'
  for update of organization, location;

  if target_location is null or prior_status = 'closed' then
    raise exception 'No provisioned Church Street workspace matches the request' using errcode = '22023';
  end if;

  next_status := case when p_active then 'active' else 'suspended' end;
  if prior_status is distinct from next_status or prior_location_active is distinct from p_active then
    update public.organizations set status = next_status where id = p_organization_id;
    update public.locations set is_active = p_active where id = target_location and organization_id = p_organization_id;

    insert into public.audit_events (organization_id, location_id, action, table_name, record_id, old_record, new_record)
    values (p_organization_id, target_location, 'church_street.status', 'organizations', p_organization_id::text,
      jsonb_build_object('status', prior_status, 'location_active', prior_location_active),
      jsonb_build_object('status', next_status, 'location_active', p_active));
  end if;

  return jsonb_build_object('organization_id', p_organization_id, 'location_id', target_location, 'status', next_status);
end
$$;

revoke all on function public.service_provision_church_street(jsonb),
  public.service_set_church_street_active(uuid, boolean) from public, anon, authenticated;
grant execute on function public.service_provision_church_street(jsonb),
  public.service_set_church_street_active(uuid, boolean) to service_role;

update private.runtime_schema_contract_expected expected
set migration_head = '20261112055446',
  table_fingerprint = fingerprints.value ->> 'tableFingerprint',
  function_fingerprint = fingerprints.value ->> 'functionFingerprint',
  access_fingerprint = fingerprints.value ->> 'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) fingerprints
where expected.contract_version = 'runtime-schema-v2';
