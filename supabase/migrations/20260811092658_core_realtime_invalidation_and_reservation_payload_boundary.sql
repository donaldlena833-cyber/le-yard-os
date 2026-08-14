-- Realtime carries invalidation only. The server/RLS-backed read model remains
-- authoritative, and reservation broadcasts must never serialize operational
-- rows, guest context, provider payloads, notes, or management identifiers.

create or replace function public.broadcast_reservation_change()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  source_record jsonb := case
    when tg_op <> 'DELETE' then to_jsonb(new)
    else to_jsonb(old)
  end;
  organization_uuid uuid;
  location_uuid uuid;
  new_identity jsonb := case
    when tg_op <> 'DELETE' then jsonb_build_object(
      'id', to_jsonb(new) ->> 'id',
      'organization_id', to_jsonb(new) ->> 'organization_id',
      'location_id', to_jsonb(new) ->> 'location_id'
    )
    else null
  end;
  old_identity jsonb := case
    when tg_op <> 'INSERT' then jsonb_build_object(
      'id', to_jsonb(old) ->> 'id',
      'organization_id', to_jsonb(old) ->> 'organization_id',
      'location_id', to_jsonb(old) ->> 'location_id'
    )
    else null
  end;
begin
  organization_uuid := nullif(source_record ->> 'organization_id', '')::uuid;
  location_uuid := nullif(source_record ->> 'location_id', '')::uuid;

  if to_regnamespace('realtime') is not null
    and organization_uuid is not null
    and location_uuid is not null then
    execute 'select realtime.broadcast_changes($1,$2,$3,$4,$5,$6,$7)'
    using
      'reservations:' || organization_uuid::text || ':' || location_uuid::text,
      tg_op,
      tg_op,
      tg_table_name,
      tg_table_schema,
      new_identity,
      old_identity;
  end if;
  return null;
end
$$;

revoke all on function public.broadcast_reservation_change()
from public, anon, authenticated, service_role;

-- The original topic policy admitted every active location member. Require an
-- exact current reservation capability so a user cannot subscribe around the
-- page/read-model boundary.
do $reservation_realtime_invalidation_policy$
begin
  if to_regclass('realtime.messages') is not null then
    execute 'drop policy if exists le_yard_reservation_broadcast_read on realtime.messages';
    execute $policy$
      create policy le_yard_reservation_broadcast_read
      on realtime.messages for select to authenticated
      using (
        case
          when realtime.topic() ~ '^reservations:[0-9a-f-]{36}:[0-9a-f-]{36}$'
          then
            public.has_current_location_capability(
              split_part(realtime.topic(), ':', 2)::uuid,
              split_part(realtime.topic(), ':', 3)::uuid,
              'reservations.view'
            )
            or public.has_current_location_capability(
              split_part(realtime.topic(), ':', 2)::uuid,
              split_part(realtime.topic(), ':', 3)::uuid,
              'reservations.operate'
            )
            or public.has_current_location_capability(
              split_part(realtime.topic(), ':', 2)::uuid,
              split_part(realtime.topic(), ':', 3)::uuid,
              'reservations.override'
            )
            or public.has_current_location_capability(
              split_part(realtime.topic(), ':', 2)::uuid,
              split_part(realtime.topic(), ':', 3)::uuid,
              'reservations.configure'
            )
          else false
        end
      )
    $policy$;
  end if;
end
$reservation_realtime_invalidation_policy$;

-- Add the browser-readable operational sources now consumed by the shared
-- coalesced invalidation hook. Service-only evidence remains excluded.
do $core_realtime_invalidation_publication$
declare
  table_name text;
begin
  if exists (
    select 1 from pg_publication where pubname = 'supabase_realtime'
  ) then
    -- Postgres Changes cannot apply RLS or filters to DELETE payloads. Every
    -- browser consumer uses INSERT/UPDATE as an invalidation signal, so disable
    -- DELETE/TRUNCATE publication-wide instead of exposing record identifiers
    -- and timing to a direct authenticated subscriber.
    alter publication supabase_realtime set (
      publish = 'insert, update'
    );

    foreach table_name in array array[
      'closeout_attachments',
      'delivery_lines',
      'employee_job_roles',
      'schedule_templates',
      'schedule_template_shifts',
      'schedules',
      'shift_acknowledgements',
      'shift_swap_offers',
      'shift_swap_requests',
      'shifts',
      'tip_adjustments',
      'tip_allocations',
      'tip_pool_eligibility_rules',
      'tip_pool_policies',
      'tip_pool_policy_versions',
      'tip_run_participants',
      'tip_runs',
      'tip_sources'
    ]
    loop
      if not exists (
        select 1
        from pg_publication_tables
        where pubname = 'supabase_realtime'
          and schemaname = 'public'
          and tablename = table_name
      ) then
        execute format(
          'alter publication supabase_realtime add table public.%I',
          table_name
        );
      end if;
    end loop;
  end if;
end
$core_realtime_invalidation_publication$;
