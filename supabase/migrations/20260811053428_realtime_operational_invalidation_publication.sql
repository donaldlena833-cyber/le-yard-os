-- Realtime is an invalidation hint only; server/RLS-backed read models remain
-- authoritative. Add the exact browser-readable operational tables used by the
-- shared coalesced invalidation hook when the project's publication is enabled.
-- Service-only financial evidence (notably income_sales_checks) is deliberately
-- excluded so enabling Realtime never widens its browser data boundary.

do $realtime_operational_invalidation_publication$
declare
  table_name text;
begin
  if exists (
    select 1
    from pg_publication
    where pubname = 'supabase_realtime'
  ) then
    foreach table_name in array array[
      'checklist_responses',
      'checklist_runs',
      'deliveries',
      'expenses',
      'guests',
      'import_jobs',
      'incidents',
      'integration_connections',
      'integration_events',
      'integration_sync_jobs',
      'inventory_counts',
      'inventory_transactions',
      'inventory_transfers',
      'maintenance_requests',
      'manager_log_entries',
      'preshift_acknowledgements',
      'preshifts',
      'purchase_orders',
      'reservations',
      'service_availability_events',
      'service_shifts',
      'shift_closeouts',
      'sop_acknowledgements',
      'sop_documents',
      'sop_versions',
      'time_breaks',
      'time_entries',
      'time_entry_corrections',
      'tasks',
      'waste_records'
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
$realtime_operational_invalidation_publication$;
