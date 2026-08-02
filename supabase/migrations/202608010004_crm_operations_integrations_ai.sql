-- Le Yard OS: guest CRM, daily operations, reporting, integrations, and governed AI.

create table public.guests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  first_name text,
  last_name text,
  display_name text not null,
  email text,
  phone text,
  birthday date,
  vip boolean not null default false,
  preferences text,
  allergies text,
  notes text,
  first_visit_at timestamptz,
  last_visit_at timestamptz,
  visit_count integer not null default 0 check (visit_count >= 0),
  lifetime_spend_cents bigint not null default 0 check (lifetime_spend_cents >= 0),
  source text not null default 'manual' check (source in ('manual', 'resy', 'toast', 'import', 'other')),
  external_references jsonb not null default '{}'::jsonb check (jsonb_typeof(external_references) = 'object'),
  merged_into_id uuid,
  search_vector tsvector generated always as (
    to_tsvector('simple'::regconfig, coalesce(display_name, '') || ' ' || coalesce(email, '') || ' ' || coalesce(phone, '') || ' ' || coalesce(preferences, '') || ' ' || coalesce(allergies, '') || ' ' || coalesce(notes, ''))
  ) stored,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, id),
  foreign key (organization_id, merged_into_id) references public.guests(organization_id, id) on delete set null,
  check (merged_into_id is null or merged_into_id <> id)
);

create unique index guests_email_unique on public.guests(organization_id, lower(email))
where email is not null and merged_into_id is null;
create index guests_search_idx on public.guests using gin(search_vector);

create table public.guest_locations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  guest_id uuid not null,
  location_id uuid not null,
  is_home_location boolean not null default false,
  first_visit_at timestamptz,
  last_visit_at timestamptz,
  visit_count integer not null default 0 check (visit_count >= 0),
  spend_cents bigint not null default 0 check (spend_cents >= 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, guest_id) references public.guests(organization_id, id) on delete cascade,
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  unique (guest_id, location_id)
);

create table public.guest_contacts (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  guest_id uuid not null,
  contact_type text not null check (contact_type in ('email', 'phone', 'address', 'social', 'other')),
  label text,
  value text not null,
  normalized_value text,
  is_primary boolean not null default false,
  verified_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, guest_id) references public.guests(organization_id, id) on delete cascade
);

create table public.guest_tags (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text check (color is null or color ~ '^#[0-9A-Fa-f]{6}$'),
  created_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.guest_tag_assignments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  guest_id uuid not null,
  tag_id uuid not null,
  assigned_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (organization_id, guest_id) references public.guests(organization_id, id) on delete cascade,
  foreign key (organization_id, tag_id) references public.guest_tags(organization_id, id) on delete cascade,
  unique (guest_id, tag_id)
);

create table public.guest_visits (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  guest_id uuid not null,
  visited_at timestamptz not null,
  party_size integer check (party_size is null or party_size > 0),
  covers integer check (covers is null or covers >= 0),
  spend_cents bigint check (spend_cents is null or spend_cents >= 0),
  reservation_id_external text,
  check_reference text,
  server_employee_id uuid,
  source text not null default 'manual' check (source in ('manual', 'resy', 'toast', 'import')),
  notes text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, guest_id) references public.guests(organization_id, id) on delete cascade,
  foreign key (organization_id, server_employee_id) references public.employees(organization_id, id) on delete set null,
  unique (organization_id, id)
);

create table public.reservations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  guest_id uuid,
  reserved_at timestamptz not null,
  party_size integer not null check (party_size > 0),
  status text not null check (status in ('booked', 'confirmed', 'seated', 'completed', 'cancelled', 'no_show')),
  table_label text,
  special_requests text,
  source text not null default 'manual' check (source in ('manual', 'resy', 'import', 'other')),
  external_id text,
  raw_payload jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, guest_id) references public.guests(organization_id, id) on delete set null,
  unique (organization_id, source, external_id),
  unique (organization_id, id)
);

create table public.guest_notes (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  guest_id uuid not null,
  location_id uuid,
  note text not null,
  is_sensitive boolean not null default false,
  author_id uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, guest_id) references public.guests(organization_id, id) on delete cascade,
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade
);

