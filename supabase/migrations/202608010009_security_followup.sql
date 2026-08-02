-- Le Yard OS: final authorization, workflow, and evidence hardening.
-- Forward-only follow-up to migrations 001-008.

-- Owner MFA read boundary ---------------------------------------------------

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
      and (
        membership.role <> 'owner'
        or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      )
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
      and membership.role = any(p_roles)
      and (
        membership.role <> 'owner'
        or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      )
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
      and (
        (
          organization_membership.role = 'owner'
          and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
        )
        or organization_membership.role = 'admin'
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
      and (
        mine.role <> 'owner'
        or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      )
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
      and (
        membership.role <> 'owner'
        or coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      )
  )
$$;

create function public.is_owner_pending_mfa(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
    and exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = p_organization_id
        and membership.user_id = auth.uid()
        and membership.role = 'owner'
        and membership.status = 'active'
    )
$$;

revoke all on function public.is_owner_pending_mfa(uuid) from public;
grant execute on function public.is_owner_pending_mfa(uuid) to authenticated;

create policy owner_mfa_organization_context_read
on public.organizations for select to authenticated
using (public.is_owner_pending_mfa(id));

create policy owner_mfa_location_context_read
on public.locations for select to authenticated
using (is_active and public.is_owner_pending_mfa(organization_id));

-- Membership governance ----------------------------------------------------

create table private.organization_owner_counts (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  active_owner_count integer not null check (active_owner_count >= 0),
  updated_at timestamptz not null default clock_timestamp()
);

revoke all on table private.organization_owner_counts from public, anon, authenticated;

insert into private.organization_owner_counts (organization_id, active_owner_count)
select organization.id, count(membership.id)::integer
from public.organizations organization
left join public.organization_memberships membership
  on membership.organization_id = organization.id
 and membership.role = 'owner'
 and membership.status = 'active'
group by organization.id
on conflict (organization_id) do update
set active_owner_count = excluded.active_owner_count,
    updated_at = clock_timestamp();

create function public.guard_active_owner_count()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  old_is_active_owner boolean := false;
  new_is_active_owner boolean := false;
  changed_count integer;
begin
  if tg_op in ('UPDATE', 'DELETE') then
    old_is_active_owner := old.role = 'owner' and old.status = 'active';
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    new_is_active_owner := new.role = 'owner' and new.status = 'active';
  end if;

  if old_is_active_owner and not new_is_active_owner then
    update private.organization_owner_counts owner_count
    set active_owner_count = owner_count.active_owner_count - 1,
        updated_at = clock_timestamp()
    where owner_count.organization_id = old.organization_id
      and owner_count.active_owner_count > 1
    returning active_owner_count into changed_count;

    if changed_count is null then
      raise exception 'An organization must retain at least one active owner'
        using errcode = '23514';
    end if;
  elsif new_is_active_owner and not old_is_active_owner then
    insert into private.organization_owner_counts (
      organization_id,
      active_owner_count,
      updated_at
    ) values (
      new.organization_id,
      1,
      clock_timestamp()
    )
    on conflict (organization_id) do update
    set active_owner_count = private.organization_owner_counts.active_owner_count + 1,
        updated_at = clock_timestamp();
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

drop trigger organization_memberships_keep_owner on public.organization_memberships;
drop function public.prevent_last_active_owner();

create trigger organization_memberships_active_owner_count
before insert or update or delete on public.organization_memberships
for each row execute function public.guard_active_owner_count();

create function public.guard_owner_membership_target()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  trusted_actor boolean := current_user in ('postgres', 'supabase_admin', 'service_role')
    or coalesce(auth.role(), '') = 'service_role';
  target_is_owner boolean := false;
  target_organization_id uuid;
begin
  if tg_op = 'UPDATE' and (
    old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.user_id is distinct from new.user_id
  ) then
    raise exception 'Membership identity and tenant are immutable' using errcode = '42501';
  end if;

  target_organization_id := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  if tg_op in ('UPDATE', 'DELETE') and old.role = 'owner' then
    target_is_owner := true;
  end if;
  if tg_op in ('INSERT', 'UPDATE') and new.role = 'owner' then
    target_is_owner := true;
  end if;

  if target_is_owner and not trusted_actor and not (
    public.org_role(target_organization_id) = 'owner'
    and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  ) then
    raise exception 'Only an MFA-verified owner may mutate an Owner membership'
      using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger organization_memberships_owner_target_guard
before insert or update or delete on public.organization_memberships
for each row execute function public.guard_owner_membership_target();

create function public.can_administer_membership_target(
  p_organization_id uuid,
  p_target_user_id uuid,
  p_prospective_role public.app_role default null
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select public.can_manage_org(p_organization_id)
    and case
      when p_prospective_role = 'owner'
        or exists (
          select 1
          from public.organization_memberships target
          where target.organization_id = p_organization_id
            and target.user_id = p_target_user_id
            and target.role = 'owner'
        )
      then public.org_role(p_organization_id) = 'owner'
        and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      else true
    end
$$;

revoke all on function public.can_administer_membership_target(uuid, uuid, public.app_role) from public;
grant execute on function public.can_administer_membership_target(uuid, uuid, public.app_role) to authenticated;

drop policy membership_admin_insert on public.organization_memberships;
drop policy membership_admin_update on public.organization_memberships;
drop policy membership_admin_delete on public.organization_memberships;

create policy membership_admin_insert
on public.organization_memberships for insert to authenticated
with check (
  public.can_administer_membership_target(organization_id, user_id, role)
);

create policy membership_admin_update
on public.organization_memberships for update to authenticated
using (
  public.can_administer_membership_target(organization_id, user_id, role)
)
with check (
  public.can_administer_membership_target(organization_id, user_id, role)
);

create policy membership_admin_delete
on public.organization_memberships for delete to authenticated
using (
  user_id <> auth.uid()
  and public.can_administer_membership_target(organization_id, user_id, role)
);

create function public.guard_owner_location_membership_target()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  trusted_actor boolean := current_user in ('postgres', 'supabase_admin', 'service_role')
    or coalesce(auth.role(), '') = 'service_role';
  target_organization_id uuid;
  old_target_is_owner boolean := false;
  new_target_is_owner boolean := false;
begin
  target_organization_id := case
    when tg_op = 'DELETE' then old.organization_id
    else new.organization_id
  end;
  if tg_op in ('UPDATE', 'DELETE') then
    select exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = old.organization_id
        and membership.user_id = old.user_id
        and membership.role = 'owner'
    ) into old_target_is_owner;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select exists (
      select 1 from public.organization_memberships membership
      where membership.organization_id = new.organization_id
        and membership.user_id = new.user_id
        and membership.role = 'owner'
    ) into new_target_is_owner;
  end if;

  if (old_target_is_owner or new_target_is_owner)
    and not trusted_actor
    and not (
      public.org_role(target_organization_id) = 'owner'
      and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    ) then
    raise exception 'Only an MFA-verified owner may mutate an Owner location membership'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger location_memberships_owner_target_guard
before insert or update or delete on public.location_memberships
for each row execute function public.guard_owner_location_membership_target();

drop policy location_membership_admin_insert on public.location_memberships;
drop policy location_membership_admin_update on public.location_memberships;
drop policy location_membership_admin_delete on public.location_memberships;

create policy location_membership_admin_insert
on public.location_memberships for insert to authenticated
with check (
  public.can_administer_membership_target(organization_id, user_id, null)
);
create policy location_membership_admin_update
on public.location_memberships for update to authenticated
using (public.can_administer_membership_target(organization_id, user_id, null))
with check (public.can_administer_membership_target(organization_id, user_id, null));
create policy location_membership_admin_delete
on public.location_memberships for delete to authenticated
using (public.can_administer_membership_target(organization_id, user_id, null));

create table private.member_admin_requests (
  request_id uuid primary key,
  membership_id uuid not null,
  organization_id uuid not null,
  actor_id uuid not null,
  requested_role public.app_role not null,
  requested_status public.membership_status not null,
  location_ids uuid[] not null,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.member_admin_requests from public, anon, authenticated;

create function public.administer_organization_member(
  p_request_id uuid,
  p_membership_id uuid,
  p_role public.app_role,
  p_status public.membership_status,
  p_location_ids uuid[]
)
returns public.organization_memberships
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  target public.organization_memberships%rowtype;
  result public.organization_memberships%rowtype;
  prior private.member_admin_requests%rowtype;
  clean_location_ids uuid[];
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct location_id order by location_id), '{}'::uuid[])
  into clean_location_ids
  from unnest(coalesce(p_location_ids, '{}'::uuid[])) requested(location_id);

  perform pg_advisory_xact_lock(hashtextextended('member-admin:' || p_request_id::text, 0));
  select * into prior
  from private.member_admin_requests request
  where request.request_id = p_request_id;

  if prior.request_id is not null then
    if prior.actor_id is distinct from actor_id
      or prior.membership_id is distinct from p_membership_id
      or prior.requested_role is distinct from p_role
      or prior.requested_status is distinct from p_status
      or prior.location_ids is distinct from clean_location_ids then
      raise exception 'Member administration request id was reused' using errcode = '23505';
    end if;
    select * into result
    from public.organization_memberships membership
    where membership.id = prior.membership_id;
    return result;
  end if;

  select * into target
  from public.organization_memberships membership
  where membership.id = p_membership_id
  for update;
  if target.id is null then
    raise exception 'Membership not found' using errcode = 'P0002';
  end if;
  if target.user_id = actor_id then
    raise exception 'Use a separate Owner or Admin to change your own access'
      using errcode = '42501';
  end if;
  if not public.can_administer_membership_target(
    target.organization_id,
    target.user_id,
    p_role
  ) then
    raise exception 'Not authorized to administer this membership' using errcode = '42501';
  end if;
  if target.status = 'invited' and p_status <> 'invited'
    or target.status <> 'invited' and p_status = 'invited' then
    raise exception 'Invitation activation state is managed by the invitation lifecycle'
      using errcode = '23514';
  end if;
  if p_role in ('manager', 'employee') and cardinality(clean_location_ids) = 0 then
    raise exception 'Managers and employees require at least one location'
      using errcode = '23514';
  end if;
  if exists (
    select 1
    from unnest(clean_location_ids) requested(location_id)
    where not exists (
      select 1
      from public.locations location
      where location.organization_id = target.organization_id
        and location.id = requested.location_id
        and location.is_active
    )
  ) then
    raise exception 'A requested location is unavailable' using errcode = '23503';
  end if;

  insert into private.member_admin_requests (
    request_id,
    membership_id,
    organization_id,
    actor_id,
    requested_role,
    requested_status,
    location_ids
  ) values (
    p_request_id,
    target.id,
    target.organization_id,
    actor_id,
    p_role,
    p_status,
    clean_location_ids
  );

  update public.organization_memberships membership
  set role = p_role,
      status = p_status,
      suspended_at = case
        when p_status = 'suspended' then coalesce(membership.suspended_at, clock_timestamp())
        else null
      end,
      updated_at = clock_timestamp()
  where membership.id = target.id
  returning * into result;

  delete from public.location_memberships location_membership
  where location_membership.organization_id = target.organization_id
    and location_membership.user_id = target.user_id;

  insert into public.location_memberships (
    organization_id,
    location_id,
    user_id,
    is_primary
  )
  select target.organization_id,
    requested.location_id,
    target.user_id,
    requested.ordinality = 1
  from unnest(clean_location_ids) with ordinality requested(location_id, ordinality);

  update public.employees employee
  set home_location_id = clean_location_ids[1],
      updated_at = clock_timestamp()
  where employee.organization_id = target.organization_id
    and employee.user_id = target.user_id;

  update private.member_admin_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return result;
end
$$;

revoke all on function public.administer_organization_member(uuid, uuid, public.app_role, public.membership_status, uuid[]) from public;
grant execute on function public.administer_organization_member(uuid, uuid, public.app_role, public.membership_status, uuid[]) to authenticated;

-- Membership and location scope changes are command-only. Invitation
-- provision/acceptance and the member administration RPCs are SECURITY
-- DEFINER, so browser sessions never need direct write privileges here.
revoke insert, update, delete on public.organization_memberships from authenticated;
revoke insert, update, delete on public.location_memberships from authenticated;

-- Compensation-bearing job/assignment configuration is Owner/Admin-only;
-- managers retain management reads but cannot grant themselves roles, rates,
-- or tip weights. Employee/Auth linkage is immutable outside trusted
-- invitation provisioning.
drop policy job_role_manager_insert on public.job_roles;
drop policy job_role_manager_update on public.job_roles;
drop policy job_role_manager_delete on public.job_roles;
create policy job_role_admin_insert
on public.job_roles for insert to authenticated
with check (public.can_manage_org(organization_id));
create policy job_role_admin_update
on public.job_roles for update to authenticated
using (public.can_manage_org(organization_id))
with check (public.can_manage_org(organization_id));
create policy job_role_admin_delete
on public.job_roles for delete to authenticated
using (public.can_manage_org(organization_id));

drop policy employee_job_role_staff_read on public.employee_job_roles;
drop policy employee_job_role_manager_insert on public.employee_job_roles;
drop policy employee_job_role_manager_update on public.employee_job_roles;
drop policy employee_job_role_manager_delete on public.employee_job_roles;
create policy employee_job_role_scoped_read
on public.employee_job_roles for select to authenticated
using (
  public.is_self_employee(employee_id)
  or public.can_read_management_location(organization_id, location_id)
);
create policy employee_job_role_admin_insert
on public.employee_job_roles for insert to authenticated
with check (
  public.can_manage_org(organization_id)
  and exists (
    select 1 from public.locations location
    where location.organization_id = employee_job_roles.organization_id
      and location.id = employee_job_roles.location_id
      and location.is_active
  )
);
create policy employee_job_role_admin_update
on public.employee_job_roles for update to authenticated
using (public.can_manage_org(organization_id))
with check (public.can_manage_org(organization_id));
create policy employee_job_role_admin_delete
on public.employee_job_roles for delete to authenticated
using (public.can_manage_org(organization_id));

create function public.guard_employee_auth_identity()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  trusted_actor boolean := auth.uid() is null
    or current_user in ('postgres', 'supabase_admin', 'service_role')
    or coalesce(auth.role(), '') = 'service_role';
