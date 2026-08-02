-- Le Yard OS: tenant, identity, and authorization foundation.
-- Never place production secrets or owner contact data in migrations.

create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;

create schema if not exists private;
revoke all on schema private from public, anon, authenticated;

create type public.app_role as enum ('owner', 'admin', 'manager', 'employee');
create type public.membership_status as enum ('invited', 'active', 'suspended');
create type public.request_status as enum ('draft', 'pending', 'approved', 'denied', 'cancelled');
create type public.schedule_status as enum ('draft', 'published', 'archived');
create type public.shift_status as enum ('scheduled', 'open', 'claimed', 'in_progress', 'completed', 'cancelled');
create type public.channel_kind as enum ('all_staff', 'location', 'management', 'private');
create type public.time_entry_status as enum ('open', 'submitted', 'approved', 'corrected', 'rejected');
create type public.review_status as enum ('pending', 'in_review', 'approved', 'rejected');
create type public.run_status as enum ('draft', 'queued', 'running', 'calculated', 'review', 'approved', 'failed', 'cancelled');
create type public.tip_distribution_method as enum ('hours', 'points', 'weighted_hours');
create type public.inventory_transaction_kind as enum ('purchase', 'count_adjustment', 'waste', 'transfer_in', 'transfer_out', 'recipe_usage', 'manual_adjustment');
create type public.task_status as enum ('open', 'in_progress', 'blocked', 'completed', 'cancelled');
create type public.integration_provider as enum ('toast', 'resy', 'csv', 'manual', 'payroll', 'accounting', 'other');
create type public.job_status as enum ('queued', 'running', 'succeeded', 'partially_succeeded', 'failed', 'cancelled');
create type public.ai_run_kind as enum ('receipt_extraction', 'natural_language_search', 'report_summary', 'anomaly_detection', 'forecast');
create type public.consent_status as enum ('unknown', 'granted', 'revoked');

create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(btrim(name)) between 1 and 120),
  slug text not null check (slug ~ '^[a-z0-9]+(?:-[a-z0-9]+)*$'),
  timezone text not null default 'America/New_York',
  currency_code text not null default 'USD' check (currency_code ~ '^[A-Z]{3}$'),
  status text not null default 'active' check (status in ('active', 'suspended', 'closed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (slug),
  unique (id, slug)
);

create table public.locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null check (length(btrim(name)) between 1 and 120),
  code text not null check (code ~ '^[A-Z0-9_-]{2,20}$'),
  timezone text not null,
  address jsonb not null default '{}'::jsonb check (jsonb_typeof(address) = 'object'),
  phone text,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  display_name text not null check (length(btrim(display_name)) between 1 and 120),
  preferred_name text,
  avatar_path text,
  phone text,
  locale text not null default 'en-US',
  timezone text not null default 'America/New_York',
  last_seen_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.organization_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role public.app_role not null,
  status public.membership_status not null default 'invited',
  invited_by uuid references auth.users(id) on delete set null,
  invited_at timestamptz not null default now(),
  joined_at timestamptz,
  suspended_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, id),
  check ((status = 'active' and joined_at is not null) or status <> 'active')
);

create table public.location_memberships (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (location_id, user_id),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, user_id) references public.organization_memberships(organization_id, user_id) on delete cascade
);

create table public.organization_settings (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  week_starts_on smallint not null default 1 check (week_starts_on between 0 and 6),
  default_location_id uuid,
  branding jsonb not null default '{}'::jsonb check (jsonb_typeof(branding) = 'object'),
  feature_flags jsonb not null default '{}'::jsonb check (jsonb_typeof(feature_flags) = 'object'),
  configured_at timestamptz,
  updated_at timestamptz not null default now(),
  foreign key (organization_id, default_location_id) references public.locations(organization_id, id) on delete set null
);

create table public.user_invitations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  email text not null check (email = lower(email) and position('@' in email) > 1),
  role public.app_role not null,
  location_ids uuid[] not null default '{}',
  token_hash text not null,
  temporary_credential_expires_at timestamptz,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  revoked_at timestamptz,
  invited_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  unique (organization_id, email)
);

create table public.retention_policies (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data_class text not null,
  retention_days integer check (retention_days is null or retention_days > 0),
  legal_hold boolean not null default false,
  configured_by uuid references auth.users(id) on delete set null,
  configured_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, data_class)
);

