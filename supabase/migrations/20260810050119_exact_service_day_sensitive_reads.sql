-- Snapshot-facing operational state must follow the effective capability
-- model. The original manager_location_read policy was role based, so its OR
-- composition with later policies let a Manager bypass an explicit deny.
-- Keep write policies unchanged and make each sensitive SELECT contract
-- authoritative at the exact organization/location scope.

drop policy if exists manager_location_read on public.shift_closeouts;
drop policy if exists service_day_closeout_read on public.shift_closeouts;
create policy service_day_closeout_read
on public.shift_closeouts
for select
to authenticated
using (
  public.has_any_capability(
    organization_id,
    location_id,
    array[
      'closeout.create',
      'closeout.approve',
      'reports.financial.view'
    ]
  )
);

drop policy if exists manager_location_read on public.inventory_counts;
drop policy if exists capability_count_read on public.inventory_counts;
drop policy if exists service_day_inventory_count_read on public.inventory_counts;
create policy service_day_inventory_count_read
on public.inventory_counts
for select
to authenticated
using (
  public.has_any_capability(
    organization_id,
    location_id,
    array[
      'inventory.count.create',
      'inventory.count.approve'
    ]
  )
);

drop policy if exists manager_location_read on public.inventory_par_levels;
drop policy if exists capability_par_read on public.inventory_par_levels;
drop policy if exists service_day_inventory_par_read on public.inventory_par_levels;
create policy service_day_inventory_par_read
on public.inventory_par_levels
for select
to authenticated
using (
  public.has_any_capability(
    organization_id,
    location_id,
    array[
      'inventory.par.manage',
      'inventory.count.create',
      'inventory.purchase.create',
      'prep.manage'
    ]
  )
);

drop policy if exists manager_log_authorized_read on public.manager_log_entries;
drop policy if exists service_day_manager_log_read on public.manager_log_entries;
create policy service_day_manager_log_read
on public.manager_log_entries
for select
to authenticated
using (
  public.has_capability(
    organization_id,
    location_id,
    'manager_log.manage'
  )
);

drop policy if exists manager_log_version_authorized_read on public.manager_log_versions;
drop policy if exists service_day_manager_log_version_read on public.manager_log_versions;
create policy service_day_manager_log_version_read
on public.manager_log_versions
for select
to authenticated
using (
  exists (
    select 1
    from public.manager_log_entries entry
    where entry.organization_id = manager_log_versions.organization_id
      and entry.id = manager_log_versions.manager_log_entry_id
  )
);

comment on policy service_day_closeout_read on public.shift_closeouts is
  'Exact effective capability read for detailed closeout financial state; explicit denials are not bypassed by membership role.';
comment on policy service_day_inventory_count_read on public.inventory_counts is
  'Exact effective capability read for inventory-count operational state.';
comment on policy service_day_inventory_par_read on public.inventory_par_levels is
  'Exact effective capability read for inventory par and replenishment state.';
comment on policy service_day_manager_log_read on public.manager_log_entries is
  'Exact effective manager-log capability read; membership role cannot bypass an explicit denial.';
comment on policy service_day_manager_log_version_read on public.manager_log_versions is
  'Manager-log history inherits the exact organization/location access of its parent entry.';
