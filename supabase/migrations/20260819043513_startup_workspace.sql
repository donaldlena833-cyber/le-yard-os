-- Le Yard Opening Room: one private, organization-scoped planning workspace.
-- The browser uses only the publishable key. Grants and RLS protect every row.

create table public.startup_workspaces (
  id text primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  data jsonb not null check (jsonb_typeof(data) = 'object'),
  updated_at timestamptz not null default now()
);

create index startup_workspaces_organization_id_idx
  on public.startup_workspaces (organization_id);

revoke all on table public.startup_workspaces from public, anon, authenticated;
grant select, insert, update on table public.startup_workspaces to authenticated;

alter table public.startup_workspaces enable row level security;
alter table public.startup_workspaces force row level security;

create policy startup_workspaces_owner_admin_read
  on public.startup_workspaces
  for select
  to authenticated
  using (
    (select public.has_org_role(
      organization_id,
      array['owner', 'admin']::public.app_role[]
    ))
  );

create policy startup_workspaces_owner_admin_insert
  on public.startup_workspaces
  for insert
  to authenticated
  with check (
    (select public.has_org_role(
      organization_id,
      array['owner', 'admin']::public.app_role[]
    ))
  );

create policy startup_workspaces_owner_admin_update
  on public.startup_workspaces
  for update
  to authenticated
  using (
    (select public.has_org_role(
      organization_id,
      array['owner', 'admin']::public.app_role[]
    ))
  )
  with check (
    (select public.has_org_role(
      organization_id,
      array['owner', 'admin']::public.app_role[]
    ))
  );

comment on table public.startup_workspaces is
  'Private Le Yard opening plan data for active organization owners and admins.';