create table public.guest_consents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  guest_id uuid not null,
  channel text not null check (channel in ('email', 'sms', 'phone', 'profiling', 'other')),
  status public.consent_status not null,
  captured_at timestamptz not null,
  revoked_at timestamptz,
  source text not null,
  evidence jsonb not null default '{}'::jsonb check (jsonb_typeof(evidence) = 'object'),
  recorded_by uuid references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  foreign key (organization_id, guest_id) references public.guests(organization_id, id) on delete cascade,
  check ((status = 'revoked' and revoked_at is not null) or status <> 'revoked')
);

create table public.guest_merge_events (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  source_guest_id uuid not null,
  target_guest_id uuid not null,
  match_score numeric(5,4) check (match_score between 0 and 1),
  reasons jsonb not null default '[]'::jsonb,
  merged_by uuid not null references auth.users(id) on delete restrict,
  merged_at timestamptz not null default now(),
  foreign key (organization_id, source_guest_id) references public.guests(organization_id, id) on delete restrict,
  foreign key (organization_id, target_guest_id) references public.guests(organization_id, id) on delete restrict,
  check (source_guest_id <> target_guest_id)
);

create table public.tasks (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid,
  title text not null,
  description text,
  status public.task_status not null default 'open',
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'urgent')),
  assigned_employee_id uuid,
  created_by uuid not null references auth.users(id) on delete restrict,
  due_at timestamptz,
  completed_at timestamptz,
  completed_by uuid references auth.users(id) on delete set null,
  source_type text,
  source_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, assigned_employee_id) references public.employees(organization_id, id) on delete set null,
  unique (organization_id, id)
);

create table public.checklist_templates (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid,
  name text not null,
  checklist_type text not null check (checklist_type in ('opening', 'closing', 'safety', 'cleaning', 'custom')),
  version integer not null default 1 check (version > 0),
  is_active boolean not null default true,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, name, version),
  unique (organization_id, id)
);

create table public.checklist_template_items (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  template_id uuid not null,
  position integer not null check (position >= 0),
  label text not null,
  instructions text,
  response_type text not null default 'checkbox' check (response_type in ('checkbox', 'text', 'number', 'photo', 'temperature')),
  required boolean not null default true,
  validation jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (organization_id, template_id) references public.checklist_templates(organization_id, id) on delete cascade,
  unique (template_id, position),
  unique (organization_id, id)
);

create table public.checklist_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  template_id uuid not null,
  business_date date not null,
  status public.task_status not null default 'open',
  assigned_employee_id uuid,
  started_at timestamptz,
  completed_at timestamptz,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, template_id) references public.checklist_templates(organization_id, id) on delete restrict,
  foreign key (organization_id, assigned_employee_id) references public.employees(organization_id, id) on delete set null,
  unique (organization_id, id)
);

create table public.checklist_responses (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  checklist_run_id uuid not null,
  template_item_id uuid not null,
  response jsonb not null,
  storage_path text,
  responded_by uuid not null references auth.users(id) on delete restrict,
  responded_at timestamptz not null default now(),
  notes text,
  foreign key (organization_id, checklist_run_id) references public.checklist_runs(organization_id, id) on delete cascade,
  foreign key (organization_id, template_item_id) references public.checklist_template_items(organization_id, id) on delete restrict,
  unique (checklist_run_id, template_item_id)
);

create table public.sop_documents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  title text not null,
  category text,
  current_version integer not null default 1 check (current_version > 0),
  is_published boolean not null default false,
  requires_acknowledgement boolean not null default false,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, id)
);

create table public.sop_versions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sop_document_id uuid not null,
  version integer not null check (version > 0),
  body text,
  storage_path text,
  change_summary text,
  published_by uuid references auth.users(id) on delete set null,
  published_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (organization_id, sop_document_id) references public.sop_documents(organization_id, id) on delete cascade,
  unique (sop_document_id, version),
  unique (organization_id, id),
  check (body is not null or storage_path is not null)
);