begin
  if tg_op = 'INSERT' and not trusted_actor and new.user_id is not null then
    raise exception 'Linked employee records must be created through invitation provisioning'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
    old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.user_id is distinct from new.user_id
    or old.created_at is distinct from new.created_at
  ) then
    raise exception 'Employee tenant and Auth identity are immutable'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger employee_auth_identity_guard
before insert or update on public.employees
for each row execute function public.guard_employee_auth_identity();

-- Shift assignment and transition integrity --------------------------------

update public.shifts
set is_open = true
where status = 'open' and employee_id is null and not is_open;

update public.shifts
set is_open = false
where status <> 'open' and is_open;

do $shift_preflight$
begin
  if exists (
    select 1
    from public.shifts shift_row
    where (shift_row.status = 'open' and shift_row.employee_id is not null)
       or (
         shift_row.status in ('scheduled', 'claimed', 'in_progress', 'completed')
         and shift_row.employee_id is null
       )
  ) then
    raise exception 'Existing shifts violate the assignment/status invariant; repair them before applying migration 009'
      using errcode = '23514';
  end if;
end
$shift_preflight$;

alter table public.shifts
add constraint shifts_status_assignment_check
check (
  (status = 'open' and is_open and employee_id is null)
  or (
    status in ('scheduled', 'claimed', 'in_progress', 'completed')
    and not is_open
    and employee_id is not null
  )
  or (status = 'cancelled' and not is_open)
);

create table private.shift_transition_requests (
  request_id uuid primary key,
  organization_id uuid not null,
  location_id uuid not null,
  shift_id uuid not null,
  actor_id uuid not null,
  action text not null check (action in ('claim', 'reopen', 'swap', 'swap-deny')),
  target_employee_id uuid,
  related_request_id uuid,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.shift_transition_requests from public, anon, authenticated;

create or replace function public.guard_published_shift_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  old_parent_status public.schedule_status;
  new_parent_status public.schedule_status;
  transition_request private.shift_transition_requests%rowtype;
  is_rpc_transition boolean := false;
begin
  -- Migrations and seed/maintenance operations have no end-user JWT.
  if auth.uid() is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  if tg_op in ('UPDATE', 'DELETE') then
    select schedule.status into old_parent_status
    from public.schedules schedule
    where schedule.id = old.schedule_id;
  end if;
  if tg_op in ('INSERT', 'UPDATE') then
    select schedule.status into new_parent_status
    from public.schedules schedule
    where schedule.id = new.schedule_id;
  end if;

  if coalesce(old_parent_status = 'published', false) = false
    and coalesce(new_parent_status = 'published', false) = false then
    return case when tg_op = 'DELETE' then old else new end;
  end if;
  if tg_op in ('INSERT', 'DELETE') then
    raise exception 'Published schedule shifts cannot be added or removed'
      using errcode = '42501';
  end if;

  if old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.location_id is distinct from new.location_id
    or old.schedule_id is distinct from new.schedule_id
    or old.job_role_id is distinct from new.job_role_id
    or old.starts_at is distinct from new.starts_at
    or old.ends_at is distinct from new.ends_at
    or old.break_minutes is distinct from new.break_minutes then
    raise exception 'Published shift identity, scope, role, and timing are immutable'
      using errcode = '42501';
  end if;

  select request.* into transition_request
  from private.shift_transition_requests request
  where request.shift_id = old.id
    and request.actor_id = auth.uid()
    and request.completed_at is null
  order by request.created_at desc
  limit 1;

  if transition_request.request_id is not null then
    is_rpc_transition :=
      (
        transition_request.action = 'claim'
        and old.status = 'open'
        and old.is_open
        and old.employee_id is null
        and new.status = 'claimed'
        and not new.is_open
        and new.employee_id = transition_request.target_employee_id
      )
      or (
        transition_request.action = 'reopen'
        and old.status in ('scheduled', 'claimed', 'cancelled')
        and new.status = 'open'
        and new.is_open
        and new.employee_id is null
      )
      or (
        transition_request.action = 'swap'
        and old.status in ('scheduled', 'claimed')
        and new.status = old.status
        and not new.is_open
        and new.employee_id = transition_request.target_employee_id
        and new.employee_id is distinct from old.employee_id
      );
  end if;

  if is_rpc_transition then
    return new;
  end if;

  if old.employee_id is distinct from new.employee_id
    or old.is_open is distinct from new.is_open then
    -- Cancelling an open shift may canonicalize the open flag without changing
    -- any assignment. Assignment changes remain RPC-only.
    if not (
      old.status = 'open'
      and new.status = 'cancelled'
      and old.employee_id is null
      and new.employee_id is null
      and old.is_open
      and not new.is_open
    ) then
      raise exception 'Published shift assignment changes require an atomic workflow command'
        using errcode = '42501';
    end if;
  end if;

  if old.status in ('completed', 'cancelled')
    and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'Completed or cancelled shifts are immutable' using errcode = '42501';
  end if;

  if new.status is distinct from old.status and not (
    (old.status = 'scheduled' and new.status in ('in_progress', 'cancelled'))
    or (old.status = 'open' and new.status = 'cancelled')
    or (old.status = 'claimed' and new.status in ('in_progress', 'cancelled'))
    or (old.status = 'in_progress' and new.status in ('completed', 'cancelled'))
  ) then
    raise exception 'Invalid published shift status transition' using errcode = '23514';
  end if;
  return new;
end
$$;

create function public.claim_open_shift(
  p_request_id uuid,
  p_shift_id uuid
)
returns public.shifts
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  shift_row public.shifts%rowtype;
  employee_row public.employees%rowtype;
  prior private.shift_transition_requests%rowtype;
  shift_business_date date;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('shift-command:' || p_request_id::text, 0));

  select * into prior
  from private.shift_transition_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null then
    if prior.action <> 'claim'
      or prior.actor_id is distinct from actor_id
      or prior.shift_id is distinct from p_shift_id then
      raise exception 'Shift command request id was reused' using errcode = '23505';
    end if;
    select * into shift_row from public.shifts where id = prior.shift_id;
    if shift_row.employee_id is distinct from prior.target_employee_id then
      raise exception 'The claimed shift has since been reassigned' using errcode = '40001';
    end if;
    return shift_row;
  end if;

  select * into shift_row
  from public.shifts shift_candidate
  where shift_candidate.id = p_shift_id
  for update;
  if shift_row.id is null then
    raise exception 'Shift not found' using errcode = 'P0002';
  end if;
  if not public.can_access_location(shift_row.organization_id, shift_row.location_id) then
    raise exception 'Not authorized to claim this shift' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.schedules schedule
    where schedule.id = shift_row.schedule_id
      and schedule.organization_id = shift_row.organization_id
      and schedule.location_id = shift_row.location_id
      and schedule.status = 'published'
  ) or shift_row.status <> 'open'
    or not shift_row.is_open
    or shift_row.employee_id is not null then
    raise exception 'Only an unassigned open shift on a published schedule may be claimed'
      using errcode = '23514';
  end if;

  select employee.* into employee_row
  from public.employees employee
  where employee.organization_id = shift_row.organization_id
    and employee.user_id = actor_id
    and employee.employment_status = 'active';
  if employee_row.id is null then
    raise exception 'No active employee record matches the caller' using errcode = '42501';
  end if;

  select (shift_row.starts_at at time zone location.timezone)::date
  into shift_business_date
  from public.locations location
  where location.organization_id = shift_row.organization_id
    and location.id = shift_row.location_id
    and location.is_active;
  if shift_business_date is null or not exists (
    select 1
    from public.employee_job_roles assignment
    where assignment.organization_id = shift_row.organization_id
      and assignment.employee_id = employee_row.id
      and assignment.job_role_id = shift_row.job_role_id
      and assignment.location_id = shift_row.location_id
      and assignment.effective_from <= shift_business_date
      and (assignment.effective_to is null or assignment.effective_to >= shift_business_date)
  ) then
    raise exception 'The caller is not assigned to this shift role and location'
      using errcode = '23514';
  end if;

  insert into private.shift_transition_requests (
    request_id,
    organization_id,
    location_id,
    shift_id,
    actor_id,
    action,
    target_employee_id
  ) values (
    p_request_id,
    shift_row.organization_id,
    shift_row.location_id,
    shift_row.id,
    actor_id,
    'claim',
    employee_row.id
  );

  update public.shifts shift_update
  set employee_id = employee_row.id,
      status = 'claimed',
      is_open = false,
      updated_at = clock_timestamp()
  where shift_update.id = shift_row.id
  returning * into shift_row;

  update private.shift_transition_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return shift_row;
end
$$;

create function public.reopen_shift(
  p_request_id uuid,
  p_shift_id uuid
)
returns public.shifts
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  shift_row public.shifts%rowtype;
  prior private.shift_transition_requests%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('shift-command:' || p_request_id::text, 0));
  select * into prior
  from private.shift_transition_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null then
    if prior.action <> 'reopen'
      or prior.actor_id is distinct from actor_id
      or prior.shift_id is distinct from p_shift_id then
      raise exception 'Shift command request id was reused' using errcode = '23505';
    end if;
    select * into shift_row from public.shifts where id = prior.shift_id;
    if shift_row.status <> 'open' or not shift_row.is_open or shift_row.employee_id is not null then
      raise exception 'The reopened shift has since changed' using errcode = '40001';
    end if;
    return shift_row;
  end if;

  select * into shift_row
  from public.shifts shift_candidate
  where shift_candidate.id = p_shift_id
  for update;
  if shift_row.id is null then
    raise exception 'Shift not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(shift_row.organization_id, shift_row.location_id) then
    raise exception 'Not authorized to reopen this shift' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.schedules schedule
    where schedule.id = shift_row.schedule_id and schedule.status = 'published'
  ) or shift_row.status not in ('scheduled', 'claimed', 'cancelled') then
    raise exception 'Only a published scheduled, claimed, or cancelled shift may be reopened'
      using errcode = '23514';
  end if;

  insert into private.shift_transition_requests (
    request_id,
    organization_id,
    location_id,
    shift_id,
    actor_id,
    action
  ) values (
    p_request_id,
    shift_row.organization_id,
    shift_row.location_id,
    shift_row.id,
    actor_id,
    'reopen'
  );

  update public.shifts shift_update
  set employee_id = null,
      status = 'open',
      is_open = true,
      updated_at = clock_timestamp()
  where shift_update.id = shift_row.id
  returning * into shift_row;

  update private.shift_transition_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return shift_row;
end
$$;

revoke all on function public.claim_open_shift(uuid, uuid) from public;
revoke all on function public.reopen_shift(uuid, uuid) from public;
grant execute on function public.claim_open_shift(uuid, uuid) to authenticated;
grant execute on function public.reopen_shift(uuid, uuid) to authenticated;

-- Shift swap requests derive scope and actors from the selected shift.
create function public.guard_shift_swap_scope()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  shift_row public.shifts%rowtype;
  has_decision_request boolean := false;
  requester_user_id uuid;
begin
  if tg_op = 'UPDATE' and (
    old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.location_id is distinct from new.location_id
    or old.shift_id is distinct from new.shift_id
    or old.requested_by_employee_id is distinct from new.requested_by_employee_id
    or old.created_at is distinct from new.created_at
  ) then
    raise exception 'Shift swap identity, scope, requester, and creation stamp are immutable'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE' then
    if old.status <> 'cancelled' then
      raise exception 'Only a cancelled shift swap request may be deleted' using errcode = '42501';
    end if;
    return old;
  end if;

  select * into shift_row
  from public.shifts shift_candidate
  where shift_candidate.id = new.shift_id;
  if tg_op = 'INSERT' and auth.uid() is not null then
    select employee.user_id into requester_user_id
    from public.employees employee
    where employee.id = new.requested_by_employee_id;
    if requester_user_id is distinct from auth.uid() then
      raise exception 'Shift swap requester must match the authenticated employee'
        using errcode = '42501';
    end if;
  end if;
  if shift_row.id is null
    or new.organization_id is distinct from shift_row.organization_id
    or new.location_id is distinct from shift_row.location_id
    or new.requested_by_employee_id is distinct from shift_row.employee_id
    or not exists (
      select 1 from public.schedules schedule
      where schedule.id = shift_row.schedule_id and schedule.status = 'published'
    ) then
    raise exception 'Shift swap request must match an assigned published shift'
      using errcode = '23514';
  end if;

  if tg_op = 'UPDATE' and old.status in ('approved', 'denied', 'cancelled')
    and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'Terminal shift swap requests are immutable' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and new.status in ('approved', 'denied')
    and new.status is distinct from old.status then
    select exists (
      select 1 from private.shift_transition_requests request
      where request.related_request_id = new.id
        and request.actor_id = auth.uid()
        and request.action in ('swap', 'swap-deny')
        and request.completed_at is null
    ) into has_decision_request;
    if not has_decision_request
      or new.decided_by is distinct from auth.uid()
      or new.decided_at is null then
      raise exception 'Shift swap decisions require the atomic management command'
        using errcode = '42501';
    end if;
  elsif tg_op = 'UPDATE' and (
    old.decided_by is distinct from new.decided_by
    or old.decided_at is distinct from new.decided_at
  ) then
    raise exception 'Shift swap decision evidence is server-managed' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger shift_swap_scope_guard
before insert or update or delete on public.shift_swap_requests
for each row execute function public.guard_shift_swap_scope();

revoke insert, update, delete on public.shift_swap_requests from authenticated;

