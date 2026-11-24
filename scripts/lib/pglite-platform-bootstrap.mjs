export const bootstrap = `
  create schema if not exists extensions;
  create schema if not exists auth;
  create schema if not exists storage;

  do $$ begin create role anon nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role authenticated nologin; exception when duplicate_object then null; end $$;
  do $$ begin create role service_role nologin; exception when duplicate_object then null; end $$;
  create publication supabase_realtime;

  create table auth.users (
    instance_id uuid,
    id uuid primary key,
    aud text,
    role text,
    email text unique,
    encrypted_password text,
    email_confirmed_at timestamptz,
    raw_app_meta_data jsonb not null default '{}'::jsonb,
    raw_user_meta_data jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
  );

  create table auth.identities (
    id uuid primary key,
    provider_id text not null,
    user_id uuid not null references auth.users(id) on delete cascade,
    identity_data jsonb not null default '{}'::jsonb,
    provider text not null,
    last_sign_in_at timestamptz,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (provider_id, provider)
  );

  create function auth.jwt()
  returns jsonb language sql stable
  as $$
    select coalesce(nullif(current_setting('request.jwt.claims', true), '')::jsonb, '{}'::jsonb)
  $$;

  create function auth.uid()
  returns uuid language sql stable
  as $$
    select nullif(auth.jwt() ->> 'sub', '')::uuid
  $$;

  create function auth.role()
  returns text language sql stable
  as $$
    select coalesce(nullif(auth.jwt() ->> 'role', ''), current_user::text)
  $$;

  create table storage.buckets (
    id text primary key,
    name text not null unique,
    public boolean not null default false,
    file_size_limit bigint,
    allowed_mime_types text[]
  );

  create table storage.objects (
    id uuid primary key default gen_random_uuid(),
    bucket_id text not null references storage.buckets(id) on delete cascade,
    name text not null,
    owner_id text,
    metadata jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now(),
    unique (bucket_id, name)
  );
  alter table storage.objects enable row level security;
  grant usage on schema auth, storage to authenticated;
  grant select on storage.buckets to authenticated;
  grant select, insert, update, delete on storage.objects to authenticated;
`;