create table public.sop_acknowledgements (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sop_version_id uuid not null,
  employee_id uuid not null,
  acknowledged_at timestamptz not null default now(),
  foreign key (organization_id, sop_version_id) references public.sop_versions(organization_id, id) on delete cascade,
  foreign key (organization_id, employee_id) references public.employees(organization_id, id) on delete cascade,
  unique (sop_version_id, employee_id)
);

create table public.maintenance_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  title text not null,
  description text not null,
  category text,
  priority text not null default 'normal' check (priority in ('low', 'normal', 'high', 'emergency')),
  status public.task_status not null default 'open',
  reported_by uuid not null references auth.users(id) on delete restrict,
  assigned_to text,
  vendor_id uuid,
  estimated_cost_cents bigint check (estimated_cost_cents is null or estimated_cost_cents >= 0),
  actual_cost_cents bigint check (actual_cost_cents is null or actual_cost_cents >= 0),
  due_at timestamptz,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, vendor_id) references public.vendors(organization_id, id) on delete set null,
  unique (organization_id, id)
);

create table public.incidents (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid not null,
  incident_type text not null,
  occurred_at timestamptz not null,
  description text not null,
  severity text not null default 'low' check (severity in ('low', 'medium', 'high', 'critical')),
  status text not null default 'open' check (status in ('open', 'investigating', 'resolved', 'closed')),
  reported_by uuid not null references auth.users(id) on delete restrict,
  involved_employee_ids uuid[] not null default '{}',
  guest_id uuid,
  follow_up text,
  resolved_by uuid references auth.users(id) on delete set null,
  resolved_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, guest_id) references public.guests(organization_id, id) on delete set null,
  unique (organization_id, id)
);

create table public.incident_attachments (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  incident_id uuid not null,
  storage_path text not null,
  file_name text not null,
  mime_type text,
  uploaded_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  foreign key (organization_id, incident_id) references public.incidents(organization_id, id) on delete cascade,
  unique (organization_id, storage_path)
);

create table public.saved_reports (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  report_type text not null check (report_type in ('labor', 'attendance', 'overtime', 'tips', 'payroll', 'sales_labor', 'receipts', 'expenses', 'inventory_variance', 'cogs', 'waste', 'vendor_pricing', 'shift_performance', 'guest_activity')),
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  created_by uuid not null references auth.users(id) on delete restrict,
  is_shared boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (organization_id, name),
  unique (organization_id, id)
);

create table public.report_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid,
  saved_report_id uuid,
  report_type text not null,
  period_start date,
  period_end date,
  filters jsonb not null default '{}'::jsonb check (jsonb_typeof(filters) = 'object'),
  status public.job_status not null default 'queued',
  result_summary jsonb,
  row_count integer check (row_count is null or row_count >= 0),
  error_message text,
  requested_by uuid not null references auth.users(id) on delete restrict,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, saved_report_id) references public.saved_reports(organization_id, id) on delete set null,
  unique (organization_id, id),
  check (period_end is null or period_start is null or period_end >= period_start)
);

create table public.export_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  report_run_id uuid,
  export_type text not null check (export_type in ('csv', 'pdf', 'xlsx', 'json')),
  status public.job_status not null default 'queued',
  storage_path text,
  expires_at timestamptz,
  requested_by uuid not null references auth.users(id) on delete restrict,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, report_run_id) references public.report_runs(organization_id, id) on delete cascade,
  unique (organization_id, id)
);

create table public.integration_connections (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  provider public.integration_provider not null,
  display_name text not null,
  adapter_version text not null default 'manual-v1',
  status text not null default 'disconnected' check (status in ('disconnected', 'pending', 'connected', 'degraded', 'disabled')),
  capabilities jsonb not null default '[]'::jsonb check (jsonb_typeof(capabilities) = 'array'),
  configuration jsonb not null default '{}'::jsonb check (jsonb_typeof(configuration) = 'object'),
  last_synced_at timestamptz,
  created_by uuid not null references auth.users(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, provider, location_id),
  unique (organization_id, id)
);

