-- Le Yard OS: authoritative location release control, pilot inventory limits,
-- and database-enforced management MFA.

create table public.location_release_controls (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  state text not null default 'prelaunch'
    check (state in ('prelaunch', 'pilot', 'open', 'paused')),
  accept_reservations_from date not null default date '2026-12-01'
    check (accept_reservations_from >= date '2026-12-01'),
  public_inventory_percent smallint not null default 0
    check (
      (state = 'pilot' and public_inventory_percent = 25)
      or (state = 'open' and public_inventory_percent between 1 and 100)
      or (state in ('prelaunch', 'paused') and public_inventory_percent = 0)
    ),
  booking_approved boolean not null default false,
  support_ready boolean not null default false,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  release_id uuid not null default gen_random_uuid(),
  version bigint not null default 1 check (version > 0),
  created_at timestamptz not null default clock_timestamp(),
  updated_at timestamptz not null default clock_timestamp(),
  constraint location_release_controls_location_fkey
    foreign key (organization_id, location_id)
    references public.locations(organization_id, id) on delete cascade,
  constraint location_release_controls_location_key
    unique (organization_id, location_id),
  constraint location_release_controls_release_key unique (release_id),
  constraint location_release_controls_approval_check check (
    (
      booking_approved
      and state in ('pilot', 'open')
      and approved_by is not null
      and approved_at is not null
    )
    or (
      not booking_approved
      and approved_by is null
      and approved_at is null
    )
  )
);

comment on table public.location_release_controls is
'Versioned location release authority. Environment configuration may pause new inventory but cannot authorize it.';
comment on column public.location_release_controls.accept_reservations_from is
'Earliest location-local business date that new public inventory may expose.';
comment on column public.location_release_controls.public_inventory_percent is
'Share of the effective pacing cover limit available to new public bookings. Pilot is fixed at 25 percent.';
comment on column public.location_release_controls.release_id is
'Immutable identifier for the current release decision. A successful update rotates this identifier.';

revoke all on table public.location_release_controls
from public, anon, authenticated, service_role;
grant select on table public.location_release_controls to authenticated;

alter table public.location_release_controls enable row level security;
alter table public.location_release_controls force row level security;

create policy location_release_controls_management_read
on public.location_release_controls
as permissive for select to authenticated
using (public.can_manage_org(organization_id));

-- Migration is deliberately fail-closed. Applying it makes the intended
-- December pilot visible to management, but does not authorize booking until
-- support and booking approval are explicitly confirmed at AAL2.
insert into public.location_release_controls (
  organization_id,
  location_id,
  state,
  accept_reservations_from,
  public_inventory_percent,
  booking_approved,
  support_ready
)
select
  location.organization_id,
  location.id,
  'pilot',
  date '2026-12-01',
  25,
  false,
  false
from public.locations location
where location.is_active
on conflict (organization_id, location_id) do nothing;

create or replace function public.can_manage_org(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') = 'aal2'
    and exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = p_organization_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and membership.role in ('owner', 'admin')
    )
$$;

comment on function public.can_manage_org(uuid) is
'Owner and Admin organization management authorization. A real AAL2 JWT and active tenant membership are mandatory.';