create function public.request_shift_swap(
  p_request_id uuid,
  p_shift_id uuid,
  p_preferred_employee_id uuid default null,
  p_reason text default null
)
returns public.shift_swap_requests
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  shift_row public.shifts%rowtype;
  actor_employee public.employees%rowtype;
  result public.shift_swap_requests%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('swap-request:' || p_request_id::text, 0));
  select * into result from public.shift_swap_requests where id = p_request_id;
  if result.id is not null then
    if result.shift_id is distinct from p_shift_id
      or result.preferred_employee_id is distinct from p_preferred_employee_id
      or result.reason is distinct from nullif(btrim(p_reason), '') then
      raise exception 'Shift swap request id was reused' using errcode = '23505';
    end if;
    select * into actor_employee
    from public.employees employee
    where employee.id = result.requested_by_employee_id;
    if actor_employee.user_id is distinct from actor_id then
      raise exception 'Shift swap request belongs to another employee' using errcode = '42501';
    end if;
    return result;
  end if;

  select * into shift_row from public.shifts where id = p_shift_id for update;
  if shift_row.id is null then
    raise exception 'Shift not found' using errcode = 'P0002';
  end if;
  select * into actor_employee
  from public.employees employee
  where employee.organization_id = shift_row.organization_id
    and employee.user_id = actor_id
    and employee.employment_status = 'active';
  if actor_employee.id is null
    or shift_row.employee_id is distinct from actor_employee.id
    or shift_row.status not in ('scheduled', 'claimed')
    or not public.can_access_location(shift_row.organization_id, shift_row.location_id)
    or not exists (
      select 1 from public.schedules schedule
      where schedule.id = shift_row.schedule_id and schedule.status = 'published'
    ) then
    raise exception 'Only the assigned employee may request a swap for an active published shift'
      using errcode = '42501';
  end if;
  if p_preferred_employee_id is not null and not exists (
    select 1 from public.employees employee
    where employee.id = p_preferred_employee_id
      and employee.organization_id = shift_row.organization_id
      and employee.employment_status = 'active'
  ) then
    raise exception 'Preferred employee is unavailable' using errcode = '23514';
  end if;

  insert into public.shift_swap_requests (
    id,
    organization_id,
    location_id,
    shift_id,
    requested_by_employee_id,
    preferred_employee_id,
    reason,
    status
  ) values (
    p_request_id,
    shift_row.organization_id,
    shift_row.location_id,
    shift_row.id,
    actor_employee.id,
    p_preferred_employee_id,
    nullif(btrim(p_reason), ''),
    'pending'
  )
  returning * into result;
  return result;
end
$$;

create function public.decide_shift_swap(
  p_request_id uuid,
  p_swap_request_id uuid,
  p_offer_id uuid,
  p_approve boolean
)
returns public.shift_swap_requests
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  swap_row public.shift_swap_requests%rowtype;
  offer_row public.shift_swap_offers%rowtype;
  shift_row public.shifts%rowtype;
  replacement_employee_id uuid;
  shift_business_date date;
  prior private.shift_transition_requests%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Shift swap decision is required' using errcode = '22023';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('shift-command:' || p_request_id::text, 0));
  select * into prior
  from private.shift_transition_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null then
    if prior.action is distinct from (
      case when p_approve then 'swap' else 'swap-deny' end
    )
      or prior.actor_id is distinct from actor_id
      or prior.related_request_id is distinct from p_swap_request_id then
      raise exception 'Shift command request id was reused' using errcode = '23505';
    end if;
    select * into swap_row from public.shift_swap_requests where id = p_swap_request_id;
    return swap_row;
  end if;

  select * into swap_row
  from public.shift_swap_requests request
  where request.id = p_swap_request_id
  for update;
  if swap_row.id is null then
    raise exception 'Shift swap request not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(swap_row.organization_id, swap_row.location_id) then
    raise exception 'Not authorized to decide this shift swap' using errcode = '42501';
  end if;
  if swap_row.status <> 'pending' then
    raise exception 'Only a pending shift swap may be decided' using errcode = '23514';
  end if;

  select * into shift_row from public.shifts where id = swap_row.shift_id for update;
  if shift_row.id is null
    or shift_row.organization_id is distinct from swap_row.organization_id
    or shift_row.location_id is distinct from swap_row.location_id
    or shift_row.employee_id is distinct from swap_row.requested_by_employee_id
    or shift_row.status not in ('scheduled', 'claimed') then
    raise exception 'The requested shift assignment is no longer eligible for a swap'
      using errcode = '23514';
  end if;

  if p_approve then
    if p_offer_id is not null then
      select * into offer_row
      from public.shift_swap_offers offer
      where offer.id = p_offer_id
        and offer.swap_request_id = swap_row.id
        and offer.status = 'pending'
      for update;
      if offer_row.id is null then
        raise exception 'Shift swap offer not found' using errcode = 'P0002';
      end if;
      replacement_employee_id := offer_row.offered_by_employee_id;
    else
      replacement_employee_id := swap_row.preferred_employee_id;
    end if;
    if replacement_employee_id is null
      or replacement_employee_id = swap_row.requested_by_employee_id then
      raise exception 'An approved swap requires a different replacement employee'
        using errcode = '23514';
    end if;

    select (shift_row.starts_at at time zone location.timezone)::date
    into shift_business_date
    from public.locations location
    where location.organization_id = shift_row.organization_id
      and location.id = shift_row.location_id
      and location.is_active;
    if not exists (
      select 1
      from public.employees employee
      join public.employee_job_roles assignment
        on assignment.organization_id = employee.organization_id
       and assignment.employee_id = employee.id
      where employee.id = replacement_employee_id
        and employee.organization_id = shift_row.organization_id
        and employee.employment_status = 'active'
        and assignment.location_id = shift_row.location_id
        and assignment.job_role_id = shift_row.job_role_id
        and assignment.effective_from <= shift_business_date
        and (assignment.effective_to is null or assignment.effective_to >= shift_business_date)
    ) then
      raise exception 'Replacement employee is not assigned to the shift role and location'
        using errcode = '23514';
    end if;
  end if;

  insert into private.shift_transition_requests (
    request_id,
    organization_id,
    location_id,
    shift_id,
    actor_id,
    action,
    target_employee_id,
    related_request_id
  ) values (
    p_request_id,
    swap_row.organization_id,
    swap_row.location_id,
    swap_row.shift_id,
    actor_id,
    case when p_approve then 'swap' else 'swap-deny' end,
    replacement_employee_id,
    swap_row.id
  );

  update public.shift_swap_requests request
  set status = case when p_approve then 'approved'::public.request_status else 'denied'::public.request_status end,
      decided_by = actor_id,
      decided_at = clock_timestamp(),
      updated_at = clock_timestamp()
  where request.id = swap_row.id
  returning * into swap_row;

  if p_approve then
    update public.shifts shift_update
    set employee_id = replacement_employee_id,
        updated_at = clock_timestamp()
    where shift_update.id = shift_row.id;
  end if;

  if p_approve and p_offer_id is not null then
    update public.shift_swap_offers offer
    set status = case when offer.id = p_offer_id then 'approved'::public.request_status else 'denied'::public.request_status end,
        updated_at = clock_timestamp()
    where offer.swap_request_id = swap_row.id
      and offer.status = 'pending';
  end if;

  update private.shift_transition_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return swap_row;
end
$$;

revoke all on function public.request_shift_swap(uuid, uuid, uuid, text) from public;
revoke all on function public.decide_shift_swap(uuid, uuid, uuid, boolean) from public;
grant execute on function public.request_shift_swap(uuid, uuid, uuid, text) to authenticated;
grant execute on function public.decide_shift_swap(uuid, uuid, uuid, boolean) to authenticated;

create function public.guard_shift_swap_offer_scope()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  swap_row public.shift_swap_requests%rowtype;
  offered_employee public.employees%rowtype;
  decision_authorized boolean := false;
begin
  if tg_op = 'DELETE' then
    if old.status <> 'pending' then
      raise exception 'Decided shift swap offers are immutable' using errcode = '42501';
    end if;
    return old;
  end if;

  select * into swap_row
  from public.shift_swap_requests request
  where request.id = new.swap_request_id;
  select * into offered_employee
  from public.employees employee
  where employee.id = new.offered_by_employee_id;
  if swap_row.id is null
    or new.organization_id is distinct from swap_row.organization_id
    or offered_employee.organization_id is distinct from swap_row.organization_id
    or offered_employee.employment_status <> 'active'
    or new.offered_by_employee_id = swap_row.requested_by_employee_id then
    raise exception 'Shift swap offer scope or actor is invalid' using errcode = '23514';
  end if;

  if tg_op = 'INSERT' then
    if offered_employee.user_id is distinct from auth.uid()
      or swap_row.status <> 'pending'
      or new.status <> 'pending' then
      raise exception 'Offers may only be added to a pending shift swap request'
        using errcode = '23514';
    end if;
    return new;
  end if;
  if old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.swap_request_id is distinct from new.swap_request_id
    or old.offered_by_employee_id is distinct from new.offered_by_employee_id
    or old.offered_shift_id is distinct from new.offered_shift_id
    or old.created_at is distinct from new.created_at then
    raise exception 'Shift swap offer identity, scope, actor, and creation stamp are immutable'
      using errcode = '42501';
  end if;
  if old.status in ('approved', 'denied', 'cancelled')
    and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'Decided shift swap offers are immutable' using errcode = '42501';
  end if;
  if new.status in ('approved', 'denied') and new.status is distinct from old.status then
    select exists (
      select 1
      from private.shift_transition_requests request
      where request.related_request_id = new.swap_request_id
        and request.action = 'swap'
        and request.actor_id = auth.uid()
        and request.completed_at is null
    ) into decision_authorized;
    if not decision_authorized then
      raise exception 'Shift swap offer decisions require the atomic management command'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger shift_swap_offer_scope_guard
before insert or update or delete on public.shift_swap_offers
for each row execute function public.guard_shift_swap_offer_scope();

create function public.offer_shift_swap(
  p_request_id uuid,
  p_swap_request_id uuid,
  p_message text default null
)
returns public.shift_swap_offers
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  swap_row public.shift_swap_requests%rowtype;
  shift_row public.shifts%rowtype;
  employee_row public.employees%rowtype;
  offer_row public.shift_swap_offers%rowtype;
  shift_business_date date;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('swap-offer:' || p_request_id::text, 0));
  select * into offer_row from public.shift_swap_offers where id = p_request_id;
  if offer_row.id is not null then
    if offer_row.swap_request_id is distinct from p_swap_request_id
      or offer_row.message is distinct from nullif(btrim(p_message), '') then
      raise exception 'Shift swap offer request id was reused' using errcode = '23505';
    end if;
    select * into employee_row
    from public.employees employee
    where employee.id = offer_row.offered_by_employee_id;
    if employee_row.user_id is distinct from actor_id then
      raise exception 'Shift swap offer belongs to another employee' using errcode = '42501';
    end if;
    return offer_row;
  end if;

  select * into swap_row
  from public.shift_swap_requests request
  where request.id = p_swap_request_id
  for update;
  if swap_row.id is null then
    raise exception 'Shift swap request not found' using errcode = 'P0002';
  end if;
  if swap_row.status <> 'pending'
    or not public.can_access_location(swap_row.organization_id, swap_row.location_id) then
    raise exception 'Shift swap request is not available' using errcode = '42501';
  end if;
  select * into shift_row from public.shifts where id = swap_row.shift_id;
  if shift_row.id is null
    or shift_row.employee_id is distinct from swap_row.requested_by_employee_id
    or shift_row.status not in ('scheduled', 'claimed') then
    raise exception 'The requested shift is no longer available for swapping'
      using errcode = '23514';
  end if;
  select * into employee_row
  from public.employees employee
  where employee.organization_id = swap_row.organization_id
    and employee.user_id = actor_id
    and employee.employment_status = 'active';
  if employee_row.id is null or employee_row.id = swap_row.requested_by_employee_id then
    raise exception 'A different active employee must make the offer'
      using errcode = '23514';
  end if;
  select (shift_row.starts_at at time zone location.timezone)::date
  into shift_business_date
  from public.locations location
  where location.organization_id = shift_row.organization_id
    and location.id = shift_row.location_id
    and location.is_active;
  if not exists (
    select 1
    from public.employee_job_roles assignment
    where assignment.organization_id = shift_row.organization_id
      and assignment.employee_id = employee_row.id
      and assignment.job_role_id = shift_row.job_role_id
      and assignment.location_id = shift_row.location_id
      and assignment.effective_from <= shift_business_date
      and (assignment.effective_to is null or assignment.effective_to >= shift_business_date)
  ) then
    raise exception 'Offering employee is not assigned to the shift role and location'
      using errcode = '23514';
  end if;

  insert into public.shift_swap_offers (
    id,
    organization_id,
    swap_request_id,
    offered_by_employee_id,
    message,
    status
  ) values (
    p_request_id,
    swap_row.organization_id,
    swap_row.id,
    employee_row.id,
    nullif(btrim(p_message), ''),
    'pending'
  ) returning * into offer_row;
  return offer_row;
end
$$;

revoke insert, update, delete on public.shift_swap_offers from authenticated;
revoke all on function public.offer_shift_swap(uuid, uuid, text) from public;
grant execute on function public.offer_shift_swap(uuid, uuid, text) to authenticated;

-- Server-authoritative report/export scope ---------------------------------

create function public.report_filters_without_scope(p_filters jsonb)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  result jsonb;
  key_name text;
  value jsonb;
  normalized_key text;
begin
  if p_filters is null then
    return '{}'::jsonb;
  end if;
  if jsonb_typeof(p_filters) = 'object' then
    result := '{}'::jsonb;
    for key_name, value in select * from jsonb_each(p_filters)
    loop
      normalized_key := regexp_replace(lower(key_name), '[^a-z0-9]', '', 'g');
      if normalized_key not in (
        'location', 'locationid', 'locationids',
        'organization', 'organizationid', 'organizationids',
        'tenant', 'tenantid', 'tenantids', 'scope'
      ) then
        result := result || jsonb_build_object(
          key_name,
          public.report_filters_without_scope(value)
        );
      end if;
    end loop;
    return result;
  end if;
  if jsonb_typeof(p_filters) = 'array' then
    select coalesce(jsonb_agg(public.report_filters_without_scope(element)), '[]'::jsonb)
    into result
    from jsonb_array_elements(p_filters) element;
    return result;
  end if;
  return p_filters;
end
$$;

create function public.report_filters_are_scope_safe(p_filters jsonb)
returns boolean
language sql immutable security definer
set search_path = ''
set row_security = off
as $$
  select jsonb_typeof(coalesce(p_filters, '{}'::jsonb)) = 'object'
    and public.report_filters_without_scope(coalesce(p_filters, '{}'::jsonb))
      = coalesce(p_filters, '{}'::jsonb)
$$;

revoke all on function public.report_filters_without_scope(jsonb) from public;
revoke all on function public.report_filters_are_scope_safe(jsonb) from public;
grant execute on function public.report_filters_are_scope_safe(jsonb) to authenticated;

update public.saved_reports
set filters = public.report_filters_without_scope(filters)
where not public.report_filters_are_scope_safe(filters);

