-- Le Yard OS: people operations, scheduling, and team communication.

create table public.job_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  code text not null,
  department text,
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  default_tip_points numeric(8,3) not null default 1 check (default_tip_points >= 0),
  is_tipped boolean not null default false,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, code),
  unique (organization_id, id)
);

create table public.employees (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid references auth.users(id) on delete set null,
  home_location_id uuid,
  employee_number text,
  legal_name text,
  display_name text not null,
  email text,
  phone text,
  hire_date date,
  termination_date date,
  employment_status text not null default 'active' check (employment_status in ('invited', 'active', 'leave', 'terminated')),
  employment_type text check (employment_type in ('full_time', 'part_time', 'seasonal', 'contractor')),
  payroll_reference text,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id),
  unique (organization_id, employee_number),
  unique (organization_id, id),
  foreign key (organization_id, home_location_id) references public.locations(organization_id, id) on delete set null,
  check (termination_date is null or hire_date is null or termination_date >= hire_date)
);

create table public.employee_job_roles (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  job_role_id uuid not null,
  location_id uuid not null,
  hourly_rate_cents integer check (hourly_rate_cents is null or hourly_rate_cents >= 0),
  effective_from date not null default current_date,
  effective_to date,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  unique (employee_id, job_role_id, location_id, effective_from),
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete cascade,
  foreign key (organization_id, job_role_id) references public.job_roles(organization_id, id) on delete restrict,
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  check (effective_to is null or effective_to >= effective_from)
);

create table public.availability_rules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  location_id uuid,
  weekday smallint not null check (weekday between 0 and 6),
  available_from time,
  available_until time,
  is_available boolean not null default true,
  effective_from date not null,
  effective_to date,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete cascade,
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  check (effective_to is null or effective_to >= effective_from),
  check (not is_available or (available_from is not null and available_until is not null))
);

create table public.time_off_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  location_id uuid,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  reason text,
  status public.request_status not null default 'pending',
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete cascade,
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  check (ends_at > starts_at),
  check ((decided_at is null and decided_by is null) or (decided_at is not null and decided_by is not null))
);

create table public.employee_certifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  certification_type text not null,
  issuer text,
  credential_number text,
  issued_on date,
  expires_on date,
  document_path text,
  verified_by uuid references auth.users(id) on delete set null,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete cascade,
  check (expires_on is null or issued_on is null or expires_on >= issued_on)
);

create table public.employee_emergency_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  name text not null,
  relationship text,
  phone text not null,
  email text,
  is_primary boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete cascade
);

create table public.employee_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  employee_id uuid not null,
  document_type text not null,
  title text not null,
  storage_path text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  is_employee_visible boolean not null default true,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete cascade,
  unique (organization_id, storage_path)
);

create function public.is_self_employee(p_employee_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1 from public.employees e
    where e.id = p_employee_id and e.user_id = auth.uid()
  )
$$;

grant execute on function public.is_self_employee(uuid) to authenticated;

create table public.schedule_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  name text not null,
  description text,
  created_by uuid not null references auth.users(id) on delete restrict,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  unique (location_id, name),
  unique (organization_id, id)
);

create table public.schedule_template_shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  template_id uuid not null,
  weekday smallint not null check (weekday between 0 and 6),
  starts_at time not null,
  ends_at time not null,
  job_role_id uuid not null,
  employee_id uuid,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  notes text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, template_id) references public.schedule_templates(organization_id, id) on delete cascade,
  foreign key (organization_id, job_role_id) references public.job_roles(organization_id, id) on delete restrict,
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete set null,
  check (ends_at <> starts_at)
);

create table public.schedules (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  week_start date not null,
  status public.schedule_status not null default 'draft',
  version integer not null default 1 check (version > 0),
  template_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  publish_note text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, template_id) references public.schedule_templates(organization_id, id) on delete set null,
  unique (location_id, week_start, version),
  unique (organization_id, id),
  check ((status = 'published' and published_at is not null and published_by is not null) or status <> 'published')
);

create table public.shifts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  schedule_id uuid not null,
  employee_id uuid,
  job_role_id uuid not null,
  starts_at timestamptz not null,
  ends_at timestamptz not null,
  break_minutes integer not null default 0 check (break_minutes >= 0),
  status public.shift_status not null default 'scheduled',
  is_open boolean not null default false,
  notes text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, schedule_id) references public.schedules(organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete set null,
  foreign key (organization_id, job_role_id) references public.job_roles(organization_id, id) on delete restrict,
  unique (organization_id, id),
  check (ends_at > starts_at),
  check (not is_open or employee_id is null)
);

create table public.shift_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  shift_id uuid not null,
  employee_id uuid not null,
  acknowledged_at timestamptz not null default now(),
  note text,
  foreign key (organization_id, shift_id) references public.shifts(organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete cascade,
  unique (shift_id, employee_id)
);

