-- Invitation requests become durable before Supabase Auth or provider calls.
-- Every uncertain boundary remains visible and retryable without false cleanup.

create table public.user_invitation_requests (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  display_name text not null check (length(btrim(display_name)) between 2 and 120),
  role public.app_role not null,
  location_ids uuid[] not null default '{}',
  employee_id uuid not null,
  auth_user_id uuid references auth.users(id) on delete restrict,
  invitation_id uuid references public.user_invitations(id) on delete restrict,
  state text not null default 'requested' check (state in (
    'requested','auth_created','provisioned','delivery_queued','sent','accepted',
    'reconciliation_required','failed','cancelled'
  )),
  attempts integer not null default 0 check (attempts between 0 and 20),
  last_error_code text,
  expires_at timestamptz not null,
  invited_by uuid not null references auth.users(id) on delete restrict,
  sent_at timestamptz,
  accepted_at timestamptz,
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, id)
);

create unique index user_invitation_request_active_email_idx
on public.user_invitation_requests (organization_id, email)
where state not in ('accepted','failed','cancelled');

alter table public.user_invitation_requests enable row level security;
alter table public.user_invitation_requests force row level security;
revoke all on table public.user_invitation_requests from public, anon, authenticated;
grant select on table public.user_invitation_requests to authenticated;
grant select, insert, update on table public.user_invitation_requests to service_role;

create policy user_invitation_request_manager_read
on public.user_invitation_requests for select to authenticated
using (
  public.has_org_role(
    organization_id,
    array['owner'::public.app_role, 'admin'::public.app_role]
  )
  and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
);

