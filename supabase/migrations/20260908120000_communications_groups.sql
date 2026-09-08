-- Staff-readable, server-written Twilio transcript and a compact request/ticket inbox.
create table public.communication_messages (
  organization_id uuid not null references public.organizations(id),
  location_id uuid not null references public.locations(id),
  sid text not null check (sid ~ '^(SM|MM)[0-9a-fA-F]{32}$'),
  from_number text not null,
  to_number text not null,
  body text not null default '',
  direction text not null check (direction in ('inbound', 'outbound')),
  sender_kind text not null check (sender_kind in ('client', 'staff', 'automation', 'unknown')),
  actor_id uuid references auth.users(id),
  media_count integer not null default 0 check (media_count between 0 and 10),
  status text not null,
  error_code text,
  sent_at timestamptz not null,
  synced_at timestamptz not null default now(),
  primary key (organization_id, sid)
);
create index communication_messages_timeline on public.communication_messages(organization_id, location_id, sent_at desc, sid desc);
create index communication_messages_from on public.communication_messages(organization_id, from_number, sent_at desc);
create index communication_messages_to on public.communication_messages(organization_id, to_number, sent_at desc);

create table public.communication_cases (
  id uuid primary key,
  organization_id uuid not null references public.organizations(id),
  location_id uuid not null references public.locations(id),
  kind text not null check (kind in ('request', 'ticket')),
  title text not null check (length(title) between 1 and 160),
  body text not null default '',
  phone text,
  source_sid text,
  created_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  unique (organization_id, id),
  unique (organization_id, source_sid),
  foreign key (organization_id, source_sid) references public.communication_messages(organization_id, sid)
);
create index communication_cases_timeline on public.communication_cases(organization_id, location_id, created_at desc, id desc);
-- Append-only notes and status events preserve who said and changed what.
create table public.communication_case_notes (
  id uuid primary key,
  organization_id uuid not null,
  case_id uuid not null,
  author_id uuid not null references auth.users(id),
  author_name text not null,
  body text not null check (length(body) between 1 and 10000),
  status text check (status in ('open', 'resolved')),
  created_at timestamptz not null default now(),
  foreign key (organization_id, case_id) references public.communication_cases(organization_id, id)
);
create index communication_case_notes_timeline on public.communication_case_notes(organization_id, case_id, created_at, id);

alter table public.communication_messages enable row level security;
alter table public.communication_cases enable row level security;
alter table public.communication_case_notes enable row level security;
revoke all on public.communication_messages, public.communication_cases, public.communication_case_notes from anon, authenticated;
grant select on public.communication_messages, public.communication_cases, public.communication_case_notes to authenticated;
grant all on public.communication_messages, public.communication_cases, public.communication_case_notes to service_role;
create policy communication_messages_owner_read on public.communication_messages for select to authenticated using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));
create policy communication_cases_owner_read on public.communication_cases for select to authenticated using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));
create policy communication_notes_owner_read on public.communication_case_notes for select to authenticated using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

-- Files are uploaded only through the owner-authenticated endpoint. Twilio gets a
-- short-lived signed download URL; neither the bucket nor its objects are public.
insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('phone-attachments', 'phone-attachments', false, 4000000, array['image/jpeg','image/png','image/gif'])
on conflict (id) do nothing;

alter table public.communication_messages add column audience text not null default 'client' check (audience in ('client','team'));
alter table public.communication_messages add column contact_name text;
create table public.communication_threads (
  organization_id uuid not null references public.organizations(id),
  location_id uuid not null references public.locations(id),
  phone text not null,
  mode text not null default 'human' check (mode in ('human','automation')),
  reason text,
  updated_at timestamptz not null default now(),
  primary key (organization_id, phone)
);
alter table public.communication_threads enable row level security;
revoke all on public.communication_threads from anon, authenticated;
grant select on public.communication_threads to authenticated;
grant all on public.communication_threads to service_role;
create policy communication_threads_owner_read on public.communication_threads for select to authenticated using (public.has_org_role(organization_id, array['owner','admin']::public.app_role[]));

create function public.communication_employee_for_phone(p_organization_id uuid, p_phone text)
returns table (id uuid, display_name text)
language sql stable security invoker set search_path = ''
as $$
  select e.id, e.display_name from public.employees e
  where e.organization_id = p_organization_id and e.employment_status in ('active','leave')
    and regexp_replace(e.phone, '[^0-9]', '', 'g') in
      (regexp_replace(p_phone, '[^0-9]', '', 'g'), case when p_phone like '+1%' then substring(p_phone from 3) else null end)
  order by e.id limit 1
$$;
revoke all on function public.communication_employee_for_phone(uuid,text) from public, anon, authenticated;
grant execute on function public.communication_employee_for_phone(uuid,text) to service_role;

alter table public.communication_messages add column phone text generated always as (case when direction='outbound' then to_number else from_number end) stored;
create index communication_messages_phone on public.communication_messages(organization_id, location_id, phone, sent_at desc, sid desc);
alter table public.communication_messages add foreign key (organization_id, location_id) references public.locations(organization_id, id);
alter table public.communication_cases add foreign key (organization_id, location_id) references public.locations(organization_id, id);
alter table public.communication_threads add foreign key (organization_id, location_id) references public.locations(organization_id, id);
create view public.communication_case_summaries with (security_invoker=true) as
select c.*, coalesce(n.status,'open') as status
from public.communication_cases c
left join lateral (select status from public.communication_case_notes n where n.organization_id=c.organization_id and n.case_id=c.id and n.status is not null order by n.created_at desc,n.id desc limit 1) n on true;
grant select on public.communication_case_summaries to authenticated, service_role;

update private.runtime_schema_contract_expected expected
set migration_head = '20260908120000',
 table_fingerprint = snapshot.value ->> 'tableFingerprint',
 function_fingerprint = snapshot.value ->> 'functionFingerprint',
 access_fingerprint = snapshot.value ->> 'accessFingerprint',
 captured_at = clock_timestamp()
from (select private.compute_runtime_schema_fingerprints() as value) snapshot
where expected.contract_version = 'runtime-schema-v2';
