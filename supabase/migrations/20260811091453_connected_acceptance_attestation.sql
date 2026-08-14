-- Fail-closed connected acceptance attestation.
--
-- This migration deliberately creates no marker row. A marker is short-lived,
-- belongs only in an isolated nonproduction preview project, and must be
-- inserted by an authorized database operator after the synthetic fixture has
-- been reviewed. Production therefore remains unattested after migration.

create table private.connected_acceptance_targets (
  target_id uuid primary key,
  environment text not null
    check (environment = 'nonproduction_preview'),
  schema_version text not null
    check (schema_version ~ '^[0-9]{14}$'),
  fixture_id uuid not null unique,
  fixture_revision text not null
    check (
      length(fixture_revision) between 1 and 80
      and fixture_revision ~ '^[A-Za-z0-9][A-Za-z0-9._-]*$'
    ),
  expires_at timestamptz not null,
  created_at timestamptz not null default clock_timestamp(),
  created_by text not null
    check (length(btrim(created_by)) between 1 and 120),
  check (
    expires_at > created_at
    and expires_at <= created_at + interval '31 days'
  )
);

comment on table private.connected_acceptance_targets is
  'Short-lived, operator-created markers for isolated preview acceptance. Never seed or populate in production.';

alter table private.connected_acceptance_targets enable row level security;

revoke all on table private.connected_acceptance_targets
  from public, anon, authenticated, service_role;

create or replace function public.service_connected_acceptance_marker(
  p_target_id uuid,
  p_schema_version text,
  p_fixture_id uuid,
  p_fixture_revision text
)
returns table (
  target_id uuid,
  environment text,
  schema_version text,
  fixture_id uuid,
  fixture_revision text,
  expires_at timestamptz
)
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_latest_schema_version pg_catalog.text;
begin
  if pg_catalog.to_regclass('supabase_migrations.schema_migrations') is null then
    return;
  end if;

  execute
    'select max(version)::text from supabase_migrations.schema_migrations'
    into v_latest_schema_version;

  if v_latest_schema_version is distinct from p_schema_version then
    return;
  end if;

  return query
  select
    marker.target_id,
    marker.environment,
    marker.schema_version,
    marker.fixture_id,
    marker.fixture_revision,
    marker.expires_at
  from private.connected_acceptance_targets marker
  where marker.target_id = p_target_id
    and marker.schema_version = p_schema_version
    and marker.fixture_id = p_fixture_id
    and marker.fixture_revision = p_fixture_revision
    and marker.environment = 'nonproduction_preview'
    and marker.expires_at > pg_catalog.clock_timestamp();
end
$$;

comment on function public.service_connected_acceptance_marker(uuid, text, uuid, text) is
  'Service-role-only proof that the configured database contains the exact active isolated acceptance fixture and latest migration version.';

revoke all on function public.service_connected_acceptance_marker(uuid, text, uuid, text)
  from public, anon, authenticated;
grant execute on function public.service_connected_acceptance_marker(uuid, text, uuid, text)
  to service_role;