create or replace function public.is_owner_pending_mfa(p_organization_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
    and exists (
      select 1
      from public.organization_memberships membership
      where membership.organization_id = p_organization_id
        and membership.user_id = auth.uid()
        and membership.status = 'active'
        and membership.role in ('owner', 'admin')
    )
$$;

comment on function public.is_owner_pending_mfa(uuid) is
'Compatibility helper used by restrictive tenant-read policies. Active Owners and Admins remain pending until the JWT is AAL2.';

-- Apply the restrictive management read barrier to tenant tables added after
-- the original MFA migration as well as the new release-control table.
do $management_aal2_read_barriers$
declare
  tenant_table text;
begin
  for tenant_table in
    select column_info.table_name
    from information_schema.columns column_info
    join information_schema.tables table_info
      on table_info.table_schema = column_info.table_schema
     and table_info.table_name = column_info.table_name
    where column_info.table_schema = 'public'
      and column_info.column_name = 'organization_id'
      and table_info.table_type = 'BASE TABLE'
      and column_info.table_name not in (
        'organization_memberships',
        'location_memberships',
        'locations'
      )
      and not exists (
        select 1
        from pg_policies policy
        where policy.schemaname = 'public'
          and policy.tablename = column_info.table_name
          and policy.policyname = 'owner_mfa_sensitive_read_barrier'
      )
  loop
    execute format(
      'create policy owner_mfa_sensitive_read_barrier on public.%I as restrictive for select to authenticated using (not public.is_owner_pending_mfa(organization_id))',
      tenant_table
    );
  end loop;
end
$management_aal2_read_barriers$;

-- Neutralize the password-only compatibility wrapper. It may delegate to the
-- mature implementation, but it may not change or forge request claims.
create or replace function public.provision_user_invitation(
  p_auth_user_id uuid,
  p_organization_id uuid,
  p_email text,
  p_display_name text,
  p_role public.app_role,
  p_location_ids uuid[],
  p_token_hash text,
  p_expires_at timestamptz,
  p_employee_id uuid
)
returns uuid
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if auth.uid() is null
    or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'Owner and Admin invitations require MFA'
      using errcode = '42501';
  end if;
  return public.provision_user_invitation_aal2_legacy(
    p_auth_user_id,
    p_organization_id,
    p_email,
    p_display_name,
    p_role,
    p_location_ids,
    p_token_hash,
    p_expires_at,
    p_employee_id
  );
end
$$;

revoke all on function public.provision_user_invitation(
  uuid, uuid, text, text, public.app_role, uuid[], text, timestamptz, uuid
) from public, anon, authenticated, service_role;
grant execute on function public.provision_user_invitation(
  uuid, uuid, text, text, public.app_role, uuid[], text, timestamptz, uuid
) to authenticated;

comment on function public.provision_user_invitation(
  uuid, uuid, text, text, public.app_role, uuid[], text, timestamptz, uuid
) is
'AAL2-only Owner/Admin invitation entrypoint. Delegates without changing JWT assurance claims.';

-- The checklist-photo entrypoint is service-only, so the server supplies the
-- already-verified actor assurance. Management actors must be AAL2; no value
-- is upgraded inside the database.
create or replace function public.bind_verified_checklist_photo_response(
  p_request_id uuid,
  p_actor_id uuid,
  p_actor_aal text,
  p_run_id uuid,
  p_template_item_id uuid,
  p_response jsonb,
  p_storage_path text,
  p_notes text,
  p_mime_type text,
  p_size_bytes bigint
)
returns public.checklist_responses
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_role public.app_role;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Verified checklist photo binding is service-only'
      using errcode = '42501';
  end if;
  if p_actor_aal not in ('aal1', 'aal2') then
    raise exception 'Actor assurance is invalid' using errcode = '22023';
  end if;
  select membership.role
  into actor_role
  from public.checklist_runs run
  join public.organization_memberships membership
    on membership.organization_id = run.organization_id
   and membership.user_id = p_actor_id
   and membership.status = 'active'
  where run.id = p_run_id;
  if actor_role in ('owner', 'admin') and p_actor_aal <> 'aal2' then
    raise exception 'Owner and Admin checklist evidence requires MFA'
      using errcode = '42501';
  end if;
  return public.bind_verified_checklist_photo_response_aal2_legacy(
    p_request_id,
    p_actor_id,
    p_actor_aal,
    p_run_id,
    p_template_item_id,
    p_response,
    p_storage_path,
    p_notes,
    p_mime_type,
    p_size_bytes
  );
end
$$;

revoke all on function public.bind_verified_checklist_photo_response(
  uuid, uuid, text, uuid, uuid, jsonb, text, text, text, bigint
) from public, anon, authenticated, service_role;
grant execute on function public.bind_verified_checklist_photo_response(
  uuid, uuid, text, uuid, uuid, jsonb, text, text, text, bigint
) to service_role;

comment on function public.bind_verified_checklist_photo_response(
  uuid, uuid, text, uuid, uuid, jsonb, text, text, text, bigint
) is
'Service-only verified checklist photo binding. Management assurance is passed through unchanged and must already be AAL2.';

-- Opening Room optimistic persistence ---------------------------------------

do $startup_workspace_duplicate_preflight$
begin
  if exists (
    select 1
    from public.startup_workspaces workspace
    group by workspace.organization_id
    having count(*) > 1
  ) then
    raise exception 'Duplicate Opening Room workspaces require explicit resolution before this migration can continue'
      using errcode = '23505';
  end if;
end
$startup_workspace_duplicate_preflight$;

alter table public.startup_workspaces
  add column revision bigint not null default 1 check (revision > 0);

create unique index startup_workspaces_one_per_organization_idx
on public.startup_workspaces (organization_id);

create table public.startup_workspace_revisions (
  workspace_id text not null references public.startup_workspaces(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  revision bigint not null check (revision > 0),
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  actor_id uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default clock_timestamp(),
  primary key (workspace_id, revision)
);

comment on table public.startup_workspace_revisions is
'Append-only Opening Room snapshots. Null actor identifies migration baselines; every RPC save records auth.uid().';

revoke all on table public.startup_workspace_revisions
from public, anon, authenticated, service_role;
grant select on table public.startup_workspace_revisions to authenticated;
alter table public.startup_workspace_revisions enable row level security;
alter table public.startup_workspace_revisions force row level security;

create policy startup_workspace_revisions_aal2_management_read
on public.startup_workspace_revisions
for select to authenticated
using (public.can_manage_org(organization_id));

-- Preserve the exact pre-contract document before the audited SQL migration
-- below writes the validated v2 document as revision 2.
insert into public.startup_workspace_revisions (
  workspace_id,
  organization_id,
  revision,
  data,
  actor_id,
  created_at
)
select
  workspace.id,
  workspace.organization_id,
  1,
  workspace.data,
  null,
  workspace.updated_at
from public.startup_workspaces workspace;

revoke update on table public.startup_workspaces from authenticated;
drop policy if exists startup_workspaces_owner_admin_update
on public.startup_workspaces;

drop policy if exists startup_workspaces_owner_admin_insert
on public.startup_workspaces;
create policy startup_workspaces_aal2_management_insert
on public.startup_workspaces
for insert to authenticated
with check (public.can_manage_org(organization_id));

create function private.startup_iso_date_is_valid(p_value text)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  parsed date;
begin
  if p_value is null or p_value = '' then return true; end if;
  if p_value !~ '^\d{4}-\d{2}-\d{2}$' then return false; end if;
  parsed := p_value::date;
  return to_char(parsed, 'YYYY-MM-DD') = p_value;
exception when others then
  return false;
end
$$;

create function private.startup_json_object_matches(
  p_value jsonb,
  p_required text[],
  p_allowed text[]
)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_value) is distinct from 'object' then false
    else not exists (
        select 1 from unnest(p_required) required(key)
        where not p_value ? required.key
      )
      and not exists (
        select 1 from jsonb_object_keys(p_value) actual(key)
        where not actual.key = any(p_allowed)
      )
  end
$$;

create function private.startup_json_text_is_valid(
  p_value jsonb,
  p_max_length integer,
  p_require_nonblank boolean default false
)
returns boolean
language sql immutable
set search_path = ''
as $$
  select jsonb_typeof(p_value) = 'string'
    and length(p_value #>> '{}') <= p_max_length
    and (not p_require_nonblank or length(btrim(p_value #>> '{}')) > 0)
$$;

create function private.startup_json_money_is_valid(p_value jsonb)
returns boolean
language sql immutable
set search_path = ''
as $$
  select case
    when jsonb_typeof(p_value) is distinct from 'number' then false
    else (p_value #>> '{}')::numeric between 0 and 1000000000
  end
$$;

create function private.startup_timestamp_is_valid(p_value text)
returns boolean
language plpgsql immutable
set search_path = ''
as $$
declare
  parsed timestamptz;
begin
  if p_value is null
    or p_value !~ '(Z|[+-][0-9]{2}:[0-9]{2})$' then
    return false;
  end if;
  parsed := p_value::timestamptz;
  return parsed is not null;
exception when others then
  return false;
end
$$;

create function private.startup_workspace_migrate_v1(p_data jsonb)
returns jsonb
language plpgsql immutable
set search_path = ''
as $$
declare
  migrated jsonb := p_data;
  migrated_items jsonb;
begin
  if jsonb_typeof(p_data) <> 'object' or p_data ->> 'version' <> '1' then
    raise exception 'Only an Opening Room v1 document can be migrated'
      using errcode = '22023';
  end if;
  migrated := jsonb_set(migrated, '{version}', '2'::jsonb, false);
  migrated := jsonb_set(
    migrated,
    '{targetOpeningDate}',
    '"2026-12-01"'::jsonb,
    false
  );
  select jsonb_agg(
    case when milestone.value ->> 'id' = 'opening'
      then jsonb_set(
        milestone.value,
        '{date}',
        '"2026-12-01"'::jsonb,
        false
      )
      else milestone.value
    end
    order by milestone.ordinality
  )
  into migrated_items
  from jsonb_array_elements(p_data -> 'milestones')
    with ordinality milestone(value, ordinality);
  migrated := jsonb_set(migrated, '{milestones}', migrated_items, false);

  select jsonb_agg(
    case when event.value ->> 'kind' = 'opening'
      then jsonb_set(
        event.value,
        '{date}',
        '"2026-12-01"'::jsonb,
        false
      )
      else event.value
    end
    order by event.ordinality
  )
  into migrated_items
  from jsonb_array_elements(p_data -> 'events')
    with ordinality event(value, ordinality);
  migrated := jsonb_set(migrated, '{events}', migrated_items, false);

  select jsonb_agg(
    case when fact.value ->> 'id' = 'opening-date'
      then jsonb_set(
        fact.value,
        '{value}',
        '"December 1, 2026"'::jsonb,
        false
      )
      else fact.value
    end
    order by fact.ordinality
  )
  into migrated_items
  from jsonb_array_elements(p_data -> 'facts')
    with ordinality fact(value, ordinality);
  migrated := jsonb_set(migrated, '{facts}', migrated_items, false);

  select jsonb_agg(
    case when case
      when jsonb_typeof(item.value -> 'subcategories') = 'array' then case
        when jsonb_array_length(item.value -> 'subcategories') = 1
          and lower(btrim(item.value #>> '{subcategories,0,name}')) = 'unallocated'
          and jsonb_typeof(item.value -> 'planned') = 'number'
          and jsonb_typeof(item.value -> 'committed') = 'number'
          and jsonb_typeof(item.value -> 'paid') = 'number'
          and jsonb_typeof(item.value #> '{subcategories,0,planned}') = 'number'
          and jsonb_typeof(item.value #> '{subcategories,0,committed}') = 'number'
          and jsonb_typeof(item.value #> '{subcategories,0,paid}') = 'number'
        then (item.value ->> 'committed')::numeric = 0
          and (item.value ->> 'paid')::numeric = 0
          and (item.value #>> '{subcategories,0,committed}')::numeric = 0
          and (item.value #>> '{subcategories,0,paid}')::numeric = 0
          and (item.value ->> 'planned')::numeric
            <> (item.value #>> '{subcategories,0,planned}')::numeric
        else false
      end
      else false
    end
      then jsonb_set(
        item.value,
        '{subcategories,0,planned}',
        item.value -> 'planned',
        false
      )
      else item.value
    end
    order by item.ordinality
  )
  into migrated_items
  from jsonb_array_elements(p_data -> 'budgetItems')
    with ordinality item(value, ordinality);
  migrated := jsonb_set(migrated, '{budgetItems}', migrated_items, false);
  return migrated;
end
$$;

create function private.startup_workspace_shape_violations(p_data jsonb)
returns text[]
language plpgsql stable
set search_path = ''
as $$
declare
  violations text[] := '{}'::text[];
  entry jsonb;
  line jsonb;
  financials jsonb;
  low_estimate numeric;
  high_estimate numeric;
  planned numeric;
  committed numeric;
  paid numeric;
begin
  if not private.startup_json_object_matches(
    p_data,
    array[
      'version', 'organizationId', 'businessName', 'targetOpeningDate',
      'updatedAt', 'tasks', 'milestones', 'events', 'budgetItems',
      'financials', 'facts'
    ],
    array[
      'version', 'organizationId', 'businessName', 'targetOpeningDate',
      'updatedAt', 'tasks', 'milestones', 'events', 'budgetItems',
      'financials', 'facts'
    ]
  ) then
    return array['workspace_shape'];
  end if;
  if p_data -> 'version' <> '2'::jsonb
    or not private.startup_json_text_is_valid(p_data -> 'organizationId', 200)
    or not private.startup_json_text_is_valid(p_data -> 'businessName', 20000)
    or not private.startup_json_text_is_valid(p_data -> 'targetOpeningDate', 20000)
    or not private.startup_json_text_is_valid(p_data -> 'updatedAt', 20000)
    or not private.startup_timestamp_is_valid(p_data ->> 'updatedAt') then
    violations := array_append(violations, 'workspace_scalar_shape');
  end if;

  if jsonb_typeof(p_data -> 'tasks') <> 'array'
    or jsonb_array_length(p_data -> 'tasks') > 10000 then
    violations := array_append(violations, 'tasks_shape');
  else
    for entry in select value from jsonb_array_elements(p_data -> 'tasks') loop
      if not private.startup_json_object_matches(
        entry,
        array['id','title','area','owner','status','priority','dueDate','dependsOn','notes','updatedAt'],
        array['id','title','area','owner','status','priority','dueDate','dependsOn','milestoneId','notes','updatedAt']
      )
        or not private.startup_json_text_is_valid(entry -> 'id', 200, true)
        or not private.startup_json_text_is_valid(entry -> 'title', 20000)
        or not private.startup_json_text_is_valid(entry -> 'area', 20000)
        or not private.startup_json_text_is_valid(entry -> 'owner', 20000)
        or not private.startup_json_text_is_valid(entry -> 'status', 20000)
        or entry ->> 'status' not in ('todo','doing','blocked','done')
        or not private.startup_json_text_is_valid(entry -> 'priority', 20000)
        or entry ->> 'priority' not in ('now','next','later')
        or not private.startup_json_text_is_valid(entry -> 'dueDate', 20000)
        or not private.startup_iso_date_is_valid(entry ->> 'dueDate')
        or jsonb_typeof(entry -> 'dependsOn') <> 'array'
        or (case when jsonb_typeof(entry -> 'dependsOn') = 'array'
          then jsonb_array_length(entry -> 'dependsOn') > 1000 else false end)
        or exists (
          select 1
          from jsonb_array_elements(
            case when jsonb_typeof(entry -> 'dependsOn') = 'array'
              then entry -> 'dependsOn' else '[]'::jsonb end
          ) dependency
          where not private.startup_json_text_is_valid(dependency, 200, true)
        )
        or (entry ? 'milestoneId'
          and not private.startup_json_text_is_valid(entry -> 'milestoneId', 200, true))
        or not private.startup_json_text_is_valid(entry -> 'notes', 20000)
        or not private.startup_json_text_is_valid(entry -> 'updatedAt', 20000)
        or not private.startup_timestamp_is_valid(entry ->> 'updatedAt') then
        violations := array_append(violations, 'task_shape');
      end if;
    end loop;
  end if;

  if jsonb_typeof(p_data -> 'milestones') <> 'array'
    or jsonb_array_length(p_data -> 'milestones') > 1000 then
    violations := array_append(violations, 'milestones_shape');
  else
    for entry in select value from jsonb_array_elements(p_data -> 'milestones') loop
      if not private.startup_json_object_matches(
        entry,
        array['id','title','date','note'],
        array['id','title','date','note']
      )
        or not private.startup_json_text_is_valid(entry -> 'id', 200, true)
        or not private.startup_json_text_is_valid(entry -> 'title', 20000)
        or not private.startup_json_text_is_valid(entry -> 'date', 20000)
        or not private.startup_iso_date_is_valid(entry ->> 'date')
        or not private.startup_json_text_is_valid(entry -> 'note', 20000) then
        violations := array_append(violations, 'milestone_shape');
      end if;
    end loop;
  end if;

  if jsonb_typeof(p_data -> 'events') <> 'array'
    or jsonb_array_length(p_data -> 'events') > 10000 then
    violations := array_append(violations, 'events_shape');
  else
    for entry in select value from jsonb_array_elements(p_data -> 'events') loop
      if not private.startup_json_object_matches(
        entry,
        array['id','title','date','kind','note'],
        array['id','title','date','kind','note']
      )
        or not private.startup_json_text_is_valid(entry -> 'id', 200, true)
        or not private.startup_json_text_is_valid(entry -> 'title', 20000)
        or not private.startup_json_text_is_valid(entry -> 'date', 20000)
        or not private.startup_iso_date_is_valid(entry ->> 'date')
        or not private.startup_json_text_is_valid(entry -> 'kind', 20000)
        or entry ->> 'kind' not in ('deadline','meeting','inspection','opening')
        or not private.startup_json_text_is_valid(entry -> 'note', 20000) then
        violations := array_append(violations, 'event_shape');
      end if;
    end loop;
  end if;

  if jsonb_typeof(p_data -> 'budgetItems') <> 'array'
    or jsonb_array_length(p_data -> 'budgetItems') > 10000 then
    violations := array_append(violations, 'budget_items_shape');
  else
    for entry in select value from jsonb_array_elements(p_data -> 'budgetItems') loop
      if not private.startup_json_object_matches(
        entry,
        array['id','category','name','planned','committed','paid','essential'],
        array['id','category','name','vendor','expenseDate','status','notes','planned','committed','paid','essential','flexibility','minimumAmount','budgetRole','subcategories']
      )
        or not private.startup_json_text_is_valid(entry -> 'id', 200, true)
        or not private.startup_json_text_is_valid(entry -> 'category', 20000)
        or not private.startup_json_text_is_valid(entry -> 'name', 20000)
        or (entry ? 'vendor' and not private.startup_json_text_is_valid(entry -> 'vendor', 20000))
        or (entry ? 'expenseDate' and (
          not private.startup_json_text_is_valid(entry -> 'expenseDate', 20000)
          or not private.startup_iso_date_is_valid(entry ->> 'expenseDate')
        ))
        or (entry ? 'status' and (
          not private.startup_json_text_is_valid(entry -> 'status', 20000)
          or entry ->> 'status' not in ('planned','ordered','invoiced','paid')
        ))
        or (entry ? 'notes' and not private.startup_json_text_is_valid(entry -> 'notes', 20000))
        or not private.startup_json_money_is_valid(entry -> 'planned')
        or not private.startup_json_money_is_valid(entry -> 'committed')
        or not private.startup_json_money_is_valid(entry -> 'paid')
        or jsonb_typeof(entry -> 'essential') <> 'boolean'
        or (entry ? 'flexibility' and (
          not private.startup_json_text_is_valid(entry -> 'flexibility', 20000)
          or entry ->> 'flexibility' not in ('flexible','non-negotiable')
        ))
        or (entry ? 'minimumAmount' and not private.startup_json_money_is_valid(entry -> 'minimumAmount'))
        or (entry ? 'budgetRole' and (
          not private.startup_json_text_is_valid(entry -> 'budgetRole', 20000)
          or entry ->> 'budgetRole' not in ('opening-cost','operating-reserve')
        ))
        or (entry ? 'subcategories' and (
          jsonb_typeof(entry -> 'subcategories') <> 'array'
          or (case when jsonb_typeof(entry -> 'subcategories') = 'array'
            then jsonb_array_length(entry -> 'subcategories') > 1000 else false end)
        )) then
        violations := array_append(violations, 'budget_item_shape');
      end if;
      if private.startup_json_money_is_valid(entry -> 'planned')
        and private.startup_json_money_is_valid(entry -> 'committed')
        and private.startup_json_money_is_valid(entry -> 'paid') then
        planned := (entry ->> 'planned')::numeric;
        committed := (entry ->> 'committed')::numeric;
        paid := (entry ->> 'paid')::numeric;
        if (entry ->> 'status' = 'planned' and (committed > 0 or paid > 0))
          or (entry ->> 'status' in ('ordered','invoiced') and committed <= 0)
          or (entry ->> 'status' = 'paid'
            and (paid <= 0 or abs(paid - committed) > 0.005))
          or (entry ->> 'flexibility' = 'non-negotiable'
            and entry ? 'minimumAmount'
            and private.startup_json_money_is_valid(entry -> 'minimumAmount')
            and planned < (entry ->> 'minimumAmount')::numeric) then
          violations := array_append(violations, 'budget_item_semantics');
        end if;
      end if;
      if jsonb_typeof(entry -> 'subcategories') = 'array' then
        for line in select value from jsonb_array_elements(entry -> 'subcategories') loop
          if not private.startup_json_object_matches(
            line,
            array['id','name','planned','committed','paid'],
            array['id','name','notes','estimateLow','estimateHigh','planned','committed','paid']
          )
            or not private.startup_json_text_is_valid(line -> 'id', 200, true)
            or not private.startup_json_text_is_valid(line -> 'name', 20000)
            or (line ? 'notes' and not private.startup_json_text_is_valid(line -> 'notes', 20000))
            or (line ? 'estimateLow' and not private.startup_json_money_is_valid(line -> 'estimateLow'))
            or (line ? 'estimateHigh' and not private.startup_json_money_is_valid(line -> 'estimateHigh'))
            or not private.startup_json_money_is_valid(line -> 'planned')
            or not private.startup_json_money_is_valid(line -> 'committed')
            or not private.startup_json_money_is_valid(line -> 'paid') then
            violations := array_append(violations, 'budget_subcategory_shape');
          elsif line ? 'estimateLow' or line ? 'estimateHigh' then
            planned := (line ->> 'planned')::numeric;
            low_estimate := coalesce((line ->> 'estimateLow')::numeric, planned);
            high_estimate := coalesce((line ->> 'estimateHigh')::numeric, planned);
            if low_estimate > high_estimate
              or abs(planned - high_estimate) > 0.005 then
              violations := array_append(violations, 'budget_subcategory_estimate');
            end if;
          end if;
        end loop;
      end if;
    end loop;
  end if;

  financials := p_data -> 'financials';
  if not private.startup_json_object_matches(
    financials,
    array['cashOnHand','reserveFloor','projectedMonthlySales','grossMarginPercent','startupBudgetCap','monthlyCosts'],
    array['cashOnHand','reserveFloor','projectedMonthlySales','grossMarginPercent','startupBudgetCap','monthlyCosts']
  )
    or not private.startup_json_money_is_valid(financials -> 'cashOnHand')
    or not private.startup_json_money_is_valid(financials -> 'reserveFloor')
    or not private.startup_json_money_is_valid(financials -> 'projectedMonthlySales')
    or jsonb_typeof(financials -> 'grossMarginPercent') <> 'number'
    or (case when jsonb_typeof(financials -> 'grossMarginPercent') = 'number'
      then (financials ->> 'grossMarginPercent')::numeric not between 0 and 100
      else false end)
    or not private.startup_json_money_is_valid(financials -> 'startupBudgetCap')
    or jsonb_typeof(financials -> 'monthlyCosts') <> 'array'
    or (case when jsonb_typeof(financials -> 'monthlyCosts') = 'array'
      then jsonb_array_length(financials -> 'monthlyCosts') > 1000 else false end) then
    violations := array_append(violations, 'financials_shape');
  elsif jsonb_typeof(financials -> 'monthlyCosts') = 'array' then
    for entry in select value from jsonb_array_elements(financials -> 'monthlyCosts') loop
      if not private.startup_json_object_matches(
        entry,
        array['id','name','amount','category'],
        array['id','name','amount','category']
      )
        or not private.startup_json_text_is_valid(entry -> 'id', 200, true)
        or not private.startup_json_text_is_valid(entry -> 'name', 20000)
        or not private.startup_json_money_is_valid(entry -> 'amount')
        or not private.startup_json_text_is_valid(entry -> 'category', 20000)
        or entry ->> 'category' not in ('occupancy','people','services','other') then
        violations := array_append(violations, 'monthly_cost_shape');
      end if;
    end loop;
  end if;

  if jsonb_typeof(p_data -> 'facts') <> 'array'
    or jsonb_array_length(p_data -> 'facts') > 10000 then
    violations := array_append(violations, 'facts_shape');
  else
    for entry in select value from jsonb_array_elements(p_data -> 'facts') loop
      if not private.startup_json_object_matches(
        entry,
        array['id','group','label','value','status','public','note','source'],
        array['id','group','label','value','status','public','note','source']
      )
        or not private.startup_json_text_is_valid(entry -> 'id', 200, true)
        or not private.startup_json_text_is_valid(entry -> 'group', 20000)
        or entry ->> 'group' not in ('identity','contact','location','opening','discovery')
        or not private.startup_json_text_is_valid(entry -> 'label', 20000)
        or not private.startup_json_text_is_valid(entry -> 'value', 20000)
        or not private.startup_json_text_is_valid(entry -> 'status', 20000)
        or entry ->> 'status' not in ('confirmed','draft','missing')
        or jsonb_typeof(entry -> 'public') <> 'boolean'
        or not private.startup_json_text_is_valid(entry -> 'note', 20000)
        or not private.startup_json_text_is_valid(entry -> 'source', 20000) then
        violations := array_append(violations, 'fact_shape');
      end if;
    end loop;
  end if;

  if exists (
    select 1
    from (values
      ('tasks', p_data -> 'tasks'),
      ('milestones', p_data -> 'milestones'),
      ('events', p_data -> 'events'),
      ('budgetItems', p_data -> 'budgetItems'),
      ('monthlyCosts', financials -> 'monthlyCosts'),
      ('facts', p_data -> 'facts')
    ) collection(name, value)
    where jsonb_typeof(collection.value) = 'array'
      and exists (
        select 1
        from jsonb_array_elements(collection.value) item
        group by item ->> 'id'
        having count(*) > 1
      )
  ) then
    violations := array_append(violations, 'duplicate_collection_id');
  end if;

  if jsonb_typeof(p_data -> 'tasks') = 'array'
    and jsonb_typeof(p_data -> 'milestones') = 'array'
    and exists (
      select 1
      from jsonb_array_elements(p_data -> 'tasks') task
      where task ? 'milestoneId'
        and not exists (
          select 1
          from jsonb_array_elements(p_data -> 'milestones') milestone
          where milestone ->> 'id' = task ->> 'milestoneId'
        )
    ) then
    violations := array_append(violations, 'unknown_task_milestone');
  end if;
  return violations;
end
$$;

create function private.startup_workspace_contract_violations(
  p_data jsonb,
  p_organization_id uuid
)
returns text[]
language plpgsql stable
set search_path = ''
as $$
declare
  violations text[] := '{}'::text[];
  budget_items jsonb;
  tasks jsonb;
  item jsonb;
  subcategories jsonb;
  planned numeric;
  committed numeric;
  paid numeric;
  sub_planned numeric;
  sub_committed numeric;
  sub_paid numeric;
  reserve_total numeric := 0;
  reserve_count integer := 0;
  reserve_floor numeric;
  dependency_issue boolean := false;
  dependency_cycle boolean := false;
begin
  if p_data is null or jsonb_typeof(p_data) <> 'object' then
    return array['workspace_not_object'];
  end if;
  violations := private.startup_workspace_shape_violations(p_data);
  if p_data ->> 'version' <> '2' then
    violations := array_append(violations, 'schema_version');
  end if;
  if p_data ->> 'organizationId' <> p_organization_id::text then
    violations := array_append(violations, 'organization_id');
  end if;
  if p_data ->> 'targetOpeningDate' <> '2026-12-01' then
    violations := array_append(violations, 'target_opening_date');
  end if;
  if not private.startup_iso_date_is_valid(p_data ->> 'targetOpeningDate') then
    violations := array_append(violations, 'invalid_target_opening_date');
  end if;
  if jsonb_typeof(p_data -> 'milestones') <> 'array'
    or not exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(p_data -> 'milestones') = 'array'
          then p_data -> 'milestones' else '[]'::jsonb end
      ) milestone
      where milestone ->> 'id' = 'opening'
        and milestone ->> 'date' = '2026-12-01'
    ) then
    violations := array_append(violations, 'canonical_opening_milestone');
  end if;
  if jsonb_typeof(p_data -> 'events') <> 'array'
    or (
      select count(*)
      from jsonb_array_elements(
        case when jsonb_typeof(p_data -> 'events') = 'array'
          then p_data -> 'events' else '[]'::jsonb end
      ) event
      where event ->> 'kind' = 'opening'
    ) <> 1
    or exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(p_data -> 'events') = 'array'
          then p_data -> 'events' else '[]'::jsonb end
      ) event
      where event ->> 'kind' = 'opening'
        and event ->> 'date' <> '2026-12-01'
    ) then
    violations := array_append(violations, 'canonical_opening_event');
  end if;
  if jsonb_typeof(p_data -> 'facts') <> 'array'
    or not exists (
      select 1
      from jsonb_array_elements(
        case when jsonb_typeof(p_data -> 'facts') = 'array'
          then p_data -> 'facts' else '[]'::jsonb end
      ) fact
      where fact ->> 'id' = 'opening-date'
        and fact ->> 'value' = 'December 1, 2026'
    ) then
    violations := array_append(violations, 'canonical_opening_fact');
  end if;

  budget_items := p_data -> 'budgetItems';
  if jsonb_typeof(budget_items) <> 'array' then
    violations := array_append(violations, 'budget_items_not_array');
  else
    for item in select value from jsonb_array_elements(budget_items) loop
      if jsonb_typeof(item) <> 'object'
        or jsonb_typeof(item -> 'planned') <> 'number'
        or jsonb_typeof(item -> 'committed') <> 'number'
        or jsonb_typeof(item -> 'paid') <> 'number' then
        violations := array_append(violations, 'invalid_budget_amount');
        continue;
      end if;
      planned := (item ->> 'planned')::numeric;
      committed := (item ->> 'committed')::numeric;
      paid := (item ->> 'paid')::numeric;
      if planned < 0 or committed < 0 or paid < 0
        or paid > committed or committed > planned then
        violations := array_append(violations, 'budget_money_order');
      end if;
      if item ->> 'budgetRole' = 'operating-reserve' then
        reserve_count := reserve_count + 1;
        reserve_total := reserve_total + planned;
      end if;
      if item ? 'expenseDate'
        and not private.startup_iso_date_is_valid(item ->> 'expenseDate') then
        violations := array_append(violations, 'invalid_budget_date');
      end if;
      subcategories := item -> 'subcategories';
      if subcategories is not null and jsonb_typeof(subcategories) <> 'array' then
        violations := array_append(violations, 'subcategories_not_array');
      elsif jsonb_typeof(subcategories) = 'array'
        and jsonb_array_length(subcategories) > 0 then
        if exists (
          select 1
          from jsonb_array_elements(subcategories) line
          where jsonb_typeof(line) <> 'object'
            or jsonb_typeof(line -> 'planned') <> 'number'
            or jsonb_typeof(line -> 'committed') <> 'number'
            or jsonb_typeof(line -> 'paid') <> 'number'
            or case when jsonb_typeof(line -> 'planned') = 'number'
              then (line ->> 'planned')::numeric < 0 else true end
            or case when jsonb_typeof(line -> 'committed') = 'number'
              then (line ->> 'committed')::numeric < 0 else true end
            or case when jsonb_typeof(line -> 'paid') = 'number'
              then (line ->> 'paid')::numeric < 0 else true end
            or case when jsonb_typeof(line -> 'paid') = 'number'
                  and jsonb_typeof(line -> 'committed') = 'number'
              then (line ->> 'paid')::numeric > (line ->> 'committed')::numeric
              else true end
            or case when jsonb_typeof(line -> 'committed') = 'number'
                  and jsonb_typeof(line -> 'planned') = 'number'
              then (line ->> 'committed')::numeric > (line ->> 'planned')::numeric
              else true end
        ) then
          violations := array_append(violations, 'subcategory_money_order');
        end if;
        select
          coalesce(sum((line ->> 'planned')::numeric), 0),
          coalesce(sum((line ->> 'committed')::numeric), 0),
          coalesce(sum((line ->> 'paid')::numeric), 0)
        into sub_planned, sub_committed, sub_paid
        from jsonb_array_elements(subcategories) line
        where jsonb_typeof(line -> 'planned') = 'number'
          and jsonb_typeof(line -> 'committed') = 'number'
          and jsonb_typeof(line -> 'paid') = 'number';
        if abs(sub_planned - planned) > 0.005
          or abs(sub_committed - committed) > 0.005
          or abs(sub_paid - paid) > 0.005 then
          violations := array_append(violations, 'subcategory_totals');
        end if;
      end if;
    end loop;
  end if;
  if reserve_count <> 1 then
    violations := array_append(violations, 'operating_reserve_count');
  end if;
  if jsonb_typeof(p_data #> '{financials,reserveFloor}') = 'number' then
    reserve_floor := (p_data #>> '{financials,reserveFloor}')::numeric;
    if reserve_floor < reserve_total then
      violations := array_append(violations, 'operating_reserve_floor');
    end if;
  else
    violations := array_append(violations, 'invalid_reserve_floor');
  end if;

  tasks := p_data -> 'tasks';
  if jsonb_typeof(tasks) <> 'array' then
    violations := array_append(violations, 'tasks_not_array');
  else
    select exists (
      select 1
      from jsonb_array_elements(tasks) task
      where jsonb_typeof(task) <> 'object'
        or nullif(btrim(task ->> 'id'), '') is null
        or jsonb_typeof(task -> 'dependsOn') <> 'array'
        or not private.startup_iso_date_is_valid(task ->> 'dueDate')
        or exists (
          select 1
          from jsonb_array_elements_text(
            case when jsonb_typeof(task -> 'dependsOn') = 'array'
              then task -> 'dependsOn' else '[]'::jsonb end
          ) dependency(id)
          where dependency.id = task ->> 'id'
            or not exists (
              select 1
              from jsonb_array_elements(tasks) candidate
              where candidate ->> 'id' = dependency.id
            )
        )
    ) into dependency_issue;
    if dependency_issue then
      violations := array_append(violations, 'invalid_task_dependency_or_date');
    else
      with recursive edges as (
        select task ->> 'id' as task_id, dependency.id as depends_on
        from jsonb_array_elements(tasks) task
        cross join lateral jsonb_array_elements_text(task -> 'dependsOn') dependency(id)
      ), walk as (
        select edge.task_id as root_id,
               edge.depends_on as current_id,
               array[edge.task_id, edge.depends_on]::text[] as path,
               edge.depends_on = edge.task_id as cycle
        from edges edge
        union all
        select walk.root_id,
               edge.depends_on,
               walk.path || edge.depends_on,
               edge.depends_on = any(walk.path)
        from walk
        join edges edge on edge.task_id = walk.current_id
        where not walk.cycle
      )
      select coalesce(bool_or(cycle), false) into dependency_cycle from walk;
      if dependency_cycle then
        violations := array_append(violations, 'task_dependency_cycle');
      end if;
    end if;
  end if;
  return violations;
end
$$;

revoke all on function private.startup_iso_date_is_valid(text)
from public, anon, authenticated, service_role;
revoke all on function private.startup_json_object_matches(jsonb, text[], text[])
from public, anon, authenticated, service_role;
revoke all on function private.startup_json_text_is_valid(jsonb, integer, boolean)
from public, anon, authenticated, service_role;
revoke all on function private.startup_json_money_is_valid(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.startup_timestamp_is_valid(text)
from public, anon, authenticated, service_role;
revoke all on function private.startup_workspace_migrate_v1(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.startup_workspace_shape_violations(jsonb)
from public, anon, authenticated, service_role;
revoke all on function private.startup_workspace_contract_violations(jsonb, uuid)
from public, anon, authenticated, service_role;

-- Preserve revision 1 byte-for-byte above, build the deterministic v2 document
-- in memory, and refuse the entire migration unless every transformed document
-- passes the same strict contract as the optimistic save RPC. The only numeric
-- normalization is a sole case-insensitive Unallocated subcategory with zero
-- committed and paid totals on both parent and child. Only its mismatched
-- planned value inherits the already-authoritative parent planned total.
do $startup_workspace_v2_migration$
declare
  workspace_row public.startup_workspaces%rowtype;
  candidate jsonb;
  validation_issues text[];
  migrated_at timestamptz;
  normalized_ids jsonb;
  migrated_count integer := 0;
begin
  for workspace_row in
    select * from public.startup_workspaces workspace order by workspace.id
    for update
  loop
    if workspace_row.data ->> 'version' = '1' then
      candidate := private.startup_workspace_migrate_v1(workspace_row.data);
    elsif workspace_row.data ->> 'version' = '2' then
      candidate := workspace_row.data;
    else
      raise exception 'Opening Room workspace % has an unsupported schema version',
        workspace_row.id
        using errcode = '23514';
    end if;
    validation_issues := private.startup_workspace_contract_violations(
      candidate,
      workspace_row.organization_id
    );
    if cardinality(validation_issues) > 0 then
      raise exception 'Opening Room workspace % cannot be losslessly migrated to v2',
        workspace_row.id
        using errcode = '23514',
              detail = array_to_string(validation_issues, ',');
    end if;
  end loop;

  for workspace_row in
    select *
    from public.startup_workspaces workspace
    where workspace.data ->> 'version' = '1'
    order by workspace.id
    for update
  loop
    candidate := private.startup_workspace_migrate_v1(workspace_row.data);
    select coalesce(jsonb_agg(item.value ->> 'id' order by item.ordinality), '[]'::jsonb)
    into normalized_ids
    from jsonb_array_elements(workspace_row.data -> 'budgetItems')
      with ordinality item(value, ordinality)
    where case
      when jsonb_typeof(item.value -> 'subcategories') = 'array' then case
        when jsonb_array_length(item.value -> 'subcategories') = 1
          and lower(btrim(item.value #>> '{subcategories,0,name}')) = 'unallocated'
          and jsonb_typeof(item.value -> 'planned') = 'number'
          and jsonb_typeof(item.value -> 'committed') = 'number'
          and jsonb_typeof(item.value -> 'paid') = 'number'
          and jsonb_typeof(item.value #> '{subcategories,0,planned}') = 'number'
          and jsonb_typeof(item.value #> '{subcategories,0,committed}') = 'number'
          and jsonb_typeof(item.value #> '{subcategories,0,paid}') = 'number'
        then (item.value ->> 'committed')::numeric = 0
          and (item.value ->> 'paid')::numeric = 0
          and (item.value #>> '{subcategories,0,committed}')::numeric = 0
          and (item.value #>> '{subcategories,0,paid}')::numeric = 0
          and (item.value ->> 'planned')::numeric
            <> (item.value #>> '{subcategories,0,planned}')::numeric
        else false
      end
      else false
    end;

    update public.startup_workspaces workspace
    set data = candidate,
        revision = 2,
        updated_at = clock_timestamp()
    where workspace.id = workspace_row.id
      and workspace.revision = 1
    returning workspace.updated_at into migrated_at;
    if migrated_at is null then
      raise exception 'Opening Room workspace % changed during v2 migration',
        workspace_row.id
        using errcode = '40001';
    end if;

    insert into public.startup_workspace_revisions (
      workspace_id, organization_id, revision, data, actor_id, created_at
    ) values (
      workspace_row.id,
      workspace_row.organization_id,
      2,
      candidate,
      null,
      migrated_at
    );
    insert into public.audit_events (
      organization_id, actor_id, actor_role, action, table_name, record_id,
      old_record, new_record, request_id, metadata
    ) values (
      workspace_row.organization_id,
      null,
      null,
      'startup_workspace_v1_migrated',
      'startup_workspaces',
      workspace_row.id,
      jsonb_build_object('revision', 1, 'data', workspace_row.data),
      jsonb_build_object('revision', 2, 'data', candidate),
      null,
      jsonb_build_object(
        'strategy', 'canonical-v2-with-explicit-unallocated-normalization',
        'normalizedBudgetItemIds', normalized_ids,
        'priorDocumentBytes', pg_column_size(workspace_row.data),
        'migratedDocumentBytes', pg_column_size(candidate)
      )
    );
    migrated_count := migrated_count + 1;
  end loop;
  raise notice 'Opening Room v2 migration: % workspace(s) migrated with immutable v1/v2 revisions and audit evidence.',
    migrated_count;
end
$startup_workspace_v2_migration$;

alter table public.startup_workspaces
  add constraint startup_workspaces_v2_contract_ck
  check (
    cardinality(
      private.startup_workspace_contract_violations(data, organization_id)
    ) = 0
  );

create function public.save_startup_workspace(
  p_workspace_id text,
  p_expected_revision bigint,
  p_data jsonb
)
returns table (
  outcome text,
  revision bigint,
  data jsonb,
  updated_at timestamptz
)
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  workspace_row public.startup_workspaces%rowtype;
  validation_issues text[];
begin
  if actor_id is null
    or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2' then
    raise exception 'AAL2 Owner or Admin access is required'
      using errcode = '42501';
  end if;
  if p_workspace_id is null or length(btrim(p_workspace_id)) not between 1 and 200
    or p_expected_revision is null or p_expected_revision < 1
    or p_data is null or jsonb_typeof(p_data) <> 'object' then
    raise exception 'A valid Opening Room save is required'
      using errcode = '22023';
  end if;

  select *
  into workspace_row
  from public.startup_workspaces workspace
  where workspace.id = p_workspace_id
  for update;
  if workspace_row.id is null then
    raise exception 'Opening Room workspace is unavailable'
      using errcode = 'P0002';
  end if;
  if not public.can_manage_org(workspace_row.organization_id) then
    raise exception 'Opening Room workspace is unavailable'
      using errcode = '42501';
  end if;
  validation_issues := private.startup_workspace_contract_violations(
    p_data,
    workspace_row.organization_id
  );
  if cardinality(validation_issues) > 0 then
    raise exception 'Opening Room data failed the v2 contract'
      using errcode = '23514',
            detail = array_to_string(validation_issues, ',');
  end if;

  if workspace_row.revision <> p_expected_revision then
    return query select
      'conflict'::text,
      workspace_row.revision,
      workspace_row.data,
      workspace_row.updated_at;
    return;
  end if;

  update public.startup_workspaces workspace
  set data = p_data,
      revision = workspace.revision + 1,
      updated_at = clock_timestamp()
  where workspace.id = workspace_row.id
    and workspace.revision = p_expected_revision
  returning * into workspace_row;
  if workspace_row.id is null then
    raise exception 'Opening Room workspace changed concurrently; retry'
      using errcode = '40001';
  end if;

  insert into public.startup_workspace_revisions (
    workspace_id,
    organization_id,
    revision,
    data,
    actor_id,
    created_at
  ) values (
    workspace_row.id,
    workspace_row.organization_id,
    workspace_row.revision,
    workspace_row.data,
    actor_id,
    workspace_row.updated_at
  );

  return query select
    'saved'::text,
    workspace_row.revision,
    workspace_row.data,
    workspace_row.updated_at;
end
$$;

revoke all on function public.save_startup_workspace(text, bigint, jsonb)
from public, anon, authenticated, service_role;
grant execute on function public.save_startup_workspace(text, bigint, jsonb)
to authenticated;

comment on function public.save_startup_workspace(text, bigint, jsonb) is
'AAL2 Owner/Admin optimistic Opening Room save. Returns saved or current-row conflict and appends every successful revision.';

create function public.manage_location_release_control(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_expected_version bigint,
  p_state text,
  p_accept_reservations_from date,
  p_public_inventory_percent integer,
  p_booking_approved boolean,
  p_support_ready boolean
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  actor_id uuid := auth.uid();
  release_row public.location_release_controls%rowtype;
  previous_row public.location_release_controls%rowtype;
  claimed boolean;
  payload jsonb;
begin
  if actor_id is null
    or coalesce(auth.jwt() ->> 'aal', 'aal1') <> 'aal2'
    or p_request_id is null
    or p_organization_id is null
    or p_location_id is null
    or p_expected_version is null
    or p_state not in ('prelaunch', 'pilot', 'open', 'paused')
    or p_accept_reservations_from < date '2026-12-01'
    or p_booking_approved is null
    or p_support_ready is null then
    raise exception 'A valid AAL2 release-control request is required'
      using errcode = '22023';
  end if;
  if not public.can_manage_org(p_organization_id) then
    raise exception 'AAL2 Owner or Admin access is required'
      using errcode = '42501';
  end if;
  if not exists (
    select 1
    from public.locations location
    where location.organization_id = p_organization_id
      and location.id = p_location_id
      and location.is_active
  ) then
    raise exception 'Release location not found' using errcode = 'P0002';
  end if;

  select *
  into release_row
  from public.location_release_controls release
  where release.organization_id = p_organization_id
    and release.location_id = p_location_id
  for update;
  if release_row.id is null then
    raise exception 'Release control not found' using errcode = 'P0002';
  end if;
  payload := jsonb_build_object(
    'state', p_state,
    'acceptReservationsFrom', p_accept_reservations_from,
    'publicInventoryPercent', p_public_inventory_percent,
    'bookingApproved', p_booking_approved,
    'supportReady', p_support_ready,
    'expectedVersion', p_expected_version
  );
  claimed := private.claim_operation_request(
    p_request_id,
    'release.location.manage',
    p_organization_id,
    p_location_id,
    release_row.id,
    payload
  );
  if not claimed then
    return jsonb_build_object(
      'state', release_row.state,
      'acceptReservationsFrom', release_row.accept_reservations_from,
      'publicInventoryPercent', release_row.public_inventory_percent,
      'bookingApproved', release_row.booking_approved,
      'supportReady', release_row.support_ready,
      'releaseId', release_row.release_id,
      'version', release_row.version,
      'updatedAt', release_row.updated_at,
      'replayed', true
    );
  end if;
  if release_row.version <> p_expected_version then
    raise exception 'Release control changed concurrently; reload and review'
      using errcode = '40001';
  end if;

  previous_row := release_row;
  update public.location_release_controls release
  set state = p_state,
      accept_reservations_from = p_accept_reservations_from,
      public_inventory_percent = p_public_inventory_percent,
      booking_approved = p_booking_approved,
      support_ready = p_support_ready,
      approved_by = case when p_booking_approved then actor_id else null end,
      approved_at = case when p_booking_approved then clock_timestamp() else null end,
      release_id = gen_random_uuid(),
      version = release.version + 1,
      updated_at = clock_timestamp()
  where release.id = release_row.id
  returning * into release_row;

  insert into public.audit_events (
    organization_id,
    location_id,
    actor_id,
    action,
    table_name,
    record_id,
    old_record,
    new_record,
    request_id,
    metadata
  ) values (
    p_organization_id,
    p_location_id,
    actor_id,
    'location_release_control_updated',
    'location_release_controls',
    release_row.id::text,
    to_jsonb(previous_row),
    to_jsonb(release_row),
    p_request_id::text,
    jsonb_build_object(
      'previousReleaseId', previous_row.release_id,
      'releaseId', release_row.release_id
    )
  );
  perform private.complete_operation_request(p_request_id);

  return jsonb_build_object(
    'state', release_row.state,
    'acceptReservationsFrom', release_row.accept_reservations_from,
    'publicInventoryPercent', release_row.public_inventory_percent,
    'bookingApproved', release_row.booking_approved,
    'supportReady', release_row.support_ready,
    'releaseId', release_row.release_id,
    'version', release_row.version,
    'updatedAt', release_row.updated_at,
    'replayed', false
  );
end
$$;

revoke all on function public.manage_location_release_control(
  uuid, uuid, uuid, bigint, text, date, integer, boolean, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.manage_location_release_control(
  uuid, uuid, uuid, bigint, text, date, integer, boolean, boolean
) to authenticated;

comment on function public.manage_location_release_control(
  uuid, uuid, uuid, bigint, text, date, integer, boolean, boolean
) is
'AAL2 Owner/Admin release command with optimistic versioning, immutable release IDs, idempotency, and audit evidence.';

create function public.service_public_release_state(
  p_organization_id uuid,
  p_location_id uuid
)
returns jsonb
language plpgsql stable security definer
set search_path = ''
set row_security = off
as $$
declare
  release_row public.location_release_controls%rowtype;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  select *
  into release_row
  from public.location_release_controls release
  where release.organization_id = p_organization_id
    and release.location_id = p_location_id;
  if release_row.id is null then
    raise exception 'Release control is unavailable' using errcode = 'P0002';
  end if;
  return jsonb_build_object(
    'state', release_row.state,
    'acceptReservationsFrom', release_row.accept_reservations_from,
    'publicInventoryPercent', release_row.public_inventory_percent,
    'bookingApproved', release_row.booking_approved,
    'supportReady', release_row.support_ready,
    'bookingEnabled', release_row.state in ('pilot', 'open')
      and release_row.booking_approved
      and release_row.support_ready,
    'releaseId', release_row.release_id,
    'version', release_row.version,
    'updatedAt', release_row.updated_at
  );
end
$$;

revoke all on function public.service_public_release_state(uuid, uuid)
from public, anon, authenticated, service_role;
grant execute on function public.service_public_release_state(uuid, uuid)
to service_role;

comment on function public.service_public_release_state(uuid, uuid) is
'Service-only, guest-safe projection of the authoritative location release decision.';

create function private.assert_public_booking_release_control(
  p_organization_id uuid,
  p_location_id uuid,
  p_reserved_at timestamptz,
  p_party_size integer
)
returns void
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
declare
  release_row public.location_release_controls%rowtype;
  location_timezone text;
  business_date date;
  service_shift public.service_shifts%rowtype;
  policy record;
  existing_covers integer;
  public_cover_limit integer;
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  if p_organization_id is null or p_location_id is null
    or p_reserved_at is null or p_party_size not between 1 and 100 then
    raise exception 'A valid release-control booking check is required'
      using errcode = '22023';
  end if;
  select location.timezone,
         (p_reserved_at at time zone location.timezone)::date
  into location_timezone, business_date
  from public.locations location
  where location.organization_id = p_organization_id
    and location.id = p_location_id
    and location.is_active;
  if location_timezone is null then
    raise exception 'Reservation location not found' using errcode = 'P0002';
  end if;

  select *
  into release_row
  from public.location_release_controls release
  where release.organization_id = p_organization_id
    and release.location_id = p_location_id
  for share;
  if release_row.id is null
    or release_row.state not in ('pilot', 'open')
    or not release_row.booking_approved
    or not release_row.support_ready
    or business_date < release_row.accept_reservations_from then
    raise exception 'Public booking is not authorized for this business date'
      using errcode = '23514';
  end if;

  perform private.ensure_service_shifts(
    p_organization_id,
    p_location_id,
    array[business_date - 1, business_date]
  );
  select shift.*
  into service_shift
  from public.service_shifts shift
  where shift.organization_id = p_organization_id
    and shift.location_id = p_location_id
    and shift.status = 'scheduled'
    and shift.online_enabled
    and p_reserved_at >= shift.starts_at
    and p_reserved_at < shift.ends_at
  order by shift.starts_at desc, shift.id
  limit 1
  for update;
  if service_shift.id is null then
    raise exception 'No online service is configured for the requested time'
      using errcode = '23514';
  end if;
  select *
  into policy
  from private.service_shift_effective_policy(
    service_shift.id,
    p_reserved_at,
    p_reserved_at + interval '1 microsecond'
  );
  if policy.is_closed then
    raise exception 'The requested time is closed' using errcode = '23514';
  end if;
  public_cover_limit := floor(
    policy.pacing_cover_limit * release_row.public_inventory_percent / 100.0
  )::integer;
  if public_cover_limit < 1 then
    raise exception 'Public inventory is unavailable' using errcode = '23P01';
  end if;

  select coalesce(sum(covers.party_size), 0)::integer
  into existing_covers
  from (
    select reservation.party_size
    from public.reservations reservation
    where reservation.organization_id = p_organization_id
      and reservation.location_id = p_location_id
      and reservation.status not in ('cancelled', 'no_show', 'completed')
      and reservation.reserved_at >= p_reserved_at
        - make_interval(mins => policy.pacing_interval_minutes)
      and reservation.reserved_at < p_reserved_at
        + make_interval(mins => policy.pacing_interval_minutes)
    union all
    select hold.party_size
    from private.public_booking_holds hold
    where hold.organization_id = p_organization_id
      and hold.location_id = p_location_id
      and hold.status = 'pending'
      and hold.expires_at > clock_timestamp()
      and hold.reserved_at >= p_reserved_at
        - make_interval(mins => policy.pacing_interval_minutes)
      and hold.reserved_at < p_reserved_at
        + make_interval(mins => policy.pacing_interval_minutes)
  ) covers;
  if existing_covers + p_party_size > public_cover_limit then
    raise exception 'The requested time has reached its public pilot limit'
      using errcode = '23P01';
  end if;
end
$$;

revoke all on function private.assert_public_booking_release_control(
  uuid, uuid, timestamptz, integer
) from public, anon, authenticated, service_role;

alter function public.service_book_public_reservation(
  uuid, uuid, uuid, timestamptz, integer, integer, text, text,
  text, text, text, uuid[], text[]
) rename to service_book_public_reservation_release_legacy;

revoke all on function public.service_book_public_reservation_release_legacy(
  uuid, uuid, uuid, timestamptz, integer, integer, text, text,
  text, text, text, uuid[], text[]
) from public, anon, authenticated, service_role;

create function public.service_book_public_reservation(
  p_request_id uuid,
  p_organization_id uuid,
  p_location_id uuid,
  p_reserved_at timestamptz,
  p_duration_minutes integer,
  p_party_size integer,
  p_first_name text,
  p_last_name text,
  p_email text,
  p_phone text,
  p_special_requests text,
  p_table_ids uuid[],
  p_available_channels text[]
)
returns jsonb
language plpgsql security definer
set search_path = ''
set row_security = off
as $$
begin
  if coalesce(auth.role(), '') <> 'service_role' then
    raise exception 'Service role is required' using errcode = '42501';
  end if;
  -- Preserve the legacy function's exact replay contract. A completed request
  -- is revalidated by that function's payload hash and may replay after a
  -- later emergency pause; every new or incomplete request must pass the
  -- current release decision and pilot inventory fence first.
  if not exists (
    select 1
    from private.public_booking_requests request
    where request.request_id = p_request_id
      and request.completed_at is not null
  ) then
    perform private.assert_public_booking_release_control(
      p_organization_id,
      p_location_id,
      p_reserved_at,
      p_party_size
    );
  end if;
  return public.service_book_public_reservation_release_legacy(
    p_request_id,
    p_organization_id,
    p_location_id,
    p_reserved_at,
    p_duration_minutes,
    p_party_size,
    p_first_name,
    p_last_name,
    p_email,
    p_phone,
    p_special_requests,
    p_table_ids,
    p_available_channels
  );
end
$$;

revoke all on function public.service_book_public_reservation(
  uuid, uuid, uuid, timestamptz, integer, integer, text, text,
  text, text, text, uuid[], text[]
) from public, anon, authenticated, service_role;
grant execute on function public.service_book_public_reservation(
  uuid, uuid, uuid, timestamptz, integer, integer, text, text,
  text, text, text, uuid[], text[]
) to service_role;

comment on function public.service_book_public_reservation(
  uuid, uuid, uuid, timestamptz, integer, integer, text, text,
  text, text, text, uuid[], text[]
) is
'Authoritative public booking entrypoint. Requires a released business date and enforces the current location public-inventory percentage before the atomic legacy transaction.';