update public.report_runs
set filters = public.report_filters_without_scope(filters)
where not public.report_filters_are_scope_safe(filters);

alter table public.saved_reports
add column location_id uuid;

alter table public.saved_reports
add constraint saved_reports_location_scope_fk
foreign key (organization_id, location_id)
references public.locations(organization_id, id)
on delete cascade;

alter table public.saved_reports
add constraint saved_reports_scope_safe_filters_check
check (public.report_filters_are_scope_safe(filters));

alter table public.report_runs
add constraint report_runs_scope_safe_filters_check
check (public.report_filters_are_scope_safe(filters));

create function public.can_read_report_scope(
  p_organization_id uuid,
  p_location_id uuid
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select case
    when p_location_id is null then public.has_org_role(
      p_organization_id,
      array['owner'::public.app_role, 'admin'::public.app_role]
    )
    else public.can_read_management_location(p_organization_id, p_location_id)
  end
$$;

create function public.can_manage_report_scope(
  p_organization_id uuid,
  p_location_id uuid
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select case
    when p_location_id is null then public.can_manage_org(p_organization_id)
    else public.can_manage_location(p_organization_id, p_location_id)
  end
$$;

revoke all on function public.can_read_report_scope(uuid, uuid) from public;
revoke all on function public.can_manage_report_scope(uuid, uuid) from public;
grant execute on function public.can_read_report_scope(uuid, uuid) to authenticated;
grant execute on function public.can_manage_report_scope(uuid, uuid) to authenticated;

drop policy report_manager_read on public.saved_reports;
drop policy report_manager_write on public.saved_reports;
drop policy report_manager_read on public.report_runs;
drop policy report_manager_write on public.report_runs;
drop policy report_manager_read on public.export_jobs;
drop policy report_manager_write on public.export_jobs;

create policy saved_report_scoped_read
on public.saved_reports for select to authenticated
using (public.can_read_report_scope(organization_id, location_id));
create policy saved_report_scoped_insert
on public.saved_reports for insert to authenticated
with check (
  created_by = auth.uid()
  and public.can_manage_report_scope(organization_id, location_id)
  and public.report_filters_are_scope_safe(filters)
);
create policy saved_report_scoped_update
on public.saved_reports for update to authenticated
using (public.can_manage_report_scope(organization_id, location_id))
with check (
  public.can_manage_report_scope(organization_id, location_id)
  and public.report_filters_are_scope_safe(filters)
);
create policy saved_report_scoped_delete
on public.saved_reports for delete to authenticated
using (public.can_manage_report_scope(organization_id, location_id));

create policy report_run_scoped_read
on public.report_runs for select to authenticated
using (public.can_read_report_scope(organization_id, location_id));
create policy export_job_scoped_read
on public.export_jobs for select to authenticated
using (public.can_read_report_scope(organization_id, location_id));

create function public.guard_saved_report_scope()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if not public.report_filters_are_scope_safe(new.filters) then
    raise exception 'Report filters may not contain tenant or location selectors'
      using errcode = '22023';
  end if;
  if new.location_id is not null and not exists (
    select 1 from public.locations location
    where location.id = new.location_id
      and location.organization_id = new.organization_id
      and location.is_active
  ) then
    raise exception 'Saved report location does not belong to its organization'
      using errcode = '23514';
  end if;
  if tg_op = 'INSERT' and auth.uid() is not null and new.created_by is distinct from auth.uid() then
    raise exception 'Saved report creator must match the authenticated actor'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
    old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.created_by is distinct from new.created_by
    or old.report_type is distinct from new.report_type
    or old.created_at is distinct from new.created_at
  ) then
    raise exception 'Saved report identity, tenant, type, creator, and creation stamp are immutable'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger saved_report_scope_guard
before insert or update on public.saved_reports
for each row execute function public.guard_saved_report_scope();

create or replace function public.guard_report_job_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if tg_op = 'DELETE' and old.status in (
    'succeeded', 'partially_succeeded', 'failed', 'cancelled'
  ) then
    raise exception 'Terminal report jobs are immutable' using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' then
    if old.id is distinct from new.id
      or old.organization_id is distinct from new.organization_id
      or old.location_id is distinct from new.location_id
      or old.created_at is distinct from new.created_at
      or old.requested_by is distinct from new.requested_by then
      raise exception 'Report job request identity and authoritative scope are immutable'
        using errcode = '42501';
    end if;
    -- OLD/NEW are polymorphic trigger records. Keep table-specific fields in
    -- separate control-flow branches so PostgreSQL never prepares references
    -- to columns that do not exist on the other report table.
    if tg_table_name = 'report_runs' then
      if old.saved_report_id is distinct from new.saved_report_id
        or old.report_type is distinct from new.report_type
        or old.period_start is distinct from new.period_start
        or old.period_end is distinct from new.period_end
        or old.filters is distinct from new.filters then
        raise exception 'Report job request identity and authoritative scope are immutable'
          using errcode = '42501';
      end if;
    elsif tg_table_name = 'export_jobs' then
      if old.report_run_id is distinct from new.report_run_id
        or old.export_type is distinct from new.export_type then
        raise exception 'Report job request identity and authoritative scope are immutable'
          using errcode = '42501';
      end if;
    end if;
    if old.status in ('succeeded', 'partially_succeeded', 'failed', 'cancelled') then
      raise exception 'Terminal report jobs are immutable' using errcode = '42501';
    end if;
  end if;

  if tg_table_name = 'export_jobs' and tg_op <> 'DELETE' then
    if new.storage_path is not null
      and (
        public.storage_organization_id(new.storage_path) is distinct from new.organization_id
        or (
          new.location_id is null
          and split_part(new.storage_path, '/', 2) <> 'global'
        )
        or (
          new.location_id is not null
          and public.storage_location_id(new.storage_path) is distinct from new.location_id
        )
      ) then
      raise exception 'Report export file path must match the server-authoritative job scope'
        using errcode = '23514';
    end if;
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create or replace function public.request_report_export(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_saved_report_id uuid,
  p_report_type text,
  p_period_start date,
  p_period_end date,
  p_filters jsonb,
  p_export_type text
)
returns public.export_jobs
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_role public.app_role;
  run_row public.report_runs%rowtype;
  export_row public.export_jobs%rowtype;
  saved_row public.saved_reports%rowtype;
  clean_filters jsonb := coalesce(p_filters, '{}'::jsonb);
begin
  actor_role := public.org_role(p_organization_id);
  if actor_role is null or not public.can_operate_org(p_organization_id) then
    raise exception 'Not authorized to request this report' using errcode = '42501';
  end if;
  if p_location_id is not null then
    if not exists (
      select 1 from public.locations location
      where location.id = p_location_id
        and location.organization_id = p_organization_id
        and location.is_active
    ) or not public.can_manage_location(p_organization_id, p_location_id) then
      raise exception 'Report location is unavailable' using errcode = '42501';
    end if;
  elsif actor_role = 'manager' then
    raise exception 'Managers must select an assigned location' using errcode = '42501';
  end if;

  if p_report_type not in (
    'labor', 'attendance', 'overtime', 'tips', 'payroll', 'sales_labor',
    'receipts', 'expenses', 'inventory_variance', 'cogs', 'waste',
    'vendor_pricing', 'shift_performance', 'guest_activity'
  ) or p_export_type not in ('csv', 'pdf', 'xlsx', 'json')
    or (p_period_start is not null and p_period_end is not null and p_period_end < p_period_start)
    or jsonb_typeof(clean_filters) <> 'object'
    or pg_column_size(clean_filters) > 32768 then
    raise exception 'Invalid report export payload' using errcode = '22023';
  end if;
  if not public.report_filters_are_scope_safe(clean_filters) then
    raise exception 'Report filters may not contain tenant or location selectors; use p_location_id'
      using errcode = '22023';
  end if;

  if p_saved_report_id is not null then
    select * into saved_row
    from public.saved_reports saved
    where saved.id = p_saved_report_id;
    if saved_row.id is null
      or saved_row.organization_id is distinct from p_organization_id
      or saved_row.location_id is distinct from p_location_id
      or saved_row.report_type is distinct from p_report_type then
      raise exception 'Saved report tenant, location, or type does not match this request'
        using errcode = '23514';
    end if;
  end if;

  perform pg_advisory_xact_lock(hashtextextended('report-export:' || p_request_id::text, 0));
  select * into export_row from public.export_jobs where id = p_request_id;
  if export_row.id is not null then
    select * into run_row from public.report_runs where id = export_row.report_run_id;
    if export_row.organization_id = p_organization_id
      and export_row.location_id is not distinct from p_location_id
      and export_row.export_type = p_export_type
      and run_row.organization_id = p_organization_id
      and run_row.location_id is not distinct from p_location_id
      and run_row.saved_report_id is not distinct from p_saved_report_id
      and run_row.report_type = p_report_type
      and run_row.period_start is not distinct from p_period_start
      and run_row.period_end is not distinct from p_period_end
      and run_row.filters = clean_filters
      and run_row.requested_by = auth.uid()
      and export_row.requested_by = auth.uid() then
      return export_row;
    end if;
    raise exception 'Report export request id was reused' using errcode = '23505';
  end if;

  insert into public.report_runs (
    id,
    organization_id,
    location_id,
    saved_report_id,
    report_type,
    period_start,
    period_end,
    filters,
    status,
    requested_by
  ) values (
    p_request_id,
    p_organization_id,
    p_location_id,
    p_saved_report_id,
    p_report_type,
    p_period_start,
    p_period_end,
    clean_filters,
    'queued',
    auth.uid()
  ) returning * into run_row;

  insert into public.export_jobs (
    id,
    organization_id,
    location_id,
    report_run_id,
    export_type,
    status,
    requested_by
  ) values (
    p_request_id,
    p_organization_id,
    p_location_id,
    run_row.id,
    p_export_type,
    'queued',
    auth.uid()
  ) returning * into export_row;
  return export_row;
end
$$;

comment on function public.request_report_export(uuid, uuid, uuid, uuid, text, date, date, jsonb, text)
is 'Queues a report/export using only the separately validated location scope; JSON filters cannot select tenants or locations.';

-- Server-stamped tip approval evidence -------------------------------------

create table private.financial_approval_requests (
  request_id uuid primary key,
  organization_id uuid not null,
  location_id uuid,
  record_type text not null check (record_type in ('tip_adjustment', 'tip_policy_version')),
  record_id uuid not null,
  actor_id uuid not null,
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.financial_approval_requests from public, anon, authenticated;

create function public.guard_tip_adjustment_approval_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  trusted_actor boolean := auth.uid() is null
    or coalesce(auth.role(), '') = 'service_role';
  approval_authorized boolean := false;
  parent_status public.run_status;
begin
  if tg_op = 'INSERT' then
    if not trusted_actor and new.created_by is distinct from auth.uid() then
      raise exception 'Tip adjustment creator must match the authenticated actor'
        using errcode = '42501';
    end if;
    if not trusted_actor and (new.approved_by is not null or new.approved_at is not null) then
      raise exception 'Tip adjustment approval evidence is server-managed'
        using errcode = '42501';
    end if;
    select run.status into parent_status
    from public.tip_runs run
    where run.id = new.tip_run_id
    for update;
    if parent_status is distinct from 'draft'::public.run_status then
      raise exception 'Tip adjustments may only be added to draft runs'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    if not trusted_actor and old.created_by is distinct from auth.uid() then
      raise exception 'Only the adjustment creator may remove their draft adjustment'
        using errcode = '42501';
    end if;
    if old.approved_at is not null then
      raise exception 'Approved tip adjustments are immutable' using errcode = '42501';
    end if;
    select run.status into parent_status
    from public.tip_runs run
    where run.id = old.tip_run_id
    for update;
    if parent_status is distinct from 'draft'::public.run_status then
      raise exception 'Tip adjustments may only be removed from draft runs'
        using errcode = '42501';
    end if;
    return old;
  end if;

  if old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.tip_run_id is distinct from new.tip_run_id
    or old.created_by is distinct from new.created_by
    or old.created_at is distinct from new.created_at then
    raise exception 'Tip adjustment identity, run, creator, and creation stamp are immutable'
      using errcode = '42501';
  end if;
  if not trusted_actor
    and old.created_by is distinct from auth.uid()
    and (
      old.employee_id is distinct from new.employee_id
      or old.amount_cents is distinct from new.amount_cents
      or old.reason is distinct from new.reason
    ) then
    raise exception 'Only the adjustment creator may edit their draft adjustment'
      using errcode = '42501';
  end if;
  if old.approved_at is not null and to_jsonb(new) is distinct from to_jsonb(old) then
    raise exception 'Approved tip adjustments are immutable' using errcode = '42501';
  end if;
  select run.status into parent_status
  from public.tip_runs run
  where run.id = new.tip_run_id
  for update;
  if parent_status is distinct from 'draft'::public.run_status then
    raise exception 'Tip adjustments may only be edited on draft runs'
      using errcode = '42501';
  end if;

  if old.approved_by is distinct from new.approved_by
    or old.approved_at is distinct from new.approved_at then
    select exists (
      select 1
      from private.financial_approval_requests request
      where request.record_type = 'tip_adjustment'
        and request.record_id = new.id
        and request.actor_id = auth.uid()
        and request.completed_at is null
    ) into approval_authorized;
    if not trusted_actor and not approval_authorized then
      raise exception 'Tip adjustment approval evidence is server-managed'
        using errcode = '42501';
    end if;
    if new.approved_by is distinct from auth.uid() or new.approved_at is null then
      raise exception 'Tip adjustment approval must be stamped by the authenticated approver'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger tip_adjustment_approval_evidence_guard
before insert or update or delete on public.tip_adjustments
for each row execute function public.guard_tip_adjustment_approval_evidence();

create function public.guard_tip_policy_version_approval_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  trusted_actor boolean := auth.uid() is null
    or coalesce(auth.role(), '') = 'service_role';
  approval_authorized boolean := false;
begin
  if tg_op = 'INSERT' then
    if not trusted_actor and new.created_by is distinct from auth.uid() then
      raise exception 'Tip policy version creator must match the authenticated actor'
        using errcode = '42501';
    end if;
    if not trusted_actor and (new.approved_by is not null or new.approved_at is not null) then
      raise exception 'Tip policy version approval evidence is server-managed'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.approved_at is not null then
    raise exception 'Approved tip policy versions are immutable'
      using errcode = '42501';
  end if;
  if tg_op = 'DELETE'
    and not trusted_actor
    and old.created_by is distinct from auth.uid() then
    raise exception 'Only the policy-version creator may edit or remove their draft'
      using errcode = '42501';
  end if;

  if tg_op = 'UPDATE' and (
    old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.policy_id is distinct from new.policy_id
    or old.version is distinct from new.version
    or old.created_by is distinct from new.created_by
    or old.created_at is distinct from new.created_at
  ) then
    raise exception 'Tip policy version identity, policy, version, creator, and creation stamp are immutable'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE'
    and not trusted_actor
    and old.created_by is distinct from auth.uid()
    and (
      old.distribution_method is distinct from new.distribution_method
      or old.effective_from is distinct from new.effective_from
      or old.effective_to is distinct from new.effective_to
      or old.source_rules is distinct from new.source_rules
      or old.rounding_rule is distinct from new.rounding_rule
    ) then
    raise exception 'Only the policy-version creator may edit their draft body'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
    old.approved_by is distinct from new.approved_by
    or old.approved_at is distinct from new.approved_at
  ) then
    select exists (
      select 1
      from private.financial_approval_requests request
      where request.record_type = 'tip_policy_version'
        and request.record_id = new.id
        and request.actor_id = auth.uid()
        and request.completed_at is null
    ) into approval_authorized;
    if not trusted_actor and not approval_authorized then
      raise exception 'Tip policy version approval evidence is server-managed'
        using errcode = '42501';
    end if;
    if new.approved_by is distinct from auth.uid() or new.approved_at is null then
      raise exception 'Tip policy version approval must be stamped by the authenticated approver'
        using errcode = '42501';
    end if;
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger tip_policy_version_approval_evidence_guard
before insert or update or delete on public.tip_pool_policy_versions
for each row execute function public.guard_tip_policy_version_approval_evidence();

create function public.guard_tip_eligibility_rule_version()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  target_policy_version_id uuid := case
    when tg_op = 'DELETE' then old.policy_version_id
    else new.policy_version_id
  end;
  parent_approved_at timestamptz;
  parent_created_by uuid;
begin
  if tg_op = 'UPDATE' and (
    old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.policy_version_id is distinct from new.policy_version_id
    or old.job_role_id is distinct from new.job_role_id
  ) then
    raise exception 'Tip eligibility rule identity, policy version, and job role are immutable'
      using errcode = '42501';
  end if;
  select version.approved_at, version.created_by
  into parent_approved_at, parent_created_by
  from public.tip_pool_policy_versions version
  where version.id = target_policy_version_id
  for update;
  if parent_approved_at is not null then
    raise exception 'Approved tip policy eligibility rules are immutable'
      using errcode = '42501';
  end if;
  if auth.uid() is not null
    and coalesce(auth.role(), '') <> 'service_role'
    and parent_created_by is distinct from auth.uid() then
    raise exception 'Only the policy-version creator may author eligibility rules'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger tip_eligibility_rule_version_guard
before insert or update or delete on public.tip_pool_eligibility_rules
for each row execute function public.guard_tip_eligibility_rule_version();

revoke insert, update on public.tip_adjustments from authenticated;
grant insert (
  id,
  organization_id,
  tip_run_id,
  employee_id,
  amount_cents,
  reason,
  created_by
) on public.tip_adjustments to authenticated;
grant update (
  employee_id,
  amount_cents,
  reason
) on public.tip_adjustments to authenticated;

revoke insert, update on public.tip_pool_policy_versions from authenticated;
grant insert (
  id,
  organization_id,
  policy_id,
  version,
  distribution_method,
  effective_from,
  effective_to,
  source_rules,
  rounding_rule,
  created_by
) on public.tip_pool_policy_versions to authenticated;
grant update (
  distribution_method,
  effective_from,
  effective_to,
  source_rules,
  rounding_rule
) on public.tip_pool_policy_versions to authenticated;

create function public.approve_tip_adjustment(
  p_request_id uuid,
  p_adjustment_id uuid
)
returns public.tip_adjustments
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  adjustment public.tip_adjustments%rowtype;
  run_row public.tip_runs%rowtype;
  prior private.financial_approval_requests%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('financial-approval:' || p_request_id::text, 0));
  select * into prior
  from private.financial_approval_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null then
    if prior.record_type <> 'tip_adjustment'
      or prior.record_id is distinct from p_adjustment_id
      or prior.actor_id is distinct from actor_id then
      raise exception 'Financial approval request id was reused' using errcode = '23505';
    end if;
    select * into adjustment from public.tip_adjustments where id = p_adjustment_id;
    return adjustment;
  end if;

  select * into adjustment
  from public.tip_adjustments adjustment_row
  where adjustment_row.id = p_adjustment_id
  for update;
  if adjustment.id is null then
    raise exception 'Tip adjustment not found' using errcode = 'P0002';
  end if;
  select * into run_row
  from public.tip_runs run_candidate
  where run_candidate.id = adjustment.tip_run_id
  for update;
  if run_row.id is null
    or run_row.organization_id is distinct from adjustment.organization_id then
    raise exception 'Tip adjustment run scope is invalid' using errcode = '23514';
  end if;
  if not public.can_manage_location(run_row.organization_id, run_row.location_id) then
    raise exception 'Not authorized to approve this tip adjustment'
      using errcode = '42501';
  end if;
  if run_row.locked_at is not null then
    raise exception 'Approved tip runs and their inputs are immutable'
      using errcode = '42501';
  end if;
  if adjustment.approved_at is not null then
    raise exception 'Tip adjustment is already approved' using errcode = '23514';
  end if;
  if adjustment.created_by = actor_id then
    raise exception 'Tip adjustments require approval by a different authorized person'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.tip_run_participants participant
    where participant.tip_run_id = run_row.id
      and participant.employee_id = adjustment.employee_id
  ) and not exists (
    select 1
    from public.employee_job_roles assignment
    where assignment.organization_id = run_row.organization_id
      and assignment.location_id = run_row.location_id
      and assignment.employee_id = adjustment.employee_id
      and assignment.effective_from <= run_row.business_date
      and (assignment.effective_to is null
        or assignment.effective_to >= run_row.business_date)
  ) then
    raise exception 'Adjusted employee must be a current participant or have an effective location role'
      using errcode = '23514';
  end if;

  insert into private.financial_approval_requests (
    request_id,
    organization_id,
    location_id,
    record_type,
    record_id,
    actor_id
  ) values (
    p_request_id,
    run_row.organization_id,
    run_row.location_id,
    'tip_adjustment',
    adjustment.id,
    actor_id
  );

  update public.tip_adjustments adjustment_update
  set approved_by = actor_id,
      approved_at = clock_timestamp()
  where adjustment_update.id = adjustment.id
  returning * into adjustment;

  update private.financial_approval_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return adjustment;
