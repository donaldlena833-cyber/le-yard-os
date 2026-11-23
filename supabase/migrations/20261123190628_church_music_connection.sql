-- Dedicated server-only music metadata; credentials remain encrypted in private Storage.
create table public.music_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  status text not null check (status in ('connected', 'disabled')),
  configuration jsonb not null check (jsonb_typeof(configuration) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, location_id),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade
);
alter table public.music_connections enable row level security;
alter table public.music_connections force row level security;
revoke all on public.music_connections from public, anon, authenticated;
grant select, insert, update, delete on public.music_connections to service_role;
create index music_connections_created_by_idx on public.music_connections(created_by);
create trigger set_updated_at before update on public.music_connections for each row execute function public.touch_updated_at();
create trigger capture_audit after insert or update or delete on public.music_connections for each row execute function public.capture_audit_event();
comment on table public.music_connections is 'Server-only scoped music metadata; no credentials. Music routes verify active owner/admin and location.';

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('music-connections','music-connections',false,20000,array['application/octet-stream'])
on conflict(id) do nothing;

update private.runtime_schema_contract_expected expected
set migration_head = '20261123190628', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