create table public.audit_events (
  id bigint generated always as identity primary key,
  occurred_at timestamptz not null default clock_timestamp(),
  organization_id uuid references public.organizations(id) on delete restrict,
  location_id uuid,
  actor_id uuid references auth.users(id) on delete set null,
  actor_role public.app_role,
  action text not null,
  table_name text not null,
  record_id text,
  old_record jsonb,
  new_record jsonb,
  request_id text,
  ip_address inet,
  user_agent text,
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object')
);

create index organization_memberships_user_idx on public.organization_memberships(user_id, status);
create index location_memberships_user_idx on public.location_memberships(user_id, location_id);
create index invitations_expiry_idx on public.user_invitations(expires_at) where accepted_at is null and revoked_at is null;
create index audit_events_org_time_idx on public.audit_events(organization_id, occurred_at desc);
create index audit_events_record_idx on public.audit_events(table_name, record_id, occurred_at desc);

create function public.current_user_id()
returns uuid
language sql stable
set search_path = ''
as $$ select auth.uid() $$;

create function public.jwt_aal()
returns text
language sql stable
set search_path = ''
as $$ select coalesce(auth.jwt() ->> 'aal', 'aal1') $$;

create function public.can_access_org(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  )
$$;

create function public.org_role(p_organization_id uuid)
returns public.app_role
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select m.role from public.organization_memberships m
  where m.organization_id = p_organization_id
    and m.user_id = auth.uid()
    and m.status = 'active'
$$;

create function public.has_org_role(p_organization_id uuid, p_roles public.app_role[])
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(p_roles)
  )
$$;

create function public.can_manage_org(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1 from public.organization_memberships m
    where m.organization_id = p_organization_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and (
        m.role = 'admin'
        or (m.role = 'owner' and coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2')
      )
  )
$$;

create function public.can_access_location(p_organization_id uuid, p_location_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.organization_memberships om
    where om.organization_id = p_organization_id
      and om.user_id = auth.uid()
      and om.status = 'active'
      and (
        om.role in ('owner', 'admin')
        or exists (
          select 1 from public.location_memberships lm
          where lm.organization_id = p_organization_id
            and lm.location_id = p_location_id
            and lm.user_id = auth.uid()
        )
      )
  )
$$;

create function public.can_manage_location(p_organization_id uuid, p_location_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select public.can_manage_org(p_organization_id)
    or exists (
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
$$;

create function public.shares_active_org(p_other_user_id uuid)
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
    where mine.user_id = auth.uid() and mine.status = 'active'
      and theirs.user_id = p_other_user_id and theirs.status = 'active'
  )
$$;

create function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end
$$;

create function public.handle_new_auth_user()
returns trigger
language plpgsql security definer
set search_path = ''
as $$
begin
  insert into public.profiles (id, display_name, preferred_name)
  values (
    new.id,
    coalesce(nullif(new.raw_user_meta_data ->> 'display_name', ''), split_part(coalesce(new.email, 'Team member'), '@', 1)),
    nullif(new.raw_user_meta_data ->> 'preferred_name', '')
  )
  on conflict (id) do nothing;
  return new;
end
$$;

create trigger on_auth_user_created
after insert on auth.users
for each row execute function public.handle_new_auth_user();

create function public.prevent_audit_mutation()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  raise exception 'audit_events is append-only' using errcode = '42501';
end
$$;

create trigger audit_events_immutable
before update or delete on public.audit_events
for each row execute function public.prevent_audit_mutation();

revoke all on all functions in schema public from public;
grant execute on function public.current_user_id() to authenticated;
grant execute on function public.jwt_aal() to authenticated;
grant execute on function public.can_access_org(uuid) to authenticated;
grant execute on function public.org_role(uuid) to authenticated;
grant execute on function public.has_org_role(uuid, public.app_role[]) to authenticated;
grant execute on function public.can_manage_org(uuid) to authenticated;
grant execute on function public.can_access_location(uuid, uuid) to authenticated;
grant execute on function public.can_manage_location(uuid, uuid) to authenticated;
grant execute on function public.shares_active_org(uuid) to authenticated;

comment on function public.can_manage_org(uuid) is 'Owner writes require an aal2 JWT; admins may manage at aal1. Tenant creation remains server-only.';
comment on table public.user_invitations is 'Stores only hashed one-time invitation material; existing or recoverable passwords are never stored.';
comment on table public.retention_policies is 'No defaults are invented. retention_days remains null until owners approve a policy.';