end
$$;

create function public.approve_tip_policy_version(
  p_request_id uuid,
  p_policy_version_id uuid
)
returns public.tip_pool_policy_versions
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  version_row public.tip_pool_policy_versions%rowtype;
  policy_row public.tip_pool_policies%rowtype;
  prior private.financial_approval_requests%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('financial-approval:' || p_request_id::text, 0));
  select * into prior
  from private.financial_approval_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null then
    if prior.record_type <> 'tip_policy_version'
      or prior.record_id is distinct from p_policy_version_id
      or prior.actor_id is distinct from actor_id then
      raise exception 'Financial approval request id was reused' using errcode = '23505';
    end if;
    select * into version_row
    from public.tip_pool_policy_versions
    where id = p_policy_version_id;
    return version_row;
  end if;

  select * into version_row
  from public.tip_pool_policy_versions version_candidate
  where version_candidate.id = p_policy_version_id
  for update;
  if version_row.id is null then
    raise exception 'Tip policy version not found' using errcode = 'P0002';
  end if;
  select * into policy_row
  from public.tip_pool_policies policy
  where policy.id = version_row.policy_id;
  if policy_row.id is null
    or policy_row.organization_id is distinct from version_row.organization_id then
    raise exception 'Tip policy version scope is invalid' using errcode = '23514';
  end if;
  if not (case
    when policy_row.location_id is null
      then public.can_manage_org(policy_row.organization_id)
    else public.can_manage_location(policy_row.organization_id, policy_row.location_id)
  end) then
    raise exception 'Not authorized to approve this tip policy version'
      using errcode = '42501';
  end if;
  if version_row.approved_at is not null then
    raise exception 'Tip policy version is already approved' using errcode = '23514';
  end if;
  if version_row.created_by = actor_id then
    raise exception 'Tip policy versions require approval by a different authorized person'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.tip_pool_eligibility_rules rule
    where rule.policy_version_id = version_row.id
      and rule.organization_id = version_row.organization_id
  ) then
    raise exception 'Tip policy version requires at least one eligibility rule'
      using errcode = '23514';
  end if;

  insert into private.financial_approval_requests (
    request_id,
    organization_id,
    location_id,
    record_type,
    record_id,
    actor_id
  ) values (
    p_request_id,
    policy_row.organization_id,
    policy_row.location_id,
    'tip_policy_version',
    version_row.id,
    actor_id
  );

  update public.tip_pool_policy_versions version_update
  set approved_by = actor_id,
      approved_at = clock_timestamp()
  where version_update.id = version_row.id
  returning * into version_row;

  update private.financial_approval_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return version_row;
end
$$;

revoke all on function public.approve_tip_adjustment(uuid, uuid) from public;
revoke all on function public.approve_tip_policy_version(uuid, uuid) from public;
grant execute on function public.approve_tip_adjustment(uuid, uuid) to authenticated;
grant execute on function public.approve_tip_policy_version(uuid, uuid) to authenticated;

comment on function public.approve_tip_adjustment(uuid, uuid)
is 'Server-stamps a location-authorized second-person approval and records an idempotency key.';
comment on function public.approve_tip_policy_version(uuid, uuid)
is 'Server-stamps a scope-authorized second-person approval after eligibility rules exist.';

-- A browser session may create and edit a draft tip-run header, but may not
-- forge calculated totals or financial approval evidence. Calculation and
-- approval remain SECURITY DEFINER commands; the approval command also
-- enforces separation from the run creator.
create function public.guard_tip_run_financial_evidence()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  trusted_actor boolean := auth.uid() is null
    or coalesce(auth.role(), '') = 'service_role';
begin
  if tg_op = 'INSERT' then
    if not trusted_actor and (
      new.created_by is distinct from auth.uid()
      or new.status <> 'draft'
      or new.distributable_cents <> 0
      or new.allocated_cents <> 0
      or new.calculated_at is not null
      or new.approved_by is not null
      or new.approved_at is not null
      or new.locked_at is not null
      or new.calculation_version <> 'largest-remainder-v1'
    ) then
      raise exception 'Tip runs must begin as actor-owned unstamped drafts'
        using errcode = '42501';
    end if;
    return new;
  end if;

  if old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.location_id is distinct from new.location_id
    or old.created_by is distinct from new.created_by
    or old.created_at is distinct from new.created_at
    or old.calculation_version is distinct from new.calculation_version then
    raise exception 'Tip run identity, scope, creator, and creation stamp are immutable'
      using errcode = '42501';
  end if;
  if old.status <> 'draft' and (
    old.policy_version_id is distinct from new.policy_version_id
    or old.closeout_id is distinct from new.closeout_id
    or old.business_date is distinct from new.business_date
    or old.shift_label is distinct from new.shift_label
  ) then
    raise exception 'Calculated and approved tip run inputs are immutable'
      using errcode = '42501';
  end if;
  if auth.uid() is not null
    and coalesce(auth.role(), '') <> 'service_role'
    and old.created_by is distinct from auth.uid()
    and (
      old.policy_version_id is distinct from new.policy_version_id
      or old.closeout_id is distinct from new.closeout_id
      or old.business_date is distinct from new.business_date
      or old.shift_label is distinct from new.shift_label
    ) then
    raise exception 'Only the tip-run creator may edit draft run inputs'
      using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger tip_run_financial_evidence_guard
before insert or update on public.tip_runs
for each row execute function public.guard_tip_run_financial_evidence();

revoke insert, update, delete on public.tip_runs from authenticated;
grant insert (
  id,
  organization_id,
  location_id,
  policy_version_id,
  closeout_id,
  business_date,
  shift_label,
  created_by
) on public.tip_runs to authenticated;
grant update (
  policy_version_id,
  closeout_id,
  business_date,
  shift_label
) on public.tip_runs to authenticated;

revoke insert, update, delete on public.tip_sources from authenticated;
revoke insert, update, delete on public.tip_run_participants from authenticated;
revoke insert, update, delete on public.tip_allocations from authenticated;

create or replace function public.approve_tip_run(p_tip_run_id uuid)
returns public.tip_runs
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  run_record public.tip_runs%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into run_record
  from public.tip_runs run_candidate
  where run_candidate.id = p_tip_run_id
  for update;
  if run_record.id is null then
    raise exception 'Tip run not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(run_record.organization_id, run_record.location_id) then
    raise exception 'Not authorized to approve this tip run' using errcode = '42501';
  end if;
  if run_record.created_by = actor_id then
    raise exception 'Tip runs require approval by a different authorized person'
      using errcode = '42501';
  end if;
  if run_record.status = 'approved' then
    if run_record.approved_by = actor_id then return run_record; end if;
    raise exception 'Tip run was approved by another actor' using errcode = '42501';
  end if;
  if run_record.status <> 'calculated'
    or run_record.allocated_cents <> run_record.distributable_cents then
    raise exception 'Only a balanced calculated tip run may be approved'
      using errcode = '23514';
  end if;
  -- Recalculate under the same row lock so approval never stamps stale
  -- allocations after an input or adjustment changed.
  select * into run_record from public.calculate_tip_run(run_record.id);
  if run_record.calculation_version <> 'largest-remainder-v1'
    or run_record.allocated_cents <> run_record.distributable_cents
    or run_record.distributable_cents is distinct from (
      select coalesce(sum(source.amount_cents) filter (where source.is_distributable), 0)
      from public.tip_sources source
      where source.tip_run_id = run_record.id
    )
    or run_record.allocated_cents is distinct from (
      select coalesce(sum(allocation.final_amount_cents), 0)
      from public.tip_allocations allocation
      where allocation.tip_run_id = run_record.id
    ) then
    raise exception 'Tip run calculation evidence is stale or unbalanced'
      using errcode = '23514';
  end if;
  update public.tip_runs run_update
  set status = 'approved',
      approved_by = actor_id,
      approved_at = clock_timestamp(),
      locked_at = clock_timestamp()
  where run_update.id = run_record.id
  returning * into run_record;
  return run_record;
