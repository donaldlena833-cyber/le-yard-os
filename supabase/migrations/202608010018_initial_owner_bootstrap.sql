-- Le Yard OS: one-time, service-only bootstrap for the first tenant and two Owner invitations.
-- This command never creates passwords. Supabase Auth owns the actionable invitation links.

create table private.initial_tenant_bootstrap_requests (
  request_id uuid primary key,
  organization_id uuid not null unique,
  input_hash text not null check (input_hash ~ '^[0-9a-f]{64}$'),
  completed_at timestamptz,
  created_at timestamptz not null default clock_timestamp()
);

revoke all on table private.initial_tenant_bootstrap_requests
from public, anon, authenticated, service_role;

create function public.bootstrap_initial_tenant(
  p_request_id uuid,
  p_organization_id uuid,
  p_organization_name text,
  p_organization_slug text,
  p_timezone text,
  p_currency_code text,
  p_locations jsonb,
  p_donald_user_id uuid,
  p_donald_email text,
  p_donald_display_name text,
  p_donald_employee_id uuid,
  p_donald_token_hash text,
  p_maris_user_id uuid,
  p_maris_email text,
  p_maris_display_name text,
  p_maris_employee_id uuid,
  p_maris_token_hash text,
  p_expires_at timestamptz
)
returns uuid
language plpgsql
security definer
set search_path = ''
set row_security = off
as $$
declare
  input_hash text;
  prior private.initial_tenant_bootstrap_requests%rowtype;
  location_count integer;
  distinct_location_ids integer;
  distinct_location_codes integer;
  matched_auth_users integer;
  default_location_id uuid;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Initial tenant bootstrap is service-only' using errcode = '42501';
  end if;

  if p_request_id is null or p_organization_id is null
    or p_donald_user_id is null or p_maris_user_id is null
    or p_donald_employee_id is null or p_maris_employee_id is null then
    raise exception 'Bootstrap identifiers are required' using errcode = '22023';
  end if;
  if p_donald_user_id = p_maris_user_id
    or p_donald_employee_id = p_maris_employee_id
    or lower(btrim(p_donald_email)) = lower(btrim(p_maris_email)) then
    raise exception 'The two Owner identities must be distinct' using errcode = '22023';
  end if;
  if p_donald_email <> lower(btrim(p_donald_email))
    or p_maris_email <> lower(btrim(p_maris_email))
    or position('@' in p_donald_email) <= 1
    or position('@' in p_maris_email) <= 1
    or length(btrim(p_donald_display_name)) not between 2 and 120
    or length(btrim(p_maris_display_name)) not between 2 and 120
    or p_donald_token_hash !~ '^[0-9a-f]{64}$'
    or p_maris_token_hash !~ '^[0-9a-f]{64}$'
    or p_donald_token_hash = p_maris_token_hash then
    raise exception 'Owner invitation fields are invalid' using errcode = '22023';
  end if;
  if p_expires_at <= now() or p_expires_at > now() + interval '7 days' then
    raise exception 'Owner invitation expiry is outside the allowed window' using errcode = '22023';
  end if;

  if jsonb_typeof(p_locations) is distinct from 'array' then
    raise exception 'Bootstrap locations must be a JSON array' using errcode = '22023';
  end if;
  if jsonb_array_length(p_locations) < 1
    or jsonb_array_length(p_locations) > 100 then
    raise exception 'Bootstrap requires between one and 100 locations' using errcode = '22023';
  end if;

  begin
    select count(*), count(distinct location.id), count(distinct location.code)
      into location_count, distinct_location_ids, distinct_location_codes
    from jsonb_to_recordset(p_locations) as location(
      id uuid,
      name text,
      code text,
      timezone text,
      address jsonb,
      phone text
    );
  exception when others then
    raise exception 'Location bootstrap payload is invalid' using errcode = '22023';
  end;
  default_location_id := (p_locations -> 0 ->> 'id')::uuid;

  if location_count <> jsonb_array_length(p_locations)
    or distinct_location_ids <> location_count
    or distinct_location_codes <> location_count
    or exists (
      select 1
      from jsonb_to_recordset(p_locations) as location(
        id uuid,
        name text,
        code text,
        timezone text,
        address jsonb,
        phone text
      )
      where location.id is null
        or length(btrim(location.name)) not between 1 and 120
        or location.code !~ '^[A-Z0-9_-]{2,20}$'
        or btrim(coalesce(location.timezone, '')) = ''
        or jsonb_typeof(location.address) is distinct from 'object'
    ) then
    raise exception 'Location bootstrap payload is invalid' using errcode = '22023';
  end if;

  input_hash := encode(
    extensions.digest(
      convert_to(
        concat_ws(
          chr(31),
          p_organization_id::text,
          btrim(p_organization_name),
          p_organization_slug,
          p_timezone,
          p_currency_code,
          p_locations::text,
          p_donald_user_id::text,
          p_donald_email,
          btrim(p_donald_display_name),
          p_donald_employee_id::text,
          p_donald_token_hash,
          p_maris_user_id::text,
          p_maris_email,
          btrim(p_maris_display_name),
          p_maris_employee_id::text,
          p_maris_token_hash,
          p_expires_at::text
        ),
        'UTF8'
      ),
      'sha256'
    ),
    'hex'
  );

  perform pg_advisory_xact_lock(hashtextextended('initial-tenant-bootstrap', 0));

  select * into prior
  from private.initial_tenant_bootstrap_requests request
  where request.request_id = p_request_id;
  if prior.request_id is not null then
    if prior.organization_id = p_organization_id
      and prior.input_hash = input_hash
      and prior.completed_at is not null then
      return prior.organization_id;
    end if;
    raise exception 'Bootstrap request id was reused with different input' using errcode = '23505';
  end if;

  if exists (select 1 from public.organizations)
    or exists (select 1 from public.organization_memberships) then
    raise exception 'Initial tenant bootstrap requires an empty application database'
      using errcode = '23514';
  end if;

  select count(*) into matched_auth_users
  from auth.users auth_user
  where (auth_user.id = p_donald_user_id and lower(auth_user.email) = p_donald_email)
     or (auth_user.id = p_maris_user_id and lower(auth_user.email) = p_maris_email);
  if matched_auth_users <> 2 then
    raise exception 'Owner Auth invitation identities do not match' using errcode = '23514';
  end if;
  if exists (
    select 1
    from auth.users auth_user
    where auth_user.id in (p_donald_user_id, p_maris_user_id)
      and (
        auth_user.raw_app_meta_data ->> 'pending_organization_id' is distinct from p_organization_id::text
        or auth_user.raw_app_meta_data ->> 'pending_role' is distinct from 'owner'
        or auth_user.raw_app_meta_data ->> 'bootstrap_request_id' is distinct from p_request_id::text
      )
  ) then
    raise exception 'Owner Auth invitation metadata does not match the bootstrap request'
      using errcode = '23514';
  end if;

  insert into private.initial_tenant_bootstrap_requests (
    request_id,
    organization_id,
    input_hash
  ) values (
    p_request_id,
    p_organization_id,
    input_hash
  );

  insert into public.organizations (
    id,
    name,
    slug,
    timezone,
    currency_code
  ) values (
    p_organization_id,
    btrim(p_organization_name),
    p_organization_slug,
    p_timezone,
    p_currency_code
  );

  insert into public.locations (
    id,
    organization_id,
    name,
    code,
    timezone,
    address,
    phone
  )
  select location.id,
    p_organization_id,
    btrim(location.name),
    location.code,
    location.timezone,
    location.address,
    nullif(btrim(location.phone), '')
  from jsonb_to_recordset(p_locations) as location(
    id uuid,
    name text,
    code text,
    timezone text,
    address jsonb,
    phone text
  );

  insert into public.organization_settings (
    organization_id,
    default_location_id
  ) values (
    p_organization_id,
    default_location_id
  );

  insert into public.user_invitations (
    organization_id,
    email,
    role,
    location_ids,
    token_hash,
    expires_at,
    invited_by
  ) values
    (
      p_organization_id,
      p_donald_email,
      'owner',
      '{}'::uuid[],
      p_donald_token_hash,
      p_expires_at,
      p_donald_user_id
    ),
    (
      p_organization_id,
      p_maris_email,
      'owner',
      '{}'::uuid[],
      p_maris_token_hash,
      p_expires_at,
      p_donald_user_id
    );

  insert into public.organization_memberships (
    organization_id,
    user_id,
    role,
    status,
    invited_by
  ) values
    (p_organization_id, p_donald_user_id, 'owner', 'invited', p_donald_user_id),
    (p_organization_id, p_maris_user_id, 'owner', 'invited', p_donald_user_id);

  insert into public.employees (
    id,
    organization_id,
    user_id,
    display_name,
    email,
    employment_status
  ) values
    (
      p_donald_employee_id,
      p_organization_id,
      p_donald_user_id,
      btrim(p_donald_display_name),
      p_donald_email,
      'invited'
    ),
    (
      p_maris_employee_id,
      p_organization_id,
      p_maris_user_id,
      btrim(p_maris_display_name),
      p_maris_email,
      'invited'
    );

  update private.initial_tenant_bootstrap_requests request
  set completed_at = clock_timestamp()
  where request.request_id = p_request_id;

  return p_organization_id;
end
$$;

revoke all on function public.bootstrap_initial_tenant(
  uuid, uuid, text, text, text, text, jsonb,
  uuid, text, text, uuid, text,
  uuid, text, text, uuid, text, timestamptz
) from public, anon, authenticated;
grant usage on schema public to service_role;
grant execute on function public.bootstrap_initial_tenant(
  uuid, uuid, text, text, text, text, jsonb,
  uuid, text, text, uuid, text,
  uuid, text, text, uuid, text, timestamptz
) to service_role;

comment on function public.bootstrap_initial_tenant(
  uuid, uuid, text, text, text, text, jsonb,
  uuid, text, text, uuid, text,
  uuid, text, text, uuid, text, timestamptz
) is 'One-time service-only bootstrap for an empty application database. Creates the first tenant and two pending Owner memberships after Supabase Auth has sent their one-time invitations; never creates passwords.';