create function public.begin_user_invitation_request(
  p_request_id uuid,
  p_organization_id uuid,
  p_email text,
  p_display_name text,
  p_role public.app_role,
  p_location_ids uuid[],
  p_employee_id uuid,
  p_expires_at timestamptz
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  actor_role public.app_role;
  request public.user_invitation_requests%rowtype;
  clean_email text := lower(btrim(p_email));
  clean_locations uuid[] := coalesce(p_location_ids, '{}'::uuid[]);
  existing_auth_user_id uuid;
begin
  if actor_id is null or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'MFA-verified invitation access is required' using errcode = '42501';
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
$$;

create function private.bind_auth_user_to_invitation_request()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  request_id uuid;
begin
  begin
    request_id := nullif(new.raw_user_meta_data ->> 'invitation_request_id', '')::uuid;
  exception when others then
    return new;
  end;
  if request_id is null then return new; end if;
  update public.user_invitation_requests request
  set auth_user_id = new.id,
      state = case when request.state = 'requested' then 'auth_created' else request.state end,
      updated_at = clock_timestamp()
  where request.id = request_id
    and request.email = lower(new.email)
    and request.auth_user_id is null
    and request.state in ('requested','reconciliation_required');
  return new;
end
$$;

create trigger bind_auth_user_to_invitation_request
after insert on auth.users
for each row execute function private.bind_auth_user_to_invitation_request();

create function public.service_reconcile_user_invitation_auth(
  p_request_id uuid,
  p_auth_user_id uuid,
  p_error_code text default null
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare request public.user_invitation_requests%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  select * into request from public.user_invitation_requests candidate
  where candidate.id = p_request_id for update;
  if not found then raise exception 'Invitation request not found' using errcode = 'P0002'; end if;
  if p_auth_user_id is not null and not exists (
    select 1 from auth.users auth_user
    where auth_user.id = p_auth_user_id and lower(auth_user.email) = request.email
  ) then
    raise exception 'Invitation Auth identity does not match' using errcode = '23514';
  end if;
  update public.user_invitation_requests candidate
  set auth_user_id = coalesce(candidate.auth_user_id, p_auth_user_id),
      state = case
        when coalesce(candidate.auth_user_id, p_auth_user_id) is not null then 'auth_created'
        else 'reconciliation_required'
      end,
      attempts = candidate.attempts + 1,
      last_error_code = left(nullif(btrim(p_error_code), ''), 120),
      updated_at = clock_timestamp()
  where candidate.id = request.id returning * into request;
  return jsonb_build_object('requestId', request.id, 'state', request.state,
    'authUserId', request.auth_user_id);
end
$$;

create function public.service_provision_user_invitation_request(p_request_id uuid)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  request public.user_invitation_requests%rowtype;
  created_invitation_id uuid;
  token_hash text;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  select * into request from public.user_invitation_requests candidate
  where candidate.id = p_request_id for update;
  if not found or request.auth_user_id is null then
    raise exception 'Invitation Auth identity is unavailable' using errcode = 'P0002';
  end if;
  if request.state in ('provisioned','delivery_queued','sent','accepted') then
    return jsonb_build_object('requestId', request.id, 'state', request.state,
      'invitationId', request.invitation_id, 'replayed', true);
  end if;
  if request.state <> 'auth_created' or request.expires_at <= clock_timestamp() then
    raise exception 'Invitation request cannot be provisioned' using errcode = '23514';
  end if;
  if not exists (
    select 1 from auth.users auth_user
    where auth_user.id = request.auth_user_id
      and lower(auth_user.email) = request.email
      and auth_user.raw_app_meta_data ->> 'pending_organization_id' = request.organization_id::text
      and auth_user.raw_app_meta_data ->> 'pending_role' = request.role::text
  ) then
    raise exception 'Invitation Auth metadata does not match' using errcode = '23514';
  end if;
  token_hash := encode(extensions.digest(
    ('invitation-correlation:v2:' || request.id::text)::text, 'sha256'
  ), 'hex');
  insert into public.user_invitations (
    organization_id, email, role, location_ids, token_hash, expires_at, invited_by
  ) values (
    request.organization_id, request.email, request.role, request.location_ids,
    token_hash, request.expires_at, request.invited_by
  ) returning id into created_invitation_id;
  insert into public.organization_memberships (
    organization_id, user_id, role, status, invited_by
  ) values (
    request.organization_id, request.auth_user_id, request.role, 'invited', request.invited_by
  );
  insert into public.location_memberships (organization_id, location_id, user_id, is_primary)
  select request.organization_id, requested.id, request.auth_user_id, requested.ordinality = 1
  from unnest(request.location_ids) with ordinality requested(id, ordinality);
  insert into public.employees (
    id, organization_id, user_id, home_location_id, display_name, email,
    employment_status
  ) values (
    request.employee_id, request.organization_id, request.auth_user_id,
    request.location_ids[1], request.display_name, request.email, 'invited'
  );
  update public.user_invitation_requests candidate
  set invitation_id = created_invitation_id, state = 'provisioned', updated_at = clock_timestamp()
  where candidate.id = request.id;
  return jsonb_build_object('requestId', request.id, 'state', 'provisioned',
    'invitationId', created_invitation_id, 'replayed', false);
end
$$;

create function public.service_queue_user_invitation_delivery(
  p_request_id uuid,
  p_action_url text
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare request public.user_invitation_requests%rowtype;
begin
  if coalesce(auth.jwt() ->> 'role', '') <> 'service_role' then
    raise exception 'Service role required' using errcode = '42501';
  end if;
  select * into request from public.user_invitation_requests candidate
  where candidate.id = p_request_id for update;
  if not found or request.state not in ('provisioned','delivery_queued','sent')
    or p_action_url !~ '^https://' or length(p_action_url) > 4000 then
    raise exception 'Invitation delivery cannot be queued' using errcode = '22023';
  end if;
  if request.state = 'provisioned' then
    insert into private.identity_delivery_jobs (
      organization_id, location_id, workflow, correlation_id, channel,
      destination, destination_hash, template_data, dedupe_key
    ) values (
      request.organization_id, request.location_ids[1], 'user_invitation', request.id,
      'email', request.email,
      encode(extensions.digest(('user-invitation:v2:' || request.email)::text, 'sha256'), 'hex'),
      jsonb_build_object('actionUrl', p_action_url, 'expiresAt', request.expires_at),
      'user-invitation:' || request.id::text || ':email'
    );
    update public.user_invitation_requests candidate
    set state = 'delivery_queued', updated_at = clock_timestamp()
    where candidate.id = request.id;
  end if;
  return jsonb_build_object('requestId', request.id,
    'state', case when request.state = 'provisioned' then 'delivery_queued' else request.state end);
end
$$;

create function private.project_user_invitation_delivery_state()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if new.workflow = 'user_invitation' and new.status = 'sent' and old.status <> 'sent' then
    update public.user_invitation_requests request
    set state = 'sent', sent_at = new.sent_at, last_error_code = null,
      updated_at = clock_timestamp()
    where request.id = new.correlation_id and request.state = 'delivery_queued';
  elsif new.workflow = 'user_invitation' and new.status = 'failed' then
    update public.user_invitation_requests request
    set last_error_code = new.last_error_code, updated_at = clock_timestamp()
    where request.id = new.correlation_id;
  end if;
  return new;
end
$$;
create trigger project_user_invitation_delivery_state
after update of status on private.identity_delivery_jobs
for each row execute function private.project_user_invitation_delivery_state();

create function private.project_user_invitation_acceptance()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if new.accepted_at is not null and old.accepted_at is null then
    update public.user_invitation_requests request
    set state = 'accepted', accepted_at = new.accepted_at, updated_at = clock_timestamp()
    where request.invitation_id = new.id;
  end if;
  return new;
end
$$;
create trigger project_user_invitation_acceptance
after update of accepted_at on public.user_invitations
for each row execute function private.project_user_invitation_acceptance();

revoke all on function public.begin_user_invitation_request(
  uuid, uuid, text, text, public.app_role, uuid[], uuid, timestamptz
) from public, anon;
grant execute on function public.begin_user_invitation_request(
  uuid, uuid, text, text, public.app_role, uuid[], uuid, timestamptz
) to authenticated;
revoke all on function public.service_reconcile_user_invitation_auth(uuid, uuid, text)
from public, anon, authenticated;
revoke all on function public.service_provision_user_invitation_request(uuid)
from public, anon, authenticated;
revoke all on function public.service_queue_user_invitation_delivery(uuid, text)
from public, anon, authenticated;
grant execute on function public.service_reconcile_user_invitation_auth(uuid, uuid, text)
to service_role;
grant execute on function public.service_provision_user_invitation_request(uuid)
to service_role;
grant execute on function public.service_queue_user_invitation_delivery(uuid, text)
to service_role;