end
$$;

create or replace function public.guard_closeout_mutation()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  trusted_actor boolean := auth.uid() is null
    or coalesce(auth.role(), '') = 'service_role';
  input_changed boolean;
begin
  if tg_op = 'INSERT' then
    if not trusted_actor and (
      new.status <> 'pending'
      or new.submitted_by is distinct from auth.uid()
      or new.approved_by is not null
      or new.approved_at is not null
    ) then
      raise exception 'Closeouts must begin as actor-owned pending submissions'
        using errcode = '42501';
    end if;
    if not trusted_actor then new.submitted_at := clock_timestamp(); end if;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.status in ('approved', 'rejected') then
      raise exception 'Reviewed closeouts are immutable' using errcode = '42501';
    end if;
    if not trusted_actor and old.submitted_by is distinct from auth.uid() then
      raise exception 'Only the submitter may remove a pending closeout'
        using errcode = '42501';
    end if;
    return old;
  end if;
  if old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.location_id is distinct from new.location_id
    or old.business_date is distinct from new.business_date
    or old.shift_label is distinct from new.shift_label
    or old.submitted_by is distinct from new.submitted_by
    or old.submitted_at is distinct from new.submitted_at then
    raise exception 'Closeout identity, scope, and submission stamps are immutable'
      using errcode = '42501';
  end if;
  if old.status in ('approved', 'rejected') then
    raise exception 'Reviewed closeouts are immutable' using errcode = '42501';
  end if;

  input_changed := old.gross_sales_cents is distinct from new.gross_sales_cents
    or old.net_sales_cents is distinct from new.net_sales_cents
    or old.cash_sales_cents is distinct from new.cash_sales_cents
    or old.card_sales_cents is distinct from new.card_sales_cents
    or old.expected_cash_cents is distinct from new.expected_cash_cents
    or old.actual_cash_cents is distinct from new.actual_cash_cents
    or old.covers is distinct from new.covers
    or old.comps_cents is distinct from new.comps_cents
    or old.voids_cents is distinct from new.voids_cents
    or old.service_charges_cents is distinct from new.service_charges_cents
    or old.card_tips_cents is distinct from new.card_tips_cents
    or old.cash_tips_cents is distinct from new.cash_tips_cents
    or old.notes is distinct from new.notes;
  if not trusted_actor
    and input_changed
    and new.status = old.status
    and old.submitted_by is distinct from auth.uid() then
    raise exception 'Only the submitter may edit pending closeout inputs'
      using errcode = '42501';
  end if;
  if new.status = 'approved' and (
    new.approved_by is distinct from auth.uid() or new.approved_at is null
  ) then
    raise exception 'Approved closeout requires actor approval stamps'
      using errcode = '42501';
  end if;
  if new.status = 'rejected' and (new.approved_by is not null or new.approved_at is not null) then
    raise exception 'Rejected closeout cannot carry approval stamps'
      using errcode = '23514';
  end if;
  return new;
end
$$;

create or replace function public.guard_closeout_attachment_mutation()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  parent_status public.review_status;
  parent_submitter uuid;
  target_closeout_id uuid := case
    when tg_op = 'DELETE' then old.closeout_id
    else new.closeout_id
  end;
  trusted_actor boolean := auth.uid() is null
    or coalesce(auth.role(), '') = 'service_role';
begin
  select closeout.status, closeout.submitted_by
  into parent_status, parent_submitter
  from public.shift_closeouts closeout
  where closeout.id = target_closeout_id
  for update;
  if parent_status in ('approved', 'rejected') then
    raise exception 'Reviewed closeout attachments are immutable'
      using errcode = '42501';
  end if;
  if tg_op = 'UPDATE' and (
    new.id is distinct from old.id
    or new.organization_id is distinct from old.organization_id
    or new.closeout_id is distinct from old.closeout_id
    or new.storage_path is distinct from old.storage_path
    or new.uploaded_by is distinct from old.uploaded_by
  ) then
    raise exception 'Closeout attachment identity and parent are immutable'
      using errcode = '42501';
  end if;
  if not trusted_actor and parent_submitter is distinct from auth.uid() then
    raise exception 'Only the closeout submitter may mutate pending attachments'
      using errcode = '42501';
  end if;
  if tg_op = 'INSERT' and not trusted_actor
    and new.uploaded_by is distinct from auth.uid() then
    raise exception 'Closeout attachment uploader must match the authenticated actor'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create or replace function public.approve_closeout(
  p_closeout_id uuid,
  p_approved boolean,
  p_note text default null
)
returns public.shift_closeouts
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  result public.shift_closeouts%rowtype;
  requested_status public.review_status := case
    when p_approved then 'approved'::public.review_status
    else 'rejected'::public.review_status
  end;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into result
  from public.shift_closeouts closeout
  where closeout.id = p_closeout_id
  for update;
  if result.id is null then
    raise exception 'Closeout not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(result.organization_id, result.location_id) then
    raise exception 'Not authorized to review this closeout' using errcode = '42501';
  end if;
  if p_approved is null then
    raise exception 'Closeout decision is required' using errcode = '22023';
  end if;
  if p_note is not null and length(btrim(p_note)) > 2000 then
    raise exception 'Closeout review note exceeds 2000 characters' using errcode = '22023';
  end if;
  if result.submitted_by = actor_id then
    raise exception 'Closeouts require review by a different authorized person'
      using errcode = '42501';
  end if;
  if result.status = requested_status then return result; end if;
  if result.status not in ('pending', 'in_review') then
    raise exception 'Reviewed closeouts are immutable' using errcode = '42501';
  end if;
  update public.shift_closeouts closeout_update
  set status = requested_status,
      approved_by = case when p_approved then actor_id else null end,
      approved_at = case when p_approved then clock_timestamp() else null end,
      notes = concat_ws(E'\n', closeout_update.notes, nullif(btrim(p_note), ''))
  where closeout_update.id = result.id
  returning * into result;
  return result;
end
$$;

comment on function public.approve_tip_run(uuid)
is 'Server-stamps a balanced tip run only when an authorized approver differs from its creator.';
comment on function public.approve_closeout(uuid, boolean, text)
is 'Reviews a closeout only when the authorized reviewer differs from its submitter.';

-- Reissuable, one-time invitation lifecycle --------------------------------

alter table public.user_invitations
drop constraint if exists user_invitations_organization_id_email_key;

create unique index user_invitations_live_email_unique
on public.user_invitations (organization_id, email)
where accepted_at is null and revoked_at is null;

create table private.invitation_command_requests (
  request_id uuid primary key,
  organization_id uuid not null,
  invitation_id uuid not null,
  actor_id uuid not null,
  action text not null check (action = 'revoke'),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.invitation_command_requests from public, anon, authenticated;

create function public.guard_owner_invitation_target()
returns trigger
language plpgsql
set search_path = ''
as $$
declare
  target_role public.app_role;
  target_organization_id uuid;
  trusted_actor boolean := auth.uid() is null
    or current_user in ('postgres', 'supabase_admin', 'service_role')
    or coalesce(auth.role(), '') = 'service_role';
begin
  target_role := case when tg_op = 'DELETE' then old.role else new.role end;
  target_organization_id := case when tg_op = 'DELETE' then old.organization_id else new.organization_id end;
  if tg_op = 'UPDATE' and (
    old.id is distinct from new.id
    or old.organization_id is distinct from new.organization_id
    or old.email is distinct from new.email
    or old.token_hash is distinct from new.token_hash
    or old.invited_by is distinct from new.invited_by
    or old.created_at is distinct from new.created_at
  ) then
    raise exception 'Invitation identity, tenant, email, token hash, inviter, and creation stamp are immutable'
      using errcode = '42501';
  end if;
  if target_role = 'owner' and not trusted_actor and not (
    public.org_role(target_organization_id) = 'owner'
    and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
  ) then
    raise exception 'Only an MFA-verified owner may mutate an Owner invitation'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$$;

create trigger user_invitations_owner_target_guard
before insert or update or delete on public.user_invitations
for each row execute function public.guard_owner_invitation_target();

create or replace function public.provision_user_invitation(
  p_auth_user_id uuid,
  p_organization_id uuid,
  p_email text,
  p_display_name text,
  p_role public.app_role,
  p_location_ids uuid[],
  p_token_hash text,
  p_expires_at timestamptz,
  p_employee_id uuid
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_role public.app_role;
  target_email text;
  target_metadata jsonb;
  invitation_id uuid;
  existing_invitation public.user_invitations%rowtype;
  existing_membership public.organization_memberships%rowtype;
  existing_employee public.employees%rowtype;
  clean_location_ids uuid[];
begin
  if auth.uid() is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select membership.role into actor_role
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = auth.uid()
    and membership.status = 'active';
  if actor_role is null or actor_role not in ('owner', 'admin') then
    raise exception 'Only an owner or admin may invite users' using errcode = '42501';
  end if;
  if actor_role = 'owner' and coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Owner administrative actions require MFA' using errcode = '42501';
  end if;
  if p_role = 'owner' and actor_role <> 'owner' then
    raise exception 'Only an owner may assign the owner role' using errcode = '42501';
  end if;

  select coalesce(array_agg(distinct location_id order by location_id), '{}'::uuid[])
  into clean_location_ids
  from unnest(coalesce(p_location_ids, '{}'::uuid[])) requested(location_id);
  if cardinality(clean_location_ids) <> cardinality(coalesce(p_location_ids, '{}'::uuid[])) then
    raise exception 'Location scope contains duplicates' using errcode = '22023';
  end if;
  if p_role in ('manager', 'employee') and cardinality(clean_location_ids) = 0 then
    raise exception 'Managers and employees require at least one location'
      using errcode = '22023';
  end if;
  if exists (
    select 1
    from unnest(clean_location_ids) requested(location_id)
    where not exists (
      select 1 from public.locations location
      where location.organization_id = p_organization_id
        and location.id = requested.location_id
        and location.is_active
    )
  ) then
    raise exception 'Invitation contains an unavailable location' using errcode = '23503';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '7 days' then
    raise exception 'Invitation expiry is outside the allowed window' using errcode = '22023';
  end if;
  if length(btrim(p_display_name)) not between 2 and 120
    or lower(btrim(p_email)) <> btrim(p_email)
    or position('@' in p_email) <= 1
    or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invitation fields are invalid' using errcode = '22023';
  end if;

  select lower(auth_user.email), auth_user.raw_app_meta_data
  into target_email, target_metadata
  from auth.users auth_user
  where auth_user.id = p_auth_user_id;
  if target_email is null or target_email <> p_email then
    raise exception 'Auth invitation identity does not match' using errcode = '23514';
  end if;
  if target_metadata ->> 'pending_organization_id' is distinct from p_organization_id::text
    or target_metadata ->> 'pending_role' is distinct from p_role::text
    or target_metadata ->> 'invited_by' is distinct from auth.uid()::text then
    raise exception 'Auth invitation metadata does not match the requested membership'
      using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended('user-invitation:' || p_organization_id::text || ':' || p_email, 0)
  );

  select invitation.* into existing_invitation
  from public.user_invitations invitation
  where invitation.organization_id = p_organization_id
    and invitation.token_hash = p_token_hash
  limit 1;
  if existing_invitation.id is not null then
    if existing_invitation.email = p_email
      and existing_invitation.role = p_role
      and existing_invitation.location_ids = clean_location_ids
      and existing_invitation.expires_at = p_expires_at
      and existing_invitation.invited_by = auth.uid()
      and existing_invitation.accepted_at is null
      and existing_invitation.revoked_at is null then
      return existing_invitation.id;
    end if;
    raise exception 'Invitation token correlation was reused' using errcode = '23505';
  end if;

  if exists (
    select 1
    from public.user_invitations invitation
    where invitation.organization_id = p_organization_id
      and invitation.email = p_email
      and invitation.accepted_at is null
      and invitation.revoked_at is null
      and invitation.expires_at > now()
  ) then
    raise exception 'An active invitation already exists for this email'
      using errcode = '23505';
  end if;

  update public.user_invitations invitation
  set revoked_at = clock_timestamp()
  where invitation.organization_id = p_organization_id
    and invitation.email = p_email
    and invitation.accepted_at is null
    and invitation.revoked_at is null
    and invitation.expires_at <= now();

  if exists (
    select 1
    from public.organization_memberships membership
    join auth.users auth_user on auth_user.id = membership.user_id
    where membership.organization_id = p_organization_id
      and lower(auth_user.email) = p_email
      and membership.user_id <> p_auth_user_id
  ) then
    raise exception 'This email is linked to a different Auth identity in the organization'
      using errcode = '23505';
  end if;

  select * into existing_membership
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_auth_user_id
  for update;
  if existing_membership.id is not null and existing_membership.status <> 'invited' then
    raise exception 'This user already has active or suspended organization access'
      using errcode = '23505';
  end if;

  select * into existing_employee
  from public.employees employee
  where employee.organization_id = p_organization_id
    and employee.user_id = p_auth_user_id
  for update;
  if existing_employee.id is not null and existing_employee.employment_status <> 'invited' then
    raise exception 'This Auth identity is linked to an existing employee record'
      using errcode = '23505';
  end if;
  if exists (
    select 1 from public.employees employee
    where employee.organization_id = p_organization_id
      and lower(employee.email) = p_email
      and employee.user_id is distinct from p_auth_user_id
  ) then
    raise exception 'This email is linked to a different employee record'
      using errcode = '23505';
  end if;

  insert into public.user_invitations (
    organization_id,
    email,
    role,
    location_ids,
    token_hash,
    expires_at,
    invited_by
  ) values (
    p_organization_id,
    p_email,
    p_role,
    clean_location_ids,
    p_token_hash,
    p_expires_at,
    auth.uid()
  ) returning id into invitation_id;

  if existing_membership.id is null then
    insert into public.organization_memberships (
      organization_id,
      user_id,
      role,
      status,
      invited_by
    ) values (
      p_organization_id,
      p_auth_user_id,
      p_role,
      'invited',
      auth.uid()
    );
  else
    update public.organization_memberships membership
    set role = p_role,
        invited_by = auth.uid(),
        invited_at = clock_timestamp(),
        updated_at = clock_timestamp()
    where membership.id = existing_membership.id;
  end if;

  delete from public.location_memberships location_membership
  where location_membership.organization_id = p_organization_id
    and location_membership.user_id = p_auth_user_id;
  insert into public.location_memberships (
    organization_id,
    location_id,
    user_id,
    is_primary
  )
  select p_organization_id,
    requested.location_id,
    p_auth_user_id,
    requested.ordinality = 1
  from unnest(clean_location_ids) with ordinality requested(location_id, ordinality);

  if existing_employee.id is null then
    insert into public.employees (
      id,
      organization_id,
      user_id,
      home_location_id,
      display_name,
      email,
      employment_status
    ) values (
      p_employee_id,
      p_organization_id,
      p_auth_user_id,
      clean_location_ids[1],
      btrim(p_display_name),
      p_email,
      'invited'
    );
  else
    update public.employees employee
    set home_location_id = clean_location_ids[1],
        display_name = btrim(p_display_name),
        email = p_email,
        updated_at = clock_timestamp()
    where employee.id = existing_employee.id;
  end if;
  return invitation_id;
end
$$;

create function public.revoke_user_invitation(
  p_request_id uuid,
  p_invitation_id uuid
)
returns public.user_invitations
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  invitation public.user_invitations%rowtype;
  prior private.invitation_command_requests%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('invitation-command:' || p_request_id::text, 0));
  select * into prior
  from private.invitation_command_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null then
    if prior.invitation_id is distinct from p_invitation_id
      or prior.actor_id is distinct from actor_id
      or prior.action <> 'revoke' then
      raise exception 'Invitation command request id was reused' using errcode = '23505';
    end if;
    select * into invitation from public.user_invitations where id = p_invitation_id;
    return invitation;
  end if;

  select * into invitation
  from public.user_invitations invitation_row
  where invitation_row.id = p_invitation_id
  for update;
  if invitation.id is null then
    raise exception 'Invitation not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_org(invitation.organization_id)
    or (
      invitation.role = 'owner'
      and not (
        public.org_role(invitation.organization_id) = 'owner'
        and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
      )
    ) then
    raise exception 'Not authorized to revoke this invitation' using errcode = '42501';
  end if;
  if invitation.accepted_at is not null then
    raise exception 'Accepted invitations cannot be revoked' using errcode = '23514';
  end if;

  insert into private.invitation_command_requests (
    request_id,
    organization_id,
    invitation_id,
    actor_id,
    action
  ) values (
    p_request_id,
    invitation.organization_id,
    invitation.id,
    actor_id,
    'revoke'
  );

  update public.user_invitations invitation_update
  set revoked_at = coalesce(invitation_update.revoked_at, clock_timestamp())
  where invitation_update.id = invitation.id
  returning * into invitation;

  update private.invitation_command_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return invitation;
