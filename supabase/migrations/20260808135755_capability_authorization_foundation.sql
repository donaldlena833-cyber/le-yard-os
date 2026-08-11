-- Le Yard OS: operational capability authorization layered beneath organization roles.
-- Capability assignments are effective-dated, actor-derived, location-scoped,
-- idempotent, and audited. Organization security administration remains role-bound.

create table public.capability_definitions (
  capability_key text primary key
    check (capability_key ~ '^[a-z][a-z0-9_]*(\.[a-z][a-z0-9_]*)+$'),
  domain text not null check (domain ~ '^[a-z][a-z0-9_]*$'),
  label text not null check (length(btrim(label)) between 1 and 120),
  description text not null check (length(btrim(description)) between 1 and 500),
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

comment on table public.capability_definitions is
  'System-owned operational capability catalog. It contains no restaurant policy values.';

insert into public.capability_definitions (capability_key, domain, label, description)
values
  ('inventory.catalog.manage', 'inventory', 'Manage inventory catalog', 'Create, edit, deactivate, and restore inventory catalog records.'),
  ('inventory.par.manage', 'inventory', 'Manage inventory pars', 'Configure location-specific par and reorder targets.'),
  ('inventory.count.create', 'inventory', 'Create inventory counts', 'Record and submit inventory counts at assigned locations.'),
  ('inventory.count.approve', 'inventory', 'Approve inventory counts', 'Independently review submitted inventory counts.'),
  ('inventory.waste.create', 'inventory', 'Record waste', 'Record inventory waste at assigned locations.'),
  ('inventory.waste.approve', 'inventory', 'Approve waste', 'Independently review submitted waste records.'),
  ('inventory.transfer.create', 'inventory', 'Create transfers', 'Create inventory transfers from assigned locations.'),
  ('inventory.transfer.approve', 'inventory', 'Approve transfers', 'Independently receive and review inventory transfers.'),
  ('inventory.purchase.create', 'inventory', 'Create purchase orders', 'Create and revise draft purchase orders.'),
  ('inventory.purchase.approve', 'inventory', 'Approve purchase orders', 'Independently approve submitted purchase orders.'),
  ('inventory.receive', 'inventory', 'Receive inventory', 'Receive deliveries and record receiving evidence.'),
  ('inventory.vendor.manage', 'inventory', 'Manage vendors', 'Maintain operational vendor and purchase-pack details.'),
  ('inventory.price.manage', 'inventory', 'Manage vendor prices', 'Record vendor prices and price-history evidence.'),
  ('recipe.manage', 'kitchen', 'Manage recipes', 'Create, version, deactivate, and restore recipes.'),
  ('prep.manage', 'kitchen', 'Manage prep plans', 'Create, assign, and adjust prep and production plans.'),
  ('prep.complete', 'kitchen', 'Complete prep work', 'Start and complete assigned prep work with evidence.'),
  ('menu.manage', 'kitchen', 'Manage menu operations', 'Manage internal menu mappings, costing, and availability context.'),
  ('schedule.manage', 'service', 'Manage schedules', 'Create and adjust schedules for assigned locations.'),
  ('schedule.publish', 'service', 'Publish schedules', 'Publish and archive schedules for assigned locations.'),
  ('time.review', 'service', 'Review time records', 'Review time records and correction requests.'),
  ('time.approve', 'service', 'Approve time records', 'Independently approve time corrections.'),
  ('preshift.manage', 'service', 'Manage pre-shift', 'Create, publish, and review pre-shift workflows.'),
  ('availability.manage', 'service', 'Manage team availability', 'Review and manage availability within assigned locations.'),
  ('service.availability.manage', 'service', 'Manage service availability', 'Update internal running-low and 86 availability.'),
  ('manager_log.manage', 'operations', 'Manage manager log', 'Create, follow up, and resolve manager handoff entries.'),
  ('guest.manage', 'guests', 'Manage guests', 'Manage permitted guest and reservation operations.'),
  ('guest.sensitive_notes.view', 'guests', 'View sensitive guest notes', 'View restricted management-only guest context.'),
  ('guest_recovery.manage', 'guests', 'Manage guest recovery', 'Create and resolve guest-recovery cases.'),
  ('closeout.create', 'money', 'Create closeouts', 'Prepare service closeout evidence.'),
  ('closeout.approve', 'money', 'Approve closeouts', 'Independently approve service closeouts.'),
  ('cash.manage', 'money', 'Manage cash', 'Prepare and review operational cash evidence.'),
  ('tip.calculate', 'money', 'Calculate tips', 'Prepare and calculate deterministic tip runs.'),
  ('tip.approve', 'money', 'Approve tips', 'Independently approve deterministic tip runs.'),
  ('maintenance.manage', 'operations', 'Manage maintenance', 'Assign, update, and resolve maintenance work.'),
  ('food_safety.manage', 'operations', 'Manage food-safety logs', 'Manage owner-approved operational food-safety checks.'),
  ('reports.operational.view', 'insights', 'View operational reports', 'View operational reports within assigned locations.'),
  ('reports.financial.view', 'insights', 'View financial reports', 'View restricted operating-financial reports.'),
  ('budget.manage', 'money', 'Manage budgets', 'Configure and review operating targets and budgets.'),
  ('integrations.manage', 'settings', 'Manage integrations', 'Configure approved provider connections and imports.'),
  ('employee.performance.view', 'team', 'View contextual performance', 'View restricted contextual employee performance evidence.');

create table public.job_role_capabilities (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  job_role_id uuid not null,
  capability_key text not null references public.capability_definitions(capability_key) on delete restrict,
  location_id uuid,
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, job_role_id)
    references public.job_roles(organization_id, id) on delete cascade,
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, id),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index job_role_capabilities_org_scope_unique
on public.job_role_capabilities (
  organization_id, job_role_id, capability_key, effective_from
)
where location_id is null;

