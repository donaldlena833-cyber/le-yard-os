-- Le Yard OS: keep tip-policy approval inside the Owner/Admin policy boundary.
-- Migration 009 originally allowed assigned Managers to approve a
-- location-scoped policy. Policy authoring and approval are both configuration
-- writes, so this forward correction requires organization management for
-- every scope while preserving independent approval and exact replay.

create or replace function public.approve_tip_policy_version(
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

  perform pg_advisory_xact_lock(
    hashtextextended('financial-approval:' || p_request_id::text, 0)
  );

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

  if not public.can_manage_org(policy_row.organization_id) then
    raise exception 'Owner or Admin access is required to approve tip policy versions'
      using errcode = '42501';
  end if;

  select * into prior
  from private.financial_approval_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null then
    if prior.record_type <> 'tip_policy_version'
      or prior.record_id is distinct from p_policy_version_id
      or prior.actor_id is distinct from actor_id then
      raise exception 'Financial approval request id was reused' using errcode = '23505';
    end if;
    return version_row;
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

revoke all on function public.approve_tip_policy_version(uuid, uuid) from public;
grant execute on function public.approve_tip_policy_version(uuid, uuid) to authenticated;

comment on function public.approve_tip_policy_version(uuid, uuid)
is 'Server-stamps an Owner/Admin second-person tip-policy approval after eligibility rules exist; Owner approval requires AAL2.';