end
$$;

revoke insert, update, delete on public.user_invitations from authenticated;
revoke all on function public.revoke_user_invitation(uuid, uuid) from public;
grant execute on function public.revoke_user_invitation(uuid, uuid) to authenticated;

comment on function public.provision_user_invitation(uuid, uuid, text, text, public.app_role, uuid[], text, timestamptz, uuid)
is 'Creates or safely reissues an expired/revoked invitation for the same invited Auth identity; active/suspended identities require an explicit member lifecycle.';

-- Time-correction submission and entirely missed punches -------------------

create or replace function public.record_clock_in(
  p_request_id uuid,
  p_location_id uuid,
  p_job_role_id uuid,
  p_scheduled_shift_id uuid default null
)
returns public.time_entries
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  employee_row public.employees%rowtype;
  shift_row public.shifts%rowtype;
  existing public.time_entries%rowtype;
  clocked_in_at timestamptz := clock_timestamp();
  work_date date;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into location_row
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if location_row.id is null
    or not public.can_access_location(location_row.organization_id, location_row.id) then
    raise exception 'Location is unavailable' using errcode = '42501';
  end if;
  select * into employee_row
  from public.employees employee
  where employee.organization_id = location_row.organization_id
    and employee.user_id = actor_id
    and employee.employment_status = 'active';
  if employee_row.id is null then
    raise exception 'Active employee profile is required' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('clock-in:' || p_request_id::text, 0));
  select * into existing from public.time_entries where id = p_request_id;
  if existing.id is not null then
    if existing.organization_id = location_row.organization_id
      and existing.location_id = location_row.id
      and existing.employee_id = employee_row.id
      and existing.job_role_id = p_job_role_id
      and existing.scheduled_shift_id is not distinct from p_scheduled_shift_id then
      return existing;
    end if;
    raise exception 'Clock-in request id was reused' using errcode = '23505';
  end if;

  work_date := (clocked_in_at at time zone location_row.timezone)::date;
  if not exists (
    select 1
    from public.employee_job_roles assignment
    where assignment.organization_id = location_row.organization_id
      and assignment.location_id = location_row.id
      and assignment.employee_id = employee_row.id
      and assignment.job_role_id = p_job_role_id
      and assignment.effective_from <= work_date
      and (assignment.effective_to is null or assignment.effective_to >= work_date)
  ) then
    raise exception 'Employee is not assigned to this role and location on the work date'
      using errcode = '23514';
  end if;
  if exists (
    select 1 from public.time_entries entry
    where entry.employee_id = employee_row.id and entry.clocked_out_at is null
  ) then
    raise exception 'Employee already has an open time entry' using errcode = '23505';
  end if;

  if p_scheduled_shift_id is not null then
    select * into shift_row
    from public.shifts shift_candidate
    where shift_candidate.id = p_scheduled_shift_id;
    if shift_row.id is null
      or shift_row.organization_id <> location_row.organization_id
      or shift_row.location_id <> location_row.id
      or shift_row.employee_id <> employee_row.id
      or shift_row.job_role_id <> p_job_role_id
      or shift_row.status not in ('scheduled', 'claimed')
      or clocked_in_at < shift_row.starts_at - interval '6 hours'
      or clocked_in_at > shift_row.ends_at + interval '12 hours'
      or not exists (
        select 1 from public.schedules schedule
        where schedule.id = shift_row.schedule_id and schedule.status = 'published'
      ) then
      raise exception 'Scheduled shift does not match an active clock-in window'
        using errcode = '23514';
    end if;
  end if;

  insert into public.time_entries (
    id, organization_id, location_id, employee_id, job_role_id, scheduled_shift_id,
    clocked_in_at, status, source, clock_in_metadata
  ) values (
    p_request_id,
    location_row.organization_id,
    location_row.id,
    employee_row.id,
    p_job_role_id,
    p_scheduled_shift_id,
    clocked_in_at,
    'open',
    'employee',
    jsonb_build_object('recorded_by', 'server_rpc')
  ) returning * into existing;
  return existing;
end
$$;

comment on function public.record_clock_in(uuid, uuid, uuid, uuid)
is 'Actor-derived clock-in with effective role assignment and optional active published-shift validation.';

create function public.guard_time_correction_decision_actor()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if old.status = 'pending'
    and new.status in ('approved', 'denied')
    and new.status is distinct from old.status then
    if auth.uid() is null
      or new.decided_by is distinct from auth.uid()
      or new.decided_at is null then
      raise exception 'Correction decisions require authenticated server stamps'
        using errcode = '42501';
    end if;
    if new.requested_by = auth.uid() then
      raise exception 'A correction requester cannot approve or deny their own request'
        using errcode = '42501';
    end if;
  end if;
  return new;
end
$$;

create trigger time_correction_decision_actor_guard
before update on public.time_entry_corrections
for each row execute function public.guard_time_correction_decision_actor();

create or replace function public.apply_time_entry_correction(
  p_correction_id uuid,
  p_approve boolean,
  p_decision_note text default null
)
returns public.time_entry_corrections
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  correction public.time_entry_corrections%rowtype;
  entry public.time_entries%rowtype;
  effective_clock_in timestamptz;
  effective_clock_out timestamptz;
  effective_job_role_id uuid;
  work_date date;
  requested_status public.request_status := case
    when p_approve then 'approved'::public.request_status
    else 'denied'::public.request_status
  end;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_approve is null then
    raise exception 'Correction decision is required' using errcode = '22023';
  end if;
  if p_decision_note is not null and length(btrim(p_decision_note)) > 2000 then
    raise exception 'Correction decision note exceeds 2000 characters'
      using errcode = '22023';
  end if;

  select * into correction
  from public.time_entry_corrections correction_row
  where correction_row.id = p_correction_id
  for update;
  if correction.id is null then
    raise exception 'Correction not found' using errcode = 'P0002';
  end if;
  if not public.can_manage_location(correction.organization_id, correction.location_id) then
    raise exception 'Not authorized to decide this correction' using errcode = '42501';
  end if;
  if correction.requested_by = actor_id then
    raise exception 'A correction requester cannot approve or deny their own request'
      using errcode = '42501';
  end if;
  if correction.status = requested_status then return correction; end if;
  if correction.status <> 'pending' then
    raise exception 'Decided corrections are immutable' using errcode = '42501';
  end if;

  select * into entry
  from public.time_entries entry_row
  where entry_row.id = correction.time_entry_id
  for update;
  if entry.id is null
    or entry.organization_id <> correction.organization_id
    or entry.location_id <> correction.location_id then
    raise exception 'Correction scope does not match its time entry'
      using errcode = '23514';
  end if;

  if p_approve then
    effective_clock_in := coalesce(correction.proposed_clocked_in_at, entry.clocked_in_at);
    effective_clock_out := coalesce(correction.proposed_clocked_out_at, entry.clocked_out_at);
    effective_job_role_id := coalesce(correction.proposed_job_role_id, entry.job_role_id);
    if effective_clock_in > clock_timestamp() + interval '5 minutes'
      or effective_clock_in < clock_timestamp() - interval '370 days'
      or (effective_clock_out is not null and effective_clock_out > clock_timestamp() + interval '5 minutes')
      or (effective_clock_out is not null and effective_clock_out < clock_timestamp() - interval '370 days')
      or (effective_clock_out is not null and effective_clock_out <= effective_clock_in)
      or (effective_clock_out is not null and effective_clock_out - effective_clock_in > interval '48 hours') then
      raise exception 'Corrected timestamps are outside safe temporal bounds'
        using errcode = '22023';
    end if;

    select (effective_clock_in at time zone location.timezone)::date
    into work_date
    from public.locations location
    where location.organization_id = entry.organization_id
      and location.id = entry.location_id
      and location.is_active;
    if work_date is null or not exists (
      select 1
      from public.employee_job_roles assignment
      where assignment.organization_id = entry.organization_id
        and assignment.employee_id = entry.employee_id
        and assignment.job_role_id = effective_job_role_id
        and assignment.location_id = entry.location_id
        and assignment.effective_from <= work_date
        and (assignment.effective_to is null or assignment.effective_to >= work_date)
    ) then
      raise exception 'Corrected job role is not assigned at this location and date'
        using errcode = '23514';
    end if;
    if exists (
      select 1
      from public.time_entries other
      where other.employee_id = entry.employee_id
        and other.id <> entry.id
        and tstzrange(
          other.clocked_in_at,
          coalesce(other.clocked_out_at, 'infinity'::timestamptz),
          '[)'
        ) && tstzrange(
          effective_clock_in,
          coalesce(effective_clock_out, 'infinity'::timestamptz),
          '[)'
        )
    ) then
      raise exception 'Corrected time entry overlaps another time entry'
        using errcode = '23505';
    end if;

    if correction.proposed_breaks is not null then
      if jsonb_typeof(correction.proposed_breaks) <> 'array'
        or exists (
          select 1 from jsonb_array_elements(correction.proposed_breaks) break_value
          where (break_value ->> 'started_at') is null
            or (break_value ->> 'is_paid') is null
            or (break_value ->> 'started_at')::timestamptz < effective_clock_in
            or ((break_value ->> 'ended_at') is not null
              and (break_value ->> 'ended_at')::timestamptz <= (break_value ->> 'started_at')::timestamptz)
            or (effective_clock_out is not null and (
              (break_value ->> 'ended_at') is null
              or (break_value ->> 'ended_at')::timestamptz > effective_clock_out
            ))
        )
        or exists (
          select 1
          from jsonb_array_elements(correction.proposed_breaks) with ordinality left_break(value, position)
          join jsonb_array_elements(correction.proposed_breaks) with ordinality right_break(value, position)
            on left_break.position < right_break.position
          where (left_break.value ->> 'started_at')::timestamptz
              < coalesce((right_break.value ->> 'ended_at')::timestamptz, 'infinity'::timestamptz)
            and (right_break.value ->> 'started_at')::timestamptz
              < coalesce((left_break.value ->> 'ended_at')::timestamptz, 'infinity'::timestamptz)
        ) then
        raise exception 'Proposed breaks are invalid, overlapping, or outside the time entry'
          using errcode = '23514';
      end if;
    end if;

    update public.time_entries entry_update
    set clocked_in_at = effective_clock_in,
        clocked_out_at = effective_clock_out,
        job_role_id = effective_job_role_id,
        status = case
          when effective_clock_out is null then 'open'::public.time_entry_status
          else 'corrected'::public.time_entry_status
        end,
        approved_by = actor_id,
        approved_at = clock_timestamp()
    where entry_update.id = entry.id;

    if correction.proposed_breaks is not null then
      delete from public.time_breaks where time_entry_id = entry.id;
      insert into public.time_breaks (
        organization_id, time_entry_id, started_at, ended_at, is_paid, source, notes
      )
      select correction.organization_id,
        entry.id,
        (break_value ->> 'started_at')::timestamptz,
        nullif(break_value ->> 'ended_at', '')::timestamptz,
        (break_value ->> 'is_paid')::boolean,
        'manager',
        nullif(break_value ->> 'notes', '')
      from jsonb_array_elements(correction.proposed_breaks) break_value;
    end if;
  end if;

  update public.time_entry_corrections correction_update
  set status = requested_status,
      decided_by = actor_id,
      decided_at = clock_timestamp(),
      decision_note = nullif(btrim(p_decision_note), ''),
      applied_at = case when p_approve then clock_timestamp() else null end
  where correction_update.id = correction.id
  returning * into correction;
  return correction;
