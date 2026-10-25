-- Safe change counters use Postgres Changes, which checks current row access
-- at delivery. Private Broadcast permission can remain cached after access
-- withdrawal, so neither producer below sends to the legacy topics.

create table public.reservation_invalidation_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, location_id),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade
);
alter table public.reservation_invalidation_signals enable row level security;
alter table public.reservation_invalidation_signals force row level security;
revoke all on public.reservation_invalidation_signals from public, anon, authenticated, service_role;
grant select on public.reservation_invalidation_signals to authenticated, service_role;
create policy reservation_invalidation_signals_read on public.reservation_invalidation_signals
for select to authenticated using (public.has_current_location_capability(organization_id, location_id, 'reservations.view') or public.has_current_location_capability(organization_id, location_id, 'reservations.operate') or public.has_current_location_capability(organization_id, location_id, 'reservations.override') or public.has_current_location_capability(organization_id, location_id, 'reservations.configure'));
comment on table public.reservation_invalidation_signals is
  'One read-only safe revision per location; no operational record identifiers or notes. Current RLS governs every delivered change.';

create table public.service_control_invalidation_signals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  revision bigint not null default 1 check (revision >= 1),
  updated_at timestamptz not null default clock_timestamp(),
  unique (organization_id, location_id),
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade
);
alter table public.service_control_invalidation_signals enable row level security;
alter table public.service_control_invalidation_signals force row level security;
revoke all on public.service_control_invalidation_signals from public, anon, authenticated, service_role;
grant select on public.service_control_invalidation_signals to authenticated, service_role;
create policy service_control_invalidation_signals_read on public.service_control_invalidation_signals
for select to authenticated using (public.can_access_location(organization_id, location_id) or public.has_current_location_capability(organization_id, location_id, 'preshift.manage'));
comment on table public.service_control_invalidation_signals is
  'One read-only safe revision per location; no operational record identifiers or notes. Current RLS governs every delivered change.';

-- Keep the existing trigger identity and privileges; replace only its producer.
create or replace function public.broadcast_reservation_change()
returns trigger language plpgsql security definer
set search_path = '' set row_security = off
as $function$
declare
  scope record;
begin
  if tg_table_schema <> 'public' or tg_table_name not in ('reservations') then
    raise exception 'Operational invalidation is trigger-only' using errcode = '42501';
  end if;
  -- Invalidate both scopes if a privileged operation moves a row. Sorting
  -- multiple scopes gives concurrent moves a consistent lock order.
  for scope in
    select distinct
      nullif(value ->> 'organization_id', '')::uuid as organization_id,
      nullif(value ->> 'location_id', '')::uuid as location_id
    from (values
      (case when tg_op <> 'DELETE' then to_jsonb(new) end),
      (case when tg_op <> 'INSERT' then to_jsonb(old) end)
    ) records(value)
    where nullif(value ->> 'organization_id', '') is not null
      and nullif(value ->> 'location_id', '') is not null
    order by 1, 2
  loop
    insert into public.reservation_invalidation_signals as signal (organization_id, location_id)
    values (scope.organization_id, scope.location_id)
    on conflict (organization_id, location_id) do update
      set revision = signal.revision + 1, updated_at = clock_timestamp();
  end loop;
  return null;
end
$function$;
revoke all on function public.broadcast_reservation_change() from public, anon, authenticated, service_role;

-- Keep the existing trigger identity and privileges; replace only its producer.
create or replace function private.broadcast_preshift_invalidation()
returns trigger language plpgsql security definer
set search_path = '' set row_security = off
as $function$
declare
  scope record;
begin
  if tg_table_schema <> 'public' or tg_table_name not in ('preshifts', 'preshift_acknowledgements') then
    raise exception 'Operational invalidation is trigger-only' using errcode = '42501';
  end if;
  -- Invalidate both scopes if a privileged operation moves a row. Sorting
  -- multiple scopes gives concurrent moves a consistent lock order.
  for scope in
    select distinct
      nullif(value ->> 'organization_id', '')::uuid as organization_id,
      nullif(value ->> 'location_id', '')::uuid as location_id
    from (values
      (case when tg_op <> 'DELETE' then to_jsonb(new) end),
      (case when tg_op <> 'INSERT' then to_jsonb(old) end)
    ) records(value)
    where nullif(value ->> 'organization_id', '') is not null
      and nullif(value ->> 'location_id', '') is not null
    order by 1, 2
  loop
    insert into public.service_control_invalidation_signals as signal (organization_id, location_id)
    values (scope.organization_id, scope.location_id)
    on conflict (organization_id, location_id) do update
      set revision = signal.revision + 1, updated_at = clock_timestamp();
  end loop;
  return null;
end
$function$;
revoke all on function private.broadcast_preshift_invalidation() from public, anon, authenticated, service_role;

do $current_scope_realtime$
declare table_name text;
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    alter publication supabase_realtime set (publish = 'insert, update');
    foreach table_name in array array[
      'reservation_invalidation_signals', 'service_control_invalidation_signals'
    ] loop
      if not exists (select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = table_name) then
        execute format('alter publication supabase_realtime add table public.%I', table_name);
      end if;
    end loop;
  end if;
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists le_yard_reservation_broadcast_read on realtime.messages';
    execute 'drop policy if exists le_yard_preshift_invalidation_read on realtime.messages';
  end if;
end
$current_scope_realtime$;

update private.runtime_schema_contract_expected expected
set migration_head = '20261024192556',
 table_fingerprint = snapshot.value ->> 'tableFingerprint',
 function_fingerprint = snapshot.value ->> 'functionFingerprint',
 access_fingerprint = snapshot.value ->> 'accessFingerprint',
 captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