create table private.integration_credentials (
  id uuid primary key default gen_random_uuid(),
  connection_id uuid not null unique references public.integration_connections(id) on delete cascade,
  encrypted_ciphertext bytea not null,
  encryption_key_version text not null,
  credential_hint text,
  rotated_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
revoke all on table private.integration_credentials from public, anon, authenticated;

create table public.integration_sync_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  connection_id uuid not null,
  direction text not null check (direction in ('import', 'export')),
  resource_type text not null,
  status public.job_status not null default 'queued',
  cursor text,
  attempts integer not null default 0 check (attempts >= 0),
  max_attempts integer not null default 5 check (max_attempts > 0),
  next_attempt_at timestamptz,
  records_processed integer not null default 0 check (records_processed >= 0),
  error_message text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, connection_id) references public.integration_connections(organization_id, id) on delete cascade,
  unique (organization_id, id)
);

create table public.integration_sync_records (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  sync_job_id uuid not null,
  resource_type text not null,
  external_id text not null,
  local_table text,
  local_id uuid,
  status text not null check (status in ('created', 'updated', 'unchanged', 'skipped', 'failed')),
  payload_hash text,
  error_message text,
  processed_at timestamptz not null default now(),
  foreign key (organization_id, sync_job_id) references public.integration_sync_jobs(organization_id, id) on delete cascade
);

create table public.import_jobs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  import_type text not null,
  file_name text not null,
  storage_path text not null,
  status public.job_status not null default 'queued',
  mapping jsonb not null default '{}'::jsonb,
  total_rows integer check (total_rows is null or total_rows >= 0),
  successful_rows integer not null default 0 check (successful_rows >= 0),
  failed_rows integer not null default 0 check (failed_rows >= 0),
  requested_by uuid not null references auth.users(id) on delete restrict,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, storage_path),
  unique (organization_id, id)
);

create table public.import_rows (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  import_job_id uuid not null,
  row_number integer not null check (row_number > 0),
  raw_data jsonb not null,
  normalized_data jsonb,
  status text not null default 'pending' check (status in ('pending', 'imported', 'skipped', 'failed')),
  error_message text,
  local_table text,
  local_id uuid,
  created_at timestamptz not null default now(),
  foreign key (organization_id, import_job_id) references public.import_jobs(organization_id, id) on delete cascade,
  unique (import_job_id, row_number)
);

create table public.integration_events (
  id bigint generated always as identity primary key,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  connection_id uuid,
  event_type text not null,
  severity text not null default 'info' check (severity in ('debug', 'info', 'warning', 'error')),
  message text not null,
  metadata jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  foreign key (organization_id, connection_id) references public.integration_connections(organization_id, id) on delete cascade
);

create table public.ai_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  location_id uuid,
  kind public.ai_run_kind not null,
  status public.job_status not null default 'queued',
  prompt text,
  model text,
  input_parameters jsonb not null default '{}'::jsonb,
  output jsonb,
  confidence numeric(5,4) check (confidence between 0 and 1),
  requested_by uuid not null references auth.users(id) on delete restrict,
  started_at timestamptz,
  completed_at timestamptz,
  error_message text,
  created_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  unique (organization_id, id)
);

create table public.ai_citations (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  ai_run_id uuid not null,
  source_table text not null,
  source_record_id text not null,
  source_field text,
  excerpt text,
  relevance numeric(5,4) check (relevance between 0 and 1),
  created_at timestamptz not null default now(),
  foreign key (organization_id, ai_run_id) references public.ai_runs(organization_id, id) on delete cascade
);

create table public.ai_action_proposals (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null,
  location_id uuid,
  ai_run_id uuid not null,
  action_type text not null check (action_type in ('payroll_export', 'tip_distribution', 'punch_edit', 'inventory_adjustment', 'guest_change', 'other')),
  target_table text not null,
  target_record_id text,
  proposed_change jsonb not null check (jsonb_typeof(proposed_change) = 'object'),
  confidence numeric(5,4) check (confidence between 0 and 1),
  status public.request_status not null default 'pending',
  decided_by uuid references auth.users(id) on delete set null,
  decided_at timestamptz,
  decision_note text,
  applied_by uuid references auth.users(id) on delete set null,
  applied_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade,
  foreign key (organization_id, ai_run_id) references public.ai_runs(organization_id, id) on delete cascade,
  check ((decided_at is null and decided_by is null) or (decided_at is not null and decided_by is not null)),
  check (applied_at is null or (status = 'approved' and applied_by is not null))
);

