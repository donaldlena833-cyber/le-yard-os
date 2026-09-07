-- Permanent password-only authentication, requested by the owner.
-- Preserve tenant, role, service-only, audit, and final-owner protections.

CREATE OR REPLACE FUNCTION public.enforce_owner_role_assignment()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
begin
  if new.role = 'owner'
    and (tg_op = 'INSERT' or old.role is distinct from 'owner')
    and current_user not in ('postgres', 'supabase_admin', 'service_role')
    and coalesce(auth.role(), '') <> 'service_role'
    and not (
      public.org_role(new.organization_id) = 'owner'
    ) then
    raise exception 'Only an owner may assign the owner role' using errcode = '42501';
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.guard_owner_membership_target()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  ) then
    raise exception 'Only an owner may mutate an Owner membership'
      using errcode = '42501';
  end if;

  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

CREATE OR REPLACE FUNCTION public.guard_owner_location_membership_target()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
    ) then
    raise exception 'Only an owner may mutate an Owner location membership'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

CREATE OR REPLACE FUNCTION public.provision_user_invitation_aal2_legacy(p_auth_user_id uuid, p_organization_id uuid, p_email text, p_display_name text, p_role app_role, p_location_ids uuid[], p_token_hash text, p_expires_at timestamp with time zone, p_employee_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.can_use_owner_intelligence(p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
  select exists (
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

CREATE OR REPLACE FUNCTION public.bind_verified_checklist_photo_response_aal2_legacy(p_request_id uuid, p_actor_id uuid, p_actor_aal text, p_run_id uuid, p_template_item_id uuid, p_response jsonb, p_storage_path text, p_notes text, p_mime_type text, p_size_bytes bigint)
 RETURNS checklist_responses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
    or (actor_role = 'owner')
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
$function$;

CREATE OR REPLACE FUNCTION public.guard_owner_invitation_target()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
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
  ) then
    raise exception 'Only an owner may mutate an Owner invitation'
      using errcode = '42501';
  end if;
  return case when tg_op = 'DELETE' then old else new end;
end
$function$;

CREATE OR REPLACE FUNCTION public.can_administer_membership_target(p_organization_id uuid, p_target_user_id uuid, p_prospective_role app_role DEFAULT NULL::app_role)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
      else true
    end
$function$;

CREATE OR REPLACE FUNCTION public.revoke_user_invitation(p_request_id uuid, p_invitation_id uuid)
 RETURNS user_invitations
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
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
$function$;

CREATE OR REPLACE FUNCTION public.bind_verified_checklist_photo_response(p_request_id uuid, p_actor_id uuid, p_actor_aal text, p_run_id uuid, p_template_item_id uuid, p_response jsonb, p_storage_path text, p_notes text, p_mime_type text, p_size_bytes bigint)
 RETURNS checklist_responses
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  actor_role public.app_role;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Verified checklist photo binding is service-only'
      using errcode = '42501';
  end if;
  if p_actor_aal not in ('aal1', 'aal2') then
    raise exception 'Actor assurance is invalid' using errcode = '22023';
  end if;
  select membership.role
  into actor_role
  from public.checklist_runs run
  join public.organization_memberships membership
    on membership.organization_id = run.organization_id
   and membership.user_id = p_actor_id
   and membership.status = 'active'
  where run.id = p_run_id;
  return public.bind_verified_checklist_photo_response_aal2_legacy(
    p_request_id,
    p_actor_id,
    p_actor_aal,
    p_run_id,
    p_template_item_id,
    p_response,
    p_storage_path,
    p_notes,
    p_mime_type,
    p_size_bytes
  );
end
$function$;

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
        and membership.role in ('owner', 'admin')
    )
$function$;

CREATE OR REPLACE FUNCTION public.is_owner_pending_mfa(p_organization_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
  select false
$function$;

CREATE OR REPLACE FUNCTION public.provision_user_invitation(p_auth_user_id uuid, p_organization_id uuid, p_email text, p_display_name text, p_role app_role, p_location_ids uuid[], p_token_hash text, p_expires_at timestamp with time zone, p_employee_id uuid)
 RETURNS uuid
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
begin
  if auth.uid() is null then
    raise exception 'Owner and Admin invitations require an authenticated owner or admin'
      using errcode = '42501';
  end if;
  return public.provision_user_invitation_aal2_legacy(
    p_auth_user_id,
    p_organization_id,
    p_email,
    p_display_name,
    p_role,
    p_location_ids,
    p_token_hash,
    p_expires_at,
    p_employee_id
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.save_startup_workspace(p_workspace_id text, p_expected_revision bigint, p_data jsonb)
 RETURNS TABLE(outcome text, revision bigint, data jsonb, updated_at timestamp with time zone)
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  actor_id uuid := auth.uid();
  workspace_row public.startup_workspaces%rowtype;
  validation_issues text[];
begin
  if actor_id is null then
    raise exception 'Owner or Admin access is required'
      using errcode = '42501';
  end if;
  if p_workspace_id is null or length(btrim(p_workspace_id)) not between 1 and 200
    or p_expected_revision is null or p_expected_revision < 1
    or p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'A valid Opening Room save is required'
      using errcode = '22023';
  end if;

  select *
  into workspace_row
  from public.startup_workspaces workspace
  where workspace.id = p_workspace_id
  for update;
  if workspace_row.id is null then
    raise exception 'Opening Room workspace is unavailable'
      using errcode = 'P0002';
  end if;
  if not public.can_manage_org(workspace_row.organization_id) then
    raise exception 'Opening Room workspace is unavailable'
      using errcode = '42501';
  end if;
  validation_issues := private.startup_workspace_contract_violations(
    p_data,
    workspace_row.organization_id
  );
  if cardinality(validation_issues) > 0 then
    raise exception 'Opening Room data failed the v2 contract'
      using errcode = '23514',
            detail = array_to_string(validation_issues, ',');
  end if;

  if workspace_row.revision <> p_expected_revision then
    return query select
      'conflict'::text,
      workspace_row.revision,
      workspace_row.data,
      workspace_row.updated_at;
    return;
  end if;

  update public.startup_workspaces workspace
  set data = p_data,
      revision = workspace.revision + 1,
      updated_at = clock_timestamp()
  where workspace.id = workspace_row.id
    and workspace.revision = p_expected_revision
  returning * into workspace_row;
  if workspace_row.id is null then
    raise exception 'Opening Room workspace changed concurrently; retry'
      using errcode = '40001';
  end if;

  insert into public.startup_workspace_revisions (
    workspace_id,
    organization_id,
    revision,
    data,
    actor_id,
    created_at
  ) values (
    workspace_row.id,
    workspace_row.organization_id,
    workspace_row.revision,
    workspace_row.data,
    actor_id,
    workspace_row.updated_at
  );

  return query select
    'saved'::text,
    workspace_row.revision,
    workspace_row.data,
    workspace_row.updated_at;
end
$function$;

CREATE OR REPLACE FUNCTION public.manage_location_release_control(p_request_id uuid, p_organization_id uuid, p_location_id uuid, p_expected_version bigint, p_state text, p_accept_reservations_from date, p_public_inventory_percent integer, p_booking_approved boolean, p_support_ready boolean)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  actor_id uuid := auth.uid();
  release_row public.location_release_controls%rowtype;
  previous_row public.location_release_controls%rowtype;
  claimed boolean;
  payload jsonb;
begin
  if actor_id is null
    or p_request_id is null
    or p_organization_id is null
    or p_location_id is null
    or p_expected_version is null
    or p_state not in ('prelaunch', 'pilot', 'open', 'paused')
    or p_accept_reservations_from < date '2026-12-01'
    or p_booking_approved is null
    or p_support_ready is null then
    raise exception 'A valid release-control request is required'
      using errcode = '22023';
  end if;
  if not public.can_manage_org(p_organization_id) then
    raise exception 'Owner or Admin access is required'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.locations location
    where location.organization_id = p_organization_id
      and location.id = p_location_id
      and location.is_active
  ) then
    raise exception 'Release location not found' using errcode = 'P0002';
  end if;

  select *
  into release_row
  from public.location_release_controls release
  where release.organization_id = p_organization_id
    and release.location_id = p_location_id
  for update;
  if release_row.id is null then
    raise exception 'Release control not found' using errcode = 'P0002';
  end if;
  payload := jsonb_build_object(
    'state', p_state,
    'acceptReservationsFrom', p_accept_reservations_from,
    'publicInventoryPercent', p_public_inventory_percent,
    'bookingApproved', p_booking_approved,
    'supportReady', p_support_ready,
    'expectedVersion', p_expected_version
  );
  claimed := private.claim_operation_request(
    p_request_id,
    'release.location.manage',
    p_organization_id,
    p_location_id,
    release_row.id,
    payload
  );
  if not claimed then
    return jsonb_build_object(
      'state', release_row.state,
      'acceptReservationsFrom', release_row.accept_reservations_from,
      'publicInventoryPercent', release_row.public_inventory_percent,
      'bookingApproved', release_row.booking_approved,
      'supportReady', release_row.support_ready,
      'releaseId', release_row.release_id,
      'version', release_row.version,
      'updatedAt', release_row.updated_at,
      'replayed', true
    );
  end if;
  if release_row.version <> p_expected_version then
    raise exception 'Release control changed concurrently; reload and review'
      using errcode = '40001';
  end if;

  previous_row := release_row;
  update public.location_release_controls release
  set state = p_state,
      accept_reservations_from = p_accept_reservations_from,
      public_inventory_percent = p_public_inventory_percent,
      booking_approved = p_booking_approved,
      support_ready = p_support_ready,
      approved_by = case when p_booking_approved then actor_id else null end,
      approved_at = case when p_booking_approved then clock_timestamp() else null end,
      release_id = gen_random_uuid(),
      version = release.version + 1,
      updated_at = clock_timestamp()
  where release.id = release_row.id
  returning * into release_row;

  insert into public.audit_events (
    organization_id,
    location_id,
    actor_id,
    action,
    table_name,
    record_id,
    old_record,
    new_record,
    request_id,
    metadata
  ) values (
    p_organization_id,
    p_location_id,
    actor_id,
    'location_release_control_updated',
    'location_release_controls',
    release_row.id::text,
    to_jsonb(previous_row),
    to_jsonb(release_row),
    p_request_id::text,
    jsonb_build_object(
      'previousReleaseId', previous_row.release_id,
      'releaseId', release_row.release_id
    )
  );
  perform private.complete_operation_request(p_request_id);

  return jsonb_build_object(
    'state', release_row.state,
    'acceptReservationsFrom', release_row.accept_reservations_from,
    'publicInventoryPercent', release_row.public_inventory_percent,
    'bookingApproved', release_row.booking_approved,
    'supportReady', release_row.support_ready,
    'releaseId', release_row.release_id,
    'version', release_row.version,
    'updatedAt', release_row.updated_at,
    'replayed', false
  );
end
$function$;

CREATE OR REPLACE FUNCTION public.begin_user_invitation_request(p_request_id uuid, p_organization_id uuid, p_email text, p_display_name text, p_role app_role, p_location_ids uuid[], p_employee_id uuid, p_expires_at timestamp with time zone)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
 SET row_security TO 'off'
AS $function$
declare
  actor_id uuid := auth.uid();
  actor_role public.app_role;
  request public.user_invitation_requests%rowtype;
  clean_email text := lower(btrim(p_email));
  clean_locations uuid[] := coalesce(p_location_ids, '{}'::uuid[]);
  existing_auth_user_id uuid;
begin
  if actor_id is null then
    raise exception 'invitation access is required' using errcode = '42501';
  end if;
  select membership.role into actor_role
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = actor_id and membership.status = 'active';
  if actor_role not in ('owner', 'admin')
    or (p_role = 'owner' and actor_role <> 'owner') then
    raise exception 'Invitation role is not authorized' using errcode = '42501';
  end if;
  if p_request_id is null or p_employee_id is null
    or length(btrim(coalesce(p_display_name, ''))) not between 2 and 120
    or clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
    or p_expires_at <= clock_timestamp()
    or p_expires_at > clock_timestamp() + interval '7 days'
    or cardinality(clean_locations) <> (
      select count(distinct id)::integer from unnest(clean_locations) id
    )
    or (p_role in ('manager','employee') and cardinality(clean_locations) = 0)
    or exists (
      select 1 from unnest(clean_locations) requested(id)
      where not exists (
        select 1 from public.locations location
        where location.organization_id = p_organization_id
          and location.id = requested.id and location.is_active
      )
    ) then
    raise exception 'Invitation request is invalid' using errcode = '22023';
  end if;

  select * into request from public.user_invitation_requests existing
  where existing.organization_id = p_organization_id
    and existing.email = clean_email
    and existing.state not in ('accepted','failed','cancelled')
  for update;
  if found then
    if request.display_name <> btrim(p_display_name) or request.role <> p_role
      or request.location_ids <> clean_locations or request.invited_by <> actor_id then
      raise exception 'This email has a different active invitation request'
        using errcode = '23505';
    end if;
    if request.auth_user_id is null then
      select auth_user.id into existing_auth_user_id
      from auth.users auth_user where lower(auth_user.email) = clean_email;
      if existing_auth_user_id is not null then
        update public.user_invitation_requests existing
        set auth_user_id = existing_auth_user_id, state = 'auth_created',
            last_error_code = null, updated_at = clock_timestamp()
        where existing.id = request.id returning * into request;
      end if;
    end if;
    return jsonb_build_object(
      'requestId', request.id, 'state', request.state,
      'authUserId', request.auth_user_id, 'replayed', true
    );
  end if;

  select * into request from public.user_invitation_requests existing
  where existing.id = p_request_id;
  if found then
    if request.organization_id <> p_organization_id or request.email <> clean_email
      or request.display_name <> btrim(p_display_name) or request.role <> p_role
      or request.location_ids <> clean_locations or request.employee_id <> p_employee_id
      or request.invited_by <> actor_id then
      raise exception 'Invitation request key was reused' using errcode = '23505';
    end if;
    return jsonb_build_object(
      'requestId', request.id, 'state', request.state,
      'authUserId', request.auth_user_id, 'replayed', true
    );
  end if;
  if exists (
    select 1 from public.organization_memberships membership
    join auth.users auth_user on auth_user.id = membership.user_id
    where membership.organization_id = p_organization_id
      and lower(auth_user.email) = clean_email
  ) or exists (
    select 1 from public.user_invitations invitation
    where invitation.organization_id = p_organization_id
      and invitation.email = clean_email and invitation.accepted_at is null
      and invitation.revoked_at is null and invitation.expires_at > clock_timestamp()
  ) then
    raise exception 'This person already has access or a pending invitation'
      using errcode = '23505';
  end if;

  select auth_user.id into existing_auth_user_id
  from auth.users auth_user where lower(auth_user.email) = clean_email;
  insert into public.user_invitation_requests (
    id, organization_id, email, display_name, role, location_ids, employee_id,
    auth_user_id, state, expires_at, invited_by
  ) values (
    p_request_id, p_organization_id, clean_email, btrim(p_display_name), p_role,
    clean_locations, p_employee_id, existing_auth_user_id,
    case when existing_auth_user_id is null then 'requested' else 'auth_created' end,
    p_expires_at, actor_id
  ) returning * into request;
  return jsonb_build_object(
    'requestId', request.id, 'state', request.state,
    'authUserId', request.auth_user_id, 'replayed', false
  );
end
$function$;

alter policy user_invitation_request_manager_read on public.user_invitation_requests
using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

comment on function public.can_manage_org(uuid) is 'Permanent password authentication with active Owner or Admin tenant membership. No MFA or geographic login requirement.';
comment on function public.is_owner_pending_mfa(uuid) is 'Compatibility helper: MFA is disabled permanently for Le Yard applications.';

update private.runtime_schema_contract_expected expected
set migration_head = '20260907141430',
    table_fingerprint = snapshot.value ->> 'tableFingerprint',
    function_fingerprint = snapshot.value ->> 'functionFingerprint',
    access_fingerprint = snapshot.value ->> 'accessFingerprint',
    captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