create unique index job_role_capabilities_location_scope_unique
on public.job_role_capabilities (
  organization_id, job_role_id, capability_key, location_id, effective_from
)
where location_id is not null;

create index job_role_capabilities_effective_idx
on public.job_role_capabilities (
  organization_id, job_role_id, capability_key, location_id, effective_from, effective_to
)
where is_active;

create table public.user_capability_overrides (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  user_id uuid not null,
  capability_key text not null references public.capability_definitions(capability_key) on delete restrict,
  location_id uuid,
  effect text not null check (effect in ('grant', 'deny')),
  reason text not null check (length(btrim(reason)) between 1 and 500),
  effective_from date not null default current_date,
  effective_to date,
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  updated_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, user_id)
    references public.organization_memberships(organization_id, user_id) on delete cascade,
  foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, id),
  check (effective_to is null or effective_to >= effective_from)
);

create unique index user_capability_overrides_org_scope_unique
on public.user_capability_overrides (
  organization_id, user_id, capability_key, effective_from
)
where location_id is null;

create unique index user_capability_overrides_location_scope_unique
on public.user_capability_overrides (
  organization_id, user_id, capability_key, location_id, effective_from
)
where location_id is not null;

create index user_capability_overrides_effective_idx
on public.user_capability_overrides (
  organization_id, user_id, capability_key, location_id, effect, effective_from, effective_to
)
where is_active;

alter table public.capability_definitions enable row level security;
alter table public.capability_definitions force row level security;
alter table public.job_role_capabilities enable row level security;
alter table public.job_role_capabilities force row level security;
alter table public.user_capability_overrides enable row level security;
alter table public.user_capability_overrides force row level security;

create policy capability_definition_authenticated_read
on public.capability_definitions for select to authenticated
using ((select auth.uid()) is not null);

create policy job_role_capability_admin_read
on public.job_role_capabilities for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])));

create policy user_capability_override_admin_read
on public.user_capability_overrides for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])));

revoke all on public.capability_definitions from public, anon, authenticated;
revoke all on public.job_role_capabilities from public, anon, authenticated;
revoke all on public.user_capability_overrides from public, anon, authenticated;
grant select on public.capability_definitions to authenticated;
grant select on public.job_role_capabilities to authenticated;
grant select on public.user_capability_overrides to authenticated;

create trigger capability_definitions_updated_at
before update on public.capability_definitions
for each row execute function public.touch_updated_at();

create trigger job_role_capabilities_updated_at
before update on public.job_role_capabilities
for each row execute function public.touch_updated_at();

create trigger user_capability_overrides_updated_at
before update on public.user_capability_overrides
for each row execute function public.touch_updated_at();

create trigger job_role_capabilities_audit
after insert or update or delete on public.job_role_capabilities
for each row execute function public.capture_audit_event();

create trigger user_capability_overrides_audit
after insert or update or delete on public.user_capability_overrides
for each row execute function public.capture_audit_event();

create function private.user_has_capability(
  p_user_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_capability_key text,
  p_effective_on date default current_date
)
returns boolean
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  member_role public.app_role;
begin
  if p_user_id is null or p_organization_id is null or p_location_id is null
    or p_capability_key is null or p_effective_on is null then
    return false;
  end if;

  if not exists (
    select 1
    from public.capability_definitions definition
    where definition.capability_key = p_capability_key
      and definition.is_active
  ) then
    return false;
  end if;

  select membership.role into member_role
  from public.organization_memberships membership
  where membership.organization_id = p_organization_id
    and membership.user_id = p_user_id
    and membership.status = 'active';

  if member_role is null then return false; end if;

  if not exists (
    select 1
    from public.locations location
    where location.organization_id = p_organization_id
      and location.id = p_location_id
      and location.is_active
      and (
        member_role in ('owner', 'admin')
        or exists (
          select 1
          from public.location_memberships location_membership
          where location_membership.organization_id = p_organization_id
            and location_membership.location_id = p_location_id
            and location_membership.user_id = p_user_id
        )
      )
  ) then
    return false;
  end if;

  if member_role in ('owner', 'admin') then return true; end if;

  if exists (
    select 1
    from public.user_capability_overrides override
    where override.organization_id = p_organization_id
      and override.user_id = p_user_id
      and override.capability_key = p_capability_key
      and override.effect = 'deny'
      and override.is_active
      and (override.location_id is null or override.location_id = p_location_id)
      and override.effective_from <= p_effective_on
      and (override.effective_to is null or override.effective_to >= p_effective_on)
  ) then
    return false;
  end if;

  if exists (
    select 1
    from public.user_capability_overrides override
    where override.organization_id = p_organization_id
      and override.user_id = p_user_id
      and override.capability_key = p_capability_key
      and override.effect = 'grant'
      and override.is_active
      and (override.location_id is null or override.location_id = p_location_id)
      and override.effective_from <= p_effective_on
      and (override.effective_to is null or override.effective_to >= p_effective_on)
  ) then
    return true;
  end if;

  return exists (
    select 1
    from public.employees employee
    join public.employee_job_roles assignment
      on assignment.organization_id = employee.organization_id
     and assignment.employee_id = employee.id
     and assignment.location_id = p_location_id
     and assignment.effective_from <= p_effective_on
     and (assignment.effective_to is null or assignment.effective_to >= p_effective_on)
    join public.job_roles job_role
      on job_role.organization_id = assignment.organization_id
     and job_role.id = assignment.job_role_id
     and job_role.is_active
    join public.job_role_capabilities capability
      on capability.organization_id = assignment.organization_id
     and capability.job_role_id = assignment.job_role_id
     and capability.capability_key = p_capability_key
     and capability.is_active
     and (capability.location_id is null or capability.location_id = p_location_id)
     and capability.effective_from <= p_effective_on
     and (capability.effective_to is null or capability.effective_to >= p_effective_on)
    where employee.organization_id = p_organization_id
      and employee.user_id = p_user_id
      and employee.employment_status = 'active'
  );
