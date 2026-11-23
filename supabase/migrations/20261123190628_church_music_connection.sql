-- Spotify grants are encrypted by the application and never exposed to staff clients.
create table public.music_connections (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  client_id text not null check (client_id ~ '^[a-f0-9]{32}$'),
  encrypted_grant text not null check (length(encrypted_grant) between 40 and 20000),
  refresh_lease_until timestamptz,
  connected_by uuid not null references auth.users(id),
  connected_at timestamptz not null default now(),
  primary key (organization_id, location_id),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade
);
alter table public.music_connections enable row level security;
alter table public.music_connections force row level security;
revoke all on public.music_connections from public, anon, authenticated;
grant select, insert, update, delete on public.music_connections to service_role;
comment on table public.music_connections is 'Server-only encrypted music grants. HTTP routes independently verify active Church Street owner/admin scope.';
create index music_connections_connected_by_idx on public.music_connections (connected_by);

-- Keep the existing runtime drift detector aligned with this additive schema.
update private.runtime_schema_contract_expected expected
set migration_head = '20261123190628', table_fingerprint = snapshot.value->>'tableFingerprint',
  function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint',
  captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
