alter table private.member_admin_requests
add column if not exists requested_primary_location_id uuid;

create function public.administer_organization_member(
  p_request_id uuid,
  p_membership_id uuid,
  p_role public.app_role,
  p_status public.membership_status,
  p_location_ids uuid[],
  p_primary_location_id uuid
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

  if cardinality(clean_location_ids) > 0 and p_primary_location_id is null then
    raise exception 'Choose one selected location as the primary location' using errcode = '23514';
  end if;
  if p_primary_location_id is not null and not (p_primary_location_id = any(clean_location_ids)) then
    raise exception 'The primary location must be included in location access' using errcode = '23514';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('member-admin:' || p_request_id::text, 0));
  select * into prior
  from private.member_admin_requests request
  where request.request_id = p_request_id;

  if prior.request_id is not null then
    if prior.actor_id is distinct from actor_id
      or prior.membership_id is distinct from p_membership_id
      or prior.requested_role is distinct from p_role
      or prior.requested_status is distinct from p_status
      or prior.location_ids is distinct from clean_location_ids
      or prior.requested_primary_location_id is distinct from p_primary_location_id then
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
    raise exception 'Use a separate Owner or Admin to change your own access' using errcode = '42501';
  end if;
  if not public.can_administer_membership_target(target.organization_id, target.user_id, p_role) then
    raise exception 'Not authorized to administer this membership' using errcode = '42501';
  end if;
  if target.status = 'invited' and p_status <> 'invited'
    or target.status <> 'invited' and p_status = 'invited' then
    raise exception 'Invitation activation state is managed by the invitation lifecycle' using errcode = '23514';
  end if;
  if p_role in ('manager', 'employee') and cardinality(clean_location_ids) = 0 then
    raise exception 'Managers and employees require at least one location' using errcode = '23514';
  end if;
  if exists (
    select 1 from unnest(clean_location_ids) requested(location_id)
    where not exists (
      select 1 from public.locations location
      where location.organization_id = target.organization_id
        and location.id = requested.location_id
        and location.is_active
    )
  ) then
    raise exception 'A requested location is unavailable' using errcode = '23503';
  end if;

  insert into private.member_admin_requests (
    request_id, membership_id, organization_id, actor_id,
    requested_role, requested_status, location_ids, requested_primary_location_id
  ) values (
    p_request_id, target.id, target.organization_id, actor_id,
    p_role, p_status, clean_location_ids, p_primary_location_id
  );

  update public.organization_memberships membership
  set role = p_role,
      status = p_status,
      suspended_at = case when p_status = 'suspended' then coalesce(membership.suspended_at, clock_timestamp()) else null end,
      updated_at = clock_timestamp()
  where membership.id = target.id
  returning * into result;

  delete from public.location_memberships location_membership
  where location_membership.organization_id = target.organization_id
    and location_membership.user_id = target.user_id;

  insert into public.location_memberships (organization_id, location_id, user_id, is_primary)
  select target.organization_id, requested.location_id, target.user_id,
    requested.location_id = p_primary_location_id
  from unnest(clean_location_ids) requested(location_id);

  update public.employees employee
  set home_location_id = p_primary_location_id,
      updated_at = clock_timestamp()
  where employee.organization_id = target.organization_id
    and employee.user_id = target.user_id;

  update private.member_admin_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;
  return result;
end
$$;

revoke all on function public.administer_organization_member(uuid, uuid, public.app_role, public.membership_status, uuid[], uuid) from public;
revoke all on function public.administer_organization_member(uuid, uuid, public.app_role, public.membership_status, uuid[], uuid) from anon;
grant execute on function public.administer_organization_member(uuid, uuid, public.app_role, public.membership_status, uuid[], uuid) to authenticated;
drop function public.administer_organization_member(uuid, uuid, public.app_role, public.membership_status, uuid[]);

comment on function public.administer_organization_member(uuid, uuid, public.app_role, public.membership_status, uuid[], uuid)
is 'Changes a member role/location scope only with an explicit selected primary location; updates home location atomically.';
