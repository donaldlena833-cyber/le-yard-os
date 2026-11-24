create table public.team_learning_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid not null,
  kind text not null check (kind in ('course','lesson','exam','template','tick','note','resource')),
  record_key text not null check (length(record_key) between 1 and 300),
  payload jsonb not null check (jsonb_typeof(payload) = 'object'),
  updated_by uuid not null references auth.users(id) on delete restrict,
  updated_at timestamptz not null default now(),
  unique (organization_id, location_id, kind, record_key),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade
);
alter table public.team_learning_records enable row level security;
create policy learning_server_only on public.team_learning_records for all to anon, authenticated using (false) with check (false);
revoke all on public.team_learning_records from public, anon, authenticated;
grant select, insert, update, delete on public.team_learning_records to service_role;
create index team_learning_records_updated_by_idx on public.team_learning_records(updated_by);
create trigger set_updated_at before update on public.team_learning_records for each row execute function public.touch_updated_at();
comment on table public.team_learning_records is 'Location-scoped learning and daily checklist records. Server routes authorize membership; shared content editing uses owner/admin/manager role.';
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('team-learning','team-learning',false,15728640,array['application/pdf']) on conflict(id) do nothing;
update private.runtime_schema_contract_expected expected
set migration_head = '20261124055503', table_fingerprint = snapshot.value->>'tableFingerprint',
function_fingerprint = snapshot.value->>'functionFingerprint', access_fingerprint = snapshot.value->>'accessFingerprint', captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() value) snapshot
where expected.contract_version = 'runtime-schema-v2';
