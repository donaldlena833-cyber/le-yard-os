-- Persist safe operational defaults for recognizable restaurant job roles.
-- Owners and Admins still administer grants; this bootstrap prevents a newly
-- provisioned Chef from receiving a kitchen persona with no kitchen access.

create function private.default_job_role_capabilities(
  p_code text,
  p_name text,
  p_department text
)
returns table (capability_key text)
language sql immutable
set search_path = ''
as $$
  with normalized as (
    select
      upper(btrim(coalesce(p_code, ''))) as code,
      lower(btrim(coalesce(p_name, ''))) as name,
      lower(btrim(coalesce(p_department, ''))) as department
  ), template as (
    select case
      when code in ('SOUS', 'SOUS_CHEF') or name ~ '(^| )sous chef($| )' then array[
        'inventory.count.create',
        'inventory.waste.create',
        'inventory.purchase.create',
        'inventory.receive',
        'recipe.manage',
        'prep.manage',
        'prep.complete',
        'service.availability.manage',
        'reports.operational.view'
      ]::text[]
      when code in ('CHEF', 'EXEC_CHEF', 'EXECUTIVE_CHEF')
        or name ~ '(^| )(executive )?chef($| )' then array[
        'inventory.item.manage',
        'inventory.category.manage',
        'inventory.unit.manage',
        'inventory.par.manage',
        'inventory.count.create',
        'inventory.count.approve',
        'inventory.waste.create',
        'inventory.waste.approve',
        'inventory.transfer.create',
        'inventory.purchase.create',
        'inventory.purchase.approve',
        'inventory.receive',
        'inventory.vendor.manage',
        'inventory.price.manage',
        'recipe.manage',
        'prep.manage',
        'prep.complete',
        'menu.manage',
        'schedule.manage',
        'schedule.publish',
        'service.availability.manage',
        'reports.operational.view'
      ]::text[]
      when code in ('BAR_MANAGER', 'BARMGR') or name ~ '(^| )bar manager($| )' then array[
        'inventory.item.manage',
        'inventory.category.manage',
        'inventory.unit.manage',
        'inventory.par.manage',
        'inventory.count.create',
        'inventory.waste.create',
        'inventory.purchase.create',
        'inventory.receive',
        'inventory.vendor.manage',
        'inventory.price.manage',
        'recipe.manage',
        'service.availability.manage',
        'reports.operational.view'
      ]::text[]
      when code in ('FOH_MANAGER', 'FOHMGR')
        or name ~ '(^| )(foh|front of house) manager($| )'
        or (name ~ '(^| )manager($| )' and department like '%front%house%') then array[
        'schedule.manage',
        'schedule.publish',
        'time.review',
        'preshift.manage',
        'availability.manage',
        'service.availability.manage',
        'manager_log.manage',
        'guest.manage',
        'guest.sensitive_notes.view',
        'guest_recovery.manage',
        'closeout.create',
        'maintenance.manage',
        'reports.operational.view'
      ]::text[]
      else '{}'::text[]
    end as capabilities
    from normalized
  )
  select unnest(capabilities) as capability_key
  from template
$$;

revoke all on function private.default_job_role_capabilities(text, text, text)
from public, anon, authenticated;

create function private.apply_default_job_role_capabilities()
returns trigger
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
begin
  if not new.is_active then return new; end if;

  if actor_id is null or not exists (
    select 1
    from public.organization_memberships membership
    where membership.organization_id = new.organization_id
      and membership.user_id = actor_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
  ) then
    select membership.user_id into actor_id
    from public.organization_memberships membership
    where membership.organization_id = new.organization_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
    order by case membership.role when 'owner' then 0 else 1 end,
      membership.joined_at nulls last,
      membership.user_id
    limit 1;
  end if;

  if actor_id is null then return new; end if;

  insert into public.job_role_capabilities (
    organization_id,
    job_role_id,
    capability_key,
    location_id,
    effective_from,
    effective_to,
    is_active,
    created_by,
    updated_by
  )
  select
    new.organization_id,
    new.id,
    template.capability_key,
    null,
    current_date,
    null,
    true,
    actor_id,
    actor_id
  from private.default_job_role_capabilities(
    new.code,
    new.name,
    new.department
  ) template
  join public.capability_definitions definition
    on definition.capability_key = template.capability_key
   and definition.is_active
  on conflict do nothing;

  return new;
end
$$;

revoke all on function private.apply_default_job_role_capabilities()
from public, anon, authenticated;

create trigger job_role_apply_default_capabilities
after insert on public.job_roles
for each row execute function private.apply_default_job_role_capabilities();

-- Backfill existing recognizable roles. This changes authorization metadata
-- only; it does not create operational restaurant records.
do $seed_existing_role_capabilities$
declare
  role_row public.job_roles%rowtype;
  actor_id uuid;
begin
  for role_row in
    select role.*
    from public.job_roles role
    where role.is_active
  loop
    select membership.user_id into actor_id
    from public.organization_memberships membership
    where membership.organization_id = role_row.organization_id
      and membership.status = 'active'
      and membership.role in ('owner', 'admin')
    order by case membership.role when 'owner' then 0 else 1 end,
      membership.joined_at nulls last,
      membership.user_id
    limit 1;

    if actor_id is not null then
      insert into public.job_role_capabilities (
        organization_id,
        job_role_id,
        capability_key,
        location_id,
        effective_from,
        effective_to,
        is_active,
        created_by,
        updated_by
      )
      select
        role_row.organization_id,
        role_row.id,
        template.capability_key,
        null,
        current_date,
        null,
        true,
        actor_id,
        actor_id
      from private.default_job_role_capabilities(
        role_row.code,
        role_row.name,
        role_row.department
      ) template
      join public.capability_definitions definition
        on definition.capability_key = template.capability_key
       and definition.is_active
      on conflict do nothing;
    end if;
  end loop;
end
$seed_existing_role_capabilities$;

comment on function private.default_job_role_capabilities(text, text, text) is
  'Internal capability templates for recognized restaurant job-role definitions.';
comment on function private.apply_default_job_role_capabilities() is
  'Trigger-only bootstrap for safe default operational grants on newly created recognized job roles.';
