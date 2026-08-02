-- Le Yard OS: transactional tenant provisioning around Supabase Auth invitations.

create function public.provision_user_invitation(
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
  clean_location_ids uuid[] := coalesce(p_location_ids, '{}'::uuid[]);
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

  if p_expires_at <= now() or p_expires_at > now() + interval '7 days' then
    raise exception 'Invitation expiry is outside the allowed window' using errcode = '22023';
  end if;

  if length(btrim(p_display_name)) not between 2 and 120
    or lower(btrim(p_email)) <> btrim(p_email)
    or position('@' in p_email) <= 1
    or p_token_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Invitation fields are invalid' using errcode = '22023';
  end if;

  if cardinality(clean_location_ids) <> (
    select count(distinct location_id)::integer from unnest(clean_location_ids) as location_id
  ) then
    raise exception 'Location scope contains duplicates' using errcode = '22023';
  end if;

  if p_role in ('manager', 'employee') and cardinality(clean_location_ids) = 0 then
    raise exception 'Managers and employees require at least one location' using errcode = '22023';
  end if;

  if exists (
    select 1 from unnest(clean_location_ids) as requested(location_id)
    where not exists (
      select 1 from public.locations location
      where location.organization_id = p_organization_id
        and location.id = requested.location_id
        and location.is_active
    )
  ) then
    raise exception 'Invitation contains an unavailable location' using errcode = '23503';
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
    raise exception 'Auth invitation metadata does not match the requested membership' using errcode = '23514';
  end if;

  if exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_auth_user_id
  ) then
    raise exception 'This user already has a membership in the organization' using errcode = '23505';
  end if;

  if exists (
    select 1 from public.user_invitations invitation
    where invitation.organization_id = p_organization_id
      and invitation.email = p_email
      and invitation.accepted_at is null
      and invitation.revoked_at is null
      and invitation.expires_at > now()
  ) then
    raise exception 'An active invitation already exists for this email' using errcode = '23505';
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
  )
  returning id into invitation_id;

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

  insert into public.location_memberships (organization_id, location_id, user_id, is_primary)
  select p_organization_id, requested.location_id, p_auth_user_id, requested.ordinality = 1
  from unnest(clean_location_ids) with ordinality as requested(location_id, ordinality);

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

  return invitation_id;
end
$$;

revoke all on function public.provision_user_invitation(uuid, uuid, text, text, public.app_role, uuid[], text, timestamptz, uuid) from public;
grant execute on function public.provision_user_invitation(uuid, uuid, text, text, public.app_role, uuid[], text, timestamptz, uuid) to authenticated;

create function public.accept_my_invitation(p_organization_id uuid)
returns boolean
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  current_user_id uuid := auth.uid();
  current_email text := lower(coalesce(auth.jwt() ->> 'email', ''));
  invitation_record public.user_invitations%rowtype;
  membership_status public.membership_status;
begin
  if current_user_id is null or current_email = '' then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;

  select membership.status into membership_status
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = current_user_id;

  if membership_status = 'active' then
    return true;
  end if;
  if membership_status is distinct from 'invited' then
    raise exception 'No pending organization membership was found' using errcode = '42501';
  end if;

  select invitation.* into invitation_record
  from public.user_invitations invitation
  where invitation.organization_id = p_organization_id
    and invitation.email = current_email
    and invitation.accepted_at is null
    and invitation.revoked_at is null
  order by invitation.created_at desc
  limit 1;

  if invitation_record.id is null then
    raise exception 'No matching invitation was found' using errcode = '42501';
  end if;
  if invitation_record.expires_at <= now() then
    raise exception 'The invitation has expired' using errcode = '22023';
  end if;

  update public.organization_memberships
  set status = 'active', joined_at = now(), updated_at = now()
  where organization_id = p_organization_id
    and user_id = current_user_id
    and status = 'invited';

  update public.employees
  set employment_status = 'active', updated_at = now()
  where organization_id = p_organization_id
    and user_id = current_user_id
    and employment_status = 'invited';

  update public.user_invitations
  set accepted_at = now()
  where id = invitation_record.id;

  return true;
end
$$;

revoke all on function public.accept_my_invitation(uuid) from public;
grant execute on function public.accept_my_invitation(uuid) to authenticated;

create function public.enforce_owner_role_assignment()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.role = 'owner'
    and (tg_op = 'INSERT' or old.role is distinct from 'owner')
    and current_user not in ('postgres', 'supabase_admin', 'service_role')
    and coalesce(auth.role(), '') <> 'service_role'
    and not (
      public.org_role(new.organization_id) = 'owner'
      and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    ) then
    raise exception 'Only an MFA-verified owner may assign the owner role' using errcode = '42501';
  end if;
  return new;
end
$$;

create trigger organization_memberships_owner_assignment
before insert or update of role on public.organization_memberships
for each row execute function public.enforce_owner_role_assignment();

comment on function public.provision_user_invitation(uuid, uuid, text, text, public.app_role, uuid[], text, timestamptz, uuid)
is 'Atomically creates invitation tracking, invited tenant/location membership, and employee record after the trusted server creates a Supabase Auth invite.';
comment on function public.accept_my_invitation(uuid)
is 'Activates only the authenticated user matching a live invitation for the explicitly selected organization.';
comment on column public.user_invitations.token_hash
is 'Non-recoverable server-generated correlation hash. The actionable invitation token remains exclusively inside Supabase Auth.';