end
$$;

create function public.has_capability(
  p_organization_id uuid,
  p_location_id uuid,
  p_capability_key text,
  p_effective_on date default current_date
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select private.user_has_capability(
    auth.uid(), p_organization_id, p_location_id, p_capability_key, p_effective_on
  )
$$;

create function public.has_any_capability(
  p_organization_id uuid,
  p_location_id uuid,
  p_capability_keys text[],
  p_effective_on date default current_date
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(bool_or(private.user_has_capability(
    auth.uid(), p_organization_id, p_location_id, capability_key, p_effective_on
  )), false)
  from unnest(coalesce(p_capability_keys, '{}'::text[])) capability_key
$$;

create function public.has_any_location_capability(
  p_organization_id uuid,
  p_capability_keys text[],
  p_effective_on date default current_date
)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1
    from public.locations location
    where location.organization_id = p_organization_id
      and location.is_active
      and public.has_any_capability(
        p_organization_id, location.id, p_capability_keys, p_effective_on
      )
  )
$$;

create function public.effective_capabilities(
  p_organization_id uuid,
  p_location_id uuid,
  p_effective_on date default current_date
)
returns table (capability_key text)
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select definition.capability_key
  from public.capability_definitions definition
  where definition.is_active
    and private.user_has_capability(
      auth.uid(), p_organization_id, p_location_id,
      definition.capability_key, p_effective_on
    )
  order by definition.capability_key
$$;

revoke all on function private.user_has_capability(uuid, uuid, uuid, text, date)
from public, anon, authenticated;
revoke all on function public.has_capability(uuid, uuid, text, date)
from public, anon, authenticated;
revoke all on function public.has_any_capability(uuid, uuid, text[], date)
from public, anon, authenticated;
revoke all on function public.has_any_location_capability(uuid, text[], date)
from public, anon, authenticated;
revoke all on function public.effective_capabilities(uuid, uuid, date)
from public, anon, authenticated;
grant execute on function public.has_capability(uuid, uuid, text, date) to authenticated;
grant execute on function public.has_any_capability(uuid, uuid, text[], date) to authenticated;
grant execute on function public.has_any_location_capability(uuid, text[], date) to authenticated;
grant execute on function public.effective_capabilities(uuid, uuid, date) to authenticated;

create function public.configure_job_role_capability(
  p_request_id uuid,
  p_organization_id uuid,
  p_assignment_id uuid,
  p_job_role_id uuid,
  p_capability_key text,
  p_location_id uuid,
  p_effective_from date,
  p_effective_to date,
  p_is_active boolean
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  target_id uuid := coalesce(p_assignment_id, p_request_id);
  existing public.job_role_capabilities%rowtype;
  claimed boolean;
  canonical_payload jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_organization_id is null or target_id is null
    or p_job_role_id is null or p_capability_key is null
    or p_effective_from is null or p_is_active is null
    or (p_effective_to is not null and p_effective_to < p_effective_from) then
    raise exception 'A valid capability assignment is required' using errcode = '22023';
  end if;
  if not public.can_manage_org(p_organization_id) then
    raise exception 'Owner or admin access is required to configure capabilities'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.job_roles job_role
    where job_role.organization_id = p_organization_id
      and job_role.id = p_job_role_id
  ) or not exists (
    select 1 from public.capability_definitions definition
    where definition.capability_key = p_capability_key and definition.is_active
  ) or (
    p_location_id is not null and not exists (
      select 1 from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
        and location.is_active
    )
  ) then
    raise exception 'Capability assignment resources must belong to the organization'
      using errcode = '23514';
  end if;

  canonical_payload := jsonb_build_object(
    'assignmentId', target_id,
    'jobRoleId', p_job_role_id,
    'capabilityKey', p_capability_key,
    'locationId', p_location_id,
    'effectiveFrom', p_effective_from,
    'effectiveTo', p_effective_to,
    'isActive', p_is_active
  );
  claimed := private.claim_operation_request(
    p_request_id, 'capability.job_role.configure', p_organization_id,
    p_location_id, target_id, canonical_payload
  );
  if not claimed then
    return jsonb_build_object('id', target_id, 'replayed', true);
  end if;

  select * into existing
  from public.job_role_capabilities assignment
  where assignment.id = target_id
  for update;
  if existing.id is not null and existing.organization_id <> p_organization_id then
    raise exception 'Capability assignment not found' using errcode = 'P0002';
  end if;

  if existing.id is null then
    insert into public.job_role_capabilities (
      id, organization_id, job_role_id, capability_key, location_id,
      effective_from, effective_to, is_active, created_by, updated_by
    ) values (
      target_id, p_organization_id, p_job_role_id, p_capability_key, p_location_id,
      p_effective_from, p_effective_to, p_is_active, actor_id, actor_id
    );
  else
    update public.job_role_capabilities assignment
    set job_role_id = p_job_role_id,
        capability_key = p_capability_key,
        location_id = p_location_id,
        effective_from = p_effective_from,
        effective_to = p_effective_to,
        is_active = p_is_active,
        updated_by = actor_id
    where assignment.id = target_id;
  end if;

  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object('id', target_id, 'replayed', false);
end
$$;

create function public.configure_user_capability_override(
  p_request_id uuid,
  p_organization_id uuid,
  p_override_id uuid,
  p_user_id uuid,
  p_capability_key text,
  p_location_id uuid,
  p_effect text,
  p_reason text,
  p_effective_from date,
  p_effective_to date,
  p_is_active boolean
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  target_id uuid := coalesce(p_override_id, p_request_id);
  clean_effect text := lower(btrim(coalesce(p_effect, '')));
  clean_reason text := nullif(btrim(p_reason), '');
  existing public.user_capability_overrides%rowtype;
  claimed boolean;
  canonical_payload jsonb;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_organization_id is null or target_id is null
    or p_user_id is null or p_capability_key is null
    or clean_effect not in ('grant', 'deny')
    or clean_reason is null or length(clean_reason) > 500
    or p_effective_from is null or p_is_active is null
    or (p_effective_to is not null and p_effective_to < p_effective_from) then
    raise exception 'A valid user capability override is required' using errcode = '22023';
  end if;
  if not public.can_manage_org(p_organization_id) then
    raise exception 'Owner or admin access is required to configure capabilities'
      using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.organization_memberships membership
    where membership.organization_id = p_organization_id
      and membership.user_id = p_user_id
      and membership.status in ('active', 'invited')
  ) or not exists (
    select 1 from public.capability_definitions definition
    where definition.capability_key = p_capability_key and definition.is_active
  ) or (
    p_location_id is not null and not exists (
      select 1 from public.locations location
      where location.organization_id = p_organization_id
        and location.id = p_location_id
        and location.is_active
    )
  ) then
    raise exception 'Capability override resources must belong to the organization'
      using errcode = '23514';
  end if;

  canonical_payload := jsonb_build_object(
    'overrideId', target_id,
    'userId', p_user_id,
    'capabilityKey', p_capability_key,
    'locationId', p_location_id,
    'effect', clean_effect,
    'reason', clean_reason,
    'effectiveFrom', p_effective_from,
    'effectiveTo', p_effective_to,
    'isActive', p_is_active
  );
  claimed := private.claim_operation_request(
    p_request_id, 'capability.user_override.configure', p_organization_id,
    p_location_id, target_id, canonical_payload
  );
  if not claimed then
    return jsonb_build_object('id', target_id, 'replayed', true);
  end if;

  select * into existing
  from public.user_capability_overrides override
  where override.id = target_id
  for update;
  if existing.id is not null and existing.organization_id <> p_organization_id then
    raise exception 'Capability override not found' using errcode = 'P0002';
  end if;

  if existing.id is null then
    insert into public.user_capability_overrides (
      id, organization_id, user_id, capability_key, location_id,
      effect, reason, effective_from, effective_to, is_active,
      created_by, updated_by
    ) values (
      target_id, p_organization_id, p_user_id, p_capability_key, p_location_id,
      clean_effect, clean_reason, p_effective_from, p_effective_to, p_is_active,
      actor_id, actor_id
    );
  else
    update public.user_capability_overrides override
    set user_id = p_user_id,
        capability_key = p_capability_key,
        location_id = p_location_id,
        effect = clean_effect,
        reason = clean_reason,
        effective_from = p_effective_from,
        effective_to = p_effective_to,
        is_active = p_is_active,
        updated_by = actor_id
    where override.id = target_id;
  end if;

  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object('id', target_id, 'replayed', false);
end
$$;

revoke all on function public.configure_job_role_capability(
  uuid, uuid, uuid, uuid, text, uuid, date, date, boolean
) from public, anon, authenticated;
revoke all on function public.configure_user_capability_override(
  uuid, uuid, uuid, uuid, text, uuid, text, text, date, date, boolean
) from public, anon, authenticated;
grant execute on function public.configure_job_role_capability(
  uuid, uuid, uuid, uuid, text, uuid, date, date, boolean
) to authenticated;
grant execute on function public.configure_user_capability_override(
  uuid, uuid, uuid, uuid, text, uuid, text, text, date, date, boolean
) to authenticated;

-- A deliberately narrow operational catalog command. Units, conversions, and
-- category hierarchy remain Owner/Admin configuration; a capable Chef can
-- manage products, vendor packs/prices, and the par for the location that
-- grants the capability. Direct table DML remains unavailable.
create function public.configure_operational_inventory_catalog(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_command text,
  p_payload jsonb
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
#variable_conflict use_variable
declare
  actor_id uuid := auth.uid();
  clean_command text := lower(btrim(coalesce(p_command, '')));
  target_id uuid;
  claimed boolean;
  canonical_payload jsonb;
  clean_name text;
  clean_sku text;
  clean_description text;
  clean_contact text;
  clean_email text;
  clean_phone text;
  clean_terms text;
  clean_account text;
  category_id uuid;
  base_unit_id uuid;
  vendor_id uuid;
  item_id uuid;
  unit_id uuid;
  quantity_value numeric;
  reorder_value numeric;
  price_cents bigint;
  effective_at timestamptz;
  effective_date date;
  existing_par_id uuid;
  active_value boolean;
  preferred_value boolean;
  track_value boolean;
  existing_vendor public.vendors%rowtype;
  existing_item public.inventory_items%rowtype;
  existing_vendor_item public.vendor_items%rowtype;
begin
  if actor_id is null then
    raise exception 'Authentication is required' using errcode = '42501';
  end if;
  if p_request_id is null or p_organization_id is null or p_location_id is null
    or jsonb_typeof(p_payload) <> 'object'
    or clean_command not in ('vendor.save', 'item.save', 'vendor_item.save', 'par.set') then
    raise exception 'A valid operational inventory command is required' using errcode = '22023';
  end if;
  if not exists (
    select 1 from public.locations location
    where location.organization_id = p_organization_id
      and location.id = p_location_id and location.is_active
  ) then
    raise exception 'The location must be active in this organization' using errcode = '23514';
  end if;
  if clean_command = 'item.save' and not public.has_capability(
    p_organization_id, p_location_id, 'inventory.catalog.manage'
  ) then
    raise exception 'Inventory catalog capability is required' using errcode = '42501';
  elsif clean_command = 'vendor.save' and not public.has_capability(
    p_organization_id, p_location_id, 'inventory.vendor.manage'
  ) then
    raise exception 'Vendor management capability is required' using errcode = '42501';
  elsif clean_command = 'vendor_item.save' and not (
    public.has_capability(p_organization_id, p_location_id, 'inventory.vendor.manage')
    and public.has_capability(p_organization_id, p_location_id, 'inventory.price.manage')
  ) then
    raise exception 'Vendor and price management capabilities are required' using errcode = '42501';
  elsif clean_command = 'par.set' and not public.has_capability(
    p_organization_id, p_location_id, 'inventory.par.manage'
  ) then
    raise exception 'Par management capability is required' using errcode = '42501';
  end if;

  target_id := case
    when nullif(p_payload ->> 'id', '') is null then p_request_id
    else (p_payload ->> 'id')::uuid
  end;
  if clean_command = 'par.set' then
    if (p_payload ->> 'locationId')::uuid is distinct from p_location_id then
      raise exception 'Par changes are limited to the authorized location' using errcode = '42501';
    end if;
    item_id := (p_payload ->> 'inventoryItemId')::uuid;
    effective_date := (p_payload ->> 'effectiveFrom')::date;
    if item_id is null or effective_date is null then
      raise exception 'An item and effective date are required' using errcode = '22023';
    end if;
    perform pg_advisory_xact_lock(hashtextextended(
      'inventory-par:' || p_organization_id::text || ':' || p_location_id::text
        || ':' || item_id::text || ':' || effective_date::text,
      0
    ));
    select par.id into existing_par_id
    from public.inventory_par_levels par
    where par.organization_id = p_organization_id
      and par.location_id = p_location_id
      and par.inventory_item_id = item_id
      and par.effective_from = effective_date;
    target_id := coalesce(existing_par_id, p_request_id);
  end if;

  canonical_payload := jsonb_build_object(
    'command', clean_command, 'locationId', p_location_id, 'payload', p_payload
  );
  claimed := private.claim_operation_request(
    p_request_id, 'inventory.operational_catalog.' || clean_command,
    p_organization_id, p_location_id, target_id, canonical_payload
  );
  if not claimed then
    return jsonb_build_object('id', target_id, 'command', clean_command, 'replayed', true);
  end if;

  if clean_command = 'vendor.save' then
    clean_name := nullif(btrim(p_payload ->> 'name'), '');
    clean_account := nullif(btrim(p_payload ->> 'accountNumber'), '');
    clean_contact := nullif(btrim(p_payload ->> 'contactName'), '');
    clean_email := nullif(lower(btrim(p_payload ->> 'email')), '');
    clean_phone := nullif(btrim(p_payload ->> 'phone'), '');
    clean_terms := nullif(btrim(p_payload ->> 'paymentTerms'), '');
    active_value := coalesce((p_payload ->> 'isActive')::boolean, true);
    if clean_name is null or length(clean_name) > 160
      or length(coalesce(clean_account, '')) > 120
      or length(coalesce(clean_contact, '')) > 160
      or length(coalesce(clean_email, '')) > 320
      or length(coalesce(clean_phone, '')) > 80
      or length(coalesce(clean_terms, '')) > 160
      or (clean_email is not null and clean_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$') then
      raise exception 'Valid vendor details are required' using errcode = '22023';
    end if;
    select * into existing_vendor from public.vendors vendor
    where vendor.id = target_id for update;
    if existing_vendor.id is not null and existing_vendor.organization_id <> p_organization_id then
      raise exception 'Vendor not found' using errcode = 'P0002';
    end if;
    if not active_value and exists (
      select 1 from public.purchase_orders purchase_order
      where purchase_order.organization_id = p_organization_id
        and purchase_order.vendor_id = target_id
        and purchase_order.status in ('draft', 'submitted', 'partially_received')
    ) then
      raise exception 'Open purchase orders must be completed or cancelled first' using errcode = '23514';
    end if;
    if existing_vendor.id is null then
      insert into public.vendors (
        id, organization_id, name, account_number, contact_name,
        email, phone, payment_terms, is_active
      ) values (
        target_id, p_organization_id, clean_name, clean_account, clean_contact,
        clean_email, clean_phone, clean_terms, active_value
      );
    else
      update public.vendors vendor
      set name = clean_name, account_number = clean_account, contact_name = clean_contact,
          email = clean_email, phone = clean_phone, payment_terms = clean_terms,
          is_active = active_value
      where vendor.id = target_id;
      if not active_value then
        update public.vendor_items vendor_item set is_active = false
        where vendor_item.organization_id = p_organization_id
          and vendor_item.vendor_id = target_id and vendor_item.is_active;
      end if;
    end if;

  elsif clean_command = 'item.save' then
    clean_name := nullif(btrim(p_payload ->> 'name'), '');
    clean_sku := nullif(btrim(p_payload ->> 'sku'), '');
    clean_description := nullif(btrim(p_payload ->> 'description'), '');
    category_id := nullif(p_payload ->> 'categoryId', '')::uuid;
    base_unit_id := (p_payload ->> 'baseUnitId')::uuid;
    track_value := coalesce((p_payload ->> 'trackInventory')::boolean, true);
    active_value := coalesce((p_payload ->> 'isActive')::boolean, true);
    if base_unit_id is null or clean_name is null or length(clean_name) > 160
      or length(coalesce(clean_sku, '')) > 120
      or length(coalesce(clean_description, '')) > 4000 then
      raise exception 'Valid inventory item details are required' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.measurement_units unit
      where unit.id = base_unit_id and unit.organization_id = p_organization_id and unit.is_active
    ) then
      raise exception 'The canonical base unit must be active in this organization' using errcode = '23514';
    end if;
    if category_id is not null and not exists (
      select 1 from public.inventory_categories category
      where category.id = category_id and category.organization_id = p_organization_id and category.is_active
    ) then
      raise exception 'The selected category must be active in this organization' using errcode = '23514';
    end if;
    select * into existing_item from public.inventory_items item
    where item.id = target_id for update;
    if existing_item.id is not null and existing_item.organization_id <> p_organization_id then
      raise exception 'Inventory item not found' using errcode = 'P0002';
    end if;
    if existing_item.id is not null and existing_item.base_unit_id <> base_unit_id and exists (
      select 1 from public.inventory_transactions transaction
      where transaction.organization_id = p_organization_id
        and transaction.inventory_item_id = target_id
    ) then
      raise exception 'An item with ledger evidence cannot change canonical base unit' using errcode = '23514';
    end if;
    if not track_value and coalesce((
      select sum(transaction.quantity_delta) from public.inventory_transactions transaction
      where transaction.organization_id = p_organization_id
        and transaction.inventory_item_id = target_id
    ), 0) <> 0 then
      raise exception 'Tracked inventory with on-hand stock cannot be disabled' using errcode = '23514';
    end if;
    if not active_value and exists (
      select 1 from public.purchase_order_lines line
      join public.purchase_orders purchase_order on purchase_order.id = line.purchase_order_id
      where line.organization_id = p_organization_id
        and line.inventory_item_id = target_id
        and purchase_order.status in ('draft', 'submitted', 'partially_received')
      union all
      select 1 from public.recipe_ingredients ingredient
      join public.recipes recipe on recipe.id = ingredient.recipe_id
      where ingredient.organization_id = p_organization_id
        and ingredient.inventory_item_id = target_id and recipe.is_active
    ) then
      raise exception 'Open orders and active recipes must be resolved before item deactivation' using errcode = '23514';
    end if;
    if existing_item.id is null then
      insert into public.inventory_items (
        id, organization_id, category_id, base_unit_id, name,
        sku, description, track_inventory, is_active
      ) values (
        target_id, p_organization_id, category_id, base_unit_id, clean_name,
        clean_sku, clean_description, track_value, active_value
      );
    else
      update public.inventory_items item
      set category_id = category_id, base_unit_id = base_unit_id, name = clean_name,
          sku = clean_sku, description = clean_description,
          track_inventory = track_value, is_active = active_value
      where item.id = target_id;
      if not active_value then
        update public.vendor_items vendor_item set is_active = false
        where vendor_item.organization_id = p_organization_id
          and vendor_item.inventory_item_id = target_id and vendor_item.is_active;
        update public.unit_conversions conversion set is_active = false
        where conversion.organization_id = p_organization_id
          and conversion.item_id = target_id and conversion.is_active;
      end if;
    end if;

  elsif clean_command = 'vendor_item.save' then
    vendor_id := (p_payload ->> 'vendorId')::uuid;
    item_id := (p_payload ->> 'inventoryItemId')::uuid;
    unit_id := (p_payload ->> 'purchaseUnitId')::uuid;
    quantity_value := (p_payload ->> 'packQuantity')::numeric;
    clean_sku := nullif(btrim(p_payload ->> 'vendorSku'), '');
    price_cents := nullif(p_payload ->> 'lastPriceCents', '')::bigint;
    effective_at := coalesce(nullif(p_payload ->> 'priceEffectiveAt', '')::timestamptz, clock_timestamp());
    preferred_value := coalesce((p_payload ->> 'isPreferred')::boolean, false);
    active_value := coalesce((p_payload ->> 'isActive')::boolean, true);
    if vendor_id is null or item_id is null or unit_id is null
      or quantity_value is null or effective_at is null
      or quantity_value <= 0 or quantity_value >= 1000000000000
      or scale(quantity_value) > 4 or length(coalesce(clean_sku, '')) > 120
      or (price_cents is not null and (price_cents < 0 or price_cents > 9000000000000000))
      or effective_at > clock_timestamp() + interval '366 days' then
      raise exception 'Valid vendor purchase details are required' using errcode = '22023';
    end if;
    select * into existing_vendor from public.vendors vendor
    where vendor.id = vendor_id and vendor.organization_id = p_organization_id and vendor.is_active;
    select * into existing_item from public.inventory_items item
    where item.id = item_id and item.organization_id = p_organization_id and item.is_active;
    if existing_vendor.id is null or existing_item.id is null or not exists (
      select 1 from public.measurement_units unit
      where unit.id = unit_id and unit.organization_id = p_organization_id and unit.is_active
    ) then
      raise exception 'Vendor, item, and purchase unit must be active tenant records' using errcode = '23514';
    end if;
    perform private.inventory_conversion_multiplier(
      p_organization_id, item_id, unit_id, existing_item.base_unit_id
    );
    select * into existing_vendor_item from public.vendor_items vendor_item
    where vendor_item.id = target_id for update;
    if existing_vendor_item.id is not null and existing_vendor_item.organization_id <> p_organization_id then
      raise exception 'Vendor purchase item not found' using errcode = 'P0002';
    end if;
    if preferred_value then
      update public.vendor_items vendor_item set is_preferred = false
      where vendor_item.organization_id = p_organization_id
        and vendor_item.inventory_item_id = item_id
        and vendor_item.id <> target_id and vendor_item.is_preferred;
    end if;
    if existing_vendor_item.id is null then
      insert into public.vendor_items (
        id, organization_id, vendor_id, inventory_item_id, purchase_unit_id,
        vendor_sku, pack_quantity, last_price_cents, is_preferred, is_active
      ) values (
        target_id, p_organization_id, vendor_id, item_id, unit_id,
        clean_sku, quantity_value, price_cents, preferred_value, active_value
      );
    else
      update public.vendor_items vendor_item
      set vendor_id = vendor_id, inventory_item_id = item_id, purchase_unit_id = unit_id,
          vendor_sku = clean_sku, pack_quantity = quantity_value,
          last_price_cents = price_cents, is_preferred = preferred_value,
          is_active = active_value
      where vendor_item.id = target_id;
    end if;
    if price_cents is not null and active_value then
      insert into public.item_price_history (
        organization_id, inventory_item_id, vendor_id, unit_id,
        unit_price_cents, effective_at, source_type, source_id
      ) values (
        p_organization_id, item_id, vendor_id, unit_id,
        price_cents, effective_at, 'operational_catalog', target_id
      );
    end if;

  else
    quantity_value := (p_payload ->> 'parQuantity')::numeric;
    reorder_value := nullif(p_payload ->> 'reorderQuantity', '')::numeric;
    if quantity_value is null or effective_date < date '1900-01-01'
      or effective_date > current_date + 3650
      or quantity_value < 0 or quantity_value >= 1000000000000
      or scale(quantity_value) > 4 or (reorder_value is not null and (
        reorder_value < 0 or reorder_value > quantity_value or scale(reorder_value) > 4
      )) then
      raise exception 'Par and reorder quantities are invalid' using errcode = '22023';
    end if;
    if not exists (
      select 1 from public.inventory_items item
      where item.id = item_id and item.organization_id = p_organization_id and item.is_active
    ) then
      raise exception 'Par levels require an active tenant location and item' using errcode = '23514';
    end if;
    if existing_par_id is null then
      insert into public.inventory_par_levels (
        id, organization_id, location_id, inventory_item_id,
        par_quantity, reorder_quantity, effective_from
      ) values (
        target_id, p_organization_id, p_location_id, item_id,
        quantity_value, reorder_value, effective_date
      );
    else
      update public.inventory_par_levels par
      set par_quantity = quantity_value, reorder_quantity = reorder_value
      where par.id = existing_par_id;
    end if;
  end if;

  perform private.complete_operation_request(p_request_id);
  return jsonb_build_object('id', target_id, 'command', clean_command, 'replayed', false);
end
$$;

revoke all on function public.configure_operational_inventory_catalog(
  uuid, uuid, uuid, text, jsonb
) from public, anon, authenticated;
grant execute on function public.configure_operational_inventory_catalog(
  uuid, uuid, uuid, text, jsonb
) to authenticated;

-- Add capability-aware read policies without removing the existing role policies.
do $capability_inventory_org_read$
declare t text;
begin
  foreach t in array array[
    'measurement_units', 'unit_conversions', 'inventory_categories', 'inventory_items'
  ] loop
    execute format(
      'create policy capability_catalog_read on public.%I for select to authenticated using (public.has_any_location_capability(organization_id, array[''inventory.catalog.manage'', ''inventory.par.manage'', ''inventory.count.create'', ''inventory.waste.create'', ''inventory.transfer.create'', ''inventory.purchase.create'', ''inventory.receive'', ''recipe.manage'', ''prep.manage'', ''prep.complete'']))',
      t
    );
  end loop;

  foreach t in array array['vendors', 'vendor_items', 'item_price_history'] loop
    execute format(
      'create policy capability_vendor_read on public.%I for select to authenticated using (public.has_any_location_capability(organization_id, array[''inventory.vendor.manage'', ''inventory.price.manage'', ''inventory.purchase.create'', ''inventory.purchase.approve'', ''inventory.receive'']))',
      t
    );
  end loop;

  foreach t in array array['recipes', 'recipe_ingredients', 'inventory_recipe_versions'] loop
    execute format(
      'create policy capability_recipe_read on public.%I for select to authenticated using (public.has_any_location_capability(organization_id, array[''recipe.manage'', ''prep.manage'', ''prep.complete'', ''menu.manage'']))',
      t
    );
  end loop;
end
$capability_inventory_org_read$;

create policy capability_par_read
on public.inventory_par_levels for select to authenticated
using (public.has_any_capability(
  organization_id, location_id,
  array['inventory.par.manage', 'inventory.count.create', 'inventory.purchase.create', 'prep.manage']
));

create policy capability_count_read
on public.inventory_counts for select to authenticated
using (public.has_any_capability(
  organization_id, location_id,
  array['inventory.count.create', 'inventory.count.approve']
));

create policy capability_transaction_read
on public.inventory_transactions for select to authenticated
using (public.has_any_capability(
  organization_id, location_id,
  array['inventory.count.create', 'inventory.count.approve', 'inventory.waste.create',
    'inventory.waste.approve', 'inventory.transfer.create', 'inventory.transfer.approve',
    'inventory.purchase.create', 'inventory.purchase.approve', 'inventory.receive',
    'reports.operational.view', 'reports.financial.view']
));

create policy capability_waste_read
on public.waste_records for select to authenticated
using (public.has_any_capability(
  organization_id, location_id,
  array['inventory.waste.create', 'inventory.waste.approve', 'reports.operational.view']
));

create policy capability_purchase_order_read
on public.purchase_orders for select to authenticated
using (public.has_any_capability(
  organization_id, location_id,
  array['inventory.purchase.create', 'inventory.purchase.approve', 'inventory.receive']
));

create policy capability_delivery_read
on public.deliveries for select to authenticated
using (public.has_any_capability(
  organization_id, location_id,
  array['inventory.receive', 'inventory.purchase.create', 'inventory.purchase.approve']
));

create policy capability_transfer_read
on public.inventory_transfers for select to authenticated
using (
  public.has_any_capability(
    organization_id, from_location_id,
    array['inventory.transfer.create', 'inventory.transfer.approve']
  )
  or public.has_any_capability(
    organization_id, to_location_id,
    array['inventory.transfer.create', 'inventory.transfer.approve']
  )
);

create policy capability_po_line_read
on public.purchase_order_lines for select to authenticated
using (exists (
  select 1 from public.purchase_orders purchase_order
  where purchase_order.id = purchase_order_id
    and public.has_any_capability(
      purchase_order.organization_id, purchase_order.location_id,
      array['inventory.purchase.create', 'inventory.purchase.approve', 'inventory.receive']
    )
));

create policy capability_delivery_line_read
on public.delivery_lines for select to authenticated
using (exists (
  select 1 from public.deliveries delivery
  where delivery.id = delivery_id
    and public.has_any_capability(
      delivery.organization_id, delivery.location_id,
      array['inventory.receive', 'inventory.purchase.create', 'inventory.purchase.approve']
    )
));

create policy capability_count_line_read
on public.inventory_count_lines for select to authenticated
using (exists (
  select 1 from public.inventory_counts inventory_count
  where inventory_count.id = inventory_count_id
    and public.has_any_capability(
      inventory_count.organization_id, inventory_count.location_id,
      array['inventory.count.create', 'inventory.count.approve']
    )
));

create policy capability_transfer_line_read
on public.inventory_transfer_lines for select to authenticated
using (exists (
  select 1 from public.inventory_transfers transfer
  where transfer.id = transfer_id
    and (
      public.has_any_capability(
        transfer.organization_id, transfer.from_location_id,
        array['inventory.transfer.create', 'inventory.transfer.approve']
      )
      or public.has_any_capability(
        transfer.organization_id, transfer.to_location_id,
        array['inventory.transfer.create', 'inventory.transfer.approve']
      )
    )
));

comment on function public.has_capability(uuid, uuid, text, date) is
  'Actor-derived effective operational capability at one active, accessible location. Owners and admins retain full capability coverage; user denials override grants for other roles.';
comment on function public.effective_capabilities(uuid, uuid, date) is
  'Returns only the signed-in actor effective capabilities for one active, accessible location.';
comment on function public.configure_job_role_capability(uuid, uuid, uuid, uuid, text, uuid, date, date, boolean) is
  'Idempotent Owner/Admin command for effective-dated, non-destructive job-role capability assignments.';
comment on function public.configure_user_capability_override(uuid, uuid, uuid, uuid, text, uuid, text, text, date, date, boolean) is
  'Idempotent Owner/Admin command for effective-dated user grants or denials; the target cannot self-assign.';
comment on function public.configure_operational_inventory_catalog(uuid, uuid, uuid, text, jsonb) is
  'Actor-derived, idempotent operational command for capability-scoped items, vendors, vendor packs/prices, and location pars. Direct DML remains unavailable.';