create table public.shift_swap_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  shift_id uuid not null,
  requested_by_employee_id uuid not null,
  preferred_employee_id uuid,
  reason text,
  status public.request_status not null default 'pending',
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, shift_id) references public.shifts(organization_id, id) on delete cascade,
  foreign key (organization_id, requested_by_employee_id) references public.employees(organization_id, id) on delete cascade,
  foreign key (organization_id, preferred_employee_id) references public.employees(organization_id, id) on delete set null,
  unique (organization_id, id)
);

create table public.shift_swap_offers (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  swap_request_id uuid not null,
  offered_by_employee_id uuid not null,
  offered_shift_id uuid,
  message text,
  status public.request_status not null default 'pending',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, swap_request_id) references public.shift_swap_requests(organization_id, id) on delete cascade,
  foreign key (organization_id, offered_by_employee_id) references public.employees(organization_id, id) on delete cascade,
  foreign key (organization_id, offered_shift_id) references public.shifts(organization_id, id) on delete set null,
  unique (swap_request_id, offered_by_employee_id)
);

create table public.chat_channels (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  kind public.channel_kind not null,
  name text not null,
  description text,
  is_archived boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, id),
  check ((kind = 'location' and location_id is not null) or kind <> 'location')
);

create table public.chat_channel_members (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  channel_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  joined_at timestamptz not null default now(),
  muted_until timestamptz,
  foreign key (organization_id, channel_id) references public.chat_channels(organization_id, id) on delete cascade,
  foreign key (organization_id, user_id) references public.organization_memberships(organization_id, user_id) on delete cascade,
  unique (channel_id, user_id)
);

create function public.can_access_channel(p_channel_id uuid)
returns boolean
language sql stable security definer
set search_path = ''
set row_security = off
as $$
  select exists (
    select 1 from public.chat_channels c
    where c.id = p_channel_id
      and public.can_access_org(c.organization_id)
      and (
        c.kind = 'all_staff'
        or (c.kind = 'location' and public.can_access_location(c.organization_id, c.location_id))
        or (c.kind = 'management' and public.has_org_role(c.organization_id, array['owner'::public.app_role, 'admin'::public.app_role, 'manager'::public.app_role]))
        or (c.kind = 'private' and exists (
          select 1 from public.chat_channel_members cm
          where cm.channel_id = c.id and cm.user_id = auth.uid()
        ))
      )
  )
$$;

grant execute on function public.can_access_channel(uuid) to authenticated;

create table public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  channel_id uuid not null,
  author_id uuid not null references auth.users(id) on delete restrict,
  reply_to_id uuid references public.chat_messages(id) on delete set null,
  body text not null check (length(btrim(body)) between 1 and 10000),
  is_announcement boolean not null default false,
  edited_at timestamptz,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, channel_id) references public.chat_channels(organization_id, id) on delete cascade,
  unique (organization_id, id)
);

create table public.chat_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  message_id uuid not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  size_bytes bigint check (size_bytes is null or size_bytes >= 0),
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (organization_id, message_id) references public.chat_messages(organization_id, id) on delete cascade,
  unique (organization_id, storage_path)
);

create table public.chat_reactions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  message_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  emoji text not null check (length(emoji) between 1 and 32),
  created_at timestamptz not null default now(),
  foreign key (organization_id, message_id) references public.chat_messages(organization_id, id) on delete cascade,
  unique (message_id, user_id, emoji)
);

create table public.chat_read_receipts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  channel_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  last_read_message_id uuid references public.chat_messages(id) on delete set null,
  last_read_at timestamptz not null default now(),
  foreign key (organization_id, channel_id) references public.chat_channels(organization_id, id) on delete cascade,
  unique (channel_id, user_id)
);

create table public.announcement_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  message_id uuid not null,
  user_id uuid not null references auth.users(id) on delete cascade,
  acknowledged_at timestamptz not null default now(),
  foreign key (organization_id, message_id) references public.chat_messages(organization_id, id) on delete cascade,
  unique (message_id, user_id)
);

create index employee_user_idx on public.employees(user_id) where user_id is not null;
create index employee_location_idx on public.employees(organization_id, home_location_id, employment_status);
create index availability_employee_idx on public.availability_rules(employee_id, weekday, effective_from);
create index time_off_employee_idx on public.time_off_requests(employee_id, starts_at, ends_at);
create index shifts_location_time_idx on public.shifts(location_id, starts_at, ends_at);
create index shifts_employee_time_idx on public.shifts(employee_id, starts_at) where employee_id is not null;
create index shifts_open_idx on public.shifts(location_id, starts_at) where is_open and status in ('open', 'scheduled');
create index messages_channel_created_idx on public.chat_messages(channel_id, created_at desc) where deleted_at is null;
create index chat_reactions_message_idx on public.chat_reactions(message_id);

comment on table public.employee_emergency_contacts is 'Sensitive contact data: self and management only via RLS.';
comment on table public.schedule_template_shifts is 'Time-only template rows intentionally permit overnight shifts; concrete shifts require ends_at > starts_at.';