create table public.notifications (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null,
  title text not null,
  body text,
  action_url text,
  entity_type text,
  entity_id uuid,
  read_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, id)
);

create table public.notification_preferences (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  notification_type text not null,
  in_app boolean not null default true,
  email boolean not null default false,
  push boolean not null default false,
  quiet_hours jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  unique (organization_id, user_id, notification_type)
);

create table public.push_subscriptions (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  endpoint_hash text not null,
  encrypted_subscription bytea not null,
  device_label text,
  last_used_at timestamptz,
  created_at timestamptz not null default now(),
  unique (organization_id, user_id, endpoint_hash)
);

create table public.application_errors (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  location_id uuid,
  user_id uuid references auth.users(id) on delete set null,
  environment text not null check (environment in ('development', 'preview', 'production')),
  fingerprint text,
  severity text not null default 'error' check (severity in ('warning', 'error', 'fatal')),
  message text not null,
  stack_trace text,
  context jsonb not null default '{}'::jsonb,
  resolved_at timestamptz,
  resolved_by uuid references auth.users(id) on delete set null,
  occurred_at timestamptz not null default now(),
  foreign key (organization_id, location_id) references public.locations(organization_id, id) on delete cascade
);

create table public.backup_runs (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete cascade,
  environment text not null check (environment in ('development', 'preview', 'production')),
  provider text not null,
  backup_type text not null check (backup_type in ('platform', 'logical', 'storage_manifest')),
  status public.job_status not null,
  started_at timestamptz not null,
  completed_at timestamptz,
  restore_tested_at timestamptz,
  encrypted_reference text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

create table public.data_export_requests (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  subject_type text not null check (subject_type in ('organization', 'employee', 'guest')),
  subject_id uuid,
  status public.job_status not null default 'queued',
  storage_path text,
  requested_by uuid not null references auth.users(id) on delete restrict,
  approved_by uuid references auth.users(id) on delete set null,
  approved_at timestamptz,
  completed_at timestamptz,
  expires_at timestamptz,
  created_at timestamptz not null default now()
);

create index guest_visits_guest_time_idx on public.guest_visits(guest_id, visited_at desc);
create index reservations_location_time_idx on public.reservations(location_id, reserved_at, status);
create index guest_consents_guest_channel_idx on public.guest_consents(guest_id, channel, captured_at desc);
create index tasks_location_status_due_idx on public.tasks(location_id, status, due_at);
create index checklist_runs_location_date_idx on public.checklist_runs(location_id, business_date desc);
create index maintenance_location_status_idx on public.maintenance_requests(location_id, status, priority);
create index incidents_location_time_idx on public.incidents(location_id, occurred_at desc);
create index report_runs_org_time_idx on public.report_runs(organization_id, created_at desc);
create index sync_jobs_retry_idx on public.integration_sync_jobs(status, next_attempt_at) where status in ('queued', 'failed');
create index import_rows_error_idx on public.import_rows(import_job_id, status) where status = 'failed';
create index ai_runs_org_time_idx on public.ai_runs(organization_id, created_at desc);
create index ai_citations_run_idx on public.ai_citations(ai_run_id);
create index notifications_unread_idx on public.notifications(user_id, created_at desc) where read_at is null;
create index application_errors_unresolved_idx on public.application_errors(organization_id, occurred_at desc) where resolved_at is null;

comment on table private.integration_credentials is 'Server-only ciphertext. The browser-facing connection record never contains secrets.';
comment on table public.ai_citations is 'Every user-visible AI result cites the tenant records used to produce it.';
comment on table public.ai_action_proposals is 'AI output is isolated as a proposal. Protected operations require an authenticated human decision and application.';
comment on table public.backup_runs is 'Evidence registry only; platform backup configuration remains an external operational responsibility.';
