-- Private supporting documents for Le Yard opening costs.
create table if not exists public.startup_cost_documents (
  id uuid primary key default gen_random_uuid(),
  workspace_id text not null references public.startup_workspaces(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  budget_item_id text not null check (length(btrim(budget_item_id)) between 1 and 200),
  storage_path text not null unique check (length(btrim(storage_path)) between 1 and 1000),
  file_name text not null check (length(btrim(file_name)) between 1 and 255),
  mime_type text not null check (length(btrim(mime_type)) between 1 and 150),
  byte_size bigint not null check (byte_size between 1 and 15728640),
  uploaded_by uuid not null references auth.users(id),
  created_at timestamptz not null default now()
);
comment on table public.startup_cost_documents is 'Private receipt and invoice metadata linked to opening-cost records in a startup workspace.';
create index if not exists startup_cost_documents_workspace_item_idx on public.startup_cost_documents (workspace_id, budget_item_id, created_at desc);
create index if not exists startup_cost_documents_organization_idx on public.startup_cost_documents (organization_id);
alter table public.startup_cost_documents enable row level security;
alter table public.startup_cost_documents force row level security;
revoke all on table public.startup_cost_documents from public, anon, authenticated;
grant select, insert, delete on table public.startup_cost_documents to authenticated;
drop policy if exists "Owners and admins can read startup cost documents" on public.startup_cost_documents;
create policy "Owners and admins can read startup cost documents" on public.startup_cost_documents for select to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])));
drop policy if exists "Owners and admins can add startup cost documents" on public.startup_cost_documents;
create policy "Owners and admins can add startup cost documents" on public.startup_cost_documents for insert to authenticated
with check (
  uploaded_by = (select auth.uid())
  and (select public.has_org_role(organization_id, array['owner', 'admin']::public.app_role[]))
  and exists (select 1 from public.startup_workspaces workspace where workspace.id = workspace_id and workspace.organization_id = organization_id)
);
drop policy if exists "Owners and admins can remove startup cost documents" on public.startup_cost_documents;
create policy "Owners and admins can remove startup cost documents" on public.startup_cost_documents for delete to authenticated
using ((select public.has_org_role(organization_id, array['owner', 'admin']::public.app_role[])));
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('startup-cost-documents','startup-cost-documents',false,15728640,array[
'image/*','application/pdf','text/plain','text/csv','application/msword',
'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'])
on conflict (id) do update set public = excluded.public, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists "Owners and admins can read startup cost files" on storage.objects;
create policy "Owners and admins can read startup cost files" on storage.objects for select to authenticated
using (bucket_id = 'startup-cost-documents' and exists (
  select 1 from public.startup_workspaces workspace
  where workspace.id = (string_to_array(name, '/'))[2]
    and workspace.organization_id::text = (string_to_array(name, '/'))[1]
    and (select public.has_org_role(workspace.organization_id, array['owner', 'admin']::public.app_role[]))
));
drop policy if exists "Owners and admins can upload startup cost files" on storage.objects;
create policy "Owners and admins can upload startup cost files" on storage.objects for insert to authenticated
with check (bucket_id = 'startup-cost-documents' and exists (
  select 1 from public.startup_workspaces workspace
  where workspace.id = (string_to_array(name, '/'))[2]
    and workspace.organization_id::text = (string_to_array(name, '/'))[1]
    and (select public.has_org_role(workspace.organization_id, array['owner', 'admin']::public.app_role[]))
));
drop policy if exists "Owners and admins can remove startup cost files" on storage.objects;
create policy "Owners and admins can remove startup cost files" on storage.objects for delete to authenticated
using (bucket_id = 'startup-cost-documents' and exists (
  select 1 from public.startup_workspaces workspace
  where workspace.id = (string_to_array(name, '/'))[2]
    and workspace.organization_id::text = (string_to_array(name, '/'))[1]
    and (select public.has_org_role(workspace.organization_id, array['owner', 'admin']::public.app_role[]))
));