end
$$;

create function public.request_time_entry_correction(
  p_request_id uuid,
  p_time_entry_id uuid,
  p_proposed_clocked_in_at timestamptz,
  p_proposed_clocked_out_at timestamptz,
  p_proposed_job_role_id uuid,
  p_reason text
)
returns public.time_entry_corrections
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  entry public.time_entries%rowtype;
  correction public.time_entry_corrections%rowtype;
  effective_clock_in timestamptz;
  effective_clock_out timestamptz;
  effective_job_role_id uuid;
  work_date date;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('time-correction:' || p_request_id::text, 0));

  select * into correction
  from public.time_entry_corrections correction_row
  where correction_row.id = p_request_id;
  if correction.id is not null then
    if correction.time_entry_id is distinct from p_time_entry_id
      or correction.requested_by is distinct from actor_id
      or correction.proposed_clocked_in_at is distinct from p_proposed_clocked_in_at
      or correction.proposed_clocked_out_at is distinct from p_proposed_clocked_out_at
      or correction.proposed_job_role_id is distinct from p_proposed_job_role_id
      or correction.reason is distinct from btrim(p_reason) then
      raise exception 'Time correction request id was reused' using errcode = '23505';
    end if;
    return correction;
  end if;

  select * into entry
  from public.time_entries entry_row
  where entry_row.id = p_time_entry_id
  for update;
  if entry.id is null then
    raise exception 'Time entry not found' using errcode = 'P0002';
  end if;
  if not public.is_self_employee(entry.employee_id) then
    raise exception 'Only the employee may request a correction to this time entry'
      using errcode = '42501';
  end if;
  if length(btrim(p_reason)) not between 8 and 2000 then
    raise exception 'Correction reason must contain 8 to 2000 characters'
      using errcode = '22023';
  end if;

  effective_clock_in := coalesce(p_proposed_clocked_in_at, entry.clocked_in_at);
  effective_clock_out := coalesce(p_proposed_clocked_out_at, entry.clocked_out_at);
  effective_job_role_id := coalesce(p_proposed_job_role_id, entry.job_role_id);
  if p_proposed_clocked_in_at is null
    and p_proposed_clocked_out_at is null
    and p_proposed_job_role_id is null then
    raise exception 'Propose at least one time or job-role correction'
      using errcode = '22023';
  end if;
  if effective_clock_in = entry.clocked_in_at
    and effective_clock_out is not distinct from entry.clocked_out_at
    and effective_job_role_id = entry.job_role_id then
    raise exception 'The proposed correction matches the current time entry'
      using errcode = '22023';
  end if;
  if effective_clock_in > clock_timestamp() + interval '5 minutes'
    or effective_clock_in < clock_timestamp() - interval '370 days'
    or (effective_clock_out is not null and effective_clock_out > clock_timestamp() + interval '5 minutes')
    or (effective_clock_out is not null and effective_clock_out < clock_timestamp() - interval '370 days')
    or (effective_clock_out is not null and effective_clock_out <= effective_clock_in)
    or (effective_clock_out is not null and effective_clock_out - effective_clock_in > interval '48 hours') then
    raise exception 'Proposed correction timestamps are outside safe temporal bounds'
      using errcode = '22023';
  end if;

  select (effective_clock_in at time zone location.timezone)::date
  into work_date
  from public.locations location
  where location.organization_id = entry.organization_id
    and location.id = entry.location_id
    and location.is_active;
  if work_date is null or not exists (
    select 1
    from public.employee_job_roles assignment
    where assignment.organization_id = entry.organization_id
      and assignment.employee_id = entry.employee_id
      and assignment.job_role_id = effective_job_role_id
      and assignment.location_id = entry.location_id
      and assignment.effective_from <= work_date
      and (assignment.effective_to is null or assignment.effective_to >= work_date)
  ) then
    raise exception 'Proposed job role is not assigned to the employee at this location and date'
      using errcode = '23514';
  end if;

  insert into public.time_entry_corrections (
    id,
    organization_id,
    location_id,
    time_entry_id,
    requested_by,
    proposed_clocked_in_at,
    proposed_clocked_out_at,
    proposed_job_role_id,
    reason,
    status
  ) values (
    p_request_id,
    entry.organization_id,
    entry.location_id,
    entry.id,
    actor_id,
    p_proposed_clocked_in_at,
    p_proposed_clocked_out_at,
    p_proposed_job_role_id,
    btrim(p_reason),
    'pending'
  ) returning * into correction;
  return correction;
end
$$;

create function public.record_missed_time_entry(
  p_request_id uuid,
  p_location_id uuid,
  p_employee_id uuid,
  p_job_role_id uuid,
  p_scheduled_shift_id uuid,
  p_clocked_in_at timestamptz,
  p_clocked_out_at timestamptz,
  p_reason text
)
returns public.time_entries
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  location_row public.locations%rowtype;
  employee_row public.employees%rowtype;
  shift_row public.shifts%rowtype;
  entry public.time_entries%rowtype;
  work_date date;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  select * into location_row
  from public.locations location
  where location.id = p_location_id and location.is_active;
  if location_row.id is null
    or not public.can_manage_location(location_row.organization_id, location_row.id) then
    raise exception 'Not authorized to record a missed punch at this location'
      using errcode = '42501';
  end if;
  if p_clocked_in_at is null
    or p_clocked_out_at is null
    or p_clocked_out_at <= p_clocked_in_at
    or p_clocked_in_at < clock_timestamp() - interval '370 days'
    or p_clocked_in_at > clock_timestamp() + interval '5 minutes'
    or p_clocked_out_at < clock_timestamp() - interval '370 days'
    or p_clocked_out_at > clock_timestamp() + interval '5 minutes'
    or p_clocked_out_at - p_clocked_in_at > interval '48 hours'
    or length(btrim(p_reason)) not between 8 and 2000 then
    raise exception 'Missed punch timestamps or reason are outside safe bounds'
      using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('missed-time-entry:' || p_request_id::text, 0));
  select * into entry from public.time_entries where id = p_request_id;
  if entry.id is not null then
    if entry.organization_id = location_row.organization_id
      and entry.location_id = location_row.id
      and entry.employee_id = p_employee_id
      and entry.job_role_id = p_job_role_id
      and entry.scheduled_shift_id is not distinct from p_scheduled_shift_id
      and entry.clocked_in_at = p_clocked_in_at
      and entry.clocked_out_at = p_clocked_out_at
      and entry.source = 'manager'
      and entry.notes = btrim(p_reason) then
      return entry;
    end if;
    raise exception 'Missed punch request id was reused' using errcode = '23505';
  end if;

  select * into employee_row
  from public.employees employee
  where employee.id = p_employee_id
    and employee.organization_id = location_row.organization_id
    and employee.employment_status = 'active';
  if employee_row.id is null then
    raise exception 'Employee is unavailable' using errcode = '23514';
  end if;
  if employee_row.user_id = actor_id then
    raise exception 'A manager cannot record their own entirely missed punch'
      using errcode = '42501';
  end if;
  work_date := (p_clocked_in_at at time zone location_row.timezone)::date;
  if not exists (
    select 1 from public.employee_job_roles assignment
    where assignment.organization_id = location_row.organization_id
      and assignment.employee_id = employee_row.id
      and assignment.job_role_id = p_job_role_id
      and assignment.location_id = location_row.id
      and assignment.effective_from <= work_date
      and (assignment.effective_to is null or assignment.effective_to >= work_date)
  ) then
    raise exception 'Employee is not assigned to this job role and location on the work date'
      using errcode = '23514';
  end if;
  if p_scheduled_shift_id is not null then
    select * into shift_row from public.shifts where id = p_scheduled_shift_id;
    if shift_row.id is null
      or shift_row.organization_id <> location_row.organization_id
      or shift_row.location_id <> location_row.id
      or shift_row.employee_id <> employee_row.id
      or shift_row.job_role_id <> p_job_role_id
      or not exists (
        select 1 from public.schedules schedule
        where schedule.id = shift_row.schedule_id and schedule.status = 'published'
      ) then
      raise exception 'Scheduled shift does not match the missed punch'
        using errcode = '23514';
    end if;
  end if;
  if exists (
    select 1
    from public.time_entries existing
    where existing.employee_id = employee_row.id
      and tstzrange(
        existing.clocked_in_at,
        coalesce(existing.clocked_out_at, 'infinity'::timestamptz),
        '[)'
      ) && tstzrange(p_clocked_in_at, p_clocked_out_at, '[)')
  ) then
    raise exception 'Missed punch overlaps an existing time entry'
      using errcode = '23505';
  end if;

  insert into public.time_entries (
    id,
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
    approved_by,
    approved_at,
    notes
  ) values (
    p_request_id,
    location_row.organization_id,
    location_row.id,
    employee_row.id,
    p_job_role_id,
    p_scheduled_shift_id,
    p_clocked_in_at,
    p_clocked_out_at,
    'corrected',
    'manager',
    jsonb_build_object('recorded_by', 'missed_time_entry_rpc', 'actor_id', actor_id),
    jsonb_build_object('recorded_by', 'missed_time_entry_rpc', 'actor_id', actor_id),
    clock_timestamp(),
    actor_id,
    clock_timestamp(),
    btrim(p_reason)
  ) returning * into entry;
  return entry;
end
$$;

revoke insert, update on public.time_entry_corrections from authenticated;
revoke all on function public.request_time_entry_correction(uuid, uuid, timestamptz, timestamptz, uuid, text) from public;
revoke all on function public.record_missed_time_entry(uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) from public;
grant execute on function public.request_time_entry_correction(uuid, uuid, timestamptz, timestamptz, uuid, text) to authenticated;
grant execute on function public.record_missed_time_entry(uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, text) to authenticated;

comment on function public.request_time_entry_correction(uuid, uuid, timestamptz, timestamptz, uuid, text)
is 'Actor-derived, idempotent employee correction request with assignment and temporal validation.';
comment on function public.record_missed_time_entry(uuid, uuid, uuid, uuid, uuid, timestamptz, timestamptz, text)
is 'Manager-only, idempotent creation of a fully missed closed punch with approval stamps and overlap checks.';

-- Private bucket contracts and channel-bound chat upload paths -------------

insert into storage.buckets (
  id,
  name,
  public,
  file_size_limit,
  allowed_mime_types
)
values
  ('profile-avatars', 'profile-avatars', false, 5242880, array['image/jpeg', 'image/png', 'image/webp']),
  ('employee-documents', 'employee-documents', false, 26214400, null),
  ('chat-attachments', 'chat-attachments', false, 26214400, null),
  ('receipts', 'receipts', false, 52428800, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf']),
  ('closeouts', 'closeouts', false, 26214400, null),
  ('inventory', 'inventory', false, 52428800, null),
  ('sops', 'sops', false, 52428800, null),
  ('incidents', 'incidents', false, 52428800, null),
  ('reports', 'reports', false, 52428800, null),
  ('imports', 'imports', false, 104857600, null),
  ('checklists', 'checklists', false, 26214400, null)
on conflict (id) do update
set name = excluded.name,
    public = false,
    file_size_limit = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

create function public.storage_chat_path_is_authorized(p_name text)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select public.storage_path_scope_is_valid(p_name)
    and cardinality(string_to_array(p_name, '/')) = 5
    and split_part(p_name, '/', 3) = 'channels'
    and split_part(p_name, '/', 4) ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
    and split_part(p_name, '/', 5) <> ''
    and exists (
      select 1
      from public.chat_channels channel
      where channel.id = split_part(p_name, '/', 4)::uuid
        and channel.organization_id = public.storage_organization_id(p_name)
        and not channel.is_archived
        and public.can_access_channel(channel.id)
        and (
          (
            channel.location_id is null
            and split_part(p_name, '/', 2) = 'global'
          )
          or (
            channel.location_id is not null
            and public.storage_location_id(p_name) = channel.location_id
          )
        )
    )
$$;

revoke all on function public.storage_chat_path_is_authorized(text) from public;
grant execute on function public.storage_chat_path_is_authorized(text) to authenticated;

drop policy storage_chat_insert on storage.objects;
create policy storage_chat_insert
on storage.objects for insert to authenticated
with check (
  bucket_id = 'chat-attachments'
  and owner_id = auth.uid()::text
  and public.storage_chat_path_is_authorized(name)
);

drop policy storage_chat_delete on storage.objects;
create policy storage_chat_delete
on storage.objects for delete to authenticated
using (
  bucket_id = 'chat-attachments'
  and owner_id = auth.uid()::text
  and public.storage_chat_path_is_authorized(name)
);

comment on function public.storage_chat_path_is_authorized(text)
is 'Requires {org}/{global|location}/channels/{channel_uuid}/{file}; MIME/size remain bucket-enforced and malware scanning is a production worker responsibility.';

comment on function public.claim_open_shift(uuid, uuid)
is 'Atomically and idempotently assigns the authenticated eligible employee to an open published shift.';
comment on function public.reopen_shift(uuid, uuid)
is 'Atomically and idempotently returns a scheduled, claimed, or cancelled published shift to canonical open/unassigned state.';
comment on function public.administer_organization_member(uuid, uuid, public.app_role, public.membership_status, uuid[])
is 'Atomic member role/status/location administration with self, Owner/AAL2, tenant, and idempotency guards.';

-- A restrictive SELECT barrier covers policies that otherwise authorize a
-- row directly by user_id/requested_by. The five workspace/MFA context tables
-- are intentionally excluded; all other tenant rows require Owner AAL2.
do $owner_aal1_read_barrier$
declare
  table_name text;
begin
  for table_name in
    select column_info.table_name
    from information_schema.columns column_info
    join information_schema.tables table_info
      on table_info.table_schema = column_info.table_schema
     and table_info.table_name = column_info.table_name
    where column_info.table_schema = 'public'
      and column_info.column_name = 'organization_id'
      and table_info.table_type = 'BASE TABLE'
      and column_info.table_name not in (
        'organization_memberships',
        'location_memberships',
        'locations'
      )
  loop
    execute format(
      'create policy owner_mfa_sensitive_read_barrier on public.%I as restrictive for select to authenticated using (not public.is_owner_pending_mfa(organization_id))',
      table_name
    );
  end loop;
end
$owner_aal1_read_barrier$;
