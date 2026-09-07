-- Keep invitation authorization independent of authentication assurance.
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
    raise exception 'Authenticated invitation access is required' using errcode = '42501';
  end if;
  select membership.role into actor_role
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = actor_id and membership.status = 'active';
  if actor_role is null or actor_role not in ('owner', 'admin')
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

update private.runtime_schema_contract_expected expected
set migration_head = '20260907142312',
 table_fingerprint = snapshot.value ->> 'tableFingerprint',
 function_fingerprint = snapshot.value ->> 'functionFingerprint',
 access_fingerprint = snapshot.value ->> 'accessFingerprint',
 captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
